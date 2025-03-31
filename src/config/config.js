require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY
  },
  newsapi: {
    apiKey: process.env.NEWSAPI_API_KEY
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY,
    searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || '' // Optional for now
  },
  serpapi: {
    apiKey: process.env.SERPAPI_API_KEY || '4eec45a26530daedf7c8bdd7c46c114550845dc197447bd880a507ec334103bd'
  },
  database: {
    url: process.env.DATABASE_URL
  }
}; 