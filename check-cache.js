require('dotenv').config();
const NewsCache = require('./src/models/newsCache');
const db = require('./src/utils/db');

async function checkCache() {
  try {
    console.log('Testing connection to PostgreSQL...');
    await db.query('SELECT NOW()');
    console.log('Connected to PostgreSQL successfully!');

    console.log('Checking all entries in news_cache table...');
    const result = await db.query(
      `SELECT symbol, analysis, expires_at 
       FROM news_cache 
       ORDER BY created_at DESC`
    );

    console.log('Found ' + result.rows.length + ' entries in cache');
    
    for (let i = 0; i < result.rows.length; i++) {
      const entry = result.rows[i];
      console.log(
        `[${i + 1}] Symbol: ${entry.symbol}, ` +
        `Expires in: ${NewsCache.getTimeUntilExpiry(entry.expires_at)}`
      );
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

checkCache();
