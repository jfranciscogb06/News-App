const express = require('express');
const config = require('./src/config/config');
const stockRoutes = require('./src/routes/stockRoutes');
const cacheRoutes = require('./src/routes/cacheRoutes');
const errorHandler = require('./src/utils/errorHandler');
const db = require('./src/utils/db');

// Initialize the app
const app = express();

// Connect to MongoDB
db.mongoose.connection.on('connected', () => {
  console.log('MongoDB connection established successfully');
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