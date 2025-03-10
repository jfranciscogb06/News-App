# News App Caching Implementation

This document describes the implementation of caching for news articles and analysis using Render's PostgreSQL database.

## Files Created/Modified

1. **src/utils/db.js** - Database utility for PostgreSQL connection
2. **src/models/newsCache.js** - Model for caching news articles and analysis
3. **src/controllers/stockController.js** - Modified to use the cache

## Implementation Details

### Database Schema

The caching system uses a PostgreSQL table with the following schema:

```sql
CREATE TABLE IF NOT EXISTS news_cache (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_cache_symbol ON news_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_news_cache_expires_at ON news_cache(expires_at);
```

### Caching Flow

1. When a request for stock analysis is received, the system first checks if there's a valid (non-expired) cache entry for the requested symbol.
2. If a valid cache entry exists, it's returned immediately without performing the expensive news collection and analysis.
3. If no valid cache exists, the system performs the news collection and analysis as usual, then saves the result to the cache for future requests.
4. Expired cache entries are automatically cleaned up in the background.

### Cache TTL (Time To Live)

By default, cache entries expire after 24 hours. This value can be adjusted based on how frequently news articles are updated and how often the analysis needs to be refreshed.

## Dependencies

The implementation requires the following dependencies:

- `pg` - PostgreSQL client for Node.js

## Installation

1. Make sure the `pg` package is installed:
   ```
   npm install pg
   ```

2. Ensure the `DATABASE_URL` environment variable is set in your `.env` file:
   ```
   DATABASE_URL=postgresql://username:password@host:port/database
   ```

## Testing

You can test the caching implementation using the provided test scripts:

1. **test-db.js** - Tests the database connection
2. **test-cache.js** - Tests the caching functionality

## Troubleshooting

If you encounter issues with the database connection:

1. Verify that the `DATABASE_URL` is correct and accessible
2. Check that the PostgreSQL server is running
3. Ensure that the database user has the necessary permissions
4. Check that the SSL configuration is correct for Render's PostgreSQL

## Notes

- The caching implementation preserves the original format and algorithms of the news collection and analysis.
- The cache is transparent to the client - the response format remains the same whether the data comes from the cache or is freshly generated.
- The implementation includes a mechanism to clean up expired cache entries to prevent the database from growing indefinitely. 