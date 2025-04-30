require('dotenv').config();
const stockController = require('./src/controllers/stockController');
const logger = require('./src/utils/logger');
const cacheService = require('./src/services/cacheService');
const openaiService = require('./src/services/openaiService');

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

    // Generate timeframe summaries if not already present
    if (!result.timeframeSummaries) {
      result.timeframeSummaries = await openaiService.summarizeTimeframes(result.sentimentAnalysis, symbol);
    }

    // Format the output
    const formattedOutput = {
      symbol,
      analysisTime: (endTime - startTime) / 1000,
      articleCount: result.articles?.length || 0,
      timeframes: Object.keys(result.sentimentAnalysis || {}).length,
      timeframeSummaries: result.timeframeSummaries || {},
      sentimentAnalysis: result.sentimentAnalysis || {},
      sourceCredibility: result.sourceCredibility || {},
      overallSummary: await generateOverallSummary(result)
    };

    return {
      success: true,
      data: formattedOutput
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

async function generateOverallSummary(result) {
  try {
    const timeframes = ['7days', '1month', '3months', '6months'];
    const predictions = timeframes.map(timeframe => ({
      timeframe,
      prediction: result.sentimentAnalysis[timeframe]?.prediction || 'STABLE',
      confidence: result.sentimentAnalysis[timeframe]?.confidence || 'low',
      magnitude: result.sentimentAnalysis[timeframe]?.magnitude || 'slight'
    }));

    // Count predictions
    const predictionCounts = {
      UP: 0,
      DOWN: 0,
      STABLE: 0
    };

    predictions.forEach(p => predictionCounts[p.prediction]++);

    // Determine overall trend
    let overallTrend = 'STABLE';
    if (predictionCounts.UP > predictionCounts.DOWN && predictionCounts.UP > predictionCounts.STABLE) {
      overallTrend = 'UP';
    } else if (predictionCounts.DOWN > predictionCounts.UP && predictionCounts.DOWN > predictionCounts.STABLE) {
      overallTrend = 'DOWN';
    }

    // Calculate average confidence
    const confidenceScores = {
      high: 3,
      medium: 2,
      low: 1
    };
    const totalConfidence = predictions.reduce((sum, p) => sum + confidenceScores[p.confidence], 0);
    const avgConfidence = totalConfidence / predictions.length;
    const overallConfidence = avgConfidence >= 2.5 ? 'high' : avgConfidence >= 1.5 ? 'medium' : 'low';

    return {
      overallTrend,
      overallConfidence,
      predictionCounts,
      timeframePredictions: predictions
    };
  } catch (error) {
    console.error('Error generating overall summary:', error);
    return {
      overallTrend: 'STABLE',
      overallConfidence: 'low',
      predictionCounts: { UP: 0, DOWN: 0, STABLE: 0 },
      timeframePredictions: []
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
    console.log('\nTest Result:');
    
    if (result.success) {
      const { data } = result;
      console.log(`\nAnalysis completed in ${data.analysisTime.toFixed(2)} seconds`);
      console.log(`Articles analyzed: ${data.articleCount}`);
      console.log(`Timeframes processed: ${data.timeframes}`);
      
      console.log('\nTimeframe Summaries:');
      Object.entries(data.timeframeSummaries).forEach(([timeframe, summary]) => {
        console.log(`\n${timeframe}:`);
        console.log(summary);
      });
      
      console.log('\nSentiment Analysis:');
      Object.entries(data.sentimentAnalysis).forEach(([timeframe, analysis]) => {
        console.log(`\n${timeframe}:`);
        console.log(`Prediction: ${analysis.prediction}`);
        console.log(`Confidence: ${analysis.confidence}`);
        console.log(`Magnitude: ${analysis.magnitude}`);
        console.log(`Key Factors: ${analysis.key_factors?.join(', ') || 'None'}`);
      });
      
      console.log('\nOverall Summary:');
      console.log(`Trend: ${data.overallSummary.overallTrend}`);
      console.log(`Confidence: ${data.overallSummary.overallConfidence}`);
      console.log('Prediction Distribution:', data.overallSummary.predictionCounts);
      
      console.log('\nSource Credibility:');
      console.log(`Average Score: ${data.sourceCredibility.averageCredibilityScore}`);
      console.log('Credibility Distribution:', data.sourceCredibility.credibilityDistribution);
      console.log('Sources Used:', data.sourceCredibility.sourcesUsed);
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