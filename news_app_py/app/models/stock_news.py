from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, JSON, ForeignKey, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from datetime import datetime
from typing import Optional, Dict, Any

Base = declarative_base()

class StockArticle(Base):
    """Model for storing scraped stock news articles"""
    __tablename__ = "stock_articles"
    
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    url = Column(String(1000), nullable=False, unique=True)
    source = Column(String(100), nullable=False)
    published_at = Column(DateTime, nullable=False)
    scraped_at = Column(DateTime, default=func.now())
    
    # Content
    content = Column(Text, nullable=False)
    content_length = Column(Integer, nullable=False)
    content_quality_score = Column(Float, default=0.0)
    
    # Source metadata
    source_domain = Column(String(100), nullable=False)
    source_reliability_score = Column(Float, default=0.0)
    
    # Processing status
    is_processed = Column(Boolean, default=False)
    processing_error = Column(String(500), nullable=True)
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_ticker_published', 'ticker', 'published_at'),
        Index('idx_source_domain', 'source_domain'),
        Index('idx_scraped_at', 'scraped_at'),
    )

class SentimentAnalysis(Base):
    """Model for storing AI sentiment analysis results"""
    __tablename__ = "sentiment_analyses"
    
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("stock_articles.id"), nullable=False)
    ticker = Column(String(10), nullable=False, index=True)
    
    # Sentiment scores
    sentiment_score = Column(Float, nullable=False)  # -100 to +100
    confidence_level = Column(Integer, nullable=False)  # 1-10
    impact_prediction = Column(String(20), nullable=False)  # positive/negative/neutral
    
    # Analysis details
    key_themes = Column(JSON, nullable=True)  # List of themes
    time_horizon = Column(String(20), nullable=False)  # immediate/short-term/long-term
    risk_factors = Column(JSON, nullable=True)  # List of risk factors
    summary = Column(Text, nullable=False)
    
    # Analysis metadata
    analyzed_at = Column(DateTime, default=func.now())
    analysis_model = Column(String(50), nullable=False, default="gpt-4")
    analysis_duration = Column(Float, nullable=True)  # seconds
    tokens_used = Column(Integer, nullable=True)
    
    # Indexes
    __table_args__ = (
        Index('idx_ticker_sentiment', 'ticker', 'sentiment_score'),
        Index('idx_analyzed_at', 'analyzed_at'),
    )

class StockRecommendation(Base):
    """Model for storing aggregated stock recommendations"""
    __tablename__ = "stock_recommendations"
    
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(10), nullable=False, index=True)
    analysis_date = Column(DateTime, nullable=False)
    
    # Aggregated metrics
    articles_analyzed = Column(Integer, nullable=False)
    overall_sentiment = Column(Float, nullable=False)
    recommendation = Column(String(10), nullable=False)  # BUY/SELL/HOLD
    confidence_level = Column(String(20), nullable=False)  # LOW/MEDIUM/HIGH
    
    # Detailed analysis
    key_themes = Column(JSON, nullable=True)  # Dict of theme:weight
    risk_factors = Column(JSON, nullable=True)  # List of risk factors
    time_horizon = Column(String(20), nullable=False)
    price_target = Column(String(50), nullable=True)
    summary = Column(Text, nullable=False)
    
    # Scoring weights
    recency_weight = Column(Float, default=1.0)
    source_weight = Column(Float, default=1.0)
    content_weight = Column(Float, default=1.0)
    
    # Metadata
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # Indexes
    __table_args__ = (
        Index('idx_ticker_analysis_date', 'ticker', 'analysis_date'),
        Index('idx_recommendation', 'recommendation'),
    )

class ScrapingSession(Base):
    """Model for tracking scraping sessions and performance"""
    __tablename__ = "scraping_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), nullable=False, unique=True)
    ticker = Column(String(10), nullable=False, index=True)
    
    # Session metrics
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    
    # Performance metrics
    articles_found = Column(Integer, default=0)
    articles_scraped = Column(Integer, default=0)
    articles_analyzed = Column(Integer, default=0)
    success_rate = Column(Float, default=0.0)
    
    # Error tracking
    errors_encountered = Column(Integer, default=0)
    error_details = Column(JSON, nullable=True)
    
    # Status
    status = Column(String(20), default="running")  # running/completed/failed
    
    # Indexes
    __table_args__ = (
        Index('idx_session_ticker', 'session_id', 'ticker'),
        Index('idx_start_time', 'start_time'),
    )

class SourceReliability(Base):
    """Model for tracking source reliability scores"""
    __tablename__ = "source_reliability"
    
    id = Column(Integer, primary_key=True, index=True)
    source_domain = Column(String(100), nullable=False, unique=True)
    
    # Reliability metrics
    success_rate = Column(Float, default=0.0)
    avg_content_length = Column(Float, default=0.0)
    avg_content_quality = Column(Float, default=0.0)
    reliability_score = Column(Float, default=0.0)
    
    # Usage statistics
    total_articles_scraped = Column(Integer, default=0)
    last_scraped_at = Column(DateTime, nullable=True)
    
    # Source metadata
    source_name = Column(String(100), nullable=True)
    source_category = Column(String(50), nullable=True)  # financial/general/technical
    is_blocked = Column(Boolean, default=False)
    blocking_reason = Column(String(200), nullable=True)
    
    # Indexes
    __table_args__ = (
        Index('idx_reliability_score', 'reliability_score'),
        Index('idx_source_category', 'source_category'),
    ) 