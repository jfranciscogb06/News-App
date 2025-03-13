const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  cleanAndParseResponse(response, context = '') {
    try {
      // Log the raw response for debugging
      console.log(`Raw ${context} response:`, response.substring(0, 500) + (response.length > 500 ? '...' : ''));

      // Find JSON content with flexible pattern matching
      let jsonContent = response;
      
      // If the response is wrapped in markdown code blocks, extract the content
      const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = response.match(jsonRegex);
      if (match && match[1]) {
        jsonContent = match[1];
      }

      // Remove any markdown formatting and extra whitespace
      let cleaned = jsonContent
        .replace(/```json\n?|\n?```/g, '')  // Remove code blocks
        .replace(/\n\s+/g, '\n')            // Remove extra whitespace at start of lines
        .replace(/,\s*([}\]])/g, '$1')      // Remove trailing commas
        .trim();
      
      // Fix the + sign issue in sentiment scores
      cleaned = cleaned.replace(/"sentiment":\s*\+(\d+)/g, '"sentiment": $1');
      
      // Try to fix broken JSON with truncated URLs or content
      cleaned = this.fixTruncatedJSON(cleaned);
      
      // Log the cleaned response
      console.log(`Cleaned ${context} response:`, cleaned.substring(0, 500) + (cleaned.length > 500 ? '...' : ''));

      // Try to parse the JSON
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.error(`Initial JSON parsing failed: ${parseError.message}`);
        
        // Try a more aggressive cleanup approach
        const sanitized = this.sanitizeJSON(cleaned);
        console.log(`Sanitized JSON:`, sanitized.substring(0, 200) + (sanitized.length > 200 ? '...' : ''));
        parsed = JSON.parse(sanitized);
      }
      
      // Log successful parsing
      console.log(`Successfully parsed ${context} response`);
      
      return parsed;
    } catch (error) {
      console.error(`Error parsing ${context} response:`, error);
      console.error('Raw response (excerpt):', response.substring(0, 200) + '...');
      throw new Error(`Failed to parse ${context} response: ${error.message}`);
    }
  }
  
  // Helper method to fix truncated JSON that may have cut-off URLs or content
  fixTruncatedJSON(jsonStr) {
    // Fix unbalanced quotes in URLs or long strings
    let balanced = jsonStr;
    let inString = false;
    let escape = false;
    let unbalancedPos = -1;
    
    for (let i = 0; i < balanced.length; i++) {
      const char = balanced[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\') {
        escape = true;
        continue;
      }
      
      if (char === '"') {
        if (!inString) {
          inString = true;
          unbalancedPos = i;
        } else {
          inString = false;
          unbalancedPos = -1;
        }
      }
    }
    
    // If we ended with an unbalanced string, add a closing quote
    if (inString && unbalancedPos >= 0) {
      balanced = balanced.substring(0, balanced.length) + '"';
    }
    
    // Ensure all objects and arrays are properly closed
    let openBraces = 0;
    let openBrackets = 0;
    
    for (const char of balanced) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }
    
    // Add missing closing braces and brackets
    while (openBraces > 0) {
      balanced += '}';
      openBraces--;
    }
    
    while (openBrackets > 0) {
      balanced += ']';
      openBrackets--;
    }
    
    return balanced;
  }
  
  // Helper method to sanitize JSON more aggressively
  sanitizeJSON(jsonStr) {
    // Remove any non-JSON characters that might be causing problems
    return jsonStr
      .replace(/[\u0000-\u001F]+/g, ' ')  // Remove control characters
      .replace(/\\[^"\\\/bfnrt]/g, '')    // Remove invalid escapes
      .replace(/([^\\])\\([^"\\\/bfnrt])/g, '$1') // Remove invalid escapes that follow a character
      .replace(/,\s*[}\]]/g, ' $&')       // Fix trailing commas (replace with space)
      .replace(/\s+/g, ' ')               // Normalize whitespace
      .trim();
  }

  validateAnalysisStructure(data) {
    const timeframes = ['7days', '1month', '3months', '6months'];
    
    for (const timeframe of timeframes) {
      if (!data[timeframe] ||
          typeof data[timeframe].sentiment !== 'number' ||
          typeof data[timeframe].summary !== 'string' ||
          !Array.isArray(data[timeframe].price_drivers) ||
          !Array.isArray(data[timeframe].key_articles) ||
          !['up', 'down', 'neutral'].includes(data[timeframe].direction) ||
          typeof data[timeframe].expected_change_percent !== 'string' ||
          typeof data[timeframe].confidence_level !== 'string') {
        throw new Error(`Invalid structure for timeframe: ${timeframe}`);
      }
      
      // Validate price_drivers structure
      for (const driver of data[timeframe].price_drivers) {
        if (!driver.factor || 
            !driver.impact || 
            !['positive', 'negative', 'neutral'].includes(driver.impact) ||
            !driver.confidence || 
            !['high', 'medium', 'low'].includes(driver.confidence)) {
          throw new Error(`Invalid price driver structure for timeframe: ${timeframe}`);
        }
      }
      
      // Validate key_articles structure
      for (const article of data[timeframe].key_articles) {
        if (!article.title || 
            !article.url || 
            !article.source || 
            !article.confidence || 
            !['high', 'medium', 'low'].includes(article.confidence)) {
          throw new Error(`Invalid article structure for timeframe: ${timeframe}`);
        }
        
        // Check for the new impact_summary field - it's optional but should be a string if present
        if (article.impact_summary && typeof article.impact_summary !== 'string') {
          throw new Error(`Invalid impact_summary in article for timeframe: ${timeframe}`);
        }
        
        // Check for the new publishedAt field - it's optional but should be a string if present
        if (article.publishedAt && typeof article.publishedAt !== 'string') {
          throw new Error(`Invalid publishedAt in article for timeframe: ${timeframe}`);
        }
      }
    }
    console.log('Analysis structure validated successfully');
    return true;
  }

  async selectRelevantArticles(symbol, articles, maxArticles = 20) {
    try {
      // Include more article data for better selection
      const articleData = articles.map(article => ({
        title: article.title,
        url: article.url,
        description: article.description ? article.description.substring(0, 200) : '',
        publishedAt: article.publishedAt,
        source: article.source
      }));

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial article filter and analyst. Your task is to review these article headlines about ${symbol} stock and select the most relevant ones that could impact future stock performance. You are ONLY filtering the provided articles, not searching for new ones.

            Select titles that:
            - Are specifically about or closely related to ${symbol} or directly impact it
            - Suggest developments or events
            - Indicate potential stock price impact
            - Discuss future predictions or plans

            For each selected article, provide:
            1. A detailed explanation (2-3 sentences) of why this article is significant for the stock
            2. An assessment of the article's potential impact (positive, negative, or neutral)
            3. The specific factors mentioned in the article that could influence stock price

            Return a JSON array of selected articles:
            {
              "selected_articles": [
                {
                  "url": "<article url>",
                  "title": "<article title>",
                  "publishedAt": "<article publication date>",
                  "source": "<article source>",
                  "impact_summary": "<detailed explanation of impact>",
                  "sentiment": "<positive/negative/neutral>",
                  "key_factors": ["<factor 1>", "<factor 2>"]
                }
              ]
            }

            Select up to ${maxArticles} articles if that many relevant ones are available. Prioritize articles with clear impact on stock performance. Do not fabricate any information not present in the articles.`
          },
          {
            role: "user",
            content: JSON.stringify(articleData)
          }
        ],
        temperature: 0.5,
        max_tokens: 3000
      });

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content);
      
      // Enrich the original articles with the detailed impact analysis
      const enrichedArticles = [];
      for (const selectedArticle of result.selected_articles) {
        const originalArticle = articles.find(a => a.url === selectedArticle.url);
        if (originalArticle) {
          enrichedArticles.push({
            ...originalArticle,
            impact_summary: selectedArticle.impact_summary || '',
            sentiment: selectedArticle.sentiment || 'neutral',
            key_factors: selectedArticle.key_factors || []
          });
        }
      }
      
      return enrichedArticles;
    } catch (error) {
      console.error('Error selecting relevant articles:', error);
      // In case of error, return the original articles (limited to max) instead of failing
      console.log('Returning original articles due to filtering error');
      return articles.slice(0, maxArticles);
    }
  }

  async filterRelevantArticles(symbol, articles) {
    try {
      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Review these article titles about ${symbol} stock and select the most relevant ones that could impact future stock performance.

            Select articles that:
            - Indicate upcoming company developments or plans
            - Suggest potential market-moving events
            - Reveal industry trends or market shifts that could affect the stock
            - Discuss future predictions, forecasts, or analyst expectations

            You must return a valid JSON object exactly in this format, with no additional text or formatting:
            {
              "selected_articles": {
                "7days": [<urls of articles relevant to 7-day predictions>],
                "1month": [<urls of articles relevant to 1-month predictions>],
                "3months": [<urls of articles relevant to 3-month predictions>],
                "6months": [<urls of articles relevant to 6-month predictions>]
              }
            }`
          },
          {
            role: "user",
            content: JSON.stringify(articles)
          }
        ],
        temperature: 0.5,
        max_tokens: 2000
      });

      if (!analysis.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from OpenAI');
      }

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content);

      // Validate the response structure
      if (!result.selected_articles || 
          !Array.isArray(result.selected_articles["7days"]) ||
          !Array.isArray(result.selected_articles["1month"]) ||
          !Array.isArray(result.selected_articles["3months"]) ||
          !Array.isArray(result.selected_articles["6months"])) {
        throw new Error('Invalid response structure from OpenAI');
      }

      return result;
    } catch (error) {
      console.error('Error in filterRelevantArticles:', error);
      throw new Error(`Failed to filter articles: ${error.message}`);
    }
  }

  async analyzeArticles(symbol, articles) {
    try {
      console.log(`Starting future prediction analysis for ${symbol} with ${articles.length} articles`);

      // Organize articles by timeframe relevance
      const timeframeArticles = this.organizeArticlesByTimeframe(articles);
      
      const timeframeDetails = Object.entries(timeframeArticles)
        .map(([timeframe, articles]) => `${timeframe}: ${articles.length} articles`)
        .join(', ');
      
      console.log(`Timeframe distribution: ${timeframeDetails}`);

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Analyze the provided news articles about ${symbol} stock to predict future price movements. 

            IMPORTANT: ONLY analyze the provided articles. DO NOT search for or reference any external information not contained in these articles.
            
            The articles have been pre-filtered and categorized by their relevance to different timeframes: 7 days, 1 month, 3 months, and 6 months.
            Pay close attention to which timeframe each article is most relevant for, and use that information in your analysis.
            
            For each timeframe, provide:
            1. A concise sentiment score from -10 to +10 (negative to positive)
            2. Expected price direction (up, down, or neutral)
            3. Expected percentage change (e.g., "2-5%", "minimal", etc.)
            4. Confidence level (high, medium, low)
            5. A brief summary capturing key insights
            6. 3-5 primary price drivers
            7. 3-5 key articles supporting your analysis (include publication dates)
            
            Return your analysis as a valid JSON object exactly matching this structure:
            {
              "7days": {
                "sentiment": <number from -10 to 10>,
                "direction": <"up", "down", or "neutral">,
                "expected_change_percent": <string estimate>,
                "confidence_level": <"high", "medium", or "low">,
                "summary": <string>,
                "price_drivers": [
                  {
                    "factor": <string>,
                    "impact": <"positive", "negative", or "neutral">,
                    "confidence": <"high", "medium", or "low">
                  }
                ],
                "key_articles": [
                  {
                    "title": <string>,
                    "url": <string>,
                    "publishedAt": <string - publication date>,
                    "source": <string>,
                    "impact_summary": <string - detailed explanation of impact>,
                    "confidence": <"high", "medium", or "low">
                  }
                ]
              },
              "1month": { <same structure as 7days> },
              "3months": { <same structure as 7days> },
              "6months": { <same structure as 7days> }
            }
            
            Return ONLY the structured JSON with no other text.`
          },
          {
            role: "user",
            content: JSON.stringify(articles)
          }
        ],
        temperature: 0.5,
        max_tokens: 4000
      });

      if (!analysis.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from OpenAI');
      }

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content, 'analysis');
      
      // Validate structure of the response
      try {
        this.validateAnalysisStructure(result);
        return result;
      } catch (error) {
        console.error('Invalid analysis structure:', error);
        throw new Error(`Invalid analysis structure: ${error.message}`);
      }
    } catch (error) {
      console.error('Error in analyzeArticles:', error);
      throw new Error(`Failed to analyze articles: ${error.message}`);
    }
  }
  
  // Organize articles by timeframe relevance
  organizeArticlesByTimeframe(articles) {
    // Initialize result object with arrays for each timeframe
    const result = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };
    
    // Process each article to determine its best matching timeframe(s)
    articles.forEach(article => {
      // If article has explicit timeframe scores, use them
      if (article.timeframeScores && Object.keys(article.timeframeScores).length > 0) {
        // Find the timeframe(s) with the highest score
        const scores = article.timeframeScores;
        const maxScore = Math.max(...Object.values(scores));
        
        // Assign to all timeframes where the score is at least 90% of the max
        let assigned = false;
        for (const [timeframe, score] of Object.entries(scores)) {
          if (score >= maxScore * 0.9) {
            result[timeframe].push(article);
            assigned = true;
          }
        }
        
        // If not assigned to any timeframe (shouldn't happen), use a fallback method
        if (!assigned) {
          this.assignArticleByFallback(article, result);
        }
      }
      // If article has timeframeRelevance data, use it
      else if (article.timeframeRelevance && Object.keys(article.timeframeRelevance).length > 0) {
        const relevance = article.timeframeRelevance;
        const maxRelevance = Math.max(...Object.values(relevance));
        
        // Assign to all timeframes where the relevance is at least 80% of the max
        let assigned = false;
        for (const [timeframe, score] of Object.entries(relevance)) {
          if (score >= maxRelevance * 0.8) {
            result[timeframe].push(article);
            assigned = true;
          }
        }
        
        // If not assigned to any timeframe, use fallback
        if (!assigned) {
          this.assignArticleByFallback(article, result);
        }
      } 
      // If no explicit data, use fallback assignment method
      else {
        this.assignArticleByFallback(article, result);
      }
    });
    
    return result;
  }
  
  // Fallback method for assigning articles to timeframes based on content and date
  assignArticleByFallback(article, result) {
    // Check publication date
    const now = new Date();
    let daysSincePublished = 30; // Default if we can't determine
    
    if (article.publishedDate) {
      daysSincePublished = Math.floor((now - new Date(article.publishedDate)) / (1000 * 60 * 60 * 24));
    } else if (article.pubDate) {
      daysSincePublished = Math.floor((now - new Date(article.pubDate)) / (1000 * 60 * 60 * 24));
    } else if (article.publishedAt) {
      // Try to parse date from string
      try {
        daysSincePublished = Math.floor((now - new Date(article.publishedAt)) / (1000 * 60 * 60 * 24));
      } catch (e) {
        // Keep default
      }
    }
    
    // Check content for timeframe keywords
    const content = (article.title + ' ' + (article.description || '')).toLowerCase();
    
    // Define timeframe-related terms
    const timeframeKeywords = {
      '7days': ['today', 'yesterday', 'this week', 'next week', 'days', 'short term'],
      '1month': ['this month', 'next month', 'monthly', 'weeks', 'short term'],
      '3months': ['quarter', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'months', 'medium term'],
      '6months': ['long term', 'year', 'annual', 'future', 'roadmap', 'strategy']
    };
    
    // Check for explicit timeframe mentions
    let assignedByKeyword = false;
    for (const [timeframe, keywords] of Object.entries(timeframeKeywords)) {
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          result[timeframe].push(article);
          assignedByKeyword = true;
          break;
        }
      }
      if (assignedByKeyword) break;
    }
    
    // If no keywords matched, assign based on recency
    if (!assignedByKeyword) {
      if (daysSincePublished < 3) {
        result['7days'].push(article);
      } else if (daysSincePublished < 7) {
        result['7days'].push(article);
        result['1month'].push(article);
      } else if (daysSincePublished < 30) {
        result['1month'].push(article);
        result['3months'].push(article);
      } else {
        result['3months'].push(article);
        result['6months'].push(article);
      }
    }
  }
}

module.exports = new OpenAIService(); 