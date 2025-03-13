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
      
      // If not in cache, collect news using enhanced service
      console.log(`Collecting news for ${symbol}...`);
      const { articles, count } = await newsService.collectAndAnalyzeNews(symbol, 30);
      
      console.log(`Collected ${count} articles for ${symbol}, sending to OpenAI for analysis...`);
      
      // Use OpenAI to analyze the collected articles
      const analysis = await openaiService.analyzeArticles(symbol, articles);
      
      // Save to regular cache
      await NewsCache.save(symbol, analysis);
      
      // Clean expired cache entries in the background
      NewsCache.cleanExpired().catch(err => console.error('Error cleaning cache:', err));
      
      const result = {
        symbol,
        timestamp: new Date(),
        analysis,
        source: 'fresh',
        articleCount: count
      };

      res.json(result);
    } catch (error) {
      console.error('Analysis error:', error);
      next(error);
    }
  }

  async clearCache(req, res, next) {
    try {
      // First, stop any ongoing cache processes
      if (cacheService && typeof cacheService.cancelAllCacheTimers === 'function') {
        cacheService.cancelAllCacheTimers();
      }
      
      // Clear MongoDB news cache
      const deletedCount = await NewsCache.clearAll();
      
      // Clear popular searches collection
      const mongoose = require('mongoose');
      const PopularSearchModel = mongoose.model('PopularSearch');
      const searchesDeleted = await PopularSearchModel.deleteMany({});
      console.log(`Cleared popular searches: ${searchesDeleted.deletedCount} entries deleted`);
      
      // Clear popular stocks cache if cacheService is available
      let popularCacheCleared = false;
      if (cacheService && typeof cacheService.clearPopularCache === 'function') {
        popularCacheCleared = await cacheService.clearPopularCache();
      }
      
      // Reset any application-level caches or variables
      global.cacheLastRefreshed = null;
      
      // Send response - let the system restart the caching process on its own
      res.json({
        success: true,
        message: 'All caches cleared successfully',
        newsCacheDeleted: deletedCount,
        searchesDeleted: searchesDeleted.deletedCount,
        popularCacheCleared
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 