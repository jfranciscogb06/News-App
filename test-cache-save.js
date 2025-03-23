require('dotenv').config();
const NewsCache = require('./src/models/newsCache');
const db = require('./src/utils/db');

async function testCacheSave() {
  try {
    console.log('Testing PostgreSQL connection...');
    await db.query('SELECT NOW()');
    console.log('Connected to PostgreSQL successfully!');

    const testData = {
      testField: 'Test data ' + new Date().toISOString()
    };

    console.log('Saving test data to cache...');
    const saved = await NewsCache.save('TEST', testData, {
      ttlHours: 0.1 // 6 minutes
    });

    console.log('Save result:', saved ? 'Success' : 'Failed');

    // Wait a moment to ensure data is saved
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Checking if data was cached...');
    const cached = await NewsCache.getBySymbol('TEST');
    console.log('Cache check result:', cached ? 'Found' : 'Not found');

    // Clean up test data
    await NewsCache.clearBySymbol('TEST');
    console.log('Test data cleaned up');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

testCacheSave();
