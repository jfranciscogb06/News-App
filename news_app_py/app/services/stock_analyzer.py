import asyncio
import logging
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
import redis.asyncio as redis

from app.core.config import settings
from app.services.playwright_scraper import PlaywrightScraperService as NewsScraperService, ScrapingResult
from app.services.sentiment_analyzer import SentimentAnalyzerService
from app.services.recommendation_engine import RecommendationEngine
from app.services.sector_analyzer import SectorAnalyzerService
from app.schemas.stock_news import (
    StockRecommendationResponse,
    BatchAnalysisResponse,
    ScrapingStatusResponse
)

logger = logging.getLogger(__name__)

class StockAnalyzerService:
    """Main service for stock news analysis and recommendation generation"""
    
    def __init__(self):
        self.scraper = NewsScraperService()
        self.sentiment_analyzer = SentimentAnalyzerService()
        self.recommendation_engine = RecommendationEngine()
        self.sector_analyzer = SectorAnalyzerService()
        self.redis_client: Optional[redis.Redis] = None
        
    async def __aenter__(self):
        """Async context manager entry"""
        self.redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        if self.redis_client:
            await self.redis_client.close()
    
    async def analyze_stock(
        self, 
        ticker: str, 
        max_articles: int = 15,
        force_refresh: bool = False
    ) -> StockRecommendationResponse:
        """
        Complete stock analysis pipeline
        
        Args:
            ticker: Stock ticker symbol
            max_articles: Maximum articles to analyze
            force_refresh: Force fresh scraping (ignore cache)
            
        Returns:
            StockRecommendationResponse with analysis results
        """
        start_time = datetime.now()
        
        try:
            # Check cache first
            cache_key = f"stock_analysis:{ticker.upper()}"
            if not force_refresh:
                cached_result = await self._get_cached_analysis(cache_key)
                if cached_result:
                    logger.info(f"Returning cached analysis for {ticker}")
                    return cached_result
            
            logger.info(f"Starting analysis for {ticker}")
            
            # Step 1: Scrape news articles
            async with self.scraper as scraper:
                scraping_result = await scraper.scrape_stock_news(ticker, max_articles)
            
            if not scraping_result.success or not scraping_result.articles:
                logger.warning(f"No articles found for {ticker}")
                return await self._create_empty_response(ticker, start_time)
            
            logger.info(f"Scraped {len(scraping_result.articles)} articles for {ticker}")
            
            # Step 2: Analyze sentiment
            articles_data = [article.dict() for article in scraping_result.articles]
            sentiment_results = await self.sentiment_analyzer.analyze_multiple_articles(
                articles_data, ticker
            )
            
            logger.info(f"Analyzed sentiment for {len(sentiment_results)} articles")
            
            # Step 3: Generate recommendation
            recommendation = await self.recommendation_engine.generate_stock_recommendation(
                ticker, sentiment_results, articles_data
            )
            
            # Step 4: Analyze sector sentiment
            sector = self.sector_analyzer.get_sector_for_ticker(ticker)
            sector_analysis = None
            if sector:
                logger.info(f"Analyzing sector sentiment for {sector}")
                sector_analysis = await self.sector_analyzer.analyze_sector_sentiment(sector, max_articles // 2)
            
            # Step 5: Create response with article citations and sector analysis
            analyzed_articles = [
                {
                    "title": article.title,
                    "url": article.url,
                    "source": article.source
                }
                for article in scraping_result.articles
            ]
            
            # Calculate combined sentiment and recommendation
            combined_sentiment = recommendation.overall_sentiment
            combined_recommendation = recommendation.recommendation
            
            if sector_analysis:
                # Weight: 70% stock sentiment, 30% sector sentiment
                combined_sentiment = (recommendation.overall_sentiment * 0.7) + (sector_analysis.overall_sentiment * 0.3)
                
                # Adjust recommendation based on combined sentiment
                if combined_sentiment > 30:
                    combined_recommendation = "BUY"
                elif combined_sentiment < -30:
                    combined_recommendation = "SELL"
                else:
                    combined_recommendation = "HOLD"
            
            response = StockRecommendationResponse(
                ticker=ticker,
                analysis_date=datetime.now(),
                articles_analyzed=recommendation.articles_analyzed,
                overall_sentiment=recommendation.overall_sentiment,
                recommendation=recommendation.recommendation,
                confidence_level=recommendation.confidence_level,
                key_themes=recommendation.key_themes,
                risk_factors=recommendation.risk_factors,
                time_horizon=recommendation.time_horizon,
                price_target=recommendation.price_target,
                summary=recommendation.summary,
                analyzed_articles=analyzed_articles,
                sector=sector,
                sector_sentiment=sector_analysis.overall_sentiment if sector_analysis else None,
                sector_themes=sector_analysis.key_themes if sector_analysis else {},
                sector_risk_factors=sector_analysis.risk_factors if sector_analysis else [],
                sector_summary=sector_analysis.summary if sector_analysis else None,
                sector_articles_analyzed=sector_analysis.articles_analyzed if sector_analysis else None,
                combined_sentiment=combined_sentiment,
                combined_recommendation=combined_recommendation,
                processing_time_seconds=(datetime.now() - start_time).total_seconds(),
                cache_hit=False
            )
            
            # Cache the result
            await self._cache_analysis(cache_key, response)
            
            logger.info(f"Analysis complete for {ticker}: {recommendation.recommendation.value}")
            return response
            
        except Exception as e:
            logger.error(f"Error analyzing {ticker}: {e}")
            return await self._create_error_response(ticker, str(e), start_time)
    
    async def analyze_multiple_stocks(
        self, 
        tickers: List[str], 
        max_articles_per_stock: int = 10,
        parallel_processing: bool = True
    ) -> BatchAnalysisResponse:
        """
        Analyze multiple stocks concurrently
        
        Args:
            tickers: List of stock tickers
            max_articles_per_stock: Maximum articles per stock
            parallel_processing: Whether to process stocks in parallel
            
        Returns:
            BatchAnalysisResponse with results
        """
        batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        start_time = datetime.now()
        
        try:
            if parallel_processing:
                # Process stocks concurrently
                tasks = [
                    self.analyze_stock(ticker, max_articles_per_stock)
                    for ticker in tickers
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)
            else:
                # Process stocks sequentially
                results = []
                for ticker in tickers:
                    try:
                        result = await self.analyze_stock(ticker, max_articles_per_stock)
                        results.append(result)
                    except Exception as e:
                        results.append(e)
            
            # Process results
            successful_analyses = []
            failed_tickers = []
            
            for i, result in enumerate(results):
                if isinstance(result, StockRecommendationResponse):
                    successful_analyses.append(result)
                else:
                    failed_tickers.append(tickers[i])
                    logger.error(f"Analysis failed for {tickers[i]}: {result}")
            
            total_time = (datetime.now() - start_time).total_seconds()
            
            return BatchAnalysisResponse(
                analysis_id=batch_id,
                total_tickers=len(tickers),
                successful_analyses=len(successful_analyses),
                failed_tickers=failed_tickers,
                recommendations=successful_analyses,
                total_processing_time=total_time,
                started_at=start_time,
                completed_at=datetime.now()
            )
            
        except Exception as e:
            logger.error(f"Batch analysis failed: {e}")
            return BatchAnalysisResponse(
                analysis_id=batch_id,
                total_tickers=len(tickers),
                successful_analyses=0,
                failed_tickers=tickers,
                recommendations=[],
                total_processing_time=(datetime.now() - start_time).total_seconds(),
                started_at=start_time,
                completed_at=datetime.now()
            )
    
    async def get_scraping_status(self, session_id: str) -> Optional[ScrapingStatusResponse]:
        """Get status of a scraping session"""
        try:
            if not self.redis_client:
                return None
            
            status_data = await self.redis_client.get(f"scraping_status:{session_id}")
            if status_data:
                return ScrapingStatusResponse(**json.loads(status_data))
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting scraping status: {e}")
            return None
    
    async def get_source_reliability_stats(self) -> Dict[str, Any]:
        """Get statistics about source reliability"""
        try:
            if not self.redis_client:
                return {}
            
            # Get cached source stats
            stats_data = await self.redis_client.get("source_reliability_stats")
            if stats_data:
                return json.loads(stats_data)
            
            # Return default stats
            return {
                "total_sources": len(settings.reliable_sources),
                "reliable_sources": settings.reliable_sources,
                "blocked_sources": settings.blocked_sources,
                "success_rates": {
                    "finance.yahoo.com": 0.95,
                    "www.barrons.com": 0.90,
                    "www.investors.com": 0.85
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting source reliability stats: {e}")
            return {}
    
    async def _get_cached_analysis(self, cache_key: str) -> Optional[StockRecommendationResponse]:
        """Get cached analysis result"""
        try:
            if not self.redis_client:
                return None
            
            cached_data = await self.redis_client.get(cache_key)
            if cached_data:
                data = json.loads(cached_data)
                # Convert back to response object
                response = StockRecommendationResponse(**data)
                response.cache_hit = True
                return response
            
            return None
            
        except Exception as e:
            logger.warning(f"Error getting cached analysis: {e}")
            return None
    
    async def _cache_analysis(self, cache_key: str, response: StockRecommendationResponse):
        """Cache analysis result"""
        try:
            if not self.redis_client:
                return
            
            # Convert to dict for caching
            data = response.dict()
            data['cache_hit'] = False  # Don't cache the cache_hit flag
            
            await self.redis_client.setex(
                cache_key,
                settings.cache_ttl,
                json.dumps(data)
            )
            
        except Exception as e:
            logger.warning(f"Error caching analysis: {e}")
    
    async def _create_empty_response(self, ticker: str, start_time: datetime) -> StockRecommendationResponse:
        """Create empty response when no articles found"""
        return StockRecommendationResponse(
            ticker=ticker,
            analysis_date=datetime.now(),
            articles_analyzed=0,
            overall_sentiment=0.0,
            recommendation="HOLD",
            confidence_level="LOW",
            key_themes={},
            risk_factors=["No recent news articles found"],
            time_horizon="short-term",
            price_target=None,
            summary=f"No recent news articles found for {ticker}.",
            analyzed_articles=[],
            sector=None,
            sector_sentiment=None,
            sector_themes={},
            sector_risk_factors=[],
            sector_summary=None,
            sector_articles_analyzed=None,
            combined_sentiment=0.0,
            combined_recommendation="HOLD",
            processing_time_seconds=(datetime.now() - start_time).total_seconds(),
            cache_hit=False
        )
    
    async def _create_error_response(self, ticker: str, error: str, start_time: datetime) -> StockRecommendationResponse:
        """Create error response when analysis fails"""
        return StockRecommendationResponse(
            ticker=ticker,
            analysis_date=datetime.now(),
            articles_analyzed=0,
            analyzed_articles=[],
            overall_sentiment=0.0,
            recommendation="HOLD",
            confidence_level="LOW",
            key_themes={},
            risk_factors=[f"Analysis error: {error}"],
            time_horizon="short-term",
            price_target=None,
            summary=f"Analysis failed for {ticker}: {error}",
            sector=None,
            sector_sentiment=None,
            sector_themes={},
            sector_risk_factors=[],
            sector_summary=None,
            sector_articles_analyzed=None,
            combined_sentiment=0.0,
            combined_recommendation="HOLD",
            processing_time_seconds=(datetime.now() - start_time).total_seconds(),
            cache_hit=False
        )
    
    async def get_analysis_stats(self) -> Dict[str, Any]:
        """Get overall analysis statistics"""
        try:
            # Get stats from all services
            sentiment_stats = await self.sentiment_analyzer.get_analysis_stats()
            recommendation_stats = await self.recommendation_engine.get_recommendation_stats()
            source_stats = await self.get_source_reliability_stats()
            
            return {
                "sentiment_analysis": sentiment_stats,
                "recommendations": recommendation_stats,
                "source_reliability": source_stats,
                "cache_stats": {
                    "cache_enabled": bool(self.redis_client),
                    "cache_ttl": settings.cache_ttl
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting analysis stats: {e}")
            return {"error": str(e)} 