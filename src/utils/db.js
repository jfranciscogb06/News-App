const { Pool } = require('pg');
const config = require('../config/config');

// Log the database URL (with password redacted)
const dbUrl = config.database.url;
const redactedUrl = dbUrl ? dbUrl.replace(/\/\/[^:]+:[^@]+@/, '//****:****@') : 'undefined';
console.log('Attempting to connect to PostgreSQL with URL:', redactedUrl);

// Create a new pool using the connection string from config
const pool = new Pool({
  connectionString: config.database.url,
  ssl: {
    rejectUnauthorized: false // Required for Render.com PostgreSQL
  },
  // Add connection timeout and retry settings
  connectionTimeoutMillis: 10000, // 10 seconds
  idleTimeoutMillis: 30000, // 30 seconds
  max: 20 // Maximum number of clients in the pool
});

// Function to test connection with retries
async function testConnection(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('Connected to PostgreSQL successfully');
      client.release();
      return true;
    } catch (err) {
      console.error(`Connection attempt ${i + 1} failed:`, err);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return false;
}

// Test the connection with retries
testConnection().then(success => {
  if (!success) {
    console.error('Failed to connect to PostgreSQL after multiple attempts');
    process.exit(1);
  }
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit the process on pool errors, just log them
  console.error('Pool error details:', {
    message: err.message,
    code: err.code,
    stack: err.stack
  });
});

// Handle application termination - close pool
process.on('SIGINT', async () => {
  try {
    await pool.end();
    console.log('PostgreSQL connection closed due to app termination');
    process.exit(0);
  } catch (err) {
    console.error('Error during PostgreSQL connection closure:', err);
    process.exit(1);
  }
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
}; 