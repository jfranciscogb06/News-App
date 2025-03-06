const NewsAPI = require('newsapi');
const yahooFinance = require('yahoo-finance2').default;
const config = require('../config/config');
const openaiService = require('./openaiService');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getNewsApiArticles(symbol) {
    try {
      console.log('Fetching NewsAPI articles...');
      
      // Get articles from the last 30 days for more comprehensive coverage
      const [recentNews, relevantNews] = await Promise.all([
        // Very recent news (last 7 days)
        this.newsapi.v2.everything({
          q: `${symbol} stock`,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100,
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        // Relevant news from last 30 days
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
        publishedAt: article.publishedAt,
        source: article.source?.name || 'NewsAPI',
        provider: 'NewsAPI',
        // Add relevance indicators
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
      const articles = (search?.news || [])
        .filter(article => {
          const publishDate = new Date(article.providerPublishTime * 1000);
          // Include articles from last 30 days that are either recent or discuss future events
          return (
            publishDate > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) &&
            (publishDate > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) ||
             this.checkForFutureTerms(article.title + ' ' + article.description))
          );
        })
        .map(article => ({
          title: article.title,
          description: article.description,
          url: article.link,
          publishedAt: new Date(article.providerPublishTime * 1000).toISOString(),
          source: 'Yahoo Finance',
          provider: 'Yahoo Finance',
          isRecent: new Date(article.providerPublishTime * 1000) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          hasFutureTerms: this.checkForFutureTerms(article.title + ' ' + article.description)
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