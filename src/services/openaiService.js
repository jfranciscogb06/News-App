const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  async analyzeArticles(symbol, articles) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a financial analyst expert specializing in predicting market movements based on news analysis. For ${symbol} stock:

          1. Filter and categorize the provided articles into timeframes (7 days, 1 month, 3 months, 6 months) based on their potential market impact.
          2. Remove duplicate topics (if multiple articles cover the same event, choose the most comprehensive one).
          3. For longer timeframes (3-6 months), include strategic analysis and market predictions.

          Respond with a JSON object in this format:
          {
            "7days": {
              "sentiment": <number -100 to 100>,
              "summary": <brief market outlook>,
              "key_articles": [
                {
                  "title": <article title>,
                  "impact": <how this news affects the stock>
                }
              ]
            },
            "1month": <same structure>,
            "3months": <same structure with forward-looking analysis>,
            "6months": <same structure with strategic predictions>
          }

          Note: Longer timeframes should include more speculative analysis based on current trends and potential market developments.`
        },
        {
          role: "user",
          content: JSON.stringify(articles)
        }
      ],
      temperature: 0.7
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