# Stock News Analyzer

Give it a ticker, get back a sentiment score and a BUY / SELL / HOLD read based on the last few days of news.

```
Finviz (headlines) -> Yahoo Finance / IBD (article text) -> OpenAI (score each article) -> weighted aggregate
```

Not financial advice. It's a news-sentiment toy, not a trading model.

## Run it

Requires Python 3.11+ and an OpenAI API key. Redis is optional (caching).

```bash
git clone https://github.com/jfranciscogb06/News-App.git
cd News-App
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # then put your OPENAI_API_KEY in .env
uvicorn app.main:app --reload
```

Try it:

```bash
curl "localhost:8000/api/stock/analyze/AAPL?max_articles=8"
```

Interactive docs at http://localhost:8000/docs.

## API

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/stock/analyze/{ticker}` | Analyze one ticker. Query params: `max_articles` (1-30), `include_sector`, `force_refresh` |
| `POST` | `/api/stock/analyze` | Same, as JSON body: `{"ticker": "AAPL", "max_articles": 8}` |
| `POST` | `/api/stock/analyze/batch` | `{"tickers": ["AAPL", "MSFT"], "max_articles_per_stock": 6}` (max 20) |
| `GET` | `/health` | Liveness + whether the cache is connected |
| `GET` | `/api/stock/sources` | Which domains we fetch articles from |

Example response (trimmed):

```json
{
  "ticker": "AAPL",
  "articles_analyzed": 6,
  "overall_sentiment": 29.1,
  "recommendation": "HOLD",
  "confidence_level": "MEDIUM",
  "key_themes": {"product_launch": 0.83, "ai": 0.5, "pricing": 0.33},
  "risk_factors": ["market expectations", "competition", "high pricing"],
  "time_horizon": "short-term",
  "summary": "6 recent articles show positive sentiment for AAPL (+29). ...",
  "articles": [
    {"title": "Apple to Unveil First Foldable Phone", "source": "Bloomberg", "url": "...", "sentiment_score": 60, "relevance": 10, "summary": "..."}
  ],
  "processing_time_seconds": 6.5,
  "cache_hit": false
}
```

`include_sector=true` also scrapes a representative ticker for the stock's sector (e.g. JPM for Financials) and returns a `sector` block plus a `combined_sentiment` (70% stock, 30% sector). It roughly doubles the time and API cost, so it's off by default.

## How it works

1. **Discover** — `app/services/scraper.py` loads the Finviz quote page, which lists ~100 recent headlines with outbound links, source and timestamp.
2. **Fetch** — only links to `finance.yahoo.com` and `www.investors.com` are followed. Both serve full article text to a plain HTTP client. Yahoo syndicates Bloomberg, Reuters, Barron's, Motley Fool, Benzinga etc., so coverage is broad. Barron's, MarketWatch and WSJ direct links are paywalled and skipped.
3. **Score** — `app/services/sentiment.py` sends each article to OpenAI (`gpt-4o-mini` by default, JSON mode) with a scoring rubric and gets back a -100..100 score, a 0-10 relevance (is the article really about this stock?), confidence, themes, risks and a one-line summary. The prompts live at the top of that file.
4. **Aggregate** — `app/services/recommendation.py` weights each score by recency (48h half-life), source, model confidence and relevance. ≥ +30 is BUY, ≤ -30 is SELL.
5. **Cache** — results are kept in Redis for 30 minutes. If Redis isn't running the app just logs a warning and runs uncached.

## Configuration

Everything is an environment variable (or `.env` line). See `.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | required |
| `OPENAI_MODEL` | `gpt-4o-mini` | any chat model that supports JSON mode |
| `REDIS_URL` | `redis://localhost:6379/0` | set to empty to disable caching |
| `CACHE_TTL` | `1800` | seconds |
| `LOG_LEVEL` | `INFO` | |

## Tests

```bash
OPENAI_API_KEY=x pytest
```

Tests run offline: the Finviz/Yahoo parsers are tested against real markup snippets and the API is tested with the scraper and OpenAI stubbed.

## Project layout

```
app/
  main.py                 FastAPI app + routes
  config.py               settings (pydantic-settings)
  schemas.py              request / response models
  services/
    scraper.py            Finviz discovery + article text extraction
    sentiment.py          OpenAI call + response normalization
    recommendation.py     weighting and BUY/SELL/HOLD logic
    analyzer.py           orchestrates the pipeline, sector analysis, caching
    cache.py              optional Redis wrapper
tests/
```

## Known limits

- Scraping depends on Finviz's and Yahoo's HTML. When they change markup, `parse_finviz_news` / `extract_article_text` need a selector update. The tests in `tests/test_scraper.py` are the first thing to check.
- Sector sentiment is a proxy (one representative ticker's news), not a real sector feed.
- No history. Every call is a fresh snapshot of the last few days.
