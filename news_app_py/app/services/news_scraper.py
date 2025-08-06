import asyncio
import aiohttp
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup
import logging
from dataclasses import dataclass

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

class NewsScraperService:
    """Service for scraping stock news from reliable sources"""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.source_reliability_cache: Dict[str, float] = {}
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.session = aiohttp.ClientSession(
            headers=settings.scraping_headers,
            timeout=aiohttp.ClientTimeout(total=30)
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.session:
            await self.session.close()
    
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
            logger.info(f"Starting news scraping for {ticker}")
            
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
            
            # Step 3: Scrape article content
            articles = await self._scrape_articles_content(reliable_links[:max_articles], ticker)
            
            # Step 4: Validate and score content quality
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
            async with self.session.get(url) as response:
                if response.status != 200:
                    logger.error(f"Finviz returned status {response.status} for {ticker}")
                    return []
                
                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Find news table
                news_table = soup.select_one("table.fullview-news-outer")
                if not news_table:
                    logger.warning(f"No news table found for {ticker}")
                    return []
                
                news_links = []
                rows = news_table.select("tr.cursor-pointer")
                
                for row in rows:
                    try:
                        link_elem = row.select_one("a.tab-link-news")
                        if not link_elem:
                            continue
                            
                        title = link_elem.get_text(strip=True)
                        url = link_elem.get('href', '')
                        
                        if not title or not url:
                            continue
                        
                        # Extract source and timestamp
                        source_elem = row.select_one("td.news-link-source")
                        time_elem = row.select_one("td.news-link-date")
                        
                        source = source_elem.get_text(strip=True) if source_elem else "Unknown"
                        time_str = time_elem.get_text(strip=True) if time_elem else ""
                        
                        # Parse timestamp
                        timestamp = self._parse_finviz_timestamp(time_str)
                        
                        news_links.append({
                            'title': title,
                            'url': url,
                            'source': source,
                            'timestamp': timestamp
                        })
                        
                    except Exception as e:
                        logger.warning(f"Error parsing news row: {e}")
                        continue
                
                logger.info(f"Extracted {len(news_links)} news links from Finviz for {ticker}")
                return news_links
                
        except Exception as e:
            logger.error(f"Error fetching Finviz page for {ticker}: {e}")
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
            url = link['url']
            domain = urlparse(url).netloc.lower()
            
            # Check if source is reliable
            if any(reliable_domain in domain for reliable_domain in settings.reliable_sources):
                link['source_domain'] = domain
                reliable_links.append(link)
            # Check if source is blocked
            elif any(blocked_domain in domain for blocked_domain in settings.blocked_sources):
                logger.debug(f"Skipping blocked source: {domain}")
            else:
                logger.debug(f"Skipping unknown source: {domain}")
        
        return reliable_links
    
    async def _scrape_articles_content(self, news_links: List[Dict[str, Any]], ticker: str) -> List[ScrapedArticle]:
        """
        Scrape content from article URLs
        
        Args:
            news_links: List of news link dictionaries
            ticker: Stock ticker symbol
            
        Returns:
            List of ScrapedArticle objects
        """
        articles = []
        
        # Process articles with rate limiting
        semaphore = asyncio.Semaphore(settings.max_concurrent_analyses)
        
        async def scrape_single_article(link: Dict[str, Any]) -> Optional[ScrapedArticle]:
            async with semaphore:
                return await self._scrape_single_article(link, ticker)
        
        # Scrape articles concurrently
        tasks = [scrape_single_article(link) for link in news_links]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, ScrapedArticle):
                articles.append(result)
            elif isinstance(result, Exception):
                logger.warning(f"Error scraping article: {result}")
        
        # Add delay between batches
        await asyncio.sleep(settings.scraping_delay)
        
        return articles
    
    async def _scrape_single_article(self, link: Dict[str, Any], ticker: str) -> Optional[ScrapedArticle]:
        """
        Scrape content from a single article URL
        
        Args:
            link: News link dictionary
            ticker: Stock ticker symbol
            
        Returns:
            ScrapedArticle object or None if failed
        """
        try:
            url = link['url']
            domain = link['source_domain']
            
            # Check if source is blocked
            if any(blocked_domain in domain for blocked_domain in settings.blocked_sources):
                logger.debug(f"Skipping blocked source: {domain}")
                return None
            
            async with self.session.get(url) as response:
                if response.status != 200:
                    logger.warning(f"Failed to fetch {url}: status {response.status}")
                    return None
                
                html = await response.text()
                
                # Check for blocking indicators
                if self._is_blocked_content(html, domain):
                    logger.warning(f"Content blocked for {domain}")
                    return None
                
                # Extract content based on domain
                content = self._extract_article_content(html, domain)
                
                if not content or len(content) < settings.content_min_length:
                    logger.debug(f"Insufficient content from {url}: {len(content) if content else 0} chars")
                    return None
                
                # Calculate content quality score
                quality_score = self._calculate_content_quality(content, link['title'])
                
                return ScrapedArticle(
                    ticker=ticker,
                    title=link['title'],
                    url=url,
                    source=link['source'],
                    source_domain=domain,
                    published_at=link['timestamp'],
                    content=content,
                    content_length=len(content),
                    content_quality_score=quality_score
                )
                
        except Exception as e:
            logger.warning(f"Error scraping article {link.get('url', 'unknown')}: {e}")
            return None
    
    def _extract_article_content(self, html: str, domain: str) -> str:
        """
        Extract article content based on domain-specific selectors
        
        Args:
            html: Raw HTML content
            domain: Source domain
            
        Returns:
            Extracted article content
        """
        soup = BeautifulSoup(html, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "header", "footer"]):
            script.decompose()
        
        # Domain-specific content extraction
        if "finance.yahoo.com" in domain:
            return self._extract_yahoo_content(soup)
        elif "barrons.com" in domain:
            return self._extract_barrons_content(soup)
        elif "investors.com" in domain:
            return self._extract_investors_content(soup)
        else:
            return self._extract_generic_content(soup)
    
    def _extract_yahoo_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Yahoo Finance articles"""
        # Try multiple selectors for Yahoo Finance
        selectors = [
            "div.caas-body",
            "div[class*='content']",
            "article",
            "main",
            "[role='main']"
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 500:  # Minimum content length
                    return text
        
        return ""
    
    def _extract_barrons_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Barron's articles"""
        selectors = [
            "div.article__content",
            "div[class*='content']",
            "article",
            "main"
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 200:
                    return text
        
        return ""
    
    def _extract_investors_content(self, soup: BeautifulSoup) -> str:
        """Extract content from Investor's Business Daily articles"""
        selectors = [
            "div.article-content",
            "div[class*='content']",
            "article",
            "main"
        ]
        
        for selector in selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 200:
                    return text
        
        return ""
    
    def _extract_generic_content(self, soup: BeautifulSoup) -> str:
        """Generic content extraction fallback"""
        # Try to find the main content area
        main_selectors = [
            "main",
            "article",
            "[role='main']",
            "div[class*='content']",
            "div[class*='article']",
            "div[class*='post']"
        ]
        
        for selector in main_selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                text = content_elem.get_text(separator=' ', strip=True)
                if len(text) > 200:
                    return text
        
        # Fallback to paragraph extraction
        paragraphs = soup.find_all('p')
        text = ' '.join([p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 50])
        
        return text
    
    def _is_blocked_content(self, html: str, domain: str) -> bool:
        """Check if content is blocked or paywalled"""
        blocking_indicators = [
            "access denied",
            "paywall",
            "subscribe",
            "login required",
            "blocked",
            "403 forbidden",
            "401 unauthorized"
        ]
        
        html_lower = html.lower()
        return any(indicator in html_lower for indicator in blocking_indicators)
    
    def _calculate_content_quality(self, content: str, title: str) -> float:
        """Calculate content quality score (0-1)"""
        score = 0.0
        
        # Length score (0-0.3)
        length_score = min(len(content) / 2000, 1.0) * 0.3
        score += length_score
        
        # Title-content relevance (0-0.3)
        title_words = set(title.lower().split())
        content_words = set(content.lower().split())
        if title_words:
            relevance = len(title_words.intersection(content_words)) / len(title_words)
            score += relevance * 0.3
        
        # Financial terms presence (0-0.2)
        financial_terms = ['earnings', 'revenue', 'profit', 'stock', 'market', 'shares', 'quarter', 'growth']
        financial_count = sum(1 for term in financial_terms if term in content.lower())
        financial_score = min(financial_count / 5, 1.0) * 0.2
        score += financial_score
        
        # Readability score (0-0.2)
        sentences = content.split('.')
        avg_sentence_length = sum(len(s.split()) for s in sentences) / max(len(sentences), 1)
        readability = max(0, 1 - abs(avg_sentence_length - 20) / 20) * 0.2
        score += readability
        
        return min(score, 1.0)
    
    def _parse_finviz_timestamp(self, time_str: str) -> datetime:
        """Parse Finviz timestamp string to datetime"""
        now = datetime.now()
        
        if not time_str:
            return now
        
        time_str = time_str.strip().lower()
        
        # Handle relative time formats
        if 'min' in time_str:
            minutes = int(re.findall(r'\d+', time_str)[0])
            return now - timedelta(minutes=minutes)
        elif 'hour' in time_str:
            hours = int(re.findall(r'\d+', time_str)[0])
            return now - timedelta(hours=hours)
        elif 'day' in time_str:
            days = int(re.findall(r'\d+', time_str)[0])
            return now - timedelta(days=days)
        else:
            # Try to parse absolute time
            try:
                return datetime.strptime(time_str, '%b-%d-%y %I:%M%p')
            except:
                return now
    
    def _validate_content_quality(self, articles: List[ScrapedArticle]) -> List[ScrapedArticle]:
        """Validate and filter articles based on quality criteria"""
        valid_articles = []
        
        for article in articles:
            # Check minimum content length
            if article.content_length < settings.content_min_length:
                continue
            
            # Check content quality score
            if article.content_quality_score < 0.3:
                continue
            
            # Check for blocking indicators in content
            if self._is_blocked_content(article.content, article.source_domain):
                continue
            
            valid_articles.append(article)
        
        return valid_articles 