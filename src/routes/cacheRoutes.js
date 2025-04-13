const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

// Routes for clearing the cache - support both GET and POST
router.get('/clear', stockController.clearCache.bind(stockController));
router.post('/clear', stockController.clearCache.bind(stockController));

// Route for getting popular stocks
router.get('/popular', stockController.getPopularStocks.bind(stockController));

module.exports = router; 