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
          !Array.isArray(data[timeframe].key_articles)) {
        throw new Error(`Invalid structure for timeframe: ${timeframe}`);
      }

      // Validate that Yahoo Finance articles are included
      const yahooArticles = data[timeframe].key_articles.filter(a => a.source === 'Yahoo Finance');
      if (yahooArticles.length === 0) {
        console.warn(`Warning: No Yahoo Finance articles in ${timeframe} timeframe`);
      }
    }
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
            content: `You are a financial analyst expert specializing in future market predictions. Analyze these articles about ${symbol} stock and predict future outcomes.

            IMPORTANT: Your response must be a single, valid JSON object. Do not include any explanatory text outside the JSON structure.

            The response must follow this exact format:
            {
              "7days": {
                "sentiment_score": <number between -100 and 100>,
                "sentiment_explanation": "<string>",
                "sentiment_factors": ["<string>", "<string>"],
                "confidence_level": "<high|medium|low>",
                "potential_sentiment_changes": ["<string>"],
                "analysis": "<string>",
                "market_conditions": "<string>",
                "risk_factors": ["<string>"],
                "growth_catalysts": ["<string>"],
                "key_articles": [
                  {
                    "title": "<string>",
                    "source": "<string>",
                    "significance": "<string>",
                    "sentiment_impact": "<string>",
                    "reliability": "<high|medium|low>",
                    "related_developments": ["<string>"]
                  }
                ]
              },
              "1month": {
                // same structure as 7days
              },
              "3months": {
                // same structure as 7days
              },
              "6months": {
                // same structure as 7days
              }
            }

            Guidelines:
            1. Sentiment Score:
               - -100: Extremely Bearish
               - -50: Bearish
               - 0: Neutral
               - +50: Bullish
               - +100: Extremely Bullish

            2. Article Selection:
               - Include most relevant articles for each timeframe
               - Minimum 5 articles per timeframe
               - Prioritize Yahoo Finance articles
               - Focus on articles about future developments

            3. Analysis Requirements:
               - Detailed impact analysis for each article
               - Clear connection between articles and sentiment
               - Specific price effect reasoning
               - Related developments between articles

            CRITICAL: Ensure all JSON properties are properly quoted and all arrays/objects are properly terminated.`
          },
          {
            role: "user",
            content: JSON.stringify({
              articles,
              articleCount: articles.length
            })
          }
        ],
        temperature: 0.5
      });

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
}

module.exports = new OpenAIService(); 