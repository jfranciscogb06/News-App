const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  // Helper function to clean OpenAI response
  cleanJsonResponse(response) {
    try {
      // Remove markdown code blocks if present
      const cleanedResponse = response.replace(/```json\n?|\n?```/g, '');
      return JSON.parse(cleanedResponse);
    } catch (error) {
      console.error('Error parsing OpenAI response:', error);
      throw new Error('Failed to parse analysis response');
    }
  }

  async filterRelevantArticles(symbol, articles) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content: `You are a financial analyst expert. Review these article titles about ${symbol} stock and select the most relevant ones that could impact stock price.

          Select articles that:
          - Indicate significant company developments
          - Suggest market-moving news
          - Represent unique events (avoid duplicates)
          - Cover different timeframes (7 days to 6 months impact)

          Return ONLY a valid JSON object (no markdown formatting) in this format:
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
      temperature: 0.5
    });

    return this.cleanJsonResponse(analysis.choices[0].message.content);
  }

  async analyzeArticles(symbol, articles) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content: `You are a financial analyst expert specializing in predicting market movements based on news analysis. For ${symbol} stock:

          1. Analyze these pre-filtered articles and identify key market-moving events, trends, and potential future catalysts.
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

          Return ONLY a valid JSON object (no markdown formatting) in this format:
          {
            "7days": {
              "sentiment": <number -100 to 100>,
              "summary": <comprehensive market outlook>,
              "price_drivers": [<list of key factors affecting price>],
              "key_articles": [
                {
                  "title": <article title>,
                  "impact": <detailed analysis of price impact>,
                  "confidence": <high/medium/low>,
                  "potential_price_effect": <estimated % change>
                }
              ]
            },
            "1month": <same structure with focus on emerging trends>,
            "3months": <same structure with industry-wide analysis>,
            "6months": <same structure with long-term strategic outlook>
          }`
        },
        {
          role: "user",
          content: JSON.stringify(articles)
        }
      ],
      temperature: 0.7
    });

    return this.cleanJsonResponse(analysis.choices[0].message.content);
  }
}

module.exports = new OpenAIService(); 