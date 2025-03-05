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
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Review these article titles about ${symbol} stock and select the most relevant ones that could impact stock price.

            Select articles that:
            - Indicate significant company developments
            - Suggest market-moving news
            - Represent unique events (avoid duplicates)
            - Cover different timeframes (7 days to 6 months impact)

            You must return a valid JSON object exactly in this format, with no additional text or formatting:
            {
              "selected_articles": {
                "7days": [<urls>],
                "1month": [<urls>],
                "3months": [<urls>],
                "6months": [<urls>]
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
      console.log(`Starting analysis for ${symbol} with ${articles.length} articles`);

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Analyze these articles about ${symbol} stock and return ONLY a JSON object in this exact format:
            {
              "7days": {
                "sentiment": <number between -100 and 100>,
                "summary": <string>,
                "price_drivers": ["string1", "string2", ...],
                "key_articles": [
                  {
                    "title": "string",
                    "impact": "string",
                    "confidence": "high" | "medium" | "low",
                    "potential_price_effect": "string"
                  }
                ]
              },
              "1month": <same structure as 7days>,
              "3months": <same structure as 7days>,
              "6months": <same structure as 7days>
            }
            
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