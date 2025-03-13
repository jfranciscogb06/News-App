/**
 * Force Refresh Utility
 * 
 * This script forces a complete refresh of the cache for a specific stock,
 * bypassing any existing cache and ensuring the data is stored in the new timeframe format.
 * 
 * Run with: node force-refresh.js AAPL
 */

// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const db = require('./src/utils/db');
const newsService = require('./src/services/newsService');
const openaiService = require('./src/services/openaiService');

// Process command line arguments
const symbol = process.argv[2] ? process.argv[2].toUpperCase() : 'AAPL';

async function forceRefresh() {
  try {
    console.log(`Starting forced refresh for ${symbol}...`);

    // Wait for MongoDB to connect
    await new Promise((resolve) => {
      if (db.connection.readyState === 1) {
        resolve();
        return;
      }
      
      db.connection.once('connected', resolve);
    });
    
    // Access the NewsCache functionality
    // Get the news cache model and functionality
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
    
    // Create a utility object with the same methods as NewsCache
    const NewsCache = {
      async clearBySymbol(symbol) {
        try {
          const result = await NewsCacheModel.deleteMany({
            symbol: symbol.toUpperCase()
          });
          return result.deletedCount;
        } catch (error) {
          console.error(`Error clearing cache for symbol ${symbol}:`, error);
          return 0;
        }
      },
      
      async save(symbol, data, ttlMinutes = 30) {
        try {
          // Add a random offset (0-10 minutes) to stagger expirations
          const randomOffsetMinutes = Math.floor(Math.random() * 10);
          const totalMinutes = ttlMinutes + randomOffsetMinutes;
          
          // Calculate expiration date with the staggered offset
          const expiresAt = new Date();
          expiresAt.setMinutes(expiresAt.getMinutes() + totalMinutes);
          
          // Delete any existing cache for this symbol
          await NewsCacheModel.deleteMany({ symbol: symbol.toUpperCase() });
          
          // Insert new cache entry
          await NewsCacheModel.create({
            symbol: symbol.toUpperCase(),
            data,
            expires_at: expiresAt
          });
          
          console.log(`Cache saved for symbol: ${symbol}, expires in ${totalMinutes} minutes (staggered)`);
          return true;
        } catch (error) {
          console.error('Error saving to cache:', error);
          return false;
        }
      }
    };
    
    // First, clear any existing cache for this symbol
    console.log(`Clearing existing cache for ${symbol}...`);
    const clearResult = await NewsCache.clearBySymbol(symbol);
    console.log(`Cleared ${clearResult} cache entries for ${symbol}`);
    
    // Collect fresh news
    console.log(`Collecting fresh news for ${symbol}...`);
    const { articles, count } = await newsService.collectAndAnalyzeNews(symbol, 30);
    console.log(`Collected ${count} articles for ${symbol}`);
    
    // Analyze with OpenAI to get the timeframe format
    console.log(`Analyzing articles with OpenAI...`);
    const analysis = await openaiService.analyzeArticles(symbol, articles);
    
    // Verify the structure has timeframes
    const hasTimeframes = analysis['7days'] && analysis['1month'] && 
                          analysis['3months'] && analysis['6months'];
    
    if (!hasTimeframes) {
      throw new Error('Analysis result does not have the expected timeframe structure');
    }
    
    // Save to cache
    console.log(`Saving new analysis to cache...`);
    await NewsCache.save(symbol, analysis);
    
    console.log(`Successfully refreshed ${symbol} with new format!`);
    console.log('Timeframe structure:', Object.keys(analysis).join(', '));
    
    // Print summary of the timeframes
    Object.keys(analysis).forEach(timeframe => {
      console.log(`${timeframe}: sentiment ${analysis[timeframe].sentiment}, direction ${analysis[timeframe].direction}`);
    });
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during forced refresh:', error);
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Ignore error on close
    }
    process.exit(1);
  }
}

// Run the force refresh
forceRefresh(); 