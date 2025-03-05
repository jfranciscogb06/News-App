const express = require('express');
const config = require('./src/config/config');
const stockRoutes = require('./src/routes/stockRoutes');
const errorHandler = require('./src/utils/errorHandler');

const app = express();

app.use(express.json());
app.use('/api', stockRoutes);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});