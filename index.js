const express = require('express');
const config = require('./src/config/config');
const stockRoutes = require('./src/routes/stockRoutes');
const cacheRoutes = require('./src/routes/cacheRoutes');
const errorHandler = require('./src/utils/errorHandler');
const cacheService = require('./src/services/cacheService');

const app = express();

app.use(express.json());
app.use('/', stockRoutes);
app.use('/cache', cacheRoutes);
app.use(errorHandler);

// Initialize the cache service
cacheService.initialize();

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});