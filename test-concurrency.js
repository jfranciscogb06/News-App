require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META'];

/**
 * Make a request to analyze a stock
 * @param {string} symbol - Stock symbol to analyze
 * @returns {Promise} Promise that resolves when the request is complete
 */
async function analyzeStock(symbol) {
  console.log(`Starting analysis request for ${symbol}...`);
  const startTime = Date.now();
  
  try {
    const response = await axios.get(`${BASE_URL}/api/stock-analysis/${symbol}`);
    const endTime = Date.now();
    const responseTime = (endTime - startTime) / 1000;
    
    console.log(`Response for ${symbol} received in ${responseTime.toFixed(2)}s`);
    
    // Check if it was a preliminary response
    if (response.data.status === 'processing') {
      console.log(`${symbol}: Received preliminary response, analysis running in background`);
    } else {
      console.log(`${symbol}: Analysis complete with ${response.data.articleCount} articles`);
    }
    
    return response.data;
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error.message);
    return { error: error.message };
  }
}

/**
 * Make a batch analysis request
 * @param {Array<string>} symbols - Stock symbols to analyze
 * @returns {Promise} Promise that resolves when the request is complete
 */
async function analyzeBatch(symbols) {
  console.log(`Starting batch analysis for ${symbols.join(', ')}...`);
  const startTime = Date.now();
  
  try {
    const response = await axios.post(`${BASE_URL}/api/stock-analysis/batch`, { symbols });
    const endTime = Date.now();
    const responseTime = (endTime - startTime) / 1000;
    
    console.log(`Batch response received in ${responseTime.toFixed(2)}s`);
    
    // Check if it was a preliminary response
    if (response.data.status === 'processing') {
      console.log(`Batch: Received preliminary response, analysis running in background`);
    } else {
      const successCount = Object.keys(response.data.results).length;
      const errorCount = response.data.errors ? Object.keys(response.data.errors).length : 0;
      console.log(`Batch: Analysis complete with ${successCount} successes and ${errorCount} errors`);
    }
    
    return response.data;
  } catch (error) {
    console.error(`Error in batch analysis:`, error.message);
    return { error: error.message };
  }
}

/**
 * Poll the queue status
 * @param {number} intervalMs - Polling interval in milliseconds
 * @param {number} durationMs - Total duration to poll for in milliseconds
 */
async function pollQueueStatus(intervalMs = 2000, durationMs = 60000) {
  console.log(`Starting queue status polling (interval: ${intervalMs}ms, duration: ${durationMs}ms)...`);
  
  let elapsed = 0;
  const interval = setInterval(async () => {
    try {
      const response = await axios.get(`${BASE_URL}/queue-status`);
      console.log(`Queue status at ${elapsed/1000}s:`, JSON.stringify(response.data.queue));
    } catch (error) {
      console.error('Error polling queue status:', error.message);
    }
    
    elapsed += intervalMs;
    if (elapsed >= durationMs) {
      clearInterval(interval);
      console.log('Queue status polling complete');
    }
  }, intervalMs);
}

/**
 * Run the concurrency test
 */
async function runTest() {
  console.log('Starting concurrency test...');
  
  // Start queue status polling
  pollQueueStatus(1000, 30000);
  
  // Make individual requests in parallel
  const individualPromises = TEST_SYMBOLS.slice(0, 3).map(symbol => analyzeStock(symbol));
  
  // Make a batch request at the same time
  const batchPromise = analyzeBatch(TEST_SYMBOLS);
  
  // Wait for all requests to complete
  await Promise.all([...individualPromises, batchPromise]);
  
  console.log('Concurrency test complete');
}

// Run the test
runTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
}); 