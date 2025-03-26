const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

router.get('/:symbol', stockController.analyzeStock.bind(stockController));

module.exports = router; 