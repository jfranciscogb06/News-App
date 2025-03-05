const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'An error occurred while analyzing the stock',
    details: err.message 
  });
};

module.exports = errorHandler; 