const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  async filterRelevantArticles(symbol, articles) {
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

          Return a JSON object in this format:
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

    try {
      return JSON.parse(analysis.choices[0].message.content);
    } catch (error) {
      console.error('Error parsing OpenAI response:', error);
      throw new Error('Failed to parse article filtering response');
    }
  }

  async analyzeArticles(symbol, articles) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a financial analyst expert specializing in predicting market movements based on news analysis. For ${symbol} stock:

          1. Analyze all provided articles (approximately 100) and identify key market-moving events, trends, and potential future catalysts.
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

          Respond with a JSON object in this format:
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
          }

          Important:
          - Include at least 5-10 significant articles per timeframe
          - Prioritize articles that suggest clear price movements
          - For longer timeframes, analyze how current events might evolve
          - Consider market cycles and seasonal patterns
          - Factor in historical price reactions to similar news`
        },
        {
          role: "user",
          content: JSON.stringify(articles)
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    try {
      return JSON.parse(analysis.choices[0].message.content);
    } catch (error) {
      console.error('Error parsing OpenAI response:', error);
      throw new Error('Failed to parse analysis response');
    }
  }
}

module.exports = new OpenAIService(); 