const { Pool } = require('pg');
const config = require('../config/config');

// Create a connection pool
const pool = new Pool({
  connectionString: config.database.url,
  ssl: {
    rejectUnauthorized: false // Required for Render's PostgreSQL
  }
});

// Initialize database tables
async function initDatabase() {
  try {
    // Create news_cache table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news_cache (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_news_cache_symbol ON news_cache(symbol);
      CREATE INDEX IF NOT EXISTS idx_news_cache_expires_at ON news_cache(expires_at);
    `);
    
    console.log('Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database tables:', error);
    return false;
  }
}

// Initialize the database when this module is loaded
initDatabase().catch(err => console.error('Error initializing database:', err));

class NewsCache {
  /**
   * Get cached news analysis for a symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  static async getBySymbol(symbol) {
    try {
      const result = await pool.query(
        'SELECT data FROM news_cache WHERE symbol = $1 AND expires_at > NOW()',
        [symbol.toUpperCase()]
      );
      
      if (result.rows.length > 0) {
        console.log(`Cache hit for symbol: ${symbol}`);
        return result.rows[0].data;
      }
      
      console.log(`Cache miss for symbol: ${symbol}`);
      return null;
    } catch (error) {
      console.error('Error getting cache by symbol:', error);
      return null;
    }
  }

  /**
   * Save news analysis to cache
   * @param {string} symbol - Stock symbol
   * @param {Object} data - Analysis data to cache
   * @param {number} ttlHours - Time to live in hours (default: 24)
   * @returns {Promise<boolean>} - Success status
   */
  static async save(symbol, data, ttlHours = 24) {
    try {
      // Delete any existing cache for this symbol
      await pool.query('DELETE FROM news_cache WHERE symbol = $1', [symbol.toUpperCase()]);
      
      // Insert new cache entry
      await pool.query(
        'INSERT INTO news_cache (symbol, data, expires_at) VALUES ($1, $2, NOW() + interval \'1 hour\' * $3)',
        [symbol.toUpperCase(), data, ttlHours]
      );
      
      console.log(`Cache saved for symbol: ${symbol}, expires in ${ttlHours} hours`);
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
      const result = await pool.query('DELETE FROM news_cache WHERE expires_at <= NOW() RETURNING id');
      const count = result.rows.length;
      
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
      const result = await pool.query('DELETE FROM news_cache RETURNING id');
      
      const count = result.rows.length;
      console.log(`Cleared all cache entries: ${count} entries deleted`);
      
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
      const result = await pool.query(
        'DELETE FROM news_cache WHERE symbol = $1 RETURNING id',
        [symbol.toUpperCase()]
      );
      
      const count = result.rows.length;
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