/**
 * Clear Cache Utility
 * 
 * This script clears all caches in the system, including:
 * - Popular stocks cache (in-memory)
 * - News cache (MongoDB)
 * - Popular searches (MongoDB)
 * - Any other in-memory state
 * 
 * Run with: node clearCache.js
 */

// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const db = require('./src/utils/db');

// Wait for MongoDB connection
async function main() {
  try {
    console.log('Clearing all caches...');

    // Wait for MongoDB to connect
    await new Promise((resolve) => {
      if (db.connection.readyState === 1) {
        resolve();
        return;
      }
      
      db.connection.once('connected', resolve);
    });
    
    // Get NewsCache model
    const NewsCache = require('./src/models/newsCache');
    
    // Define popular search schema (since we need to access it directly)
    const popularSearchSchema = new mongoose.Schema({
      symbol: { type: String },
      count: { type: Number },
      last_searched: { type: Date }
    });
    
    // Get or create the model
    const PopularSearchModel = mongoose.models.PopularSearch || 
      mongoose.model('PopularSearch', popularSearchSchema);
    
    // Clear the news cache
    const newsResult = await NewsCache.clearAll();
    console.log(`Cleared NewsCache: ${newsResult} entries deleted`);
    
    // Clear popular searches
    const searchResult = await PopularSearchModel.deleteMany({});
    console.log(`Cleared PopularSearch: ${searchResult.deletedCount} entries deleted`);
    
    // Optional: Clear any other collections as needed
    // Example: await SomeOtherModel.deleteMany({});
    
    console.log('All caches cleared successfully!');
    console.log('Please restart the server to ensure in-memory caches are also reset.');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    
    process.exit(0);
  } catch (error) {
    console.error('Error clearing caches:', error);
    process.exit(1);
  }
}

// Run the script
main(); 