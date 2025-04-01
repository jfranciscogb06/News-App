const db = require('../utils/db');
const newsService = require('./newsService');
const openaiService = require('./openaiService');
const sentimentAnalysisService = require('./sentimentAnalysisService');
const sourceValidationService = require('./sourceValidationService');

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
    this.validationCache = new Map();
    this.analysisCache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutes in milliseconds
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
      
      // Add some randomization to prevent exact timing
      const randomOffset = Math.floor(Math.random() * 60000); // Random offset up to 1 minute
      
      console.log(`Scheduling group ${groupId} to start in ${(initialDelay + randomOffset)/1000} seconds`);
      
      // Schedule initial caching after the staggered delay
      const initialTimer = setTimeout(async () => {
        try {
          await this.refreshCacheGroup(group);
          
          // Set up recurring refresh for this group
          const recurringTimer = setInterval(async () => {
            try {
              await this.refreshCacheGroup(group);
            } catch (error) {
              console.error(`Error in recurring refresh for group ${groupId}:`, error);
              // Don't stop the interval on error, just log it
            }
          }, CACHE_REFRESH_INTERVAL);
          
          // Store the recurring timer reference
          this.refreshTimers.push(recurringTimer);
          
        } catch (error) {
          console.error(`Error in initial refresh for group ${groupId}:`, error);
          // Retry after a delay if initial refresh fails
          setTimeout(() => this.refreshCacheGroup(group), 30000);
        }
      }, initialDelay + randomOffset);
      
      // Store the initial timer reference
      this.refreshTimers.push(initialTimer);
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
        
        // Retry after a short delay with exponential backoff
        const retryDelay = Math.min(30000 * Math.pow(2, this.activeCachingOperations), 300000); // Max 5 minutes
        setTimeout(() => this.refreshCacheGroup(group), retryDelay);
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
      
      // Retry after a delay with exponential backoff
      const retryDelay = Math.min(30000 * Math.pow(2, this.activeCachingOperations), 300000);
      setTimeout(() => this.refreshCacheGroup(group), retryDelay);
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
    // Create batches with additional staggering within groups
    const batches = [];
    for (let i = 0; i < stocks.length; i += concurrency) {
      batches.push(stocks.slice(i, i + concurrency));
    }
    
    // Process each batch with additional staggering
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} for group ${groupId}...`);
      
      // Add additional delay between batches within the same group
      if (i > 0) {
        const batchDelay = (groupId * 1000) + (i * 2000); // Progressive delay based on group and batch
        console.log(`Waiting ${batchDelay/1000} seconds before processing next batch...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
      
      try {
        // Process all stocks in current batch concurrently
        await Promise.all(
          batch.map(symbol => this.cacheStockData(symbol, groupId))
        );
      } catch (error) {
        console.error(`Error processing batch ${i + 1} for group ${groupId}:`, error);
        // Continue with next batch even if current one fails
        continue;
      }
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
   * Cache data for a single stock with optimized processing
   * @param {string} symbol - Stock symbol
   * @param {number} groupId - Group ID for additional staggering (optional)
   */
  async cacheStockData(symbol, groupId = null) {
    try {
      // Skip if already in cache and not expired
      const cachedData = popularStocksCache.get(symbol);
      if (cachedData && !this.isCacheExpired(cachedData.timestamp)) {
        return;
      }
      
      // Collect and preprocess articles
      const articles = await newsService.collectAndAnalyzeNews(symbol);
      
      if (!articles || !Array.isArray(articles)) {
        throw new Error(`No valid articles returned for ${symbol}`);
      }
      
      // Validate articles in parallel batches
      const batchSize = 10;
      const validatedArticles = [];
      for (let i = 0; i < articles.length; i += batchSize) {
        const batch = articles.slice(i, i + batchSize);
        const validatedBatch = await sourceValidationService.validateArticles(batch);
        validatedArticles.push(...validatedBatch);
      }
      
      // Analyze sentiment and predict movement
      const sentimentAnalysis = await sentimentAnalysisService.analyzeSentimentAndPredict(symbol, validatedArticles);
      
      // Create the complete analysis object
      const analysis = {
        articles: validatedArticles,
        count: validatedArticles.length,
        sentimentAnalysis,
        timestamp: Date.now()
      };
      
      // Store in memory cache with TTL
      popularStocksCache.set(symbol, analysis);
      
      // Calculate staggered TTL based on group ID
      const baseTtlMinutes = 30;
      const staggeredTtlMinutes = groupId ? baseTtlMinutes + ((groupId - 1) * 2) : baseTtlMinutes;
      
      // Save to PostgreSQL with staggered TTL
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + staggeredTtlMinutes);
      
      await db.query(
        `INSERT INTO news_cache (symbol, data, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol) 
         DO UPDATE SET 
           data = EXCLUDED.data,
           expires_at = EXCLUDED.expires_at`,
        [symbol, analysis, expiresAt]
      );
    } catch (error) {
      console.error(`Error caching ${symbol}:`, error.message);
    }
  }

  /**
   * Check if cached data is expired
   * @param {number} timestamp - Cache timestamp
   * @returns {boolean} Whether cache is expired
   */
  isCacheExpired(timestamp) {
    return Date.now() - timestamp > this.cacheTTL;
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache() {
    for (const [symbol, data] of popularStocksCache.entries()) {
      if (this.isCacheExpired(data.timestamp)) {
        popularStocksCache.delete(symbol);
      }
    }
  }

  /**
   * Get cached stock data with validation
   * @param {string} symbol - Stock symbol
   * @returns {Object|null} Cached data or null if not found/expired
   */
  async getStockData(symbol) {
    try {
      // Check memory cache first
      const cachedData = popularStocksCache.get(symbol);
      if (cachedData && !this.isCacheExpired(cachedData.timestamp)) {
        return cachedData;
      }

      // Check PostgreSQL cache
      const result = await db.query(
        `SELECT data, expires_at FROM news_cache WHERE symbol = $1`,
        [symbol]
      );

      if (result.rows.length > 0) {
        const { data, expires_at } = result.rows[0];
        if (new Date(expires_at) > new Date()) {
          // Update memory cache
          popularStocksCache.set(symbol, data);
          return data;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error getting cached data for ${symbol}:`, error.message);
      return null;
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
        model: "gpt-4-1106-preview",
        messages: [
          {
            role: "system",
            content: `You are a financial expert identifying popular stocks based on:
1. Market capitalization
2. Trading volume
3. News coverage and media attention
4. Industry influence
5. Investor interest
6. Recent market activity

IMPORTANT: You must respond with ONLY a JSON object containing a single array of stock symbols.
The response must be valid JSON that can be parsed by JSON.parse().

Example format:
{"stocks":["AAPL","MSFT","GOOGL"]}

Rules:
1. Response must be a single line of valid JSON
2. No newlines, formatting, or markdown
3. No explanations or additional text
4. Only include valid stock symbols (1-5 uppercase letters)
5. All keys must be quoted (e.g., "stocks" not stocks)
6. No trailing commas
7. No comments or code block markers
8. No special characters or Unicode
9. Must start with { and end with }
10. Must contain exactly one key "stocks" with an array value`
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
          // Remove any backticks
          .replace(/`/g, '')
          // Remove any invalid characters
          .replace(/[^\x20-\x7E]/g, '')
          // Ensure it starts with { and ends with }
          .replace(/^[^{]*({.*})[^}]*$/, '$1')
          // Fix common JSON formatting issues
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Add quotes around unquoted keys
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Run twice to catch nested objects
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Run three times to be thorough
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Run four times to be extra thorough
          .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Run five times to be very thorough
        
        console.log('Cleaned content:', cleanContent);
        
        // Try to parse the cleaned content
        try {
          stocks = JSON.parse(cleanContent);
        } catch (parseError) {
          console.error('Initial JSON parse failed:', parseError);
          // Try to fix common JSON issues
          const fixedContent = cleanContent
            .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
            .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Add quotes around unquoted keys
            .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Run twice to catch nested objects
            .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Run three times to be thorough
          
          console.log('Fixed content:', fixedContent);
          stocks = JSON.parse(fixedContent);
        }
        
        // Validate the response structure
        if (!stocks || typeof stocks !== 'object') {
          throw new Error('Response is not a valid JSON object');
        }
        
        // The response should have a stocks array
        if (!stocks.stocks || !Array.isArray(stocks.stocks)) {
          throw new Error('Response does not contain a valid stocks array');
        }
        
        stocks = stocks.stocks;
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
   * Clear the popular stocks cache
   * @returns {Promise<boolean>} - Success status
   */
  async clearPopularCache() {
    try {
      // Clear memory cache
      popularStocksCache.clear();
      
      // Clear PostgreSQL cache
      try {
        // First delete expired entries
        await db.query('DELETE FROM news_cache WHERE expires_at <= CURRENT_TIMESTAMP');
        
        // Then truncate the tables
        await db.query('TRUNCATE TABLE news_cache, popular_searches CASCADE');
        
        // Reset sequences
        await db.query('ALTER SEQUENCE news_cache_id_seq RESTART WITH 1');
        await db.query('ALTER SEQUENCE popular_searches_id_seq RESTART WITH 1');
      } catch (dbError) {
        console.error('Database error:', dbError.message);
        throw dbError;
      }
      
      // Restart the staggered caching process with fresh data
      setTimeout(() => {
        this.startStaggeredCaching();
      }, 1000);
      
      return true;
    } catch (error) {
      console.error('Cache clearing error:', error.message);
      return false;
    }
  }
}

module.exports = new CacheService(); 