const NewsAPI = require('newsapi');
const yahooFinance = require('yahoo-finance2').default;
const config = require('../config/config');

class NewsService {
  constructor() {
    this.newsapi = new NewsAPI(config.newsapi.apiKey);
  }

  async getArticleTitles(symbol) {
    try {
      // Get articles from both sources in parallel
      const [recentNews, olderNews, quote, search] = await Promise.all([
        // NewsAPI recent articles
        this.newsapi.v2.everything({
          q: `${symbol} stock OR (${symbol} company)`,  // Expanded search query
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 100,
          searchIn: 'title,description',  // Focus on relevant fields
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        // NewsAPI older articles
        this.newsapi.v2.everything({
          q: `${symbol} stock OR (${symbol} company)`,  // Expanded search query
          language: 'en',
          sortBy: 'relevancy',
          pageSize: 100,
          searchIn: 'title,description',  // Focus on relevant fields
          from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }),
        // Yahoo Finance quote (for validation)
        yahooFinance.quoteSummary(symbol, {
          modules: ['price']
        }),
        // Yahoo Finance news
        yahooFinance.search(symbol, {
          newsCount: 50,
          enableFuzzyQuery: false
        })
      ]);

      // Process NewsAPI articles with better filtering
      const newsApiArticles = [...recentNews.articles, ...olderNews.articles]
        .filter(article => 
          // Ensure article is relevant to the company
          (article.title?.toLowerCase().includes(symbol.toLowerCase()) ||
           article.description?.toLowerCase().includes(symbol.toLowerCase())) &&
          // Exclude articles that are too generic
          !article.title?.toLowerCase().includes('stock market') &&
          !article.title?.toLowerCase().includes('stocks to watch')
        )
        .map(article => ({
          title: article.title,
          publishedAt: article.publishedAt,
          url: article.url,
          source: article.source?.name || 'NewsAPI',
          description: article.description,
          provider: 'NewsAPI'
        }));

      // Process Yahoo Finance articles
      const yahooArticles = (search.news || []).map(article => ({
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
      console.log(`Found ${newsApiArticles.length} NewsAPI articles`);
      console.log(`Found ${yahooArticles.length} Yahoo Finance articles`);
      console.log(`Total unique articles after deduplication: ${uniqueArticles.length}`);

      return uniqueArticles;
    } catch (error) {
      console.error('Error fetching news titles:', error);
      throw error;
    }
  }

  deduplicateArticles(articles) {
    const seen = new Set();
    return articles.filter(article => {
      // Create a key using title and first 100 chars of description
      const key = `${article.title}-${article.description?.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
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