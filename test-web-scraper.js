require('dotenv').config();
const webScraperService = require('./src/services/webScraperService');
const logger = require('./src/utils/logger');

async function testWebScraper() {
  try {
    console.log('Testing web scraper service...');
    
    // Test with a popular stock
    const symbol = 'AAPL';
    console.log(`\nSearching news for ${symbol}...`);
    
    const startTime = Date.now();
    const articles = await webScraperService.searchNews(symbol, 5);
    const duration = (Date.now() - startTime) / 1000;
    
    console.log(`\nFound ${articles.length} articles in ${duration.toFixed(2)}s`);
    
    // Display article details
    articles.forEach((article, index) => {
      console.log(`\n[${index + 1}] ${article.title}`);
      console.log(`Source: ${article.source?.name || 'Unknown'}`);
      console.log(`Published: ${article.publishedAt}`);
      console.log(`URL: ${article.url}`);
      console.log(`Relevance Score: ${article.relevanceScore}`);
      
      // Show content preview
      if (article.content) {
        const preview = article.content.substring(0, 200) + '...';
        console.log(`Content Preview: ${preview}`);
      }
      
      console.log('---');
    });

  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
testWebScraper()
  .then(() => {
    console.log('\nTest completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  }); 