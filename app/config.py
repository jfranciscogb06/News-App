from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings can be overridden with environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    app_name: str = "Stock News Analyzer"
    app_version: str = "2.0.0"
    debug: bool = False
    log_level: str = "INFO"

    # OpenAI
    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    openai_max_tokens: int = 600
    openai_temperature: float = 0.2
    openai_timeout: int = 30
    max_concurrent_analyses: int = 8

    # Redis cache. Leave REDIS_URL empty to run without caching.
    redis_url: str = "redis://localhost:6379/0"
    cache_ttl: int = 1800  # seconds

    # Scraping
    finviz_url: str = "https://finviz.com/quote.ashx"
    request_timeout: int = 15
    max_concurrent_requests: int = 5
    content_min_length: int = 200
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    # Domains we will fetch full article text from. Everything else listed on
    # Finviz is skipped (paywalls, video, unknown sites).
    allowed_sources: list[str] = ["finance.yahoo.com", "www.investors.com"]

    # Sector analysis (opt-in per request): representative ticker whose news
    # feed is used as a proxy for the sector.
    sector_mapping: dict[str, str] = {
        "AAPL": "Technology", "MSFT": "Technology", "GOOGL": "Technology", "GOOG": "Technology",
        "META": "Technology", "NVDA": "Technology", "AMD": "Technology", "INTC": "Technology",
        "ORCL": "Technology", "CRM": "Technology", "ADBE": "Technology", "NFLX": "Technology",
        "PYPL": "Technology", "UBER": "Technology", "SHOP": "Technology",
        "AMZN": "Consumer Discretionary", "TSLA": "Consumer Discretionary", "HD": "Consumer Discretionary",
        "MCD": "Consumer Discretionary", "NKE": "Consumer Discretionary", "SBUX": "Consumer Discretionary",
        "DIS": "Consumer Discretionary",
        "JNJ": "Healthcare", "PFE": "Healthcare", "UNH": "Healthcare", "ABBV": "Healthcare",
        "LLY": "Healthcare", "MRK": "Healthcare",
        "JPM": "Financial", "BAC": "Financial", "WFC": "Financial", "GS": "Financial",
        "MS": "Financial", "C": "Financial", "V": "Financial", "MA": "Financial",
        "XOM": "Energy", "CVX": "Energy", "COP": "Energy", "OXY": "Energy",
        "BA": "Industrial", "CAT": "Industrial", "GE": "Industrial", "HON": "Industrial",
        "UPS": "Industrial", "LMT": "Industrial",
        "PG": "Consumer Staples", "KO": "Consumer Staples", "PEP": "Consumer Staples",
        "WMT": "Consumer Staples", "COST": "Consumer Staples",
        "T": "Communication Services", "VZ": "Communication Services", "TMUS": "Communication Services",
        "AMT": "Real Estate", "PLD": "Real Estate", "O": "Real Estate",
        "LIN": "Materials", "FCX": "Materials", "NEM": "Materials",
        "NEE": "Utilities", "DUK": "Utilities", "SO": "Utilities",
    }
    sector_tickers: dict[str, str] = {
        "Technology": "AAPL", "Consumer Discretionary": "AMZN", "Healthcare": "JNJ",
        "Financial": "JPM", "Energy": "XOM", "Industrial": "BA", "Consumer Staples": "PG",
        "Communication Services": "T", "Real Estate": "AMT", "Materials": "LIN", "Utilities": "NEE",
    }


settings = Settings()
