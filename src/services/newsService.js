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
      // Create a query that includes all URLs
      const urlQueries = urls.map(url => {
        // Extract domain and relevant parts from URL for better searching
        const urlObj = new URL(url);
        const searchTerms = urlObj.pathname.split('/').filter(Boolean).join(' ');
        return `url:"${url}" OR "${searchTerms}"`;
      });

      // Fetch articles in batches to avoid rate limits
      const articles = await this.newsapi.v2.everything({
        q: urlQueries.join(' OR '),
        language: 'en',
        pageSize: urls.length
      });

      if (!articles.articles?.length) {
        throw new Error('No articles found for the given URLs');
      }

      // Match returned articles with requested URLs
      const detailedArticles = articles.articles
        .filter(article => urls.includes(article.url))
        .map(article => ({
          title: article.title,
          description: article.description || '',
          content: article.content || '',
          url: article.url,
          source: article.source?.name || 'Unknown',
          publishedAt: article.publishedAt
        }));

      if (!detailedArticles.length) {
        throw new Error('Could not find matching articles');
      }

      return detailedArticles;
    } catch (error) {
      console.error('Error fetching article details:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 