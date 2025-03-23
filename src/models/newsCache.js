const db = require('../utils/db');

// Create the news cache table if it doesn't exist
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS news_cache (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    analysis JSONB NOT NULL,
    source_credibility JSONB,
    article_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_news_cache_symbol ON news_cache(symbol);
  CREATE INDEX IF NOT EXISTS idx_news_cache_expires_at ON news_cache(expires_at);
`;

// Initialize the table
db.query(createTableQuery).catch(err => {
  console.error('Error creating news_cache table:', err);
});

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
      
      const result = await db.query(
        `SELECT * FROM news_cache 
         WHERE symbol = $1 AND expires_at > CURRENT_TIMESTAMP 
         ORDER BY created_at DESC LIMIT 1`,
        [normalizedSymbol]
      );
      
      if (!result.rows || result.rows.length === 0) {
        console.log(`Cache miss for symbol: ${normalizedSymbol}`);
        return null;
      }
      
      const cacheEntry = result.rows[0];
      console.log(`Cache hit for symbol: ${normalizedSymbol}, expires in ${this.getTimeUntilExpiry(cacheEntry.expires_at)}`);
      
      // Transform the data into the exact format expected by the client
      return {
        symbol: normalizedSymbol,
        timestamp: new Date(),
        analysis: cacheEntry.analysis,
        source: 'cache',
        articleCount: cacheEntry.article_count,
        sourceCredibility: cacheEntry.source_credibility
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
        ttlHours = 0.5 // Default TTL: 30 minutes
      } = options;
      
      // Calculate expiration with slight randomization to prevent cache stampedes
      const randomMinutes = Math.floor(Math.random() * 30); // 0-30 minutes of randomness
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + ttlHours);
      expiresAt.setMinutes(expiresAt.getMinutes() + randomMinutes);
      
      // Remove any existing entries for this symbol
      await db.query(
        'DELETE FROM news_cache WHERE symbol = $1',
        [normalizedSymbol]
      );
      
      // Insert the new cache entry
      await db.query(
        `INSERT INTO news_cache 
         (symbol, analysis, source_credibility, article_count, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          normalizedSymbol,
          analysis,
          sourceCredibility,
          articleCount,
          expiresAt
        ]
      );
      
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
      const result = await db.query(
        'DELETE FROM news_cache WHERE expires_at <= CURRENT_TIMESTAMP RETURNING id'
      );
      
      const count = result.rowCount;
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
      const result = await db.query('DELETE FROM news_cache RETURNING id');
      console.log(`Cleared all cache: ${result.rowCount} entries removed`);
      return result.rowCount;
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
      const result = await db.query(
        'DELETE FROM news_cache WHERE symbol = $1 RETURNING id',
        [normalizedSymbol]
      );
      
      if (result.rowCount > 0) {
        console.log(`Cleared cache for ${normalizedSymbol}: ${result.rowCount} entries`);
      }
      
      return result.rowCount;
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