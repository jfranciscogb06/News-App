const NewsAPI = require('newsapi');
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getStockNews(symbol) {
    // Get recent news (last 7 days)
    const recentNews = await this.newsapi.v2.everything({
      q: `${symbol} stock OR ${symbol} company`,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: 50,
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Get older news (last 6 months)
    const olderNews = await this.newsapi.v2.everything({
      q: `${symbol} stock OR ${symbol} company`,
      language: 'en',
      sortBy: 'relevancy',
      pageSize: 50,
      from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Combine and filter articles
    const allArticles = [...recentNews.articles, ...olderNews.articles]
      .filter(article => 
        article.title?.toLowerCase().includes(symbol.toLowerCase()) ||
        article.description?.toLowerCase().includes(symbol.toLowerCase())
      )
      .map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source?.name
      }));

    console.log(`Found ${allArticles.length} relevant articles for ${symbol}`);
    return allArticles;
  }
}

module.exports = new NewsService(); 