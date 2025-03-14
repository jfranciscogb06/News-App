const mongoose = require('mongoose');
const config = require('../config/config');

// MongoDB connection options with improved settings
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  family: 4 // Use IPv4, skip trying IPv6
};

// Get the MongoDB URI from config
const dbUri = config.database.url;

// Log masked connection string
const maskedUri = dbUri.replace(/:([^@]*)@/, ':****@');
console.log('MongoDB connecting to:', maskedUri);

// Create the mongoose connection
mongoose.connect(dbUri, options)
  .then(() => {
    console.log('Connected to MongoDB successfully');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// Handle connection events
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected successfully');
});

// Handle application termination - close mongoose connection
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed due to app termination');
    process.exit(0);
  } catch (err) {
    console.error('Error during MongoDB connection closure:', err);
    process.exit(1);
  }
});

// Set to handle deprecation warnings
mongoose.set('strictQuery', false);

// Export mongoose instance
module.exports = {
  mongoose,
  connection: mongoose.connection
}; 