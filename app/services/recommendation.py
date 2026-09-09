"""Combine per-article sentiment into one BUY / SELL / HOLD call."""
import math
import statistics
from collections import Counter
from datetime import datetime

from app.schemas import AggregatedAnalysis, Article, ArticleSentiment, Confidence, Recommendation, TimeHorizon

SOURCE_WEIGHTS = {"finance.yahoo.com": 1.0, "www.investors.com": 0.9}
BUY_THRESHOLD = 30
SELL_THRESHOLD = -30


def aggregate(subject: str, articles: list[Article], sentiments: list[ArticleSentiment]) -> AggregatedAnalysis:
    pairs = [(a, s) for a, s in zip(articles, sentiments) if s is not None]
    if not pairs:
        return empty(subject)

    overall = weighted_sentiment(pairs)
    themes = aggregate_themes([s for _, s in pairs])
    risks = [r for r, _ in Counter(s.strip().lower() for _, s2 in pairs for s in s2.risk_factors).most_common(5)]
    horizon = Counter(s.time_horizon for _, s in pairs).most_common(1)[0][0]
    rec = recommend(overall)

    return AggregatedAnalysis(
        articles_analyzed=len(pairs),
        overall_sentiment=round(overall, 1),
        recommendation=rec,
        confidence_level=confidence([s for _, s in pairs]),
        key_themes=themes,
        risk_factors=risks,
        time_horizon=horizon,
        summary=summary(subject, overall, rec, themes, risks, len(pairs)),
    )


def weighted_sentiment(pairs: list[tuple[Article, ArticleSentiment]], now: datetime | None = None) -> float:
    """Σ(score × weight) / Σ(weight), weight = recency × source × model confidence."""
    now = now or datetime.now()
    total, weight_sum = 0.0, 0.0
    for article, s in pairs:
        hours_old = max(0.0, (now - article.published_at).total_seconds() / 3600)
        recency = max(0.15, math.exp(-hours_old / 48))  # half-ish weight after ~1.5 days
        source = SOURCE_WEIGHTS.get(article.source_domain, 0.6)
        w = recency * source * (s.confidence / 10)
        total += s.sentiment_score * w
        weight_sum += w
    return total / weight_sum if weight_sum else 0.0


def recommend(score: float) -> Recommendation:
    if score >= BUY_THRESHOLD:
        return Recommendation.BUY
    if score <= SELL_THRESHOLD:
        return Recommendation.SELL
    return Recommendation.HOLD


def confidence(sentiments: list[ArticleSentiment]) -> Confidence:
    avg_conf = statistics.mean(s.confidence for s in sentiments) / 10
    coverage = min(len(sentiments) / 8, 1.0)
    scores = [s.sentiment_score for s in sentiments]
    agreement = max(0.0, 1 - statistics.pstdev(scores) / 50) if len(scores) > 1 else 0.5
    combined = avg_conf * 0.5 + coverage * 0.3 + agreement * 0.2
    if combined >= 0.7:
        return Confidence.HIGH
    if combined >= 0.45:
        return Confidence.MEDIUM
    return Confidence.LOW


def aggregate_themes(sentiments: list[ArticleSentiment]) -> dict[str, float]:
    counts = Counter(t for s in sentiments for t in s.key_themes)
    n = len(sentiments)
    return {theme: round(c / n, 2) for theme, c in counts.most_common(8)}


def summary(subject: str, score: float, rec: Recommendation, themes: dict, risks: list[str], n: int) -> str:
    if score >= 50:
        tone = "very positive"
    elif score >= 20:
        tone = "positive"
    elif score > -20:
        tone = "mixed to neutral"
    elif score > -50:
        tone = "negative"
    else:
        tone = "very negative"
    theme_str = ", ".join(list(themes)[:3]) or "general market factors"
    risk_str = f" Key risks: {', '.join(risks[:3])}." if risks else ""
    return f"{n} recent articles show {tone} sentiment for {subject} ({score:+.0f}). Main themes: {theme_str}. Recommendation: {rec.value}.{risk_str}"


def empty(subject: str) -> AggregatedAnalysis:
    return AggregatedAnalysis(
        articles_analyzed=0,
        overall_sentiment=0.0,
        recommendation=Recommendation.HOLD,
        confidence_level=Confidence.LOW,
        key_themes={},
        risk_factors=["No recent articles could be analyzed"],
        time_horizon=TimeHorizon.SHORT_TERM,
        summary=f"No recent news articles were found for {subject}.",
    )
