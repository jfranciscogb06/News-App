require('dotenv').config();
const newsService = require('./src/services/newsService');
const sentimentAnalysisService = require('./src/services/sentimentAnalysisService');
const sourceValidationService = require('./src/services/sourceValidationService');

async function testSentimentAnalysis() {
  try {
    console.log('Testing full sentiment analysis pipeline...');
    
    const symbol = 'AAPL';
    console.log(`\nCollecting news for ${symbol}...`);
    
    // First collect the news articles
    const articles = await newsService.collectAndAnalyzeNews(symbol, 30);
    console.log(`Collected ${articles.length} articles`);
    
    // Validate sources and add credibility metadata
    const validatedArticles = articles.map(article => 
      sourceValidationService.validateArticleSource(article)
    );
    
    // Perform sentiment analysis
    console.log('\nAnalyzing sentiment...');
    const sentimentAnalysis = await sentimentAnalysisService.analyzeSentimentAndPredict(symbol, validatedArticles);
    
    // Calculate source credibility statistics
    const sourceCredibilityStats = calculateSourceCredibilityStats(sentimentAnalysis);
    
    // Create the final response object
    const result = {
      symbol,
      timestamp: new Date().toISOString(),
      sentimentAnalysis,
      source: 'fresh',
      articleCount: articles.length,
      sourceCredibility: sourceCredibilityStats
    };
    
    // Pretty print the result
    console.log('\nAnalysis Result:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('Error in test:', error);
  }
}

function calculateSourceCredibilityStats(analysis) {
  const allKeyArticles = [];
  
  // Collect all key articles from all timeframes
  for (const timeframe in analysis) {
    if (analysis[timeframe] && analysis[timeframe].key_articles) {
      allKeyArticles.push(...analysis[timeframe].key_articles);
    }
  }
  
  // Initialize statistics
  const stats = {
    averageCredibilityScore: 0,
    credibilityDistribution: {
      high: 0,
      credible: 0,
      moderate: 0,
      questionable: 0,
      low: 0
    },
    sourcesUsed: [],
    politicalBalanceIndex: 0
  };
  
  if (allKeyArticles.length === 0) {
    return stats;
  }
  
  // Calculate statistics
  let totalScore = 0;
  let articleCount = 0;
  let leftBiasCount = 0;
  let rightBiasCount = 0;
  const sourceDomains = new Set();
  
  allKeyArticles.forEach(article => {
    if (article.credibilityScore && article.credibilityScore.score) {
      totalScore += article.credibilityScore.score;
      articleCount++;
      
      // Track credibility distribution
      const rating = article.credibilityScore.rating;
      if (rating === 'high credibility') stats.credibilityDistribution.high++;
      else if (rating === 'credible') stats.credibilityDistribution.credible++;
      else if (rating === 'moderate credibility') stats.credibilityDistribution.moderate++;
      else if (rating === 'questionable') stats.credibilityDistribution.questionable++;
      else if (rating === 'low credibility') stats.credibilityDistribution.low++;
      
      // Track bias balance
      if (article.biasAssessment) {
        if (['moderate-left', 'strong-left'].includes(article.biasAssessment.politicalBias)) {
          leftBiasCount++;
        } else if (['moderate-right', 'strong-right'].includes(article.biasAssessment.politicalBias)) {
          rightBiasCount++;
        }
      }
      
      // Track unique sources
      if (article.url) {
        try {
          const domain = new URL(article.url).hostname;
          sourceDomains.add(domain);
        } catch (e) {
          // Ignore URL parsing errors
        }
      }
    }
  });
  
  // Calculate final statistics
  stats.averageCredibilityScore = articleCount > 0 ? Math.round(totalScore / articleCount) : 0;
  stats.politicalBalanceIndex = rightBiasCount - leftBiasCount;
  stats.sourcesUsed = Array.from(sourceDomains);
  
  return stats;
}

testSentimentAnalysis(); 