const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/stock-analysis/:symbol', stockController.analyzeStock.bind(stockController));

module.exports = router; 