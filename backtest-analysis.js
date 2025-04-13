require('dotenv').config();
const axios = require('axios');
const stockController = require('./src/controllers/stockController');
const logger = require('./src/utils/logger');
const cacheService = require('./src/services/cacheService');

class BacktestAnalyzer {
  constructor() {
    this.yahooFinanceEndpoint = 'https://query1.finance.yahoo.com/v8/finance/chart/';
    this.analysisWindow = 7; // Days before the move to analyze
    this.minMoveThreshold = 5; // Minimum percentage move to consider significant
  }

  async getHistoricalPriceData(symbol, startDate, endDate) {
    try {
      const url = `${this.yahooFinanceEndpoint}${symbol}?period1=${Math.floor(startDate.getTime() / 1000)}&period2=${Math.floor(endDate.getTime() / 1000)}&interval=1d`;
      const response = await axios.get(url);
      return response.data.chart.result[0];
    } catch (error) {
      logger.error(`Error fetching price data for ${symbol}:`, error.message);
      throw error;
    }
  }

  calculatePriceChange(prices, timestamps) {
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      const percentChange = ((prices[i] - prices[i-1]) / prices[i-1]) * 100;
      changes.push({
        date: new Date(timestamps[i] * 1000),
        change: percentChange,
        price: prices[i],
        previousPrice: prices[i-1]
      });
    }
    return changes;
  }

  async findSignificantMoves(symbol, threshold = 5) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6); // Look back 6 months

    const priceData = await this.getHistoricalPriceData(symbol, startDate, endDate);
    const changes = this.calculatePriceChange(priceData.indicators.quote[0].close, priceData.timestamp);

    // Filter for significant moves and ensure we have enough data before each move
    return changes.filter(change => {
      const daysBeforeMove = Math.floor((change.date - startDate) / (1000 * 60 * 60 * 24));
      return Math.abs(change.change) >= threshold && daysBeforeMove >= this.analysisWindow;
    });
  }

  async runBacktest(symbol, significantMove) {
    try {
      // Set analysis date to 7 days before the significant move
      const analysisDate = new Date(significantMove.date);
      analysisDate.setDate(analysisDate.getDate() - this.analysisWindow);

      logger.info(`Running backtest for ${symbol} at ${analysisDate.toISOString()}`);
      logger.info(`Significant move: ${significantMove.change.toFixed(2)}% on ${significantMove.date.toISOString()}`);

      // Clear any existing cache for this symbol
      await cacheService.clearSymbolCache(symbol);

      // Create a mock request object
      const req = { 
        params: { symbol },
        query: { 
          analysisDate: analysisDate.toISOString(),
          ignoreAfter: significantMove.date.toISOString()
        }
      };

      // Create a mock response object
      const res = {
        json: (data) => {
          const prediction = data.sentimentAnalysis['7days'].prediction;
          const confidence = data.sentimentAnalysis['7days'].confidence;
          const magnitude = data.sentimentAnalysis['7days'].magnitude;

          logger.info('Backtest Results:');
          logger.info('----------------');
          logger.info(`Analysis Date: ${analysisDate.toISOString()}`);
          logger.info(`Significant Move Date: ${significantMove.date.toISOString()}`);
          logger.info(`Actual Price Change: ${significantMove.change.toFixed(2)}%`);
          logger.info(`System Prediction: ${prediction}`);
          logger.info(`Prediction Confidence: ${confidence}`);
          logger.info(`Predicted Magnitude: ${magnitude}`);
          logger.info(`Articles Analyzed: ${data.articleCount}`);

          // Determine if prediction was correct
          const wasCorrect = (prediction === 'UP' && significantMove.change > 0) ||
                            (prediction === 'DOWN' && significantMove.change < 0) ||
                            (prediction === 'SIDEWAYS' && Math.abs(significantMove.change) < this.minMoveThreshold);

          logger.info(`Prediction Accuracy: ${wasCorrect ? 'CORRECT' : 'INCORRECT'}`);
          
          return {
            symbol,
            analysisDate,
            moveDate: significantMove.date,
            actualChange: significantMove.change,
            prediction: {
              direction: prediction,
              confidence,
              magnitude
            },
            wasCorrect,
            articleCount: data.articleCount,
            keyFactors: data.sentimentAnalysis['7days'].key_factors,
            risks: data.sentimentAnalysis['7days'].risks
          };
        }
      };

      // Run the analysis
      return await stockController.analyzeStock(req, res);
    } catch (error) {
      logger.error(`Error in backtest for ${symbol}:`, error);
      return {
        symbol,
        error: error.message,
        analysisDate: new Date(significantMove.date.getTime() - this.analysisWindow * 24 * 60 * 60 * 1000),
        moveDate: significantMove.date,
        actualChange: significantMove.change
      };
    }
  }

  analyzeResults(results) {
    const analysis = {
      totalTests: results.length,
      correctPredictions: results.filter(r => r.wasCorrect).length,
      incorrectPredictions: results.filter(r => r.wasCorrect === false).length,
      errors: results.filter(r => r.error).length,
      averageArticlesPerTest: 0,
      commonKeyFactors: {},
      commonRisks: {}
    };

    // Calculate average articles per test
    const validResults = results.filter(r => !r.error && r.articleCount);
    if (validResults.length > 0) {
      analysis.averageArticlesPerTest = validResults.reduce((sum, r) => sum + r.articleCount, 0) / validResults.length;
    }

    // Analyze common key factors and risks
    validResults.forEach(result => {
      if (result.keyFactors) {
        result.keyFactors.forEach(factor => {
          analysis.commonKeyFactors[factor] = (analysis.commonKeyFactors[factor] || 0) + 1;
        });
      }
      if (result.risks) {
        result.risks.forEach(risk => {
          analysis.commonRisks[risk] = (analysis.commonRisks[risk] || 0) + 1;
        });
      }
    });

    // Calculate accuracy
    analysis.accuracy = (analysis.correctPredictions / (analysis.correctPredictions + analysis.incorrectPredictions)) * 100;

    return analysis;
  }
}

async function runBacktests() {
  try {
    const backtester = new BacktestAnalyzer();
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'];
    const results = [];

    for (const symbol of symbols) {
      logger.info(`Finding significant moves for ${symbol}...`);
      const significantMoves = await backtester.findSignificantMoves(symbol);
      
      if (significantMoves.length === 0) {
        logger.info(`No significant moves found for ${symbol}`);
        continue;
      }

      logger.info(`Found ${significantMoves.length} significant moves for ${symbol}`);
      
      // Test each significant move
      for (const move of significantMoves) {
        const result = await backtester.runBacktest(symbol, move);
        results.push(result);
      }
    }

    // Analyze results
    const analysis = backtester.analyzeResults(results);

    logger.info('\nOverall Results:');
    logger.info('---------------');
    logger.info(`Total Tests: ${analysis.totalTests}`);
    logger.info(`Correct Predictions: ${analysis.correctPredictions}`);
    logger.info(`Incorrect Predictions: ${analysis.incorrectPredictions}`);
    logger.info(`Errors: ${analysis.errors}`);
    logger.info(`Accuracy: ${analysis.accuracy.toFixed(2)}%`);
    logger.info(`Average Articles per Test: ${analysis.averageArticlesPerTest.toFixed(2)}`);

    // Save results to a file
    const fs = require('fs');
    fs.writeFileSync('backtest-results.json', JSON.stringify({
      results,
      analysis
    }, null, 2));
    logger.info('\nResults saved to backtest-results.json');

  } catch (error) {
    logger.error('Error running backtests:', error);
  } finally {
    process.exit(0);
  }
}

runBacktests().catch(console.error); 