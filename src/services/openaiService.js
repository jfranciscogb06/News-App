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
      console.log(`Raw ${context} response:`, response);

      // Remove any markdown formatting and extra whitespace
      let cleaned = response.replace(/```json\n?|\n?```/g, '')
        .replace(/\n\s+/g, '\n')  // Remove extra whitespace at start of lines
        .replace(/,\s*([}\]])/g, '$1')  // Remove trailing commas
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();
      
      // Fix the + sign issue in sentiment scores
      cleaned = cleaned.replace(/"sentiment":\s*\+(\d+)/g, '"sentiment": $1');
      
      // Log the cleaned response
      console.log(`Cleaned ${context} response:`, cleaned);

      // Try to parse the JSON
      const parsed = JSON.parse(cleaned);
      
      // Log successful parsing
      console.log(`Successfully parsed ${context} response`);
      
      return parsed;
    } catch (error) {
      console.error(`Error parsing ${context} response:`, error);
      console.error('Raw response:', response);
      throw new Error(`Failed to parse ${context} response: ${error.message}`);
    }
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
      }
    }
    console.log('Analysis structure validated successfully');
    return true;
  }

  async selectRelevantArticles(symbol, articles) {
    try {
      // Extract just the titles for initial review
      const articleTitles = articles.map(article => ({
        title: article.title,
        url: article.url
      }));

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Review these article titles about ${symbol} stock and select only the most relevant ones that could impact future stock performance.

            Select titles that:
            - Are specifically about or closely related to ${symbol} or directly impact it
            - Suggest developments or events
            - Indicate potential stock price impact
            - Discuss future predictions or plans

            Return a JSON array of selected articles:
            {
              "selected_articles": [
                {
                  "url": "<article url>",
                  "relevance": "<one sentence explanation>"
                }
              ]
            }

            Only analyze the titles. Do not include any other text in your response.`
          },
          {
            role: "user",
            content: JSON.stringify(articleTitles)
          }
        ],
        temperature: 0.5
      });

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content);
      
      // Filter the original articles based on selected URLs
      return articles.filter(article => 
        result.selected_articles.some(selected => selected.url === article.url)
      );
    } catch (error) {
      console.error('Error selecting relevant articles:', error);
      throw error;
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

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert specializing in future market predictions. Based on these articles about ${symbol} stock, predict whether the stock will go up or down in different timeframes.

            SENTIMENT SCORING GUIDELINES - ALIGN WITH PERCENTAGE CHANGES AND CONFIDENCE:
            
            EXTREMELY BEARISH (-100 to -75):
            - Expected price decrease: -15% or more
            - Very high confidence (80-100%) in severe negative outcome
            - Major company crisis or scandal
            - Bankruptcy risk or severe financial distress
            - Loss of core business or critical market
            - Multiple severe regulatory actions
            - Industry-wide collapse affecting company

            VERY BEARISH (-74 to -50):
            - Expected price decrease: -10% to -15%
            - High confidence (60-80%) in significant negative outcome
            - Significant earnings miss
            - Major product failure or recall
            - Loss of key customers/partnerships
            - Serious legal/regulatory issues
            - Substantial market share loss

            MODERATELY BEARISH (-49 to -25):
            - Expected price decrease: -5% to -10%
            - Moderate confidence (40-60%) in negative outcome
            - Missed earnings expectations
            - Increased competition
            - Minor legal/regulatory issues
            - Declining market share
            - Negative analyst coverage

            SLIGHTLY BEARISH (-24 to -1):
            - Expected price decrease: -1% to -5%
            - Lower confidence (20-40%) in negative outcome
            - Minor setbacks
            - Short-term challenges
            - Cautious guidance
            - Market uncertainty
            - Mixed analyst opinions

            NEUTRAL (0):
            - Expected price change: -1% to +1%
            - Balanced positive and negative factors
            - No significant developments
            - Stable market position
            - Meeting expectations

            SLIGHTLY BULLISH (+1 to +24):
            - Expected price increase: +1% to +5%
            - Lower confidence (20-40%) in positive outcome
            - Minor positive developments
            - Meeting expectations with optimism
            - Favorable market conditions
            - Positive analyst comments
            - Small competitive advantages

            MODERATELY BULLISH (+25 to +49):
            - Expected price increase: +5% to +10%
            - Moderate confidence (40-60%) in positive outcome
            - Strong earnings meet
            - New product success
            - Market share gains
            - Positive industry trends
            - Multiple analyst upgrades

            VERY BULLISH (+50 to +74):
            - Expected price increase: +10% to +15%
            - High confidence (60-80%) in significant positive outcome
            - Significant earnings beat
            - Major market share gains
            - Strategic acquisition/merger
            - Strong competitive advantage
            - Industry leadership position

            EXTREMELY BULLISH (+75 to +100):
            - Expected price increase: +15% or more
            - Very high confidence (80-100%) in exceptional positive outcome
            - Transformative breakthrough/innovation
            - Exceptional financial results
            - Market dominance achievement
            - Game-changing acquisition/partnership
            - Revolutionary industry disruption

            IMPORTANT RULES:
            1. Sentiment score MUST directly correlate with expected percentage change
            2. Incorporate confidence level into both sentiment score and analysis
            3. Higher confidence should push score toward extremes, lower confidence toward center
            4. When calculating sentiment, use this formula: Base sentiment × Confidence factor
            5. For each timeframe, longer periods may have higher percentage changes but require stronger evidence
            6. 7-day predictions should be most conservative, 6-month can be more significant if evidence supports it
            7. Sentiment scores must be integers without any + sign prefix (e.g., use 20 not +20)
            8. Expected_change_percent must include + or - prefix (e.g., "+5%" or "-3%")
            9. Include confidence level in both the sentiment calculation and in article analysis

            For each timeframe, explicitly state whether you think the stock will go up or down based on the articles, by what percentage, and your confidence level in that prediction.

            Return ONLY a JSON object in this exact format:
            {
              "7days": {
                "sentiment": <number between -100 and 100 without + prefix>,
                "direction": "up" | "down" | "neutral",
                "expected_change_percent": "<estimated percentage change with + or - prefix>",
                "confidence_level": "<percentage between 0-100>",
                "summary": "<prediction for next 7 days including whether stock will go up or down>",
                "price_drivers": [
                  {
                    "factor": "<driver name>",
                    "impact": "positive" | "negative" | "neutral",
                    "confidence": "high" | "medium" | "low"
                  }
                ],
                "key_articles": [
                  {
                    "title": "<article title>",
                    "url": "<article url>",
                    "publishedAt": "<article publishedAt date>",
                    "source": "<article source>",
                    "predicted_impact": "<detailed impact analysis>",
                    "confidence": "high" | "medium" | "low",
                    "potential_price_effect": "<price prediction with reasoning>",
                    "detailed_analysis": "<comprehensive analysis>"
                  }
                ]
              },
              "1month": <same structure as 7days>,
              "3months": <same structure as 7days>,
              "6months": <same structure as 7days>
            }
            
            Requirements:
            - Provide comprehensive analysis for each timeframe and article
            - Include at least 5 key - most relevant articles total for each timeframe when available
            - Ensure all text fields are properly quoted and there are no trailing commas
            - Be conservative with sentiment scores for shorter timeframes
            - Align sentiment scores directly with expected percentage changes
            - Explicitly include confidence level for each prediction and price driver
            - Make sure sentiment scores are integers without + signs (e.g., 20 not +20)
            - Clearly state if you think the stock will go up or down in each timeframe
            
            Do not include any other text or formatting in your response.`
          },
          {
            role: "user",
            content: JSON.stringify({
              articles,
              totalCount: articles.length
            })
          }
        ],
        temperature: 0.7,
        max_tokens: 8000
      });

      if (!analysis.choices?.[0]?.message?.content) {
        throw new Error('Empty response from OpenAI');
      }

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content, 'analysis');

      console.log('Validating analysis structure...');
      this.validateAnalysisStructure(result);
      console.log('Analysis structure validated successfully');

      return result;
    } catch (error) {
      console.error('Error in analyzeArticles:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  async findArticleDate(pageText, url) {
    try {
      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert at finding publication dates in article text. 
            Find the most likely publication date in the provided text.
            Return ONLY a JSON object with the date in this format:
            {
              "date": "<Weekday, Month Day, Year>"
            }
            If no date is found, return null for the date value.`
          },
          {
            role: "user",
            content: `Find the publication date in this text from ${url}:\n\n${pageText}`
          }
        ],
        temperature: 0.3
      });

      return JSON.parse(analysis.choices[0].message.content);
    } catch (error) {
      console.error('Error finding article date:', error);
      return null;
    }
  }
}

module.exports = new OpenAIService(); 