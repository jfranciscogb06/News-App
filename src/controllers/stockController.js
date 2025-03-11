const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const NewsCache = require('../models/newsCache');
const cacheService = require('../services/cacheService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      // Record this search to track popular stocks
      await cacheService.recordSearch(symbol);
      
      // Try to get from popular stocks cache first (pre-cached top 100)
      const popularCachedData = await cacheService.getStockData(symbol);
      
      if (popularCachedData) {
        // Return pre-cached data for popular stock
        const result = {
          symbol,
          timestamp: new Date(),
          analysis: popularCachedData,
          source: 'popular-cache'
        };
        
        return res.json(result);
      }
      
      // Try to get from regular cache
      const regularCachedData = await NewsCache.getBySymbol(symbol);
      
      if (regularCachedData) {
        // Return cached data
        const result = {
          symbol,
          timestamp: new Date(),
          analysis: regularCachedData,
          source: 'cache'
        };
        
        return res.json(result);
      }
      
      // If not in cache, collect and analyze news
      const analysis = await newsService.collectAndAnalyzeNews(symbol);
      
      // Save to regular cache
      await NewsCache.save(symbol, analysis);
      
      // Clean expired cache entries in the background
      NewsCache.cleanExpired().catch(err => console.error('Error cleaning cache:', err));
      
      const result = {
        symbol,
        timestamp: new Date(),
        analysis,
        source: 'fresh'
      };

      res.json(result);
    } catch (error) {
      console.error('Analysis error:', error);
      next(error);
    }
  }

  async clearCache(req, res, next) {
    try {
      // Clear all cache entries
      const deletedCount = await NewsCache.clearAll();
      
      // Clear popular stocks cache if cacheService is available
      let popularCacheCleared = false;
      if (cacheService && typeof cacheService.clearPopularCache === 'function') {
        popularCacheCleared = await cacheService.clearPopularCache();
      }
      
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        deletedEntries: deletedCount,
        popularCacheCleared
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 