from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, HttpUrl, Field
from enum import Enum


class SentimentType(str, Enum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    NEUTRAL = "NEUTRAL"


class ConfidenceLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class RecommendationType(str, Enum):
    STRONG_BUY = "STRONG_BUY"
    BUY = "BUY"
    HOLD = "HOLD"
    SELL = "SELL"
    STRONG_SELL = "STRONG_SELL"


class TimeFrame(str, Enum):
    SHORT_TERM = "SHORT_TERM"  # 1-7 days
    MEDIUM_TERM = "MEDIUM_TERM"  # 1-4 weeks
    LONG_TERM = "LONG_TERM"  # 1-6 months


class SourceCredibility(str, Enum):
    HIGH = "HIGH"  # WSJ, Bloomberg, Reuters
    MEDIUM = "MEDIUM"  # CNBC, MarketWatch
    LOW = "LOW"  # Reddit, Twitter, blogs


class NewsBase(BaseModel):
    title: str
    url: HttpUrl
    source: Optional[str] = None
    published_at: datetime
    ticker: str = Field(..., min_length=1, max_length=10)


class NewsCreate(NewsBase):
    content: Optional[str] = None
    summary: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = Field(None, ge=-1, le=1)
    confidence_score: Optional[float] = Field(None, ge=0, le=1)
    source_credibility: Optional[SourceCredibility] = None
    impact_score: Optional[float] = Field(None, ge=0, le=10)
    key_entities: Optional[List[str]] = None
    risk_factors: Optional[List[str]] = None


class NewsUpdate(BaseModel):
    summary: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = Field(None, ge=-1, le=1)
    confidence_score: Optional[float] = Field(None, ge=0, le=1)
    source_credibility: Optional[SourceCredibility] = None
    impact_score: Optional[float] = Field(None, ge=0, le=10)
    key_entities: Optional[List[str]] = None
    risk_factors: Optional[List[str]] = None


class NewsInDB(NewsBase):
    id: int
    content: Optional[str] = None
    summary: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = None
    confidence_score: Optional[float] = None
    source_credibility: Optional[SourceCredibility] = None
    impact_score: Optional[float] = None
    key_entities: Optional[List[str]] = None
    risk_factors: Optional[List[str]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NewsSummary(BaseModel):
    ticker: str
    period: str
    total_articles: int
    sentiment_breakdown: Dict[str, int]
    average_sentiment_score: float
    latest_articles: List[NewsInDB]


class NewsSentiment(BaseModel):
    ticker: str
    period: str
    average_sentiment: float
    total_articles: int
    positive_articles: int
    negative_articles: int
    neutral_articles: int


class StockRecommendation(BaseModel):
    ticker: str
    recommendation: RecommendationType
    confidence: ConfidenceLevel
    confidence_score: float
    reasoning: str
    time_frame: TimeFrame
    risk_level: str
    summary: str
    article_citations: List[str]


class MultiTimeframeAnalysis(BaseModel):
    ticker: str
    short_term: StockRecommendation
    medium_term: StockRecommendation
    long_term: StockRecommendation
    overall_recommendation: RecommendationType
    overall_confidence: ConfidenceLevel
    market_context: Dict[str, Any]
    disclaimer: str


class EnhancedNewsAnalysis(BaseModel):
    ticker: str
    count: int
    stock_summary: Dict[str, Any]
    articles: List[Dict[str, Any]]
    recommendation: StockRecommendation
    market_insights: Dict[str, Any]
    risk_assessment: Dict[str, Any] 