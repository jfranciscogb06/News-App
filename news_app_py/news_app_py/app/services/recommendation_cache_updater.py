import asyncio
import os
import json
from redis.asyncio import Redis
from loguru import logger
from app.utils.helpers import TOP_TICKERS
from app.services.news import news_service
from app.core.config import settings

REDIS_URL = os.getenv("REDIS_URL", getattr(settings, "REDIS_URL", "redis://localhost:6379/0"))

async def update_recommendations_periodically():
    redis = Redis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
    while True:
        logger.info("Starting batch update of recommendations for top tickers...")
        for ticker in TOP_TICKERS:
            try:
                # Generate recommendation (short term by default)
                # You may want to adjust the time_frame and top_count as needed
                articles = await news_service.fetch_and_analyze_top_news(ticker, top_count=15, time_period="week")
                articles_data = [
                    {
                        "title": a.title,
                        "url": a.url,
                        "source": a.source,
                        "published_at": str(a.published_at),
                        "summary": a.summary,
                        "sentiment": a.sentiment,
                        "sentiment_score": a.sentiment_score,
                        "confidence_score": getattr(a, "confidence_score", None),
                        "impact_score": getattr(a, "impact_score", None)
                    }
                    for a in articles
                ]
                recommendation = await news_service.generate_stock_recommendation(
                    ticker, articles_data, time_frame="SHORT_TERM"
                )
                key = f"recommendation:{ticker.upper()}"
                await redis.set(key, json.dumps(recommendation), ex=1800)  # 30 min TTL
                logger.info(f"Updated recommendation cache for {ticker}")
            except Exception as e:
                logger.error(f"Failed to update recommendation for {ticker}: {e}")
        logger.info("Batch update complete. Sleeping for 30 minutes...")
        await asyncio.sleep(1800)  # 30 minutes 