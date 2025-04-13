require('dotenv').config();
const cacheService = require('./src/services/cacheService');

async function testPopularStocks() {
  try {
    console.log('Testing popular stock caching functionality...');
    
    // First check if there are any popular stocks already cached
    console.log('Checking if popularStocks are already cached...');
    
    // Get top 100 popular stocks (this should trigger OpenAI API call if not cached)
    console.log('Getting top 100 popular stocks...');
    const stocks = await cacheService.getTop100PopularStocks();
    
    console.log(`Retrieved ${stocks.length} popular stocks:`);
    console.log(stocks.slice(0, 20)); // Print first 20 for brevity
    
    // Now test the caching
    console.log('\nTrying to create cache groups...');
    cacheService.createCacheGroups(stocks, 5);
    
    // Check if the groups were created
    console.log('Cache groups created:');
    cacheService.cacheGroups.forEach((group, id) => {
      console.log(`Group ${id}: ${group.stocks.length} stocks`);
    });
    
    // Schedule the caching
    console.log('\nScheduling staggered caching...');
    cacheService.scheduleStaggeredCaching();
    
    console.log('Test completed successfully');
  } catch (err) {
    console.error('Error in test:', err);
  }
}

testPopularStocks(); 