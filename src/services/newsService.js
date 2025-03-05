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

  // Helper function to chunk array into smaller pieces
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async getArticleDetails(urls) {
    try {
      // Split URLs into chunks of 5 to keep queries short
      const urlChunks = this.chunkArray(urls, 5);
      const allArticles = [];

      // Process each chunk
      for (const chunk of urlChunks) {
        const urlQueries = chunk.map(url => {
          const urlObj = new URL(url);
          // Create shorter search terms from URL
          const domain = urlObj.hostname.replace('www.', '');
          const path = urlObj.pathname.split('/').pop() || '';
          return `(${domain} AND ${path})`;
        });

        // Fetch articles for this chunk
        const response = await this.newsapi.v2.everything({
          q: urlQueries.join(' OR '),
          language: 'en',
          pageSize: chunk.length * 2 // Get a few extra in case of matches
        });

        if (response.articles?.length) {
          // Filter and map articles from this chunk
          const matchedArticles = response.articles
            .filter(article => chunk.includes(article.url))
            .map(article => ({
              title: article.title,
              description: article.description || '',
              content: article.content || '',
              url: article.url,
              source: article.source?.name || 'Unknown',
              publishedAt: article.publishedAt
            }));

          allArticles.push(...matchedArticles);
        }

        // Add a small delay between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!allArticles.length) {
        throw new Error('Could not find any matching articles');
      }

      return allArticles;
    } catch (error) {
      console.error('Error fetching article details:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 