import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas import AnalyzeRequest, AnalyzeResponse, BatchAnalyzeRequest, BatchAnalyzeResponse
from app.services.analyzer import StockAnalyzer
from app.services.cache import Cache

logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache = Cache()
    await cache.connect()
    app.state.analyzer = StockAnalyzer(cache)
    logger.info("%s v%s ready (model=%s)", settings.app_name, settings.app_version, settings.openai_model)
    yield
    await cache.close()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Scrapes recent news for a stock ticker (via Finviz -> Yahoo Finance / IBD), "
        "scores each article with OpenAI, and aggregates into a BUY / SELL / HOLD view. "
        "Not financial advice."
    ),
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def analyzer(request: Request) -> StockAnalyzer:
    return request.app.state.analyzer


@app.get("/", include_in_schema=False)
async def root():
    return {"name": settings.app_name, "version": settings.app_version, "docs": "/docs"}


@app.get("/health")
async def health(request: Request):
    return {"status": "ok", "version": settings.app_version, "cache": analyzer(request).cache.enabled}


@app.post("/api/stock/analyze", response_model=AnalyzeResponse)
async def analyze(body: AnalyzeRequest, request: Request):
    return await analyzer(request).analyze(body.ticker, body.max_articles, body.include_sector, body.force_refresh)


@app.get("/api/stock/analyze/{ticker}", response_model=AnalyzeResponse)
async def analyze_get(
    ticker: str,
    request: Request,
    max_articles: int = Query(default=10, ge=1, le=30),
    include_sector: bool = False,
    force_refresh: bool = False,
):
    return await analyzer(request).analyze(ticker, max_articles, include_sector, force_refresh)


@app.post("/api/stock/analyze/batch", response_model=BatchAnalyzeResponse)
async def analyze_batch(body: BatchAnalyzeRequest, request: Request):
    return await analyzer(request).analyze_batch(body.tickers, body.max_articles_per_stock, body.include_sector)


@app.get("/api/stock/sources")
async def sources():
    return {"allowed_sources": settings.allowed_sources, "discovery": settings.finviz_url}


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"error": "Internal Server Error", "message": str(exc)})
