// Load environment variables
require('dotenv').config();

// Import required modules
const mongoose = require('mongoose');
const db = require('./src/utils/db');

// Define the schema for news cache (copied from NewsCache.js to avoid model registration issues)
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

// Check cache expiration
async function checkCacheExpiration() {
  try {
    console.log('Checking existing cache entries and their expiration times...');
    
    // Wait for MongoDB connection
    await new Promise(resolve => {
      setTimeout(resolve, 2000);
    });
    
    // Get all cache entries
    // Use the existing model if it exists, or create a new one
    let NewsCacheModel;
    try {
      NewsCacheModel = mongoose.model('NewsCache');
    } catch (e) {
      NewsCacheModel = mongoose.model('NewsCache', newsCacheSchema);
    }
    
    const entries = await NewsCacheModel.find().sort({ expires_at: 1 });
    
    console.log(`Found ${entries.length} cache entries.`);
    
    // Show expiration times for each entry
    if (entries.length > 0) {
      console.log('\nExpiration times for cached entries:');
      const now = new Date();
      
      for (const entry of entries) {
        const expTime = entry.expires_at;
        const diffMinutes = Math.round((expTime - now) / (60 * 1000));
        
        if (diffMinutes < 0) {
          console.log(`${entry.symbol}: EXPIRED ${Math.abs(diffMinutes)} minutes ago`);
        } else {
          console.log(`${entry.symbol}: Expires in ${diffMinutes} minutes`);
        }
      }
    }
    
    console.log('\nCheck completed!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the check
checkCacheExpiration(); 