from pydantic import BaseModel, Field, HttpUrl
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum

class RecommendationType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"

class ConfidenceLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"

class TimeHorizon(str, Enum):
    IMMEDIATE = "immediate"
    SHORT_TERM = "short-term"
    LONG_TERM = "long-term"

class ImpactPrediction(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"

# Request Schemas
class StockAnalysisRequest(BaseModel):
    """Request schema for stock analysis"""
    ticker: str = Field(..., min_length=1, max_length=10, description="Stock ticker symbol")
    max_articles: Optional[int] = Field(default=15, ge=1, le=50, description="Maximum articles to analyze")
    include_historical: Optional[bool] = Field(default=False, description="Include historical analysis")
    force_refresh: Optional[bool] = Field(default=False, description="Force fresh scraping")

class BatchAnalysisRequest(BaseModel):
    """Request schema for batch stock analysis"""
    tickers: List[str] = Field(..., min_items=1, max_items=20, description="List of stock tickers")
    max_articles_per_stock: Optional[int] = Field(default=10, ge=1, le=30)
    parallel_processing: Optional[bool] = Field(default=True)

# Response Schemas
class ArticleAnalysis(BaseModel):
    """Schema for individual article analysis"""
    article_url: HttpUrl
    title: str
    source: str
    published_at: datetime
    sentiment_score: float = Field(..., ge=-100, le=100)
    themes: List[str]
    impact: ImpactPrediction
    confidence: int = Field(..., ge=1, le=10)
    time_horizon: TimeHorizon
    risk_factors: List[str]
    summary: str
    
    class Config:
        from_attributes = True

class StockRecommendationResponse(BaseModel):
    """Schema for stock recommendation response"""
    ticker: str
    analysis_date: datetime
    articles_analyzed: int
    overall_sentiment: float = Field(..., ge=-100, le=100)
    recommendation: RecommendationType
    confidence_level: ConfidenceLevel
    key_themes: Dict[str, float]
    risk_factors: List[str]
    time_horizon: TimeHorizon
    price_target: Optional[str]
    summary: str
    
    # Article citations
    analyzed_articles: List[Dict[str, str]] = Field(default_factory=list, description="List of analyzed articles with title and URL")
    
    # Sector Analysis
    sector: Optional[str] = Field(default=None, description="Stock's sector")
    sector_sentiment: Optional[float] = Field(default=None, ge=-100, le=100, description="Sector sentiment score")
    sector_themes: Optional[Dict[str, float]] = Field(default_factory=dict, description="Key sector themes")
    sector_risk_factors: Optional[List[str]] = Field(default_factory=list, description="Sector risk factors")
    sector_summary: Optional[str] = Field(default=None, description="Sector analysis summary")
    sector_articles_analyzed: Optional[int] = Field(default=None, description="Number of sector articles analyzed")
    
    # Combined Analysis
    combined_sentiment: Optional[float] = Field(default=None, ge=-100, le=100, description="Combined stock and sector sentiment")
    combined_recommendation: Optional[RecommendationType] = Field(default=None, description="Combined recommendation")
    
    # Performance metrics
    processing_time_seconds: float
    cache_hit: bool = False
    
    class Config:
        from_attributes = True

class BatchAnalysisResponse(BaseModel):
    """Schema for batch analysis response"""
    analysis_id: str
    total_tickers: int
    successful_analyses: int
    failed_tickers: List[str]
    recommendations: List[StockRecommendationResponse]
    total_processing_time: float
    started_at: datetime
    completed_at: datetime

class ScrapingStatusResponse(BaseModel):
    """Schema for scraping status response"""
    session_id: str
    ticker: str
    status: str
    articles_found: int
    articles_scraped: int
    articles_analyzed: int
    success_rate: float
    errors_encountered: int
    start_time: datetime
    end_time: Optional[datetime]
    duration_seconds: Optional[float]

class SourceReliabilityResponse(BaseModel):
    """Schema for source reliability response"""
    source_domain: str
    source_name: Optional[str]
    success_rate: float
    avg_content_length: float
    avg_content_quality: float
    reliability_score: float
    total_articles_scraped: int
    last_scraped_at: Optional[datetime]
    is_blocked: bool
    blocking_reason: Optional[str]

# Internal Schemas
class ScrapedArticle(BaseModel):
    """Schema for scraped article data"""
    ticker: str
    title: str
    url: str
    source: str
    source_domain: str
    published_at: datetime
    content: str
    content_length: int
    content_quality_score: float = 0.0

class SentimentAnalysisResult(BaseModel):
    """Schema for sentiment analysis result"""
    sentiment_score: float
    confidence_level: int
    impact_prediction: ImpactPrediction
    key_themes: List[str]
    time_horizon: TimeHorizon
    risk_factors: List[str]
    summary: str
    analysis_duration: float
    tokens_used: Optional[int]

class AggregatedAnalysis(BaseModel):
    """Schema for aggregated analysis data"""
    ticker: str
    articles_analyzed: int
    overall_sentiment: float
    recommendation: RecommendationType
    confidence_level: ConfidenceLevel
    key_themes: Dict[str, float]
    risk_factors: List[str]
    time_horizon: TimeHorizon
    price_target: Optional[str]
    summary: str
    recency_weight: float
    source_weight: float
    content_weight: float

# Error Schemas
class ErrorResponse(BaseModel):
    """Schema for error responses"""
    error: str
    message: str
    details: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.now)

class ValidationErrorResponse(BaseModel):
    """Schema for validation error responses"""
    error: str = "Validation Error"
    message: str
    field_errors: Dict[str, List[str]]
    timestamp: datetime = Field(default_factory=datetime.now) 