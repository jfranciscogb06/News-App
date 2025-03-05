const NewsAPI = require('newsapi');
const YahooFinance = require('yahoo-finance2').default;
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

      // Get Yahoo Finance news
      const yahooQuote = await YahooFinance.quoteSummary(symbol, {
        modules: ['assetProfile', 'news']
      });

      const newsApiArticles = [...recentNews.articles, ...olderNews.articles].map(article => ({
        title: article.title,
        publishedAt: article.publishedAt,
        url: article.url,
        source: article.source?.name,
        imageUrl: article.urlToImage,
        description: article.description
      }));

      const yahooArticles = (yahooQuote.news || []).map(article => ({
        title: article.title,
        publishedAt: new Date(article.providerPublishTime * 1000).toISOString(),
        url: article.link,
        source: 'Yahoo Finance',
        imageUrl: article.thumbnail?.resolutions?.[0]?.url || null,
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
            // For Yahoo Finance articles, we'll use the data we already have
            // since Yahoo's API doesn't provide a direct way to fetch by URL
            articleDetails = {
              title: url.title || '',
              description: url.description || '',
              content: url.description || '',
              url: url.url,
              source: 'Yahoo Finance',
              publishedAt: url.publishedAt,
              imageUrl: url.imageUrl
            };
          } else {
            // Existing NewsAPI logic
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace('www.', '');
            
            // Try multiple search strategies
            const searchStrategies = [
              {
                q: `url:"${url}"`,
                pageSize: 10
              },
              {
                domains: domain,
                pageSize: 100,
                sortBy: 'relevancy'
              },
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
                    break;
                  }
                }

                await new Promise(resolve => setTimeout(resolve, 200));
              } catch (strategyError) {
                console.error('Strategy failed:', strategyError);
                continue;
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