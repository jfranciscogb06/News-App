const newsService = require('../services/newsService');
const openaiService = require('../services/openaiService');
const NewsCache = require('../models/newsCache');
const cacheService = require('../services/cacheService');
const sourceValidationService = require('../services/sourceValidationService');

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
      
      // Add source validation metadata to the analysis
      // This enhances the response with credibility info for each key article
      for (const timeframe in analysis) {
        if (analysis[timeframe] && analysis[timeframe].key_articles) {
          analysis[timeframe].key_articles = analysis[timeframe].key_articles.map(article => {
            // Only validate articles that weren't validated during collection
            if (!article.credibilityScore) {
              const validatedArticle = sourceValidationService.validateArticleSource(article);
              return validatedArticle;
            }
            return article;
          });
        }
      }
      
      // Save to regular cache
      await NewsCache.save(symbol, analysis);
      
      // Clean expired cache entries in the background
      NewsCache.cleanExpired().catch(err => console.error('Error cleaning cache:', err));
      
      // Add some metadata about source credibility to the response
      const sourceCredibilityStats = this.calculateSourceCredibilityStats(analysis);
      
      const result = {
        symbol,
        timestamp: new Date(),
        analysis,
        source: 'fresh',
        articleCount: count,
        sourceCredibility: sourceCredibilityStats
      };

      res.json(result);
    } catch (error) {
      console.error('Analysis error:', error);
      next(error);
    }
  }
  
  // Helper method to calculate source credibility statistics
  calculateSourceCredibilityStats(analysis) {
    const allKeyArticles = [];
    
    // Collect all key articles from all timeframes
    for (const timeframe in analysis) {
      if (analysis[timeframe] && analysis[timeframe].key_articles) {
        allKeyArticles.push(...analysis[timeframe].key_articles);
      }
    }
    
    // Initialize statistics
    const stats = {
      averageCredibilityScore: 0,
      credibilityDistribution: {
        high: 0,
        credible: 0,
        moderate: 0,
        questionable: 0,
        low: 0
      },
      sourcesUsed: [],
      politicalBalanceIndex: 0, // 0 means balanced, positive means right-leaning, negative means left-leaning
    };
    
    if (allKeyArticles.length === 0) {
      return stats;
    }
    
    // Calculate average credibility score
    let totalScore = 0;
    let articleCount = 0;
    let leftBiasCount = 0;
    let rightBiasCount = 0;
    const sourceDomains = new Set();
    
    allKeyArticles.forEach(article => {
      if (article.credibilityScore && article.credibilityScore.score) {
        totalScore += article.credibilityScore.score;
        articleCount++;
        
        // Track credibility distribution
        const rating = article.credibilityScore.rating;
        if (rating === 'high credibility') stats.credibilityDistribution.high++;
        else if (rating === 'credible') stats.credibilityDistribution.credible++;
        else if (rating === 'moderate credibility') stats.credibilityDistribution.moderate++;
        else if (rating === 'questionable') stats.credibilityDistribution.questionable++;
        else if (rating === 'low credibility') stats.credibilityDistribution.low++;
        
        // Track bias balance
        if (article.biasAssessment) {
          if (['moderate-left', 'strong-left'].includes(article.biasAssessment.politicalBias)) {
            leftBiasCount++;
          } else if (['moderate-right', 'strong-right'].includes(article.biasAssessment.politicalBias)) {
            rightBiasCount++;
          }
        }
        
        // Track unique sources
        if (article.url) {
          try {
            const domain = new URL(article.url).hostname;
            sourceDomains.add(domain);
          } catch (e) {
            // Ignore URL parsing errors
          }
        }
      }
    });
    
    // Calculate the statistics
    stats.averageCredibilityScore = articleCount > 0 ? Math.round(totalScore / articleCount) : 0;
    stats.politicalBalanceIndex = rightBiasCount - leftBiasCount;
    stats.sourcesUsed = Array.from(sourceDomains);
    
    return stats;
  }

  async clearCache(req, res, next) {
    try {
      console.log('Starting complete cache clear process...');
      
      // First, stop any ongoing cache processes
      if (cacheService && typeof cacheService.cancelAllCacheTimers === 'function') {
        cacheService.cancelAllCacheTimers();
      }
      
      // Get the mongoose connection
      const mongoose = require('mongoose');
      
      // Helper function to drop a collection
      const dropCollection = async (name) => {
        try {
          await mongoose.connection.dropCollection(name);
          console.log(`Dropped collection: ${name}`);
          return { success: true, message: `Dropped collection: ${name}` };
        } catch (error) {
          if (error.code === 26) {
            console.log(`Collection ${name} doesn't exist, nothing to drop`);
            return { success: true, message: `Collection ${name} doesn't exist` };
          }
          console.error(`Error dropping collection ${name}:`, error);
          return { success: false, message: `Error dropping ${name}: ${error.message}` };
        }
      };
      
      // Try to drop collections directly (most aggressive approach)
      const results = {
        collections: [],
        deletedEntries: 0,
        errors: []
      };
      
      // Get all collections in the database
      const collections = await mongoose.connection.db.listCollections().toArray();
      
      // Track which collections to drop
      const cachePatternsToMatch = ['cache', 'news', 'popular', 'stock', 'article'];
      
      // Loop through collections and drop cache-related ones
      for (const collection of collections) {
        const name = collection.name;
        
        // Check if it's a cache-related collection
        const isCacheCollection = cachePatternsToMatch.some(pattern => 
          name.toLowerCase().includes(pattern)
        );
        
        if (isCacheCollection) {
          const result = await dropCollection(name);
          results.collections.push({ name, ...result });
        }
      }
      
      // Fallback: Clear MongoDB news cache if dropping collections failed
      try {
        const deletedCount = await NewsCache.clearAll();
        results.deletedEntries += deletedCount;
        console.log(`Cleared NewsCache: ${deletedCount} entries deleted`);
      } catch (error) {
        console.error('Error clearing NewsCache:', error);
        results.errors.push(`NewsCache error: ${error.message}`);
      }
      
      // Clear popular searches collection
      try {
        const PopularSearchModel = mongoose.model('PopularSearch');
        const searchesDeleted = await PopularSearchModel.deleteMany({});
        console.log(`Cleared popular searches: ${searchesDeleted.deletedCount} entries deleted`);
        results.deletedEntries += searchesDeleted.deletedCount;
      } catch (error) {
        console.error('Error clearing PopularSearch:', error);
        results.errors.push(`PopularSearch error: ${error.message}`);
      }
      
      // Clear popular stocks cache if cacheService is available
      let popularCacheCleared = false;
      if (cacheService && typeof cacheService.clearPopularCache === 'function') {
        popularCacheCleared = await cacheService.clearPopularCache();
      }
      
      // Reset any application-level caches or variables
      global.cacheLastRefreshed = null;
      
      // Force garbage collection if available
      if (global.gc) {
        console.log('Running garbage collection...');
        global.gc();
      }
      
      // Send response - let the system restart the caching process on its own
      res.json({
        success: true,
        message: 'All caches cleared successfully',
        details: {
          collections: results.collections,
          deletedEntries: results.deletedEntries,
          popularCacheCleared,
          errors: results.errors
        }
      });
      
      console.log('Cache clearing complete. Server should be restarted for a full reset.');
    } catch (error) {
      console.error('Error clearing cache:', error);
      next(error);
    }
  }
}

module.exports = new StockController(); 