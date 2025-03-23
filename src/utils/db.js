const { Pool } = require('pg');
const config = require('../config/config');

// Create a new pool using the connection string from config
const pool = new Pool({
  connectionString: config.database.url,
  ssl: {
    rejectUnauthorized: false // Required for Render.com PostgreSQL
  }
});

// Test the connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
    return;
  }
  console.log('Connected to PostgreSQL successfully');
  release();
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
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