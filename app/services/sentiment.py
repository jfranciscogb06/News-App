"""Ask OpenAI for a structured sentiment read on each article."""
import asyncio
import json
import logging

from openai import AsyncOpenAI

from app.config import settings
from app.schemas import Article, ArticleSentiment, TimeHorizon

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a sell-side equity analyst writing a quick read on a single news article for a portfolio manager.

Your job: judge what this article means for the price of the SUBJECT over the coming days to months. Grade the news itself, not the writer's tone. Headlines are often hype; look for facts that change earnings, revenue, margins, demand, competition, regulation, or management.

Rules:
- Use only what the article says. Never add outside facts or assumptions.
- A stock price move that already happened is context, not news. Score what comes next.
- Relevance means: does this article change the investment case for the SUBJECT? Give low relevance (0-3) to articles where the subject is a bystander: an analyst note the subject's firm published about another company, an executive's personal or charity news, a market wrap that name-drops the subject, or product news about a different company. Low-relevance articles should score close to 0 regardless of tone.
- Ignore ads, newsletter sign-ups, disclaimers, and unrelated "related stories" text.
- Be decisive when the facts are clear; stay near 0 when they are genuinely mixed or immaterial.
- Output valid JSON only. No prose outside the JSON."""

USER_PROMPT = """SUBJECT: {subject}
TITLE: {title}

ARTICLE:
\"\"\"
{content}
\"\"\"

Scoring rubric for sentiment_score (impact on {subject}):
  +70 to +100  Clearly material good news: earnings/guidance beat, big contract, approval, buyback, upgrade with new facts
  +30 to +69   Solidly positive: strong product reception, favorable analyst view, good sector tailwind
  +10 to +29   Mildly positive or positive-leaning commentary
  -9 to +9     Neutral, mixed, immaterial, or not really about {subject}
  -10 to -29   Mildly negative or cautious commentary
  -30 to -69   Solidly negative: weak demand, margin pressure, lost deal, downgrade, legal/regulatory pressure
  -70 to -100  Clearly material bad news: earnings/guidance miss, major recall, fraud, key exec exit under a cloud

Return JSON with exactly these keys:
{{
  "relevance": integer 0-10. 10 = the article is about {subject}'s own business, results, products, or stock; 5 = partly about it; 0-3 = subject is only mentioned, quoted, or is the author of research about someone else,
  "sentiment_score": integer -100 to 100 per the rubric above. Use the full range (e.g. 45, -18, 72), not just bucket edges,
  "confidence": integer 1-10. High only when the article contains concrete, verifiable facts (numbers, decisions, official statements). Speculation or opinion pieces should be 3-5,
  "key_themes": up to 4 lowercase snake_case tags naming the drivers, e.g. "earnings", "product_launch", "regulation", "ai_demand", "margins", "guidance",
  "time_horizon": "immediate" (days), "short-term" (weeks to a quarter), or "long-term" (multiple quarters),
  "risk_factors": up to 3 short, specific risks the article raises or clearly implies for {subject}. Empty list if none,
  "summary": one or two plain sentences: what happened and why it matters for {subject}. No hedging filler
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
        relevance=max(0, min(10, int(num(data.get("relevance"), 10)))),
        key_themes=[t.lower() for t in str_list(data.get("key_themes"), 4)],
        time_horizon=TimeHorizon(horizon),
        risk_factors=str_list(data.get("risk_factors"), 3),
        summary=str(data.get("summary", ""))[:500],
        tokens_used=tokens_used,
    )
