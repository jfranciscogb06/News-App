const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');

class SentimentAnalysisService {
  constructor() {
    this.openai = openaiService.openai;
  }

  /**
   * Analyze sentiment and predict stock movement based on collected articles
   * @param {string} symbol - Stock symbol
   * @param {Array} articles - Array of news articles
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeSentimentAndPredict(symbol, articles) {
    try {
      console.log(`Starting sentiment analysis and prediction for ${symbol} with ${articles.length} articles`);
      
      // Organize articles by timeframe relevance
      const timeframeArticles = this.organizeArticlesByTimeframe(articles);
      
      // Process each timeframe separately
      const analysis = {};
      const timeframes = ['7days', '1month', '3months', '6months'];
      
      // Create promises for all timeframes to process in parallel
      const timeframePromises = timeframes.map(async timeframe => {
        const relevantArticles = timeframeArticles[timeframe];
        let timeframeAnalysis;
        
        if (relevantArticles.length === 0) {
          console.log(`No articles found for timeframe: ${timeframe}, using general articles`);
          timeframeAnalysis = await this.analyzeSingleTimeframe(symbol, timeframe, articles.slice(0, 20));
        } else {
          console.log(`Analyzing ${timeframe} with ${relevantArticles.length} relevant articles`);
          timeframeAnalysis = await this.analyzeSingleTimeframe(symbol, timeframe, relevantArticles);
        }
        
        return { timeframe, analysis: timeframeAnalysis };
      });
      
      // Wait for all timeframe analyses to complete
      const results = await Promise.all(timeframePromises);
      
      // Combine results into the analysis object
      for (const result of results) {
        analysis[result.timeframe] = result.analysis;
      }
      
      return analysis;
    } catch (error) {
      console.error('Error in sentiment analysis:', error);
      throw error;
    }
  }

  /**
   * Organize articles by their timeframe relevance
   * @param {Array} articles - Array of news articles
   * @returns {Object} Articles organized by timeframe
   */
  organizeArticlesByTimeframe(articles) {
    const timeframes = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };

    articles.forEach(article => {
      const text = (article.title + ' ' + article.description).toLowerCase();
      const pubDate = article.publishedDate || new Date(article.publishedAt);
      const daysSincePublished = Math.floor((new Date() - pubDate) / (1000 * 60 * 60 * 24));

      // Check for timeframe-specific keywords
      const hasShortTermTerms = /(next week|this week|days ahead|immediate|short term)/i.test(text);
      const hasMonthTerms = /(next month|this month|monthly|coming weeks)/i.test(text);
      const hasQuarterTerms = /(quarter|quarterly|q1|q2|q3|q4|months)/i.test(text);
      const hasLongTermTerms = /(long term|year|yearly|annual|future|roadmap|outlook|strategic)/i.test(text);

      // Categorize based on content and publication date
      if (hasShortTermTerms || (daysSincePublished <= 7)) {
        timeframes['7days'].push(article);
      }
      if (hasMonthTerms || (daysSincePublished <= 30 && !hasShortTermTerms)) {
        timeframes['1month'].push(article);
      }
      if (hasQuarterTerms || (daysSincePublished <= 90 && !hasMonthTerms)) {
        timeframes['3months'].push(article);
      }
      if (hasLongTermTerms || (daysSincePublished <= 180 && !hasQuarterTerms)) {
        timeframes['6months'].push(article);
      }
    });

