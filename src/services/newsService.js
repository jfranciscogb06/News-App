const axios = require('axios');
const cheerio = require('cheerio');
const NewsAPI = require('newsapi');
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
      
      // Common date selectors in articles
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
      
      const [recentNews, relevantNews, futureNews] = await Promise.all([
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
        }),
        this.newsapi.v2.everything({
          q: `${symbol} (analysis OR prediction OR outlook OR guidance OR earnings OR revenue OR growth)`,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100,
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        })
      ]);

      // Combine all articles and remove duplicates
      const uniqueUrls = new Set();
      const articles = [...recentNews.articles, ...relevantNews.articles, ...futureNews.articles]
        .filter(article => {
          if (uniqueUrls.has(article.url)) return false;
          uniqueUrls.add(article.url);
          return true;
        })
        .map(article => ({
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
          content: article.content || article.description,
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

  async getArticleDetails(url, article) {
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
      const selectedArticles = await openaiService.selectRelevantArticles(symbol, newsApiArticles);
      console.log(`Selected ${selectedArticles.length} relevant articles`);

      // 3. Sort articles by relevance and recency
      const sortedArticles = selectedArticles.sort((a, b) => {
        // Prioritize articles with future terms
        if (a.hasFutureTerms && !b.hasFutureTerms) return -1;
        if (!a.hasFutureTerms && b.hasFutureTerms) return 1;
        // Then consider recency
        if (a.isRecent && !b.isRecent) return -1;
        if (!a.isRecent && b.isRecent) return 1;
        // Finally sort by date
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      });

      console.log(`Total articles for analysis: ${sortedArticles.length}`);
      
      // 4. Get full content for selected articles if needed
      const articlesWithContent = await Promise.all(
        sortedArticles.map(article => 
          article.content ? article : this.getArticleDetails(article.url, article)
        )
      );

      // 5. Final analysis of all unique articles
      const analysis = await openaiService.analyzeArticles(symbol, articlesWithContent);
      
      return analysis;
    } catch (error) {
      console.error('Error in collectAndAnalyzeNews:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 