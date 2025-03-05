const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      const articles = await newsService.getStockNews(symbol);
      
      if (!articles.length) {
        return res.status(404).json({ error: 'No articles found for this stock' });
      }

      const analysis = await openaiService.analyzeArticles(symbol, articles);

      const result = {
        symbol,
        timestamp: new Date(),
        analysis,
      };

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StockController(); 