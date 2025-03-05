const OpenAI = require('openai');
const config = require('../config/config');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  async analyzeArticles(symbol, articles, stockDetails, stockPrices) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a financial analyst expert. Analyze the provided news articles about ${symbol} stock and structure your analysis in the following format for each timeframe (7 days, 1 month, 3 months, 6 months).

          You must respond with ONLY a valid JSON object in exactly this format:
          {
            "7days": {
              "sentiment_score": <number between -100 and 100>,
              "sentiment_explanation": <string explaining the score>,
              "analysis": <string with comprehensive market outlook>,
              "key_articles": [
                {
                  "title": <article title>,
                  "significance": <why this article matters>,
                  "impact_on_sentiment": <how it affected the score>
                }
                // ... up to 10 most significant articles
              ]
            },
            "1month": <same structure as 7days>,
            "3months": <same structure as 7days>,
            "6months": <same structure as 7days>
          }

          Ensure your response is a properly formatted JSON object that can be parsed.`
        },
        {
          role: "user",
          content: JSON.stringify({
            articles,
            stockDetails,
            stockPrices
          })
        }
      ],
      temperature: 0.5
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