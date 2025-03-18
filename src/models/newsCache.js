const mongoose = require('mongoose');
const NodeCache = require('node-cache');

// In-memory cache with 5-minute TTL
const memoryCache = new NodeCache({ stdTTL: 300 });

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
  },
  version: {
    type: Number,
    default: 1
  }
});

// Create indexes for efficient queries
newsCacheSchema.index({ symbol: 1, expiresAt: 1 });
newsCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 }); // Auto-delete after 1 hour

// Create the model
const NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);

/**
 * NewsCache class for handling caching of stock news analysis
 */
class NewsCache {
  /**
   * Get cached analysis data for a symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  static async getBySymbol(symbol) {
    try {
      const normalizedSymbol = symbol.toUpperCase().trim();
      
      // Check memory cache first
      const memoryKey = `news_${normalizedSymbol}`;
      const memoryData = memoryCache.get(memoryKey);
      if (memoryData) {
        return memoryData;
      }
      
      // If not in memory, check MongoDB
      const cacheEntry = await NewsCacheModel.findOne({
        symbol: normalizedSymbol,
        expiresAt: { $gt: new Date() }
      });
      
      if (cacheEntry) {
        // Store in memory cache for faster subsequent access
        memoryCache.set(memoryKey, cacheEntry.toObject());
        return cacheEntry.toObject();
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting cache for ${symbol}:`, error);
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
      if (!symbol || !analysis) {
        console.error('Missing required parameters for cache save');
        return false;
      }

      const normalizedSymbol = symbol.toUpperCase().trim();
      const memoryKey = `news_${normalizedSymbol}`;
      
      const { 
        sourceCredibility = null,
        articleCount = 0,
        ttlHours = 0.5
      } = options;
      
      // Calculate expiration with slight randomization
      const randomMinutes = Math.floor(Math.random() * 30);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + ttlHours);
      expiresAt.setMinutes(expiresAt.getMinutes() + randomMinutes);
      
      // Create cache entry
      const cacheEntry = new NewsCacheModel({
        symbol: normalizedSymbol,
        analysis,
        sourceCredibility,
        articleCount,
        expiresAt,
        version: 1
      });
      
      // Save to MongoDB and memory cache in parallel
      await Promise.all([
        NewsCacheModel.deleteMany({ symbol: normalizedSymbol }),
        cacheEntry.save(),
        memoryCache.set(memoryKey, cacheEntry.toObject())
      ]);
      
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
   * @returns {Promise<void>}
   */
  static async cleanExpired() {
    try {
      const now = new Date();
      
      // Clean MongoDB cache
      await NewsCacheModel.deleteMany({
        expiresAt: { $lte: now }
      });
      
      // Clean memory cache
      memoryCache.keys().forEach(key => {
        const data = memoryCache.get(key);
        if (data && data.expiresAt <= now) {
          memoryCache.del(key);
        }
      });
    } catch (error) {
      console.error('Error cleaning cache:', error);
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
}

module.exports = NewsCache; 