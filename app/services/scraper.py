"""Find recent news for a ticker on Finviz and fetch the article text.

Finviz lists ~100 recent headlines per ticker with the outbound URL. We only
fetch articles from domains in ``settings.allowed_sources`` (currently Yahoo
Finance and Investor's Business Daily), which serve full text to a plain HTTP
client. Everything else on the list is paywalled, video, or unknown.
"""
import asyncio
import logging
import re
from datetime import datetime
from urllib.parse import urlparse

import aiohttp
from bs4 import BeautifulSoup

from app.config import settings
from app.schemas import Article

logger = logging.getLogger(__name__)

# Words in a headline that suggest it is about the company, not the market.
COMPANY_KEYWORDS: dict[str, list[str]] = {
    "AAPL": ["apple", "iphone", "ipad", "mac", "tim cook"],
    "TSLA": ["tesla", "musk", "cybertruck"],
    "MSFT": ["microsoft", "azure", "nadella", "copilot"],
    "GOOGL": ["google", "alphabet", "android", "youtube", "gemini"],
    "GOOG": ["google", "alphabet", "android", "youtube", "gemini"],
    "AMZN": ["amazon", "aws", "prime", "jassy"],
    "NVDA": ["nvidia", "jensen huang", "gpu"],
    "META": ["meta", "facebook", "instagram", "zuckerberg"],
}

# Per-domain container that holds the article paragraphs.
CONTENT_SELECTORS: dict[str, list[str]] = {
    "finance.yahoo.com": ["div.body", "div.caas-body", "article"],
    "www.investors.com": ["article", "div.single-post-content"],
}
GENERIC_SELECTORS = ["article", "main", "[role='main']", "body"]


class NewsScraper:
    def __init__(self) -> None:
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "NewsScraper":
        self._session = aiohttp.ClientSession(
            headers={"User-Agent": settings.user_agent, "Accept": "text/html,*/*;q=0.8"},
            timeout=aiohttp.ClientTimeout(total=settings.request_timeout),
            # Yahoo Finance sends a Content-Security-Policy header larger than
            # aiohttp's 8 KB default, which otherwise fails every request.
            max_line_size=32768,
            max_field_size=32768,
        )
        return self

    async def __aexit__(self, *_) -> None:
        if self._session:
            await self._session.close()

    # ---- public ------------------------------------------------------------

    async def scrape(self, ticker: str, max_articles: int = 10) -> list[Article]:
        ticker = ticker.upper()
        links = await self.get_finviz_links(ticker)
        if not links:
            logger.warning("No Finviz headlines for %s", ticker)
            return []

        candidates = prioritize(filter_allowed(links), ticker)
        logger.info("%s: %d headlines on Finviz, %d from allowed sources", ticker, len(links), len(candidates))

        # Fetch a few more than requested since some pages come back empty.
        articles = await self._fetch_many(candidates[: max_articles + 4], ticker)
        articles.sort(key=lambda a: a.published_at, reverse=True)
        return articles[:max_articles]

    async def get_finviz_links(self, ticker: str) -> list[dict]:
        """Return [{'title','url','source','published_at'}] from the Finviz news table."""
        assert self._session, "use `async with NewsScraper()`"
        url = f"{settings.finviz_url}?t={ticker}"
        try:
            async with self._session.get(url) as resp:
                if resp.status != 200:
                    logger.error("Finviz returned %s for %s", resp.status, ticker)
                    return []
                html = await resp.text()
        except Exception as e:  # noqa: BLE001
            logger.error("Finviz request failed for %s: %s", ticker, e)
            return []
        return parse_finviz_news(html)

    # ---- private -----------------------------------------------------------

    async def _fetch_many(self, links: list[dict], ticker: str) -> list[Article]:
        sem = asyncio.Semaphore(settings.max_concurrent_requests)

        async def one(link: dict) -> Article | None:
            async with sem:
                return await self._fetch_article(link, ticker)

        results = await asyncio.gather(*(one(l) for l in links), return_exceptions=True)
        articles = []
        for link, r in zip(links, results):
            if isinstance(r, Article):
                articles.append(r)
            elif isinstance(r, Exception):
                logger.warning("Failed %s: %s", link["url"], r)
        return articles

    async def _fetch_article(self, link: dict, ticker: str) -> Article | None:
        assert self._session
        url = link["url"]
        domain = urlparse(url).netloc.lower()
        try:
            async with self._session.get(url) as resp:
                if resp.status != 200:
                    logger.info("Skipping %s (HTTP %s)", url, resp.status)
                    return None
                html = await resp.text()
        except Exception as e:  # noqa: BLE001
            logger.info("Skipping %s (%s)", url, e)
            return None

        content = extract_article_text(html, domain)
        if len(content) < settings.content_min_length:
            logger.info("Skipping %s (only %d chars extracted)", url, len(content))
            return None

        return Article(
            ticker=ticker,
            title=link["title"],
            url=url,
            source=link["source"],
            source_domain=domain,
            published_at=link["published_at"],
            content=content,
        )


