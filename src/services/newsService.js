const NewsAPI = require('newsapi');
const yahooFinance = require('yahoo-finance2').default;
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getArticleTitles(symbol) {
    try {
      console.log(`Fetching news for ${symbol}...`);

      // Get articles from both sources in parallel
      const [recentNews, olderNews, quote, search] = await Promise.all([
        // NewsAPI recent articles
        this.newsapi.v2.everything({
          q: `${symbol} stock OR (${symbol} company)`,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100,
          searchIn: 'title,description',
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }).catch(err => {
          console.error('Error fetching recent NewsAPI articles:', err);
          return { articles: [] };
        }),
        // NewsAPI older articles
        this.newsapi.v2.everything({
          q: `${symbol} stock OR (${symbol} company)`,
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100,
          searchIn: 'title,description',
          from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }).catch(err => {
          console.error('Error fetching older NewsAPI articles:', err);
          return { articles: [] };
        }),
        // Yahoo Finance quote (for validation)
        yahooFinance.quoteSummary(symbol, {
          modules: ['price']
        }).catch(err => {
          console.error('Error fetching Yahoo quote:', err);
          return null;
        }),
        // Yahoo Finance news
        yahooFinance.search(symbol).catch(err => {
          console.error('Error fetching Yahoo news:', err);
          return { news: [] };
        })
      ]);

      console.log('Raw NewsAPI recent articles count:', recentNews.articles?.length || 0);
      console.log('Raw NewsAPI older articles count:', olderNews.articles?.length || 0);
      console.log('Raw Yahoo Finance news count:', search?.news?.length || 0);

      // Process NewsAPI articles with better filtering
      const newsApiArticles = [...(recentNews.articles || []), ...(olderNews.articles || [])]
        .filter(article => {
          const titleLower = article.title?.toLowerCase() || '';
          const descLower = article.description?.toLowerCase() || '';
          const symbolLower = symbol.toLowerCase();

          // Ensure article is relevant to the company
          return (titleLower.includes(symbolLower) || descLower.includes(symbolLower)) &&
            // Exclude articles that are too generic
            !titleLower.includes('stock market') &&
            !titleLower.includes('stocks to watch');
        })
        .map(article => ({
          title: article.title,
          publishedAt: article.publishedAt,
          url: article.url,
          source: article.source?.name || 'NewsAPI',
          description: article.description,
          provider: 'NewsAPI'
        }));

      // Process Yahoo Finance articles
      const yahooArticles = (search?.news || []).map(article => ({
        title: article.title,
        publishedAt: new Date(article.providerPublishTime * 1000).toISOString(),
        url: article.link,
        source: 'Yahoo Finance',
        description: article.description,
        provider: 'Yahoo Finance'
      }));

      // Combine and deduplicate articles
      const allArticles = [...newsApiArticles, ...yahooArticles];
      const uniqueArticles = this.deduplicateArticles(allArticles);

      // Log article counts for debugging
      console.log(`Filtered NewsAPI articles: ${newsApiArticles.length}`);
      console.log(`Filtered Yahoo articles: ${yahooArticles.length}`);
      console.log(`Final unique articles: ${uniqueArticles.length}`);

      return uniqueArticles;
    } catch (error) {
      console.error('Error fetching news titles:', error);
      throw error;
    }
  }

  deduplicateArticles(articles) {
    const seen = new Map();
    return articles.filter(article => {
      // Normalize the title and description for comparison
      const title = article.title?.toLowerCase().trim() || '';
      const desc = article.description?.toLowerCase().trim() || '';
      
      // Create multiple keys for better deduplication
      const titleKey = title;
      const urlKey = article.url?.toLowerCase();
      const contentKey = `${title}-${desc.slice(0, 100)}`;

      // Check if we've seen this article before
      if (seen.has(titleKey) || seen.has(urlKey) || seen.has(contentKey)) {
        return false;
      }

      // Mark this article as seen
      seen.set(titleKey, true);
      seen.set(urlKey, true);
      seen.set(contentKey, true);
      return true;
    });
  }

  async getArticleDetails(urls) {
    try {
      const allArticles = [];

      for (const url of urls) {
        try {
          let articleDetails;

          if (url.includes('finance.yahoo.com')) {
            articleDetails = {
              title: url.title || '',
              description: url.description || '',
              content: url.description || '',
              url: url.url,
              source: 'Yahoo Finance',
              publishedAt: url.publishedAt,
              provider: 'Yahoo Finance'
            };
          } else {
            // Existing NewsAPI logic
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace('www.', '');
            
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
                      provider: 'NewsAPI'
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