const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');
const openaiService = require('./openaiService');
const sourceValidationService = require('./sourceValidationService');

class NewsService {
  constructor() {
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
      console.error(`Error scraping date from ${url}:`, error);
      return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  }

  async getGoogleNewsArticles(symbol) {
    try {
      console.log('Fetching Google news articles...');
      
      // Define search queries for different types of news with timeframe context
      const queries = [
        // Short-term (7-day) focused queries
        { query: `${symbol} stock price movement this week`, timeframe: '7days' },
        { query: `${symbol} stock recent news`, timeframe: '7days' },
        { query: `${symbol} stock price target update`, timeframe: '7days' },
        { query: `${symbol} earnings this week`, timeframe: '7days' },
        { query: `${symbol} short term outlook`, timeframe: '7days' },
        
        // Medium-term (1-month) focused queries
        { query: `${symbol} stock monthly outlook`, timeframe: '1month' },
        { query: `${symbol} upcoming product release`, timeframe: '1month' },
        { query: `${symbol} next earnings date`, timeframe: '1month' },
        { query: `${symbol} stock monthly forecast`, timeframe: '1month' },
        
        // 3-month focused queries
        { query: `${symbol} quarterly outlook`, timeframe: '3months' },
        { query: `${symbol} quarterly forecast`, timeframe: '3months' },
        { query: `${symbol} revenue projections`, timeframe: '3months' },
        { query: `${symbol} business expansion plans`, timeframe: '3months' },
        
        // Long-term (6-month) focused queries
        { query: `${symbol} long term forecast`, timeframe: '6months' },
        { query: `${symbol} strategic plans`, timeframe: '6months' },
        { query: `${symbol} market position`, timeframe: '6months' },
        { query: `${symbol} industry trends`, timeframe: '6months' },
        { query: `${symbol} competition analysis`, timeframe: '6months' },
        
        // General queries (might apply to any timeframe)
        { query: `${symbol} stock news analysis`, timeframe: 'general' },
        { query: `${symbol} stock forecast future`, timeframe: 'general' },
        { query: `${symbol} analyst rating upgrade downgrade`, timeframe: 'general' },
        { query: `${symbol} earnings report`, timeframe: 'general' },
        { query: `${symbol} market trend`, timeframe: 'general' },
        { query: `${symbol} CEO interview announcement`, timeframe: 'general' },
        { query: `${symbol} merger acquisition partnership`, timeframe: 'general' }
      ];
      
      // Get dates for the query date range (last 12 months)
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      
      // Format dates for Google News query: YYYY-MM-DD
      const afterDate = oneYearAgo.toISOString().split('T')[0];
      const beforeDate = today.toISOString().split('T')[0];
      const dateRangeParam = `&after=${afterDate}&before=${beforeDate}`;
      
      // Execute all queries in parallel
      const searchResults = await Promise.all(
        queries.map(async (queryObj) => {
          try {
            // Use direct Google search with cheerio scraping
            const encodedQuery = encodeURIComponent(queryObj.query);
            const url = `https://news.google.com/rss/search?q=${encodedQuery}${dateRangeParam}&hl=en-US&gl=US&ceid=US:en`;
            
            const response = await axios.get(url);
            const $ = cheerio.load(response.data, { xmlMode: true });
            
            const articles = [];
            $('item').each((i, item) => {
              const $item = $(item);
              const title = $item.find('title').text();
              const link = $item.find('link').text();
              const pubDate = $item.find('pubDate').text();
              const description = $item.find('description').text();
              const source = $item.find('source').text() || 'Google News';
              // Extract any additional fields available
              const guid = $item.find('guid').text();
              const categories = [];
              $item.find('category').each((i, cat) => categories.push($(cat).text()));
              
              if (title && link) {
                articles.push({
                  title,
                  link,
                  pubDate,
                  description,
                  source,
                  guid: guid || link,
                  categories: categories.length > 0 ? categories : [],
                  queryContext: queryObj.query,
                  timeframeHint: queryObj.timeframe // Tag the article with timeframe hint
                });
              }
            });
            
            return articles;
          } catch (error) {
            console.error(`Error in Google News search for query "${queryObj.query}":`, error.message);
            return [];
          }
        })
      );
      
      // Flatten the results and transform to a common format
      const uniqueUrls = new Set();
      const articles = searchResults
        .flat()
        .filter(item => {
          if (!item || !item.link || uniqueUrls.has(item.link)) return false;
          uniqueUrls.add(item.link);
          return true;
        })
        .map(item => {
          // Parse date if available, otherwise use current date
          let publishedDate;
          try {
            if (item.pubDate) {
              publishedDate = new Date(item.pubDate);
              if (isNaN(publishedDate.getTime())) {
                publishedDate = new Date();
              }
            } else {
              publishedDate = new Date();
            }
          } catch (e) {
            publishedDate = new Date();
          }
          
          // Format the published date as a string
          const publishedAtStr = publishedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          
          // Calculate recency and assign appropriate timeframe relevance
          const daysSincePublished = Math.floor((new Date() - publishedDate) / (1000 * 60 * 60 * 24));
          
          // Extract text from HTML description
          let cleanDescription = '';
          try {
            const $ = cheerio.load(item.description);
            cleanDescription = $('body').text();
          } catch (e) {
            cleanDescription = item.description || '';
          }
          
          return {
            title: item.title || '',
            description: cleanDescription,
            url: item.link,
            publishedAt: publishedAtStr,
            publishedDate: publishedDate, // Keep the date object for sorting
            pubDate: item.pubDate, // Preserve original date string
            source: item.source || 'Google News',
            provider: 'Google News',
            content: cleanDescription,
            isRecent: (daysSincePublished < 7),
            daysSincePublished,
            hasFutureTerms: this.checkForFutureTerms(item.title + ' ' + (cleanDescription || '')),
            categories: item.categories || [],
            queryContext: item.queryContext || 'general',
            timeframeHint: item.timeframeHint || 'general', // Preserve the timeframe hint
            timeframeRelevance: this.assessTimeframeRelevance(
              publishedDate, 
              item.title + ' ' + cleanDescription, 
              item.timeframeHint,
              this.calculateTimeframeRecency(publishedDate)
            ),
            relevanceScore: 0 // Will be updated during filtering
          };
        })
        // Sort by date (most recent first) and then by relevance within each date
        .sort((a, b) => b.publishedDate - a.publishedDate);

      console.log(`Found ${articles.length} Google news articles`);
      
      // Apply automatic filtering based on relevance criteria
      const filteredArticles = this.filterArticlesByKeywords(symbol, articles);
      console.log(`Filtered to ${filteredArticles.length} relevant articles using keyword matching`);
      
      return filteredArticles;
    } catch (error) {
      console.error('Error fetching Google news articles:', error);
      return [];
    }
  }

