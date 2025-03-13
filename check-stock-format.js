/**
 * Check Stock Format Utility
 * 
 * This script checks if a stock's cached data is in the correct timeframe format.
 * 
 * Run with: node check-stock-format.js AAPL
 */

// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const db = require('./src/utils/db');

// Process command line arguments
const symbol = process.argv[2] ? process.argv[2].toUpperCase() : 'AAPL';

async function checkStockFormat() {
  try {
    console.log(`Checking format for ${symbol}...`);

    // Wait for MongoDB to connect
    await new Promise((resolve) => {
      if (db.connection.readyState === 1) {
        resolve();
        return;
      }
      
      db.connection.once('connected', resolve);
    });
    
    // Define the schema for news cache
    const newsCacheSchema = new mongoose.Schema({
      symbol: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        index: true
      },
      data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
      },
      created_at: {
        type: Date,
        default: Date.now
      },
      expires_at: {
        type: Date,
        required: true,
        index: true
      }
    });
    
    // Get the model (create it if it doesn't exist)
    let NewsCacheModel;
    try {
      NewsCacheModel = mongoose.model('NewsCache');
    } catch (error) {
      NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);
    }
    
    // Find the cache entry
    const cacheEntry = await NewsCacheModel.findOne({ symbol });
    
    if (!cacheEntry) {
      console.log(`No cache entry found for ${symbol}`);
      await mongoose.connection.close();
      return;
    }
    
    const data = cacheEntry.data;
    console.log(`Found cache entry for ${symbol}, expires: ${cacheEntry.expires_at}`);
    
    // Check if it has the timeframe structure
    if (data['7days'] && data['1month'] && data['3months'] && data['6months']) {
      console.log(`✅ ${symbol} cache is in the CORRECT timeframe format`);
      console.log(`Structure: ${Object.keys(data).join(', ')}`);
      
      // Print a summary of each timeframe
      Object.keys(data).forEach(timeframe => {
        if (data[timeframe].sentiment !== undefined) {
          console.log(`  • ${timeframe}: sentiment ${data[timeframe].sentiment}, direction ${data[timeframe].direction}`);
        }
      });
    } else if (data.articles && Array.isArray(data.articles)) {
      console.log(`❌ ${symbol} cache is in the OLD flat articles format`);
      console.log(`Found ${data.articles.length} articles`);
      console.log(`To fix, run: node fix-stock-format.js ${symbol}`);
    } else {
      console.log(`❓ ${symbol} cache is in an UNKNOWN format`);
      console.log(`Data keys: ${Object.keys(data).join(', ')}`);
      console.log(`To force a refresh, run: node force-refresh.js ${symbol}`);
    }
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error checking stock format:', error);
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Ignore error on close
    }
  }
}

// Run the check
checkStockFormat(); 