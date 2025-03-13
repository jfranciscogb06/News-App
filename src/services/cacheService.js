const mongoose = require('mongoose');
const db = require('../utils/db');
const newsService = require('./newsService');

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

// Default popular stocks to cache if not enough search data
const DEFAULT_POPULAR_STOCKS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT',
  'JNJ', 'PG', 'MA', 'UNH', 'HD', 'BAC', 'XOM', 'AVGO', 'PFE', 'CSCO'
];

// Maximum number of concurrent requests
const MAX_CONCURRENT_REQUESTS = 5;

// Cache refresh interval in milliseconds (30 minutes)
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000;

// Stagger interval between different cache groups (5 minutes)
const STAGGER_INTERVAL = 5 * 60 * 1000;

// Number of cache groups to stagger
const CACHE_GROUPS = 5;

class CacheService {
  constructor() {
    // Track active caching operations
    this.activeCachingOperations = 0;
    this.maxConcurrentCachingOperations = 2;
    this.cacheGroups = new Map();
    this.nextGroupId = 1;
    // Track scheduled refresh timers so we can cancel them
    this.refreshTimers = [];
  }

  /**
   * Initialize the cache service
   */
  initialize() {
    console.log('Initializing cache service...');
    
    // Start staggered background caching of popular stocks
    this.startStaggeredCaching();
  }

  /**
   * Start staggered background caching of popular stocks
   */
  async startStaggeredCaching() {
    try {
      // Get top 100 popular stocks
      const allPopularStocks = await this.getTop100PopularStocks();
      
      // Divide stocks into groups for staggered caching
      this.createCacheGroups(allPopularStocks, CACHE_GROUPS);
      
      // Initial caching with staggered starts
      this.scheduleStaggeredCaching();
      
      console.log(`Set up ${CACHE_GROUPS} staggered cache groups refreshing every ${CACHE_REFRESH_INTERVAL/60000} minutes`);
    } catch (error) {
      console.error('Error starting staggered caching:', error);
    }
  }

  /**
   * Create cache groups from the list of stocks
   * @param {Array<string>} stocks - List of stock symbols
   * @param {number} groupCount - Number of groups to create
   */
  createCacheGroups(stocks, groupCount) {
    // Clear existing groups
    this.cacheGroups.clear();
    
    // Calculate stocks per group (approximately)
    const stocksPerGroup = Math.ceil(stocks.length / groupCount);
    
    // Create groups
    for (let i = 0; i < groupCount; i++) {
      const groupId = i + 1;
      const startIdx = i * stocksPerGroup;
      const endIdx = Math.min(startIdx + stocksPerGroup, stocks.length);
      const groupStocks = stocks.slice(startIdx, endIdx);
      
      this.cacheGroups.set(groupId, {
        id: groupId,
        stocks: groupStocks,
        lastRefreshed: null
      });
      
      console.log(`Created cache group ${groupId} with ${groupStocks.length} stocks`);
    }
  }

  /**
   * Schedule staggered caching for all groups
   */
  scheduleStaggeredCaching() {
    // Clear any existing timers first
    this.cancelAllCacheTimers();
    
    // Schedule each group with a staggered start
    for (const [groupId, group] of this.cacheGroups.entries()) {
      // Calculate delay for this group (stagger by group ID)
      const initialDelay = (groupId - 1) * STAGGER_INTERVAL;
      
      // Schedule initial caching after the staggered delay
      const initialTimer = setTimeout(() => {
        this.refreshCacheGroup(group);
        
        // Set up recurring refresh for this group
        const recurringTimer = setInterval(() => {
          this.refreshCacheGroup(group);
        }, CACHE_REFRESH_INTERVAL);
        
        // Store the recurring timer reference
        this.refreshTimers.push(recurringTimer);
        
      }, initialDelay);
      
      // Store the initial timer reference
      this.refreshTimers.push(initialTimer);
      
      console.log(`Scheduled group ${groupId} to start in ${initialDelay/1000} seconds and refresh every ${CACHE_REFRESH_INTERVAL/60000} minutes`);
    }
  }