# ---- pure helpers (easy to unit test) -----------------------------------------

def parse_finviz_news(html: str, now: datetime | None = None) -> list[dict]:
    """Parse the news table on a Finviz quote page.

    Rows look like::

        <tr class="cursor-pointer">
          <td>Today 09:37PM</td>            (or "09:27PM", or "Sep-07-26 05:58PM")
          <td><a class="tab-link-news" href="...">Title</a>
              <div class="news-link-right"><span>(Source)</span></div></td>
        </tr>

    Finviz only prints the date on the first row of each day, so we carry the
    last seen date forward.
    """
    now = now or datetime.now()
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.fullview-news-outer")
    if not table:
        return []

    links = []
    current_date = now.date()
    for row in table.select("tr.cursor-pointer"):
        a = row.select_one("a.tab-link-news")
        tds = row.find_all("td")
        if not a or not tds:
            continue
        url = a.get("href", "")
        title = a.get_text(strip=True)
        if not url.startswith("http") or not title:
            continue
        source_el = row.select_one("div.news-link-right span")
        source = source_el.get_text(strip=True).strip("()") if source_el else urlparse(url).netloc

        published_at, current_date = parse_finviz_time(tds[0].get_text(strip=True), current_date, now)
        links.append({"title": title, "url": url, "source": source, "published_at": published_at})
    return links


def parse_finviz_time(text: str, current_date, now: datetime) -> tuple[datetime, object]:
    """Turn 'Today 09:37PM' / 'Sep-07-26 05:58PM' / '09:27PM' into a datetime.

    Returns (datetime, date_to_carry_forward).
    """
    text = text.strip()
    m = re.match(r"^(?:(Today)|([A-Z][a-z]{2}-\d{2}-\d{2}))\s+(\d{1,2}:\d{2}[AP]M)$", text)
    if m:
        if m.group(2):
            current_date = datetime.strptime(m.group(2), "%b-%d-%y").date()
        else:
            current_date = now.date()
        time_part = m.group(3)
    else:
        time_part = text
    try:
        t = datetime.strptime(time_part, "%I:%M%p").time()
        return datetime.combine(current_date, t), current_date
    except ValueError:
        return now, current_date


def filter_allowed(links: list[dict]) -> list[dict]:
    out = []
    for link in links:
        domain = urlparse(link["url"]).netloc.lower()
        if domain in settings.allowed_sources:
            out.append(link)
    return out


def prioritize(links: list[dict], ticker: str) -> list[dict]:
    """Company-specific headlines first, then general market news; newest first within each."""
    keywords = [ticker.lower()] + COMPANY_KEYWORDS.get(ticker.upper(), [])

    def is_specific(link: dict) -> bool:
        hay = (link["title"] + " " + link["url"]).lower()
        return any(k in hay for k in keywords)

    specific = [l for l in links if is_specific(l)]
    general = [l for l in links if not is_specific(l)]
    key = lambda l: l["published_at"]  # noqa: E731
    return sorted(specific, key=key, reverse=True) + sorted(general, key=key, reverse=True)


def extract_article_text(html: str, domain: str) -> str:
    """Join the paragraphs inside the article container. Returns '' if nothing useful."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "noscript"]):
        tag.decompose()

    for selector in CONTENT_SELECTORS.get(domain, []) + GENERIC_SELECTORS:
        container = soup.select_one(selector)
        if not container:
            continue
        paragraphs = [p.get_text(" ", strip=True) for p in container.find_all("p")]
        text = " ".join(p for p in paragraphs if len(p) > 40)
        if len(text) >= settings.content_min_length:
            return _truncate(text, 6000)
    return ""


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0]

