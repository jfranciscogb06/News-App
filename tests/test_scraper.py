from datetime import datetime

from app.services.scraper import extract_article_text, filter_allowed, parse_finviz_news, prioritize

NOW = datetime(2026, 9, 8, 22, 0)

# Trimmed copy of the real Finviz markup (Sep 2026).
FINVIZ_HTML = """
<table class="fullview-news-outer news-table">
  <tr class="cursor-pointer has-label">
    <td width="130" align="right">Today 09:37PM</td>
    <td><div class="news-link-left"><a class="tab-link-news" href="https://www.aboveavalon.com/notes/x">What-Ifs Ahead of Apple's Big Event</a></div>
        <div class="news-link-right"><span>(Above Avalon)</span></div></td>
  </tr>
  <tr class="cursor-pointer has-label">
    <td width="130" align="right">09:27PM</td>
    <td><div class="news-link-left"><a class="tab-link-news" href="https://finance.yahoo.com/m/abc/apple-foldable.html">Apple's Foldable iPhone Debuts Today</a></div>
        <div class="news-link-right"><span>(BeInCrypto)</span></div></td>
  </tr>
  <tr class="cursor-pointer has-label">
    <td width="130" align="right">Sep-07-26 05:58PM</td>
    <td><div class="news-link-left"><a class="tab-link-news" href="https://www.investors.com/news/technology/iphones/">Will Wireless Firms Pony Up</a></div>
        <div class="news-link-right"><span>(Investor's Business Daily)</span></div></td>
  </tr>
  <tr class="cursor-pointer has-label">
    <td width="130" align="right">11:29AM</td>
    <td><div class="news-link-left"><a class="tab-link-news" href="https://www.barrons.com/articles/stocks-today">Stocks Today</a></div>
        <div class="news-link-right"><span>(Barrons.com)</span></div></td>
  </tr>
  <tr class="cursor-pointer has-label">
    <td width="130" align="right">10:00AM</td>
    <td><div class="news-link-left"><a class="tab-link-news" href="/news/1/internal">Internal Finviz link</a></div></td>
  </tr>
</table>
"""


def test_parse_finviz_news_dates_and_sources():
    links = parse_finviz_news(FINVIZ_HTML, now=NOW)
    assert [l["source"] for l in links] == ["Above Avalon", "BeInCrypto", "Investor's Business Daily", "Barrons.com"]
    assert links[0]["published_at"] == datetime(2026, 9, 8, 21, 37)
    assert links[1]["published_at"] == datetime(2026, 9, 8, 21, 27)  # date carried from "Today"
    assert links[2]["published_at"] == datetime(2026, 9, 7, 17, 58)
    assert links[3]["published_at"] == datetime(2026, 9, 7, 11, 29)  # date carried from Sep-07
    assert all(l["url"].startswith("http") for l in links)


def test_filter_and_prioritize():
    links = parse_finviz_news(FINVIZ_HTML, now=NOW)
    allowed = filter_allowed(links)
    assert {l["source"] for l in allowed} == {"BeInCrypto", "Investor's Business Daily"}

    ordered = prioritize(allowed, "AAPL")
    assert "Apple" in ordered[0]["title"]  # company-specific headline first


def test_parse_finviz_empty_page():
    assert parse_finviz_news("<html><body>nope</body></html>") == []


def test_extract_article_text_yahoo():
    body = " ".join(f"Sentence number {i} about Apple and its iPhone lineup for this year." for i in range(6))
    html = f"""
    <html><head><script>junk()</script></head><body>
    <nav><p>{'nav ' * 30}</p></nav>
    <article><div class="body yf-1"><div class="bodyItems-wrapper">
      <p>{body}</p><p>Short.</p><p>{body}</p>
    </div></div></article>
    <footer><p>{'footer ' * 30}</p></footer>
    </body></html>"""
    text = extract_article_text(html, "finance.yahoo.com")
    assert text.startswith("Sentence number 0")
    assert "nav" not in text and "footer" not in text and "Short." not in text


def test_extract_article_text_too_short():
    assert extract_article_text("<article><p>tiny</p></article>", "finance.yahoo.com") == ""
