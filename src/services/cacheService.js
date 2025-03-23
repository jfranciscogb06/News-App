const db = require('../utils/db');
const newsService = require('./newsService');
const openaiService = require('./openaiService');

// Create the popular searches table if it doesn't exist
const createPopularSearchesTableQuery = `
  CREATE TABLE IF NOT EXISTS popular_searches (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    count INTEGER DEFAULT 1,
    last_searched TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol)
  );
  
  CREATE INDEX IF NOT EXISTS idx_popular_searches_count ON popular_searches(count DESC);
  CREATE INDEX IF NOT EXISTS idx_popular_searches_last_searched ON popular_searches(last_searched DESC);
`;

// Create the news cache table if it doesn't exist
const createNewsCacheTableQuery = `
  DROP TABLE IF EXISTS news_cache;
  
  CREATE TABLE news_cache (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    UNIQUE(symbol)
  );
  
  CREATE INDEX IF NOT EXISTS idx_news_cache_symbol ON news_cache(symbol);
  CREATE INDEX IF NOT EXISTS idx_news_cache_expires_at ON news_cache(expires_at);
`;

// Initialize the tables
db.query(createPopularSearchesTableQuery).catch(err => {
  console.error('Error creating popular_searches table:', err);
});

db.query(createNewsCacheTableQuery).catch(err => {
  console.error('Error creating news_cache table:', err);
});

// In-memory cache for popular stocks
const popularStocksCache = new Map();

// Maximum number of concurrent requests
const MAX_CONCURRENT_REQUESTS = 5;

// Cache refresh interval in milliseconds (30 minutes)
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000;

// Stagger interval between different cache groups (5 minutes)
const STAGGER_INTERVAL = 5 * 60 * 1000;

// Number of cache groups to stagger
const CACHE_GROUPS = 5;

