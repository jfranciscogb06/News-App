const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const NewsCache = require('../models/newsCache');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      // Try to get from cache first
      const cachedData = await NewsCache.getBySymbol(symbol);
      
      if (cachedData) {
        // Return cached data
        const result = {
          symbol,
          timestamp: new Date(),
          analysis: cachedData,
          source: 'cache'
        };
        
        return res.json(result);
      }
      
      // If not in cache, collect and analyze news
      const analysis = await newsService.collectAndAnalyzeNews(symbol);
      
      // Save to cache
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
}

module.exports = new StockController(); 