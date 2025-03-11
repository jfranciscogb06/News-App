const mongoose = require('mongoose');
const db = require('../utils/db');

// Define the schema for popular searches
const popularSearchSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true
  },
  count: {
    type: Number,
    default: 1
  },
  last_searched: {
    type: Date,
    default: Date.now
  }
});

// Create the model
const PopularSearchModel = mongoose.model('PopularSearch', popularSearchSchema);

// In-memory cache for popular stocks
const popularStocksCache = new Map();

class CacheService {
  /**
   * Initialize the cache service
   */
  initialize() {
    console.log('Initializing cache service...');
    // You could pre-load popular stocks here if needed
  }

  /**
   * Record a search for a stock symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<boolean>} - Success status
   */
  async recordSearch(symbol) {
    try {
      const normalizedSymbol = symbol.toUpperCase().trim();
      
      // Update or create a record for this symbol
      await PopularSearchModel.updateOne(
        { symbol: normalizedSymbol },
        { 
          $inc: { count: 1 },
          $set: { last_searched: new Date() }
        },
        { upsert: true }
      );
      
      return true;
    } catch (error) {
      console.error('Error recording search:', error);
      return false;
    }
  }

  /**
   * Get cached stock data for popular stocks
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object|null>} - Cached data or null if not found
   */
  async getStockData(symbol) {
    try {
      const normalizedSymbol = symbol.toUpperCase().trim();
      
      // Check in-memory cache
      if (popularStocksCache.has(normalizedSymbol)) {
        console.log(`Popular cache hit for symbol: ${normalizedSymbol}`);
        return popularStocksCache.get(normalizedSymbol);
      }
      
      console.log(`Popular cache miss for symbol: ${normalizedSymbol}`);
      return null;
    } catch (error) {
      console.error('Error getting stock data from cache:', error);
      return null;
    }
  }

  /**
   * Clear the popular stocks cache
   * @returns {Promise<boolean>} - Success status
   */
  async clearPopularCache() {
    try {
      // Clear the in-memory cache
      popularStocksCache.clear();
      console.log('Popular stocks cache cleared');
      return true;
    } catch (error) {
      console.error('Error clearing popular cache:', error);
      return false;
    }
  }
}

module.exports = new CacheService(); 