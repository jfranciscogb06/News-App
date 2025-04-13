const express = require('express');
const logger = require('./src/utils/logger');
const config = require('./src/config/config');
const routes = require('./src/routes');
const errorHandler = require('./src/utils/errorHandler');
const db = require('./src/utils/db');
const cacheService = require('./src/services/cacheService');
const queueService = require('./src/services/queueService');

// Initialize the app
const app = express();

// Test PostgreSQL connection and initialize cache service
db.query('SELECT NOW()')
  .then(() => {
    console.log('PostgreSQL connection established successfully');
    
    // Configure queue concurrency based on environment
    queueService.setMaxConcurrent('analysis', process.env.MAX_CONCURRENT_ANALYSIS || 5);
    queueService.setMaxConcurrent('caching', process.env.MAX_CONCURRENT_CACHING || 10);
    queueService.setMaxConcurrent('validation', process.env.MAX_CONCURRENT_VALIDATION || 10);
    console.log('Queue service initialized with concurrency settings:', queueService.getStatus());
    
    // Initialize cache service after database connection is established
    cacheService.initialize();
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL:', err);
    process.exit(1);
  });

// Middleware
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body
  });
  next();
});

// Mount all routes
app.use('/api', routes);

// Error handler
app.use(errorHandler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    queue: queueService.getStatus(),
    timestamp: new Date()
  });
});

// Queue status endpoint
app.get('/queue-status', (req, res) => {
  res.json({ 
    queue: queueService.getStatus(),
    timestamp: new Date()
  });
});

// Start the server
const PORT = config.port || 3000;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});