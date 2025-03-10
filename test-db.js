// Load environment variables directly
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

const { Pool } = require('pg');

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render's PostgreSQL
  }
});

async function testConnection() {
  try {
    console.log('Testing database connection...');
    console.log('Database URL:', process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@')); // Hide password
    
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected successfully at:', result.rows[0].now);
    
    // Test creating a table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        name TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Test table created successfully');
    
    // Insert a test record
    const insertResult = await pool.query(
      'INSERT INTO test_table (name) VALUES ($1) RETURNING id',
      ['Test record']
    );
    console.log('Test record inserted with ID:', insertResult.rows[0].id);
    
    // Query the test record
    const queryResult = await pool.query('SELECT * FROM test_table');
    console.log('Test records:', queryResult.rows);
    
    console.log('Database test completed successfully!');
  } catch (error) {
    console.error('Database test error:', error);
  } finally {
    await pool.end();
  }
}

testConnection(); 