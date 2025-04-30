const axios = require('axios');
const openaiService = require('./openaiService');
const SerpApiService = require('./serpApiService');
const logger = require('../utils/logger');

class StockAnalysisService {
  constructor() {
    this.timeframes = ['7days', '1month', '3months', '6months'];
    this.serpApiService = new SerpApiService();
    this.newsService = require('./newsService');
    this.sentimentAnalysisService = require('./sentimentAnalysisService');
    this.sourceValidationService = require('./sourceValidationService');
    this.maxArticles = 10;
    this.timeoutMs = 30000;
  }

  /**
   * Main method to analyze a stock across different timeframes
   */
  async analyzeStock(symbol) {
    try {
      const startTime = Date.now();
      
      // Collect and analyze news articles in parallel
      const [articles, sourceValidation] = await Promise.all([
        this.newsService.collectAndAnalyzeNews(symbol, this.maxArticles),
        this.sourceValidationService.validateArticleSource({ symbol })
      ]);
      
      // Take only top 10 articles for analysis
      const topArticles = articles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 10);
      
      // Validate sources and add credibility metadata in parallel
      const validatedArticles = await Promise.all(
        topArticles.map(article => 
          this.sourceValidationService.validateArticleSource(article)
        )
      );
      
      // Perform sentiment analysis
      const sentimentAnalysis = await this.sentimentAnalysisService.analyzeSentimentAndPredict(symbol, validatedArticles);
      
      const processingTime = (Date.now() - startTime) / 1000;
      console.log(`Stock analysis completed in ${processingTime}s`);
      
      return {
        symbol,
        timestamp: new Date().toISOString(),
        sentimentAnalysis,
        articleCount: validatedArticles.length,
        processingTime
      };
    } catch (error) {
      console.error('Error analyzing stock:', error);
      throw error;
    }
  }

  /**
   * Collect news articles using SerpAPI
   */
  async collectNewsArticles(symbol) {
    const queries = [
      `${symbol} stock price`,
      `${symbol} stock news`,
      `${symbol} financial results`,
      `${symbol} earnings`
    ];

    const allArticles = [];
    
    // Execute queries in parallel
    await Promise.all(queries.map(async query => {
      try {
        const results = await this.serpApiService.search(query);
        if (results?.news_results) {
          allArticles.push(...results.news_results);
        }
      } catch (error) {
        logger.error(`Error fetching news for query "${query}":`, error);
      }
    }));

    // Deduplicate articles
    return this.deduplicateArticles(allArticles);
  }

  /**
   * Analyze articles for a specific timeframe
   */
  async analyzeTimeframe(symbol, timeframe, articles) {
    try {
      // Filter articles relevant to this timeframe
      const relevantArticles = this.filterArticlesByTimeframe(articles, timeframe);
      
      if (!relevantArticles.length) {
        return this.getDefaultTimeframeAnalysis(timeframe);
      }

      // Prepare system message based on timeframe
      const systemMessage = this.getTimeframePrompt(symbol, timeframe);

      // Call OpenAI for analysis
      const response = await openaiService.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemMessage },
          { 
            role: 'user', 
            content: JSON.stringify({
              symbol,
              timeframe,
              articles: relevantArticles.map(article => ({
                title: article.title,
                snippet: article.snippet,
                date: article.date,
                source: article.source
              }))
            })
          }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      // Parse and validate the response
      const analysis = openaiService.cleanAndParseResponse(response.choices[0].message.content);
      
      // Validate the analysis structure
      this.validateAnalysis(analysis);

      return {
        ...analysis,
        articles: relevantArticles.length,
        timeframe
      };
    } catch (error) {
      logger.error(`Error analyzing timeframe ${timeframe}:`, error);
      return this.getDefaultTimeframeAnalysis(timeframe);
    }
  }

  /**
   * Validate the analysis structure
   */
  validateAnalysis(analysis) {
    // Required fields
    const requiredFields = [
      'sentiment',
      'confidence',
      'price_direction',
      'key_factors',
      'risks',
      'opportunities'
    ];

    // Check for required fields
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate sentiment
    if (!['BULLISH', 'BEARISH', 'NEUTRAL'].includes(analysis.sentiment.toUpperCase())) {
      throw new Error('Invalid sentiment value');
    }

    // Validate confidence
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(analysis.confidence.toUpperCase())) {
      throw new Error('Invalid confidence value');
    }

    // Validate price direction
    if (!['UP', 'DOWN', 'SIDEWAYS'].includes(analysis.price_direction.toUpperCase())) {
      throw new Error('Invalid price direction value');
    }

    // Validate arrays
    if (!Array.isArray(analysis.key_factors) || !Array.isArray(analysis.risks) || !Array.isArray(analysis.opportunities)) {
      throw new Error('Key factors, risks, and opportunities must be arrays');
    }
  }

  /**
   * Filter articles based on timeframe relevance
   */
  filterArticlesByTimeframe(articles, timeframe) {
    const now = new Date();
    const articlesByTimeframe = articles.filter(article => {
      const publishDate = new Date(article.date);
      const daysSincePublished = Math.floor((now - publishDate) / (1000 * 60 * 60 * 24));

      switch (timeframe) {
        case '7days':
          return daysSincePublished <= 7;
        case '1month':
          return daysSincePublished <= 30;
        case '3months':
          return daysSincePublished <= 90;
        case '6months':
          return daysSincePublished <= 180;
        default:
          return false;
      }
    });

    // Sort by date, newest first
    return articlesByTimeframe.sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );
  }

  /**
   * Get prompt for timeframe analysis
   */
  getTimeframePrompt(symbol, timeframe) {
    const timeframeContext = {
      '7days': 'Focus on immediate market reactions, recent events, and short-term technical indicators.',
      '1month': 'Consider monthly patterns, upcoming events, and medium-term market sentiment.',
      '3months': 'Analyze quarterly results, sector trends, and broader market conditions.',
      '6months': 'Evaluate long-term growth prospects, strategic changes, and industry position.'
    };

    return `You are a financial analyst specializing in stock market analysis. 
    Analyze these articles about ${symbol} for the ${timeframe} timeframe.

    ${timeframeContext[timeframe]}

    Consider:
    1. Market sentiment and investor reactions
    2. Technical indicators and price movements
    3. Fundamental factors (earnings, revenue, growth)
    4. Industry and competitive position
    5. Macroeconomic impacts
    6. Regulatory environment
    7. Product/service developments
    8. Management changes and strategy

    Provide a JSON response with:
    {
      "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "price_direction": "UP" | "DOWN" | "SIDEWAYS",
      "key_factors": [array of main factors influencing the analysis],
      "risks": [array of potential risks],
      "opportunities": [array of potential opportunities]
    }

    Focus on concrete data points and factual information rather than speculation.
    Be specific about key factors, risks, and opportunities.`;
  }

  /**
   * Deduplicate articles based on title and content similarity
   */
  deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
      const key = `${article.title}|${article.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Convert sentiment string to number
   */
  convertSentimentToNumber(sentiment) {
    switch (sentiment.toUpperCase()) {
      case 'BULLISH':
        return 5;
      case 'NEUTRAL':
        return 0;
      case 'BEARISH':
        return -5;
      default:
        return 0;
    }
  }

  /**
   * Get expected change percent based on price direction and confidence
   */
  getExpectedChangePercent(analysis) {
    const direction = analysis.price_direction.toLowerCase();
    const confidence = analysis.confidence.toLowerCase();

    if (direction === 'up') {
      return confidence === 'high' ? '>5%' : confidence === 'medium' ? '2-5%' : '0-2%';
    } else if (direction === 'down') {
      return confidence === 'high' ? '<-5%' : confidence === 'medium' ? '-2% to -5%' : '-2% to 0%';
    }
    return '0%';
  }

  /**
   * Generate summary from analysis
   */
  generateSummary(analysis) {
    const keyFactors = analysis.key_factors.join('. ');
    return `Analysis predicts ${analysis.price_direction} movement with ${analysis.confidence} confidence. ${keyFactors}`;
  }

  /**
   * Convert key factors to price drivers format
   */
  convertKeyFactorsToPriceDrivers(analysis) {
    return analysis.key_factors.map(factor => ({
      factor,
      impact: analysis.price_direction.toLowerCase() === 'up' ? 'positive' : 
             analysis.price_direction.toLowerCase() === 'down' ? 'negative' : 'neutral',
      confidence: analysis.confidence.toLowerCase()
    }));
  }

  /**
   * Convert opportunities to key articles format
   */
  convertToKeyArticles(analysis) {
    // Since we don't have actual articles in the analysis, create placeholder entries
    return [{
      title: 'Market Analysis',
      url: 'https://example.com',
      source: 'Analysis',
      confidence: analysis.confidence.toLowerCase(),
      impact_summary: analysis.opportunities.join('. ')
    }];
  }

  /**
   * Get default analysis when no data is available
   */
  getDefaultAnalysis(symbol) {
    const defaultTimeframeAnalysis = {
      sentiment: 'NEUTRAL',
      confidence: 'LOW',
      price_direction: 'SIDEWAYS',
      key_factors: [],
      risks: [],
      opportunities: [],
      articles: 0
    };

    return {
      symbol,
      timestamp: new Date().toISOString(),
      analysis: Object.fromEntries(
        this.timeframes.map(timeframe => [timeframe, defaultTimeframeAnalysis])
      ),
      articleCount: 0,
      status: 'no_data'
    };
  }

  /**
   * Get default timeframe analysis
   */
  getDefaultTimeframeAnalysis(timeframe) {
    return {
      sentiment: 'NEUTRAL',
      confidence: 'LOW',
      price_direction: 'SIDEWAYS',
      key_factors: [],
      risks: [],
      opportunities: [],
      articles: 0,
      timeframe: timeframe
    };
  }
}

module.exports = new StockAnalysisService(); 