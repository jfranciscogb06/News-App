# MongoDB Setup for News App

This guide explains how to set up and use MongoDB with the News App.

## Prerequisites

- Node.js (v14.0.0 or higher)
- MongoDB Atlas account (or a local MongoDB server)

## Setup Instructions

### 1. MongoDB Atlas Setup

If you're using MongoDB Atlas:

1. Create an account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster (the free tier is sufficient)
3. Set up a database user with read/write permissions
4. Whitelist your IP address in the Network Access settings
5. Get your connection string from the "Connect" button

### 2. Environment Configuration

1. Update your `.env` file with the MongoDB connection string:

```
MONGODB_URI=mongodb+srv://jfranciscogb06:<db_password>@newsapp.t2rza.mongodb.net/?retryWrites=true&w=majority&appName=NewsApp
```

2. Replace `<db_password>` with your actual MongoDB password

### 3. Testing the Connection

Run the test script to verify your MongoDB connection:

```bash
# Edit the test-mongodb.js file to include your actual password
node test-mongodb.js
```

If successful, you should see:
- "Connected to MongoDB successfully!"
- "Created test document: ..."
- "MongoDB connection and operations successful!"

## How It Works

The News App now uses MongoDB to cache news articles and analysis:

1. **Database Connection**: The `src/utils/db.js` file establishes a connection to MongoDB using Mongoose.

2. **Cache Model**: The `src/models/newsCache.js` file defines a Mongoose schema and model for the cache.

3. **Caching Operations**:
   - `getBySymbol`: Retrieves cached data for a stock symbol
   - `save`: Saves analysis data to the cache with an expiration time
   - `cleanExpired`: Removes expired cache entries

## Troubleshooting

If you encounter connection issues:

1. **Authentication Errors**:
   - Verify your username and password
   - Check that your IP is whitelisted in MongoDB Atlas

2. **Connection String Format**:
   - Ensure the connection string format is correct
   - Make sure you've replaced `<db_password>` with your actual password

3. **MongoDB Version Compatibility**:
   - The app uses Mongoose 6.10.0, which is compatible with MongoDB 3.6+

## Schema Details

The cache uses the following MongoDB schema:

```javascript
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
```

This schema stores:
- The stock symbol (indexed for faster lookups)
- The analysis data (as a mixed type that can store any JSON structure)
- Creation timestamp
- Expiration timestamp (indexed for efficient cleanup) 