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

      // Count Yahoo Finance articles
      const yahooArticles = articles.filter(a => a.provider === 'Yahoo Finance');
      console.log(`Analyzing ${yahooArticles.length} Yahoo Finance articles and ${articles.length - yahooArticles.length} NewsAPI articles`);

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert specializing in future market predictions. Analyze these articles about ${symbol} stock and predict future outcomes.

            SENTIMENT SCORING GUIDELINES - BE CONSERVATIVE AND STRICT:
            
            EXTREMELY BEARISH (-100 to -75):
            - Major company crisis or scandal
            - Bankruptcy risk or severe financial distress
            - Loss of core business or critical market
            - Multiple severe regulatory actions
            - Industry-wide collapse affecting company

            VERY BEARISH (-74 to -50):
            - Significant earnings miss
            - Major product failure or recall
            - Loss of key customers/partnerships
            - Serious legal/regulatory issues
            - Substantial market share loss

            MODERATELY BEARISH (-49 to -25):
            - Missed earnings expectations
            - Increased competition
            - Minor legal/regulatory issues
            - Declining market share
            - Negative analyst coverage

            SLIGHTLY BEARISH (-24 to -1):
            - Minor setbacks
            - Short-term challenges
            - Cautious guidance
            - Market uncertainty
            - Mixed analyst opinions

            NEUTRAL (0):
            - Balanced positive and negative news
            - No significant developments
            - Stable market position
            - Meeting expectations

            SLIGHTLY BULLISH (+1 to +24):
            - Minor positive developments
            - Meeting expectations with optimism
            - Favorable market conditions
            - Positive analyst comments
            - Small competitive advantages

            MODERATELY BULLISH (+25 to +49):
            - Strong earnings meet
            - New product success
            - Market share gains
            - Positive industry trends
            - Multiple analyst upgrades

            VERY BULLISH (+50 to +74):
            - Significant earnings beat
            - Major market share gains
            - Strategic acquisition/merger
            - Strong competitive advantage
            - Industry leadership position

            EXTREMELY BULLISH (+75 to +100):
            - Transformative breakthrough/innovation
            - Exceptional financial results
            - Market dominance achievement
            - Game-changing acquisition/partnership
            - Revolutionary industry disruption

            IMPORTANT RULES:
            1. Scores above +/-75 should be RARE and require EXCEPTIONAL circumstances
            2. Most scores should fall in the -30 to +30 range for typical news
            3. Consider both magnitude AND certainty of impacts
            4. Multiple negative factors are required for very negative scores
            5. Multiple positive factors are required for very positive scores
            6. Be skeptical of overly optimistic projections
            7. Weight concrete developments more than speculative ones

            Return ONLY a JSON object in this exact format:
            {
              "7days": {
                "sentiment": <number between -100 and 100>,
                "summary": "<prediction for next 7 days>",
                "price_drivers": ["<event 1>", "<event 2>", ...],
                "key_articles": [
                  {
                    "title": "<article title>",
                    "url": "<article url>",
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
            - Include Yahoo Finance articles in your analysis as they are highly relevant
            - Provide comprehensive analysis for each timeframe and article
            - Include at least 5 key - most relevant articles total for each timeframe when available
            - Ensure all text fields are properly quoted and there are no trailing commas
            - Be conservative with sentiment scores
            - Justify extreme scores with concrete evidence
            
            Do not include any other text or formatting in your response.`
          },
          {
            role: "user",
            content: JSON.stringify({
              articles,
              yahooFinanceCount: yahooArticles.length,
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

      // Validate Yahoo Finance representation
      for (const timeframe of ['7days', '1month', '3months', '6months']) {
        const timeframeArticles = result[timeframe].key_articles;
        const yahooArticlesInTimeframe = timeframeArticles.filter(a => a.source === 'Yahoo Finance');
        console.log(`${timeframe}: ${yahooArticlesInTimeframe.length} Yahoo Finance articles out of ${timeframeArticles.length} total`);
      }

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