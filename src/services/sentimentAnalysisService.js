const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');
const logger = require('../utils/logger');

class SentimentAnalysisService {
  constructor() {
    this.openai = openaiService.openai;
    this.batchSize = 3; // Reduced batch size to prevent overload
    this.maxArticlesPerTimeframe = 5; // Reduced articles per timeframe
    this.timeoutMs = 30000; // 30 second timeout
  }

  /**
   * Do initial filtering of articles based on titles
   * @param {string} symbol - Stock symbol
   * @param {Array} articles - Array of articles
   * @returns {Promise<Array>} Filtered articles
   */
  async prefilterArticles(symbol, articles) {
    try {
      // Early filtering of low-quality articles
      const filteredArticles = articles.filter(article => {
        const text = (article.title + ' ' + article.description).toLowerCase();
        return !text.includes('sponsored') && 
               !text.includes('advertisement') && 
               text.length > 50;
      });

      // Take only top 10 articles for prefiltering
      const topArticles = filteredArticles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 10);

      // Process articles in parallel batches
      const batches = this.createBatches(topArticles, this.batchSize);
      const relevantIndices = new Set();

      await Promise.all(batches.map(async (batch, batchIndex) => {
        try {
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
                content: JSON.stringify(batch.map((article, index) => ({
                  index: batchIndex * this.batchSize + index,
                  title: article.title,
                  description: article.description
                })))
              }
            ],
            temperature: 0.1,
            max_tokens: 100,
            timeout: this.timeoutMs
          });

          const indices = JSON.parse(response.choices[0].message.content);
          indices.forEach(index => relevantIndices.add(index));
        } catch (error) {
          console.error(`Error processing batch ${batchIndex}:`, error);
        }
      }));

      return filteredArticles.filter((_, index) => relevantIndices.has(index));
    } catch (error) {
      console.error('Error in prefilterArticles:', error);
      return articles; // Return all articles if filtering fails
    }
  }

  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
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
      
      // Deduplicate articles first
      const uniqueArticles = this.deduplicateArticles(articles);
      
      // Take only top 10 articles for analysis
      const topArticles = uniqueArticles
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 10);
      
      // Process timeframes in parallel
      const timeframes = ['7days', '1month', '3months', '6months'];
      const timeframeAnalyses = await Promise.all(
        timeframes.map(async timeframe => {
          try {
            const analysis = await this.analyzeSingleTimeframe(symbol, timeframe, topArticles);
            return { timeframe, analysis, success: true };
          } catch (error) {
            console.error(`Error processing timeframe ${timeframe}:`, error);
            return { 
              timeframe, 
              analysis: this.getFallbackAnalysis(timeframe), 
              success: false 
            };
          }
        })
      );

      // Combine results
      const analysis = {};
      timeframeAnalyses.forEach(result => {
        analysis[result.timeframe] = result.analysis;
      });

      const processingTime = (Date.now() - startTime) / 1000;
      console.log(`Analysis completed in ${processingTime}s`);
      
      return analysis;
    } catch (error) {
      console.error('Sentiment analysis error:', error);
      throw error;
    }
  }

  /**
   * Parse the AI response for timeframe analysis
   * @param {string} content - Raw response content
   * @returns {Object} Parsed response
   */
  parseTimeframeAnalysisResponse(content) {
    try {
      // Clean the content string
      const cleanContent = content
        .trim()
        .replace(/^```json\s*/, '')
        .replace(/```$/, '')
        .replace(/\s+/g, ' ')
        .replace(/`/g, '')
        .replace(/^[^{]*({.*})[^}]*$/, '$1');

      // Try to parse the cleaned content
      let parsed;
      try {
        parsed = JSON.parse(cleanContent);
      } catch (e) {
        // If parsing fails, try to extract JSON from the content
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            logger.error('Failed to parse extracted JSON:', e2.message);
            return null;
          }
        } else {
          logger.error('Could not find valid JSON in response');
          return null;
        }
      }

      // Validate the response structure
      if (!parsed || !parsed.articles || !Array.isArray(parsed.articles)) {
        logger.warn('Invalid response structure');
        return null;
      }

      return parsed;
    } catch (error) {
      logger.error('Error parsing timeframe analysis response:', error);
      return null;
    }
  }

  /**
   * Organize articles by their timeframe relevance
   * @param {Array} articles - Array of news articles
   * @returns {Object} Articles organized by timeframe
   */
  async organizeArticlesByTimeframe(articles) {
    const timeframes = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };

    // First pass: Quick rule-based categorization
    const initialCategorization = articles.map(article => {
      const text = (article.title + ' ' + (article.description || '')).toLowerCase();
      const pubDate = new Date(article.publishedDate || article.publishedAt);
      const daysSincePublished = Math.floor((new Date() - pubDate) / (1000 * 60 * 60 * 24));

      // Check for timeframe-specific keywords
      const hasShortTermTerms = /(next week|this week|days ahead|immediate|short term|resolve next week|coming days)/i.test(text);
      const hasMonthTerms = /(next month|this month|monthly|coming weeks|in september|next quarter)/i.test(text);
      const hasQuarterTerms = /(quarter|quarterly|q1|q2|q3|q4|months|three months)/i.test(text);
      const hasLongTermTerms = /(long term|year|yearly|annual|future|roadmap|outlook|strategic|over.*months)/i.test(text);

      // Rule-based timeframe relevance with content analysis
      const timeframeRelevance = {
        '7days': hasShortTermTerms || daysSincePublished <= 7,
        '1month': hasMonthTerms || daysSincePublished <= 30,
        '3months': hasQuarterTerms || daysSincePublished <= 90,
        '6months': hasLongTermTerms || daysSincePublished <= 180
      };

      return {
        article,
        timeframeRelevance,
        text,
        daysSincePublished,
        hasShortTermTerms,
        hasMonthTerms,
        hasQuarterTerms,
        hasLongTermTerms
      };
    });

    // Second pass: AI-based refinement for articles that could be in multiple timeframes
    const articlesNeedingRefinement = initialCategorization.filter(item => {
      const relevantTimeframes = Object.values(item.timeframeRelevance).filter(Boolean).length;
      return relevantTimeframes > 1 && !item.hasShortTermTerms; // Skip articles with clear short-term indicators
    });

    if (articlesNeedingRefinement.length > 0) {
      try {
        // Prepare batch for OpenAI
        const batch = articlesNeedingRefinement.map(item => ({
          title: item.article.title,
          description: item.article.description || '',
          publishedAt: item.article.publishedAt,
          source: item.article.source?.name || 'Unknown',
          text: item.text,
          daysSincePublished: item.daysSincePublished,
          currentTimeframes: Object.entries(item.timeframeRelevance)
            .filter(([_, isRelevant]) => isRelevant)
            .map(([timeframe]) => timeframe)
        }));

        // Get AI-based timeframe relevance
        const response = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a financial news analyzer specializing in determining the most relevant timeframes for stock market news articles.

              For each article, analyze its content and context to determine which timeframe(s) the article is most relevant for.
              Consider:
              1. Explicit timeframe mentions in the content
              2. Nature of the news (e.g., earnings reports, product launches, strategic plans)
              3. Typical impact duration of similar news
              4. Market reaction timeframes
              5. Publication date relative to events mentioned

              Return a JSON object with an "articles" array containing objects with:
              {
                "articleIndex": number (index in the input array),
                "timeframes": string[] (array of relevant timeframes: "7days", "1month", "3months", "6months"),
                "confidence": "high" | "medium" | "low",
                "reason": string (brief explanation)
              }`
            },
            {
              role: "user",
              content: JSON.stringify(batch)
            }
          ],
          temperature: 0.3,
          max_tokens: 1000,
          response_format: { type: "json_object" }
        });

        // Parse AI response
        const aiResponse = this.parseTimeframeAnalysisResponse(response.choices[0].message.content);
        
        if (aiResponse && aiResponse.articles) {
          // Update timeframe assignments based on AI analysis
          aiResponse.articles.forEach(analysis => {
            if (typeof analysis.articleIndex === 'number' && 
                analysis.articleIndex >= 0 && 
                analysis.articleIndex < articlesNeedingRefinement.length) {
              const articleItem = articlesNeedingRefinement[analysis.articleIndex];
              
              // Only update if we have valid timeframes
              if (Array.isArray(analysis.timeframes)) {
                // Reset timeframe relevance based on AI analysis
                articleItem.timeframeRelevance = {
                  '7days': analysis.timeframes.includes('7days'),
                  '1month': analysis.timeframes.includes('1month'),
                  '3months': analysis.timeframes.includes('3months'),
                  '6months': analysis.timeframes.includes('6months')
                };
                
                // Log the AI's reasoning
                logger.debug(`AI analysis for "${articleItem.article.title}":`, {
                  timeframes: analysis.timeframes,
                  confidence: analysis.confidence,
                  reason: analysis.reason
                });
              }
            }
          });
        } else {
          logger.warn('Invalid AI response format, falling back to rule-based categorization');
        }
      } catch (error) {
        logger.error('Error in AI-based timeframe analysis:', error);
        // Fall back to rule-based categorization if AI analysis fails
      }
    }

    // Final categorization
    initialCategorization.forEach(item => {
      Object.entries(item.timeframeRelevance).forEach(([timeframe, isRelevant]) => {
        if (isRelevant) {
          timeframes[timeframe].push(item.article);
        }
      });
    });

    // Log distribution
    Object.entries(timeframes).forEach(([timeframe, articles]) => {
      logger.info(`Timeframe ${timeframe}: ${articles.length} articles`);
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
    const credibleSources = new Set([
      'bloomberg.com',
      'reuters.com',
      'wsj.com',
      'ft.com',
      'cnbc.com',
      'marketwatch.com',
      'investing.com',
      'seekingalpha.com',
      'yahoo.com/finance',
      'fool.com'
    ]);

    const sourceDistribution = {};
    let credibleCount = 0;

    articles.forEach(article => {
      try {
        const url = new URL(article.url);
        const domain = url.hostname;
        
        // Count source distribution
        sourceDistribution[domain] = (sourceDistribution[domain] || 0) + 1;
        
        // Check if source is credible
        if (credibleSources.has(domain)) {
          credibleCount++;
        }
      } catch (error) {
        logger.error('Error parsing URL:', error);
      }
    });

    const totalSources = Object.keys(sourceDistribution).length;
    const credibilityScore = totalSources > 0 ? (credibleCount / totalSources) * 100 : 0;

    return {
      total_sources: totalSources,
      credible_sources: credibleCount,
      source_distribution: sourceDistribution,
      credibility_score: credibilityScore
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

      // Try to parse the cleaned content
      let parsed;
      try {
        parsed = JSON.parse(cleanContent);
      } catch (e) {
        // If parsing fails, try to extract JSON from the content
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            logger.error('Failed to parse extracted JSON:', e2.message);
            throw new Error('Could not parse JSON from response');
          }
        } else {
          throw new Error('Could not find valid JSON in response');
        }
      }

      // Log the parsed content for debugging
      logger.debug('Parsed OpenAI response:', parsed);

      // Ensure all required fields are present
      const requiredFields = {
        sentiment_score: 0,
        prediction: 'SIDEWAYS',
        confidence: 'low',
        magnitude: 'slight',
        key_factors: [],
        key_articles: [],
        risks: []
      };

      // Fill in missing fields with defaults
      for (const [field, defaultValue] of Object.entries(requiredFields)) {
        if (!(field in parsed)) {
          logger.warn(`Missing field ${field} in OpenAI response, using default value`);
          parsed[field] = defaultValue;
        }
      }

      // Validate numeric fields
      if (typeof parsed.sentiment_score !== 'number') {
        logger.warn('Invalid sentiment_score type, using default value');
        parsed.sentiment_score = 0;
      }

      // Validate prediction
      if (!['UP', 'DOWN', 'SIDEWAYS'].includes(parsed.prediction)) {
        logger.warn('Invalid prediction value, using default value');
        parsed.prediction = 'SIDEWAYS';
      }

      // Validate confidence
      if (!['high', 'medium', 'low'].includes(parsed.confidence)) {
        logger.warn('Invalid confidence value, using default value');
        parsed.confidence = 'low';
      }

      // Validate magnitude
      if (!['strong', 'moderate', 'slight'].includes(parsed.magnitude)) {
        logger.warn('Invalid magnitude value, using default value');
        parsed.magnitude = 'slight';
      }

      // Ensure arrays are arrays
      if (!Array.isArray(parsed.key_factors)) {
        logger.warn('Invalid key_factors type, using default value');
        parsed.key_factors = [];
      }
      if (!Array.isArray(parsed.key_articles)) {
        logger.warn('Invalid key_articles type, using default value');
        parsed.key_articles = [];
      }
      if (!Array.isArray(parsed.risks)) {
        logger.warn('Invalid risks type, using default value');
        parsed.risks = [];
      }

      return parsed;
    } catch (error) {
      logger.error('OpenAI response parsing error:', error.message);
      logger.error('Raw response content:', content);
      // Return a default analysis object instead of throwing
      return {
        sentiment_score: 0,
        prediction: 'SIDEWAYS',
        confidence: 'low',
        magnitude: 'slight',
        key_factors: [],
        key_articles: [],
        risks: []
      };
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