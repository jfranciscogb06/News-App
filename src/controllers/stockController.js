const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const NewsCache = require('../models/newsCache');
const sourceValidationService = require('../services/sourceValidationService');

class StockController {
  /**
   * Analyze a stock based on news articles
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ 
          error: 'Invalid stock symbol',
          message: 'Please provide a valid stock symbol'
        });
      }
      
      const normalizedSymbol = symbol.toUpperCase().trim();
      console.log(`Processing analysis request for ${normalizedSymbol}`);
      
      // Try to get from cache first
      const cachedData = await NewsCache.getBySymbol(normalizedSymbol);
      
      if (cachedData) {
        console.log(`Returning cached data for ${normalizedSymbol}`);
        return res.json(cachedData);
      }
      
      // If not in cache, collect news articles
      console.log(`Collecting news for ${normalizedSymbol}...`);
      const { articles, count } = await newsService.collectAndAnalyzeNews(normalizedSymbol, 30);
      
      if (!articles || articles.length === 0) {
        return res.status(404).json({
          error: 'No news articles found',
          message: `Could not find any relevant news articles for ${normalizedSymbol}`
        });
      }
      
      console.log(`Collected ${count} articles for ${normalizedSymbol}, analyzing...`);
      
      // Use OpenAI to analyze the collected articles
      const analysis = await openaiService.analyzeArticles(normalizedSymbol, articles);
      
      // Add source validation metadata to the analysis
      for (const timeframe in analysis) {
        if (analysis[timeframe] && analysis[timeframe].key_articles) {
          analysis[timeframe].key_articles = analysis[timeframe].key_articles.map(article => {
            // Only validate articles that weren't validated during collection
            if (!article.credibilityScore) {
              return sourceValidationService.validateArticleSource(article);
            }
            return article;
          });
        }
      }
      
      // Calculate source credibility statistics
      const sourceCredibilityStats = this.calculateSourceCredibilityStats(analysis);
      
      // Create the response object
      const result = {
        symbol: normalizedSymbol,
        timestamp: new Date(),
        analysis,
        source: 'fresh',
        articleCount: count,
        sourceCredibility: sourceCredibilityStats
      };

      // Save to cache with a 30-minute TTL
      await NewsCache.save(normalizedSymbol, analysis, {
        sourceCredibility: sourceCredibilityStats,
        articleCount: count,
        ttlHours: 0.5
      });
      
      // Clean expired cache entries in the background
      NewsCache.cleanExpired().catch(err => console.error('Error cleaning cache:', err));

      res.json(result);
    } catch (error) {
      console.error('Error in stock analysis:', error);
      
      // If it's a specific OpenAI error, provide a better response
      if (error.message && error.message.includes('Invalid analysis structure')) {
        return res.status(500).json({
          error: 'An error occurred while analyzing the stock',
          details: error.message,
          suggestion: 'The analysis could not be properly structured. This may be due to insufficient news data or an issue with the OpenAI service.'
        });
      }
      
      next(error);
    }
  }
  
  /**
   * Calculate credibility statistics for sources in the analysis
   * @param {Object} analysis - The analysis object containing key articles
   * @returns {Object} Statistics about source credibility
   */
  calculateSourceCredibilityStats(analysis) {
    const allKeyArticles = [];
    
    // Collect all key articles from all timeframes
    for (const timeframe in analysis) {
      if (analysis[timeframe] && analysis[timeframe].key_articles) {
        allKeyArticles.push(...analysis[timeframe].key_articles);
      }
    }
    
    // Initialize statistics
    const stats = {
      averageCredibilityScore: 0,
      credibilityDistribution: {
        high: 0,
        credible: 0,
        moderate: 0,
        questionable: 0,
        low: 0
      },
      sourcesUsed: [],
      politicalBalanceIndex: 0, // 0 means balanced, positive means right-leaning, negative means left-leaning
    };
    
    if (allKeyArticles.length === 0) {
      return stats;
    }
    
    // Calculate average credibility score
    let totalScore = 0;
    let articleCount = 0;
    let leftBiasCount = 0;
    let rightBiasCount = 0;
    const sourceDomains = new Set();
    
    allKeyArticles.forEach(article => {
      if (article.credibilityScore && article.credibilityScore.score) {
        totalScore += article.credibilityScore.score;
        articleCount++;
        
        // Track credibility distribution
        const rating = article.credibilityScore.rating;
        if (rating === 'high credibility') stats.credibilityDistribution.high++;
        else if (rating === 'credible') stats.credibilityDistribution.credible++;
        else if (rating === 'moderate credibility') stats.credibilityDistribution.moderate++;
        else if (rating === 'questionable') stats.credibilityDistribution.questionable++;
        else if (rating === 'low credibility') stats.credibilityDistribution.low++;
        
        // Track bias balance
        if (article.biasAssessment) {
          if (['moderate-left', 'strong-left'].includes(article.biasAssessment.politicalBias)) {
            leftBiasCount++;
          } else if (['moderate-right', 'strong-right'].includes(article.biasAssessment.politicalBias)) {
            rightBiasCount++;
          }
        }
        
        // Track unique sources
        if (article.url) {
          try {
            const domain = new URL(article.url).hostname;
            sourceDomains.add(domain);
          } catch (e) {
            // Ignore URL parsing errors
          }
        }
      }
    });
    
    // Calculate the statistics
    stats.averageCredibilityScore = articleCount > 0 ? Math.round(totalScore / articleCount) : 0;
    stats.politicalBalanceIndex = rightBiasCount - leftBiasCount;
    stats.sourcesUsed = Array.from(sourceDomains);
    
    return stats;
  }

