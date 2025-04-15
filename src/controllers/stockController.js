const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const cacheService = require('../services/cacheService');
const sourceValidationService = require('../services/sourceValidationService');
const sentimentAnalysisService = require('../services/sentimentAnalysisService');
const queueService = require('../services/queueService');
const logger = require('../utils/logger');

class StockController {
  /**
   * Analyze a stock based on news articles
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async analyzeStock(req, res, next) {
    try {
      const symbol = req.symbol || req.params.symbol;
      const analysisDate = req.analysisDate || req.query?.analysisDate;
      const ignoreAfter = req.ignoreAfter || req.query?.ignoreAfter;
      
      if (!symbol) {
        const error = new Error('Stock symbol is required');
        if (res && res.status) {
          return res.status(400).json({ error: error.message });
        }
        throw error;
      }
      
      logger.info(`Processing analysis request for ${symbol}`);
      
      // Only use cache if not doing historical analysis
      if (!analysisDate && !ignoreAfter) {
        const cachedData = await cacheService.getStockData(symbol);
        if (cachedData) {
          logger.info(`Returning cached data for ${symbol}`);
          if (res && res.json) {
            return res.json(cachedData);
          }
          return cachedData;
        }
      }
      
      // Clear symbol cache using the correct method name
      await cacheService.clearSymbolCache(symbol);
      
      let articles = [];
      try {
        articles = await newsService.collectAndAnalyzeNews(symbol, 30, analysisDate, ignoreAfter);
      } catch (error) {
        logger.warn(`Error collecting news for ${symbol}: ${error.message}`);
        // Continue with empty articles array
      }
      
      // If no articles found, return a structured response instead of throwing an error
      if (!articles || articles.length === 0) {
        const response = {
          symbol,
          articles: [],
          sentimentAnalysis: {
            '7days': { prediction: 'NEUTRAL', confidence: 'low', magnitude: 'minimal' },
            '1month': { prediction: 'NEUTRAL', confidence: 'low', magnitude: 'minimal' },
            '3months': { prediction: 'NEUTRAL', confidence: 'low', magnitude: 'minimal' },
            '6months': { prediction: 'NEUTRAL', confidence: 'low', magnitude: 'minimal' }
          },
          sourceStats: {
            averageCredibilityScore: 0,
            credibilityDistribution: {},
            sourcesUsed: [],
            politicalBalanceIndex: 0
          },
          timestamp: new Date().toISOString(),
          fromCache: false,
          articleCount: 0,
          status: 'no_articles'
        };
        
        if (res && res.json) {
          return res.json(response);
        }
        return response;
      }
      
      // Use sentiment analysis service in parallel with other processing
      const [sentimentAnalysis, sourceStats] = await Promise.all([
        sentimentAnalysisService.analyzeSentimentAndPredict(symbol, articles),
        this.calculateSourceCredibilityStats(articles)
      ]);
      
      const response = {
        symbol,
        articles,
        sentimentAnalysis,
        sourceStats,
        timestamp: new Date().toISOString(),
        fromCache: false,
        articleCount: articles.length,
        status: 'success'
      };
      
      // Only cache if not doing historical analysis
      if (!analysisDate && !ignoreAfter) {
        await cacheService.cacheStockData(symbol, response);
      }
      
      if (res && res.json) {
        return res.json(response);
      }
      return response;
    } catch (error) {
      logger.error('Error in stock analysis:', { error });
      if (res && next) {
        return next(error);
      }
      throw error;
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
      
      // Clear the PostgreSQL cache
      const success = await cacheService.clearPopularCache();
      
      res.json({
        success,
        message: success ? 'Cache cleared successfully' : 'Failed to clear cache'
      });
      
      console.log('Cache clearing complete');
    } catch (error) {
      console.error('Error clearing cache:', error);
      next(error);
    }
  }

  /**
   * Get popular stocks from the cache service
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async getPopularStocks(req, res, next) {
    try {
      console.log('Getting popular stocks...');
      const symbols = await cacheService.getTop100PopularStocks();
      
      if (!symbols || symbols.length === 0) {
        return res.status(404).json({
          error: 'No popular stocks found',
          message: 'Could not retrieve popular stocks at this time'
        });
      }

      // Start a job to process all stocks in parallel and wait for the result
      const batchResult = await queueService.addJob('analysis', async () => {
        try {
          const startTime = Date.now();
          
          // Process all stocks in parallel with individual jobs
          const analysisPromises = symbols.map(async (symbol) => {
            try {
              // Try to get from cache first
              const cachedData = await cacheService.getStockData(symbol);
              
              if (cachedData) {
                logger.info(`Using cached data for ${symbol}`);
                return { symbol, data: cachedData, source: 'cache' };
              }
              
              // If not in cache, start an analysis job
              return queueService.addJob('analysis', async () => {
                logger.info(`Starting analysis job for ${symbol}`);
                
                // Collect and analyze news
                const articles = await newsService.collectAndAnalyzeNews(symbol, 30);
                
                if (!articles || articles.length === 0) {
                  logger.warn(`No articles found for ${symbol}`);
                  return { 
                    symbol, 
                    error: 'No news articles found',
                    source: 'error'
                  };
                }
                
                // Use sentiment analysis service in parallel with other stocks
                const sentimentAnalysis = await sentimentAnalysisService.analyzeSentimentAndPredict(symbol, articles);
                
                // Process timeframes in parallel
                const sourceCredibilityStats = this.calculateSourceCredibilityStats(sentimentAnalysis);
                const timeframeSummaries = await openaiService.summarizeTimeframes(sentimentAnalysis, symbol);
                
                // Create the full response
                const result = {
                  symbol,
                  timestamp: new Date(),
                  timeframeSummaries,
                  sentimentAnalysis,
                  source: 'fresh',
                  articleCount: articles.length,
                  sourceCredibility: sourceCredibilityStats
                };
                
                // Cache the result with the pre-analyzed data (non-blocking)
                queueService.addJob('caching', async () => {
                  try {
                    await cacheService.cacheStockData(symbol, result);
                    logger.info(`Successfully cached analysis for ${symbol}`);
                  } catch (err) {
                    logger.error(`Error caching data for ${symbol}:`, err.message);
                  }
                }, { symbol });
                
                logger.info(`Completed analysis for ${symbol}`);
                return { symbol, data: result, source: 'fresh' };
              }, { symbol });
            } catch (error) {
              logger.error(`Error analyzing ${symbol}:`, error);
              return { 
                symbol, 
                error: error.message,
                source: 'error'
              };
            }
          });
          
          // Wait for all analysis jobs to complete
          const results = await Promise.all(analysisPromises);
          
          // Format the response
          const successResults = {};
          const errorResults = {};
          
          results.forEach(result => {
            if (result.error) {
              errorResults[result.symbol] = { error: result.error };
            } else {
              successResults[result.symbol] = result.data;
            }
          });
          
          const response = {
            results: successResults,
            errors: Object.keys(errorResults).length > 0 ? errorResults : undefined,
            count: {
              total: symbols.length,
              success: Object.keys(successResults).length,
              error: Object.keys(errorResults).length
            },
            timestamp: new Date(),
            processingTime: (Date.now() - startTime) / 1000
          };
          
          logger.info(`Batch analysis complete in ${response.processingTime.toFixed(2)}s`);
          return response;
        } catch (error) {
          logger.error('Error in batch stock analysis job:', error);
          throw error;
        }
      }, { symbols });

      // Return the complete response
      return res.json(batchResult);
    } catch (error) {
      console.error('Error getting popular stocks:', error);
      next(error);
    }
  }

  /**
   * Analyze multiple stocks in parallel
   * @param {Object} req - Express request object with an array of stock symbols in the body
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
  async analyzeMultipleStocks(req, res, next) {
    try {
      const { symbols } = req.body;
      
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ 
          error: 'Invalid request',
          message: 'Please provide an array of stock symbols'
        });
      }
      
      // Normalize symbols and limit to a reasonable number
      const normalizedSymbols = symbols
        .map(symbol => (typeof symbol === 'string' ? symbol.toUpperCase().trim() : ''))
        .filter(symbol => symbol && symbol.length <= 5)
        .slice(0, 20); // Limit to 20 stocks per request for performance
      
      if (normalizedSymbols.length === 0) {
        return res.status(400).json({ 
          error: 'Invalid symbols',
          message: 'No valid stock symbols provided'
        });
      }
      
      logger.info(`Processing batch analysis for ${normalizedSymbols.length} stocks`);
      
      // Start a job to process all stocks in parallel and wait for the result
      const batchResult = await queueService.addJob('analysis', async () => {
        try {
          const startTime = Date.now();
          
          // Process all stocks in parallel with individual jobs
          const analysisPromises = normalizedSymbols.map(async (symbol) => {
            try {
              // Try to get from cache first
              const cachedData = await cacheService.getStockData(symbol);
              
              if (cachedData) {
                logger.info(`Using cached data for ${symbol}`);
                return { symbol, data: cachedData, source: 'cache' };
              }
              
              // If not in cache, start an analysis job
              return queueService.addJob('analysis', async () => {
                logger.info(`Starting analysis job for ${symbol}`);
                
                // Collect and analyze news
                const articles = await newsService.collectAndAnalyzeNews(symbol, 30);
                
                if (!articles || articles.length === 0) {
                  logger.warn(`No articles found for ${symbol}`);
                  return { 
                    symbol, 
                    error: 'No news articles found',
                    source: 'error'
                  };
                }
                
                // Use sentiment analysis service in parallel with other stocks
                const sentimentAnalysis = await sentimentAnalysisService.analyzeSentimentAndPredict(symbol, articles);
                
                // Process timeframes in parallel
                const sourceCredibilityStats = this.calculateSourceCredibilityStats(sentimentAnalysis);
                const timeframeSummaries = await openaiService.summarizeTimeframes(sentimentAnalysis, symbol);
                
                // Create the full response
                const result = {
                  symbol,
                  timestamp: new Date(),
                  timeframeSummaries,
                  sentimentAnalysis,
                  source: 'fresh',
                  articleCount: articles.length,
                  sourceCredibility: sourceCredibilityStats
                };
                
                // Cache the result with the pre-analyzed data (non-blocking)
                queueService.addJob('caching', async () => {
                  try {
                    await cacheService.cacheStockData(symbol, result);
                    logger.info(`Successfully cached analysis for ${symbol}`);
                  } catch (err) {
                    logger.error(`Error caching data for ${symbol}:`, err.message);
                  }
                }, { symbol });
                
                logger.info(`Completed analysis for ${symbol}`);
                return { symbol, data: result, source: 'fresh' };
              }, { symbol });
            } catch (error) {
              logger.error(`Error analyzing ${symbol}:`, error);
              return { 
                symbol, 
                error: error.message,
                source: 'error'
              };
            }
          });
          
          // Wait for all analysis jobs to complete
          const results = await Promise.all(analysisPromises);
          
          // Format the response
          const successResults = {};
          const errorResults = {};
          
          results.forEach(result => {
            if (result.error) {
              errorResults[result.symbol] = { error: result.error };
            } else {
              successResults[result.symbol] = result.data;
            }
          });
          
          const response = {
            results: successResults,
            errors: Object.keys(errorResults).length > 0 ? errorResults : undefined,
            count: {
              total: normalizedSymbols.length,
              success: Object.keys(successResults).length,
              error: Object.keys(errorResults).length
            },
            timestamp: new Date(),
            processingTime: (Date.now() - startTime) / 1000
          };
          
          logger.info(`Batch analysis complete in ${response.processingTime.toFixed(2)}s`);
          return response;
        } catch (error) {
          logger.error('Error in batch stock analysis job:', error);
          throw error;
        }
      }, { symbols: normalizedSymbols });
      
      // Return the complete response
      return res.json(batchResult);
    } catch (error) {
      logger.error('Error in batch stock analysis:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 