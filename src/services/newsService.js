const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');
const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');

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

  async getGoogleNewsArticles(query, maxArticles = 5) {
    try {
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          q: query,
          engine: 'google',
          google_domain: 'google.com',
          gl: 'us',
          hl: 'en',
          tbm: 'nws',
          num: maxArticles * 2,
          api_key: config.serpapi.apiKey
        }
      });

      if (!response.data?.news_results) {
        return [];
      }

      // Filter and process articles
      const processedArticles = response.data.news_results
        .filter(article => {
          const text = `${article.title} ${article.snippet || ''}`.toLowerCase();
          const symbol = query.split(' ')[0].toUpperCase();
          const companyName = 'Apple';
          
          const hasSymbol = text.includes(symbol.toLowerCase()) || 
                           text.includes(`$${symbol.toLowerCase()}`);
          const hasCompanyName = text.toLowerCase().includes(companyName.toLowerCase());
          
          return (
            (hasSymbol || hasCompanyName) &&
            article.title &&
            article.link &&
            article.date &&
            !article.link.includes('youtube.com') &&
            !article.link.includes('facebook.com') &&
            !article.link.includes('twitter.com')
          );
        })
        .map(article => ({
          title: article.title,
          description: article.snippet,
          url: article.link,
          publishedAt: article.date,
          source: article.source,
          content: article.snippet,
          relevanceScore: this.calculateRelevanceScore(article, query.split(' ')[0])
        }))
        .slice(0, maxArticles);

      return processedArticles;
    } catch (error) {
      console.error('SerpAPI error:', error.message);
      return [];
    }
  }

  calculateRelevanceScore(article, symbol) {
    let score = 0;
    const text = `${article.title} ${article.description || ''} ${article.content || ''}`.toLowerCase();
    
    // Title relevance
    if (article.title.toLowerCase().includes(symbol.toLowerCase())) score += 2;
    
    // Content relevance
    const symbolCount = (text.match(new RegExp(symbol.toLowerCase(), 'g')) || []).length;
    score += Math.min(symbolCount, 3); // Cap at 3 for multiple mentions
    
    // Source credibility
    if (this.isCredibleSource(article.source)) score += 1;
    
    // Recency bonus
    const daysOld = (new Date() - new Date(article.publishedAt)) / (1000 * 60 * 60 * 24);
    if (daysOld < 1) score += 2;
    else if (daysOld < 7) score += 1;
    
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
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      }).catch(e => null);
      
      if (!response) return article;
      
      const $ = cheerio.load(response.data);
      
      // Try to extract article content
      // Common selectors for article content
      const possibleContentSelectors = [
        'article', 
        '.article-content', 
        '.article-body', 
        '.story-body',
        '.entry-content',
        '.post-content',
        '#article-body',
        '.story__content',
        '.content-body'
      ];

      let content = '';
      for (const selector of possibleContentSelectors) {
        const element = $(selector).first();
        if (element.length) {
          content = element.text().trim();
          break;
        }
      }

      // If no content found, use the original snippet
      if (!content) {
        content = article.content || article.description;
      }
      
      // Try to scrape the date
      const date = await this.scrapeArticleDate(url);
      
      return {
        ...article,
        content: content,
        publishedAt: date || article.publishedAt
      };
    } catch (error) {
      console.error('Article details error:', error.message);
      return article;
    }
  }

  /**
   * Collect news articles for a stock symbol
   * @param {string} symbol - Stock symbol
   * @param {number} maxArticles - Maximum number of articles to collect
   * @returns {Promise<Object>} Collected articles and metadata
   */
  async collectAndAnalyzeNews(symbol, maxArticles = 20) {
    try {
      const searchQueries = [
        `${symbol} stock news`,
        `${symbol} company news`,
        `${symbol} financial news`,
        `${symbol} market news`
      ];

      const queryPromises = searchQueries.map(query => 
        this.getGoogleNewsArticles(query, Math.ceil(maxArticles / searchQueries.length))
      );

      const results = await Promise.all(queryPromises);
      
      const allArticles = results.flat();
      const uniqueArticles = this.deduplicateArticles(allArticles);
      
      const sortedArticles = uniqueArticles
        .sort((a, b) => {
          const recencyDiff = new Date(b.publishedAt) - new Date(a.publishedAt);
          if (recencyDiff !== 0) return recencyDiff;
          return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        })
        .slice(0, maxArticles);

      return sortedArticles;
    } catch (error) {
      console.error('News collection error:', error.message);
      return [];
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