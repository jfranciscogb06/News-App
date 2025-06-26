# News Analysis App

A modern news analysis application that fetches, analyzes, and summarizes stock-related news using AI.

## Features

- Real-time news fetching from Google News
- AI-powered news analysis and sentiment detection
- RESTful API with automatic documentation
- Async database operations
- Modern Python stack (FastAPI, SQLAlchemy, Playwright)

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Install Playwright browsers:
```bash
playwright install
```

4. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

5. Initialize the database:
```bash
alembic upgrade head
```

6. Run the development server:
```bash
uvicorn app.main:app --reload
```

The API will be available at http://localhost:8000
API documentation will be at http://localhost:8000/docs

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: Your OpenAI API key
- `SECRET_KEY`: Secret key for JWT tokens
- `ENVIRONMENT`: development/production
- `LOG_LEVEL`: debug/info/warning/error

## API Endpoints

- `GET /api/news/{ticker}`: Get latest news for a stock ticker
- `GET /api/news/{ticker}/summary`: Get news summary with sentiment analysis
- `GET /api/news/{ticker}/sentiment`: Get sentiment analysis for recent news
- `GET /api/news/{ticker}/history`: Get historical news data

## Development

- Format code: `black .`
- Sort imports: `isort .`
- Run tests: `pytest`
- Run linter: `flake8`
