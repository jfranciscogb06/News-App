const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      // Step 1: Get article titles
      const articleTitles = await newsService.getArticleTitles(symbol);
      
      if (!articleTitles.length) {
        return res.status(404).json({ error: 'No articles found for this stock' });
      }

      // Step 2: Filter relevant articles using OpenAI
      const relevantArticles = await openaiService.filterRelevantArticles(symbol, articleTitles);

      // Step 3: Get full content for selected articles
      const selectedUrls = [
        ...relevantArticles.selected_articles["7days"],
        ...relevantArticles.selected_articles["1month"],
        ...relevantArticles.selected_articles["3months"],
        ...relevantArticles.selected_articles["6months"]
      ];
      const detailedArticles = await newsService.getArticleDetails(selectedUrls);

      // Step 4: Perform detailed analysis
      const analysis = await openaiService.analyzeArticles(symbol, detailedArticles);

      const result = {
        symbol,
        timestamp: new Date(),
        analysis
      };

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StockController(); 