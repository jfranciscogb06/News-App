import asyncio
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
import logging
from dataclasses import dataclass
from playwright.async_api import async_playwright, Browser, Page

from app.core.config import settings
from app.schemas.stock_news import ScrapedArticle
from app.models.stock_news import StockArticle, SourceReliability

logger = logging.getLogger(__name__)

@dataclass
class ScrapingResult:
    """Result of scraping operation"""
    success: bool
    articles: List[ScrapedArticle]
    errors: List[str]
    session_id: str
    duration: float

class PlaywrightScraperService:
    """Service for scraping stock news using Playwright"""
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        self.source_reliability_cache: Dict[str, float] = {}
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        )
        self.page = await self.browser.new_page()
        
        # Set realistic browser properties
        await self.page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        """)
        
        # Set user agent and viewport
        await self.page.set_viewport_size({"width": 1920, "height": 1080})
        await self.page.set_extra_http_headers({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        })
        
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.page:
            await self.page.close()
        if self.browser:
            await self.browser.close()
        if hasattr(self, 'playwright'):
            await self.playwright.stop()
    
    async def scrape_stock_news(self, ticker: str, max_articles: int = 15) -> ScrapingResult:
        """
        Main method to scrape news for a specific stock ticker
        
        Args:
            ticker: Stock ticker symbol (e.g., 'AAPL')
            max_articles: Maximum number of articles to scrape
            
        Returns:
            ScrapingResult with articles and metadata
        """
        session_id = f"{ticker}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        start_time = datetime.now()
        
        try:
            logger.info(f"Starting Playwright news scraping for {ticker}")
            
            # Step 1: Get news links from Finviz
            news_links = await self._get_finviz_news_links(ticker)
            if not news_links:
                return ScrapingResult(
                    success=False,
                    articles=[],
                    errors=[f"No news links found for {ticker}"],
                    session_id=session_id,
                    duration=(datetime.now() - start_time).total_seconds()
                )
            
            logger.info(f"Found {len(news_links)} news links for {ticker}")
            
            # Step 2: Filter by reliable sources
            reliable_links = self._filter_reliable_sources(news_links)
            logger.info(f"Filtered to {len(reliable_links)} reliable sources")
            
            # Step 3: Filter for stock-specific news
            stock_specific_links = self._filter_stock_specific_news(reliable_links, ticker)
            logger.info(f"Filtered to {len(stock_specific_links)} stock-specific articles for {ticker}")
            
            # Step 4: Scrape article content (increased limit for better coverage)
            articles = await self._scrape_articles_content(stock_specific_links[:max(max_articles, 10)], ticker)
            
            # Step 5: Validate and score content quality
            valid_articles = self._validate_content_quality(articles)
            
            duration = (datetime.now() - start_time).total_seconds()
            
            return ScrapingResult(
                success=True,
                articles=valid_articles,
                errors=[],
                session_id=session_id,
                duration=duration
            )
            
        except Exception as e:
            logger.error(f"Error scraping news for {ticker}: {e}")
            return ScrapingResult(
                success=False,
                articles=[],
                errors=[str(e)],
                session_id=session_id,
                duration=(datetime.now() - start_time).total_seconds()
            )
    
    async def _get_finviz_news_links(self, ticker: str) -> List[Dict[str, Any]]:
        """
        Scrape news links from Finviz for a given ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of news link dictionaries with title, url, source, timestamp
        """
        url = f"{settings.finviz_base_url}?t={ticker.upper()}"
        
        try:
            await self.page.goto(url, wait_until='domcontentloaded', timeout=15000)
            
            # Wait for news table to load with a more flexible approach
            try:
                await self.page.wait_for_selector("table.fullview-news-outer", timeout=5000)
            except:
                # Try alternative selectors
                await self.page.wait_for_selector("table", timeout=5000)
            
            # Extract news links with more flexible selectors
            news_links = await self.page.eval_on_selector_all(
                "table a[href*='http'], table tr a",
                """
                (elements) => {
                    return elements.map(el => {
                        try {
                            const row = el.closest('tr');
                            const tds = row ? Array.from(row.querySelectorAll('td')) : [];
                            return {
                                title: el.textContent.trim(),
                                url: el.href,
                                source: tds.length > 0 ? tds[0].textContent.trim() : 'Unknown',
                                timestamp: tds.length > 1 ? tds[tds.length - 1].textContent.trim() : ''
                            };
                        } catch (error) {
                            return {
                                title: el.textContent.trim(),
                                url: el.href,
                                source: 'Unknown',
                                timestamp: ''
                            };
                        }
                    }).filter(item => item.title && item.url && item.url.includes('http')).slice(0, 100);
                }
                """
            )
            
            logger.info(f"Extracted {len(news_links)} news links from Finviz for {ticker}")
            return news_links
            
        except Exception as e:
            logger.error(f"Error getting Finviz news links for {ticker}: {e}")
            return []
    
    def _filter_reliable_sources(self, news_links: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter news links to only include reliable sources
        
        Args:
            news_links: List of news link dictionaries
            
        Returns:
            Filtered list of reliable news links
        """
        reliable_links = []
        
        for link in news_links:
            url = link.get('url', '')
            domain = urlparse(url).netloc.lower()
            
            # Skip Finviz links (they're just internal navigation)
            if 'finviz.com' in domain:
                continue
                
            # Check if domain is in reliable sources
            if any(reliable_source in domain for reliable_source in settings.reliable_sources):
                reliable_links.append(link)
            # Check if domain is blocked
            elif any(blocked_source in domain for blocked_source in settings.blocked_sources):
                continue
            else:
                # Unknown source, add with lower priority
                reliable_links.append(link)
        
        return reliable_links
    
    def _filter_stock_specific_news(self, news_links: List[Dict[str, Any]], ticker: str) -> List[Dict[str, Any]]:
        """
        Filter news links to prioritize stock-specific news over general market news
        
        Args:
            news_links: List of news link dictionaries
            ticker: Stock ticker symbol
            
        Returns:
            Filtered list prioritizing stock-specific news
        """
        stock_specific = []
        general_market = []
        
        ticker_lower = ticker.lower()
        ticker_variations = [ticker_lower, ticker_lower.replace('.', ''), ticker_lower.replace('-', '')]
        
        for link in news_links:
            title = link.get('title', '').lower()
            url = link.get('url', '').lower()
            
            # Check if the title or URL contains the ticker or company name
            is_stock_specific = any(
                variation in title or variation in url 
                for variation in ticker_variations
            )
            
            # Also check for company name variations (for major companies)
            company_keywords = {
                'aapl': ['apple', 'iphone', 'ipad', 'macbook', 'airpods', 'app store'],
                'tsla': ['tesla', 'model s', 'model 3', 'model x', 'model y', 'cybertruck'],
                'msft': ['microsoft', 'windows', 'office', 'azure', 'xbox'],
                'googl': ['google', 'alphabet', 'android', 'chrome', 'youtube'],
                'amzn': ['amazon', 'aws', 'prime', 'kindle', 'echo']
            }
            
            if ticker_lower in company_keywords:
                company_terms = company_keywords[ticker_lower]
                is_stock_specific = is_stock_specific or any(
                    term in title or term in url for term in company_terms
                )
            
            if is_stock_specific:
                stock_specific.append(link)
            else:
                general_market.append(link)
        
        # Return stock-specific news first, then general market news
        # But limit general market news to avoid overwhelming the analysis
        max_general_market = max(0, len(stock_specific) // 2)  # Only half as many general articles
        return stock_specific + general_market[:max_general_market]
    
    async def _scrape_articles_content(self, news_links: List[Dict[str, Any]], ticker: str) -> List[ScrapedArticle]:
        """
        Scrape content from multiple articles concurrently
        
        Args:
            news_links: List of news link dictionaries
            ticker: Stock ticker symbol
            
        Returns:
            List of scraped articles
        """
        articles = []
        
        # Process articles with increased concurrency for faster processing
        semaphore = asyncio.Semaphore(3)  # Increased from 1 to 3 concurrent requests
        
        async def scrape_single_article(link: Dict[str, Any]) -> Optional[ScrapedArticle]:
            async with semaphore:
                # Create a new page for each request to avoid conflicts
                page = await self.browser.new_page()
                try:
                    return await self._scrape_single_article_with_page(link, ticker, page)
                finally:
                    await page.close()
        
        # Create tasks for all articles
        tasks = [scrape_single_article(link) for link in news_links]
        
        # Execute all tasks concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter out None results and exceptions
        for result in results:
            if isinstance(result, ScrapedArticle):
                articles.append(result)
            elif isinstance(result, Exception):
                logger.warning(f"Error scraping article: {result}")
        
        return articles
    
    async def _scrape_single_article_with_page(self, link: Dict[str, Any], ticker: str, page) -> Optional[ScrapedArticle]:
        """
        Scrape content from a single article
        
        Args:
            link: News link dictionary
            ticker: Stock ticker symbol
            
        Returns:
            ScrapedArticle or None if failed
        """
        url = link.get('url', '')
        title = link.get('title', '')
        source = link.get('source', '')
        timestamp_str = link.get('timestamp', '')
        
        try:
            # Navigate to the article
            await page.goto(url, wait_until='domcontentloaded', timeout=10000)
            
            # Reduced wait time for faster processing
            await asyncio.sleep(0.5)
            
            # Get the page content
            html = await page.content()
            
            # Check if content is blocked
            if self._is_blocked_content(html, urlparse(url).netloc):
                logger.warning(f"Blocked content detected for {url}")
                return None
            
            # Extract content based on domain
            content = self._extract_article_content(html, urlparse(url).netloc)
            
            if not content:
                logger.warning(f"No content extracted for {url}")
                return None
            
            # Parse timestamp
            timestamp = self._parse_finviz_timestamp(timestamp_str)
            
            # Calculate content quality score
            quality_score = self._calculate_content_quality(content, title)
            
            return ScrapedArticle(
                title=title,
                url=url,
                content=content,
                source=source,
                source_domain=urlparse(url).netloc,
                published_at=timestamp,
                content_length=len(content),
                content_quality_score=quality_score,
                ticker=ticker
            )
            
        except Exception as e:
            logger.warning(f"Error scraping article {url}: {e}")
            return None
    
    def _extract_article_content(self, html: str, domain: str) -> str:
        """
        Extract article content based on domain
        
        Args:
            html: Raw HTML content
            domain: Domain of the article
            
        Returns:
            Extracted text content
        """
        soup = BeautifulSoup(html, 'html.parser')
        
        if 'finance.yahoo.com' in domain:
            return self._extract_yahoo_content(soup)
        elif 'barrons.com' in domain:
            return self._extract_barrons_content(soup)
        elif 'investors.com' in domain:
            return self._extract_investors_content(soup)
        else:
            return self._extract_generic_content(soup)
    
    def _extract_yahoo_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Yahoo Finance articles"""
        # Try multiple selectors for Yahoo Finance
        selectors = [
            'div[data-test-id="content"]',
            'div.caas-body',
            'div[class*="content"]',
            'article',
            'div[data-test-id="article-content"]'
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                # Remove script and style elements
                for script in content_elem(["script", "style"]):
                    script.decompose()
                
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 100:
                    return text
        
        return ""
    
    def _extract_barrons_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Barron's articles"""
        selectors = [
            'div[data-testid="article-body"]',
            'div.article-content',
            'article',
            'div[class*="content"]'
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                for script in content_elem(["script", "style"]):
                    script.decompose()
                
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 100:
                    return text
        
        return ""
    
    def _extract_investors_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Investor's Business Daily articles"""
        selectors = [
            'div.article-content',
            'div[class*="content"]',
            'article',
            'div[data-testid="article-body"]'
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                for script in content_elem(["script", "style"]):
                    script.decompose()
                
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 100:
                    return text
        
        return ""
    
    def _extract_generic_content(self, soup: BeautifulSoup) -> str:
        """Extract content using generic selectors"""
        # Remove unwanted elements
        for elem in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
            elem.decompose()
        
        # Try to find main content
        selectors = [
            'main',
            'article',
            'div[class*="content"]',
            'div[class*="article"]',
            'div[class*="post"]',
            'div[class*="entry"]'
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 200:
                    return text
        
        # Fallback to body text
        body = soup.find('body')
        if body:
            return body.get_text(separator=' ', strip=True)
        
        return ""
    
    def _is_blocked_content(self, html: str, domain: str) -> bool:
        """
        Check if content is blocked or paywalled
        
        Args:
            html: Raw HTML content
            domain: Domain of the article
            
        Returns:
            True if content is blocked
        """
        blocked_indicators = [
            'subscribe to continue',
            'paywall',
            'premium content',
            'access denied',
            'please log in to continue',
            'membership required',
            'blocked by your organization'
        ]
        
        html_lower = html.lower()
        
        # Only block if we find strong indicators
        strong_blocked = any(indicator in html_lower for indicator in blocked_indicators)
        
        # Check if we have actual content (not just a blocking page)
        has_content = len(html) > 5000  # Reasonable content length
        
        return strong_blocked and not has_content
    
    def _calculate_content_quality(self, content: str, title: str) -> float:
        """
        Calculate content quality score
        
        Args:
            content: Article content
            title: Article title
            
        Returns:
            Quality score between 0 and 1
        """
        if not content or not title:
            return 0.0
        
        # Length factor
        length_score = min(len(content) / 1000, 1.0)
        
        # Title relevance factor
        title_words = set(title.lower().split())
        content_words = set(content.lower().split())
        relevance_score = len(title_words.intersection(content_words)) / max(len(title_words), 1)
        
        # Readability factor (simple heuristic)
        sentences = content.split('.')
        avg_sentence_length = sum(len(s.split()) for s in sentences) / max(len(sentences), 1)
        readability_score = 1.0 if 10 <= avg_sentence_length <= 25 else 0.5
        
        # Combined score
        quality_score = (length_score * 0.4 + relevance_score * 0.3 + readability_score * 0.3)
        
        return min(quality_score, 1.0)
    
    def _parse_finviz_timestamp(self, time_str: str) -> datetime:
        """
        Parse Finviz timestamp string
        
        Args:
            time_str: Timestamp string from Finviz
            
        Returns:
            Parsed datetime object
        """
        now = datetime.now()
        
        if not time_str:
            return now
        
        time_str = time_str.strip().lower()
        
        # Handle relative time formats
        if 'min' in time_str:
            matches = re.findall(r'\d+', time_str)
            if matches:
                minutes = int(matches[0])
                return now - timedelta(minutes=minutes)
        elif 'hour' in time_str:
            matches = re.findall(r'\d+', time_str)
            if matches:
                hours = int(matches[0])
                return now - timedelta(hours=hours)
        elif 'day' in time_str:
            matches = re.findall(r'\d+', time_str)
            if matches:
                days = int(matches[0])
                return now - timedelta(days=days)
        elif 'week' in time_str:
            matches = re.findall(r'\d+', time_str)
            if matches:
                weeks = int(matches[0])
                return now - timedelta(weeks=weeks)
        
        # Try to parse absolute time formats
        try:
            # Handle various date formats
            if '/' in time_str:
                # MM/DD format
                month, day = map(int, time_str.split('/'))
                return now.replace(month=month, day=day)
            elif '-' in time_str:
                # YYYY-MM-DD format
                return datetime.fromisoformat(time_str)
        except:
            pass
        
        return now
    
    def _validate_content_quality(self, articles: List[ScrapedArticle]) -> List[ScrapedArticle]:
        """
        Validate and filter articles based on quality
        
        Args:
            articles: List of scraped articles
            
        Returns:
            Filtered list of high-quality articles
        """
        valid_articles = []
        
        for article in articles:
            # Check quality score
            if article.content_quality_score < 0.1:  # Lowered threshold
                continue
            
            # Check for blocked content indicators
            if self._is_blocked_content(article.content, urlparse(article.url).netloc):
                continue
            
            valid_articles.append(article)
        
        # Sort by quality score (highest first)
        valid_articles.sort(key=lambda x: x.content_quality_score, reverse=True)
        
        return valid_articles 