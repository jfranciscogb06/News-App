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
        url: article.url,
        source: article.source?.name
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
      const allArticles = [];

      // Try to fetch each article individually
      for (const url of urls) {
        try {
          const urlObj = new URL(url);
          const domain = urlObj.hostname.replace('www.', '');
          
          // Try multiple search strategies
          const searchStrategies = [
            // Strategy 1: Search by exact URL
            {
              q: `url:"${url}"`,
              pageSize: 10
            },
            // Strategy 2: Search by domain and title keywords
            {
              domains: domain,
              pageSize: 100,
              sortBy: 'relevancy'
            },
            // Strategy 3: Search by domain only
            {
              domains: domain,
              pageSize: 100,
              sortBy: 'publishedAt'
            }
          ];

          for (const strategy of searchStrategies) {
            try {
              const response = await this.newsapi.v2.everything({
                ...strategy,
                language: 'en'
              });

              if (response.articles?.length) {
                // Find the matching article
                const matchedArticle = response.articles.find(article => 
                  article.url === url || 
                  article.url.includes(urlObj.pathname)
                );

                if (matchedArticle) {
                  allArticles.push({
                    title: matchedArticle.title || '',
                    description: matchedArticle.description || '',
                    content: matchedArticle.content || '',
                    url: matchedArticle.url,
                    source: matchedArticle.source?.name || 'Unknown',
                    publishedAt: matchedArticle.publishedAt
                  });
                  break; // Found the article, move to next URL
                }
              }

              // Add delay between requests
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (strategyError) {
              console.error('Strategy failed:', strategyError);
              continue; // Try next strategy
            }
          }
        } catch (urlError) {
          console.error('Error processing URL:', urlError);
          continue; // Move to next URL
        }
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