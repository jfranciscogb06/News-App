"""Orchestrates scrape -> sentiment -> recommendation, with caching."""
import asyncio
import logging
from datetime import datetime

from app.config import settings
from app.schemas import (
    AnalyzeResponse,
    ArticleRef,
    BatchAnalyzeResponse,
    SectorAnalysis,
)
from app.services import recommendation
from app.services.cache import Cache
from app.services.scraper import NewsScraper
from app.services.sentiment import SentimentAnalyzer

logger = logging.getLogger(__name__)


class StockAnalyzer:
    def __init__(self, cache: Cache, sentiment: SentimentAnalyzer | None = None) -> None:
        self.cache = cache
        self.sentiment = sentiment or SentimentAnalyzer()

    async def analyze(
        self, ticker: str, max_articles: int = 10, include_sector: bool = False, force_refresh: bool = False
    ) -> AnalyzeResponse:
        ticker = ticker.upper()
        started = datetime.now()
        cache_key = f"analysis:v2:{ticker}:{max_articles}:{int(include_sector)}"

        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                resp = AnalyzeResponse.model_validate_json(cached)
                resp.cache_hit = True
                return resp

        try:
            async with NewsScraper() as scraper:
                articles = await scraper.scrape(ticker, max_articles)
            if not articles:
                return self._empty(ticker, started, "No articles from allowed sources were found on Finviz")

            sentiments = await self.sentiment.analyze_many(articles, ticker)
            agg = recommendation.aggregate(ticker, articles, sentiments)

            sector = None
            if include_sector:
                sector = await self.analyze_sector(ticker, max(3, max_articles // 2))

            combined_sentiment = combined_rec = None
            if sector:
                combined_sentiment = round(agg.overall_sentiment * 0.7 + sector.overall_sentiment * 0.3, 1)
                combined_rec = recommendation.recommend(combined_sentiment)

            resp = AnalyzeResponse(
                ticker=ticker,
                analysis_date=datetime.now(),
                articles_analyzed=agg.articles_analyzed,
                overall_sentiment=agg.overall_sentiment,
                recommendation=agg.recommendation,
                confidence_level=agg.confidence_level,
                key_themes=agg.key_themes,
                risk_factors=agg.risk_factors,
                time_horizon=agg.time_horizon,
                summary=agg.summary,
                articles=[
                    ArticleRef(
                        title=a.title, url=a.url, source=a.source, published_at=a.published_at,
                        sentiment_score=s.sentiment_score, summary=s.summary,
                    )
                    for a, s in zip(articles, sentiments) if s is not None
                ],
                sector=sector,
                combined_sentiment=combined_sentiment,
                combined_recommendation=combined_rec,
                processing_time_seconds=round((datetime.now() - started).total_seconds(), 2),
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Analysis failed for %s", ticker)
            return self._empty(ticker, started, f"Analysis error: {e}")

        if agg.articles_analyzed:
            await self.cache.set(cache_key, resp.model_dump_json())
        return resp

    async def analyze_batch(self, tickers: list[str], max_articles: int, include_sector: bool) -> BatchAnalyzeResponse:
        started = datetime.now()
        results = await asyncio.gather(*(self.analyze(t, max_articles, include_sector) for t in tickers))
        ok = [r for r in results if r.error is None]
        return BatchAnalyzeResponse(
            total_tickers=len(tickers),
            successful=len(ok),
            failed_tickers=[r.ticker for r in results if r.error is not None],
            results=list(results),
            total_processing_time=round((datetime.now() - started).total_seconds(), 2),
        )

    async def analyze_sector(self, ticker: str, max_articles: int) -> SectorAnalysis | None:
        """Sentiment of the sector, approximated by news of a representative ticker."""
        sector = settings.sector_mapping.get(ticker.upper())
        if not sector:
            return None
        proxy = settings.sector_tickers[sector]
        async with NewsScraper() as scraper:
            articles = await scraper.scrape(proxy, max_articles)
        if not articles:
            return None
        sentiments = await self.sentiment.analyze_many(articles, f"the {sector} sector")
        agg = recommendation.aggregate(sector, articles, sentiments)
        if not agg.articles_analyzed:
            return None
        return SectorAnalysis(
            sector=sector,
            articles_analyzed=agg.articles_analyzed,
            overall_sentiment=agg.overall_sentiment,
            key_themes=agg.key_themes,
            risk_factors=agg.risk_factors,
            summary=agg.summary,
        )

    @staticmethod
    def _empty(ticker: str, started: datetime, error: str) -> AnalyzeResponse:
        agg = recommendation.empty(ticker)
        return AnalyzeResponse(
            ticker=ticker,
            analysis_date=datetime.now(),
            articles_analyzed=0,
            overall_sentiment=0.0,
            recommendation=agg.recommendation,
            confidence_level=agg.confidence_level,
            key_themes={},
            risk_factors=agg.risk_factors,
            time_horizon=agg.time_horizon,
            summary=agg.summary,
            processing_time_seconds=round((datetime.now() - started).total_seconds(), 2),
            error=error,
        )
