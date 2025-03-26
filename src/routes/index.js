const express = require('express');
const router = express.Router();
const stockRoutes = require('./stockRoutes');
const cacheRoutes = require('./cacheRoutes');

// Mount routes
router.use('/stock-analysis', stockRoutes);
router.use('/cache', cacheRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

module.exports = router; 