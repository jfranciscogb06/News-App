const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  // Helper to clean and parse OpenAI responses
  cleanAndParseResponse(response) {
    try {
      // Remove any markdown formatting
      let cleaned = response.replace(/```json\n?|\n?```/g, '');
      // Remove any leading/trailing whitespace
      cleaned = cleaned.trim();
      // Parse the cleaned JSON
      return JSON.parse(cleaned);
    } catch (error) {
      console.error('Raw response:', response);
      throw new Error('Failed to parse OpenAI response');
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
      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert specializing in predicting market movements based on news analysis. For ${symbol} stock:

            1. Analyze all provided articles and identify key market-moving events, trends, and potential future catalysts.
            2. Group related articles together and extract the most significant insights that could affect stock price.
            3. For each timeframe, identify patterns and potential market reactions.

            Focus on:
            - Revenue/earnings impacts
            - Market share changes
            - Industry trends
            - Competitive positioning
            - Product launches/developments
            - Management changes
            - Regulatory impacts
            - Market sentiment shifts

            You must return a valid JSON object exactly in this format, with no additional text or formatting:
            {
              "7days": {
                "sentiment": <number -100 to 100>,
                "summary": <string: comprehensive market outlook>,
                "price_drivers": [<array of strings: key factors affecting price>],
                "key_articles": [
                  {
                    "title": <string: article title>,
                    "impact": <string: detailed analysis of price impact>,
                    "confidence": <string: "high"/"medium"/"low">,
                    "potential_price_effect": <string: estimated % change>
                  }
                ]
              },
              "1month": <same structure>,
              "3months": <same structure>,
              "6months": <same structure>
            }`
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
        throw new Error('Invalid response from OpenAI');
      }

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content);
      
      // Validate the response structure
      this.validateAnalysisStructure(result);

      return result;
    } catch (error) {
      console.error('Error in analyzeArticles:', error);
      throw new Error(`Failed to analyze articles: ${error.message}`);
    }
  }
}

module.exports = new OpenAIService(); 