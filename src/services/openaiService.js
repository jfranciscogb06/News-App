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

      // Remove any markdown formatting
      let cleaned = response.replace(/```json\n?|\n?```/g, '');
      
      // Remove any leading/trailing whitespace
      cleaned = cleaned.trim();
      
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
    }
    return true;
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
            content: `You are a financial analyst expert specializing in future market predictions. Analyze these articles about ${symbol} stock and predict future outcomes. Return ONLY a JSON object in this exact format:
            {
              "7days": {
                "sentiment": <predicted sentiment score between -100 and 100>,
                "summary": <detailed prediction of what might happen in next 7 days>,
                "price_drivers": ["potential future event 1", "potential future event 2", ...],
                "key_articles": [
                  {
                    "title": "string",
                    "url": "string",
                    "imageUrl": "string",
                    "predicted_impact": "detailed analysis of potential future impact (at least 100 words)",
                    "confidence": "high" | "medium" | "low",
                    "potential_price_effect": "detailed prediction of price movement with reasoning (at least 50 words)",
                    "detailed_analysis": "comprehensive analysis of the article's implications (at least 200 words)"
                  }
                ]
              },
              "1month": <same structure as 7days, but for 1-month predictions>,
              "3months": <same structure as 7days, but for 3-month predictions>,
              "6months": <same structure as 7days, but for 6-month predictions>
            }
            
            Focus on:
            - Future events and developments
            - Upcoming catalysts or risks
            - Market trends that could affect the stock
            - Potential scenarios and their likelihood
            - Detailed reasoning for each prediction
            - Long-term implications of current developments
            
            Provide comprehensive analysis for each timeframe and article.
            Include at least 5 key articles for each timeframe when available.
            Do not include any other text or formatting in your response.`
          },
          {
            role: "user",
            content: JSON.stringify(articles)
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
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
}

module.exports = new OpenAIService(); 