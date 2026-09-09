"""API tests with the scraper and OpenAI stubbed out. No network needed."""
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas import Article
from app.services import analyzer as analyzer_module
from app.services.cache import Cache
from app.services.sentiment import SentimentAnalyzer, normalize


class FakeScraper:
    def __init__(self, *_, **__): ...
    async def __aenter__(self): return self
    async def __aexit__(self, *_): ...
    async def scrape(self, ticker, max_articles=10):
        return [
            Article(ticker=ticker, title=f"{ticker} beats earnings", url="https://finance.yahoo.com/m/1.html",
                    source="Yahoo", source_domain="finance.yahoo.com", published_at=datetime.now(), content="x" * 500)
        ]


class FakeSentiment(SentimentAnalyzer):
    def __init__(self): self.calls = 0
    async def analyze(self, article, subject):
        self.calls += 1
        return normalize({"sentiment_score": 65, "confidence": 8, "key_themes": ["earnings"], "summary": "good"})


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(analyzer_module, "NewsScraper", FakeScraper)
    cache = Cache(url="")  # disabled
    app.state.analyzer = analyzer_module.StockAnalyzer(cache, FakeSentiment())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_analyze_post(client):
    r = await client.post("/api/stock/analyze", json={"ticker": "aapl", "max_articles": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert body["recommendation"] == "BUY"
    assert body["articles_analyzed"] == 1
    assert body["articles"][0]["sentiment_score"] == 65
    assert body["sector"] is None
    assert body["error"] is None


async def test_analyze_get_and_batch(client):
    r = await client.get("/api/stock/analyze/msft")
    assert r.status_code == 200 and r.json()["ticker"] == "MSFT"

    r = await client.post("/api/stock/analyze/batch", json={"tickers": ["AAPL", "TSLA"]})
    assert r.status_code == 200
    assert r.json()["successful"] == 2


async def test_validation(client):
    r = await client.post("/api/stock/analyze", json={"ticker": "", "max_articles": 999})
    assert r.status_code == 422
