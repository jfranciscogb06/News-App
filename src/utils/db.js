const mongoose = require('mongoose');
const config = require('../config/config');

// MongoDB connection options
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true
};

// Get the MongoDB URI from config
const dbUri = config.database.url;

// Log connection string (hide password)
console.log('MongoDB URI:', dbUri.replace(/:[^:]*@/, ':****@'));

// Connect to MongoDB
mongoose.connect(dbUri, options)
  .then(() => {
    console.log('Connected to MongoDB successfully');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// Set to handle deprecation warnings
mongoose.set('strictQuery', false);

// Export mongoose instance
module.exports = {
  mongoose,
  connection: mongoose.connection
}; 