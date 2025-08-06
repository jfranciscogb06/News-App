import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from collections import defaultdict, Counter
import statistics

from app.core.config import settings
from app.schemas.stock_news import (
    SentimentAnalysisResult, 
    AggregatedAnalysis,
    RecommendationType,
    ConfidenceLevel,
    TimeHorizon
)
from app.models.stock_news import StockRecommendation

logger = logging.getLogger(__name__)

class RecommendationEngine:
    """Engine for aggregating sentiment analysis and generating stock recommendations"""
    
    def __init__(self):
        self.source_weights = {
            "finance.yahoo.com": 1.0,      # Highest weight
            "www.barrons.com": 0.8,        # High weight
            "www.investors.com": 0.7       # Medium-high weight
        }
        
    async def generate_stock_recommendation(
        self, 
        ticker: str,
        sentiment_results: List[SentimentAnalysisResult],
        articles: List[Dict[str, Any]]
    ) -> AggregatedAnalysis:
        """
        Generate stock recommendation from sentiment analysis results
        
        Args:
            ticker: Stock ticker symbol
            sentiment_results: List of sentiment analysis results
            articles: List of article data for additional context
            
        Returns:
            AggregatedAnalysis with recommendation
        """
        if not sentiment_results:
            return self._create_empty_recommendation(ticker)
        
        try:
            # Calculate weighted sentiment score
            overall_sentiment = self._calculate_weighted_sentiment(sentiment_results, articles)
            
            # Determine recommendation
            recommendation = self._determine_recommendation(overall_sentiment)
            
            # Calculate confidence level
            confidence_level = self._calculate_confidence_level(sentiment_results)
            
            # Aggregate key themes
            key_themes = self._aggregate_key_themes(sentiment_results)
            
            # Aggregate risk factors
            risk_factors = self._aggregate_risk_factors(sentiment_results)
            
            # Determine time horizon
            time_horizon = self._determine_time_horizon(sentiment_results)
            
            # Generate price target
            price_target = self._generate_price_target(overall_sentiment, ticker)
            
            # Create summary
            summary = self._generate_summary(
                ticker, overall_sentiment, recommendation, 
                key_themes, risk_factors, len(sentiment_results)
            )
            
            # Calculate weights
            recency_weight = self._calculate_recency_weight(articles)
            source_weight = self._calculate_source_weight(articles)
            content_weight = self._calculate_content_weight(articles)
            
            return AggregatedAnalysis(
                ticker=ticker,
                articles_analyzed=len(sentiment_results),
                overall_sentiment=overall_sentiment,
                recommendation=recommendation,
                confidence_level=confidence_level,
                key_themes=key_themes,
                risk_factors=risk_factors,
                time_horizon=time_horizon,
                price_target=price_target,
                summary=summary,
                recency_weight=recency_weight,
                source_weight=source_weight,
                content_weight=content_weight
            )
            
        except Exception as e:
            logger.error(f"Error generating recommendation for {ticker}: {e}")
            return self._create_empty_recommendation(ticker)
    
    def _calculate_weighted_sentiment(
        self, 
        sentiment_results: List[SentimentAnalysisResult], 
        articles: List[Dict[str, Any]]
    ) -> float:
        """
        Calculate weighted sentiment score based on multiple factors
        
        Formula: Σ(Sentiment × Weight × Confidence) / Σ(Weight × Confidence)
        Where Weight = Recency_Weight × Source_Weight × Content_Weight
        """
        total_weighted_sentiment = 0.0
        total_weight = 0.0
        
        for i, result in enumerate(sentiment_results):
            if i < len(articles):
                article = articles[i]
                
                # Calculate individual weights
                recency_weight = self._calculate_article_recency_weight(article)
                source_weight = self._calculate_article_source_weight(article)
                content_weight = self._calculate_article_content_weight(article)
                
                # Combined weight
                weight = recency_weight * source_weight * content_weight
                
                # Confidence factor (1-10 scale)
                confidence_factor = result.confidence_level / 10.0
                
                # Weighted sentiment
                weighted_sentiment = result.sentiment_score * weight * confidence_factor
                
                total_weighted_sentiment += weighted_sentiment
                total_weight += weight * confidence_factor
        
        if total_weight == 0:
            return 0.0
        
        return total_weighted_sentiment / total_weight
    
    def _calculate_article_recency_weight(self, article: Dict[str, Any]) -> float:
        """Calculate recency weight for an article (newer = higher weight)"""
        try:
            published_at = article.get('published_at')
            if not published_at:
                return 0.5  # Default weight for unknown dates
            
            if isinstance(published_at, str):
                published_at = datetime.fromisoformat(published_at.replace('Z', '+00:00'))
            
            # Calculate hours since publication
            hours_ago = (datetime.now() - published_at).total_seconds() / 3600
            
            # Exponential decay: weight = e^(-hours/24)
            # Articles from last 24 hours get highest weight
            weight = max(0.1, min(1.0, 2.718 ** (-hours_ago / 24)))
            
            return weight
            
        except Exception as e:
            logger.warning(f"Error calculating recency weight: {e}")
            return 0.5
    
    def _calculate_article_source_weight(self, article: Dict[str, Any]) -> float:
        """Calculate source weight based on reliability"""
        source_domain = article.get('source_domain', '').lower()
        
        # Get weight from predefined source weights
        for domain, weight in self.source_weights.items():
            if domain in source_domain:
                return weight
        
        # Default weight for unknown sources
        return 0.5
    
    def _calculate_article_content_weight(self, article: Dict[str, Any]) -> float:
        """Calculate content weight based on quality"""
        content_length = article.get('content_length', 0)
        content_quality = article.get('content_quality_score', 0.0)
        
        # Length factor (0-0.5)
        length_factor = min(content_length / 2000, 1.0) * 0.5
        
        # Quality factor (0-0.5)
        quality_factor = content_quality * 0.5
        
        return length_factor + quality_factor
    
    def _determine_recommendation(self, sentiment_score: float) -> RecommendationType:
        """Determine recommendation based on sentiment score"""
        if sentiment_score >= 30:
            return RecommendationType.BUY
        elif sentiment_score <= -30:
            return RecommendationType.SELL
        else:
            return RecommendationType.HOLD
    
    def _calculate_confidence_level(self, sentiment_results: List[SentimentAnalysisResult]) -> ConfidenceLevel:
        """Calculate overall confidence level"""
        if not sentiment_results:
            return ConfidenceLevel.LOW
        
        # Average confidence from individual analyses
        avg_confidence = statistics.mean([r.confidence_level for r in sentiment_results])
        
        # Number of articles factor
        article_factor = min(len(sentiment_results) / 10, 1.0)  # More articles = higher confidence
        
        # Sentiment consistency factor
        sentiment_scores = [r.sentiment_score for r in sentiment_results]
        if len(sentiment_scores) > 1:
            sentiment_std = statistics.stdev(sentiment_scores)
            consistency_factor = max(0, 1 - sentiment_std / 50)  # Lower std = higher consistency
        else:
            consistency_factor = 0.5
        
        # Combined confidence score
        combined_confidence = (avg_confidence / 10) * 0.5 + article_factor * 0.3 + consistency_factor * 0.2
        
        if combined_confidence >= 0.7:
            return ConfidenceLevel.HIGH
        elif combined_confidence >= 0.4:
            return ConfidenceLevel.MEDIUM
        else:
            return ConfidenceLevel.LOW
    
    def _aggregate_key_themes(self, sentiment_results: List[SentimentAnalysisResult]) -> Dict[str, float]:
        """Aggregate key themes with weights"""
        theme_counter = Counter()
        total_articles = len(sentiment_results)
        
        for result in sentiment_results:
            for theme in result.key_themes:
                theme_counter[theme.lower()] += 1
        
        # Convert to weighted dictionary
        themes = {}
        for theme, count in theme_counter.most_common(10):  # Top 10 themes
            themes[theme] = count / total_articles
        
        return themes
    
    def _aggregate_risk_factors(self, sentiment_results: List[SentimentAnalysisResult]) -> List[str]:
        """Aggregate unique risk factors"""
        risk_set = set()
        
        for result in sentiment_results:
            for risk in result.risk_factors:
                risk_set.add(risk.lower())
        
        # Return most common risks (limit to 5)
        risk_counter = Counter()
        for result in sentiment_results:
            for risk in result.risk_factors:
                risk_counter[risk.lower()] += 1
        
        return [risk for risk, _ in risk_counter.most_common(5)]
    
    def _determine_time_horizon(self, sentiment_results: List[SentimentAnalysisResult]) -> TimeHorizon:
        """Determine overall time horizon"""
        horizon_counts = Counter()
        
        for result in sentiment_results:
            horizon_counts[result.time_horizon] += 1
        
        # Return most common horizon
        if horizon_counts:
            return horizon_counts.most_common(1)[0][0]
        
        return TimeHorizon.SHORT_TERM
    
    def _generate_price_target(self, sentiment_score: float, ticker: str) -> Optional[str]:
        """Generate price target based on sentiment (placeholder)"""
        # This is a simplified placeholder - in a real system, you'd use
        # historical price data and more sophisticated models
        
        if sentiment_score >= 50:
            return "Strong upside potential"
        elif sentiment_score >= 20:
            return "Moderate upside potential"
        elif sentiment_score <= -50:
            return "Downside risk"
        elif sentiment_score <= -20:
            return "Moderate downside risk"
        else:
            return "Stable price range"
    
    def _generate_summary(
        self, 
        ticker: str, 
        sentiment_score: float, 
        recommendation: RecommendationType,
        key_themes: Dict[str, float],
        risk_factors: List[str],
        article_count: int
    ) -> str:
        """Generate summary of the analysis"""
        
        # Sentiment description
        if sentiment_score >= 50:
            sentiment_desc = "very positive"
        elif sentiment_score >= 20:
            sentiment_desc = "positive"
        elif sentiment_score >= -20:
            sentiment_desc = "neutral"
        elif sentiment_score >= -50:
            sentiment_desc = "negative"
        else:
            sentiment_desc = "very negative"
        
        # Top themes
        top_themes = list(key_themes.keys())[:3]
        themes_str = ", ".join(top_themes) if top_themes else "general market factors"
        
        # Risk summary
        risk_summary = ""
        if risk_factors:
            risk_summary = f" Key risks include: {', '.join(risk_factors[:3])}."
        
        summary = (
            f"Analysis of {article_count} articles shows {sentiment_desc} sentiment for {ticker}. "
            f"Primary themes include {themes_str}. "
            f"Recommendation: {recommendation.value}.{risk_summary}"
        )
        
        return summary
    
    def _calculate_recency_weight(self, articles: List[Dict[str, Any]]) -> float:
        """Calculate overall recency weight for the analysis"""
        if not articles:
            return 0.5
        
        weights = [self._calculate_article_recency_weight(article) for article in articles]
        return statistics.mean(weights)
    
    def _calculate_source_weight(self, articles: List[Dict[str, Any]]) -> float:
        """Calculate overall source weight for the analysis"""
        if not articles:
            return 0.5
        
        weights = [self._calculate_article_source_weight(article) for article in articles]
        return statistics.mean(weights)
    
    def _calculate_content_weight(self, articles: List[Dict[str, Any]]) -> float:
        """Calculate overall content weight for the analysis"""
        if not articles:
            return 0.5
        
        weights = [self._calculate_article_content_weight(article) for article in articles]
        return statistics.mean(weights)
    
    def _create_empty_recommendation(self, ticker: str) -> AggregatedAnalysis:
        """Create empty recommendation when no data is available"""
        return AggregatedAnalysis(
            ticker=ticker,
            articles_analyzed=0,
            overall_sentiment=0.0,
            recommendation=RecommendationType.HOLD,
            confidence_level=ConfidenceLevel.LOW,
            key_themes={},
            risk_factors=["Insufficient data"],
            time_horizon=TimeHorizon.SHORT_TERM,
            price_target=None,
            summary=f"No recent news articles found for {ticker}.",
            recency_weight=0.0,
            source_weight=0.0,
            content_weight=0.0
        )
    
    async def get_recommendation_stats(self) -> Dict[str, Any]:
        """Get statistics about recommendation generation"""
        return {
            "total_recommendations": 0,  # Would be tracked in database
            "recommendation_distribution": {
                "BUY": 0,
                "SELL": 0,
                "HOLD": 0
            },
            "average_sentiment": 0.0,
            "average_confidence": 0.0
        } 