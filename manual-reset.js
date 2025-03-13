/**
 * Manual Reset Script
 * 
 * This script manually deletes a stock from MongoDB cache to force a fresh load
 * on the next request.
 * 
 * Run with: node manual-reset.js AAPL
 */

// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const db = require('./src/utils/db');

// Process command line arguments
const symbol = process.argv[2] ? process.argv[2].toUpperCase() : 'AAPL';

async function manualReset() {
  try {
    console.log(`Starting manual reset for ${symbol}...`);

    // Wait for MongoDB to connect
    await new Promise((resolve) => {
      if (db.connection.readyState === 1) {
        resolve();
        return;
      }
      
      db.connection.once('connected', resolve);
    });
    
    // Get access to the news cache model
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
    
    // Delete any existing cache for this symbol
    const result = await NewsCacheModel.deleteMany({ symbol });
    
    if (result.deletedCount > 0) {
      console.log(`Successfully deleted ${result.deletedCount} cache entries for ${symbol}`);
    } else {
      console.log(`No cache entries found for ${symbol}`);
    }
    
    // Clean up any potentially related MongoDB collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    for (const collection of collections) {
      const name = collection.name.toLowerCase();
      
      // Check if it's a cache-related collection that might contain our symbol
      if (name.includes('cache') || name.includes('news') || name.includes('stock')) {
        try {
          const relatedColl = mongoose.connection.db.collection(collection.name);
          const relatedResult = await relatedColl.deleteMany({ symbol });
          
          if (relatedResult.deletedCount > 0) {
            console.log(`Also deleted ${relatedResult.deletedCount} entries for ${symbol} from ${collection.name}`);
          }
        } catch (error) {
          console.error(`Error cleaning up ${collection.name}:`, error);
        }
      }
    }
    
    console.log(`\nDone. ${symbol} has been removed from the cache.`);
    console.log('The next API request for this symbol will generate fresh data.');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during manual reset:', error);
    try {
      await mongoose.connection.close();
    } catch (e) {
      // Ignore error on close
    }
    process.exit(1);
  }
}

// Run the manual reset
manualReset(); 