const mongoose = require('mongoose');
const db = require('../utils/db');

// Define the schema for news cache
const newsCacheSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  expires_at: {
    type: Date,
    required: true,
    index: true
  }
});

// Create the model
const NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);

class NewsCache {
  /**
   * Get cached news analysis for a symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  static async getBySymbol(symbol) {
    try {
      const result = await NewsCacheModel.findOne({
        symbol: symbol.toUpperCase(),
        expires_at: { $gt: new Date() }
      });
      
      if (result) {
        console.log(`Cache hit for symbol: ${symbol}`);
        return result.data;
      }
      
      console.log(`Cache miss for symbol: ${symbol}`);
      return null;
    } catch (error) {
      console.error('Error getting cache by symbol:', error);
      return null;
    }
  }

  /**
   * Save news analysis to cache with staggered expiration
   * @param {string} symbol - Stock symbol
   * @param {Object} data - Analysis data to cache
   * @param {number} ttlMinutes - Base time to live in minutes (default: 30)
   * @returns {Promise<boolean>} - Success status
   */
  static async save(symbol, data, ttlMinutes = 30) {
    try {
      // Add a random offset (0-10 minutes) to stagger expirations
      const randomOffsetMinutes = Math.floor(Math.random() * 10);
      const totalMinutes = ttlMinutes + randomOffsetMinutes;
      
      // Calculate expiration date with the staggered offset
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + totalMinutes);
      
      // Delete any existing cache for this symbol
      await NewsCacheModel.deleteMany({ symbol: symbol.toUpperCase() });
      
      // Insert new cache entry
      await NewsCacheModel.create({
        symbol: symbol.toUpperCase(),
        data,
        expires_at: expiresAt
      });
      
      console.log(`Cache saved for symbol: ${symbol}, expires in ${totalMinutes} minutes (staggered)`);
      return true;
    } catch (error) {
      console.error('Error saving to cache:', error);
      return false;
    }
  }

  /**
   * Delete expired cache entries
   * @returns {Promise<number>} - Number of deleted entries
   */
  static async cleanExpired() {
    try {
      const result = await NewsCacheModel.deleteMany({
        expires_at: { $lte: new Date() }
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
   * @returns {Promise<number>} - Number of deleted entries
   */
  static async clearAll() {
    try {
      // Find all entries before deletion (for logging)
      const allEntries = await NewsCacheModel.find({}, { symbol: 1 });
      const symbols = allEntries.map(entry => entry.symbol);
      
      // Use deleteMany to clear the cache
      const result = await NewsCacheModel.deleteMany({});
      const count = result.deletedCount;
      
      // Log detailed information about what was cleared
      if (count > 0) {
        console.log(`Cleared all cache entries: ${count} entries deleted`);
        console.log(`Cleared symbols: ${symbols.join(', ')}`);
      } else {
        console.log('No cache entries found to clear');
      }
      
      return count;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return 0;
    }
  }

  /**
   * Clear cache for a specific symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<number>} - Number of deleted entries
   */
  static async clearBySymbol(symbol) {
    try {
      const result = await NewsCacheModel.deleteMany({
        symbol: symbol.toUpperCase()
      });
      
      const count = result.deletedCount;
      if (count > 0) {
        console.log(`Cleared cache for symbol ${symbol}: ${count} entries deleted`);
      }
      
      return count;
    } catch (error) {
      console.error(`Error clearing cache for symbol ${symbol}:`, error);
      return 0;
    }
  }
}

module.exports = NewsCache; 