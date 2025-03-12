require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  newsapi: {
    apiKey: process.env.NEWSAPI_API_KEY
  },
  polygon: {
    apiKey: process.env.POLYGONIO_API_KEY
  },
  database: {
    url: process.env.MONGODB_URI
  }
}; 