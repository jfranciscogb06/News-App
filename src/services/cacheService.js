const db = require('../utils/db');
const newsService = require('./newsService');
const openaiService = require('./openaiService');
const sentimentAnalysisService = require('./sentimentAnalysisService');
const sourceValidationService = require('./sourceValidationService');
const queueService = require('./queueService');
const { LRUCache } = require('lru-cache');
const logger = require('../utils/logger');

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
  CREATE TABLE IF NOT EXISTS news_cache (
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
const popularStocksCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 30 }); // 30 minutes cache

// Maximum number of concurrent requests
const MAX_CONCURRENT_REQUESTS = 10;

// Cache refresh interval in milliseconds (30 minutes)
const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000;

// Stagger interval between different cache groups (5 minutes)
const STAGGER_INTERVAL = 5 * 60 * 1000;

// Number of cache groups to stagger
const CACHE_GROUPS = 5;

// Number of popular stocks to maintain
const POPULAR_STOCKS_COUNT = 200;

class CacheService {
  constructor() {
    this.db = require('../utils/db');
    this.queueService = require('./queueService');
    this.newsService = require('./newsService');
    this.sentimentAnalysisService = require('./sentimentAnalysisService');
    this.sourceValidationService = require('./sourceValidationService');
    this.cacheTimeout = 3600; // 1 hour cache timeout
    this.maxConcurrentJobs = 3; // Reduced from 5 to 3
    this.maxArticles = 10; // Maximum articles to process
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
   * Refresh the cache for a specific group of stocks
   * @param {Object} group - Group object to refresh
   */
  async refreshCacheGroup(group) {
    try {
      if (!group || !group.stocks || group.stocks.length === 0) {
        console.log(`No symbols in group ${group.id} to refresh`);
        return;
      }
      
      console.log(`Refreshing cache for group ${group.id} with ${group.stocks.length} symbols`);
      
      // Use queueService to add a non-blocking job for this group refresh
      queueService.addJob('caching', async () => {
        try {
          await this.processBatchesInParallelForGroup(group.stocks, MAX_CONCURRENT_REQUESTS, group.id);
          console.log(`Successfully refreshed cache for group ${group.id}`);
          
          // Update the last refreshed timestamp
          const groupData = this.cacheGroups.get(group.id);
          if (groupData) {
            groupData.lastRefreshed = new Date();
            this.cacheGroups.set(group.id, groupData);
          }
        } catch (error) {
          console.error(`Error refreshing cache group ${group.id}:`, error);
        }
      }, { group: group.id });
      
      console.log(`Cache refresh for group ${group.id} queued`);
    } catch (error) {
      console.error(`Error scheduling cache refresh for group ${group.id}:`, error);
    }
  }

  /**
   * Process batches of stocks in parallel for a specific group
   * @param {Array<string>} stocks - Array of stock symbols to process
   * @param {number} concurrency - Maximum number of concurrent requests
   * @param {number} groupId - Group ID for staggered caching
   */
  async processBatchesInParallelForGroup(stocks, concurrency, groupId) {
    console.log(`Processing ${stocks.length} stocks for group ${groupId} with concurrency ${concurrency}`);
    
    // Map stocks to individual queue jobs (no batching - each stock processed independently)
    const results = await Promise.allSettled(
      stocks.map(symbol => 
        queueService.addJob('caching', async () => {
          return this.cacheStockData(symbol, null, groupId);
        }, { symbol, groupId })
      )
    );
    
    // Count successes and failures
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Group ${groupId} processing complete: ${successCount} succeeded, ${failedCount} failed`);
    
    // Log any failures
    results
      .filter(r => r.status === 'rejected')
      .forEach((result, index) => {
        console.error(`Failed to cache stock ${stocks[index]} for group ${groupId}:`, result.reason);
      });
  }

  /**
   * Process batches of stocks in parallel (not tied to a group)
   * @param {Array<string>} stocks - Array of stock symbols
   * @param {number} concurrency - Maximum number of concurrent requests
   */
  async processBatchesInParallel(stocks, concurrency) {
    console.log(`Processing ${stocks.length} stocks in parallel with concurrency ${concurrency}`);
    
    // Map stocks to individual queue jobs (no batching - each stock processed independently)
    const results = await Promise.allSettled(
      stocks.map(symbol => 
        queueService.addJob('caching', async () => {
          return this.cacheStockData(symbol, null);
        }, { symbol })
      )
    );
    
    // Count successes and failures
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;
    
    console.log(`Parallel processing complete: ${successCount} succeeded, ${failedCount} failed`);
    
    // Log any failures
    results
      .filter(r => r.status === 'rejected')
      .forEach((result, index) => {
        console.error(`Failed to cache stock ${stocks[index]}:`, result.reason);
      });
  }

  /**
   * Cache data for a single stock with optimized processing
   * @param {string} symbol - Stock symbol
   * @param {Object|null} preAnalyzedData - Optional pre-analyzed data to cache
   * @param {number} groupId - Group ID for additional staggering (optional)
   * @returns {Promise<Object>} The cached analysis data
   */
  async cacheStockData(symbol, preAnalyzedData = null, groupId = null) {
    try {
      const startTime = Date.now();
      
      // Check if we have pre-analyzed data
      if (preAnalyzedData) {
        await this.storeInDatabase(symbol, preAnalyzedData);
        return preAnalyzedData;
      }

      // Collect and analyze news articles in parallel
      const [articles, sourceValidation] = await Promise.all([
        this.newsService.collectAndAnalyzeNews(symbol, this.maxArticles),
        this.sourceValidationService.validateArticleSource({ symbol })
      ]);

      // Take only top 10 articles for analysis
      const topArticles = articles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 10);

      // Validate sources in parallel
      const validatedArticles = await Promise.all(
        topArticles.map(article => 
          this.sourceValidationService.validateArticleSource(article)
        )
      );

      // Perform sentiment analysis
      const sentimentAnalysis = await this.sentimentAnalysisService.analyzeSentimentAndPredict(symbol, validatedArticles);

      // Create the complete analysis object
      const analysis = {
        articles: validatedArticles,
        count: validatedArticles.length,
        sentimentAnalysis,
        timestamp: Date.now(),
        processingTime: (Date.now() - startTime) / 1000
      };

      // Store in database
      await this.storeInDatabase(symbol, analysis);

      return analysis;
    } catch (error) {
      console.error(`Error caching data for ${symbol}:`, error);
      throw error;
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
      const result = await this.db.query(
        `SELECT analysis, expires_at 
         FROM news_cache 
         WHERE symbol = $1 
         AND expires_at > CURRENT_TIMESTAMP`,
        [symbol]
      );

      if (result.rows.length > 0) {
        return JSON.parse(result.rows[0].analysis);
      }
      return null;
    } catch (error) {
      console.error(`Error retrieving cached data for ${symbol}:`, error);
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
      
      // First check if we have cached popular stocks
      const cachedStocks = popularStocksCache.get('popularStocks');
      if (cachedStocks && Array.isArray(cachedStocks)) {
        console.log(`Using ${cachedStocks.length} cached popular stocks`);
        return cachedStocks;
      }
      
      const response = await openaiService.openai.chat.completions.create({
        model: "gpt-3.5-turbo-0125",
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
        console.warn('Invalid or empty response from OpenAI, using default popular stocks');
        return this.getDefaultPopularStocks();
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
        return this.getDefaultPopularStocks();
      }

      // Validate and normalize stock symbols
      stocks = stocks
        .map(symbol => (symbol || '').toUpperCase().trim())
        .filter(symbol => symbol && symbol.length <= 5 && /^[A-Z]+$/.test(symbol))
        .slice(0, POPULAR_STOCKS_COUNT);

      if (stocks.length === 0) {
        console.warn('No valid stock symbols found in OpenAI response, using default popular stocks');
        return this.getDefaultPopularStocks();
      }

      // Cache the popular stocks for future use
      popularStocksCache.set('popularStocks', stocks, 24 * 60 * 60 * 1000); // 24 hours

      console.log(`Retrieved ${stocks.length} popular stocks from OpenAI`);
      return stocks;
    } catch (error) {
      console.error('Error getting popular stocks from OpenAI:', error);
      // Try search history first, then fall back to defaults
      const historyStocks = await this.getPopularStocksFromSearchHistory();
      if (historyStocks && historyStocks.length > 0) {
        return historyStocks;
      }
      return this.getDefaultPopularStocks();
    }
  }

  /**
   * Get a default list of popular stocks when other methods fail
   * @returns {Array<string>} Array of default stock symbols
   */
  getDefaultPopularStocks() {
    // Default list of popular stocks to use when API calls fail
    const defaultStocks = [
      'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'PG',
      'UNH', 'HD', 'BAC', 'MA', 'XOM', 'DIS', 'CMCSA', 'ADBE', 'NFLX', 'INTC',
      'VZ', 'CSCO', 'PFE', 'CRM', 'AVGO', 'PEP', 'ABT', 'CVX', 'TMO', 'KO',
      'ACN', 'MRK', 'COST', 'ABBV', 'WMT', 'MDT', 'MCD', 'ORCL', 'DHR', 'QCOM',
      'NKE', 'NEE', 'LLY', 'TXN', 'IBM', 'AMD', 'T', 'PM', 'AMGN', 'HON',
      'LIN', 'UPS', 'SBUX', 'UNP', 'LOW', 'BMY', 'GILD', 'PYPL', 'MMM', 'INTU'
    ];
    
    console.log(`Using ${defaultStocks.length} default popular stocks`);
    return defaultStocks;
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

  /**
   * Store analysis data in the database
   * @param {string} symbol - Stock symbol
   * @param {Object} analysis - Analysis data to store
   */
  async storeInDatabase(symbol, analysis) {
    try {
      const expiresAt = new Date(Date.now() + this.cacheTimeout * 1000);
      
      await this.db.query(
        `INSERT INTO news_cache (symbol, analysis, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol) 
         DO UPDATE SET 
           analysis = $2,
           expires_at = $3,
           updated_at = CURRENT_TIMESTAMP`,
        [symbol, JSON.stringify(analysis), expiresAt]
      );
    } catch (error) {
      console.error(`Error storing analysis in database for ${symbol}:`, error);
      throw error;
    }
  }

  async clearSymbolCache(symbol) {
    try {
      await this.db.query(
        `DELETE FROM news_cache WHERE symbol = $1`,
        [symbol]
      );
    } catch (error) {
      console.error(`Error clearing cache for ${symbol}:`, error);
      throw error;
    }
  }
}

module.exports = new CacheService(); 