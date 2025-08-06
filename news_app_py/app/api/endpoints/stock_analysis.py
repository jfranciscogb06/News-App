from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Optional
import logging

from app.services.stock_analyzer import StockAnalyzerService
from app.schemas.stock_news import (
    StockAnalysisRequest,
    BatchAnalysisRequest,
    StockRecommendationResponse,
    BatchAnalysisResponse,
    ScrapingStatusResponse,
    SourceReliabilityResponse,
    ErrorResponse
)

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/analyze", response_model=StockRecommendationResponse)
async def analyze_stock(request: StockAnalysisRequest):
    """
    Analyze a single stock's news sentiment and generate recommendation
    
    - **ticker**: Stock ticker symbol (e.g., AAPL, TSLA)
    - **max_articles**: Maximum number of articles to analyze (default: 15)
    - **include_historical**: Include historical analysis (default: false)
    - **force_refresh**: Force fresh scraping (default: false)
    """
    try:
        async with StockAnalyzerService() as analyzer:
            result = await analyzer.analyze_stock(
                ticker=request.ticker.upper(),
                max_articles=request.max_articles,
                force_refresh=request.force_refresh
            )
            return result
    except Exception as e:
        logger.error(f"Error analyzing stock {request.ticker}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@router.post("/analyze/batch", response_model=BatchAnalysisResponse)
async def analyze_multiple_stocks(request: BatchAnalysisRequest):
    """
    Analyze multiple stocks concurrently
    
    - **tickers**: List of stock ticker symbols
    - **max_articles_per_stock**: Maximum articles per stock (default: 10)
    - **parallel_processing**: Process stocks in parallel (default: true)
    """
    try:
        # Validate tickers
        if len(request.tickers) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 tickers allowed per batch")
        
        # Convert tickers to uppercase
        tickers = [ticker.upper() for ticker in request.tickers]
        
        async with StockAnalyzerService() as analyzer:
            result = await analyzer.analyze_multiple_stocks(
                tickers=tickers,
                max_articles_per_stock=request.max_articles_per_stock,
                parallel_processing=request.parallel_processing
            )
            return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in batch analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Batch analysis failed: {str(e)}")

@router.get("/analyze/{ticker}", response_model=StockRecommendationResponse)
async def get_stock_analysis(
    ticker: str,
    max_articles: int = Query(default=15, ge=1, le=50),
    force_refresh: bool = Query(default=False)
):
    """
    Get stock analysis (GET version for easier testing)
    
    - **ticker**: Stock ticker symbol
    - **max_articles**: Maximum articles to analyze
    - **force_refresh**: Force fresh scraping
    """
    try:
        async with StockAnalyzerService() as analyzer:
            result = await analyzer.analyze_stock(
                ticker=ticker.upper(),
                max_articles=max_articles,
                force_refresh=force_refresh
            )
            return result
    except Exception as e:
        logger.error(f"Error getting analysis for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@router.get("/status/scraping/{session_id}", response_model=ScrapingStatusResponse)
async def get_scraping_status(session_id: str):
    """
    Get status of a scraping session
    
    - **session_id**: Scraping session ID
    """
    try:
        async with StockAnalyzerService() as analyzer:
            status = await analyzer.get_scraping_status(session_id)
            if not status:
                raise HTTPException(status_code=404, detail="Session not found")
            return status
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting scraping status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")

@router.get("/stats/sources", response_model=dict)
async def get_source_reliability_stats():
    """
    Get statistics about source reliability and performance
    """
    try:
        async with StockAnalyzerService() as analyzer:
            stats = await analyzer.get_source_reliability_stats()
            return stats
    except Exception as e:
        logger.error(f"Error getting source stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")

@router.get("/stats/analysis", response_model=dict)
async def get_analysis_stats():
    """
    Get overall analysis statistics and performance metrics
    """
    try:
        async with StockAnalyzerService() as analyzer:
            stats = await analyzer.get_analysis_stats()
            return stats
    except Exception as e:
        logger.error(f"Error getting analysis stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")

@router.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    return {
        "status": "healthy",
        "service": "Stock News Analyzer",
        "version": "1.0.0"
    }

@router.get("/sources/reliable")
async def get_reliable_sources():
    """
    Get list of reliable news sources
    """
    from app.core.config import settings
    return {
        "reliable_sources": settings.reliable_sources,
        "blocked_sources": settings.blocked_sources,
        "total_reliable": len(settings.reliable_sources)
    }

@router.get("/sources/blocked")
async def get_blocked_sources():
    """
    Get list of blocked/unreliable news sources
    """
    from app.core.config import settings
    return {
        "blocked_sources": settings.blocked_sources,
        "total_blocked": len(settings.blocked_sources)
    }

@router.get("/demo/{ticker}", response_model=StockRecommendationResponse)
async def demo_stock_analysis(ticker: str):
    """
    Demo endpoint showing how analysis would work with mock data
    """
    from datetime import datetime
    import random
    
    # Mock data to simulate successful analysis
    mock_sentiments = {
        "AAPL": 68.5,
        "TSLA": -45.2,
        "MSFT": 82.1,
        "GOOGL": 55.7,
        "AMZN": 23.4
    }
    
    mock_themes = {
        "AAPL": {"earnings": 0.4, "iPhone": 0.3, "AI": 0.2, "revenue": 0.1},
        "TSLA": {"production": 0.5, "earnings": 0.3, "supply_chain": 0.2},
        "MSFT": {"cloud": 0.4, "AI": 0.4, "enterprise": 0.2},
        "GOOGL": {"AI": 0.5, "search": 0.3, "cloud": 0.2},
        "AMZN": {"ecommerce": 0.4, "cloud": 0.3, "logistics": 0.3}
    }
    
    sentiment = mock_sentiments.get(ticker.upper(), random.uniform(-50, 50))
    themes = mock_themes.get(ticker.upper(), {"general": 1.0})
    
    # Determine recommendation based on sentiment
    if sentiment > 30:
        recommendation = "BUY"
        confidence = "HIGH" if sentiment > 60 else "MEDIUM"
    elif sentiment < -30:
        recommendation = "SELL"
        confidence = "HIGH" if sentiment < -60 else "MEDIUM"
    else:
        recommendation = "HOLD"
        confidence = "LOW"
    
    return {
        "ticker": ticker.upper(),
        "analysis_date": datetime.now().isoformat(),
        "articles_analyzed": 15,
        "overall_sentiment": sentiment,
        "recommendation": recommendation,
        "confidence_level": confidence,
        "key_themes": themes,
        "risk_factors": [
            "Market volatility",
            "Economic conditions",
            "Competition risks"
        ],
        "time_horizon": "short-term",
        "price_target": f"Based on {sentiment:.1f} sentiment score",
        "summary": f"Analysis of 15 articles shows {sentiment:.1f} sentiment for {ticker.upper()}. Recommendation: {recommendation}.",
        "processing_time_seconds": 2.5,
        "cache_hit": False
    } 