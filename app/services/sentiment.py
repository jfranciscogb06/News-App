"""Ask OpenAI for a structured sentiment read on each article."""
import asyncio
import json
import logging

from openai import AsyncOpenAI

from app.config import settings
from app.schemas import Article, ArticleSentiment, TimeHorizon

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a financial analyst. Read the article and judge how it affects the "
    "given stock (or sector). Be balanced; do not invent facts not in the article. "
    "Respond only with JSON."
)

USER_PROMPT = """Subject: {subject}
Title: {title}

Article:
{content}

Return JSON with exactly these keys:
{{
  "sentiment_score": number from -100 (very negative for {subject}) to 100 (very positive),
  "confidence": integer 1-10, how confident you are in the score,
  "key_themes": up to 4 short lowercase themes (e.g. "earnings", "regulation", "ai"),
  "time_horizon": one of "immediate", "short-term", "long-term",
  "risk_factors": up to 3 short risks mentioned or implied,
  "summary": 1-2 sentences on what this means for {subject}
}}"""


class SentimentAnalyzer:
    def __init__(self, client: AsyncOpenAI | None = None) -> None:
        self.client = client or AsyncOpenAI(api_key=settings.openai_api_key, timeout=settings.openai_timeout)
        self._sem = asyncio.Semaphore(settings.max_concurrent_analyses)

    async def analyze_many(self, articles: list[Article], subject: str) -> list[ArticleSentiment | None]:
        """One result per article, in order. None where the API call failed."""
        results = await asyncio.gather(
            *(self.analyze(a, subject) for a in articles), return_exceptions=True
        )
        out: list[ArticleSentiment | None] = []
        for article, r in zip(articles, results):
            if isinstance(r, ArticleSentiment):
                out.append(r)
            else:
                logger.warning("Sentiment failed for %s: %s", article.url, r)
                out.append(None)
        return out

    async def analyze(self, article: Article, subject: str) -> ArticleSentiment:
        prompt = USER_PROMPT.format(subject=subject, title=article.title, content=article.content[:4000])
        async with self._sem:
            resp = await self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
                max_tokens=settings.openai_max_tokens,
                temperature=settings.openai_temperature,
                response_format={"type": "json_object"},
            )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        return normalize(data, tokens_used=resp.usage.total_tokens if resp.usage else None)


def normalize(data: dict, tokens_used: int | None = None) -> ArticleSentiment:
    """Coerce whatever the model returned into a valid ArticleSentiment."""
    horizon = str(data.get("time_horizon", "short-term")).lower()
    if horizon not in TimeHorizon._value2member_map_:
        horizon = "short-term"

    def str_list(v, limit: int) -> list[str]:
        return [str(x).strip() for x in v][:limit] if isinstance(v, list) else []

    def num(v, default):
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    return ArticleSentiment(
        sentiment_score=max(-100.0, min(100.0, num(data.get("sentiment_score"), 0.0))),
        confidence=max(1, min(10, int(num(data.get("confidence"), 5)))),
        key_themes=[t.lower() for t in str_list(data.get("key_themes"), 4)],
        time_horizon=TimeHorizon(horizon),
        risk_factors=str_list(data.get("risk_factors"), 3),
        summary=str(data.get("summary", ""))[:500],
        tokens_used=tokens_used,
    )
