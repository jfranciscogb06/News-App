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

          SENTIMENT SCORE GUIDELINES:
          - Score Range: -100 (EXTREMELY BEARISH) to +100 (EXTREMELY BULLISH), with 0 being NEUTRAL
          - Consider ALL available information when calculating sentiment
          - Scoring Framework:
            * -100 to -75: Extremely Bearish (severe negative catalysts, major problems)
            * -74 to -50: Very Bearish (significant challenges, negative outlook)
            * -49 to -25: Moderately Bearish (concerning issues, but not severe)
            * -24 to -1: Slightly Bearish (minor concerns or uncertainties)
            * 0: Neutral (balanced positive and negative factors)
            * +1 to +24: Slightly Bullish (minor positive indicators)
            * +25 to +49: Moderately Bullish (positive developments)
            * +50 to +74: Very Bullish (strong positive catalysts)
            * +75 to +100: Extremely Bullish (exceptional positive developments)

          For each timeframe, provide:
          1. A detailed sentiment score analysis including:
             - The numerical score (-100 to +100)
             - Comprehensive explanation of the score
             - Key factors that influenced the score
             - Confidence level in the sentiment assessment
             - Potential catalysts that could change the sentiment

          2. A thorough market outlook analysis including:
             - Technical analysis based on stock prices
             - Industry trends and competitive position
             - Market conditions and macroeconomic factors
             - Risk factors and potential challenges
             - Growth opportunities and catalysts

          3. Comprehensive article analysis (15-20 articles per timeframe):
             - Article title and source
             - Detailed significance explanation
             - Specific impact on sentiment score (quantify the impact)
             - How it relates to other articles/developments
             - Reliability assessment of the information
          
          Focus on articles that:
          - Directly relate to ${symbol}'s business performance
          - Discuss market trends affecting the company
          - Reveal upcoming events or developments
          - Provide analyst insights or predictions
          - Contain concrete data or specific developments
          
          Structure the response as a JSON object with the following format:
          {
            "7days": {
              "sentiment_score": number,
              "sentiment_explanation": "string",
              "sentiment_factors": ["string"],
              "confidence_level": "high" | "medium" | "low",
              "potential_sentiment_changes": ["string"],
              "analysis": "string",
              "market_conditions": "string",
              "risk_factors": ["string"],
              "growth_catalysts": ["string"],
              "key_articles": [
                {
                  "title": "string",
                  "source": "string",
                  "significance": "string",
                  "sentiment_impact": "string",
                  "reliability": "high" | "medium" | "low",
                  "related_developments": ["string"]
                }
              ]
            },
            "1month": { same structure },
            "3months": { same structure },
            "6months": { same structure }
          }
          
          Ensure:
          1. ALL relevant articles are analyzed and factored into the sentiment
          2. Sentiment scores accurately reflect the cumulative impact of ALL information
          3. Analysis connects related developments across different articles
          4. Clear explanation of how each article contributes to the overall sentiment
          5. Comprehensive coverage of both positive and negative factors`
        },
        {
          role: "user",
          content: JSON.stringify({
            articles,
            stockDetails,
            stockPrices,
            articleCount: articles.length
          })
        }
      ],
      temperature: 0.5,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });

    return JSON.parse(analysis.choices[0].message.content);
  }
}

module.exports = new OpenAIService(); 