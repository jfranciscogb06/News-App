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
          content: `You are a financial analyst expert. Analyze the provided news articles about ${symbol} stock and structure your analysis in the following format for each timeframe (7 days, 1 month, 3 months, 6 months):

          For each timeframe, provide:
          1. A sentiment score (-100 to +100) with brief explanation
          2. A comprehensive analysis of potential impact and market outlook
          3. Top 10 most significant articles that support this analysis, including:
             - Article title
             - Brief explanation of why this article is significant
             - How it influenced the sentiment score
          
          Structure the response as a JSON object with the following format:
          {
            "7days": {
              "sentiment_score": number,
              "sentiment_explanation": "string",
              "analysis": "string",
              "key_articles": [
                {
                  "title": "string",
                  "significance": "string",
                  "impact_on_sentiment": "string"
                }
              ]
            },
            "1month": { same structure },
            "3months": { same structure },
            "6months": { same structure }
          }`
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
      temperature: 0.5,
      response_format: { type: "json_object" }
    });

    return JSON.parse(analysis.choices[0].message.content);
  }
}

module.exports = new OpenAIService(); 