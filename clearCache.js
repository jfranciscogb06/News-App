/**
 * Clear Cache Utility
 * 
 * This script completely clears all caches in the system, including:
 * - Popular stocks cache (in-memory and MongoDB)
 * - News cache (MongoDB)
 * - Popular searches (MongoDB)
 * - Any other in-memory state
 * 
 * Run with: node clearCache.js
 */

// Load environment variables
require('dotenv').config();
const db = require('./src/utils/db');

async function clearCache() {
  try {
    console.log('Testing connection to PostgreSQL...');
    await db.query('SELECT NOW()');
    console.log('Connected to PostgreSQL successfully!');

    console.log('Clearing all cache tables...');
    
    // Get list of cache-related tables
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name LIKE '%cache%'
        OR table_name = 'popular_searches'
    `);

    const tables = result.rows.map(row => row.table_name);
    console.log('Found tables to clear:', tables);

    // Clear each table
    for (const table of tables) {
      try {
        await db.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`Cleared table: ${table}`);
      } catch (err) {
        console.error(`Error clearing table ${table}:`, err);
      }
    }

    console.log('Cache clearing completed');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

clearCache(); 