  /**
   * Cancel all scheduled cache timers
   */
  cancelAllCacheTimers() {
    // Clear all existing timers
    this.refreshTimers.forEach(timer => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    
    // Reset the timers array
    this.refreshTimers = [];
    console.log('Cancelled all scheduled cache refresh timers');
  }

  /**
   * Refresh a specific cache group
   * @param {Object} group - Cache group to refresh
   */
  async refreshCacheGroup(group) {
    try {
      // Check if we're already at max concurrent operations
      if (this.activeCachingOperations >= this.maxConcurrentCachingOperations) {
        console.log(`Delaying refresh of group ${group.id} - too many active caching operations`);
        
        // Retry after a short delay
        setTimeout(() => this.refreshCacheGroup(group), 30000);
        return;
      }
      
      // Increment active operations counter
      this.activeCachingOperations++;
      
      console.log(`Starting refresh of cache group ${group.id} with ${group.stocks.length} stocks`);
      
      // Clear cache for this group's stocks
      await this.clearCacheForStocks(group.stocks);
      
      // Process in batches to avoid overwhelming the system
      await this.processBatchesInParallelForGroup(group.stocks, MAX_CONCURRENT_REQUESTS, group.id);
      
      // Update last refreshed timestamp
      group.lastRefreshed = new Date();
      
      console.log(`Completed refresh of cache group ${group.id}`);
      
      // Decrement active operations counter
      this.activeCachingOperations--;
    } catch (error) {
      console.error(`Error refreshing cache group ${group.id}:`, error);
      
      // Decrement active operations counter even if there was an error
      this.activeCachingOperations--;
    }
  }

  /**
   * Clear cache for specific stocks
   * @param {Array<string>} stocks - Array of stock symbols to clear from cache
   */
  async clearCacheForStocks(stocks) {
    try {
      let memClearedCount = 0;
      let dbClearedCount = 0;
      
      // Clear in-memory cache
      for (const symbol of stocks) {
        if (popularStocksCache.has(symbol)) {
          popularStocksCache.delete(symbol);
          memClearedCount++;
        }
      }
      
      // Clear MongoDB cache
      const NewsCache = require('../models/newsCache');
      for (const symbol of stocks) {
        const result = await NewsCache.clearBySymbol(symbol);
        if (result > 0) {
          dbClearedCount++;
        }
      }
      
      if (memClearedCount > 0 || dbClearedCount > 0) {
        console.log(`Cleared ${memClearedCount} stocks from memory cache and ${dbClearedCount} from MongoDB`);
      }
    } catch (error) {
      console.error('Error clearing cache for stocks:', error);
    }
  }

  /**
   * Cache popular stocks in background without blocking
   */
  async cachePopularStocksInBackground() {
    // Run in the next tick to not block initialization
    process.nextTick(async () => {
      try {
        console.log('Starting background caching of popular stocks...');
        const popularStocks = await this.getTop100PopularStocks();
        
        // Process in batches to avoid overwhelming the system
        await this.processBatchesInParallel(popularStocks, MAX_CONCURRENT_REQUESTS);
        
        console.log(`Completed caching ${popularStocksCache.size} popular stocks`);
      } catch (error) {
        console.error('Error in background caching:', error);
      }
    });
  }

  /**
   * Process batches of stocks in parallel with limited concurrency for a specific group
   * @param {Array<string>} stocks - Array of stock symbols
   * @param {number} concurrency - Maximum number of concurrent requests
   * @param {number} groupId - Group ID for staggering
   */
  async processBatchesInParallelForGroup(stocks, concurrency, groupId) {
    // Create batches
    const batches = [];
    for (let i = 0; i < stocks.length; i += concurrency) {
      batches.push(stocks.slice(i, i + concurrency));
    }
    
    // Process each batch in parallel
    for (const batch of batches) {
      console.log(`Processing batch of ${batch.length} stocks for group ${groupId}...`);
      
      // Process all stocks in current batch concurrently
      await Promise.all(
        batch.map(symbol => this.cacheStockData(symbol, groupId))
      );
    }
  }

  /**
   * Process batches of stocks in parallel with limited concurrency
   * @param {Array<string>} stocks - Array of stock symbols
   * @param {number} concurrency - Maximum number of concurrent requests
   */
  async processBatchesInParallel(stocks, concurrency) {
    // Create batches
    const batches = [];
    for (let i = 0; i < stocks.length; i += concurrency) {
      batches.push(stocks.slice(i, i + concurrency));
    }
    
    // Process each batch in parallel
    for (const batch of batches) {
      console.log(`Processing batch of ${batch.length} stocks...`);
      
      // Process all stocks in current batch concurrently
      await Promise.all(
        batch.map(symbol => this.cacheStockData(symbol))
      );
    }
  }

  /**
   * Cache data for a single stock
   * @param {string} symbol - Stock symbol
   * @param {number} groupId - Group ID for additional staggering (optional)
   */
  async cacheStockData(symbol, groupId = null) {
    try {
      console.log(`Background caching for ${symbol}...`);
      
      // Skip if already in cache
      if (popularStocksCache.has(symbol)) {
        console.log(`${symbol} already in cache, skipping`);
        return;
      }
      
      // Collect and analyze news
      const analysis = await newsService.collectAndAnalyzeNews(symbol);
      
      // Store in memory cache
      popularStocksCache.set(symbol, analysis);
      console.log(`Cached ${symbol} in popular stocks cache (memory)`);
      
      // Calculate base TTL with additional variation based on group ID
      let baseTtlMinutes = 30;
      if (groupId) {
        // Add group-based variation (1-5 minutes) to further stagger different groups
        baseTtlMinutes = 30 + ((groupId - 1) * 2);
      }
      
      // Also save to MongoDB for persistence with the staggered TTL
      const NewsCache = require('../models/newsCache');
      await NewsCache.save(symbol, analysis, baseTtlMinutes);
      console.log(`Cached ${symbol} in MongoDB with base TTL of ${baseTtlMinutes} minutes`);
    } catch (error) {
      console.error(`Error caching ${symbol}:`, error);
    }
  }

  /**
   * Get top 100 popular stocks based on search history
   * @returns {Promise<Array<string>>} - Array of stock symbols
   */
  async getTop100PopularStocks() {
    try {
      // Get most searched stocks from database
      const popularSearches = await PopularSearchModel.find()
        .sort({ count: -1, last_searched: -1 })
        .limit(100);
      
      // Extract symbols
      let symbols = popularSearches.map(item => item.symbol);
      
      // If we don't have 100 stocks from search history, add default popular stocks
      if (symbols.length < 100) {
        // Add default stocks that aren't already in the list
        const missingCount = 100 - symbols.length;
        const additionalStocks = DEFAULT_POPULAR_STOCKS
          .filter(stock => !symbols.includes(stock))
          .slice(0, missingCount);
        
        symbols = [...symbols, ...additionalStocks];
      }
      
      console.log(`Retrieved ${symbols.length} popular stocks for caching`);
      return symbols;
    } catch (error) {
      console.error('Error getting popular stocks:', error);
      return DEFAULT_POPULAR_STOCKS;
    }
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
      console.log('Starting full cache clearing process...');
      
      // Cancel all ongoing cache operations
      this.cancelAllCacheTimers();
      
      // Reset active operations counter
      this.activeCachingOperations = 0;
      
      // Clear the in-memory cache
      popularStocksCache.clear();
      console.log('Popular stocks cache cleared');
      
      // Clear the cache groups
      this.cacheGroups.clear();
      console.log('Cache groups cleared');
      
      // Reset internal state
      this.nextGroupId = 1;
      
      // Clear any other in-memory state that might persist
      Object.keys(this).forEach(key => {
        // Only reset arrays and objects, not functions or primitives
        if (Array.isArray(this[key])) {
          this[key] = [];
        } else if (this[key] && typeof this[key] === 'object' && !(this[key] instanceof Map) && !(this[key] instanceof Set)) {
          this[key] = {};
        }
      });
      
      console.log('All internal cache state reset');
      
      // Clear any global cache that might exist
      if (global.stockCache) {
        global.stockCache = new Map();
        console.log('Global stock cache cleared');
      }
      
      if (global.newsCache) {
        global.newsCache = new Map();
        console.log('Global news cache cleared');
      }
      
      // Clear MongoDB caches directly
      try {
        const mongoose = require('mongoose');
        
        // List of collection names we want to clear
        const collectionsToCheck = [
          'newscaches',
          'popularsearches',
          'stockcaches'
        ];
        
        for (const collectionName of collectionsToCheck) {
          try {
            const exists = await mongoose.connection.db.listCollections({name: collectionName}).hasNext();
            if (exists) {
              await mongoose.connection.db.collection(collectionName).deleteMany({});
              console.log(`MongoDB collection ${collectionName} cleared`);
            }
          } catch (collectionError) {
            console.error(`Error clearing collection ${collectionName}:`, collectionError);
          }
        }
      } catch (mongoError) {
        console.error('Error accessing MongoDB collections:', mongoError);
      }
      
      // Restart the staggered caching process with fresh data
      setTimeout(() => {
        console.log('Restarting staggered caching with fresh data...');
        this.startStaggeredCaching();
      }, 1000); // Small delay to ensure clean restart
      
      return true;
    } catch (error) {
      console.error('Error clearing popular cache:', error);
      return false;
    }
  }
}

module.exports = new CacheService(); 