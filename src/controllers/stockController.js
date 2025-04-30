const stockAnalysisService = require('../services/stockAnalysisService');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

class StockController {
  /**
   * Analyze a single stock
   */
  async analyzeStock(req, res, next) {
    try {
      const symbol = req.params.symbol?.toUpperCase();
      
      if (!symbol) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'Stock symbol is required'
        });
      }

      // Check cache first
      const cachedData = await cacheService.getStockData(symbol);
      if (cachedData) {
        logger.info(`Returning cached data for ${symbol}`);
        return res.json({
          ...cachedData,
          fromCache: true
        });
      }

      // Perform fresh analysis
      const analysis = await stockAnalysisService.analyzeStock(symbol);
      
      // Cache the results
      await cacheService.cacheStockData(symbol, analysis);

      return res.json({
        ...analysis,
        fromCache: false
      });
    } catch (error) {
      logger.error('Error in stock analysis:', error);
      next(error);
    }
  }

  /**
   * Analyze multiple stocks in parallel
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

      // Normalize and validate symbols
      const validSymbols = symbols
        .map(s => String(s).toUpperCase().trim())
        .filter(s => s.length > 0 && s.length <= 5)
        .slice(0, 10); // Limit to 10 stocks per request

      if (validSymbols.length === 0) {
        return res.status(400).json({
          error: 'Invalid symbols',
          message: 'No valid stock symbols provided'
        });
      }

      // Process all stocks in parallel
      const startTime = Date.now();
      const results = await Promise.all(
        validSymbols.map(async symbol => {
          try {
            // Check cache first
            const cachedData = await cacheService.getStockData(symbol);
            if (cachedData) {
              return {
                symbol,
                data: cachedData,
                fromCache: true
              };
            }

            // Perform fresh analysis
            const analysis = await stockAnalysisService.analyzeStock(symbol);
            
            // Cache the results (non-blocking)
            cacheService.cacheStockData(symbol, analysis).catch(err => 
              logger.error(`Error caching data for ${symbol}:`, err)
            );

            return {
              symbol,
              data: analysis,
              fromCache: false
            };
          } catch (error) {
            logger.error(`Error analyzing ${symbol}:`, error);
            return {
              symbol,
              error: error.message
            };
          }
        })
      );

      // Format response
      const response = {
        results: {},
        errors: {},
        stats: {
          total: validSymbols.length,
          success: 0,
          error: 0,
          fromCache: 0
        },
        processingTime: (Date.now() - startTime) / 1000
      };

      results.forEach(result => {
        if (result.error) {
          response.errors[result.symbol] = { error: result.error };
          response.stats.error++;
        } else {
          response.results[result.symbol] = result.data;
          response.stats.success++;
          if (result.fromCache) response.stats.fromCache++;
        }
      });

      return res.json(response);
    } catch (error) {
      logger.error('Error in batch stock analysis:', error);
      next(error);
    }
  }

  /**
   * Clear the cache for all stocks
   */
  async clearCache(req, res, next) {
    try {
      await cacheService.clearPopularCache();
      return res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      logger.error('Error clearing cache:', error);
      next(error);
    }
  }

  /**
   * Get popular stocks from cache
   */
  async getPopularStocks(req, res, next) {
    try {
      const popularStocks = await cacheService.getPopularStocksFromSearchHistory();
      return res.json({
        success: true,
        stocks: popularStocks
      });
    } catch (error) {
      logger.error('Error getting popular stocks:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 