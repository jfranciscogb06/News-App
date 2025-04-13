const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/:symbol', stockController.analyzeStock.bind(stockController));
router.post('/batch', stockController.analyzeMultipleStocks.bind(stockController));

module.exports = router; 