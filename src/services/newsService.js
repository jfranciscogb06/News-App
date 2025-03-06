const axios = require('axios');
const cheerio = require('cheerio');
const NewsAPI = require('newsapi');
const yahooFinance = require('yahoo-finance2').default;
const config = require('../config/config');
const openaiService = require('./openaiService');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async scrapeArticleDate(url) {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      
      // Common date selectors in Yahoo Finance articles
      const possibleSelectors = [
        'time[datetime]',
        'time[class*="date"]',
        'span[class*="date"]',
        'div[class*="date"]',
        'p[class*="date"]',
        'meta[property="article:published_time"]'
      ];

      for (const selector of possibleSelectors) {
        const element = $(selector).first();
        if (element.length) {
          const dateStr = element.attr('datetime') || element.text();
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

      // If no date found, use AI to find it in the text
      const pageText = $('body').text().substring(0, 2000); // First 2000 chars
      const dateAnalysis = await openaiService.findArticleDate(pageText, url);
      if (dateAnalysis && dateAnalysis.date) {
        return dateAnalysis.date;
      }

      return null;
    } catch (error) {
      console.error(`Error scraping date from ${url}:`, error);
      return null;
    }
  }

  async getNewsApiArticles(symbol) {
    try {
      console.log('Fetching NewsAPI articles...');
      
      const [recentNews, relevantNews] = await Promise.all([
        this.newsapi.v2.everything({
          q: `${symbol} stock`,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100,
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        this.newsapi.v2.everything({
          q: `${symbol} (forecast OR future OR upcoming OR planned OR expected OR launch OR release)`,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100,
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        })
      ]);

      const articles = [...recentNews.articles, ...relevantNews.articles].map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        publishedAt: new Date(article.publishedAt).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        source: article.source?.name || 'NewsAPI',
        provider: 'NewsAPI',
        isRecent: new Date(article.publishedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        hasFutureTerms: this.checkForFutureTerms(article.title + ' ' + article.description)
      }));

      console.log(`Found ${articles.length} NewsAPI articles`);
      return articles;
    } catch (error) {
      console.error('Error fetching NewsAPI articles:', error);
      return [];
    }
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

  async getYahooFinanceArticles(symbol) {
    try {
      console.log('Fetching Yahoo Finance articles...');
      
      const search = await yahooFinance.search(symbol);
      const articles = await Promise.all((search?.news || [])
        .filter(article => {
          const publishDate = new Date(article.providerPublishTime * 1000);
          return (
            publishDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) &&
            (publishDate > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) ||
             this.checkForFutureTerms(article.title + ' ' + article.description))
          );
        })
        .map(async article => {
          const scrapedDate = await this.scrapeArticleDate(article.link);
          console.log(`Scraped date for "${article.title.substring(0, 50)}...": ${scrapedDate}`);
          
          return {
            title: article.title,
            description: article.description,
            url: article.link,
            publishedAt: scrapedDate || 'Date not available',
            source: 'Yahoo Finance',
            provider: 'Yahoo Finance',
            isRecent: new Date(article.providerPublishTime * 1000) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            hasFutureTerms: this.checkForFutureTerms(article.title + ' ' + article.description)
          };
        }));

      console.log(`Found ${articles.length} Yahoo Finance articles`);
      return articles;
    } catch (error) {
      console.error('Error fetching Yahoo Finance articles:', error);
      return [];
    }
  }

  async getArticleDetails(url, article) {
    if (article.provider === 'Yahoo Finance') {
      return {
        ...article,
        content: article.description
      };
    }

    try {
      const response = await this.newsapi.v2.everything({
        q: `url:"${url}"`,
        language: 'en'
      });

      const matchedArticle = response.articles?.[0];
      if (matchedArticle) {
        return {
          ...article,
          content: matchedArticle.content || matchedArticle.description
        };
      }
      
      return article;
    } catch (error) {
      console.error('Error fetching article details:', error);
      return article;
    }
  }

  async collectAndAnalyzeNews(symbol) {
    try {
      // 1. Get NewsAPI articles
      const newsApiArticles = await this.getNewsApiArticles(symbol);
      
      // 2. Let OpenAI select unique and relevant articles
      const selectedNewsApiArticles = await openaiService.selectRelevantArticles(symbol, newsApiArticles);
      console.log(`Selected ${selectedNewsApiArticles.length} relevant NewsAPI articles`);

      // 3. Get Yahoo Finance articles
      const yahooArticles = await this.getYahooFinanceArticles(symbol);
      
      // 4. Combine all articles and prioritize by relevance
      const allArticles = [...selectedNewsApiArticles, ...yahooArticles]
        .sort((a, b) => {
          // Prioritize articles with future terms
          if (a.hasFutureTerms && !b.hasFutureTerms) return -1;
          if (!a.hasFutureTerms && b.hasFutureTerms) return 1;
          // Then consider recency
          if (a.isRecent && !b.isRecent) return -1;
          if (!a.isRecent && b.isRecent) return 1;
          // Finally sort by date
          return new Date(b.publishedAt) - new Date(a.publishedAt);
        });

      console.log(`Total articles before final selection: ${allArticles.length}`);

      // 5. Get full content for selected articles
      const articlesWithContent = await Promise.all(
        allArticles.map(article => this.getArticleDetails(article.url, article))
      );

      // 6. Final analysis of all unique articles
      const analysis = await openaiService.analyzeArticles(symbol, articlesWithContent);
      
      return analysis;
    } catch (error) {
      console.error('Error in collectAndAnalyzeNews:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 