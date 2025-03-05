const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');

class StockController {
  async analyzeStock(req, res, next) {
    try {
      const { symbol } = req.params;
      
      // Step 1: Get article titles
      const articleTitles = await newsService.getArticleTitles(symbol);
      
      if (!articleTitles.length) {
        return res.status(404).json({ 
          error: 'No articles found',
          details: 'Could not find any news articles for this stock symbol'
        });
      }

      // Step 2: Filter relevant articles using OpenAI
      let relevantArticles;
      try {
        relevantArticles = await openaiService.filterRelevantArticles(symbol, articleTitles);
      } catch (filterError) {
        console.error('Article filtering error:', filterError);
        return res.status(500).json({
          error: 'Analysis error',
          details: 'Failed to filter relevant articles',
          message: filterError.message
        });
      }

      // Step 3: Get full content for selected articles
      const selectedUrls = Object.values(relevantArticles.selected_articles)
        .flat()
        .filter(Boolean);

      if (!selectedUrls.length) {
        return res.status(404).json({
          error: 'No relevant articles',
          details: 'No articles were found to be relevant for analysis'
        });
      }

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
      console.error('Analysis error:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 