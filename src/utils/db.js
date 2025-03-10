const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

// Ensure config.database.url is available
if (!config.database.url) {
  // Parse .env file manually if needed
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
    
    // Update config
    if (process.env.DATABASE_URL) {
      config.database.url = process.env.DATABASE_URL;
    }
  } catch (error) {
    console.error('Error loading .env file:', error);
  }
}

// Create a connection pool
const pool = new Pool({
  connectionString: config.database.url,
  ssl: {
    rejectUnauthorized: false // Required for Render's PostgreSQL
  }
});

// Test the connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
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
  } catch (error) {
    console.error('Error initializing database tables:', error);
  }
}

// Initialize the database on module load
initDatabase();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}; 