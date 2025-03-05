require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  newsapi: {
    apiKey: process.env.NEWS_API_KEY
  }
}; 