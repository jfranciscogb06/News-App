const db = require('../utils/db');

class NewsCache {
  /**
   * Get cached news analysis for a symbol
   * @param {string} symbol - Stock symbol
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  static async getBySymbol(symbol) {
    try {
      const result = await db.query(
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
      await db.query('DELETE FROM news_cache WHERE symbol = $1', [symbol.toUpperCase()]);
      
      // Insert new cache entry
      await db.query(
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
      const result = await db.query('DELETE FROM news_cache WHERE expires_at <= NOW() RETURNING id');
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
}

module.exports = NewsCache; 