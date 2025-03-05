const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      const analysis = await newsService.collectAndAnalyzeNews(symbol);
      
      const result = {
        symbol,
        timestamp: new Date(),
        analysis
      };

      res.json(result);
    } catch (error) {
      console.error('Analysis error:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 