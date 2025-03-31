require('dotenv').config();
const newsService = require('./src/services/newsService');

async function testNewsService() {
  try {
    console.log('Testing news service with SerpAPI...');
    
    // Test with a popular stock
    const symbol = 'AAPL';
    const query = `${symbol} stock news`;
    
    console.log(`Fetching news for ${symbol}...`);
    const articles = await newsService.getGoogleNewsArticles(query, 5);
    
    console.log(`\nFound ${articles.length} articles:`);
    articles.forEach((article, index) => {
      console.log(`\n[${index + 1}] ${article.title}`);
      console.log(`Source: ${article.source}`);
      console.log(`Date: ${article.publishedAt}`);
      console.log(`URL: ${article.url}`);
      console.log(`Relevance Score: ${article.relevanceScore}`);
      console.log('---');
    });

  } catch (error) {
    console.error('Error in test:', error);
  }
}

testNewsService(); 