require('dotenv').config();
const sentimentAnalysisService = require('./src/services/sentimentAnalysisService');
const openaiService = require('./src/services/openaiService');
const logger = require('./src/utils/logger');

// Sample articles with different characteristics
const testArticles = [
  {
    title: "Apple's Q2 Earnings Report Shows Strong Growth",
    description: "Apple reported better-than-expected earnings for Q2 2024, with revenue up 5% year-over-year. The company expects similar growth in the coming quarter.",
    publishedAt: new Date().toISOString(),
    url: "https://example.com/apple-earnings",
    source: { name: "Reuters" }
  },
  {
    title: "Apple to Launch New iPhone in September",
    description: "Apple has confirmed the launch of its next-generation iPhone in September. The new device is expected to feature significant hardware improvements.",
    publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
    url: "https://example.com/apple-iphone",
    source: { name: "Bloomberg" }
  },
  {
    title: "Apple's Long-term AI Strategy Revealed",
    description: "In a recent interview, Apple's CEO discussed the company's 5-year AI roadmap, including plans for integrating AI across all product lines.",
    publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
    url: "https://example.com/apple-ai",
    source: { name: "Wall Street Journal" }
  },
  {
    title: "Apple's Supply Chain Issues Expected to Resolve Next Week",
    description: "Production delays affecting Apple's supply chain are expected to be resolved within the next week, according to industry sources.",
    publishedAt: new Date().toISOString(),
    url: "https://example.com/apple-supply",
    source: { name: "CNBC" }
  },
  {
    title: "Apple's Market Share Growth Over Next 6 Months",
    description: "Analysts predict Apple will gain significant market share in the smartphone market over the next six months, driven by new product launches.",
    publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    url: "https://example.com/apple-market",
    source: { name: "Financial Times" }
  }
];

async function testTimeframeAnalysis() {
  try {
    console.log('Starting timeframe analysis test...');
    
    // Initialize OpenAI
    if (!openaiService.openai) {
      console.error('OpenAI client not initialized');
      return;
    }
    
    // Run the analysis
    console.log('\nAnalyzing articles...');
    const startTime = Date.now();
    const timeframes = await sentimentAnalysisService.organizeArticlesByTimeframe(testArticles);
    const endTime = Date.now();
    
    // Display results
    console.log('\nResults:');
    Object.entries(timeframes).forEach(([timeframe, articles]) => {
      console.log(`\n${timeframe}:`);
      articles.forEach(article => {
        console.log(`- ${article.title}`);
        console.log(`  Published: ${new Date(article.publishedAt).toLocaleDateString()}`);
        console.log(`  Source: ${article.source.name}`);
      });
    });
    
    // Log performance metrics
    console.log('\nPerformance Metrics:');
    const totalArticles = testArticles.length;
    Object.entries(timeframes).forEach(([timeframe, articles]) => {
      const percentage = (articles.length / totalArticles * 100).toFixed(1);
      console.log(`${timeframe}: ${articles.length} articles (${percentage}%)`);
    });
    
    console.log(`\nProcessing time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testTimeframeAnalysis(); 