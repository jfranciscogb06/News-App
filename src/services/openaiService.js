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

      // Remove any markdown formatting and extra whitespace
      let cleaned = response.replace(/```json\n?|\n?```/g, '')
        .replace(/\n\s+/g, '\n')  // Remove extra whitespace at start of lines
        .replace(/,\s*([}\]])/g, '$1')  // Remove trailing commas
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .trim();
      
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
          !Array.isArray(data[timeframe].key_articles) ||
          !data[timeframe].key_articles.every(article => 
            article.title && 
            article.url && 
            article.source && 
            article.publishedAt && // Validate publishedAt is present
            article.predicted_impact && 
            article.confidence && 
            article.potential_price_effect && 
            article.detailed_analysis
          )) {
        throw new Error(`Invalid structure for timeframe: ${timeframe}`);
      }

      // Validate that Yahoo Finance articles are included
      const yahooArticles = data[timeframe].key_articles.filter(a => a.source === 'Yahoo Finance');
      if (yahooArticles.length === 0) {
        console.warn(`Warning: No Yahoo Finance articles in ${timeframe} timeframe`);
      }
    }
    return true;
  }

  async selectRelevantArticles(symbol, articles) {
    try {
      // Extract just the titles for initial review
      const articleTitles = articles.map(article => ({
        title: article.title,
        url: article.url
      }));

      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst expert. Review these article titles about ${symbol} stock and select only the most relevant ones that could impact future stock performance.

            Select titles that:
            - Are specifically about or closely related to ${symbol} or directly impact it
            - Suggest developments or events
            - Indicate potential stock price impact
            - Discuss future predictions or plans

            Return a JSON array of selected articles:
            {
              "selected_articles": [
                {
                  "url": "<article url>",
                  "relevance": "<one sentence explanation>"
                }
              ]
            }

            Only analyze the titles. Do not include any other text in your response.`
          },
          {
            role: "user",
            content: JSON.stringify(articleTitles)
          }
        ],
        temperature: 0.5
      });

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content);
      
      // Filter the original articles based on selected URLs
      return articles.filter(article => 
        result.selected_articles.some(selected => selected.url === article.url)
      );
    } catch (error) {
      console.error('Error selecting relevant articles:', error);
      throw error;
    }
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
            content: `You are a financial analyst expert specializing in future market predictions. Analyze these articles about ${symbol} stock and predict future outcomes.

            IMPORTANT: You must return a complete JSON object with ALL required fields for EACH timeframe.
            ALWAYS include the article's publishedAt date in the output.

            Return ONLY a JSON object in this exact format:
            {
              "7days": {
                "sentiment": <number between -100 and 100>,
                "summary": "<prediction for next 7 days>",
                "price_drivers": ["<event 1>", "<event 2>"],
                "key_articles": [
                  {
                    "title": "<exact article title>",
                    "url": "<article url>",
                    "source": "<article source>",
                    "publishedAt": "<article's publishedAt date - use exactly as provided>",
                    "predicted_impact": "<detailed impact analysis>",
                    "confidence": "high" | "medium" | "low",
                    "potential_price_effect": "<price prediction with reasoning>",
                    "detailed_analysis": "<comprehensive analysis>"
                  }
                ]
              },
              "1month": <same structure as above>,
              "3months": <same structure as above>,
              "6months": <same structure as above>
            }
            
            Requirements:
            - EVERY timeframe must have ALL fields filled out
            - Include at least 5 articles per timeframe
            - Use exact article titles, URLs, and dates from the provided data
            - Include both Yahoo Finance and NewsAPI articles
            - Ensure all text fields are properly quoted
            - Avoid trailing commas
            
            Do not include any other text or formatting in your response.`
          },
          {
            role: "user",
            content: JSON.stringify({
              articles: articles.map(article => ({
                ...article,
                // Ensure the date is passed through exactly as is
                publishedAt: article.publishedAt
              })),
              yahooFinanceCount: articles.filter(a => a.provider === 'Yahoo Finance').length,
              totalCount: articles.length
            })
          }
        ],
        temperature: 0.7
      });

      const result = this.cleanAndParseResponse(analysis.choices[0].message.content, 'analysis');

      // Log some articles to verify dates are present
      for (const timeframe of ['7days', '1month', '3months', '6months']) {
        console.log(`\nDates in ${timeframe} timeframe:`);
        result[timeframe].key_articles.forEach(article => {
          console.log(`- ${article.title}: ${article.publishedAt}`);
        });
      }

      // Validate Yahoo Finance representation
      for (const timeframe of ['7days', '1month', '3months', '6months']) {
        const timeframeArticles = result[timeframe].key_articles;
        const yahooArticlesInTimeframe = timeframeArticles.filter(a => a.source === 'Yahoo Finance');
        console.log(`${timeframe}: ${yahooArticlesInTimeframe.length} Yahoo Finance articles out of ${timeframeArticles.length} total`);
      }

      console.log('Validating analysis structure...');
      this.validateAnalysisStructure(result);
      console.log('Analysis structure validated successfully');

      return result;
    } catch (error) {
      console.error('Error in analyzeArticles:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  async findArticleDate(pageText, url) {
    try {
      const analysis = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert at finding publication dates in article text. 
            Find the most likely publication date in the provided text.
            Return ONLY a JSON object with the date in this format:
            {
              "date": "<Weekday, Month Day, Year>"
            }
            If no date is found, return null for the date value.`
          },
          {
            role: "user",
            content: `Find the publication date in this text from ${url}:\n\n${pageText}`
          }
        ],
        temperature: 0.3
      });

      return JSON.parse(analysis.choices[0].message.content);
    } catch (error) {
      console.error('Error finding article date:', error);
      return null;
    }
  }
}

module.exports = new OpenAIService(); 