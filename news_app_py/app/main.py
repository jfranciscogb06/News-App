from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.api.endpoints import news
from app.services.news import news_service
from app.db.base import Base
from app.db.session import engine


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"{request.method} {request.url}")
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Request failed: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

# Include routers
app.include_router(news.router, prefix=f"{settings.API_V1_STR}/news", tags=["news"])

# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    logger.info("Starting up application...")
    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down application...")
    # No cleanup needed for news_service anymore

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy"} 