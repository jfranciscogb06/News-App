// Load environment variables manually
const fs = require('fs');
const path = require('path');

// Parse .env file manually
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        process.env[key] = value;
      }
    });
    
    console.log('Environment variables loaded');
  } catch (error) {
    console.error('Error loading .env file:', error);
  }
}

loadEnv();

// Import the NewsCache model
const { Pool } = require('pg');

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render's PostgreSQL
  }
});

// NewsCache class implementation
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
}

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

// Test function
async function testCache() {
  try {
    // Initialize the database
    const initialized = await initDatabase();
    if (!initialized) {
      throw new Error('Failed to initialize database');
    }
    
    // Test data
    const symbol = 'AAPL';
    const testData = {
      '7days': {
        sentiment: 75,
        summary: 'Very positive outlook for the next 7 days',
        price_drivers: [
          { factor: 'New product announcement', impact: 'positive' },
          { factor: 'Strong earnings report', impact: 'positive' }
        ],
        key_articles: [
          { title: 'Apple announces new iPhone', url: 'https://example.com/1', source: 'Yahoo Finance' }
        ]
      },
      '1month': {
        sentiment: 60,
        summary: 'Positive outlook for the next month',
        price_drivers: [
          { factor: 'Market expansion', impact: 'positive' }
        ],
        key_articles: [
          { title: 'Apple expands to new markets', url: 'https://example.com/2', source: 'Yahoo Finance' }
        ]
      },
      '3months': {
        sentiment: 50,
        summary: 'Moderately positive outlook for the next 3 months',
        price_drivers: [
          { factor: 'Competition increasing', impact: 'negative' },
          { factor: 'New product line', impact: 'positive' }
        ],
        key_articles: [
          { title: 'Apple faces new competition', url: 'https://example.com/3', source: 'Yahoo Finance' }
        ]
      },
      '6months': {
        sentiment: 40,
        summary: 'Neutral to slightly positive outlook for the next 6 months',
        price_drivers: [
          { factor: 'Market saturation', impact: 'negative' },
          { factor: 'Innovation pipeline', impact: 'positive' }
        ],
        key_articles: [
          { title: 'Apple\'s long-term strategy', url: 'https://example.com/4', source: 'Yahoo Finance' }
        ]
      }
    };
    
    // Save to cache
    console.log('Saving test data to cache...');
    const saved = await NewsCache.save(symbol, testData, 1); // 1 hour TTL for testing
    
    if (!saved) {
      throw new Error('Failed to save to cache');
    }
    
    // Retrieve from cache
    console.log('Retrieving from cache...');
    const cachedData = await NewsCache.getBySymbol(symbol);
    
    if (!cachedData) {
      throw new Error('Failed to retrieve from cache');
    }
    
    console.log('Cache test successful!');
    console.log('Cached data:', JSON.stringify(cachedData, null, 2));
    
    // Test cache expiration (set to 1 second for testing)
    console.log('Testing cache expiration...');
    await pool.query(
      'UPDATE news_cache SET expires_at = NOW() + interval \'1 second\' WHERE symbol = $1',
      [symbol]
    );
    
    // Wait for cache to expire
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to retrieve expired cache
    const expiredData = await NewsCache.getBySymbol(symbol);
    console.log('Expired cache retrieval result:', expiredData === null ? 'Correctly returned null' : 'ERROR: Still returned data');
    
    // Clean expired entries
    const cleaned = await NewsCache.cleanExpired();
    console.log(`Cleaned ${cleaned} expired entries`);
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await pool.end();
  }
}

// Run the test
testCache(); 