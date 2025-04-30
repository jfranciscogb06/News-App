require('dotenv').config();
const stockAnalysisService = require('./src/services/stockAnalysisService');
const logger = require('./src/utils/logger');

async function testStockAnalysis(symbol = 'AAPL') {
  try {
    logger.info(`Starting analysis test for ${symbol}`);
    
    const startTime = Date.now();
    const analysis = await stockAnalysisService.analyzeStock(symbol);
    const duration = (Date.now() - startTime) / 1000;
    
    logger.info(`Analysis completed in ${duration.toFixed(2)}s`);
    logger.info('Analysis results:', {
      symbol: analysis.symbol,
      articleCount: analysis.articleCount,
      status: analysis.status,
      timeframes: Object.keys(analysis.analysis).map(timeframe => ({
        timeframe,
        sentiment: analysis.analysis[timeframe].sentiment,
        confidence: analysis.analysis[timeframe].confidence,
        direction: analysis.analysis[timeframe].price_direction,
        articles: analysis.analysis[timeframe].articles
      }))
    });

    return analysis;
  } catch (error) {
    logger.error('Test failed:', error);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  const symbol = process.argv[2] || 'AAPL';
  testStockAnalysis(symbol)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = testStockAnalysis; 