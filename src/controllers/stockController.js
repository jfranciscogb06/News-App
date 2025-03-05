const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const polygonService = require('../services/polygonService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      // Get stock details and prices from Polygon.io
      const [stockDetails, stockPrices] = await Promise.all([
        polygonService.getStockDetails(symbol),
        polygonService.getDailyPrices(symbol)
      ]);
      
      // Get news articles
      const articles = await newsService.getStockNews(symbol);
      
      if (!articles.length) {
        return res.status(404).json({ error: 'No articles found for this stock' });
      }

      // Get AI analysis
      const analysis = await openaiService.analyzeArticles(symbol, articles, stockDetails, stockPrices);

      const result = {
        symbol,
        timestamp: new Date(),
        stockDetails,
        latestPrice: stockPrices?.[0],
        timeframes: {
          sevenDays: analysis["7days"],
          oneMonth: analysis["1month"],
          threeMonths: analysis["3months"],
          sixMonths: analysis["6months"]
        }
      };

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StockController(); 