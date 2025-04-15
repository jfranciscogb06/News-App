const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');
const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');
const SerpApiService = require('./serpApiService');

class NewsService {
  constructor() {
    this.maxArticlesPerQuery = 10;
    // No API key needed for direct Google News search
  }

  async scrapeArticleDate(url) {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // Common date selectors in articles
      const possibleSelectors = [
        'time[datetime]',
        'time[class*="date"]',
        'span[class*="date"]',
        'div[class*="date"]',
        'p[class*="date"]',
        'meta[property="article:published_time"]',
        'meta[name="pubdate"]',
        'meta[name="date"]',
        'meta[name="article:published_time"]',
        'meta[itemprop="datePublished"]',
        '.published-date',
        '.publish-date',
        '.publication-date',
        '.article-date',
        '.timestamp',
        '.article__date',
        '.article-timestamp',
        '.Date'
      ];

      // First try with meta tags as they're usually more reliable
      for (const selector of possibleSelectors.filter(s => s.startsWith('meta'))) {
        const element = $(selector).first();
        if (element.length) {
          const dateStr = element.attr('content') || element.attr('value') || element.text();
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          }
        }
      }
      
      // Then try with other selectors
      for (const selector of possibleSelectors.filter(s => !s.startsWith('meta'))) {
        const element = $(selector).first();
        if (element.length) {
          const dateStr = element.attr('datetime') || element.text();
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          }
        }
      }

      // Try to extract dates from the content text - look for common date patterns
      const bodyText = $('body').text();
      
      // Common date patterns in article text
      const datePatterns = [
        // Standard date formats
        /published(?:\s+on)?[\s:]+([A-Z][a-z]+\s+\d{1,2},?\s+20\d{2})/i,  // Published on January 15, 2023
        /posted(?:\s+on)?[\s:]+([A-Z][a-z]+\s+\d{1,2},?\s+20\d{2})/i,     // Posted on January 15, 2023
        /date(?:\s*)?:[\s:]+([A-Z][a-z]+\s+\d{1,2},?\s+20\d{2})/i,        // Date: January 15, 2023
        /(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+,?\s+20\d{2})/i,           // 15th January, 2023
        /([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2})/i,           // January 15th, 2023
        /(\d{1,2}\s+[A-Z][a-z]+\s+20\d{2})/i,                             // 15 January 2023
        
        // ISO 8601 and similar formats
        /\b(20\d{2}-\d{2}-\d{2})\b/,                                      // 2023-01-15
        /\b(\d{2}\/\d{2}\/20\d{2})\b/,                                    // 01/15/2023
        /\b(\d{2}\.\d{2}\.20\d{2})\b/                                      // 01.15.2023
      ];
      
      for (const pattern of datePatterns) {
        const match = bodyText.match(pattern);
        if (match && match[1]) {
          const date = new Date(match[1]);
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
          }
        }
      }
      
      // If no date found, try to parse it from the URL or content
      try {
        // Look for date patterns in the URL (YYYY/MM/DD or similar)
        const urlDatePatterns = [
          /\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//,  // /2023/01/15/
          /\/(20\d{2})(\d{2})(\d{2})\//,          // /20230115/
          /-(\d{4})(\d{2})(\d{2})-/                // -20230115-
        ];
        
        for (const pattern of urlDatePatterns) {
          const match = url.match(pattern);
          if (match) {
            const [_, year, month, day] = match;
            const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          }
        }
        
        // If all else fails, check if the URL includes a timestamp
        const timestampMatch = url.match(/[?&]t=(\d+)/);
        if (timestampMatch && timestampMatch[1]) {
          const timestamp = parseInt(timestampMatch[1]);
          if (!isNaN(timestamp)) {
            const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
            if (!isNaN(date.getTime())) {
              return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            }
          }
        }
        
        // Default to current date if we can't find a date
        return new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      } catch (e) {
        console.error('Error parsing date from URL:', e);
        return new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
    } catch (error) {
      console.error(`Date scraping error for ${url}:`, error.message);
      return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  }

  async getGoogleNewsArticles(query, maxArticles = 20) {
    try {
      const serpApi = new SerpApiService(config.serpapi.apiKey);
      const articles = await serpApi.searchNews(query, maxArticles * 2);
      
      // Filter and process articles
      const processedArticles = articles
        .filter(article => {
          // Basic validation
          if (!article.title || !article.url) return false;
          
          // Skip social media sources
          if (article.url.match(/facebook\.com|twitter\.com|youtube\.com|instagram\.com|tiktok\.com/i)) {
            return false;
          }
          
          // Ensure article is in English
          if (!this.isEnglishContent(article.title)) return false;
          
          return true;
        })
        .map(article => {
          const relevanceScore = this.calculateRelevanceScore(article, query);
          return {
            ...article,
            relevanceScore
          };
        })
        .filter(article => article.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxArticles);

      console.log(`Found ${processedArticles.length} relevant articles for query: ${query}`);
      return processedArticles;
    } catch (error) {
      console.error('Error fetching news articles:', error);
      return [];
    }
  }

  isEnglishContent(text) {
    // Simple check for English content
    const nonEnglishPattern = /[\u0600-\u06FF\u0750-\u077F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1100-\u11FF\u1200-\u137F\u1380-\u139F\u13A0-\u13FF\u1400-\u167F\u1680-\u169F\u16A0-\u16FF\u1700-\u171F\u1720-\u173F\u1740-\u175F\u1760-\u177F\u1780-\u17FF\u1800-\u18AF\u1900-\u194F\u1950-\u197F\u1980-\u19DF\u19E0-\u19FF\u1A00-\u1A1F\u1A20-\u1AAF\u1B00-\u1B7F\u1B80-\u1BBF\u1BC0-\u1BFF\u1C00-\u1C4F\u1C50-\u1C7F\u1C80-\u1C8F\u1C90-\u1CBF\u1CC0-\u1CCF\u1CD0-\u1CFF\u1D00-\u1D7F\u1D80-\u1DBF\u1DC0-\u1DFF\u1E00-\u1EFF\u1F00-\u1FFF\u2000-\u206F\u2070-\u209F\u20A0-\u20CF\u20D0-\u20FF\u2100-\u214F\u2150-\u218F\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u2400-\u243F\u2440-\u245F\u2460-\u24FF\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF\u27C0-\u27EF\u27F0-\u27FF\u2800-\u28FF\u2900-\u297F\u2980-\u29FF\u2A00-\u2AFF\u2B00-\u2BFF\u2C00-\u2C5F\u2C60-\u2C7F\u2C80-\u2CFF\u2D00-\u2D2F\u2D30-\u2D7F\u2D80-\u2DDF\u2DE0-\u2DFF\u2E00-\u2E7F\u2E80-\u2EFF\u2F00-\u2FDF\u2FE0-\u2FEF\u2FF0-\u2FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u3130-\u318F\u3190-\u319F\u31A0-\u31BF\u31C0-\u31EF\u31F0-\u31FF\u3200-\u32FF\u3300-\u33FF\u3400-\u4DBF\u4DC0-\u4DFF\u4E00-\u9FFF\uA000-\uA48F\uA490-\uA4CF\uA4D0-\uA4FF\uA500-\uA63F\uA640-\uA69F\uA6A0-\uA6FF\uA700-\uA71F\uA720-\uA7FF\uA800-\uA82F\uA830-\uA83F\uA840-\uA87F\uA880-\uA8DF\uA8E0-\uA8FF\uA900-\uA92F\uA930-\uA95F\uA960-\uA97F\uA980-\uA9DF\uA9E0-\uA9FF\uAA00-\uAA5F\uAA60-\uAA7F\uAA80-\uAADF\uAAE0-\uAAFF\uAB00-\uAB2F\uAB30-\uAB6F\uAB70-\uABBF\uABC0-\uABFF\uAC00-\uD7AF\uD7B0-\uD7FF\uD800-\uDB7F\uDB80-\uDBFF\uDC00-\uDFFF\uE000-\uF8FF\uF900-\uFAFF\uFB00-\uFB4F\uFB50-\uFDFF\uFE00-\uFE0F\uFE10-\uFE1F\uFE20-\uFE2F\uFE30-\uFE4F\uFE50-\uFE6F\uFE70-\uFEFF\uFF00-\uFFEF]/;
    return !nonEnglishPattern.test(text);
  }

  calculateRelevanceScore(article, query) {
    let score = 0;
    const queryTerms = query.toLowerCase().split(/\s+/);
    const stockSymbol = queryTerms[0].toUpperCase();
    
    // Check title
    if (article.title) {
      const titleLower = article.title.toLowerCase();
      if (titleLower.includes(stockSymbol.toLowerCase())) score += 2;
      queryTerms.forEach(term => {
        if (titleLower.includes(term)) score += 1;
      });
    }
    
    // Check content
    if (article.content) {
      const contentLower = article.content.toLowerCase();
      if (contentLower.includes(stockSymbol.toLowerCase())) score += 1;
      queryTerms.forEach(term => {
        if (contentLower.includes(term)) score += 0.5;
      });
    }
    
    // Check for financial terms
    const financialTerms = ['stock', 'market', 'price', 'shares', 'trading', 'investors', 'earnings', 'revenue', 'growth', 'analyst'];
    const text = `${article.title} ${article.content}`.toLowerCase();
    financialTerms.forEach(term => {
      if (text.includes(term)) score += 0.5;
    });
    
    return score;
  }

  isCredibleSource(source) {
    const credibleSources = [
      'reuters', 'bloomberg', 'cnbc', 'yahoo finance', 'marketwatch',
      'financial times', 'wall street journal', 'forbes', 'business insider'
    ];
    
    return credibleSources.some(credible => 
      source.toLowerCase().includes(credible)
    );
  }

  deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
      const key = article.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async getArticleDetails(url, article) {
    try {
      // First validate the source
      const validatedArticle = await sourceValidationService.validateArticleSource(article);
      
      // Get the article content from the description or snippet
      const articleContent = article.description || article.content || article.snippet || '';
      
      // Only generate a summary if we have content to summarize
      let summary = articleContent;
      if (articleContent && articleContent.length > 0) {
        try {
          summary = await openaiService.generateSummary(article.title, articleContent);
        } catch (summaryError) {
          console.error('Error generating summary:', summaryError);
          // Keep the original content if summary generation fails
        }
      }

      return {
        ...validatedArticle,
        content: summary,
        description: articleContent, // Keep the original description
        url: url || article.url || article.link,
        publishedAt: article.publishedAt || await this.scrapeArticleDate(url),
        relevanceScore: this.calculateRelevanceScore(article, article.title)
      };
    } catch (error) {
      console.error('Error getting article details:', error);
      return {
        ...article,
        content: article.description || article.content || article.snippet || article.title,
        description: article.description || article.content || article.snippet || '',
        url: url || article.url || article.link,
        publishedAt: article.publishedAt || await this.scrapeArticleDate(url),
        relevanceScore: this.calculateRelevanceScore(article, article.title)
      };
    }
  }

  /**
   * Collect news articles for a stock symbol
   * @param {string} symbol - Stock symbol
   * @param {number} maxArticles - Maximum number of articles to collect
   * @param {string} analysisDate - Optional analysis date for historical analysis
   * @param {string} ignoreAfter - Optional date to ignore articles after
   * @returns {Promise<Object>} Collected articles and metadata
   */
  async collectAndAnalyzeNews(symbol, maxArticles = 20, analysisDate = null, ignoreAfter = null) {
    try {
      console.log(`Collecting news for symbol: ${symbol}`);
      
      // Define search queries
      const queries = [
        `${symbol} earnings`,
        `${symbol} stock news`,
        `${symbol} stock price`,
        `${symbol} financial results`
      ];
      
      console.log(`Executing ${queries.length} search queries in parallel...`);
      
      // Execute all queries in parallel
      const allResults = await Promise.all(
        queries.map(query => this.getGoogleNewsArticles(query, maxArticles))
      );
      
      console.log('Received results from all queries');
      
      // Combine and deduplicate results
      let articles = [];
      allResults.forEach((result, index) => {
        if (result && result.length > 0) {
          console.log(`Found ${result.length} relevant articles for query: ${queries[index]}`);
          articles.push(...result);
        }
      });
      
      // Remove duplicates
      articles = this.deduplicateArticles(articles);
      console.log(`Total articles before filtering: ${articles.length}`);
      
      // Filter by date if specified
      if (analysisDate || ignoreAfter) {
        articles = articles.filter(article => {
          const pubDate = new Date(article.publishedAt);
          if (analysisDate && pubDate < new Date(analysisDate)) return false;
          if (ignoreAfter && pubDate > new Date(ignoreAfter)) return false;
          return true;
        });
      }
      
      // Process articles in parallel with error handling
      const processedArticles = await Promise.all(
        articles.map(async article => {
          try {
            // Skip article detail fetching for problematic sources
            const skipDetailFetch = [
              'investing.com',
              'reuters.com',
              'barrons.com',
              'tipranks.com',
              'valuewalk.com',
              'investors.com'
            ].some(domain => article.url?.includes(domain));
            
            if (skipDetailFetch) {
              return {
                ...article,
                content: article.description || article.snippet || '',
                source: article.source || { name: new URL(article.url).hostname }
              };
            }
            
            const details = await this.getArticleDetails(article.url, article);
            return details || article;
          } catch (error) {
            // If fetching details fails, return the original article
            return article;
          }
        })
      );
      
      // Filter out articles without content
      const validArticles = processedArticles.filter(article => 
        article && (article.content || article.description || article.snippet)
      );
      
      if (validArticles.length === 0) {
        throw new Error('No valid articles found after processing');
      }
      
      return validArticles;
    } catch (error) {
      console.log('News collection error:', error.message);
      throw error;
    }
  }

  /**
   * Organize articles by timeframe
   * @param {Array} articles - Array of articles to organize
   * @returns {Object} Articles organized by timeframe
   */
  organizeArticlesByTimeframe(articles) {
    const timeframeGroups = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };

    articles.forEach(article => {
      const daysSincePublished = article.daysSincePublished || 0;
      
      if (daysSincePublished < 7) {
        timeframeGroups['7days'].push(article);
      }
      if (daysSincePublished < 30) {
        timeframeGroups['1month'].push(article);
      }
      if (daysSincePublished < 90) {
        timeframeGroups['3months'].push(article);
      }
      if (daysSincePublished < 180) {
        timeframeGroups['6months'].push(article);
      }
    });

    return timeframeGroups;
  }

  // Add metadata to articles for better filtering and analysis
  preprocessArticles(articles) {
    // Define future-oriented terms and outcome timing indicators
    const futureTerms = [
      'will', 'going to', 'expect', 'anticipate', 'forecast', 'guidance', 
      'outlook', 'target', 'prediction', 'projected', 'future', 'upcoming',
      'next quarter', 'next year', 'planning', 'roadmap', 'pipeline'
    ];

    const outcomeTimingTerms = {
      immediate: ['today', 'tomorrow', 'this week', 'next week', 'immediately', 'shortly', 'soon'],
      nearTerm: ['next month', 'coming weeks', 'in the coming days', 'in the near future', 'short-term'],
      midTerm: ['next quarter', 'upcoming quarter', 'in the coming months', 'mid-term', 'medium-term'],
      longTerm: ['next year', 'long-term', 'longer-term', 'strategic', 'roadmap', 'pipeline']
    };

    return articles.map(article => {
      const textContent = (article.title + ' ' + article.description).toLowerCase();
      
      // Check for future-oriented terms
      const hasFutureTerms = futureTerms.some(term => textContent.includes(term));
      
      // Determine outcome timing based on content
      const outcomeTiming = {
        immediate: outcomeTimingTerms.immediate.some(term => textContent.includes(term)),
        nearTerm: outcomeTimingTerms.nearTerm.some(term => textContent.includes(term)),
        midTerm: outcomeTimingTerms.midTerm.some(term => textContent.includes(term)),
        longTerm: outcomeTimingTerms.longTerm.some(term => textContent.includes(term))
      };

      // Calculate timeframe relevance based on outcome timing
      const timeframeRelevance = {
        '7days': outcomeTiming.immediate ? 5 : (outcomeTiming.nearTerm ? 3 : 0),
        '1month': outcomeTiming.nearTerm ? 5 : (outcomeTiming.immediate ? 3 : 0),
        '3months': outcomeTiming.midTerm ? 5 : (outcomeTiming.nearTerm ? 3 : 0),
        '6months': outcomeTiming.longTerm ? 5 : (outcomeTiming.midTerm ? 3 : 0)
      };

      // Add future impact score based on content
      const futureImpactScore = hasFutureTerms ? 2 : 0;
      
      // Add outcome timing information
      const outcomeTimingInfo = {
        immediate: outcomeTiming.immediate,
        nearTerm: outcomeTiming.nearTerm,
        midTerm: outcomeTiming.midTerm,
        longTerm: outcomeTiming.longTerm
      };

      return {
        ...article,
        hasFutureTerms,
        outcomeTimingInfo,
        timeframeRelevance,
        futureImpactScore,
        // Add a text snippet for OpenAI analysis
        snippet: article.title + '. ' + article.description
      };
    });
  }

  // Assess which timeframes an article is most relevant for
  assessTimeframeRelevance(publishedDate, text, queryTimeframeHint, timeframeRecency) {
    const lowerText = text.toLowerCase();
    const daysSincePublished = Math.floor((new Date() - publishedDate) / (1000 * 60 * 60 * 24));
    
    // Initialize relevance scores for each timeframe
    const relevance = {
      '7days': 0,
      '1month': 0,
      '3months': 0,
      '6months': 0
    };
    
    // Incorporate timeframeRecency if available
    if (timeframeRecency) {
      for (const timeframe in relevance) {
        if (timeframeRecency[timeframe]) {
          relevance[timeframe] += timeframeRecency[timeframe];
        }
      }
    } else {
      // Legacy recency calculation if timeframeRecency not available
      if (daysSincePublished < 3) {
        relevance['7days'] += 3;
        relevance['1month'] += 1;
      } else if (daysSincePublished < 7) {
        relevance['7days'] += 2;
        relevance['1month'] += 2;
      } else if (daysSincePublished < 30) {
        relevance['7days'] += 1;
        relevance['1month'] += 3;
        relevance['3months'] += 1;
      } else {
        relevance['3months'] += 2;
        relevance['6months'] += 2;
      }
    }
    
    // Boost based on timeframe keywords
    const timeframeKeywords = {
      '7days': ['today', 'yesterday', 'this week', 'next week', 'current week', 'days', 'short term', 'immediate'],
      '1month': ['this month', 'next month', 'monthly', 'coming weeks', 'few weeks', 'short term'],
      '3months': ['quarter', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'months', 'mid term', 'medium term'],
      '6months': ['long term', 'year', 'yearly', 'annual', 'future', 'roadmap', 'outlook', 'strategic', 'fiscal year']
    };
    
    // Check for timeframe keywords in text
    for (const [timeframe, keywords] of Object.entries(timeframeKeywords)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          relevance[timeframe] += 2;
        }
      }
    }
    
    // Boost from the query's timeframe hint
    if (queryTimeframeHint && queryTimeframeHint !== 'general') {
      relevance[queryTimeframeHint] += 3;
    }
    
    return relevance;
  }

  calculateTimeframeRecency(publishedDate) {
    const now = new Date();
    const daysSincePublished = Math.floor((now - publishedDate) / (1000 * 60 * 60 * 24));
    
    // Super recent articles (0-3 days)
    if (daysSincePublished < 3) {
      return { 
        '7days': 5,    // Highest relevance for 7-day predictions
        '1month': 4,   // Very high relevance for 1-month
        '3months': 3,  // High relevance for 3-months
        '6months': 2   // Moderate relevance for 6-months
      };
    } 
    // Very recent articles (4-7 days)
    else if (daysSincePublished < 7) {
      return { 
        '7days': 4,    // High relevance for 7-day predictions
        '1month': 4,   // High relevance for 1-month
        '3months': 3,  // Good relevance for 3-months
        '6months': 2   // Moderate relevance for 6-months
      };
    } 
    // Recent articles (8-14 days)
    else if (daysSincePublished < 14) {
      return { 
        '7days': 3,    // Good relevance for 7-day predictions
        '1month': 4,   // High relevance for 1-month
        '3months': 3,  // Good relevance for 3-months
        '6months': 2   // Moderate relevance for 6-months
      };
    } 
    // Moderately recent (15-30 days)
    else if (daysSincePublished < 30) {
      return { 
        '7days': 1,    // Low relevance for 7-day predictions
        '1month': 4,   // High relevance for 1-month
        '3months': 3,  // Good relevance for 3-months
        '6months': 2   // Moderate relevance for 6-months
      };
    } 
    // Getting older (31-90 days)
    else if (daysSincePublished < 90) {
      return { 
        '7days': 0,    // Not relevant for 7-day predictions
        '1month': 2,   // Low relevance for 1-month
        '3months': 4,  // High relevance for 3-months
        '6months': 3   // Good relevance for 6-months
      };
    } 
    // Older articles (91-180 days)
    else if (daysSincePublished < 180) {
      return { 
        '7days': 0,    // Not relevant for 7-day predictions
        '1month': 0,   // Not relevant for 1-month
        '3months': 2,  // Low relevance for 3-months
        '6months': 4   // High relevance for 6-months
      };
    }
    // Very old articles (>180 days) - these should be filtered out entirely
    else {
      return { 
        '7days': 0,
        '1month': 0,
        '3months': 0,
        '6months': 0
      };
    }
  }

  // New method to score articles based on informational value
  scoreArticlesByInformationalValue(articles) {
    return articles.map(article => {
      let score = 0;
      const text = (article.title + ' ' + article.description).toLowerCase();
      
      // 1. Length and Structure (up to 20 points)
      const wordCount = text.split(/\s+/).length;
      if (wordCount > 500) score += 20;
      else if (wordCount > 300) score += 15;
      else if (wordCount > 150) score += 10;
      else score += 5;
      
      // 2. Data and Statistics (up to 15 points)
      const hasNumbers = /\d+/.test(text);
      const hasPercentages = /\d+%/.test(text);
      const hasFinancialTerms = /(revenue|earnings|profit|loss|margin|growth|decline)/i.test(text);
      if (hasNumbers && hasPercentages && hasFinancialTerms) score += 15;
      else if (hasNumbers && (hasPercentages || hasFinancialTerms)) score += 10;
      else if (hasNumbers) score += 5;
      
      // 3. Analysis Depth (up to 15 points)
      const hasAnalysis = /(analysis|report|study|research|survey|data|findings)/i.test(text);
      const hasComparisons = /(compared|versus|versus|vs\.|versus)/i.test(text);
      const hasContext = /(context|background|history|overview|summary)/i.test(text);
      if (hasAnalysis && hasComparisons && hasContext) score += 15;
      else if (hasAnalysis && (hasComparisons || hasContext)) score += 10;
      else if (hasAnalysis) score += 5;
      
      // 4. Source Quality (up to 10 points)
      if (article.credibilityScore && article.credibilityScore.score) {
        score += Math.min(10, article.credibilityScore.score / 10);
      }
      
      // 5. Recency (up to 10 points)
      if (article.isRecent) score += 10;
      else if (article.daysSincePublished < 7) score += 7;
      else if (article.daysSincePublished < 14) score += 5;
      else if (article.daysSincePublished < 30) score += 3;
      
      // 6. Future Outlook (up to 10 points)
      if (article.hasFutureTerms) score += 10;
      else if (text.includes('forecast') || text.includes('outlook')) score += 5;
      
      // 7. Expert Opinions (up to 10 points)
      const hasExpertQuotes = /(said|stated|reported|announced|confirmed|revealed)/i.test(text);
      const hasExpertSources = /(analyst|expert|researcher|economist|strategist|manager|ceo)/i.test(text);
      if (hasExpertQuotes && hasExpertSources) score += 10;
      else if (hasExpertQuotes || hasExpertSources) score += 5;
      
      // 8. Market Impact (up to 5 points)
      if (text.includes('market impact') || text.includes('stock price') || text.includes('trading')) {
        score += 5;
      }
      
      return {
        ...article,
        informationalScore: score
      };
    });
  }
}

module.exports = new NewsService(); 