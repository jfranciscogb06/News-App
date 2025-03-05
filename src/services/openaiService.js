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
          content: `You are a financial analyst expert. Analyze the following news articles about ${symbol} stock and:
          1. Categorize each article by its potential impact timeframe (7 days, 1 month, 3 months, 6 months)
          2. Provide a summary of each article
          3. Assign a sentiment score from -100 (extremely bearish) to 100 (extremely bullish)
          4. Group articles by timeframe and provide an overall analysis for each timeframe`
        },
        {
          role: "user",
          content: JSON.stringify(articles)
        }
      ],
      temperature: 0.5,
    });

    return analysis.choices[0].message.content;
  }
}

module.exports = new OpenAIService(); 