  filterArticlesByKeywords(symbol, articles) {
    // Define relevance keywords and their weights
    const relevanceKeywords = {
      // Stock symbol itself is highest priority
      [symbol.toLowerCase()]: 10,
      
      // Stock market terms
      'stock': 5, 
      'price': 5, 
      'shares': 4, 
      'market': 3, 
      'trading': 3,
      
      // Financial performance
      'earnings': 6, 
      'revenue': 6, 
      'profit': 5, 
      'growth': 4,
      'loss': 5,
      'margin': 4,
      
      // Future outlook
      'forecast': 7, 
      'prediction': 7, 
      'outlook': 7, 
      'guidance': 7,
      'future': 6, 
      'upcoming': 6, 
      'planned': 6, 
      'expected': 5,
      
      // Product/business development
      'launch': 6, 
      'release': 6, 
      'announce': 5, 
      'unveil': 5,
      'new product': 6, 
      'technology': 4, 
      'innovation': 5,
      
      // Corporate actions
      'partnership': 7, 
      'acquisition': 8, 
      'merger': 8,
      'spinoff': 8,
      'restructuring': 7,
      'layoffs': 6,
      
      // Reporting
      'quarterly': 5, 
      'annual': 5, 
      'report': 4,
      'fiscal': 4,
      'results': 5,
      
      // Leadership and management
      'ceo': 6, 
      'executive': 5, 
      'management': 4,
      'leadership': 5,
      'board': 4,
      
      // Market sentiment
      'investor': 4, 
      'shareholder': 4, 
      'analyst': 5,
      'rating': 6, 
      'upgrade': 7, 
      'downgrade': 7, 
      'target': 6,
      'recommendation': 6,
      'buy': 5,
      'sell': 5,
      'hold': 4,
      
      // Negative factors
      'investigation': 7,
      'lawsuit': 7,
      'litigation': 7,
      'scandal': 8,
      'recall': 7,
      'fine': 6,
      'regulatory': 5,
      'compliance': 4,
      
      // Timeframe specific terms
      'short term': 6,
      'medium term': 6,
      'long term': 6,
      'next week': 7,
      'next month': 7,
      'next quarter': 7,
      'next year': 7
    };
    
    // Essential keywords - at least one must be present
    const essentialKeywords = [symbol.toLowerCase(), 'stock', 'share', 'price', 'market', 'trading', 'earnings'];
    
    // Define date thresholds for different timeframes
    const now = new Date();
    
    // Strict timeframe thresholds (stricter than before)
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(now.getMonth() - 1);
    
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(now.getDate() - 14);
    
    // Log article age distribution before filtering
    const ageGroups = {
      recent: 0,      // < 2 weeks
      moderate: 0,    // 2 weeks - 1 month 
      older: 0,       // 1-3 months
      historical: 0   // 3-6 months
    };
    
    articles.forEach(article => {
      let pubDate;
      try {
        if (article.publishedDate && article.publishedDate instanceof Date) {
          pubDate = article.publishedDate;
        } else if (article.pubDate) {
          pubDate = new Date(article.pubDate);
        } else if (article.publishedAt) {
          // Try to parse from the string format
          const dateMatch = article.publishedAt.match(/(\w+, )?(\w+ \d{1,2}, \d{4})/);
          if (dateMatch && dateMatch[2]) {
            pubDate = new Date(dateMatch[2]);
          }
        }
        
        if (pubDate && !isNaN(pubDate.getTime())) {
          if (pubDate > twoWeeksAgo) {
            ageGroups.recent++;
          } else if (pubDate > oneMonthAgo) {
            ageGroups.moderate++;
          } else if (pubDate > threeMonthsAgo) {
            ageGroups.older++;
          } else if (pubDate > sixMonthsAgo) {
            ageGroups.historical++;
          }
        }
      } catch (e) {
        console.error('Error parsing date:', e);
      }
    });
    
    console.log(`Article age distribution: Recent: ${ageGroups.recent}, Moderate: ${ageGroups.moderate}, Older: ${ageGroups.older}, Historical: ${ageGroups.historical}`);
    
    // Filter articles - remove anything older than 6 months
    let filteredArticles = articles.filter(article => {
      let pubDate;
      if (article.publishedDate && article.publishedDate instanceof Date) {
        pubDate = article.publishedDate;
      } else if (article.pubDate) {
        pubDate = new Date(article.pubDate);
      } else if (article.publishedAt) {
        const dateMatch = article.publishedAt.match(/(\w+, )?(\w+ \d{1,2}, \d{4})/);
        if (dateMatch && dateMatch[2]) {
          pubDate = new Date(dateMatch[2]);
        }
      }
      
      // Filter out articles older than 6 months
      if (pubDate && !isNaN(pubDate.getTime()) && pubDate < sixMonthsAgo) {
        return false;
      }
      
      return true;
    });
    
    // Process articles and calculate relevance scores
    const scoredArticles = filteredArticles.map(article => {
      const combinedText = (article.title + ' ' + article.description).toLowerCase();
      
      // Article must contain the stock symbol to be considered
      if (!combinedText.includes(symbol.toLowerCase())) {
        return { ...article, relevanceScore: 0, timeframeScores: {} };
      }
      
      // At least one essential keyword must be present
      const hasEssentialKeyword = essentialKeywords.some(word => combinedText.includes(word));
      if (!hasEssentialKeyword) {
        return { ...article, relevanceScore: 0, timeframeScores: {} };
      }
      
      // Calculate relevance score based on keyword matches and weights
      let relevanceScore = 0;
      for (const [keyword, weight] of Object.entries(relevanceKeywords)) {
        if (combinedText.includes(keyword)) {
          relevanceScore += weight;
          
          // Bonus points for keywords in the title (more prominent)
          if (article.title.toLowerCase().includes(keyword)) {
            relevanceScore += weight * 0.5; // 50% bonus for title matches
          }
        }
      }
      
      // Boost score for recent articles
      if (article.isRecent) {
        relevanceScore *= 1.25; // 25% boost for recent articles
      }
      
      // Boost score for articles with future terms
      if (article.hasFutureTerms) {
        relevanceScore *= 1.5; // 50% boost for articles mentioning future events
      }
      
      // Apply query context boosts
      if (article.queryContext) {
        // Articles from more specific queries get higher scores
        if (article.queryContext.includes('earnings')) relevanceScore *= 1.3;
        if (article.queryContext.includes('forecast') || article.queryContext.includes('future')) relevanceScore *= 1.3;
        if (article.queryContext.includes('analyst')) relevanceScore *= 1.2;
        if (article.queryContext.includes('merger') || article.queryContext.includes('acquisition')) relevanceScore *= 1.3;
      }
      
      // Determine publication date for timeframe relevance
      let pubDate;
      if (article.publishedDate && article.publishedDate instanceof Date) {
        pubDate = article.publishedDate;
      } else if (article.pubDate) {
        pubDate = new Date(article.pubDate);
      } else if (article.publishedAt) {
        const dateMatch = article.publishedAt.match(/(\w+, )?(\w+ \d{1,2}, \d{4})/);
        if (dateMatch && dateMatch[2]) {
          pubDate = new Date(dateMatch[2]);
        }
      } else {
        pubDate = new Date(); // Default to now if no date found
      }
      
      // Calculate separate scores for each timeframe using the timeframe relevance
      // Apply timeframe-specific recency boosts
      const timeframeScores = {};
      
      // Base score from content relevance
      if (article.timeframeRelevance) {
        for (const [timeframe, score] of Object.entries(article.timeframeRelevance)) {
          timeframeScores[timeframe] = relevanceScore * (1 + score * 0.1); // Boost by 10% per relevance point
        }
      } else {
        // If no timeframe relevance data, use the same score for all timeframes
        timeframeScores['7days'] = relevanceScore;
        timeframeScores['1month'] = relevanceScore;
        timeframeScores['3months'] = relevanceScore;
        timeframeScores['6months'] = relevanceScore;
      }
      
      // Apply timeframe-specific recency boosts based on publication date
      if (pubDate && !isNaN(pubDate.getTime())) {
        // 7-day forecasts: strong boost for very recent articles (0-14 days)
        if (pubDate > twoWeeksAgo) {
          timeframeScores['7days'] *= 2.0; // Double score for very recent articles
        } else {
          timeframeScores['7days'] *= 0.5; // Halve score for older articles
        }
        
        // 1-month forecasts: boost for articles under 1 month
        if (pubDate > oneMonthAgo) {
          timeframeScores['1month'] *= 1.5; // 50% boost for recent articles
        } else {
          timeframeScores['1month'] *= 0.8; // Slight penalty for older articles
        }
        
        // 3-month forecasts: boost for articles under 3 months
        if (pubDate > threeMonthsAgo) {
          timeframeScores['3months'] *= 1.3; // 30% boost for recent articles
        }
        
        // 6-month forecasts: slight boost for recent articles, but all are relevant
        if (pubDate > threeMonthsAgo) {
          timeframeScores['6months'] *= 1.1; // 10% boost for recent articles
        }
      }
      
      return { 
        ...article, 
        relevanceScore,
        timeframeScores,
        pubDate // Keep the parsed date for further processing
      };
    });
    
    // Filter out low relevance articles
    const relevantArticles = scoredArticles
      .filter(article => article.relevanceScore > 15) // Keep only articles with significant relevance
      .sort((a, b) => b.relevanceScore - a.relevanceScore); // Sort by relevance score
    
    // Group articles by timeframe to ensure we have sufficient coverage for each period
    const timeframeGroups = {
      '7days': [],
      '1month': [],
      '3months': [],
      '6months': []
    };
    
    // Assign each article to the timeframe(s) where it has the highest score
    // An article can belong to multiple timeframes if it's relevant to multiple periods
    for (const article of relevantArticles) {
      const scores = article.timeframeScores || {};
      
      // Find the highest score
      const maxScore = Math.max(...Object.values(scores));
      
      // Assign to all timeframes where the score is at least 90% of the max
      for (const [timeframe, score] of Object.entries(scores)) {
        if (score >= maxScore * 0.9) {
          timeframeGroups[timeframe].push({
            ...article,
            timeframeScore: score
          });
        }
      }
    }
    
    // Sort each timeframe group by its specific score
    for (const timeframe in timeframeGroups) {
      timeframeGroups[timeframe].sort((a, b) => b.timeframeScore - a.timeframeScore);
    }
    
    console.log(`Timeframe coverage: 7 days: ${timeframeGroups['7days'].length}, 1 month: ${timeframeGroups['1month'].length}, 3 months: ${timeframeGroups['3months'].length}, 6 months: ${timeframeGroups['6months'].length}`);
    
    // Return the merged list, preserving the overall relevance ordering
    return relevantArticles;
  }