// Number of popular stocks to maintain
const POPULAR_STOCKS_COUNT = 100;

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
      
      // Clear PostgreSQL cache
      if (stocks.length > 0) {
        const result = await db.query(
          'DELETE FROM news_cache WHERE symbol = ANY($1)',
          [stocks]
        );
        dbClearedCount = result.rowCount;
      }
      
      if (memClearedCount > 0 || dbClearedCount > 0) {
        console.log(`Cleared ${memClearedCount} stocks from memory cache and ${dbClearedCount} from PostgreSQL`);
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
      
      // Save to PostgreSQL for persistence with the staggered TTL
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + baseTtlMinutes);
      
      await db.query(
        `INSERT INTO news_cache (symbol, data, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol) 
         DO UPDATE SET 
           data = EXCLUDED.data,
           expires_at = EXCLUDED.expires_at`,
        [symbol, analysis, expiresAt]
      );
      
      console.log(`Cached ${symbol} in PostgreSQL with base TTL of ${baseTtlMinutes} minutes`);
    } catch (error) {
      console.error(`Error caching ${symbol}:`, error);
    }
  }

  /**
   * Get popular stocks using OpenAI
   * @returns {Promise<Array<string>>} Array of stock symbols
   */
  async getPopularStocksFromOpenAI() {
    try {
      console.log('Getting popular stocks from OpenAI...');
      
      const response = await openaiService.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a financial expert. Your task is to identify the top ${POPULAR_STOCKS_COUNT} most important and frequently traded stocks in the market.

Consider these factors:
1. Market capitalization
2. Trading volume
3. News coverage and media attention
4. Industry influence
5. Investor interest
6. Recent market activity

IMPORTANT: You must respond with ONLY a JSON object in the following format:
{"stocks":["AAPL","MSFT","GOOGL"]}

Rules:
1. The response must be a single line
2. No newlines or formatting
3. No explanations or additional text
4. Only include valid stock symbols (1-5 uppercase letters)
5. The response must be valid JSON that can be parsed by JSON.parse()`
          }
        ],
        temperature: 0.2,
        max_tokens: 1000
      });

      if (!response?.choices?.[0]?.message?.content) {
        throw new Error('Invalid or empty response from OpenAI');
      }

      const content = response.choices[0].message.content;
      let stocks;
      
      try {
        // Log the raw content for debugging
        console.log('Raw OpenAI response:', content);
        
        // Clean the content string before parsing
        const cleanContent = content
          .trim()
          // Remove any markdown code block markers
          .replace(/^```json\s*/, '')
          .replace(/```$/, '')
          // Remove any whitespace and newlines
          .replace(/\s+/g, '')
          // Ensure it starts with { and ends with }
          .replace(/^[^{]*({.*})[^}]*$/, '$1');
        
        console.log('Cleaned content:', cleanContent);
        
        // Try to parse the cleaned content
        stocks = JSON.parse(cleanContent);
        
        // The response should now be an object with a stocks array
        if (stocks.stocks && Array.isArray(stocks.stocks)) {
          stocks = stocks.stocks;
        } else if (Array.isArray(stocks)) {
          // If it's already an array, that's fine too
          stocks = stocks;
        } else {
          throw new Error('OpenAI response does not contain a valid stocks array');
        }
      } catch (error) {
        console.error('Error parsing OpenAI response:', error);
        console.error('Raw content:', content);
        throw new Error('Invalid response format from OpenAI');
      }

      // Validate and normalize stock symbols
      stocks = stocks
        .map(symbol => (symbol || '').toUpperCase().trim())
        .filter(symbol => symbol && symbol.length <= 5 && /^[A-Z]+$/.test(symbol))
        .slice(0, POPULAR_STOCKS_COUNT);

      if (stocks.length === 0) {
        throw new Error('No valid stock symbols found in OpenAI response');
      }

      console.log(`Retrieved ${stocks.length} popular stocks from OpenAI`);
      return stocks;
    } catch (error) {
      console.error('Error getting popular stocks from OpenAI:', error);
      // Fallback to search history if OpenAI fails
      return this.getPopularStocksFromSearchHistory();
    }
  }

  /**
   * Get popular stocks from search history
   * @returns {Promise<Array<string>>} Array of stock symbols
   */
  async getPopularStocksFromSearchHistory() {
    try {
      const result = await db.query(
        `SELECT symbol FROM popular_searches 
         ORDER BY count DESC, last_searched DESC 
         LIMIT $1`,
        [POPULAR_STOCKS_COUNT]
      );
      
      const symbols = result.rows.map(item => item.symbol);
      console.log(`Retrieved ${symbols.length} popular stocks from search history`);
      return symbols;
    } catch (error) {
      console.error('Error getting popular stocks from search history:', error);
      return [];
    }
  }

  /**
   * Get top 100 popular stocks
   * @returns {Promise<Array<string>>} Array of stock symbols
   */
  async getTop100PopularStocks() {
    try {
      // First try to get from OpenAI
      const stocks = await this.getPopularStocksFromOpenAI();
      
      // If we don't have enough stocks, supplement with search history
      if (stocks.length < POPULAR_STOCKS_COUNT) {
        const searchHistoryStocks = await this.getPopularStocksFromSearchHistory();
        const additionalStocks = searchHistoryStocks
          .filter(stock => !stocks.includes(stock))
          .slice(0, POPULAR_STOCKS_COUNT - stocks.length);
        
        stocks.push(...additionalStocks);
      }
      
      console.log(`Retrieved ${stocks.length} popular stocks for caching`);
      return stocks;
    } catch (error) {
      console.error('Error getting popular stocks:', error);
      return [];
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
      await db.query(
        `INSERT INTO popular_searches (symbol, count, last_searched)
         VALUES ($1, 1, CURRENT_TIMESTAMP)
         ON CONFLICT (symbol) 
         DO UPDATE SET 
           count = popular_searches.count + 1,
           last_searched = CURRENT_TIMESTAMP`,
        [normalizedSymbol]
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
      
      // Check PostgreSQL cache
      const result = await db.query(
        `SELECT data FROM news_cache 
         WHERE symbol = $1 AND expires_at > CURRENT_TIMESTAMP`,
        [normalizedSymbol]
      );
      
      if (result.rows.length > 0) {
        const data = result.rows[0].data;
        // Update in-memory cache
        popularStocksCache.set(normalizedSymbol, data);
        console.log(`PostgreSQL cache hit for symbol: ${normalizedSymbol}`);
        return data;
      }
      
      console.log(`Cache miss for symbol: ${normalizedSymbol}`);
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
      
      // Clear PostgreSQL tables
      try {
        // First delete expired entries
        await db.query('DELETE FROM news_cache WHERE expires_at <= CURRENT_TIMESTAMP');
        console.log('Cleared expired entries from news_cache');
        
        // Then truncate the tables
        await db.query('TRUNCATE TABLE news_cache, popular_searches CASCADE');
        console.log('PostgreSQL tables cleared');
        
        // Reset sequences
        await db.query('ALTER SEQUENCE news_cache_id_seq RESTART WITH 1');
        await db.query('ALTER SEQUENCE popular_searches_id_seq RESTART WITH 1');
        console.log('PostgreSQL sequences reset');
      } catch (dbError) {
        console.error('Error clearing PostgreSQL tables:', dbError);
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