const express = require('express');
const config = require('./src/config/config');
const stockRoutes = require('./src/routes/stockRoutes');
const cacheRoutes = require('./src/routes/cacheRoutes');
const errorHandler = require('./src/utils/errorHandler');
const db = require('./src/utils/db');
const cacheService = require('./src/services/cacheService');

// Initialize the app
const app = express();

// Test PostgreSQL connection and initialize cache service
db.query('SELECT NOW()')
  .then(() => {
    console.log('PostgreSQL connection established successfully');
    // Initialize cache service after database connection is established
    cacheService.initialize();
  })
  .catch(err => {
    console.error('Error connecting to PostgreSQL:', err);
    process.exit(1);
  });

// Middleware
app.use(express.json());

// Routes
app.use('/', stockRoutes);
app.use('/cache', cacheRoutes);

// Error handler
app.use(errorHandler);

// Start the server
const PORT = config.port || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});