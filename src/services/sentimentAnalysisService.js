const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');
const logger = require('../utils/logger');

class SentimentAnalysisService {
  constructor() {
    this.openai = openaiService.openai;
  }

  /**
   * Do initial filtering of articles based on titles
   * @param {string} symbol - Stock symbol
   * @param {Array} articles - Array of articles
   * @returns {Promise<Array>} Filtered articles
   */
  async prefilterArticles(symbol, articles) {
    try {
      // Increase initial article collection to 100
      if (articles.length <= 100) {
        logger.info(`Only ${articles.length} articles, skipping prefiltering step`);
        return articles;
      }
      
      // First deduplicate articles based on title and content
      const uniqueArticles = this.deduplicateArticles(articles);
      logger.info(`Deduplicated ${articles.length} articles to ${uniqueArticles.length} unique articles`);
      
      const batchSize = 20;
      const batches = [];
      
      // Split articles into batches
      for (let i = 0; i < uniqueArticles.length; i += batchSize) {
        batches.push(uniqueArticles.slice(i, i + batchSize));
      }
      
      logger.info(`Split ${uniqueArticles.length} articles into ${batches.length} batches for parallel processing`);
      
      // Process each batch in sequence to prevent rate limiting
      let allRelevantArticles = [];
      
      for (const batch of batches) {
        const response = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are analyzing article titles to determine their relevance to ${symbol} stock price movement.
              Return a JSON array of indices of relevant articles.
              
              Include ONLY the following types of articles:
              1. Articles that directly discuss ${symbol}'s stock performance, company financials, or major company news
              2. Articles about the industry or sector that could significantly affect ${symbol}'s stock price
              3. Articles about relevant market conditions, regulations, or macroeconomic factors that would directly impact ${symbol}
              4. Articles about direct competitors that could materially affect ${symbol}'s market position
              5. Articles about tariffs, supply chain issues, or geopolitical events that specifically impact ${symbol} or its sector
              6. Historical articles that provide important context for current market conditions
              7. Articles about major product launches, acquisitions, or strategic moves by ${symbol}
              8. Articles about significant analyst ratings or price target changes
              
              STRICTLY exclude:
              - General market news with no direct relevance to ${symbol}
              - Articles where ${symbol} or its industry is only mentioned tangentially
              - Highly speculative or clickbait articles
              - Articles so broad that they don't have a specific impact on ${symbol}
              - Opinion pieces without concrete data or analysis
              
              IMPORTANT: Return ONLY a JSON array of indices, no markdown formatting or explanation.
              Example: [0, 2, 5, 7, 9]`
            },
            {
              role: "user",
              content: JSON.stringify(batch.map((a, i) => ({ 
                index: i, 
                title: a.title,
                date: a.publishedAt,
                source: a.source?.name?.name || a.source
              })))
            }
          ],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: "json_object" }
        });

        try {
          const content = response.choices[0].message.content;
          let indices;
          try {
            const jsonResult = JSON.parse(content);
            indices = Array.isArray(jsonResult) ? jsonResult : jsonResult.indices || [];
          } catch (e) {
            const jsonMatch = content.match(/\[.*\]/);
            if (jsonMatch) {
              indices = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error("Could not parse indices from response");
            }
          }
          
          const relevantBatchArticles = indices.map(idx => batch[idx]).filter(Boolean);
          allRelevantArticles.push(...relevantBatchArticles);
          
          logger.info(`Batch processed: ${relevantBatchArticles.length} relevant articles identified`);
        } catch (err) {
          logger.error(`Error parsing prefilter response: ${err.message}`);
          allRelevantArticles.push(...batch);
        }
      }
      
      logger.info(`Prefiltering complete: ${allRelevantArticles.length} relevant articles from ${articles.length} total`);
      
      // If we filtered out too many articles, use the top ones sorted by recency and relevance
      if (allRelevantArticles.length < 10 && articles.length > 10) {
        logger.warn(`Too few articles (${allRelevantArticles.length}) after filtering, using top 20 recent articles instead`);
        return articles
          .sort((a, b) => {
            const dateA = new Date(a.publishedAt || 0);
            const dateB = new Date(b.publishedAt || 0);
            const recencyScore = dateB - dateA;
            const relevanceScore = (b.relevanceScore || 0) - (a.relevanceScore || 0);
            return recencyScore + relevanceScore;
          })
          .slice(0, 20);
      }
      
      return allRelevantArticles;
    } catch (error) {
      logger.error('Error in prefilterArticles:', error.message);
      return articles;
    }
  }

  /**
   * Deduplicate articles based on multiple criteria
   * @param {Array} articles - Array of articles to deduplicate
   * @returns {Array} Deduplicated articles
   */
  deduplicateArticles(articles) {
    const seen = new Set();
    
    return articles.filter(article => {
      // Create multiple unique keys to catch different types of duplicates
      const title = article.title || '';
      const content = (article.description || article.content || '');
      const url = article.url || '';
      const source = article.source?.name || article.source?.domain || '';
      
      // Create keys for different matching strategies
      const exactMatchKey = `${title}|${content.substring(0, 200)}`;
      const urlMatchKey = url;
      const sourceTitleMatchKey = `${source}|${title}`;
      
      // Check if any of the keys have been seen
      if (seen.has(exactMatchKey) || seen.has(urlMatchKey) || seen.has(sourceTitleMatchKey)) {
        return false;
      }
      
      // Add all keys to the seen set
      seen.add(exactMatchKey);
      seen.add(urlMatchKey);
      seen.add(sourceTitleMatchKey);
      
      return true;
    });
  }

  /**
   * Analyze sentiment and predict stock movement based on collected articles
   * @param {string} symbol - Stock symbol
   * @param {Array} articles - Array of news articles
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeSentimentAndPredict(symbol, articles) {
    try {
      const startTime = Date.now();
      logger.info(`Starting sentiment analysis for ${symbol} with ${articles.length} articles`);
      
      // First deduplicate articles
      const uniqueArticles = this.deduplicateArticles(articles);
      logger.info(`Deduplicated ${articles.length} articles to ${uniqueArticles.length} unique articles`);
      
      // Early filtering of low-quality articles in parallel
      const initialFiltering = uniqueArticles.filter(article => {
        const text = (article.title + ' ' + article.description).toLowerCase();
        return !text.includes('sponsored') && 
               !text.includes('advertisement') && 
               text.length > 50;
      });
      
      logger.info(`Initial filtering removed ${uniqueArticles.length - initialFiltering.length} low-quality articles`);

      // Prefilter articles based on titles (this method already handles batching internally)
      logger.info(`Prefiltering ${initialFiltering.length} articles based on titles...`);
      const relevantArticles = await this.prefilterArticles(symbol, initialFiltering);
      logger.info(`${relevantArticles.length} articles remained after prefiltering`);

      // Score articles by informational value in parallel
      logger.info(`Scoring articles by informational value in parallel...`);
      const scoredArticles = await Promise.all(
        relevantArticles.map(async article => {
          const score = this.scoreArticle(article);
          return { ...article, informationalScore: score };
        })
      );

      // Sort articles by score and take top ones for analysis
      const topArticles = scoredArticles
        .sort((a, b) => b.informationalScore - a.informationalScore)
        .slice(0, Math.min(30, scoredArticles.length));

      // Final deduplication of top articles
      const finalUniqueArticles = this.deduplicateArticles(topArticles);
      logger.info(`Final deduplication: ${topArticles.length} to ${finalUniqueArticles.length} articles`);

      // Organize articles by timeframe relevance
      const timeframeArticles = this.organizeArticlesByTimeframe(finalUniqueArticles);
      
      // Process each timeframe in parallel
      const timeframes = ['7days', '1month', '3months', '6months'];
      logger.info(`Processing ${timeframes.length} timeframes in parallel...`);
      
      const timeframeAnalyses = await Promise.all(
        timeframes.map(async timeframe => {
          try {
            const relevantTimeframeArticles = timeframeArticles[timeframe];
            let timeframeAnalysis;
            
            if (!relevantTimeframeArticles || relevantTimeframeArticles.length === 0) {
              logger.info(`No specific articles for timeframe ${timeframe}, using general articles`);
              timeframeAnalysis = await this.analyzeSingleTimeframe(symbol, timeframe, topArticles.slice(0, 10));
            } else {
              logger.info(`Analyzing ${relevantTimeframeArticles.length} articles for timeframe ${timeframe}`);
              timeframeAnalysis = await this.analyzeSingleTimeframe(symbol, timeframe, relevantTimeframeArticles);
            }
            
            return { timeframe, analysis: timeframeAnalysis, success: true };
          } catch (error) {
            logger.error(`Error processing timeframe ${timeframe}:`, error.message);
            return { 
              timeframe, 
              analysis: this.getFallbackAnalysis(timeframe), 
              success: false,
              error: error.message 
            };
          }
        })
      );
      
      // Combine results into the analysis object
      const analysis = {};
      let successCount = 0;
      let errorCount = 0;
      
      for (const result of timeframeAnalyses) {
        analysis[result.timeframe] = result.analysis;
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
        }
      }
      
      const endTime = Date.now();
      const processingTime = (endTime - startTime) / 1000;
      
      logger.info(`Sentiment analysis completed for ${symbol} in ${processingTime}s: ${successCount} timeframes processed successfully, ${errorCount} errors`);
      
      return analysis;
    } catch (error) {
      logger.error('Sentiment analysis error:', error.message);
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
    try {
      // Deduplicate articles within the timeframe
      const uniqueArticles = this.deduplicateArticles(articles);
      
      // Sort articles by relevance and credibility
      const sortedArticles = uniqueArticles.sort((a, b) => {
        const scoreA = (a.relevanceScore || 0) * (a.credibilityScore?.score || 50) / 100;
        const scoreB = (b.relevanceScore || 0) * (b.credibilityScore?.score || 50) / 100;
        return scoreB - scoreA;
      });

      // Get the top articles for analysis
      const topArticles = sortedArticles.slice(0, 10);

      // Prepare the system message based on timeframe
      const timeframeContext = this.getTimeframeContext(timeframe);
      const systemMessage = `You are a financial analyst specializing in stock market analysis. Analyze these articles about ${symbol} for the ${timeframe} timeframe.
      
      Consider the following unique aspects for this timeframe:
      ${timeframeContext}
      
      For each article, determine:
      1. Key insights and their impact on the stock
      2. Specific risks and opportunities mentioned
      3. Market sentiment indicators
      4. Technical and fundamental factors
      5. Industry-specific trends
      
      Provide a comprehensive analysis that includes:
      - Sentiment prediction (UP/DOWN/STABLE)
      - Confidence level (low/medium/high)
      - Magnitude of potential change (minimal/moderate/significant)
      - Key driving factors
      - Specific risks for this timeframe
      - Most impactful articles with reasoning`;

      // Prepare articles for analysis
      const articleData = topArticles.map(article => ({
        title: article.title,
        content: article.content || article.description,
        url: article.url,
        source: article.source?.name || 'Unknown',
        credibility: article.credibilityScore?.rating || 'unknown',
        sentiment: article.sentiment_score || 0,
        publishedAt: article.publishedAt
      }));

      // Call OpenAI for analysis
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: JSON.stringify(articleData) }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      // Parse and validate the response
      const analysis = this.cleanAndParseResponse(response.choices[0].message.content);
      
      // Add source credibility information
      const sourceCredibility = this.calculateSourceCredibility(topArticles);
      
      // Add specific risks based on timeframe and articles
      const risks = this.analyzeTimeframeRisks(timeframe, topArticles, analysis);

      return {
        articles: sortedArticles,
        magnitude: analysis.magnitude || 'moderate',
        confidence: analysis.confidence || 'medium',
        prediction: analysis.prediction || 'STABLE',
        key_factors: analysis.key_factors || [],
        key_articles: this.processKeyArticles(analysis.key_articles || [], topArticles),
        risks,
        sentiment_score: this.calculateWeightedSentiment(topArticles),
        source_credibility: sourceCredibility
      };
    } catch (error) {
      console.error(`Error analyzing timeframe ${timeframe}:`, error);
      return this.getFallbackAnalysis(timeframe);
    }
  }

  getTimeframeContext(timeframe) {
    const contexts = {
      '7days': `
        - Focus on immediate market reactions and news impact
        - Consider short-term technical indicators
        - Analyze recent price movements and volume
        - Look for upcoming events in the next week
        - Evaluate day-to-day sentiment changes`,
      '1month': `
        - Consider monthly technical patterns
        - Analyze upcoming earnings or product releases
        - Evaluate sector rotation and market trends
        - Look for institutional investor movements
        - Consider options market activity`,
      '3months': `
        - Analyze quarterly earnings and guidance
        - Consider seasonal patterns and trends
        - Evaluate competitive landscape changes
        - Look for medium-term technical patterns
        - Consider macroeconomic factors`,
      '6months': `
        - Focus on long-term growth prospects
        - Analyze industry-wide trends
        - Consider regulatory and policy changes
        - Evaluate technological innovations
        - Look for strategic business changes`
    };
    return contexts[timeframe] || '';
  }

  analyzeTimeframeRisks(timeframe, articles, analysis) {
    const baseRisks = new Set(analysis.risks || []);
    
    // Add risks based on article content
    articles.forEach(article => {
      const content = (article.content || '').toLowerCase();
      
      // Check for competition risks
      if (content.includes('competition') || content.includes('competitor') || content.includes('market share')) {
        baseRisks.add('Increasing market competition');
      }
      
      // Check for regulatory risks
      if (content.includes('regulation') || content.includes('lawsuit') || content.includes('investigation')) {
        baseRisks.add('Regulatory and legal challenges');
      }
      
      // Check for supply chain risks
      if (content.includes('supply chain') || content.includes('production') || content.includes('manufacturing')) {
        baseRisks.add('Supply chain disruptions');
      }
      
      // Check for innovation risks
      if (content.includes('innovation') || content.includes('technology') || content.includes('research')) {
        baseRisks.add('Technology and innovation challenges');
      }
      
      // Check for market risks
      if (content.includes('market conditions') || content.includes('economic') || content.includes('recession')) {
        baseRisks.add('Adverse market conditions');
      }
    });
    
    // Add timeframe-specific risks
    if (timeframe === '7days') {
      baseRisks.add('Short-term market volatility');
    } else if (timeframe === '1month') {
      baseRisks.add('Monthly earnings expectations');
    } else if (timeframe === '3months') {
      baseRisks.add('Quarterly performance targets');
    } else if (timeframe === '6months') {
      baseRisks.add('Long-term growth sustainability');
    }
    
    return Array.from(baseRisks);
  }

  calculateSourceCredibility(articles) {
    const sourceScores = {};
    const sourceCounts = {};
    
    articles.forEach(article => {
      const source = article.source?.name || 'Unknown';
      const score = article.credibilityScore?.score || 50;
      
      if (!sourceScores[source]) {
        sourceScores[source] = 0;
        sourceCounts[source] = 0;
      }
      
      sourceScores[source] += score;
      sourceCounts[source]++;
    });
    
    // Calculate average scores
    const averageScores = {};
    for (const source in sourceScores) {
      averageScores[source] = sourceScores[source] / sourceCounts[source];
    }
    
    return {
      scores: averageScores,
      totalSources: Object.keys(sourceScores).length,
      averageScore: Object.values(averageScores).reduce((a, b) => a + b, 0) / Object.keys(averageScores).length
    };
  }

  calculateWeightedSentiment(articles) {
    let totalWeight = 0;
    let weightedSum = 0;
    
    articles.forEach(article => {
      const credibility = article.credibilityScore?.score || 50;
      const relevance = article.relevanceScore || 5;
      const sentiment = article.sentiment_score || 0;
      
      const weight = (credibility / 100) * (relevance / 10);
      weightedSum += sentiment * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  processKeyArticles(keyArticles, allArticles) {
    return keyArticles.map(keyArticle => {
      const fullArticle = allArticles.find(a => a.url === keyArticle.url);
      if (!fullArticle) return keyArticle;
      
      return {
        ...keyArticle,
        credibilityScore: fullArticle.credibilityScore,
        biasAssessment: fullArticle.biasAssessment,
        relevanceScore: fullArticle.relevanceScore,
        publishedAt: fullArticle.publishedAt
      };
    });
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
      logger.error('OpenAI response parsing error:', error.message);
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
      magnitude: "slight"
    };
  }

  /**
   * Score an article based on its informational value
   * @param {Object} article - Article to score
   * @returns {number} Score from 0-100
   */
  scoreArticle(article) {
    let score = 0;
    const text = (article.title + ' ' + article.description).toLowerCase();

    // Source credibility (up to 20 points)
    if (article.credibilityScore) {
      score += article.credibilityScore.score;
    }

    // Content quality (up to 20 points)
    if (text.length > 500) score += 20;
    else if (text.length > 300) score += 15;
    else if (text.length > 100) score += 10;

    // Expert opinions (up to 15 points)
    const hasExpertQuotes = /(said|stated|reported|announced|confirmed|revealed)/i.test(text);
    const hasExpertSources = /(analyst|expert|researcher|economist|strategist|manager|ceo)/i.test(text);
    if (hasExpertQuotes && hasExpertSources) score += 15;
    else if (hasExpertQuotes || hasExpertSources) score += 8;

    // Market impact (up to 15 points)
    if (text.includes('market impact') || text.includes('stock price') || text.includes('trading')) {
      score += 15;
    }

    // Future outlook (up to 15 points)
    if (article.hasFutureTerms) score += 15;
    else if (text.includes('forecast') || text.includes('outlook')) score += 8;

    // Data points (up to 15 points)
    if (/\d+%/.test(text) || /\$[\d,]+/.test(text)) score += 15;

    return Math.min(100, score);
  }
}

module.exports = new SentimentAnalysisService(); 