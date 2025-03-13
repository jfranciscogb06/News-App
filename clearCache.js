/**
 * Clear Cache Utility
 * 
 * This script completely clears all caches in the system, including:
 * - Popular stocks cache (in-memory and MongoDB)
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

    // Define a drop collection function with error handling
    const dropCollection = async (name) => {
      try {
        await mongoose.connection.dropCollection(name);
        console.log(`Dropped collection: ${name}`);
        return true;
      } catch (error) {
        if (error.code === 26) {
          console.log(`Collection ${name} doesn't exist, nothing to drop`);
          return true;
        }
        console.error(`Error dropping collection ${name}:`, error);
        return false;
      }
    };
    
    // Try the aggressive approach - drop the entire collections
    let newsCollectionDropped = await dropCollection('newscaches');
    let searchesCollectionDropped = await dropCollection('popularsearches');
    
    // If dropping fails, fallback to clearing each collection
    if (!newsCollectionDropped) {
      // Clear the news cache the traditional way
      const newsResult = await NewsCache.clearAll();
      console.log(`Cleared NewsCache: ${newsResult} entries deleted`);
    }
    
    if (!searchesCollectionDropped) {
      // Clear popular searches the traditional way
      const searchResult = await PopularSearchModel.deleteMany({});
      console.log(`Cleared PopularSearch: ${searchResult.deletedCount} entries deleted`);
    }
    
    // Check for any other collections that might contain cache data
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    for (const collection of collections) {
      const name = collection.name;
      
      // Check if it's likely a cache-related collection (adjust these patterns as needed)
      if (name.toLowerCase().includes('cache') || 
          name.toLowerCase().includes('popular') || 
          name.toLowerCase().includes('stock') ||
          name.toLowerCase().includes('news')) {
        
        console.log(`Found potential cache collection: ${name}`);
        await dropCollection(name);
      }
    }
    
    console.log('All caches cleared successfully!');
    console.log('Please restart the server to ensure in-memory caches are also reset.');
    console.log('');
    console.log('IMPORTANT: Some data may have been cached with different formats.');
    console.log('For complete cache refresh, please also run:');
    console.log('1. curl http://localhost:3000/api/cache/clear');
    console.log('2. Restart the server');
    
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