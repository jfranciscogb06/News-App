const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

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
   * Search for news articles about a stock
   */
  async searchNews(symbol, maxResults = 20) {
    try {
      const searchQueries = [
        `${symbol} stock news`,
        `${symbol} financial results`,
        `${symbol} earnings report`,
        `${symbol} company news`
      ];

      const allArticles = [];
      
      // Search multiple sources in parallel
      await Promise.all(searchQueries.map(async query => {
        try {
          const articles = await this.searchGoogleNews(query, maxResults / searchQueries.length);
          allArticles.push(...articles);
        } catch (error) {
          logger.error(`Error searching for "${query}":`, error);
        }
      }));

      // Deduplicate and sort by relevance
      return this.deduplicateArticles(allArticles)
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, maxResults);
    } catch (error) {
      logger.error('Error in searchNews:', error);
      throw error;
    }
  }

  /**
   * Search Google News
   */
  async searchGoogleNews(query, maxResults) {
    try {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());
      
      // Navigate to Google News
      await page.goto(`https://news.google.com/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
      
      // Wait for articles to load
      await page.waitForSelector('article');
      
      // Extract articles
      const articles = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('article'));
        return items.map(item => {
          const titleElement = item.querySelector('h3');
          const linkElement = item.querySelector('a');
          const timeElement = item.querySelector('time');
          
          return {
            title: titleElement?.textContent || '',
            url: linkElement?.href || '',
            publishedAt: timeElement?.getAttribute('datetime') || new Date().toISOString(),
            source: {
              name: item.querySelector('div[data-n-tid]')?.textContent || ''
            }
          };
        });
      });
      
      await browser.close();
      
      // Process articles in parallel
      const processedArticles = await Promise.all(
        articles.map(async article => {
          try {
            const details = await this.getArticleDetails(article);
            return details || article;
          } catch (error) {
            logger.error(`Error processing article: ${error.message}`);
            return article;
          }
        })
      );
      
      return processedArticles;
    } catch (error) {
      logger.error('Error in searchGoogleNews:', error);
      throw error;
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
            
            return {
              ...article,
              content: content || article.description || article.snippet,
              relevanceScore: this.calculateRelevanceScore(article)
            };
          }
        } catch (error) {
          if (attempt < this.maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            continue;
          }
        }
      }

      // If all retries failed, use fallback content
      return {
        ...article,
        content: article.description || article.snippet,
        relevanceScore: this.calculateRelevanceScore(article)
      };
    } catch (error) {
      logger.error(`Error fetching article details: ${error.message}`);
      return article;
    }
  }

  /**
   * Extract content from HTML using common article patterns
   */
  extractContent($) {
    // Try different common article content selectors
    const selectors = [
      'article',
      '.article-content',
      '.story-content',
      '.post-content',
      '.entry-content',
      '[itemprop="articleBody"]',
      '.article-body'
    ];

    for (const selector of selectors) {
      const content = $(selector).text().trim();
      if (content && content.length > 100) {
        return content;
      }
    }

    // Fallback: get all paragraphs
    const paragraphs = $('p').map((_, el) => $(el).text().trim()).get();
    return paragraphs.join('\n\n');
  }

  /**
   * Calculate relevance score for an article
   */
  calculateRelevanceScore(article) {
    let score = 0;
    
    // Title relevance
    if (article.title) {
      const title = article.title.toLowerCase();
      if (title.includes('stock') || title.includes('price')) score += 2;
      if (title.includes('earnings') || title.includes('financial')) score += 2;
      if (title.includes('report') || title.includes('results')) score += 1;
    }
    
    // Content relevance
    if (article.content) {
      const content = article.content.toLowerCase();
      if (content.includes('stock') || content.includes('price')) score += 1;
      if (content.includes('earnings') || content.includes('financial')) score += 1;
      if (content.includes('report') || content.includes('results')) score += 1;
    }
    
    // Source credibility
    const source = article.source?.name?.toLowerCase() || '';
    if (source.includes('reuters') || source.includes('bloomberg')) score += 2;
    if (source.includes('wsj') || source.includes('ft')) score += 2;
    if (source.includes('cnbc') || source.includes('yahoo')) score += 1;
    
    return score;
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