  /**
   * Clear all caches in the system
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async clearCache(req, res, next) {
    try {
      console.log('Starting cache clearing process...');
      
      // Clear the MongoDB news cache
      const clearCount = await NewsCache.clearAll();
      
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        details: {
          entriesRemoved: clearCount
        }
      });
      
      console.log('Cache clearing complete');
    } catch (error) {
      console.error('Error clearing cache:', error);
      next(error);
    }
  }

  /**
   * Get hot stocks with analysis
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async getHotStocks(req, res, next) {
    try {
      // Try to get from cache first
      const cachedHotStocks = await NewsCache.getHotStocks();
      if (cachedHotStocks) {
        return res.json({
          timestamp: new Date(),
          source: 'cache',
          stocks: cachedHotStocks
        });
      }

      // Find stocks with high sentiment scores from existing cache
      const hotStocks = await NewsCache.findHotStocks();
      
      // If we don't have enough hot stocks, search for trending stock terms
      if (hotStocks.length < HOT_STOCKS_LIMIT) {
        const trendingStocks = await newsService.findTrendingStocks();
        
        // Analyze each new trending stock
        const newAnalyses = await Promise.all(
          trendingStocks
            .filter(symbol => !hotStocks.some(hot => hot.symbol === symbol))
            .map(async (symbol) => {
              try {
                const { articles, count } = await newsService.collectAndAnalyzeNews(symbol, 30);
                const analysis = await openaiService.analyzeArticles(symbol, articles);
                
                const sourceCredibilityStats = this.calculateSourceCredibilityStats(analysis);
                
                // Save to individual stock cache
                await NewsCache.save(symbol, analysis, {
                  sourceCredibility: sourceCredibilityStats,
                  articleCount: count,
                  ttlHours: 0.5
                });

                return {
                  symbol,
                  analysis,
                  sourceCredibility: sourceCredibilityStats,
                  articleCount: count,
                  lastUpdated: new Date()
                };
              } catch (error) {
                console.error(`Error analyzing trending stock ${symbol}:`, error);
                return null;
              }
            })
        );

        // Add valid new analyses to hot stocks
        hotStocks.push(...newAnalyses.filter(analysis => 
          analysis !== null && 
          Object.values(analysis.analysis).some(timeframe => 
            Math.abs(timeframe.sentiment) >= HOT_STOCK_SENTIMENT_THRESHOLD
          )
        ));
        
        // Sort and limit
        hotStocks.sort((a, b) => {
          const aMaxSentiment = Math.max(...Object.values(a.analysis)
            .map(timeframe => Math.abs(timeframe.sentiment)));
          const bMaxSentiment = Math.max(...Object.values(b.analysis)
            .map(timeframe => Math.abs(timeframe.sentiment)));
          return bMaxSentiment - aMaxSentiment;
        }).slice(0, HOT_STOCKS_LIMIT);
      }
      
      // Save to hot stocks cache
      await NewsCache.saveHotStocks(hotStocks);

      res.json({
        timestamp: new Date(),
        source: 'fresh',
        stocks: hotStocks
      });
    } catch (error) {
      console.error('Error getting hot stocks:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 