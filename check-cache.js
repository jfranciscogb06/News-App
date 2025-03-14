const mongoose = require('mongoose');

const uri = 'mongodb+srv://jfranciscogb06:8C5JXwLTqe006AnZ@stockapp.tnroi.mongodb.net/?retryWrites=true&w=majority&appName=StockApp';

console.log('Testing connection to MongoDB...');

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('Successfully connected to MongoDB!');
  
  // Find all documents in NewsCache collection
  return mongoose.connection.db.collection('newscaches').find({}).toArray();
})
.then(documents => {
  console.log(`Found ${documents.length} documents in the NewsCache collection:`);
  
  // Print each document's symbol and expiration time
  documents.forEach((doc, index) => {
    const expiryDate = new Date(doc.expiresAt);
    const now = new Date();
    const diffMs = expiryDate - now;
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    console.log(`${index + 1}. Symbol: ${doc.symbol}, expires in: ${diffHrs}h ${diffMins}m`);
  });
  
  console.log('\nCache check completed successfully');
  mongoose.connection.close();
})
.catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
}); 