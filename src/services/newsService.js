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

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async getArticleDetails(urls) {
    try {
      // Split URLs into smaller chunks
      const urlChunks = this.chunkArray(urls, 3); // Reduced chunk size
      const allArticles = [];

      // Process each chunk
      for (const chunk of urlChunks) {
        try {
          // Create a simpler query using domains
          const domains = chunk.map(url => {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
          });

          // Fetch articles for this chunk
          const response = await this.newsapi.v2.everything({
            domains: domains.join(','), // Use domains parameter instead of q
            language: 'en',
            pageSize: 100, // Increased to ensure we catch the articles
            sortBy: 'relevancy'
          });

          if (response.articles?.length) {
            // Find exact URL matches
            const matchedArticles = response.articles
              .filter(article => chunk.includes(article.url))
              .map(article => ({
                title: article.title || '',
                description: article.description || '',
                content: article.content || '',
                url: article.url,
                source: article.source?.name || 'Unknown',
                publishedAt: article.publishedAt
              }));

            allArticles.push(...matchedArticles);
          }

          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay
        } catch (chunkError) {
          console.error('Error processing chunk:', chunkError);
          // Continue with next chunk even if this one fails
          continue;
        }
      }

      // If we found any articles, return them
      if (allArticles.length > 0) {
        return allArticles;
      }

      // If no articles found through domains, try one more time with direct URLs
      const fallbackArticles = await Promise.all(
        urls.map(async (url) => {
          try {
            const response = await this.newsapi.v2.everything({
              q: url,
              language: 'en',
              pageSize: 1
            });
            return response.articles[0];
          } catch (error) {
            console.error('Error fetching individual article:', error);
            return null;
          }
        })
      );

      const validArticles = fallbackArticles
        .filter(Boolean)
        .map(article => ({
          title: article.title || '',
          description: article.description || '',
          content: article.content || '',
          url: article.url,
          source: article.source?.name || 'Unknown',
          publishedAt: article.publishedAt
        }));

      if (!validArticles.length) {
        throw new Error('Could not find any matching articles');
      }

      return validArticles;
    } catch (error) {
      console.error('Error fetching article details:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 