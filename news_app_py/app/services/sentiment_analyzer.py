import asyncio
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
import time

from app.core.config import settings
from app.schemas.stock_news import SentimentAnalysisResult, ImpactPrediction, TimeHorizon
from app.models.stock_news import SentimentAnalysis

logger = logging.getLogger(__name__)

class SentimentAnalyzerService:
    """Service for AI-powered sentiment analysis of stock news articles"""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.rate_limit_semaphore = asyncio.Semaphore(settings.max_concurrent_analyses)
        
    async def analyze_article_sentiment(self, article_content: str, ticker: str, title: str) -> SentimentAnalysisResult:
        """
        Analyze sentiment of a single article using ChatGPT API
        
        Args:
            article_content: Article text content
            ticker: Stock ticker symbol
            title: Article title
            
        Returns:
            SentimentAnalysisResult with analysis details
        """
        start_time = time.time()
        
        try:
            async with self.rate_limit_semaphore:
                # Create analysis prompt
                prompt = self._create_analysis_prompt(article_content, ticker, title)
                
                # Call ChatGPT API
                response = await self._call_chatgpt_api(prompt)
                
                # Parse response
                analysis_data = self._parse_analysis_response(response)
                
                # Calculate duration
                duration = time.time() - start_time
                
                return SentimentAnalysisResult(
                    sentiment_score=analysis_data['sentiment_score'],
                    confidence_level=analysis_data['confidence_level'],
                    impact_prediction=analysis_data['impact_prediction'],
                    key_themes=analysis_data['key_themes'],
                    time_horizon=analysis_data['time_horizon'],
                    risk_factors=analysis_data['risk_factors'],
                    summary=analysis_data['summary'],
                    analysis_duration=duration,
                    tokens_used=response.usage.total_tokens if response.usage else None
                )
                
        except Exception as e:
            logger.error(f"Error analyzing sentiment for {ticker}: {e}")
            # Return neutral analysis as fallback
            return self._create_fallback_analysis(duration=time.time() - start_time)
    
    async def analyze_multiple_articles(self, articles: List[Dict[str, Any]], ticker: str) -> List[SentimentAnalysisResult]:
        """
        Analyze sentiment for multiple articles concurrently
        
        Args:
            articles: List of article dictionaries with content and title
            ticker: Stock ticker symbol
            
        Returns:
            List of SentimentAnalysisResult objects
        """
        tasks = []
        
        for article in articles:
            task = self.analyze_article_sentiment(
                article['content'],
                ticker,
                article['title']
            )
            tasks.append(task)
        
        # Process with rate limiting
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Handle exceptions
        valid_results = []
        for result in results:
            if isinstance(result, SentimentAnalysisResult):
                valid_results.append(result)
            elif isinstance(result, Exception):
                logger.warning(f"Analysis failed: {result}")
                # Add fallback analysis
                valid_results.append(self._create_fallback_analysis())
        
        return valid_results
    
    def _create_analysis_prompt(self, content: str, ticker: str, title: str) -> str:
        """Create the analysis prompt for ChatGPT"""
        return f"""Analyze this financial news article about {ticker.upper()}:

Title: {title}

Content: {content[:3000]}  # Limit content length for API efficiency

Please provide a comprehensive analysis in the following JSON format:

{{
    "sentiment_score": <number between -100 and +100>,
    "confidence_level": <number between 1 and 10>,
    "impact_prediction": "<positive/negative/neutral>",
    "key_themes": ["theme1", "theme2", "theme3"],
    "time_horizon": "<immediate/short-term/long-term>",
    "risk_factors": ["risk1", "risk2", "risk3"],
    "summary": "<2-3 sentence summary of the analysis>"
}}

Guidelines:
- Sentiment Score: -100 (very negative) to +100 (very positive)
- Confidence Level: 1 (low confidence) to 10 (high confidence)
- Key Themes: Identify main topics (e.g., earnings, AI, competition, regulation)
- Time Horizon: When the impact is likely to occur
- Risk Factors: Potential negative factors or uncertainties
- Summary: Concise analysis of the article's impact on {ticker}

Focus on:
1. Financial performance indicators
2. Market sentiment and investor reaction
3. Competitive landscape changes
4. Regulatory or macroeconomic factors
5. Company-specific developments

Respond only with valid JSON."""

    async def _call_chatgpt_api(self, prompt: str) -> Any:
        """Call ChatGPT API with rate limiting and error handling"""
        try:
            response = await self.client.chat.completions.create(
                model=settings.openai_model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a financial analyst specializing in stock market sentiment analysis. Provide accurate, balanced analysis based on the article content."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                max_tokens=settings.openai_max_tokens,
                temperature=settings.openai_temperature,
                timeout=settings.analysis_timeout
            )
            
            return response
            
        except Exception as e:
            logger.error(f"ChatGPT API error: {e}")
            raise
    
    def _parse_analysis_response(self, response: Any) -> Dict[str, Any]:
        """Parse ChatGPT response into structured data"""
        try:
            content = response.choices[0].message.content.strip()
            
            # Try to extract JSON from response
            json_start = content.find('{')
            json_end = content.rfind('}') + 1
            
            if json_start != -1 and json_end > json_start:
                json_str = content[json_start:json_end]
                data = json.loads(json_str)
            else:
                # Fallback parsing if JSON extraction fails
                data = self._fallback_parse_response(content)
            
            # Validate and normalize data
            return self._validate_analysis_data(data)
            
        except Exception as e:
            logger.error(f"Error parsing analysis response: {e}")
            return self._create_default_analysis_data()
    
    def _fallback_parse_response(self, content: str) -> Dict[str, Any]:
        """Fallback parsing for non-JSON responses"""
        data = {
            "sentiment_score": 0,
            "confidence_level": 5,
            "impact_prediction": "neutral",
            "key_themes": [],
            "time_horizon": "short-term",
            "risk_factors": [],
            "summary": "Analysis could not be parsed automatically."
        }
        
        # Try to extract sentiment from text
        content_lower = content.lower()
        
        # Sentiment indicators
        positive_words = ['positive', 'bullish', 'up', 'gain', 'profit', 'growth', 'beat', 'exceed']
        negative_words = ['negative', 'bearish', 'down', 'loss', 'decline', 'miss', 'fall', 'drop']
        
        positive_count = sum(1 for word in positive_words if word in content_lower)
        negative_count = sum(1 for word in negative_words if word in content_lower)
        
        if positive_count > negative_count:
            data["sentiment_score"] = 30
            data["impact_prediction"] = "positive"
        elif negative_count > positive_count:
            data["sentiment_score"] = -30
            data["impact_prediction"] = "negative"
        
        return data
    
    def _validate_analysis_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and normalize analysis data"""
        validated = {}
        
        # Sentiment score (-100 to +100)
        sentiment = data.get('sentiment_score', 0)
        validated['sentiment_score'] = max(-100, min(100, float(sentiment)))
        
        # Confidence level (1-10)
        confidence = data.get('confidence_level', 5)
        validated['confidence_level'] = max(1, min(10, int(confidence)))
        
        # Impact prediction
        impact = data.get('impact_prediction', 'neutral').lower()
        if impact in ['positive', 'negative', 'neutral']:
            validated['impact_prediction'] = ImpactPrediction(impact)
        else:
            validated['impact_prediction'] = ImpactPrediction.NEUTRAL
        
        # Key themes
        themes = data.get('key_themes', [])
        if isinstance(themes, list):
            validated['key_themes'] = [str(theme) for theme in themes[:5]]  # Limit to 5 themes
        else:
            validated['key_themes'] = []
        
        # Time horizon
        horizon = data.get('time_horizon', 'short-term').lower()
        if horizon in ['immediate', 'short-term', 'long-term']:
            validated['time_horizon'] = TimeHorizon(horizon)
        else:
            validated['time_horizon'] = TimeHorizon.SHORT_TERM
        
        # Risk factors
        risks = data.get('risk_factors', [])
        if isinstance(risks, list):
            validated['risk_factors'] = [str(risk) for risk in risks[:5]]  # Limit to 5 risks
        else:
            validated['risk_factors'] = []
        
        # Summary
        summary = data.get('summary', 'No summary available.')
        validated['summary'] = str(summary)[:500]  # Limit summary length
        
        return validated
    
    def _create_default_analysis_data(self) -> Dict[str, Any]:
        """Create default analysis data for error cases"""
        return {
            "sentiment_score": 0,
            "confidence_level": 1,
            "impact_prediction": ImpactPrediction.NEUTRAL,
            "key_themes": [],
            "time_horizon": TimeHorizon.SHORT_TERM,
            "risk_factors": ["Analysis failed"],
            "summary": "Unable to analyze article content."
        }
    
    def _create_fallback_analysis(self, duration: float = 0.0) -> SentimentAnalysisResult:
        """Create fallback analysis when API fails"""
        return SentimentAnalysisResult(
            sentiment_score=0,
            confidence_level=1,
            impact_prediction=ImpactPrediction.NEUTRAL,
            key_themes=[],
            time_horizon=TimeHorizon.SHORT_TERM,
            risk_factors=["Analysis unavailable"],
            summary="Sentiment analysis could not be performed.",
            analysis_duration=duration,
            tokens_used=None
        )
    
    async def get_analysis_stats(self) -> Dict[str, Any]:
        """Get statistics about sentiment analysis performance"""
        return {
            "total_analyses": 0,  # Would be tracked in database
            "average_sentiment": 0.0,
            "average_confidence": 0.0,
            "success_rate": 0.0,
            "average_duration": 0.0,
            "tokens_used_total": 0
        } 