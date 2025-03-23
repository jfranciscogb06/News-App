# PostgreSQL Setup Guide

This guide explains how to set up and configure PostgreSQL for the News App.

## Database Configuration

1. **Database Connection**: The `src/utils/db.js` file establishes a connection to PostgreSQL using the `pg` package.
2. **Cache Models**: The app uses two main tables:
   - `news_cache`: Stores cached news analysis data
   - `popular_searches`: Tracks popular stock symbols

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# PostgreSQL Connection (use your Render.com database URL)
DATABASE_URL=postgres://user:password@host:5432/dbname

# Other configurations
PORT=3000
NODE_ENV=development
OPENAI_API_KEY=your_openai_api_key
NEWS_API_KEY=your_newsapi_key
```

## Database Schema

The app automatically creates the necessary tables on startup:

### News Cache Table
```sql
CREATE TABLE IF NOT EXISTS news_cache (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  analysis JSONB NOT NULL,
  source_credibility JSONB,
  article_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_cache_symbol ON news_cache(symbol);
CREATE INDEX IF NOT EXISTS idx_news_cache_expires_at ON news_cache(expires_at);
```

### Popular Searches Table
```sql
CREATE TABLE IF NOT EXISTS popular_searches (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10) NOT NULL,
  count INTEGER DEFAULT 1,
  last_searched TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol)
);

CREATE INDEX IF NOT EXISTS idx_popular_searches_count ON popular_searches(count DESC);
CREATE INDEX IF NOT EXISTS idx_popular_searches_last_searched ON popular_searches(last_searched DESC);
```

## Render.com PostgreSQL Setup

1. Create a new PostgreSQL database in your Render.com dashboard
2. Copy the "External Database URL" from the database settings
3. Add this URL as the `DATABASE_URL` environment variable in your `.env` file
4. The database will be automatically configured when you first run the app

## Technical Details

- The app uses the `pg` package version 8.14.0
- PostgreSQL 12+ is recommended
- SSL is enabled for Render.com connections
- Connection pooling is used for better performance
- JSONB type is used for storing JSON data efficiently
- Automatic table creation and indexing on startup
- Built-in connection retry mechanism

## Utility Scripts

The app includes several utility scripts for database management:

1. `test-cache-save.js`: Test the cache saving functionality
2. `check-cache.js`: View all cached entries
3. `clearCache.js`: Clear all cache tables

## Error Handling

The app includes robust error handling for database operations:
- Connection failures
- Query timeouts
- Constraint violations
- SSL certificate issues

## Best Practices

1. **Connection Pool**: The app uses a connection pool to manage database connections efficiently
2. **Prepared Statements**: All queries use parameterized queries to prevent SQL injection
3. **Indexing**: Appropriate indexes are created for better query performance
4. **JSON Storage**: JSONB type is used for efficient JSON data storage and querying
5. **Error Handling**: Comprehensive error handling with automatic reconnection
6. **Cache Management**: Automatic cache cleanup for expired entries

## Troubleshooting

1. **Connection Issues**
   - Check if the DATABASE_URL is correct
   - Verify that the database is accessible from your network
   - Check if SSL is required (Render.com requires SSL)

2. **Performance Issues**
   - Monitor the connection pool size
   - Check query execution plans
   - Verify index usage

3. **Cache Issues**
   - Run `check-cache.js` to view cache contents
   - Use `clearCache.js` to clear all caches
   - Check table sizes and cleanup old data

## Maintenance

Regular maintenance tasks:

1. **Cache Cleanup**
   - Expired entries are automatically removed
   - Run `clearCache.js` for manual cleanup

2. **Database Optimization**
   - Regular VACUUM operations (handled by Render.com)
   - Index maintenance (automatic)

3. **Monitoring**
   - Check cache hit rates
   - Monitor database size
   - Track query performance 