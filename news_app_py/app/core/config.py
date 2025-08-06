import os
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseSettings):
    """Application settings for Stock News Analyzer"""
    
    # Application
    app_name: str = "Stock News Analyzer"
    app_version: str = "1.0.0"
    debug: bool = Field(default=False, env="DEBUG")
    
    # Database
    database_url: str = Field(
        default="postgresql+asyncpg://user:password@localhost/stock_news_db",
        env="DATABASE_URL"
    )
    
    # OpenAI API
    openai_api_key: str = Field(..., env="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4", env="OPENAI_MODEL")
    openai_max_tokens: int = Field(default=1000, env="OPENAI_MAX_TOKENS")
    openai_temperature: float = Field(default=0.3, env="OPENAI_TEMPERATURE")
    
    # Scraping Configuration
    scraping_delay: float = Field(default=2.0, env="SCRAPING_DELAY")
    max_articles_per_stock: int = Field(default=15, env="MAX_ARTICLES_PER_STOCK")
    content_min_length: int = Field(default=200, env="CONTENT_MIN_LENGTH")
    
    # Reliable News Sources
    reliable_sources: List[str] = [
        "finance.yahoo.com",
        "www.barrons.com", 
        "www.investors.com"
    ]
    
    # Blocked/Unreliable Sources
    blocked_sources: List[str] = [
        "marketwatch.com",
        "wsj.com",
        "qz.com",
        "youtube.com"
    ]
    
    # Finviz Configuration
    finviz_base_url: str = "https://finviz.com/quote.ashx"
    finviz_news_selector: str = "table.fullview-news-outer tr.cursor-pointer a.tab-link-news"
    
    # Sentiment Analysis
    sentiment_score_range: tuple = (-100, 100)
    confidence_range: tuple = (1, 10)
    
    # Redis Cache
    redis_url: str = Field(default="redis://localhost:6379/0", env="REDIS_URL")
    cache_ttl: int = Field(default=1800, env="CACHE_TTL")  # 30 minutes
    
    # Logging
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    log_file: str = Field(default="logs/stock_news_analyzer.log", env="LOG_FILE")
    
    # Rate Limiting
    openai_rate_limit: int = Field(default=3500, env="OPENAI_RATE_LIMIT")  # requests per minute
    scraping_rate_limit: int = Field(default=60, env="SCRAPING_RATE_LIMIT")  # requests per minute
    
    # Analysis Configuration
    analysis_timeout: int = Field(default=30, env="ANALYSIS_TIMEOUT")  # seconds
    max_concurrent_analyses: int = Field(default=5, env="MAX_CONCURRENT_ANALYSES")
    
    # User Agent for Scraping
    user_agent: str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    
    # Headers for Scraping
    scraping_headers: dict = {
        "Accept": "text/html,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }
    
    # Sector Mapping for Major Stocks
    sector_mapping: dict = {
        # Technology
        "AAPL": "Technology",
        "MSFT": "Technology", 
        "GOOGL": "Technology",
        "GOOG": "Technology",
        "META": "Technology",
        "NVDA": "Technology",
        "TSLA": "Technology",
        "AMD": "Technology",
        "INTC": "Technology",
        "ORCL": "Technology",
        "CRM": "Technology",
        "ADBE": "Technology",
        "NFLX": "Technology",
        "PYPL": "Technology",
        "UBER": "Technology",
        "LYFT": "Technology",
        "ZM": "Technology",
        "SPOT": "Technology",
        "SQ": "Technology",
        "SHOP": "Technology",
        
        # Consumer Discretionary
        "AMZN": "Consumer Discretionary",
        "TSLA": "Consumer Discretionary",  # Also in Tech
        "HD": "Consumer Discretionary",
        "MCD": "Consumer Discretionary",
        "NKE": "Consumer Discretionary",
        "SBUX": "Consumer Discretionary",
        "DIS": "Consumer Discretionary",
        "CMCSA": "Consumer Discretionary",
        "MAR": "Consumer Discretionary",
        "HLT": "Consumer Discretionary",
        
        # Healthcare
        "JNJ": "Healthcare",
        "PFE": "Healthcare",
        "UNH": "Healthcare",
        "ABBV": "Healthcare",
        "TMO": "Healthcare",
        "DHR": "Healthcare",
        "ABT": "Healthcare",
        "LLY": "Healthcare",
        "MRK": "Healthcare",
        "BMY": "Healthcare",
        
        # Financial
        "JPM": "Financial",
        "BAC": "Financial",
        "WFC": "Financial",
        "GS": "Financial",
        "MS": "Financial",
        "C": "Financial",
        "BLK": "Financial",
        "AXP": "Financial",
        "V": "Financial",
        "MA": "Financial",
        
        # Energy
        "XOM": "Energy",
        "CVX": "Energy",
        "COP": "Energy",
        "EOG": "Energy",
        "SLB": "Energy",
        "KMI": "Energy",
        "PSX": "Energy",
        "VLO": "Energy",
        "MPC": "Energy",
        "OXY": "Energy",
        
        # Industrial
        "BA": "Industrial",
        "CAT": "Industrial",
        "GE": "Industrial",
        "MMM": "Industrial",
        "HON": "Industrial",
        "UPS": "Industrial",
        "FDX": "Industrial",
        "RTX": "Industrial",
        "LMT": "Industrial",
        "NOC": "Industrial",
        
        # Consumer Staples
        "PG": "Consumer Staples",
        "KO": "Consumer Staples",
        "PEP": "Consumer Staples",
        "WMT": "Consumer Staples",
        "COST": "Consumer Staples",
        "PM": "Consumer Staples",
        "MO": "Consumer Staples",
        "CL": "Consumer Staples",
        "KMB": "Consumer Staples",
        "GIS": "Consumer Staples",
        
        # Communication Services
        "T": "Communication Services",
        "VZ": "Communication Services",
        "TMUS": "Communication Services",
        "CHTR": "Communication Services",
        "CMCSA": "Communication Services",  # Also in Consumer Discretionary
        "NFLX": "Communication Services",   # Also in Technology
        "DIS": "Communication Services",    # Also in Consumer Discretionary
        "META": "Communication Services",   # Also in Technology
        
        # Real Estate
        "AMT": "Real Estate",
        "PLD": "Real Estate",
        "CCI": "Real Estate",
        "EQIX": "Real Estate",
        "DLR": "Real Estate",
        "WELL": "Real Estate",
        "PSA": "Real Estate",
        "O": "Real Estate",
        "SPG": "Real Estate",
        "AVB": "Real Estate",
        
        # Materials
        "LIN": "Materials",
        "APD": "Materials",
        "FCX": "Materials",
        "NEM": "Materials",
        "DOW": "Materials",
        "DD": "Materials",
        "ECL": "Materials",
        "BLL": "Materials",
        "ALB": "Materials",
        "NUE": "Materials",
        
        # Utilities
        "NEE": "Utilities",
        "DUK": "Utilities",
        "SO": "Utilities",
        "D": "Utilities",
        "AEP": "Utilities",
        "XEL": "Utilities",
        "SRE": "Utilities",
        "WEC": "Utilities",
        "DTE": "Utilities",
        "ED": "Utilities"
    }
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Allow extra fields from .env

# Global settings instance
settings = Settings() 