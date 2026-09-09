from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Recommendation(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class Confidence(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class TimeHorizon(str, Enum):
    IMMEDIATE = "immediate"
    SHORT_TERM = "short-term"
    LONG_TERM = "long-term"


# ---- requests -------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10, examples=["AAPL"])
    max_articles: int = Field(default=10, ge=1, le=30)
    include_sector: bool = Field(default=False, description="Also analyze sector-wide news (doubles scraping and API cost)")
    force_refresh: bool = Field(default=False, description="Ignore the cache")


class BatchAnalyzeRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=1, max_length=20)
    max_articles_per_stock: int = Field(default=8, ge=1, le=30)
    include_sector: bool = False


# ---- internal --------------------------------------------------------------

class Article(BaseModel):
    """An article whose full text we managed to fetch."""
    ticker: str
    title: str
    url: str
    source: str
    source_domain: str
    published_at: datetime
    content: str


class ArticleSentiment(BaseModel):
    """What the model said about one article."""
    sentiment_score: float = Field(ge=-100, le=100)
    confidence: int = Field(ge=1, le=10)
    relevance: int = Field(default=10, ge=0, le=10, description="How much the article is actually about the subject")
    key_themes: list[str] = []
    time_horizon: TimeHorizon = TimeHorizon.SHORT_TERM
    risk_factors: list[str] = []
    summary: str = ""
    tokens_used: int | None = None


class AggregatedAnalysis(BaseModel):
    articles_analyzed: int
    overall_sentiment: float
    recommendation: Recommendation
    confidence_level: Confidence
    key_themes: dict[str, float]
    risk_factors: list[str]
    time_horizon: TimeHorizon
    summary: str


# ---- responses -------------------------------------------------------------

class ArticleRef(BaseModel):
    title: str
    url: str
    source: str
    published_at: datetime
    sentiment_score: float
    relevance: int
    summary: str


class SectorAnalysis(BaseModel):
    sector: str
    articles_analyzed: int
    overall_sentiment: float
    key_themes: dict[str, float]
    risk_factors: list[str]
    summary: str


class AnalyzeResponse(BaseModel):
    ticker: str
    analysis_date: datetime
    articles_analyzed: int
    overall_sentiment: float = Field(ge=-100, le=100)
    recommendation: Recommendation
    confidence_level: Confidence
    key_themes: dict[str, float]
    risk_factors: list[str]
    time_horizon: TimeHorizon
    summary: str
    articles: list[ArticleRef] = []
    sector: SectorAnalysis | None = None
    combined_sentiment: float | None = Field(default=None, description="70% stock / 30% sector, only when sector analysis ran")
    combined_recommendation: Recommendation | None = None
    processing_time_seconds: float
    cache_hit: bool = False
    error: str | None = None


class BatchAnalyzeResponse(BaseModel):
    total_tickers: int
    successful: int
    failed_tickers: list[str]
    results: list[AnalyzeResponse]
    total_processing_time: float
