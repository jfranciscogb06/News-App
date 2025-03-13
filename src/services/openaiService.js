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
      // Check if the timeframe data exists
      if (!data[timeframe]) {
        throw new Error(`Missing data for timeframe: ${timeframe}`);
      }
      
      // Handle potential compatibility issues - map the new format to old format if needed
      const timeframeData = data[timeframe];
      
      // If the response is using the new format (prediction, confidence, magnitude, key_factors, etc.)
      if (timeframeData.prediction && !timeframeData.direction) {
        console.log(`Converting new format to compatible format for ${timeframe}`);
        
        // Convert prediction to direction
        if (timeframeData.prediction.toLowerCase() === 'up') {
          timeframeData.direction = 'up';
          timeframeData.sentiment = 5; // Positive sentiment
        } else if (timeframeData.prediction.toLowerCase() === 'down') {
          timeframeData.direction = 'down';
          timeframeData.sentiment = -5; // Negative sentiment
        } else {
          timeframeData.direction = 'neutral';
          timeframeData.sentiment = 0; // Neutral sentiment
        }
        
        // Map confidence to confidence_level
        timeframeData.confidence_level = timeframeData.confidence || 'medium';
        
        // Create expected_change_percent from magnitude
        if (timeframeData.magnitude === 'significant') {
          timeframeData.expected_change_percent = timeframeData.direction === 'up' ? '>5%' : '<-5%';
        } else if (timeframeData.magnitude === 'moderate') {
          timeframeData.expected_change_percent = timeframeData.direction === 'up' ? '2-5%' : '-2% to -5%';
        } else {
          timeframeData.expected_change_percent = timeframeData.direction === 'up' ? '0-2%' : '-2% to 0%';
        }
        
        // Create summary if missing
        if (!timeframeData.summary) {
          const keyFactors = Array.isArray(timeframeData.key_factors) 
            ? timeframeData.key_factors.join('. ') 
            : 'No specific factors identified.';
            
          timeframeData.summary = `Analysis predicts ${timeframeData.prediction} movement with ${timeframeData.confidence} confidence. ${keyFactors}`;
        }
        
        // Convert key_factors to price_drivers if needed
        if (timeframeData.key_factors && !timeframeData.price_drivers) {
          timeframeData.price_drivers = timeframeData.key_factors.map(factor => ({
            factor,
            impact: timeframeData.direction === 'up' ? 'positive' : 
                   timeframeData.direction === 'down' ? 'negative' : 'neutral',
            confidence: timeframeData.confidence || 'medium'
          }));
        }
      }
      
      // Now validate that the necessary fields exist in the compatible format
      if (typeof timeframeData.sentiment !== 'number' ||
          typeof timeframeData.summary !== 'string' ||
          !Array.isArray(timeframeData.price_drivers) ||
          !Array.isArray(timeframeData.key_articles) ||
          !['up', 'down', 'neutral'].includes(timeframeData.direction) ||
          typeof timeframeData.expected_change_percent !== 'string' ||
          typeof timeframeData.confidence_level !== 'string') {
        throw new Error(`Invalid structure for timeframe: ${timeframe}`);
      }
      
      // Validate price_drivers structure
      for (const driver of timeframeData.price_drivers) {
        if (!driver.factor || 
            !driver.impact || 
            !['positive', 'negative', 'neutral'].includes(driver.impact) ||
            !driver.confidence || 
            !['high', 'medium', 'low'].includes(driver.confidence)) {
          throw new Error(`Invalid price driver structure for timeframe: ${timeframe}`);
        }
      }
      
      // Validate key_articles structure
      for (const article of timeframeData.key_articles) {
        if (!article.title || 
            !article.url || 
            !article.source || 
            !article.confidence || 
            !['high', 'medium', 'low'].includes(article.confidence)) {
          throw new Error(`Invalid article structure for timeframe: ${timeframe}`);
        }
        
        // Check for the impact_summary field - it's optional but should be a string if present
        if (article.impact_summary && typeof article.impact_summary !== 'string') {
          throw new Error(`Invalid impact_summary in article for timeframe: ${timeframe}`);
        }
        
        // Check for the publishedAt field - it's optional but should be a string if present
        if (article.publishedAt && typeof article.publishedAt !== 'string') {
          throw new Error(`Invalid publishedAt in article for timeframe: ${timeframe}`);
        }
        
        // Check for the timeframe_label field - it's optional but should be a string if present
        if (article.timeframe_label && typeof article.timeframe_label !== 'string') {
          throw new Error(`Invalid timeframe_label in article for timeframe: ${timeframe}`);
        }
        
        // Check for the for_timeframe field - it's optional but should be a string if present
        if (article.for_timeframe && typeof article.for_timeframe !== 'string') {
          throw new Error(`Invalid for_timeframe in article for timeframe: ${timeframe}`);
        }
      }
    }
    
    console.log('Analysis structure validated successfully');
    return true;
  }

  async selectRelevantArticles(symbol, articles, maxArticles = 20) {
    try {
      console.log(`Selecting most relevant articles for ${symbol}...`);
      
      const analysisResponse = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-0125",
        messages: [
          {
            role: "system",
            content: `You are a financial expert selecting the most informative articles for predicting the future stock price movement of ${symbol}.

Your task is to select articles that have predictive value for stock price movements across different timeframes (7 days, 1 month, 3 months, and 6 months).

CRITICAL SELECTION CRITERIA:
1. TIMEFRAME RELEVANCE: Articles discussing events scheduled to occur during a specific timeframe should be selected for that timeframe, REGARDLESS OF WHEN THE ARTICLE WAS PUBLISHED.
   - Example: An article from January that discusses an earnings release scheduled for March 15th should be selected for a March 13-20 timeframe analysis.
   - Example: An article discussing "Q3 outlook" would be relevant for the 3-month timeframe even if published weeks earlier.

2. FAVOR PREDICTIVE VALUE OVER RECENCY: Older articles can have high value if they discuss:
   - Future product launches, earnings dates, or regulatory decisions
   - Long-term trends, market shifts, or strategic changes
   - Developments with ongoing impact (partnerships, acquisitions, restructuring)
   
3. SELECT ARTICLES THAT CONTAIN:
   - Information likely to impact future stock prices
   - Discussion of fundamentals, product developments, competitive positions, or market trends
   - Significant corporate developments and strategic changes
   - Analyst insights with lasting relevance
   - Meaningful data points for evaluating future performance
   
4. For each selected article, provide:
   - The article URL
   - A brief explanation of why it's relevant for predicting ${symbol}'s future price movement
   - Indicate which timeframes (7 days, 1 month, 3 months, 6 months) the article is most relevant for

Select up to ${maxArticles} articles, prioritizing those with unique insights across different timeframes.`
          },
          {
            role: "user",
            content: JSON.stringify(articles)
          }
        ],
        temperature: 0.2,
        max_tokens: 2000
      });

      const response = analysisResponse.choices[0].message.content;
      console.log("Raw response:", response);
      
      // Clean and parse the response
      let cleanedResponse;
      try {
        cleanedResponse = this.cleanAndParseResponse(response, "article selection");
        console.log("Cleaned response:", cleanedResponse);
      } catch (error) {
        console.error("Error cleaning/parsing response:", error);
        throw new Error(`Failed to parse OpenAI response: ${error.message}`);
      }
      
      // Validate the structure of the response
      if (!cleanedResponse.selected_articles || !Array.isArray(cleanedResponse.selected_articles)) {
        throw new Error("Invalid response format: selected_articles array not found");
      }
      
      console.log(`OpenAI selected ${cleanedResponse.selected_articles.length} most relevant articles from ${articles.length}`);
      
      // Return the selected articles
      return cleanedResponse.selected_articles;
    } catch (error) {
      console.error("Error in selectRelevantArticles:", error);
      // Fallback to a simpler filtering approach if OpenAI fails
      console.log("Falling back to simple relevance filtering...");
      return this.filterRelevantArticles(symbol, articles);
    }
  }

  async filterRelevantArticles(symbol, articles) {
    try {
      console.log(`Using fallback filtering for ${symbol} with ${articles.length} articles`);
      
      // Check if we need to limit the number of articles
      if (articles.length <= 20) {
        return articles;
      }
      
      // First, organize by published date (if available)
      const articlesWithDates = articles.filter(a => a.publishedAt);
      const articlesWithoutDates = articles.filter(a => !a.publishedAt);
      
      // Sort articles with dates by recency
      articlesWithDates.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      
      // Look for timeframe-specific keywords in titles and descriptions
      const timeframeKeywords = {
        '7days': ['next week', 'this week', 'upcoming', 'imminent', 'short term', 'days ahead', 'week ahead', 'weekly'],
        '1month': ['next month', 'this month', 'monthly outlook', 'month ahead', 'near term', '30 day', 'four weeks'],
        '3months': ['quarter', 'quarterly', 'Q1', 'Q2', 'Q3', 'Q4', '3 month', 'three month', 'medium term'],
        '6months': ['half year', 'six month', '6 month', 'long term', 'outlook', 'future', 'year end', 'year ahead']
      };
      
      // Function to calculate timeframe relevance score
      const getTimeframeScore = (article) => {
        const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
        const scores = {};
        
        // Check for timeframe-specific keywords
        Object.entries(timeframeKeywords).forEach(([timeframe, keywords]) => {
          scores[timeframe] = 0;
          keywords.forEach(keyword => {
            if (text.includes(keyword.toLowerCase())) {
              scores[timeframe] += 3;
            }
          });
        });
        
        // Check for future-oriented terms
        const futureTerms = ['will', 'expect', 'anticipate', 'forecast', 'predict', 'outlook', 'guidance', 'project', 'target'];
        const hasFutureTerms = futureTerms.some(term => text.includes(term.toLowerCase()));
        
        if (hasFutureTerms) {
          Object.keys(scores).forEach(timeframe => {
            scores[timeframe] += 1;
          });
        }
        
        // Look for specific events or announcements 
        const eventTerms = ['earnings', 'release', 'announce', 'launch', 'unveil', 'report', 'update'];
        const hasEvents = eventTerms.some(term => text.includes(term.toLowerCase()));
        
        if (hasEvents) {
          Object.keys(scores).forEach(timeframe => {
            scores[timeframe] += 2;
          });
        }
        
        return scores;
      };
      
      // Add timeframe relevance scores to each article
      articles.forEach(article => {
        article.timeframe_relevance = getTimeframeScore(article);
      });
      
      // Calculate a combined relevance score
      articles.forEach(article => {
        const tfScores = article.timeframe_relevance || {};
        article.combinedRelevanceScore = 
          (tfScores['7days'] || 0) + 
          (tfScores['1month'] || 0) + 
          (tfScores['3months'] || 0) + 
          (tfScores['6months'] || 0);
      });
      
      // Sort by combined relevance score
      articles.sort((a, b) => (b.combinedRelevanceScore || 0) - (a.combinedRelevanceScore || 0));
      
      // Take top 20 articles with the highest timeframe relevance
      return articles.slice(0, 20);
    } catch (error) {
      console.error('Error in fallback filtering:', error);
      // If all else fails, just return a limited number of the original articles
      return articles.slice(0, 20);
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
      
      console.log(`Organized articles by timeframe: ${timeframeDetails}`);
      
      // Create specific prompts for each timeframe using only the relevant articles for that timeframe
      const timeframes = ['7days', '1month', '3months', '6months'];
      
      // Enrich article data for OpenAI with source credibility information
      for (const timeframe of timeframes) {
        const relevantArticles = timeframeArticles[timeframe];
        
        // Add credibility context to each article if available
        for (let i = 0; i < relevantArticles.length; i++) {
          if (relevantArticles[i].credibilityScore) {
            relevantArticles[i].credibilityContext = `Source reliability: ${relevantArticles[i].credibilityScore.rating}, 
              Political bias: ${relevantArticles[i].biasAssessment?.politicalBias || 'unknown'}, 
              Sensationalism: ${relevantArticles[i].biasAssessment?.sensationalism || 'unknown'}, 
              Opinion content: ${relevantArticles[i].isOpinionContent ? 'yes' : 'no'}`;
          }
        }
      }

      // Process each timeframe separately
      const results = {};
      
      for (const timeframe of timeframes) {
        const relevantArticles = timeframeArticles[timeframe];
        if (relevantArticles.length === 0) {
          console.log(`No articles found for timeframe: ${timeframe}, using general articles`);
          // If no specific articles for this timeframe, use a subset of all articles
          results[timeframe] = this.analyzeSingleTimeframe(symbol, timeframe, articles.slice(0, 20));
        } else {
          console.log(`Analyzing ${timeframe} with ${relevantArticles.length} relevant articles`);
          results[timeframe] = this.analyzeSingleTimeframe(symbol, timeframe, relevantArticles);
        }
      }
      
      // Combine the results into a single analysis object that clearly separates by timeframe
      const result = {
        '7days': {
          ...results['7days'],
          timeframe_label: 'Next 7 Days',
          display_order: 1
        },
        '1month': {
          ...results['1month'],
          timeframe_label: 'Next Month',
          display_order: 2
        },
        '3months': {
          ...results['3months'],
          timeframe_label: 'Next 3 Months',
          display_order: 3
        },
        '6months': {
          ...results['6months'],
          timeframe_label: 'Next 6 Months',
          display_order: 4
        }
      };
      
      // Enhance key articles to make timeframe more prominent
      Object.keys(result).forEach(timeframe => {
        if (result[timeframe].key_articles && Array.isArray(result[timeframe].key_articles)) {
          result[timeframe].key_articles = result[timeframe].key_articles.map(article => {
            return {
              ...article,
              timeframe_label: result[timeframe].timeframe_label,
              for_timeframe: timeframe
            };
          });
        }
      });
      
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
  
  // Analyze a single timeframe with relevant articles
  async analyzeSingleTimeframe(symbol, timeframe, articles) {
    // Convert timeframe to human-readable range
    const timeframeDescription = {
      '7days': 'the next 7 days',
      '1month': 'the next month',
      '3months': 'the next 3 months',
      '6months': 'the next 6 months'
    }[timeframe];
    
    // Calculate specific date range for this timeframe
    const startDate = new Date();
    const endDate = new Date();
    
    switch(timeframe) {
      case '7days':
        endDate.setDate(startDate.getDate() + 7);
        break;
      case '1month':
        endDate.setMonth(startDate.getMonth() + 1);
        break;
      case '3months':
        endDate.setMonth(startDate.getMonth() + 3);
        break;
      case '6months':
        endDate.setMonth(startDate.getMonth() + 6);
        break;
    }
    
    // Format date range (e.g., "May 1 - May 7, 2023")
    const formatOptions = { month: 'short', day: 'numeric', year: timeframe === '7days' ? undefined : 'numeric' };
    const dateRange = `${startDate.toLocaleDateString('en-US', formatOptions)} - ${endDate.toLocaleDateString('en-US', formatOptions)}`;
    
    const timeframeLabel = {
      '7days': `7-Day (${dateRange})`,
      '1month': `1-Month (${dateRange})`,
      '3months': `3-Month (${dateRange})`,
      '6months': `6-Month (${dateRange})`
    }[timeframe];
    
    try {
      // Prepare the system message instructing the model on how to analyze the articles
      const systemMessage = {
        role: 'system',
        content: `You are a skilled financial analyst who specializes in stock price movement forecasting. 
        Your task is to analyze news articles about ${symbol} stock to predict its likely price movement over ${timeframeDescription} (${dateRange}).
        
        IMPORTANT SOURCE CREDIBILITY GUIDELINES:
        - Prioritize information from high-credibility sources and weigh them more heavily in your analysis
        - Be cautious with articles marked as "questionable" or "low credibility"
        - Be aware of political bias and sensationalism that might affect reporting
        - Consider whether articles are opinion pieces versus factual reporting
        - When sources conflict, favor more credible sources over less credible ones
        
        You will analyze relevant news articles and predict whether the stock is likely to go UP, DOWN, or SIDEWAYS in ${timeframeDescription}.
        
        Your analysis should include:
        1. A clear directional prediction (UP, DOWN, or SIDEWAYS)
        2. Confidence level (high, medium, low)
        3. Expected magnitude (significant, moderate, slight)
        4. Key factors driving the prediction
        5. Key articles supporting this prediction (2-5 most relevant articles)
        6. Potential risks that could change the prediction
        
        For each key article you select, provide:
        - Title
        - Source
        - URL
        - Impact summary (1-2 sentences on why this article is significant)
        - Confidence in this article (high/medium/low, factoring in source credibility)
        
        IMPORTANT: Your prediction MUST be one of exactly three values: "UP", "DOWN", or "SIDEWAYS" (all caps).
        
        Return your analysis as a JSON object with this structure:
        {
          "prediction": "UP|DOWN|SIDEWAYS",
          "confidence": "high|medium|low",
          "magnitude": "significant|moderate|slight",
          "key_factors": ["factor1", "factor2", ...],
          "key_articles": [
            {
              "title": "Article title",
              "source": "Source name",
              "url": "Article URL",
              "impact_summary": "1-2 sentence summary of impact",
              "confidence": "high|medium|low"
            },
            ...
          ],
          "risks": ["risk1", "risk2", ...]
        }`
      };

      // Sort articles by their timeframe relevance score for this specific timeframe
      let timeframeArticles = [...articles];
      
      // For traceability, put an index on each article
      timeframeArticles = timeframeArticles.map((article, idx) => ({
        ...article,
        index: idx + 1
      }));
      
      // Format the articles for OpenAI in a more structured way
      const formattedArticles = timeframeArticles.map(article => {
        // Extract credibility information if available
        const credibilityInfo = article.credibilityScore 
          ? `\nSource credibility: ${article.credibilityScore.rating} (score: ${article.credibilityScore.score}/100)`
          : '';
        
        // Extract bias information if available
        const biasInfo = article.biasAssessment
          ? `\nPolitical bias: ${article.biasAssessment.politicalBias}, Sensationalism: ${article.biasAssessment.sensationalism}`
          : '';
        
        // Note if it's an opinion piece
        const opinionInfo = article.isOpinionContent
          ? '\nThis appears to be an opinion piece rather than factual reporting.'
          : '';
        
        return `
ARTICLE ${article.index}:
Title: ${article.title || 'No title'}
Source: ${article.source || 'Unknown source'}${credibilityInfo}${biasInfo}${opinionInfo}
Date: ${article.publishedAt || 'Unknown date'}
URL: ${article.url || 'No URL'}
Content: ${article.description || article.content || 'No content available'}
        `.trim();
      }).join('\n\n');

      // Create the OpenAI API request
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini", // or equivalent available model
        messages: [
          systemMessage,
          {
            role: "user",
            content: `Here are the news articles about ${symbol} stock to analyze for price movement prediction over ${timeframeDescription}:\n\n${formattedArticles}\n\nBased on these articles, provide your analysis and prediction in the requested JSON format. Be sure to consider source credibility when weighing information.`
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

      if (!response.choices?.[0]?.message?.content) {
        throw new Error(`Invalid response from OpenAI for timeframe ${timeframe}`);
      }

      // Parse the response and convert to legacy format
      let result = this.cleanAndParseResponse(response.choices[0].message.content, `${timeframe} analysis`);
      
      // Convert the new format to the legacy format expected by the rest of the application
      const legacyFormat = this.convertToLegacyFormat(result, timeframe);
      
      return legacyFormat;
    } catch (error) {
      console.error(`Error analyzing timeframe ${timeframe}:`, error);
      // Return a fallback empty structure that follows the expected format
      return {
        sentiment: 0,
        direction: "neutral",
        expected_change_percent: "0%",
        confidence_level: "low",
        summary: `Insufficient data to analyze ${timeframe} timeframe.`,
        price_drivers: [
          {
            factor: "Insufficient data",
            impact: "neutral",
            confidence: "low"
          }
        ],
        key_articles: []
      };
    }
  }
  
  // Helper method to convert the new format to the legacy format
  convertToLegacyFormat(newFormat, timeframe) {
    // If already in legacy format, return as is
    if (newFormat.sentiment !== undefined && 
        newFormat.direction !== undefined && 
        newFormat.expected_change_percent !== undefined) {
      return newFormat;
    }
    
    console.log(`Converting new format to legacy format for ${timeframe}`);
    
    // Map prediction to direction and sentiment
    let direction = 'neutral';
    let sentiment = 0;
    
    if (newFormat.prediction) {
      const pred = newFormat.prediction.toLowerCase();
      if (pred === 'up') {
        direction = 'up';
        sentiment = 5; // Positive sentiment
      } else if (pred === 'down') {
        direction = 'down';
        sentiment = -5; // Negative sentiment
      } else if (pred === 'sideways') {
        direction = 'neutral';
        sentiment = 0; // Neutral sentiment
      }
    }
    
    // Determine expected_change_percent from magnitude
    let expected_change_percent = '0%';
    if (newFormat.magnitude) {
      if (direction === 'neutral') {
        expected_change_percent = '-1% to 1%'; // Sideways movement
      } else if (newFormat.magnitude === 'significant') {
        expected_change_percent = direction === 'up' ? '>5%' : '<-5%';
      } else if (newFormat.magnitude === 'moderate') {
        expected_change_percent = direction === 'up' ? '2-5%' : '-2% to -5%';
      } else {
        expected_change_percent = direction === 'up' ? '0-2%' : '-2% to 0%';
      }
    }
    
    // Create a summary from key factors if needed
    let summary = newFormat.summary;
    if (!summary && newFormat.key_factors) {
      const keyFactors = Array.isArray(newFormat.key_factors) 
        ? newFormat.key_factors.join('. ') 
        : 'No specific factors identified.';
        
      const predictionText = direction === 'up' ? 'upward' :
                            direction === 'down' ? 'downward' : 'sideways';
      
      summary = `Analysis predicts ${predictionText} movement with ${newFormat.confidence || 'medium'} confidence. ${keyFactors}`;
    }
    
    // Convert key_factors to price_drivers
    const price_drivers = [];
    if (newFormat.key_factors && Array.isArray(newFormat.key_factors)) {
      for (const factor of newFormat.key_factors) {
        price_drivers.push({
          factor,
          impact: direction === 'up' ? 'positive' : 
                 direction === 'down' ? 'negative' : 'neutral',
          confidence: newFormat.confidence || 'medium'
        });
      }
    }
    
    // Also convert risks to price drivers
    if (newFormat.risks && Array.isArray(newFormat.risks)) {
      // Add risks as negative or neutral price drivers depending on prediction
      for (const risk of newFormat.risks) {
        price_drivers.push({
          factor: risk,
          impact: direction === 'up' ? 'negative' : 'neutral', // Risks for UP prediction are negative, otherwise neutral
          confidence: newFormat.confidence || 'medium'
        });
      }
    }
    
    // Ensure key_articles have the right format
    const key_articles = newFormat.key_articles || [];
    
    // Ensure each key article has the required fields
    for (const article of key_articles) {
      // Ensure required fields are present
      if (!article.confidence) {
        article.confidence = newFormat.confidence || 'medium';
      }
      if (!article.title) {
        article.title = "Untitled Article";
      }
      if (!article.source) {
        article.source = "Unknown Source";
      }
      if (!article.url) {
        article.url = "#";
      }
    }
    
    return {
      sentiment,
      direction,
      expected_change_percent,
      confidence_level: newFormat.confidence || 'medium',
      summary,
      price_drivers,
      key_articles
    };
  }
  
  // Organize articles by timeframe, but with stricter timeframe-specific filtering
  organizeArticlesByTimeframe(articles) {
    // Initialize result object with arrays for each timeframe
    const result = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };
    
    // Calculate end dates for each timeframe for reference
    const now = new Date();
    const endDates = {
      '7days': new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      '1month': new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
      '3months': new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()),
      '6months': new Date(now.getFullYear(), now.getMonth() + 6, now.getDate())
    };
    
    // First pass: Use explicit timeframe_relevance scores if available and organize articles
    // This ensures the most relevant articles are placed in each timeframe
    articles.forEach(article => {
      // Check for explicit timeframe scores
      if (article.timeframe_relevance) {
        // Get all timeframes with at least minimal relevance (score >= 3)
        const relevantTimeframes = Object.entries(article.timeframe_relevance)
          .filter(([_, score]) => score >= 3)
          .sort(([_, scoreA], [__, scoreB]) => scoreB - scoreA); // Sort by score (highest first)
        
        if (relevantTimeframes.length > 0) {
          // Add the article to each relevant timeframe
          relevantTimeframes.forEach(([timeframe, score]) => {
            if (result[timeframe]) {
              // If the article with the exact same title is already in this timeframe, skip it
              if (!result[timeframe].some(a => a.title === article.title)) {
                // Mark the timeframe relevance score so we can sort by it later
                const articleCopy = { ...article, _relevanceScore: score };
                result[timeframe].push(articleCopy);
              }
            }
          });
          return; // Skip the rest of processing for this article since we've placed it
        }
      }
      
      // If no explicit scores or none above threshold, check content for timeframe indicators
      const content = (article.title + ' ' + (article.description || '')).toLowerCase();
      
      // Check for explicit timeframe mentions in content
      const timeframeKeywords = {
        '7days': ['next week', 'coming days', 'this week', '7 day', 'seven day', 'short term', 'imminent'],
        '1month': ['next month', 'coming month', '30 day', 'thirty day', 'monthly', 'short-term'],
        '3months': ['next quarter', 'upcoming quarter', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'mid-term', 'three month'],
        '6months': ['half year', 'next 6 month', 'next six month', 'long-term', 'longer-term']
      };
      
      let assignedToTimeframe = false;
      
      for (const [timeframe, keywords] of Object.entries(timeframeKeywords)) {
        if (keywords.some(keyword => content.includes(keyword))) {
          // If the article with the exact same title is already in this timeframe, skip it
          if (!result[timeframe].some(a => a.title === article.title)) {
            // Assign a moderate relevance score for keyword matches
            const articleCopy = { ...article, _relevanceScore: 5 };
            result[timeframe].push(articleCopy);
            assignedToTimeframe = true;
          }
        }
      }
      
      // If not assigned based on keywords, use publication date as fallback
      if (!assignedToTimeframe && article.publishedAt) {
        try {
          const publishDate = new Date(article.publishedAt);
          
          // Calculate article age in days
          const ageInDays = (now - publishDate) / (24 * 60 * 60 * 1000);
          
          // Assign to timeframes based on recency, with decreasing relevance scores
          if (ageInDays <= 7) {
            // Very recent articles (<=7 days) are relevant for all timeframes, but with different weights
            result['7days'].push({ ...article, _relevanceScore: 8 });
            result['1month'].push({ ...article, _relevanceScore: 7 });
            result['3months'].push({ ...article, _relevanceScore: 6 });
            result['6months'].push({ ...article, _relevanceScore: 5 });
          } else if (ageInDays <= 30) {
            // Recent articles (8-30 days) are relevant for 1+ month timeframes
            result['1month'].push({ ...article, _relevanceScore: 6 });
            result['3months'].push({ ...article, _relevanceScore: 5 });
            result['6months'].push({ ...article, _relevanceScore: 4 });
          } else if (ageInDays <= 90) {
            // Older articles (31-90 days) are less relevant but still useful for 3+ month timeframes
            result['3months'].push({ ...article, _relevanceScore: 4 });
            result['6months'].push({ ...article, _relevanceScore: 3 });
          } else if (ageInDays <= 180) {
            // Much older articles (91-180 days) only relevant for 6-month timeframe
            result['6months'].push({ ...article, _relevanceScore: 2 });
          }
          // Articles older than 180 days not considered relevant for any timeframe
        } catch (error) {
          console.warn(`Could not parse publishedAt date for article: ${article.title}`);
          // For articles without valid dates, assign to all timeframes with low relevance
          Object.keys(result).forEach(timeframe => {
            result[timeframe].push({ ...article, _relevanceScore: 1 });
          });
        }
      } else if (!assignedToTimeframe) {
        // Articles without dates or keywords get assigned to all timeframes with lowest relevance
        Object.keys(result).forEach(timeframe => {
          result[timeframe].push({ ...article, _relevanceScore: 1 });
        });
      }
    });
    
    // Second pass: Ensure each timeframe has a minimum number of articles
    // and sort articles by relevance within each timeframe
    const minArticlesPerTimeframe = 5;
    const timeframes = Object.keys(result);
    
    // Sort all timeframes by relevance score
    timeframes.forEach(timeframe => {
      result[timeframe].sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0));
      
      // Remove duplicates based on title
      const uniqueArticles = [];
      const titles = new Set();
      
      for (const article of result[timeframe]) {
        if (!titles.has(article.title)) {
          titles.add(article.title);
          uniqueArticles.push(article);
        }
      }
      
      result[timeframe] = uniqueArticles;
    });
    
    // Ensure minimum article count for each timeframe by borrowing from others
    for (let i = 0; i < timeframes.length; i++) {
      const currentTimeframe = timeframes[i];
      
      if (result[currentTimeframe].length < minArticlesPerTimeframe) {
        // Try to borrow articles from other timeframes
        const neededArticles = minArticlesPerTimeframe - result[currentTimeframe].length;
        const articlesToAdd = [];
        
        // First try to borrow from closest timeframes (e.g., 7days borrows from 1month first)
        for (let j = 1; j < timeframes.length; j++) {
          const borrowFromIndex = (i + j) % timeframes.length;
          const borrowFromTimeframe = timeframes[borrowFromIndex];
          
          // Get articles from other timeframe that aren't already in current timeframe
          const borrowableArticles = result[borrowFromTimeframe].filter(
            article => !result[currentTimeframe].some(a => a.title === article.title)
          );
          
          // Sort by relevance and take what we need
          borrowableArticles.sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0));
          
          const borrowed = borrowableArticles.slice(0, neededArticles - articlesToAdd.length);
          articlesToAdd.push(...borrowed);
          
          if (articlesToAdd.length >= neededArticles) break;
        }
        
        // Add the borrowed articles to the current timeframe
        result[currentTimeframe].push(...articlesToAdd);
      }
    }
    
    // Limit the number of articles per timeframe to a reasonable number
    const maxArticlesPerTimeframe = 20;
    timeframes.forEach(timeframe => {
      result[timeframe] = result[timeframe].slice(0, maxArticlesPerTimeframe);
      
      // Clean up the internal _relevanceScore property
      result[timeframe].forEach(article => {
        delete article._relevanceScore;
      });
    });
    
    return result;
  }
}

module.exports = new OpenAIService(); 