    return timeframes;
  }

  /**
   * Analyze sentiment and predict movement for a single timeframe
   * @param {string} symbol - Stock symbol
   * @param {string} timeframe - Timeframe to analyze
   * @param {Array} articles - Articles for this timeframe
   * @returns {Promise<Object>} Analysis for this timeframe
   */
  async analyzeSingleTimeframe(symbol, timeframe, articles) {
    const timeframeDescription = {
      '7days': 'the next 7 days',
      '1month': 'the next month',
      '3months': 'the next 3 months',
      '6months': 'the next 6 months'
    }[timeframe];

    const dateRange = {
      '7days': 'short-term',
      '1month': 'near-term',
      '3months': 'medium-term',
      '6months': 'long-term'
    }[timeframe];

    try {
      const systemMessage = {
        role: 'system',
        content: `You are a skilled financial analyst specializing in sentiment analysis and stock price movement prediction. 
        Your task is to analyze news articles about ${symbol} stock to predict its likely price movement over ${timeframeDescription} (${dateRange}).
        
        IMPORTANT SOURCE CREDIBILITY GUIDELINES:
        - Prioritize information from high-credibility sources
        - Be cautious with articles marked as "questionable" or "low credibility"
        - Consider political bias and sensationalism
        - Distinguish between opinion pieces and factual reporting
        
        Your analysis should include:
        1. Overall sentiment score (-1 to 1)
        2. Directional prediction (UP, DOWN, or SIDEWAYS)
        3. Confidence level (high, medium, low)
        4. Expected magnitude (significant, moderate, slight)
        5. Key factors driving the prediction
        6. Key articles supporting this prediction
        7. Potential risks that could change the prediction
        
        For each key article, provide:
        - Title and source
        - Sentiment score (-1 to 1)
        - Impact summary
        - Confidence in the article
        
        Return your analysis as a JSON object with this structure:
        {
          "sentiment_score": -1 to 1,
          "prediction": "UP|DOWN|SIDEWAYS",
          "confidence": "high|medium|low",
          "magnitude": "significant|moderate|slight",
          "key_factors": ["factor1", "factor2", ...],
          "key_articles": [
            {
              "title": "Article title",
              "source": "Source name",
              "sentiment_score": -1 to 1,
              "impact_summary": "2-3 detailed sentences",
              "confidence": "high|medium|low"
            },
            ...
          ],
          "risks": ["risk1", "risk2", ...]
        }`
      };

      // Format articles for OpenAI
      const formattedArticles = articles.map((article, idx) => {
        const credibilityInfo = article.credibilityScore 
          ? `\nSource credibility: ${article.credibilityScore.rating} (score: ${article.credibilityScore.score}/100)`
          : '';
        
        const biasInfo = article.biasAssessment
          ? `\nPolitical bias: ${article.biasAssessment.politicalBias}, Sensationalism: ${article.biasAssessment.sensationalism}`
          : '';
        
        const opinionInfo = article.isOpinionContent
          ? '\nThis appears to be an opinion piece rather than factual reporting.'
          : '';
        
        return `
ARTICLE ${idx + 1}:
Title: ${article.title || 'No title'}
Source: ${article.source || 'Unknown source'}${credibilityInfo}${biasInfo}${opinionInfo}
Date: ${article.publishedAt || 'Unknown date'}
Content: ${article.description || article.content || 'No content available'}
        `.trim();
      }).join('\n\n');

      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          systemMessage,
          {
            role: "user",
            content: `Here are the news articles about ${symbol} stock to analyze for sentiment and price movement prediction over ${timeframeDescription}:\n\n${formattedArticles}\n\nBased on these articles, provide your analysis and prediction in the requested JSON format.`
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      if (!response.choices?.[0]?.message?.content) {
        throw new Error(`Invalid response from OpenAI for timeframe ${timeframe}`);
      }

      // Parse and clean the response
      const result = this.cleanAndParseResponse(response.choices[0].message.content);
      
      // Validate the structure
      this.validateAnalysisStructure(result);
      
      return result;
    } catch (error) {
      console.error(`Error analyzing timeframe ${timeframe}:`, error);
      return this.getFallbackAnalysis(timeframe);
    }
  }

  /**
   * Clean and parse the OpenAI response
   * @param {string} content - Raw response content
   * @returns {Object} Parsed and cleaned response
   */
  cleanAndParseResponse(content) {
    try {
      // Clean the content string
      const cleanContent = content
        .trim()
        .replace(/^```json\s*/, '')
        .replace(/```$/, '')
        .replace(/\s+/g, ' ')
        .replace(/`/g, '')
        .replace(/^[^{]*({.*})[^}]*$/, '$1');

      return JSON.parse(cleanContent);
    } catch (error) {
      console.error('Error parsing OpenAI response:', error);
      throw new Error('Invalid response format from OpenAI');
    }
  }

  /**
   * Validate the structure of the analysis
   * @param {Object} analysis - Analysis object to validate
   */
  validateAnalysisStructure(analysis) {
    const requiredFields = [
      'sentiment_score',
      'prediction',
      'confidence',
      'magnitude',
      'key_factors',
      'key_articles',
      'risks'
    ];

    for (const field of requiredFields) {
      if (!(field in analysis)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (analysis.sentiment_score < -1 || analysis.sentiment_score > 1) {
      throw new Error('Sentiment score must be between -1 and 1');
    }

    if (!['UP', 'DOWN', 'SIDEWAYS'].includes(analysis.prediction)) {
      throw new Error('Prediction must be UP, DOWN, or SIDEWAYS');
    }

    if (!['high', 'medium', 'low'].includes(analysis.confidence)) {
      throw new Error('Confidence must be high, medium, or low');
    }

    if (!['significant', 'moderate', 'slight'].includes(analysis.magnitude)) {
      throw new Error('Magnitude must be significant, moderate, or slight');
    }
  }

  /**
   * Get a fallback analysis when there's insufficient data
   * @param {string} timeframe - Timeframe for the analysis
   * @returns {Object} Fallback analysis object
   */
  getFallbackAnalysis(timeframe) {
    return {
      sentiment_score: 0,
      prediction: "SIDEWAYS",
      confidence: "low",
      magnitude: "slight",
      key_factors: ["Insufficient data for analysis"],
      key_articles: [],
      risks: ["Insufficient data for risk assessment"]
    };
  }
}

module.exports = new SentimentAnalysisService(); 