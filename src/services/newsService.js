const NewsAPI = require('newsapi');
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getArticleTitles(symbol) {
    try {
      const [recentNews, olderNews] = await Promise.all([
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 50,
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 50,
          from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        })
      ]);

      // Only return titles and basic info for initial filtering
      return [...recentNews.articles, ...olderNews.articles].map(article => ({
        title: article.title,
        publishedAt: article.publishedAt,
        url: article.url
      }));
    } catch (error) {
      console.error('Error fetching news titles:', error);
      throw error;
    }
  }

  async getArticleDetails(urls) {
    try {
      // Fetch full details for selected articles
      const detailedArticles = await Promise.all(
        urls.map(async (url) => {
          const response = await this.newsapi.v2.everything({
            q: url,
            language: 'en',
            pageSize: 1
          });
          return response.articles[0];
        })
      );

      return detailedArticles.map(article => ({
        title: article.title,
        description: article.description,
        content: article.content,
        url: article.url,
        source: article.source.name,
        publishedAt: article.publishedAt
      }));
    } catch (error) {
      console.error('Error fetching article details:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 