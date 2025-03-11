const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

// Route for clearing the cache
router.post('/clear', stockController.clearCache.bind(stockController));

module.exports = router; 