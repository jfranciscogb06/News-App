const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/stock-analysis/:symbol', stockController.analyzeStock.bind(stockController));
router.post('/clear-cache', stockController.clearCache.bind(stockController));

module.exports = router; 