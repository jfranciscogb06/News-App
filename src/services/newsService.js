const NewsAPI = require('newsapi');
const yahooFinance = require('yahoo-finance2');
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getArticleTitles(symbol) {
    try {
      // Get NewsAPI articles
      const [recentNews, olderNews] = await Promise.all([
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100, // Increased from 50
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        this.newsapi.v2.everything({
          q: symbol,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100, // Increased from 50
          from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        })
      ]);

      // Get Yahoo Finance news
      const yahooNews = await yahooFinance.search(symbol, {
        newsCount: 100, // Get more Yahoo articles
        enableFuzzyQuery: false
      });

      const newsApiArticles = [...recentNews.articles, ...olderNews.articles].map(article => ({
        title: article.title,
        publishedAt: article.publishedAt,
        url: article.url,
        source: article.source?.name,
        imageUrl: article.urlToImage,
        description: article.description
      }));

      const yahooArticles = yahooNews.news.map(article => ({
        title: article.title,
        publishedAt: article.providerPublishTime,
        url: article.link,
        source: 'Yahoo Finance',
        imageUrl: article.thumbnail?.resolutions?.[0]?.url,
        description: article.description
      }));

      return [...newsApiArticles, ...yahooArticles];
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

      for (const url of urls) {
        try {
          let articleDetails;

          if (url.includes('finance.yahoo.com')) {
            // Handle Yahoo Finance articles
            const yahooSearch = await yahooFinance.search(url, {
              newsCount: 1,
              enableFuzzyQuery: false
            });
            const article = yahooSearch.news[0];
            
            articleDetails = {
              title: article.title,
              description: article.description,
              content: article.content || article.description,
              url: article.link,
              source: 'Yahoo Finance',
              publishedAt: article.providerPublishTime,
              imageUrl: article.thumbnail?.resolutions?.[0]?.url
            };
          } else {
            // Existing NewsAPI logic
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
                    articleDetails = {
                      title: matchedArticle.title || '',
                      description: matchedArticle.description || '',
                      content: matchedArticle.content || '',
                      url: matchedArticle.url,
                      source: matchedArticle.source?.name || 'Unknown',
                      publishedAt: matchedArticle.publishedAt,
                      imageUrl: matchedArticle.urlToImage
                    };
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
          }

          if (articleDetails) {
            allArticles.push(articleDetails);
          }
        } catch (urlError) {
          console.error('Error processing URL:', urlError);
          continue;
        }
      }

      return allArticles;
    } catch (error) {
      console.error('Error fetching article details:', error);
      throw error;
    }
  }
}

module.exports = new NewsService(); 