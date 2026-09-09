from datetime import datetime, timedelta

from app.schemas import Article, ArticleSentiment, Confidence, Recommendation
from app.services import recommendation
from app.services.sentiment import normalize


def article(hours_old: float, domain: str = "finance.yahoo.com") -> Article:
    return Article(
        ticker="AAPL", title="t", url=f"https://{domain}/x", source="s", source_domain=domain,
        published_at=datetime.now() - timedelta(hours=hours_old), content="c" * 300,
    )


def sentiment(score: float, conf: int = 8, themes=("earnings",), risks=("china",)) -> ArticleSentiment:
    return ArticleSentiment(sentiment_score=score, confidence=conf, key_themes=list(themes), risk_factors=list(risks), summary="s")


def test_buy_when_consistently_positive():
    articles = [article(1), article(5), article(20)]
    sents = [sentiment(70), sentiment(60), sentiment(50)]
    agg = recommendation.aggregate("AAPL", articles, sents)
    assert agg.recommendation == Recommendation.BUY
    assert agg.articles_analyzed == 3
    assert agg.key_themes == {"earnings": 1.0}
    assert agg.risk_factors == ["china"]
    assert "BUY" in agg.summary


def test_newer_articles_weigh_more():
    articles = [article(0.5), article(120)]
    sents = [sentiment(-80), sentiment(80)]
    agg = recommendation.aggregate("AAPL", articles, sents)
    assert agg.overall_sentiment < 0
    assert agg.recommendation == Recommendation.SELL


def test_failed_sentiments_are_skipped():
    articles = [article(1), article(2)]
    agg = recommendation.aggregate("AAPL", articles, [None, sentiment(10)])
    assert agg.articles_analyzed == 1
    assert agg.recommendation == Recommendation.HOLD


def test_empty_when_nothing_analyzed():
    agg = recommendation.aggregate("AAPL", [article(1)], [None])
    assert agg.articles_analyzed == 0
    assert agg.confidence_level == Confidence.LOW


def test_normalize_clamps_and_defaults():
    s = normalize({"sentiment_score": 250, "confidence": 0, "time_horizon": "whenever", "key_themes": ["AI", 3], "risk_factors": "nope"})
    assert s.sentiment_score == 100
    assert s.confidence == 1
    assert s.time_horizon.value == "short-term"
    assert s.key_themes == ["ai", "3"]
    assert s.risk_factors == []
