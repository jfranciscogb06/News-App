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

      // Validate the response structure
      if (!relevantArticles?.selected_articles) {
        throw new Error('Invalid response format from article filtering');
      }

      // Step 3: Get full content for selected articles
      const selectedUrls = Object.values(relevantArticles.selected_articles)
        .flat()
        .filter(Boolean); // Remove any null/undefined values

      if (!selectedUrls.length) {
        return res.status(404).json({ error: 'No relevant articles found for analysis' });
      }

      const detailedArticles = await newsService.getArticleDetails(selectedUrls);

      if (!detailedArticles.length) {
        return res.status(404).json({ error: 'Could not fetch article details' });
      }

      // Step 4: Perform detailed analysis
      const analysis = await openaiService.analyzeArticles(symbol, detailedArticles);

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