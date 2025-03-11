require('dotenv').config();
const mongoose = require('mongoose');

// Get the MongoDB URI from environment variables
const mongoUri = process.env.MONGODB_URI;

// Replace <db_password> with your actual password
// You'll need to replace this with your actual password when running the script
const uri = mongoUri.replace('<db_password>', 'your_password_here');

console.log('Mongoose version:', mongoose.version);
console.log('Connecting to MongoDB...');
console.log('MongoDB URI:', uri.replace(/:[^:]*@/, ':****@')); // Hide password in logs

// Set to handle deprecation warnings
mongoose.set('strictQuery', false);

// Connect to MongoDB
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000 // Timeout after 5s instead of 30s
})
.then(() => {
  console.log('Connected to MongoDB successfully!');
  
  // Create a simple schema and model for testing
  const TestSchema = new mongoose.Schema({
    name: String,
    date: { type: Date, default: Date.now }
  });
  
  const Test = mongoose.model('Test', TestSchema);
  
  // Create a test document
  return Test.create({ name: 'Test Document' });
})
.then(doc => {
  console.log('Created test document:', doc);
  console.log('MongoDB connection and operations successful!');
})
.catch(err => {
  console.error('MongoDB connection error:', err);
})
.finally(() => {
  // Close the connection
  mongoose.connection.close();
  console.log('MongoDB connection closed');
}); 