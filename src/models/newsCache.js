const mongoose = require('mongoose');

// Define the schema for news cache - using a clear, normalized structure
const newsCacheSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  analysis: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  sourceCredibility: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  articleCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
});

// Create indexes for efficient queries
newsCacheSchema.index({ symbol: 1, expiresAt: 1 });

// Create the model
const NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);

// Add sentiment threshold constant
const HOT_STOCK_SENTIMENT_THRESHOLD = 4; // Absolute sentiment score >= 4 indicates strong movement
const HOT_STOCKS_LIMIT = 10; // Number of hot stocks to track

/**
 * NewsCache class for handling caching of stock news analysis
 */
class NewsCache {
  /**
   * Get cached news analysis for a symbol
   * @param {string} symbol - Stock symbol to retrieve
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  static async getBySymbol(symbol) {
    try {
      // Validate input
      if (!symbol || typeof symbol !== 'string') {
        console.error('Invalid symbol provided to cache lookup');
        return null;
      }

      const normalizedSymbol = symbol.toUpperCase().trim();
      
      const result = await NewsCacheModel.findOne({
        symbol: normalizedSymbol,
        expiresAt: { $gt: new Date() }
      });
      
      if (!result) {
        console.log(`Cache miss for symbol: ${normalizedSymbol}`);
        return null;
      }
      
      console.log(`Cache hit for symbol: ${normalizedSymbol}, expires in ${this.getTimeUntilExpiry(result.expiresAt)}`);
      
      // Transform the data into the exact format expected by the client
      return {
        symbol: normalizedSymbol,
        timestamp: new Date(),
        analysis: result.analysis,
        source: 'cache',
        articleCount: result.articleCount,
        sourceCredibility: result.sourceCredibility
      };
    } catch (error) {
      console.error(`Error retrieving cache for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Save analysis data to cache
   * @param {string} symbol - Stock symbol
   * @param {Object} analysis - Analysis data to cache
   * @param {Object} options - Additional options (sourceCredibility, articleCount, ttlHours)
   * @returns {Promise<boolean>} - Success status
   */
  static async save(symbol, analysis, options = {}) {
    try {
      // Validate input
      if (!symbol || !analysis) {
        console.error('Missing required parameters for cache save');
        return false;
      }

      const normalizedSymbol = symbol.toUpperCase().trim();
      
      // Extract options with defaults
      const { 
        sourceCredibility = null,
        articleCount = 0,
        ttlHours = 0.5 // Default TTL: 30 minutes (changed from 24 hours)
      } = options;
      
      // Calculate expiration with slight randomization to prevent cache stampedes
      const randomMinutes = Math.floor(Math.random() * 30); // 0-30 minutes of randomness
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + ttlHours);
      expiresAt.setMinutes(expiresAt.getMinutes() + randomMinutes);
      
      // Remove any existing entries for this symbol
      await NewsCacheModel.deleteMany({ symbol: normalizedSymbol });
      
      // Create the new cache entry
      const cacheEntry = new NewsCacheModel({
        symbol: normalizedSymbol,
        analysis,
        sourceCredibility,
        articleCount,
        expiresAt
      });
      
      await cacheEntry.save();
      
      // Log expiration time in minutes for short TTLs
      const ttlMinutes = ttlHours * 60;
      console.log(`Cache saved for ${normalizedSymbol}, expires in ${ttlMinutes.toFixed(0)} minutes (plus ${randomMinutes} minutes of randomness)`);
      return true;
    } catch (error) {
      console.error(`Error saving cache for ${symbol}:`, error);
      return false;
    }
  }

  /**
   * Clean expired cache entries
   * @returns {Promise<number>} - Number of deleted entries
   */
  static async cleanExpired() {
    try {
      const result = await NewsCacheModel.deleteMany({
        expiresAt: { $lte: new Date() }
      });
      
      const count = result.deletedCount;
      if (count > 0) {
        console.log(`Cleaned ${count} expired cache entries`);
      }
      
      return count;
    } catch (error) {
      console.error('Error cleaning expired cache:', error);
      return 0;
    }
  }

  /**
   * Clear all cache entries
   * @returns {Promise<number>} - Number of cleared entries
   */
  static async clearAll() {
    try {
      const result = await NewsCacheModel.deleteMany({});
      console.log(`Cleared all cache: ${result.deletedCount} entries removed`);
      return result.deletedCount;
    } catch (error) {
      console.error('Error clearing all cache:', error);
      return 0;
    }
  }

  /**
   * Clear cache for a specific symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<number>} - Number of cleared entries
   */
  static async clearBySymbol(symbol) {
    try {
      const normalizedSymbol = symbol.toUpperCase().trim();
      const result = await NewsCacheModel.deleteMany({ symbol: normalizedSymbol });
      
      if (result.deletedCount > 0) {
        console.log(`Cleared cache for ${normalizedSymbol}: ${result.deletedCount} entries`);
      }
      
      return result.deletedCount;
    } catch (error) {
      console.error(`Error clearing cache for ${symbol}:`, error);
      return 0;
    }
  }

  /**
   * Helper to get formatted time until expiry
   * @param {Date} expiryDate - Expiry date
   * @returns {string} - Formatted time string
   */
  static getTimeUntilExpiry(expiryDate) {
    const now = new Date();
    const diffMs = expiryDate - now;
    
    if (diffMs <= 0) return 'expired';
    
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${diffHrs}h ${diffMins}m`;
  }

  /**
   * Find hot stocks and their most significant timeframes
   * @returns {Promise<Array<Object>>} Array of hot stock analyses
   */
  static async findHotStocks() {
    try {
      const results = await NewsCacheModel.find({
        expiresAt: { $gt: new Date() }
      });
      
      const hotStocks = results
        .map(entry => {
          // Find the timeframe with the highest absolute sentiment
          let maxSentiment = 0;
          let significantTimeframe = null;
          let timeframeAnalysis = null;

          Object.entries(entry.analysis).forEach(([timeframe, analysis]) => {
            const absSentiment = Math.abs(analysis.sentiment);
            if (absSentiment > maxSentiment) {
              maxSentiment = absSentiment;
              significantTimeframe = timeframe;
              timeframeAnalysis = analysis;
            }
          });

          // Only include stocks with significant sentiment
          if (maxSentiment >= HOT_STOCK_SENTIMENT_THRESHOLD) {
            return {
              symbol: entry.symbol,
              timeframe: significantTimeframe,
              analysis: {
                [significantTimeframe]: timeframeAnalysis
              },
              sourceCredibility: entry.sourceCredibility,
              articleCount: entry.articleCount,
              sentimentScore: maxSentiment
            };
          }
          return null;
        })
        .filter(stock => stock !== null)
        // Sort by absolute sentiment score (highest first)
        .sort((a, b) => b.sentimentScore - a.sentimentScore)
        .slice(0, HOT_STOCKS_LIMIT);

      return hotStocks;
    } catch (error) {
      console.error('Error finding hot stocks:', error);
      return [];
    }
  }

  /**
   * Save hot stocks analysis to cache
   * @param {Array<Object>} stocks - Array of stock analyses with significant timeframes
   * @returns {Promise<boolean>} - Success status
   */
  static async saveHotStocks(stocks) {
    try {
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);
      
      await HotStocksModel.deleteMany({});
      
      const cacheEntry = new HotStocksModel({
        stocks: stocks.map(stock => ({
          ...stock,
          lastUpdated: new Date()
        })),
        expiresAt
      });
      
      await cacheEntry.save();
      
      const timeframeDetails = stocks.map(s => 
        `${s.symbol}(${s.timeframe}:${s.sentimentScore})`
      ).join(', ');
      
      console.log(`Cached ${stocks.length} hot stocks with significant timeframes: ${timeframeDetails}`);
      return true;
    } catch (error) {
      console.error('Error saving hot stocks cache:', error);
      return false;
    }
  }
}

module.exports = NewsCache; 