  checkForFutureTerms(text) {
    const futureTerms = [
      'will', 'future', 'upcoming', 'planned', 'expected', 'forecast',
      'launch', 'release', 'announce', 'roadmap', 'guidance', 'outlook',
      'anticipate', 'predict', 'projection', 'estimate', 'target',
      'next quarter', 'next year', 'pipeline', 'development', 'beta',
      'prototype', 'testing', 'trial'
    ];
    const lowerText = text.toLowerCase();
    return futureTerms.some(term => lowerText.includes(term));
  }

  async getArticleDetails(url, article) {
    try {
      // Try to scrape the content directly
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
      console.error('Error fetching article details:', error);
      return article;
    }
  }

  // Process all Google News articles obtained from queries
  async collectAndAnalyzeNews(symbol, maxArticles = 50) {
    try {
      console.log(`Collecting news for ${symbol}...`);
      let articles = await this.getGoogleNewsArticles(symbol);
      
      // Pre-process articles to add extra metadata
      articles = this.preprocessArticles(articles);
      
      // Apply keyword filtering
      articles = this.filterArticlesByKeywords(symbol, articles);
      
      console.log(`Found ${articles.length} relevant articles after keyword filtering`);
      
      // Apply source validation to filter out unreliable or heavily biased sources
      articles = sourceValidationService.filterArticlesByCredibility(articles, {
        minCredibilityScore: 50,        // Only keep articles with at least moderate credibility
        excludeOpinions: false,         // Include opinion pieces (can be useful for sentiment)
        maxSensationalism: 'moderate',  // Filter out highly sensationalist articles
        balanceBias: true               // Try to maintain political balance in sources
      });
      
      console.log(`Filtered to ${articles.length} articles after credibility validation`);
      
      // Score articles based on informational value
      articles = this.scoreArticlesByInformationalValue(articles);
      
      // Sort by informational score and limit to maxArticles
      articles = articles
        .sort((a, b) => b.informationalScore - a.informationalScore)
        .slice(0, maxArticles);
      
      console.log(`Selected ${articles.length} most informative articles for analysis`);
      
      // Process each article to get full content if needed
      const processedArticles = await Promise.all(
        articles.map(async (article) => {
          return {
            ...article,
            content: article.description, // Use description as content
          };
        })
      );
      
      return {
        articles: processedArticles,
        count: processedArticles.length
      };
    } catch (error) {
      console.error('Error collecting and analyzing news:', error);
      throw error;
    }
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
      immediate: [
        'today', 'tomorrow', 'this week', 'next week', 'immediately', 'shortly', 'soon',
        'imminent', 'within days', 'urgent', 'breaking', 'just announced',
        'effective immediately', 'starting now', 'instant effect'
      ],
      nearTerm: [
        'next month', 'coming weeks', 'in the coming days', 'in the near future', 'short-term',
        'within weeks', '30 days', 'month ahead', 'near horizon', 'upcoming month',
        'weeks away', 'approaching deadline', 'near-term impact'
      ],
      midTerm: [
        'next quarter', 'upcoming quarter', 'in the coming months', 'mid-term', 'medium-term',
        'quarterly outlook', 'Q1 target', 'Q2 target', 'Q3 target', 'Q4 target',
        '90-day plan', 'three months', 'quarter-end goal', 'seasonal impact'
      ],
      longTerm: [
        'next year', 'long-term', 'longer-term', 'strategic', 'roadmap', 'pipeline',
        'annual target', 'fiscal year', 'multi-year', 'future vision', '12-month outlook',
        'long-range plan', 'strategic initiative', 'extended timeline', 'year-end goal'
      ]
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

      // Calculate timing confidence based on specificity and multiple indicators
      const timingConfidence = {
        immediate: this.calculateTimingConfidence(textContent, outcomeTimingTerms.immediate),
        nearTerm: this.calculateTimingConfidence(textContent, outcomeTimingTerms.nearTerm),
        midTerm: this.calculateTimingConfidence(textContent, outcomeTimingTerms.midTerm),
        longTerm: this.calculateTimingConfidence(textContent, outcomeTimingTerms.longTerm)
      };

      // Determine primary outcome timing (the one with highest confidence)
      const primaryTiming = Object.entries(timingConfidence)
        .reduce((a, b) => a[1] > b[1] ? a : b)[0];

      // Calculate timeframe relevance based on outcome timing and confidence
      const timeframeRelevance = {
        '7days': outcomeTiming.immediate ? 5 * timingConfidence.immediate : 
                (outcomeTiming.nearTerm ? 3 * timingConfidence.nearTerm : 0),
        '1month': outcomeTiming.nearTerm ? 5 * timingConfidence.nearTerm : 
                 (outcomeTiming.immediate ? 3 * timingConfidence.immediate : 0),
        '3months': outcomeTiming.midTerm ? 5 * timingConfidence.midTerm : 
                  (outcomeTiming.nearTerm ? 3 * timingConfidence.nearTerm : 0),
        '6months': outcomeTiming.longTerm ? 5 * timingConfidence.longTerm : 
                  (outcomeTiming.midTerm ? 3 * timingConfidence.midTerm : 0)
      };

      // Add future impact score based on content and timing confidence
      const futureImpactScore = hasFutureTerms ? 
        2 * Math.max(timingConfidence.nearTerm, timingConfidence.midTerm, timingConfidence.longTerm) : 0;
      
      // Add outcome timing information with confidence levels
      const outcomeTimingInfo = {
        immediate: {
          hasIndicators: outcomeTiming.immediate,
          confidence: timingConfidence.immediate,
          terms: outcomeTimingTerms.immediate.filter(term => textContent.includes(term))
        },
        nearTerm: {
          hasIndicators: outcomeTiming.nearTerm,
          confidence: timingConfidence.nearTerm,
          terms: outcomeTimingTerms.nearTerm.filter(term => textContent.includes(term))
        },
        midTerm: {
          hasIndicators: outcomeTiming.midTerm,
          confidence: timingConfidence.midTerm,
          terms: outcomeTimingTerms.midTerm.filter(term => textContent.includes(term))
        },
        longTerm: {
          hasIndicators: outcomeTiming.longTerm,
          confidence: timingConfidence.longTerm,
          terms: outcomeTimingTerms.longTerm.filter(term => textContent.includes(term))
        },
        primaryTiming: primaryTiming
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

  // Helper method to calculate timing confidence based on number and specificity of indicators
  calculateTimingConfidence(text, timingTerms) {
    const matchedTerms = timingTerms.filter(term => text.includes(term));
    
    // No matches = no confidence
    if (matchedTerms.length === 0) return 0;
    
    // Base confidence on number of matching terms
    let confidence = Math.min(1, matchedTerms.length / 3); // Cap at 1.0
    
    // Boost confidence for specific date mentions
    if (text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/) || // MM/DD/YYYY
        text.match(/\b\d{4}-\d{2}-\d{2}\b/) ||       // YYYY-MM-DD
        text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/i)) { // Month DD
      confidence = Math.min(1, confidence + 0.3);
    }
    
    // Boost confidence for explicit timing language
    if (text.includes('scheduled') || 
        text.includes('confirmed') || 
        text.includes('announced') ||
        text.includes('planned')) {
      confidence = Math.min(1, confidence + 0.2);
    }
    
    return confidence;
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