const NewsAPI = require('newsapi');
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getStockNews(symbol) {
    const news = await this.newsapi.v2.everything({
      q: symbol,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: 10,
    });

    return news.articles.map(article => ({
      title: article.title,
      description: article.description,
      url: article.url,
      publishedAt: article.publishedAt
    }));
  }
}

module.exports = new NewsService(); 