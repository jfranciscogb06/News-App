from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import JSONResponse

from app.db.session import get_db
from app.services.news import news_service
from app.schemas.news import (
    NewsInDB, NewsSummary, NewsSentiment, StockRecommendation, 
    MultiTimeframeAnalysis, EnhancedNewsAnalysis, TimeFrame
)

router = APIRouter()


@router.get("/{ticker}", response_model=List[NewsInDB])
async def get_news(
    ticker: str,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    """
    Get latest news articles for a stock ticker.
    If cached news is available and less than 30 minutes old, return it.
    Otherwise, fetch fresh news, cache it, and return the result.
    """
    try:
        return await news_service.get_news_for_ticker(db, ticker, limit, offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/summary", response_model=NewsSummary)
async def get_news_summary(
    ticker: str,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a summary of news articles for a stock ticker over a specified period.
    Includes sentiment analysis and latest articles.
    """
    try:
        return await news_service.get_news_summary(db, ticker, days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/sentiment", response_model=NewsSentiment)
async def get_sentiment_analysis(
    ticker: str,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db)
):
    """
    Get sentiment analysis for news articles about a stock ticker over a specified period.
    """
    try:
        return await news_service.get_sentiment_analysis(db, ticker, days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analyze/{ticker}")
def analyze_ticker_news(ticker: str):
    """
    Fetch and return the latest news headlines for a given ticker from Finviz.
    """
    try:
        news = news_service.fetch_finviz_news(ticker)
        if not news:
            return JSONResponse(status_code=404, content={"detail": f"No news found for ticker {ticker}"})
        return {"ticker": ticker.upper(), "news": news}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@router.get("/{ticker}/raw")
async def get_raw_news(ticker: str, limit: int = Query(20, ge=1, le=50)):
    """
    Get raw Finviz headlines for a stock ticker without sentiment analysis.
    This endpoint is much faster as it skips the analysis step.
    """
    try:
        raw_news = news_service.fetch_finviz_news(ticker)
        # Limit results
        raw_news = raw_news[:limit]
        return {
            "ticker": ticker.upper(),
            "count": len(raw_news),
            "articles": raw_news
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/recommendation", response_model=StockRecommendation)
async def get_stock_recommendation(
    ticker: str,
    time_frame: TimeFrame = TimeFrame.SHORT_TERM,
    top_count: int = Query(25, ge=10, le=50)
):
    """
    Get a buy/sell recommendation for a stock based on news analysis.
    Includes confidence scores, reasoning, and risk assessment.
    """
    try:
        # Fetch and analyze news
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count)
        
        # Convert to dict format
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment,
                "sentiment_score": a.sentiment_score,
                "confidence_score": a.confidence_score,
                "impact_score": a.impact_score
            }
            for a in news
        ]
        
        # Generate recommendation
        recommendation = await news_service.generate_stock_recommendation(ticker, articles, time_frame)
        return recommendation
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/multi-timeframe", response_model=MultiTimeframeAnalysis)
async def get_multi_timeframe_analysis(
    ticker: str,
    top_count: int = Query(20, ge=10, le=50)
):
    """
    Get comprehensive buy/sell recommendations for different time frames (short, medium, long term).
    Provides overall recommendation and confidence levels.
    """
    try:
        # Fetch and analyze news
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count)
        
        # Convert to dict format
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment,
                "sentiment_score": a.sentiment_score,
                "confidence_score": a.confidence_score,
                "impact_score": a.impact_score
            }
            for a in news
        ]
        
        # Generate multi-timeframe analysis
        analysis = await news_service.generate_multi_timeframe_analysis(ticker, articles)
        return analysis
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/enhanced", response_model=EnhancedNewsAnalysis)
async def get_enhanced_news_analysis(
    ticker: str,
    top_count: int = Query(15, ge=5, le=30)
):
    """
    Get comprehensive news analysis with buy/sell recommendation, market insights, and risk assessment.
    This is the most complete endpoint for investment decision support.
    """
    try:
        # Fetch and analyze news
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count)
        
        # Convert to dict format
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment,
                "sentiment_score": a.sentiment_score,
                "confidence_score": a.confidence_score,
                "impact_score": a.impact_score,
                "key_entities": a.key_entities,
                "risk_factors": a.risk_factors
            }
            for a in news
        ]
        
        # Generate stock summary
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles)
        
        # Generate recommendation
        recommendation = await news_service.generate_stock_recommendation(ticker, articles, TimeFrame.SHORT_TERM)
        
        # Calculate market insights
        avg_sentiment = sum(article.get("sentiment_score", 0) for article in articles) / len(articles) if articles else 0
        avg_confidence = sum(article.get("confidence_score", 0) for article in articles) / len(articles) if articles else 0
        avg_impact = sum(article.get("impact_score", 0) for article in articles) / len(articles) if articles else 0
        
        market_insights = {
            "average_sentiment": avg_sentiment,
            "average_confidence": avg_confidence,
            "average_impact": avg_impact,
            "total_articles": len(articles),
            "positive_articles": len([a for a in articles if a.get("sentiment_score", 0) > 0.1]),
            "negative_articles": len([a for a in articles if a.get("sentiment_score", 0) < -0.1]),
            "neutral_articles": len([a for a in articles if -0.1 <= a.get("sentiment_score", 0) <= 0.1]),
            "high_impact_articles": len([a for a in articles if a.get("impact_score", 0) > 7.0])
        }
        
        # Risk assessment
        all_risk_factors = []
        for article in articles:
            all_risk_factors.extend(article.get("risk_factors", []))
        
        risk_assessment = {
            "total_risk_factors": len(all_risk_factors),
            "unique_risk_factors": list(set(all_risk_factors)),
            "risk_level": "HIGH" if len(all_risk_factors) > 10 else "MEDIUM" if len(all_risk_factors) > 5 else "LOW",
            "high_risk_articles": len([a for a in articles if len(a.get("risk_factors", [])) > 2])
        }
        
        return EnhancedNewsAnalysis(
            ticker=ticker.upper(),
            count=len(articles),
            stock_summary=stock_summary,
            articles=articles,
            recommendation=recommendation,
            market_insights=market_insights,
            risk_assessment=risk_assessment
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/top")
async def get_top_news(ticker: str, top_count: int = Query(10, ge=5, le=20)):
    """
    Get top N most impactful news articles for a stock ticker.
    This uses a two-stage process:
    1. Get raw headlines from Finviz
    2. Use GPT to select top N most impactful articles
    3. Analyze only those selected articles (full content, but not returned)
    4. Return only summary, sentiment, etc. for each article
    5. Add a stock_summary at the top (summary and sentiment for all articles)
    """
    try:
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count)
        # Prepare article dicts without full content
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment),
                "sentiment_score": a.sentiment_score
            }
            for a in news
        ]
        # Generate stock summary from all article summaries and sentiments
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles)
        return {
            "ticker": ticker.upper(),
            "count": len(articles),
            "stock_summary": stock_summary,
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/top/week")
async def get_top_news_week(ticker: str, top_count: int = Query(10, ge=5, le=20)):
    """
    Get top N most impactful news articles for a stock ticker for the next week.
    """
    try:
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count, time_period="week")
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment),
                "sentiment_score": a.sentiment_score
            }
            for a in news
        ]
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles, time_period="week")
        return {
            "ticker": ticker.upper(),
            "count": len(articles),
            "stock_summary": stock_summary,
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/top/two_weeks")
async def get_top_news_two_weeks(ticker: str, top_count: int = Query(10, ge=5, le=20)):
    """
    Get top N most impactful news articles for a stock ticker for the next two weeks.
    """
    try:
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count, time_period="two_weeks")
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment),
                "sentiment_score": a.sentiment_score
            }
            for a in news
        ]
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles, time_period="two_weeks")
        return {
            "ticker": ticker.upper(),
            "count": len(articles),
            "stock_summary": stock_summary,
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/top/month")
async def get_top_news_month(ticker: str, top_count: int = Query(10, ge=5, le=20)):
    """
    Get top N most impactful news articles for a stock ticker for the next month.
    """
    try:
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count, time_period="month")
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment),
                "sentiment_score": a.sentiment_score
            }
            for a in news
        ]
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles, time_period="month")
        return {
            "ticker": ticker.upper(),
            "count": len(articles),
            "stock_summary": stock_summary,
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/top/three_months")
async def get_top_news_three_months(ticker: str, top_count: int = Query(10, ge=5, le=20)):
    """
    Get top N most impactful news articles for a stock ticker for the next three months.
    """
    try:
        news = await news_service.fetch_and_analyze_top_news(ticker, top_count, time_period="three_months")
        articles = [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "published_at": a.published_at,
                "summary": a.summary,
                "sentiment": a.sentiment.value if hasattr(a.sentiment, 'value') else str(a.sentiment),
                "sentiment_score": a.sentiment_score
            }
            for a in news
        ]
        stock_summary = await news_service.summarize_stock_from_articles(ticker, articles, time_period="three_months")
        return {
            "ticker": ticker.upper(),
            "count": len(articles),
            "stock_summary": stock_summary,
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) 