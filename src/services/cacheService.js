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
    // Schedule each group with a staggered start
    for (const [groupId, group] of this.cacheGroups.entries()) {
      // Calculate delay for this group (stagger by group ID)
      const initialDelay = (groupId - 1) * STAGGER_INTERVAL;
      
      // Schedule initial caching after the staggered delay
      setTimeout(() => {
        this.refreshCacheGroup(group);
        
        // Set up recurring refresh for this group
        setInterval(() => {
          this.refreshCacheGroup(group);
        }, CACHE_REFRESH_INTERVAL);
        
      }, initialDelay);
      
      console.log(`Scheduled group ${groupId} to start in ${initialDelay/1000} seconds and refresh every ${CACHE_REFRESH_INTERVAL/60000} minutes`);
    }
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
      this.clearCacheForStocks(group.stocks);
      
      // Process in batches to avoid overwhelming the system
      await this.processBatchesInParallel(group.stocks, MAX_CONCURRENT_REQUESTS);
      
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
  clearCacheForStocks(stocks) {
    let clearedCount = 0;
    
    for (const symbol of stocks) {
      if (popularStocksCache.has(symbol)) {
        popularStocksCache.delete(symbol);
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {
      console.log(`Cleared ${clearedCount} stocks from cache`);
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
   */
  async cacheStockData(symbol) {
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
      console.log(`Cached ${symbol} in popular stocks cache`);
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
      // Clear the in-memory cache
      popularStocksCache.clear();
      console.log('Popular stocks cache cleared');
      
      // Restart the staggered caching process
      this.startStaggeredCaching();
      
      return true;
    } catch (error) {
      console.error('Error clearing popular cache:', error);
      return false;
    }
  }
}

module.exports = new CacheService(); 