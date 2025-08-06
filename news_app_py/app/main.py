from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from contextlib import asynccontextmanager

from app.core.config import settings
from app.api.endpoints import stock_analysis

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(settings.log_file),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    logger.info("Starting Stock News Analyzer API")
    logger.info(f"Environment: {'Development' if settings.debug else 'Production'}")
    logger.info(f"Reliable sources: {len(settings.reliable_sources)}")
    logger.info(f"Blocked sources: {len(settings.blocked_sources)}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Stock News Analyzer API")

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
    🚀 **Stock News Analyzer API**
    
    A comprehensive tool that combines stock news scraping with AI sentiment analysis 
    to provide actionable insights on stock performance predictions.
    
    ## Features
    
    - **Real-time News Scraping**: Extracts financial news from reliable sources (Yahoo Finance, Barron's, IBD)
    - **AI Sentiment Analysis**: Uses ChatGPT API for sophisticated sentiment analysis
    - **Smart Recommendations**: Generates BUY/SELL/HOLD recommendations with confidence levels
    - **Batch Processing**: Analyze multiple stocks concurrently
    - **Caching**: Redis-based caching for improved performance
    - **Source Reliability**: Focuses on verified, high-quality news sources
    
    ## Quick Start
    
    1. **Analyze a single stock**: `POST /api/stock/analyze`
    2. **Analyze multiple stocks**: `POST /api/stock/analyze/batch`
    3. **Get analysis via GET**: `GET /api/stock/analyze/{ticker}`
    4. **Check health**: `GET /api/stock/health`
    
    ## Reliable Sources
    
    - ✅ Yahoo Finance (finance.yahoo.com)
    - ✅ Barron's (www.barrons.com)
    - ✅ Investor's Business Daily (www.investors.com)
    
    ## Blocked Sources
    
    - ❌ MarketWatch (paywall)
    - ❌ Wall Street Journal (paywall)
    - ❌ QZ.com (access denied)
    - ❌ YouTube (video content)
    
    ## Example Usage
    
    ```bash
    # Analyze Apple stock
    curl -X POST "http://localhost:8000/api/stock/analyze" \\
         -H "Content-Type: application/json" \\
         -d '{"ticker": "AAPL", "max_articles": 15}'
    
    # Analyze multiple stocks
    curl -X POST "http://localhost:8000/api/stock/analyze/batch" \\
         -H "Content-Type: application/json" \\
         -d '{"tickers": ["AAPL", "TSLA", "MSFT"], "max_articles_per_stock": 10}'
    ```
    """,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(
    stock_analysis.router,
    prefix="/api/stock",
    tags=["Stock Analysis"]
)

# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Welcome to Stock News Analyzer API",
        "version": settings.app_version,
        "docs": "/docs",
        "health": "/api/stock/health",
        "reliable_sources": settings.reliable_sources,
        "features": [
            "Real-time news scraping from reliable sources",
            "AI-powered sentiment analysis using ChatGPT",
            "Smart stock recommendations (BUY/SELL/HOLD)",
            "Batch processing for multiple stocks",
            "Redis caching for improved performance",
            "Source reliability filtering"
        ]
    }

# Health check endpoint
@app.get("/health")
async def health_check():
    """Global health check endpoint"""
    return {
        "status": "healthy",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": "development" if settings.debug else "production"
    }

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTP Error",
            "message": exc.detail,
            "status_code": exc.status_code
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred",
            "status_code": 500
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
        log_level=settings.log_level.lower()
    ) 