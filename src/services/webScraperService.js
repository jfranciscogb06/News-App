const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const xml2js = require('xml2js');

class WebScraperService {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
    ];
    
    this.timeoutMs = 30000;
    this.maxRetries = 3;
    this.retryDelay = 2000;
  }

  /**
   * Get a random user agent from the list
   */
  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Calculate relevance score for an article
   */
  calculateRelevanceScore(article, symbol) {
    let score = 0;
    const symbolLower = symbol.toLowerCase();
    
    // Check title
    if (article.title) {
      const title = article.title.toLowerCase();
      // Direct symbol mention
      if (title.includes(symbolLower)) score += 5;
      
      // Company name mentions
      const companyNames = this.getCompanyNames(symbol);
      for (const name of companyNames) {
        if (title.includes(name.toLowerCase())) score += 4;
      }
      
      // Title relevance
      if (title.includes('stock')) score += 2;
      if (title.includes('price') || title.includes('market')) score += 2;
      if (title.includes('earnings') || title.includes('financial')) score += 2;
      if (title.includes('report') || title.includes('results')) score += 1;
    }
    
    // Check description
    if (article.description) {
      const description = article.description.toLowerCase();
      // Direct symbol mention
      if (description.includes(symbolLower)) score += 3;
      
      // Company name mentions
      const companyNames = this.getCompanyNames(symbol);
      for (const name of companyNames) {
        if (description.includes(name.toLowerCase())) score += 2;
      }
    }
    
    // Source credibility
    const source = article.source?.name?.toLowerCase() || '';
    if (source.includes('yahoo finance')) score += 2;
    
    return score;
  }

  /**
   * Get company names for a stock symbol
   */
  getCompanyNames(symbol) {
    const companyMap = {
      'AAPL': ['Apple', 'Apple Inc'],
      'MSFT': ['Microsoft', 'Microsoft Corporation'],
      'GOOGL': ['Google', 'Alphabet', 'Alphabet Inc'],
      'AMZN': ['Amazon', 'Amazon.com'],
      'META': ['Meta', 'Facebook', 'Meta Platforms'],
      'TSLA': ['Tesla', 'Tesla Inc'],
      'NVDA': ['NVIDIA', 'Nvidia Corporation'],
      'JPM': ['JPMorgan', 'JP Morgan', 'JPMorgan Chase'],
      'V': ['Visa', 'Visa Inc'],
      'WMT': ['Walmart', 'Wal-Mart', 'Walmart Inc']
    };
    
    return companyMap[symbol] || [];
  }

  /**
   * Search for news articles about a stock
   */
  async searchNews(symbol, maxResults = 20) {
    try {
      const feeds = [
        `https://finance.yahoo.com/rss/stock?s=${symbol}`,
        `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`
      ];

      const allArticles = [];
      
      // Fetch from multiple feeds in parallel
      await Promise.all(feeds.map(async feed => {
        try {
          const articles = await this.fetchRssFeed(feed, symbol);
          allArticles.push(...articles);
        } catch (error) {
          logger.error(`Error fetching feed ${feed}:`, error);
        }
      }));

      // Deduplicate, filter by relevance, and sort by date
      return this.deduplicateArticles(allArticles)
        .filter(article => article.relevanceScore >= 4) // Increase minimum relevance score
        .sort((a, b) => {
          // First sort by relevance score
          if (b.relevanceScore !== a.relevanceScore) {
            return b.relevanceScore - a.relevanceScore;
          }
          // Then by date if scores are equal
          return new Date(b.publishedAt) - new Date(a.publishedAt);
        })
        .slice(0, maxResults);
    } catch (error) {
      logger.error('Error in searchNews:', error);
      throw error;
    }
  }

  /**
   * Fetch and parse RSS feed
   */
  async fetchRssFeed(feedUrl, symbol) {
    try {
      const response = await axios.get(feedUrl, {
        timeout: this.timeoutMs,
        headers: {
          'User-Agent': this.getRandomUserAgent()
        }
      });

      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true
      });

      const result = await parser.parseStringPromise(response.data);
      const items = result.rss.channel.item;

      if (!items) {
        return [];
      }

      // Convert feed items to our article format
      const articles = (Array.isArray(items) ? items : [items]).map(item => {
        const article = {
          title: item.title,
          url: item.link,
          publishedAt: new Date(item.pubDate).toISOString(),
          source: {
            name: 'Yahoo Finance'
          },
          description: item.description
        };
        
        // Calculate relevance score immediately based on title and description
        article.relevanceScore = this.calculateRelevanceScore(article, symbol);
        return article;
      });

      // Only process articles that have a minimum relevance score based on title/description
      const relevantArticles = articles.filter(article => article.relevanceScore >= 3);

      // Process relevant articles in parallel
      const processedArticles = await Promise.all(
        relevantArticles.map(async article => {
          try {
            const details = await this.getArticleDetails(article);
            if (details) {
              // Recalculate score with full content
              details.relevanceScore = this.calculateRelevanceScore(details, symbol);
              return details;
            }
            return article;
          } catch (error) {
            logger.error(`Error processing article: ${error.message}`);
            return article;
          }
        })
      );

      return processedArticles;
    } catch (error) {
      logger.error(`Error fetching RSS feed ${feedUrl}:`, error);
      return [];
    }
  }

  /**
   * Get article details by scraping the article page
   */
  async getArticleDetails(article) {
    try {
      // Try to fetch article details with retries
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const response = await axios.get(article.url, {
            timeout: this.timeoutMs,
            headers: {
              'User-Agent': this.getRandomUserAgent()
            }
          });

          if (response.status === 200) {
            const $ = cheerio.load(response.data);
            
            // Extract content based on common article patterns
            const content = this.extractContent($);
            
            // Only update the article if we successfully extracted content
            if (content && content.length > 0) {
              return {
                ...article,
                content
              };
            }
          }
        } catch (error) {
          if (attempt < this.maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            continue;
          }
          logger.error(`Failed to fetch article details after ${this.maxRetries} attempts:`, error);
        }
      }

      // If all retries failed or no content was extracted, return the original article
      return article;
    } catch (error) {
      logger.error(`Error in getArticleDetails:`, error);
      return article;
    }
  }

  /**
   * Extract content from HTML using common article patterns
   */
  extractContent($) {
    try {
      // Try different common article content selectors
      const selectors = [
        'article',
        '.article-content',
        '.story-content',
        '.post-content',
        '.entry-content',
        '[itemprop="articleBody"]',
        '.article-body',
        '.content',
        '.story-body',
        '.article__body',
        '.article-text',
        '.article-content__body',
        '.article__content',
        '.article-body__content'
      ];

      // First try to find the main content container
      for (const selector of selectors) {
        const element = $(selector);
        if (element.length > 0) {
          // Remove unwanted elements
          element.find('script, style, iframe, .advertisement, .ad, .social-share, .related-articles').remove();
          
          // Get all paragraphs
          const paragraphs = element.find('p')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter(text => text.length > 50); // Filter out short paragraphs
          
          if (paragraphs.length > 0) {
            return paragraphs.join('\n\n');
          }
        }
      }

      // Fallback: get all paragraphs from the body
      const paragraphs = $('body p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(text => text.length > 50);
      
      if (paragraphs.length > 0) {
        return paragraphs.join('\n\n');
      }

      // If no content was found, return null
      return null;
    } catch (error) {
      logger.error('Error extracting content:', error);
      return null;
    }
  }

  /**
   * Deduplicate articles based on title and URL
   */
  deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
      const key = `${article.title}|${article.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = new WebScraperService(); 