const mongoose = require('mongoose');

const uri = 'mongodb+srv://jfranciscogb06:8C5JXwLTqe006AnZ@stockapp.tnroi.mongodb.net/?retryWrites=true&w=majority&appName=StockApp';

console.log('Testing connection to MongoDB...');

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('Successfully connected to MongoDB!');
  
  // List available collections in the database
  return mongoose.connection.db.listCollections().toArray();
})
.then(collections => {
  console.log('Available collections:');
  collections.forEach(collection => {
    console.log(` - ${collection.name}`);
  });
  
  // Count documents in NewsCache collection if it exists
  if (collections.some(c => c.name === 'newscaches')) {
    return mongoose.connection.db.collection('newscaches').countDocuments()
      .then(count => {
        console.log(`NewsCache collection contains ${count} documents`);
        return Promise.resolve();
      });
  }
  return Promise.resolve();
})
.then(() => {
  console.log('Connection test completed successfully');
  mongoose.connection.close();
})
.catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
}); 