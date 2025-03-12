// Load environment variables
require('dotenv').config();

// Import required modules
const mongoose = require('mongoose');
const NewsCache = require('./src/models/newsCache');
const db = require('./src/utils/db');

// Sample test data
const testData = {
  sentiment: 75,
  summary: 'Positive outlook for this test',
  price_drivers: [
    { factor: 'Test factor 1', impact: 'positive' },
    { factor: 'Test factor 2', impact: 'positive' }
  ],
  key_articles: [
    { title: 'Test article', url: 'https://example.com/1', source: 'Test Source' }
  ]
};

// Test function
async function testStaggeredCache() {
  try {
    console.log('Testing staggered cache implementation with 30-minute TTL...');
    
    // Wait for MongoDB connection
    await new Promise(resolve => {
      setTimeout(resolve, 2000);
    });
    
    // Array of sample symbols to test
    const symbols = ['TEST1', 'TEST2', 'TEST3', 'TEST4', 'TEST5'];
    
    // Save each symbol with the test data
    console.log('Saving test data with staggered expiration...');
    for (const symbol of symbols) {
      await NewsCache.save(symbol, testData);
    }
    
    // Now retrieve the expiration times for each symbol
    console.log('\nRetrieving expiration times for each symbol:');
    for (const symbol of symbols) {
      const cacheEntry = await mongoose.model('NewsCache').findOne({ symbol });
      if (cacheEntry) {
        const expTime = cacheEntry.expires_at;
        const now = new Date();
        const diffMinutes = Math.round((expTime - now) / (60 * 1000));
        console.log(`${symbol}: Expires in ${diffMinutes} minutes from now`);
      } else {
        console.log(`${symbol}: Not found in cache`);
      }
    }
    
    // Clean up the test data
    console.log('\nCleaning up test data...');
    for (const symbol of symbols) {
      await NewsCache.clearBySymbol(symbol);
    }
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the test
testStaggeredCache(); 