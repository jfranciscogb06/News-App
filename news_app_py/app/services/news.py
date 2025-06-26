from datetime import datetime, timedelta
from typing import List, Optional
import json
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI
from loguru import logger
import urllib.request
from bs4 import BeautifulSoup
import asyncio
import io
import gzip
import zlib

from app.core.config import settings
from app.models.news import News, Sentiment
from app.schemas.news import NewsCreate, NewsSummary, NewsSentiment


class NewsService:
    def __init__(self):
        self.openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    async def fetch_news(self, ticker: str) -> List[NewsCreate]:
        try:
            logger.info(f"Fetching news from Finviz for ticker: {ticker}")
            # Use the existing fetch_finviz_news method ONLY
            finviz_articles = self.fetch_finviz_news(ticker)
            logger.info(f"Found {len(finviz_articles)} articles from Finviz for {ticker}")
            # Limit to top 15 articles for faster analysis
            finviz_articles = finviz_articles[:15]
            logger.info(f"Limiting analysis to top {len(finviz_articles)} articles for faster response")
            # Convert to NewsCreate objects
            news_create_list = []
            for article in finviz_articles:
                try:
                    date_str = article["published_at"]
                    published_at = None
                    import re
                    # Try to parse Finviz date formats
                    match = re.match(r"([A-Za-z]{3})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(AM|PM)", date_str)
                    if match:
                        month_str, day, year, hour, minute, ampm = match.groups()
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        hour = int(hour)
                        if ampm == 'PM' and hour != 12:
                            hour += 12
                        elif ampm == 'AM' and hour == 12:
                            hour = 0
                        published_at = datetime(int('20'+year), month_num, int(day), hour, int(minute))
                    elif re.match(r"[A-Za-z]{3}-\d{2}-\d{2}", date_str):
                        month_str, day, year = date_str.split('-')
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        published_at = datetime(int('20'+year), month_num, int(day))
                    elif ":" in date_str and len(date_str.split()) == 2:
                        try:
                            date_part, time_part = date_str.split()
                            month, day, year = date_part.split("-")
                            hour, minute = time_part.split(":")
                            published_at = datetime(int('20'+year), int(month), int(day), int(hour), int(minute))
                        except:
                            published_at = datetime.now()
                    elif ":" in date_str:
                        try:
                            hour, minute = date_str.split(":")
                            published_at = datetime.now().replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                        except:
                            published_at = datetime.now()
                    elif re.match(r"\d{2}-\d{2}-\d{2}", date_str):
                        month, day, year = date_str.split("-")
                        published_at = datetime(int('20'+year), int(month), int(day))
                    else:
                        published_at = datetime.now()
                    news_create = NewsCreate(
                        title=article["title"],
                        url=str(article["url"]),
                        source=article["source"],
                        published_at=published_at,
                        ticker=ticker.upper(),
                    )
                    news_create_list.append(news_create)
                except Exception as e:
                    logger.error(f"Error converting Finviz article to NewsCreate: {article} | Error: {e}")
            logger.info(f"Successfully converted {len(news_create_list)} Finviz articles to NewsCreate")
            return news_create_list
        except Exception as e:
            logger.error(f"Error fetching news from Finviz: {e}")
            raise

    async def analyze_news(self, articles: List[NewsCreate]) -> List[NewsCreate]:
        # Process articles in parallel for much faster analysis
        async def analyze_single_article(article: NewsCreate) -> NewsCreate:
            logger.info(f"Analyzing article: {article.title}")
            try:
                # Prepare prompt for GPT
                prompt = f"""Analyze this news article about {article.ticker} stock:
                Title: {article.title}
                Source: {article.source}
                Published: {article.published_at}
                
                Provide a brief summary and determine if the sentiment is positive, negative, or neutral.
                Format the response as JSON with these fields:
                {{
                    "summary": "brief summary",
                    "sentiment": "positive/negative/neutral",
                    "sentimentScore": -1 to 1
                }}"""

                response = await self.openai.chat.completions.create(
                    model="gpt-4",
                    messages=[
                        {"role": "system", "content": "You are a financial news analyst. Respond with valid JSON only."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3
                )

                analysis = json.loads(response.choices[0].message.content)
                
                # Update article with analysis
                article.summary = analysis["summary"]
                article.sentiment = analysis["sentiment"]
                article.sentiment_score = analysis["sentimentScore"]
                return article

            except Exception as e:
                logger.error(f"Error analyzing article: {e} | Article: {article.title}")
                return None

        # Process all articles in parallel (limit to 20 concurrent requests for faster processing)
        semaphore = asyncio.Semaphore(20)
        
        async def analyze_with_semaphore(article: NewsCreate) -> NewsCreate:
            async with semaphore:
                return await analyze_single_article(article)
        
        # Run all analyses in parallel
        results = await asyncio.gather(*[analyze_with_semaphore(article) for article in articles], return_exceptions=True)
        
        # Filter out None results (failed analyses)
        analyzed_articles = [result for result in results if result is not None and not isinstance(result, Exception)]
        
        logger.info(f"Analyzed {len(analyzed_articles)} articles in parallel")
        return analyzed_articles

    async def get_news_for_ticker(
        self, db: AsyncSession, ticker: str, limit: int = 10, offset: int = 0
    ) -> List[News]:
        # First try to get cached news
        query = (
            select(News)
            .where(News.ticker == ticker.upper())
            .order_by(News.published_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        cached_news = result.scalars().all()

        # Check if cache is fresh (most recent article < 30 min old)
        if cached_news:
            most_recent = cached_news[0].published_at
            if most_recent and (datetime.utcnow() - most_recent) < timedelta(minutes=30):
                logger.info(f"Returning {len(cached_news)} cached articles for {ticker} (fresh cache)")
                return cached_news
            else:
                logger.info(f"Cached news for {ticker} is stale (older than 30 min)")

        # If no fresh cached news, fetch and analyze new articles
        logger.info(f"Fetching new articles for {ticker}...")
        articles = await self.fetch_news(ticker)
        analyzed_articles = await self.analyze_news(articles)

        # Save to database if there are any articles
        if analyzed_articles:
            for article in analyzed_articles:
                data = article.model_dump()
                data["url"] = str(data["url"])
                if "sentiment" in data and isinstance(data["sentiment"], str):
                    data["sentiment"] = data["sentiment"].upper()
                db_article = News(**data)
                db.add(db_article)
            await db.commit()
            # Fetch the newly created articles
            result = await db.execute(query)
            return result.scalars().all()
        else:
            logger.info(f"No news articles found for {ticker} after fetch/analyze.")
            return []

    async def get_news_summary(
        self, db: AsyncSession, ticker: str, days: int = 7
    ) -> NewsSummary:
        start_date = datetime.utcnow() - timedelta(days=days)
        
        query = (
            select(News)
            .where(
                News.ticker == ticker.upper(),
                News.published_at >= start_date
            )
            .order_by(News.published_at.desc())
        )
        result = await db.execute(query)
        news = result.scalars().all()

        # Calculate statistics
        stats = {
            "total": len(news),
            "sentiment_counts": {},
            "sentiment_score_sum": 0.0
        }

        for article in news:
            if article.sentiment:
                stats["sentiment_counts"][article.sentiment.value] = stats["sentiment_counts"].get(article.sentiment.value, 0) + 1
            if article.sentiment_score is not None:
                stats["sentiment_score_sum"] += article.sentiment_score

        return NewsSummary(
            ticker=ticker.upper(),
            period=f"{days} days",
            total_articles=stats["total"],
            sentiment_breakdown=stats["sentiment_counts"],
            average_sentiment_score=stats["sentiment_score_sum"] / stats["total"] if stats["total"] > 0 else 0,
            latest_articles=news[:5]
        )

    async def get_sentiment_analysis(
        self, db: AsyncSession, ticker: str, days: int = 7
    ) -> NewsSentiment:
        start_date = datetime.utcnow() - timedelta(days=days)
        
        query = (
            select(News)
            .where(
                News.ticker == ticker.upper(),
                News.published_at >= start_date
            )
            .order_by(News.published_at.desc())
        )
        result = await db.execute(query)
        news = result.scalars().all()

        sentiment = NewsSentiment(
            ticker=ticker.upper(),
            period=f"{days} days",
            average_sentiment=0.0,
            total_articles=len(news),
            positive_articles=0,
            negative_articles=0,
            neutral_articles=0
        )

        for article in news:
            if article.sentiment_score is not None:
                sentiment.average_sentiment += article.sentiment_score
                if article.sentiment_score > 0.2:
                    sentiment.positive_articles += 1
                elif article.sentiment_score < -0.2:
                    sentiment.negative_articles += 1
                else:
                    sentiment.neutral_articles += 1

        if sentiment.total_articles > 0:
            sentiment.average_sentiment /= sentiment.total_articles

        return sentiment

    def fetch_finviz_news(self, ticker: str) -> List[dict]:
        """
        Scrape latest news headlines for a given ticker from Finviz.
        Returns a list of dicts: {title, url, source, published_at}
        """
        url = f"https://finviz.com/quote.ashx?t={ticker.upper()}"
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            html = response.read()
        soup = BeautifulSoup(html, "html.parser")
        news_table = soup.find("table", class_="fullview-news-outer")
        if not news_table:
            return []
        news = []
        current_date = None
        import re
        for row in news_table.find_all("tr"):
            cols = row.find_all("td")
            if len(cols) < 2:
                continue
            date_time = cols[0].text.strip()
            link = cols[1].find("a")
            title = link.text.strip() if link else ""
            url = link["href"] if link else ""
            source = cols[1].find("span", class_="news-link-left").text.strip() if cols[1].find("span", class_="news-link-left") else "Finviz"
            # Skip articles with empty title or URL
            if not title or not url:
                continue
            # Convert relative URLs to absolute URLs
            if url.startswith('/'):
                url = f"https://finviz.com{url}"
            # Finviz: if date_time is a date, update current_date
            # If it's just a time, use current_date
            # Date format: 'Jun-08-25 01:00PM' or 'Jun-08-25' or '01:00PM'
            if re.match(r"[A-Za-z]{3}-\d{2}-\d{2}( .*)?", date_time):
                # It's a date (with or without time)
                parts = date_time.split()
                current_date = parts[0]
                if len(parts) > 1:
                    published_at = f"{current_date} {parts[1]}"
                else:
                    published_at = current_date
            else:
                # It's just a time, use current_date
                published_at = f"{current_date} {date_time}" if current_date else date_time
            news.append({
                "title": title,
                "url": url,
                "source": source,
                "published_at": published_at.strip(),
            })
        return news

    async def fetch_and_analyze_top_news(self, ticker: str, top_count: int = 10, time_period: str = "week") -> List[NewsCreate]:
        """
        Strictly follow this process:
        1. Fetch all headlines for the ticker (raw_articles).
        2. Use GPT to select the most impactful/relevant headlines (titles only).
        3. Fetch the full content for only those selected articles.
        4. Analyze the full content of those selected articles for summary, sentiment, and key topics.
        """
        from datetime import datetime, timedelta
        try:
            logger.info(f"Starting strict multi-stage news analysis for {ticker} (period: {time_period})")
            # Stage 1: Get all raw headlines
            raw_articles = self.fetch_finviz_news(ticker)
            logger.info(f"Found {len(raw_articles)} raw articles from Finviz")
            if not raw_articles:
                return []
            # Stage 2: Filter by date for the time period
            now = datetime.now()
            period_days = {
                "week": 7,
                "two_weeks": 14,
                "month": 30,
                "three_months": 90
            }.get(time_period, 7)
            filtered_articles = []
            for article in raw_articles:
                try:
                    date_str = article["published_at"]
                    published_at = None
                    import re
                    match = re.match(r"([A-Za-z]{3})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(AM|PM)", date_str)
                    if match:
                        month_str, day, year, hour, minute, ampm = match.groups()
                        from datetime import datetime
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        hour = int(hour)
                        if ampm == 'PM' and hour != 12:
                            hour += 12
                        elif ampm == 'AM' and hour == 12:
                            hour = 0
                        published_at = datetime(int('20'+year), month_num, int(day), hour, int(minute))
                    elif re.match(r"[A-Za-z]{3}-\d{2}-\d{2}", date_str):
                        month_str, day, year = date_str.split('-')
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        published_at = datetime(int('20'+year), month_num, int(day))
                    elif ":" in date_str and len(date_str.split()) == 2:
                        try:
                            date_part, time_part = date_str.split()
                            month, day, year = date_part.split("-")
                            hour, minute = time_part.split(":")
                            published_at = datetime(int('20'+year), int(month), int(day), int(hour), int(minute))
                        except:
                            published_at = now
                    elif ":" in date_str:
                        try:
                            hour, minute = date_str.split(":")
                            published_at = now.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                        except:
                            published_at = now
                    elif re.match(r"\d{2}-\d{2}-\d{2}", date_str):
                        month, day, year = date_str.split("-")
                        published_at = datetime(int('20'+year), int(month), int(day))
                    else:
                        published_at = now
                    if (now - published_at).days < period_days:
                        filtered_articles.append(article)
                except Exception as e:
                    logger.warning(f"Error filtering article by date: {e}")
                    continue
            logger.info(f"Filtered to {len(filtered_articles)} articles within {period_days} days for {time_period}")
            if not filtered_articles:
                return []
            # Stage 3: Use GPT to select top articles (titles only)
            titles = [a["title"] for a in filtered_articles]
            titles_text = "\n".join([f"{i+1}. {title}" for i, title in enumerate(titles)])
            period_text = {
                "week": "the next week",
                "two_weeks": "the next two weeks",
                "month": "the next month",
                "three_months": "the next three months"
            }.get(time_period, "the next week")
            prompt = f"""You are a financial analyst. Given these recent news headlines for {ticker} stock, select the top {top_count} articles that are most likely to impact the stock price in {period_text}.

Consider factors like:
- Company earnings, revenue, or financial performance
- Major product launches or announcements (e.g., new vehicles, AI features, autonomous driving)
- Regulatory news or legal issues
- Market-moving events
- Analyst ratings or price targets
- Merger/acquisition news
- Strategic partnerships or collaborations
- Technology developments or innovations
- Market expansion or new markets
- Leadership changes or executive announcements

Pay special attention to articles about:
- For Tesla (TSLA): Robotaxi, autonomous driving, AI, new vehicle models, production updates
- For Apple (AAPL): iPhone, AI, services, regulatory issues, new products
- For other tech companies: AI, cloud services, new products, regulatory issues

Headlines:
{titles_text}

Respond with ONLY the numbers of the top {top_count} articles (e.g., '1, 5, 12, 15, 20, 25, 30, 35, 40, 45') in order of importance."""
            response = await self.openai.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are a financial analyst. Respond with only the article numbers, separated by commas."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            import re
            response_text = response.choices[0].message.content.strip()
            numbers = re.findall(r'\d+', response_text)
            selected_indices = [int(num) - 1 for num in numbers[:top_count]]
            # Stage 4: Fetch full content for selected articles
            selected_articles = [filtered_articles[idx] for idx in selected_indices if 0 <= idx < len(filtered_articles)]
            # Convert to NewsCreate objects and fetch content
            news_create_list = []
            for article in selected_articles:
                try:
                    date_str = article["published_at"]
                    published_at = None
                    import re
                    match = re.match(r"([A-Za-z]{3})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(AM|PM)", date_str)
                    if match:
                        month_str, day, year, hour, minute, ampm = match.groups()
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        hour = int(hour)
                        if ampm == 'PM' and hour != 12:
                            hour += 12
                        elif ampm == 'AM' and hour == 12:
                            hour = 0
                        published_at = datetime(int('20'+year), month_num, int(day), hour, int(minute))
                    elif re.match(r"[A-Za-z]{3}-\d{2}-\d{2}", date_str):
                        month_str, day, year = date_str.split('-')
                        month_num = {
                            'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                            'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                        }[month_str]
                        published_at = datetime(int('20'+year), month_num, int(day))
                    elif ":" in date_str and len(date_str.split()) == 2:
                        try:
                            date_part, time_part = date_str.split()
                            month, day, year = date_part.split("-")
                            hour, minute = time_part.split(":")
                            published_at = datetime(int('20'+year), int(month), int(day), int(hour), int(minute))
                        except:
                            published_at = now
                    elif ":" in date_str:
                        try:
                            hour, minute = date_str.split(":")
                            published_at = now.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                        except:
                            published_at = now
                    elif re.match(r"\d{2}-\d{2}-\d{2}", date_str):
                        month, day, year = date_str.split("-")
                        published_at = datetime(int('20'+year), int(month), int(day))
                    else:
                        published_at = now
                    news_create = NewsCreate(
                        title=article["title"],
                        url=str(article["url"]),
                        source=article["source"],
                        published_at=published_at,
                        ticker=ticker.upper(),
                    )
                    news_create_list.append(news_create)
                except Exception as e:
                    logger.error(f"Error converting selected article to NewsCreate: {article} | Error: {e}")
            # Stage 5: Analyze only selected articles with full content
            analyzed_articles = await self._analyze_articles_with_content(news_create_list)
            logger.info(f"Successfully analyzed {len(analyzed_articles)} articles with full content (strict process)")
            return analyzed_articles
        except Exception as e:
            logger.error(f"Error in strict multi-stage news analysis: {e}")
            return []

    async def _select_top_articles(self, ticker: str, articles: List[dict], top_count: int, time_period: str = "week") -> List[NewsCreate]:
        """
        Use GPT to select the top N most impactful articles for a stock and time period
        """
        try:
            # Prepare articles for GPT selection
            articles_text = ""
            for i, article in enumerate(articles):  # No limit, use all filtered articles
                articles_text += f"{i+1}. {article['title']} (Source: {article['source']}, Time: {article['published_at']})\n"
            
            period_text = {
                "week": "the next week",
                "two_weeks": "the next two weeks",
                "month": "the next month",
                "three_months": "the next three months"
            }.get(time_period, "the next week")
            
            prompt = f"""You are a financial analyst. Given these recent news headlines for {ticker} stock, select the top {top_count} articles that are most likely to impact the stock price in {period_text}.

Consider factors like:
- Company earnings, revenue, or financial performance
- Major product launches or announcements (e.g., new vehicles, AI features, autonomous driving)
- Regulatory news or legal issues
- Market-moving events
- Analyst ratings or price targets
- Merger/acquisition news
- Strategic partnerships or collaborations
- Technology developments or innovations
- Market expansion or new markets
- Leadership changes or executive announcements

Pay special attention to articles about:
- For Tesla (TSLA): Robotaxi, autonomous driving, AI, new vehicle models, production updates
- For Apple (AAPL): iPhone, AI, services, regulatory issues, new products
- For other tech companies: AI, cloud services, new products, regulatory issues

Headlines:
{articles_text}

Respond with ONLY the numbers of the top {top_count} articles (e.g., "1, 5, 12, 15, 20, 25, 30, 35, 40, 45") in order of importance."""

            response = await self.openai.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are a financial analyst. Respond with only the article numbers, separated by commas."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            
            # Parse GPT's response to get selected article indices
            response_text = response.choices[0].message.content.strip()
            selected_indices = []
            
            # Extract numbers from response
            import re
            numbers = re.findall(r'\d+', response_text)
            selected_indices = [int(num) - 1 for num in numbers[:top_count]]  # Convert to 0-based index
            
            # Convert selected articles to NewsCreate objects
            selected_articles = []
            for idx in selected_indices:
                if 0 <= idx < len(articles):
                    article = articles[idx]
                    try:
                        # Parse the date/time from Finviz format
                        date_str = article["published_at"]
                        published_at = None
                        
                        # Handle different Finviz time formats
                        if ":" in date_str:  # Has time component
                            if len(date_str.split()) == 2:  # "MM-DD-YY HH:MM" format
                                try:
                                    date_part, time_part = date_str.split()
                                    month, day, year = date_part.split("-")
                                    hour, minute = time_part.split(":")
                                    # Convert 2-digit year to 4-digit
                                    year = "20" + year if int(year) < 50 else "19" + year
                                    published_at = datetime.strptime(f"{year}-{month}-{day} {hour}:{minute}", "%Y-%m-%d %H:%M")
                                except:
                                    # Try alternative format with AM/PM
                                    try:
                                        date_part, time_part = date_str.split()
                                        month, day, year = date_part.split("-")
                                        # Handle time like "02:30PM"
                                        if "AM" in time_part or "PM" in time_part:
                                            time_clean = time_part.replace("AM", "").replace("PM", "")
                                            hour, minute = time_clean.split(":")
                                            hour = int(hour)
                                            if "PM" in time_part and hour != 12:
                                                hour += 12
                                            elif "AM" in time_part and hour == 12:
                                                hour = 0
                                            year = "20" + year if int(year) < 50 else "19" + year
                                            published_at = datetime.strptime(f"{year}-{month}-{day} {hour:02d}:{minute}", "%Y-%m-%d %H:%M")
                                    except:
                                        # Fallback: use current date with time
                                        hour, minute = date_str.split(":")
                                        today = datetime.now()
                                        published_at = today.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                            else:  # "HH:MM" format (same day)
                                try:
                                    hour, minute = date_str.split(":")
                                    today = datetime.now()
                                    published_at = today.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                                except:
                                    # Handle time like "02:30PM"
                                    try:
                                        time_clean = date_str.replace("AM", "").replace("PM", "")
                                        hour, minute = time_clean.split(":")
                                        hour = int(hour)
                                        if "PM" in date_str and hour != 12:
                                            hour += 12
                                        elif "AM" in date_str and hour == 12:
                                            hour = 0
                                        today = datetime.now()
                                        published_at = today.replace(hour=hour, minute=int(minute), second=0, microsecond=0)
                                    except:
                                        published_at = datetime.now()
                        else:  # Date only
                            try:
                                published_at = datetime.strptime(date_str, "%m-%d-%y")
                            except:
                                published_at = datetime.now()
                        
                        # Make URL absolute if it's relative
                        url = article["url"]
                        if url.startswith("/"):
                            url = "https://finviz.com" + url
                        
                        news_create = NewsCreate(
                            title=article["title"],
                            url=url,
                            source=article["source"],
                            published_at=published_at,
                            ticker=ticker.upper(),
                            summary="",
                            sentiment=Sentiment.NEUTRAL
                        )
                        selected_articles.append(news_create)
                    except Exception as e:
                        logger.warning(f"Error processing article {idx}: {e}")
                        continue
            
            return selected_articles
            
        except Exception as e:
            logger.error(f"Error selecting top articles: {e}")
            # Fallback: return first N articles
            fallback_articles = []
            for article in articles[:top_count]:
                try:
                    # Parse the date/time from Finviz format
                    date_str = article["published_at"]
                    published_at = None
                    
                    # Handle different Finviz time formats
                    if ":" in date_str:  # Has time component
                        if len(date_str.split()) == 2:  # "MM-DD-YY HH:MM" format
                            try:
                                date_part, time_part = date_str.split()
                                month, day, year = date_part.split("-")
                                hour, minute = time_part.split(":")
                                # Convert 2-digit year to 4-digit
                                year = "20" + year if int(year) < 50 else "19" + year
                                published_at = datetime.strptime(f"{year}-{month}-{day} {hour}:{minute}", "%Y-%m-%d %H:%M")
                            except:
                                # Try alternative format with AM/PM
                                try:
                                    date_part, time_part = date_str.split()
                                    month, day, year = date_part.split("-")
                                    # Handle time like "02:30PM"
                                    if "AM" in time_part or "PM" in time_part:
                                        time_clean = time_part.replace("AM", "").replace("PM", "")
                                        hour, minute = time_clean.split(":")
                                        hour = int(hour)
                                        if "PM" in time_part and hour != 12:
                                            hour += 12
                                        elif "AM" in time_part and hour == 12:
                                            hour = 0
                                        year = "20" + year if int(year) < 50 else "19" + year
                                        published_at = datetime.strptime(f"{year}-{month}-{day} {hour:02d}:{minute}", "%Y-%m-%d %H:%M")
                                except:
                                    # Fallback: use current date with time
                                    hour, minute = date_str.split(":")
                                    today = datetime.now()
                                    published_at = today.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                        else:  # "HH:MM" format (same day)
                            try:
                                hour, minute = date_str.split(":")
                                today = datetime.now()
                                published_at = today.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
                            except:
                                # Handle time like "02:30PM"
                                try:
                                    time_clean = date_str.replace("AM", "").replace("PM", "")
                                    hour, minute = time_clean.split(":")
                                    hour = int(hour)
                                    if "PM" in date_str and hour != 12:
                                        hour += 12
                                    elif "AM" in date_str and hour == 12:
                                        hour = 0
                                    today = datetime.now()
                                    published_at = today.replace(hour=hour, minute=int(minute), second=0, microsecond=0)
                                except:
                                    published_at = datetime.now()
                    else:  # Date only
                        try:
                            published_at = datetime.strptime(date_str, "%m-%d-%y")
                        except:
                            published_at = datetime.now()
                    
                    # Make URL absolute if it's relative
                    url = article["url"]
                    if url.startswith("/"):
                        url = "https://finviz.com" + url
                    
                    news_create = NewsCreate(
                        title=article["title"],
                        url=url,
                        source=article["source"],
                        published_at=published_at,
                        ticker=ticker.upper(),
                        summary="",
                        sentiment=Sentiment.NEUTRAL
                    )
                    fallback_articles.append(news_create)
                except Exception as e:
                    logger.warning(f"Error processing fallback article: {e}")
                    continue
            
            return fallback_articles

    async def _fetch_article_content(self, url: str) -> str:
        """
        Fetch the full content of an article from its URL, handling compression and encoding.
        """
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1"
            }
            req = urllib.request.Request(url, headers=headers)
            
            with urllib.request.urlopen(req, timeout=15) as response:
                if response.getcode() != 200:
                    logger.warning(f"HTTP {response.getcode()} for {url}")
                    return ""
                raw = response.read()
                encoding = response.headers.get('Content-Encoding', '').lower()
                if encoding == 'gzip':
                    html_bytes = gzip.decompress(raw)
                elif encoding == 'deflate':
                    html_bytes = zlib.decompress(raw)
                else:
                    html_bytes = raw
                # Try to detect encoding from headers or meta tags
                charset = response.headers.get_content_charset()
                if not charset:
                    # Try to detect from meta tag
                    import re
                    meta_match = re.search(br'<meta[^>]+charset=["\']?([\w-]+)', html_bytes, re.IGNORECASE)
                    if meta_match:
                        charset = meta_match.group(1).decode('ascii', errors='ignore')
                    else:
                        charset = 'utf-8'
                html = html_bytes.decode(charset, errors='replace')
            
            soup = BeautifulSoup(html, "html.parser")
            
            # Remove script and style elements
            for script in soup(["script", "style", "nav", "header", "footer", "aside"]):
                script.decompose()
            
            content_selectors = [
                "article", ".article-content", ".story-content", ".post-content", ".entry-content", ".content", ".main-content", "[role='main']", ".article-body", ".story-body", ".article-text", ".post-body", ".entry-body", ".news-content", ".article__content", ".story__content"
            ]
            content = ""
            for selector in content_selectors:
                elements = soup.select(selector)
                if elements:
                    content = " ".join([elem.get_text(strip=True) for elem in elements])
                    if len(content) > 300:
                        break
            if not content or len(content) < 300:
                paragraphs = soup.find_all('p')
                if paragraphs:
                    content = " ".join([p.get_text(strip=True) for p in paragraphs])
                else:
                    content = soup.get_text(strip=True)
            import re
            content = re.sub(r'\s+', ' ', content)
            content = re.sub(r'[^\w\s\.\,\!\?\-\(\)]', '', content)
            content = content[:4000]
            return content if len(content) > 100 else ""
        except urllib.error.HTTPError as e:
            logger.warning(f"HTTP Error {e.code} fetching article content from {url}")
            return ""
        except urllib.error.URLError as e:
            logger.warning(f"URL Error fetching article content from {url}: {e}")
            return ""
        except Exception as e:
            logger.warning(f"Error fetching article content from {url}: {e}")
            return ""

    async def _analyze_articles_with_content(self, articles: List[NewsCreate]) -> List[NewsCreate]:
        """
        Analyze a list of articles with their full content. Only include articles where content is successfully fetched.
        """
        # Process articles in parallel for much faster analysis
        async def analyze_single_article(article: NewsCreate) -> NewsCreate:
            logger.info(f"Analyzing article with full content: {article.title}")
            try:
                # Fetch the full article content
                content = await self._fetch_article_content(article.url)
                
                if not content or len(content) < 100:
                    logger.warning(f"Skipping article (no content): {article.url}")
                    return None  # Skip this article
                
                # Prepare prompt for GPT with full content
                prompt = f"""Analyze this news article about {article.ticker} stock:

Title: {article.title}
Source: {article.source}
Published: {article.published_at}
Content: {content}

Provide a comprehensive analysis including:
1. A detailed summary of the key points and major developments
2. The sentiment (positive, negative, or neutral) with a confidence score from -1 to 1
3. Potential impact on the stock price
4. Key topics, products, or initiatives mentioned (e.g., AI, autonomous vehicles, earnings, partnerships, etc.)

Format the response as JSON with these fields:
- summary: detailed summary highlighting major developments and key topics
- sentiment: positive, negative, or neutral (only these three values allowed)
- sentiment_score: number between -1 and 1
- impact: high, medium, or low impact on stock price
- key_topics: list of important topics, products, or initiatives mentioned"""

                response = await self.openai.chat.completions.create(
                    model="gpt-4",
                    messages=[
                        {"role": "system", "content": "You are a financial news analyst. Respond with valid JSON only."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3
                )
                
                response_text = response.choices[0].message.content.strip()
                
                # Parse JSON response
                import json
                analysis = json.loads(response_text)
                
                # Update article with analysis results
                article.summary = analysis.get("summary", "")
                sentiment_str = analysis.get("sentiment", "neutral").upper()  # Convert to uppercase
                
                # Handle "MIXED" sentiment by converting to "NEUTRAL"
                if sentiment_str == "MIXED":
                    sentiment_str = "NEUTRAL"
                
                article.sentiment = Sentiment(sentiment_str)
                article.sentiment_score = analysis.get("sentiment_score", 0)
                article.content = content  # Store the full content
                
                return article
                
            except Exception as e:
                logger.error(f"Error analyzing article with content: {e}")
                return None  # Skip this article

        # Process all articles in parallel (limit to 20 concurrent requests for faster processing)
        semaphore = asyncio.Semaphore(20)
        
        async def analyze_with_semaphore(article: NewsCreate) -> NewsCreate:
            async with semaphore:
                return await analyze_single_article(article)
        
        # Run all analyses in parallel
        results = await asyncio.gather(*[analyze_with_semaphore(article) for article in articles], return_exceptions=True)
        
        # Only include articles with valid content and successful analysis
        analyzed_articles = [result for result in results if result is not None and not isinstance(result, Exception)]
        
        logger.info(f"Analyzed {len(analyzed_articles)} articles in parallel (with full content only)")
        return analyzed_articles

    async def summarize_stock_from_articles(self, ticker: str, articles: list, time_period: str = "week") -> dict:
        """
        Use GPT to generate a stock-level summary and aggregate sentiment from the top articles, tailored to the time period.
        """
        if not articles:
            return {
                "summary": "No news articles available.",
                "sentiment": "neutral",
                "sentiment_score": 0
            }
        try:
            summaries = "\n".join([
                f"- {a['title']} (Sentiment: {a['sentiment']}, Score: {a['sentiment_score']}): {a['summary']}"
                for a in articles
            ])
            period_text = {
                "week": "the next week",
                "two_weeks": "the next two weeks",
                "month": "the next month",
                "three_months": "the next three months"
            }.get(time_period, "the next week")
            prompt = f"""You are a financial news analyst. Given the following news article summaries and their sentiment scores for {ticker} stock, analyze the likely impact of this news on the stock price in {period_text}.\n\nProvide:\n- summary: a concise summary of the likely impact\n- sentiment: positive, negative, or neutral\n- sentiment_score: a number between -1 and 1\n\nArticles:\n{summaries}\n\nRespond in JSON with this structure:\n{{\n  \"summary\": \"...\", \"sentiment\": \"...\", \"sentiment_score\": ...\n}}"""
            response = await self.openai.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": "You are a financial news analyst. Respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            import json
            result = json.loads(response.choices[0].message.content.strip())
            return result
        except Exception as e:
            logger.error(f"Error generating stock summary: {e}")
            return {
                "summary": "Error generating summary.",
                "sentiment": "neutral",
                "sentiment_score": 0
            }

    async def generate_stock_recommendation(self, ticker: str, articles: List[dict], time_frame: str = "SHORT_TERM") -> dict:
        """
        Generate a buy/sell recommendation based on analyzed news articles.
        """
        try:
            if not articles:
                return {
                    "ticker": ticker.upper(),
                    "recommendation": "HOLD",
                    "confidence": "LOW",
                    "confidence_score": 0.0,
                    "reasoning": "No recent news articles found for analysis.",
                    "time_frame": time_frame,
                    "risk_level": "HIGH",
                    "summary": "No recent news articles available for analysis.",
                    "article_citations": []
                }

            # Calculate overall sentiment score
            total_sentiment = sum(article.get("sentiment_score", 0) for article in articles)
            avg_sentiment = total_sentiment / len(articles)
            
            # Calculate confidence based on article count and sentiment consistency
            sentiment_variance = sum((article.get("sentiment_score", 0) - avg_sentiment) ** 2 for article in articles) / len(articles)
            confidence_score = min(0.95, max(0.1, 0.5 + (len(articles) / 20) - (sentiment_variance * 2)))
            
            # Determine confidence level enum
            if confidence_score > 0.7:
                confidence_level = "HIGH"
            elif confidence_score > 0.4:
                confidence_level = "MEDIUM"
            else:
                confidence_level = "LOW"
            
            # Determine recommendation based on sentiment and time frame
            if time_frame == "SHORT_TERM":
                if avg_sentiment > 0.3:
                    recommendation = "BUY"
                elif avg_sentiment < -0.3:
                    recommendation = "SELL"
                else:
                    recommendation = "HOLD"
            elif time_frame == "MEDIUM_TERM":
                if avg_sentiment > 0.2:
                    recommendation = "BUY"
                elif avg_sentiment < -0.2:
                    recommendation = "SELL"
                else:
                    recommendation = "HOLD"
            else:  # LONG_TERM
                if avg_sentiment > 0.1:
                    recommendation = "BUY"
                elif avg_sentiment < -0.1:
                    recommendation = "SELL"
                else:
                    recommendation = "HOLD"
            
            # Generate reasoning
            if recommendation == "BUY":
                reasoning = f"Positive sentiment ({avg_sentiment:.2f}) with {len(articles)} recent articles suggests upward momentum."
            elif recommendation == "SELL":
                reasoning = f"Negative sentiment ({avg_sentiment:.2f}) with {len(articles)} recent articles suggests downward pressure."
            else:
                reasoning = f"Mixed sentiment ({avg_sentiment:.2f}) with {len(articles)} recent articles suggests sideways movement."
            
            # Extract key factors and topics from articles
            key_factors = []
            all_topics = []
            for article in articles[:5]:  # Top 5 articles
                if article.get("summary"):
                    summary = article["summary"][:150] + "..." if len(article["summary"]) > 150 else article["summary"]
                    key_factors.append(summary)
                if article.get("key_topics"):
                    all_topics.extend(article["key_topics"])
            
            # Generate a comprehensive summary paragraph based on actual analyzed content
            summary_parts = []
            
            # Start with overall assessment
            if avg_sentiment > 0.2:
                summary_parts.append(f"Recent news for {ticker} shows positive momentum")
            elif avg_sentiment < -0.2:
                summary_parts.append(f"Recent news for {ticker} indicates negative pressure")
            else:
                summary_parts.append(f"Recent news for {ticker} shows mixed signals")
            
            summary_parts.append(f" with {len(articles)} articles analyzed over the past week.")
            
            # Add detailed analysis from actual article summaries
            if articles:
                summary_parts.append(" Key developments include: ")
                
                # Group articles by sentiment for better organization
                positive_articles = [a for a in articles if a.get("sentiment_score", 0) > 0.1]
                negative_articles = [a for a in articles if a.get("sentiment_score", 0) < -0.1]
                neutral_articles = [a for a in articles if -0.1 <= a.get("sentiment_score", 0) <= 0.1]
                
                # Add positive developments
                if positive_articles:
                    summary_parts.append("On the positive side, ")
                    positive_summaries = []
                    for article in positive_articles[:3]:  # Top 3 positive
                        if article.get("summary"):
                            # Clean up the summary and make it more readable
                            clean_summary = article["summary"].replace("The article", "").replace("This article", "").strip()
                            if clean_summary:
                                positive_summaries.append(clean_summary)
                    if positive_summaries:
                        summary_parts.append("; ".join(positive_summaries) + ". ")
                
                # Add negative developments
                if negative_articles:
                    summary_parts.append("On the negative side, ")
                    negative_summaries = []
                    for article in negative_articles[:3]:  # Top 3 negative
                        if article.get("summary"):
                            clean_summary = article["summary"].replace("The article", "").replace("This article", "").strip()
                            if clean_summary:
                                negative_summaries.append(clean_summary)
                    if negative_summaries:
                        summary_parts.append("; ".join(negative_summaries) + ". ")
                
                # Add neutral/regulatory developments
                if neutral_articles:
                    summary_parts.append("Additionally, ")
                    neutral_summaries = []
                    for article in neutral_articles[:2]:  # Top 2 neutral
                        if article.get("summary"):
                            clean_summary = article["summary"].replace("The article", "").replace("This article", "").strip()
                            if clean_summary:
                                neutral_summaries.append(clean_summary)
                    if neutral_summaries:
                        summary_parts.append("; ".join(neutral_summaries) + ". ")
            
            # Add key topics if available
            if all_topics:
                unique_topics = list(set(all_topics))[:5]  # Top 5 unique topics
                topics_text = ", ".join(unique_topics)
                summary_parts.append(f" Major topics covered include: {topics_text}.")
            
            # Add sentiment context and recommendation reasoning
            if abs(avg_sentiment) > 0.3:
                if avg_sentiment > 0:
                    summary_parts.append(" The overall sentiment is positive, suggesting potential upside for the stock.")
                else:
                    summary_parts.append(" The overall sentiment is negative, suggesting potential downside for the stock.")
            else:
                summary_parts.append(" The sentiment is relatively neutral, suggesting sideways movement in the near term.")
            
            # Add market impact assessment
            if len(articles) > 10:
                summary_parts.append(f" With {len(articles)} recent articles analyzed, this represents significant news volume that could impact trading activity.")
            
            summary = "".join(summary_parts)
            
            # Create article citations
            article_citations = []
            for i, article in enumerate(articles[:5], 1):  # Top 5 articles
                title = article.get("title", "Unknown title")
                url = article.get("url", "")
                citation = f"{i}. {title}"
                if url:
                    citation += f" ({url})"
                article_citations.append(citation)
            
            return {
                "ticker": ticker.upper(),
                "recommendation": recommendation,
                "confidence": confidence_level,
                "confidence_score": round(confidence_score, 2),
                "reasoning": reasoning,
                "time_frame": time_frame,
                "risk_level": "HIGH" if confidence_score < 0.4 else "MEDIUM" if confidence_score < 0.7 else "LOW",
                "summary": summary,
                "article_citations": article_citations
            }
            
        except Exception as e:
            logger.error(f"Error generating stock recommendation: {e}")
            return {
                "ticker": ticker.upper(),
                "recommendation": "HOLD",
                "confidence": "LOW",
                "confidence_score": 0.0,
                "reasoning": f"Error in analysis: {str(e)}",
                "time_frame": time_frame,
                "risk_level": "HIGH",
                "summary": "Error occurred during analysis.",
                "article_citations": []
            }

    async def generate_multi_timeframe_analysis(self, ticker: str, articles: List[dict]) -> dict:
        """
        Generate comprehensive analysis for multiple time frames.
        """
        try:
            # Generate recommendations for each time frame
            short_term = await self.generate_stock_recommendation(ticker, articles, "SHORT_TERM")
            medium_term = await self.generate_stock_recommendation(ticker, articles, "MEDIUM_TERM")
            long_term = await self.generate_stock_recommendation(ticker, articles, "LONG_TERM")
            
            # Calculate overall recommendation
            recommendations = [short_term["recommendation"], medium_term["recommendation"], long_term["recommendation"]]
            buy_count = recommendations.count("BUY")
            sell_count = recommendations.count("SELL")
            
            if buy_count >= 2:
                overall_recommendation = "BUY"
            elif sell_count >= 2:
                overall_recommendation = "SELL"
            else:
                overall_recommendation = "HOLD"
            
            # Calculate overall confidence
            avg_confidence = (short_term["confidence_score"] + medium_term["confidence_score"] + long_term["confidence_score"]) / 3
            
            return {
                "ticker": ticker.upper(),
                "overall_recommendation": overall_recommendation,
                "overall_confidence": round(avg_confidence, 2),
                "timeframe_analysis": {
                    "short_term": short_term,
                    "medium_term": medium_term,
                    "long_term": long_term
                },
                "summary": f"Multi-timeframe analysis based on {len(articles)} articles with {overall_recommendation} recommendation.",
                "articles_analyzed": len(articles)
            }
            
        except Exception as e:
            logger.error(f"Error generating multi-timeframe analysis: {e}")
            return {
                "ticker": ticker.upper(),
                "overall_recommendation": "HOLD",
                "overall_confidence": 0.0,
                "timeframe_analysis": {},
                "summary": f"Analysis failed due to technical error: {str(e)}",
                "articles_analyzed": 0
            }


news_service = NewsService() 