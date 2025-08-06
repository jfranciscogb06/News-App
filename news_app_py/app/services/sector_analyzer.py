import asyncio
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.core.config import settings
from app.services.playwright_scraper import PlaywrightScraperService, ScrapingResult
from app.services.sentiment_analyzer import SentimentAnalyzerService
from app.schemas.stock_news import SentimentAnalysisResult, AggregatedAnalysis

logger = logging.getLogger(__name__)

class SectorAnalyzerService:
    """Service for analyzing sector-specific news and sentiment"""
    
    def __init__(self):
        self.sentiment_analyzer = SentimentAnalyzerService()
    
    def get_sector_for_ticker(self, ticker: str) -> Optional[str]:
        """Get the sector for a given ticker"""
        return settings.sector_mapping.get(ticker.upper())
    
    def get_sector_keywords(self, sector: str) -> List[str]:
        """Get relevant keywords for sector news filtering"""
        sector_keywords = {
            "Technology": [
                "tech", "technology", "software", "hardware", "AI", "artificial intelligence",
                "cloud", "digital", "innovation", "startup", "semiconductor", "chip",
                "cybersecurity", "fintech", "ecommerce", "social media", "streaming"
            ],
            "Consumer Discretionary": [
                "retail", "consumer", "ecommerce", "automotive", "travel", "leisure",
                "entertainment", "restaurant", "hotel", "tourism", "fashion", "luxury"
            ],
            "Healthcare": [
                "healthcare", "medical", "pharmaceutical", "biotech", "drug", "treatment",
                "hospital", "insurance", "wellness", "diagnostic", "therapeutic"
            ],
            "Financial": [
                "bank", "financial", "investment", "insurance", "credit", "lending",
                "trading", "wealth", "fintech", "payment", "mortgage", "crypto"
            ],
            "Energy": [
                "energy", "oil", "gas", "renewable", "solar", "wind", "fossil fuel",
                "petroleum", "electricity", "utility", "green energy", "carbon"
            ],
            "Industrial": [
                "industrial", "manufacturing", "aerospace", "defense", "construction",
                "machinery", "automation", "logistics", "transportation", "infrastructure"
            ],
            "Consumer Staples": [
                "consumer staples", "food", "beverage", "household", "personal care",
                "grocery", "packaging", "tobacco", "alcohol", "essential goods"
            ],
            "Communication Services": [
                "telecom", "communication", "media", "entertainment", "broadcasting",
                "internet", "wireless", "cable", "streaming", "social media"
            ],
            "Real Estate": [
                "real estate", "property", "commercial", "residential", "REIT",
                "construction", "development", "leasing", "mortgage", "housing"
            ],
            "Materials": [
                "materials", "chemical", "mining", "steel", "aluminum", "copper",
                "gold", "silver", "commodity", "industrial material", "raw material"
            ],
            "Utilities": [
                "utility", "electric", "gas", "water", "power", "energy",
                "infrastructure", "public service", "regulated", "grid"
            ]
        }
        return sector_keywords.get(sector, [])
    
    async def analyze_sector_sentiment(self, sector: str, max_articles: int = 10) -> Optional[AggregatedAnalysis]:
        """
        Analyze sentiment for a specific sector
        
        Args:
            sector: Sector name (e.g., "Technology")
            max_articles: Maximum articles to analyze
            
        Returns:
            AggregatedAnalysis for the sector
        """
        try:
            logger.info(f"Starting sector analysis for {sector}")
            
            # Get sector keywords for filtering
            sector_keywords = self.get_sector_keywords(sector)
            
            # Scrape sector-specific news
            sector_articles = await self._scrape_sector_news(sector, sector_keywords, max_articles)
            
            if not sector_articles:
                logger.warning(f"No sector articles found for {sector}")
                return None
            
            # Analyze sentiment for sector articles
            sentiment_results = await self._analyze_sector_articles(sector_articles, sector)
            
            if not sentiment_results:
                logger.warning(f"No sentiment results for {sector}")
                return None
            
            # Aggregate sector analysis
            sector_analysis = self._aggregate_sector_sentiment(sentiment_results, sector)
            
            logger.info(f"Completed sector analysis for {sector}: {sector_analysis.overall_sentiment:.2f}")
            return sector_analysis
            
        except Exception as e:
            logger.error(f"Error analyzing sector {sector}: {e}")
            return None
    
    async def _scrape_sector_news(self, sector: str, keywords: List[str], max_articles: int) -> List[Any]:
        """Scrape news articles related to the sector"""
        try:
            # Use a representative ticker for the sector to get sector news
            sector_tickers = {
                "Technology": "AAPL",
                "Consumer Discretionary": "AMZN", 
                "Healthcare": "JNJ",
                "Financial": "JPM",
                "Energy": "XOM",
                "Industrial": "BA",
                "Consumer Staples": "PG",
                "Communication Services": "T",
                "Real Estate": "AMT",
                "Materials": "LIN",
                "Utilities": "NEE"
            }
            
            representative_ticker = sector_tickers.get(sector, "AAPL")
            
            async with PlaywrightScraperService() as scraper:
                # Get more articles initially to filter for sector-specific ones
                scraping_result = await scraper.scrape_stock_news(representative_ticker, max_articles * 2)
                
                if not scraping_result.success:
                    return []
                
                # Filter articles for sector relevance
                sector_articles = []
                for article in scraping_result.articles:
                    title_lower = article.title.lower()
                    content_lower = article.content.lower()
                    
                    # Check if article mentions sector keywords
                    is_sector_relevant = any(
                        keyword.lower() in title_lower or keyword.lower() in content_lower
                        for keyword in keywords
                    )
                    
                    # Also check if it mentions the sector name
                    if sector.lower() in title_lower or sector.lower() in content_lower:
                        is_sector_relevant = True
                    
                    if is_sector_relevant:
                        sector_articles.append(article)
                        if len(sector_articles) >= max_articles:
                            break
                
                return sector_articles
                
        except Exception as e:
            logger.error(f"Error scraping sector news for {sector}: {e}")
            return []
    
    async def _analyze_sector_articles(self, articles: List[Any], sector: str) -> List[SentimentAnalysisResult]:
        """Analyze sentiment for sector articles"""
        sentiment_results = []
        
        for article in articles:
            try:
                # Create a sector-specific prompt
                prompt = f"""
                Analyze the sentiment of this {sector} sector news article. Focus on how this news affects the {sector} industry as a whole, not just individual companies.
                
                Article Title: {article.title}
                Article Content: {article.content[:2000]}...
                
                Provide analysis in this JSON format:
                {{
                    "sentiment_score": <float between -100 and 100>,
                    "confidence_level": <int between 1 and 10>,
                    "impact_prediction": "<positive/negative/neutral>",
                    "key_themes": ["theme1", "theme2", "theme3"],
                    "time_horizon": "<immediate/short-term/long-term>",
                    "risk_factors": ["risk1", "risk2"],
                    "summary": "<brief summary focusing on sector impact>"
                }}
                """
                
                result = await self.sentiment_analyzer.analyze_article_sentiment(
                    article.content, 
                    sector, 
                    article.title
                )
                if result:
                    sentiment_results.append(result)
                    
            except Exception as e:
                logger.warning(f"Error analyzing sector article: {e}")
                continue
        
        return sentiment_results
    
    def _aggregate_sector_sentiment(self, sentiment_results: List[SentimentAnalysisResult], sector: str) -> AggregatedAnalysis:
        """Aggregate sector sentiment results"""
        if not sentiment_results:
            return None
        
        # Calculate weighted average sentiment
        total_sentiment = sum(result.sentiment_score for result in sentiment_results)
        avg_sentiment = total_sentiment / len(sentiment_results)
        
        # Aggregate themes
        theme_counts = {}
        for result in sentiment_results:
            for theme in result.key_themes:
                theme_counts[theme] = theme_counts.get(theme, 0) + 1
        
        # Normalize theme weights
        total_themes = sum(theme_counts.values())
        key_themes = {theme: count / total_themes for theme, count in theme_counts.items()}
        
        # Aggregate risk factors
        all_risk_factors = []
        for result in sentiment_results:
            all_risk_factors.extend(result.risk_factors)
        
        # Remove duplicates and get top risks
        unique_risks = list(set(all_risk_factors))
        risk_factors = unique_risks[:5]  # Top 5 risks
        
        # Determine recommendation
        if avg_sentiment > 30:
            recommendation = "BUY"
        elif avg_sentiment < -30:
            recommendation = "SELL"
        else:
            recommendation = "HOLD"
        
        # Create summary
        summary = f"Analysis of {len(sentiment_results)} {sector} sector articles shows {avg_sentiment:.1f} sentiment. "
        summary += f"Primary themes: {', '.join(list(key_themes.keys())[:3])}. "
        summary += f"Recommendation: {recommendation}."
        
        return AggregatedAnalysis(
            ticker=sector,
            articles_analyzed=len(sentiment_results),
            overall_sentiment=avg_sentiment,
            recommendation=recommendation,
            confidence_level="MEDIUM",
            key_themes=key_themes,
            risk_factors=risk_factors,
            time_horizon="short-term",
            price_target=f"Based on {avg_sentiment:.1f} sector sentiment",
            summary=summary,
            recency_weight=1.0,
            source_weight=1.0,
            content_weight=1.0
        ) 