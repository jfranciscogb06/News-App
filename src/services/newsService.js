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
      
      const [recentNews, olderNews] = await Promise.all([
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100,
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100,
          from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        })
      ]);

      const articles = [...recentNews.articles, ...olderNews.articles].map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source?.name || 'NewsAPI',
        provider: 'NewsAPI'
      }));

      console.log(`Found ${articles.length} NewsAPI articles`);
      return articles;
    } catch (error) {
      console.error('Error fetching NewsAPI articles:', error);
      return [];
    }
  }

  async getYahooFinanceArticles(symbol) {
    try {
      console.log('Fetching Yahoo Finance articles...');
      
      const search = await yahooFinance.search(symbol);
      const articles = (search?.news || []).map(article => ({
        title: article.title,
        description: article.description,
        url: article.link,
        publishedAt: new Date(article.providerPublishTime * 1000).toISOString(),
        source: 'Yahoo Finance',
        provider: 'Yahoo Finance'
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
      
      // 4. Combine all articles and get full content
      const allArticles = [...selectedNewsApiArticles, ...yahooArticles];
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