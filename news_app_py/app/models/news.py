from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, Text, ARRAY
from sqlalchemy.sql import func
import enum

from app.db.base import Base


class Sentiment(enum.Enum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    NEUTRAL = "NEUTRAL"


class SourceCredibility(enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class News(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    url = Column(String, nullable=False)
    source = Column(String)
    published_at = Column(DateTime, nullable=False)
    content = Column(Text)
    summary = Column(Text)
    sentiment = Column(Enum(Sentiment))
    sentiment_score = Column(Float)
    confidence_score = Column(Float)
    source_credibility = Column(Enum(SourceCredibility))
    impact_score = Column(Float)
    key_entities = Column(ARRAY(String))
    risk_factors = Column(ARRAY(String))
    ticker = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Removed partitioning for compatibility
    # __table_args__ = (
    #     {"postgresql_partition_by": "RANGE (published_at)"},
    # ) 