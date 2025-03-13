/**
 * Fix Stock Format Utility
 * 
 * This script transforms stock analysis data in MongoDB from old format (flat articles array)
 * to the new timeframe-organized format (7days, 1month, 3months, 6months).
 * 
 * Run with: node fix-stock-format.js AAPL
 */

// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const db = require('./src/utils/db');
const openaiService = require('./src/services/openaiService');

// Process command line arguments
const symbol = process.argv[2] ? process.argv[2].toUpperCase() : 'AAPL';

async function fixStockFormat() {
  try {
    console.log(`Starting format fix for ${symbol}...`);

    // Wait for MongoDB to connect
    await new Promise((resolve) => {
      if (db.connection.readyState === 1) {
        resolve();
        return;
      }
      
      db.connection.once('connected', resolve);
    });
    
    // Get the existing cache entry - use the existing model to avoid conflicts
    let NewsCacheModel;
    try {
      NewsCacheModel = mongoose.model('NewsCache');
    } catch (error) {
      // In case the model doesn't exist yet, define the schema
      const newsCacheSchema = new mongoose.Schema({
        symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
        data: { type: mongoose.Schema.Types.Mixed, required: true },
        created_at: { type: Date, default: Date.now },
        expires_at: { type: Date, required: true, index: true }
      });
      
      NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);
    }
    
    const existingCache = await NewsCacheModel.findOne({ symbol });
    
    if (!existingCache) {
      console.error(`No cache entry found for ${symbol}`);
      await mongoose.connection.close();
      process.exit(1);
    }
    
    const originalData = existingCache.data;
    console.log(`Found existing cache entry for ${symbol}`);
    
    // Check if it's already in the desired format
    if (originalData && originalData['7days'] && originalData['1month'] && 
        originalData['3months'] && originalData['6months']) {
      console.log(`${symbol} is already in the correct format!`);
      await mongoose.connection.close();
      process.exit(0);
    }
    
    // If it's the old format (flat articles array), transform it
    if (originalData && originalData.articles && Array.isArray(originalData.articles)) {
      console.log(`Found old format with ${originalData.articles.length} articles. Transforming...`);
      
      // Use the OpenAI service to organize and analyze the articles
      const articles = originalData.articles;
      const analysis = await openaiService.analyzeArticles(symbol, articles);
      
      console.log(`Successfully transformed ${symbol} data to timeframe format`);
      
      // Update the cache with the new format
      existingCache.data = analysis;
      await existingCache.save();
      
      console.log(`${symbol} cache updated with new format!`);
      console.log('New structure:', Object.keys(analysis).join(', '));
      
      // Print summary of the timeframes
      Object.keys(analysis).forEach(timeframe => {
        console.log(`${timeframe}: sentiment ${analysis[timeframe].sentiment}, direction ${analysis[timeframe].direction}`);
      });
    } else {
      console.error(`Unexpected data format for ${symbol}`);
    }
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing stock format:', error);
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Ignore error on close
    }
    process.exit(1);
  }
}

// Run the fix
fixStockFormat(); 