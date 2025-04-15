require('dotenv').config();
const stockController = require('./src/controllers/stockController');
const logger = require('./src/utils/logger');
const cacheService = require('./src/services/cacheService');

async function testStockAnalysis(symbol) {
  try {
    console.log(`\nAnalyzing stock: ${symbol}`);
    const startTime = Date.now();

    // Create mock request and response objects
    const req = { params: { symbol } };
    const res = {
      json: (data) => {
        return data;
      }
    };

    // Call the controller directly
    const result = await stockController.analyzeStock(req, res);
    const endTime = Date.now();

    return {
      success: true,
      time: (endTime - startTime) / 1000,
      articles: result.articles?.length || 0,
      timeframes: Object.keys(result.sentimentAnalysis || {}).length,
      data: result
    };
  } catch (error) {
    console.error('Error details:', error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

async function runTest() {
  try {
    console.log('Starting stock analysis test...');
    
    // Clear the cache first
    await cacheService.clearSymbolCache('AAPL');
    console.log('Cache cleared for AAPL');
    
    const result = await testStockAnalysis('AAPL');
    console.log('\nTest Result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\nTest passed successfully!');
      console.log(`Time taken: ${result.time.toFixed(2)} seconds`);
      console.log(`Articles found: ${result.articles}`);
      console.log(`Timeframes analyzed: ${result.timeframes}`);
    } else {
      console.log('\nTest failed!');
      console.log('Error:', result.error);
      if (result.stack) {
        console.log('Stack trace:', result.stack);
      }
    }
  } catch (error) {
    console.error('Test execution error:', error);
  }
}

runTest(); 