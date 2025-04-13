const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const cheerio = require('cheerio');

class SerpApiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://serpapi.com/search.json';
    
    // Enhanced content quality indicators
    this.qualityIndicators = {
      goodLength: 100,
      idealLength: 300,
      maxLength: 1000,
      minWordsForHighQuality: 50,
      maxWordsForSummary: 100
    };
    
    // Enhanced source tiers with regional variants
    this.sourceTiers = {
      premium: [
        'bloomberg', 'reuters', 'wsj', 'ft.com', 
        'cnbc.com', 'marketwatch.com', 'barrons.com',
        'morningstar.com', 'economist.com'
      ],
      trusted: [
        'fool.com', 'investopedia.com', 'benzinga.com',
        'zacks.com', 'investors.com', 'thestreet.com'
      ],
      reliable: [
        'seekingalpha.com', 'investing.com', 'finance.yahoo.com',
        'tipranks.com', 'marketbeat.com', 'gurufocus.com'
      ],
      general: [
        'forbes.com', 'business.com', 'businessinsider.com',
        'appleinsider.com', '247wallst.com', 'coincentral.com'
      ]
    };

    // Keywords indicating high-value content
    this.contentValueIndicators = {
      earnings: ['earnings', 'revenue', 'profit', 'eps', 'income'],
      analysis: ['analysis', 'forecast', 'outlook', 'prediction'],
      technical: ['technical', 'chart', 'pattern', 'trend'],
      fundamental: ['valuation', 'fundamentals', 'balance sheet', 'cash flow'],
      catalyst: ['catalyst', 'announcement', 'launch', 'release']
    };
  }

  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/[\n\r\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\[\+\d+ chars\]/, '') // Remove length indicators
      .replace(/^(.{250})..+/, '$1...') // Limit length while preserving meaning
      .trim();
  }

  async extractDescription($, article) {
    const descriptions = [];
    
    // Try meta descriptions first (highest quality)
    const metaDesc = $('meta[name="description"]').attr('content') ||
                    $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="twitter:description"]').attr('content');
    
    if (metaDesc) {
      const cleaned = this.cleanText(metaDesc);
      if (this.isQualityDescription(cleaned)) {
        descriptions.push({ text: cleaned, score: 5 });
      }
    }

    // Try article snippet with enhanced cleaning
    if (article.snippet) {
      const cleaned = this.cleanText(article.snippet);
      if (this.isQualityDescription(cleaned)) {
        descriptions.push({ text: cleaned, score: 4 });
      }
    }

    // Try article summary selectors with improved targeting
    const summarySelectors = [
      'meta[name="news_keywords"]',
      '.article-summary', '.article-description', '.article-excerpt',
      '.story-summary', '.entry-summary', '.post-summary',
      '.article-intro', '.article-deck', '.article-subheading',
      '[itemprop="description"]', '[property="og:description"]',
      '.summary', '.standfirst', '.lead-paragraph',
      // Additional selectors for common news sites
      '.article-meta', '.article-header', '.article-lede',
      '.story-body__introduction', '.article__summary',
      '.entry-content > p:first-of-type'
    ];

    for (const selector of summarySelectors) {
      const element = $(selector);
      if (element.length) {
        const cleaned = this.cleanText(element.first().text());
        if (this.isQualityDescription(cleaned)) {
          descriptions.push({ text: cleaned, score: 4 });
        }
      }
    }

    // Try first few paragraphs with improved content extraction
    const paragraphSelectors = [
      'article p', '.article-body p', '.entry-content p',
      '.story-body p', '.article__content p', '.post-content p',
      '[itemprop="articleBody"] p', '.article-text p'
    ];
    
    for (const selector of paragraphSelectors) {
      const paragraphs = $(selector).slice(0, 3);
      paragraphs.each((i, elem) => {
        const text = $(elem).text();
        const cleaned = this.cleanText(text);
        if (this.isQualityDescription(cleaned)) {
          descriptions.push({ text: cleaned, score: 3 - i });
        }
      });
      
      if (descriptions.length > 0) break; // Stop if we found good paragraphs
    }

    // Try to extract from article content if available
    if (article.content && descriptions.length === 0) {
      const contentSentences = article.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (contentSentences.length > 0) {
        const firstTwoSentences = contentSentences.slice(0, 2).join('. ') + '.';
        const cleaned = this.cleanText(firstTwoSentences);
        if (this.isQualityDescription(cleaned)) {
          descriptions.push({ text: cleaned, score: 2 });
        }
      }
    }

    // Final fallback: Construct from title and any available metadata
    if (descriptions.length === 0) {
      const constructedDesc = this.constructDescriptionFromMetadata(article);
      if (constructedDesc) {
        descriptions.push({ text: constructedDesc, score: 1 });
      }
    }

    // Sort by score and quality
    descriptions.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return this.getTextQualityScore(b.text) - this.getTextQualityScore(a.text);
    });

    return descriptions.length > 0 ? descriptions[0].text : this.cleanText(article.title);
  }

  isQualityDescription(text) {
    if (!text) return false;
    
    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    
    return (
      words >= 10 && 
      words <= this.qualityIndicators.maxWordsForSummary &&
      sentences >= 1 &&
      !text.startsWith('Copyright') &&
      !text.match(/^\d+\s+mins?/i) &&
      !text.match(/^Share\s+this/i) &&
      !text.match(/^Follow\s+us/i)
    );
  }

  constructDescriptionFromMetadata(article) {
    let desc = '';
    
    // Start with the title
    if (article.title) {
      desc = article.title.replace(/\([^)]+\)/g, '').trim();
    }
    
    // Add source if available
    if (article.source?.name) {
      desc += ` reported by ${article.source.name}`;
    }
    
    // Add date context if available
    if (article.publishedAt) {
      const date = new Date(article.publishedAt);
      desc += ` on ${date.toLocaleDateString()}`;
    }
    
    // Add topic context based on title keywords
    const titleLower = (article.title || '').toLowerCase();
    if (titleLower.includes('earnings')) {
      desc += '. The article discusses earnings results and financial performance.';
    } else if (titleLower.includes('analysis')) {
      desc += '. The article provides market analysis and stock insights.';
    } else if (titleLower.includes('upgrade') || titleLower.includes('downgrade')) {
      desc += '. The article covers analyst ratings and stock recommendations.';
    } else if (titleLower.includes('product') || titleLower.includes('launch')) {
      desc += '. The article discusses product announcements and company developments.';
    } else {
      desc += '. The article provides updates on the company\'s stock performance and market position.';
    }
    
    return this.cleanText(desc);
  }

  getTextQualityScore(text) {
    if (!text) return 0;
    
    let score = 0;
    const words = text.split(/\s+/).length;
    
    // Length quality
    if (words >= this.qualityIndicators.minWordsForHighQuality) score += 3;
    else if (words >= 20) score += 2;
    else if (words >= 10) score += 1;
    
    // Sentence structure
    if (text.match(/[.!?](\s|$)/g)?.length >= 2) score += 2;
    
    // Contains numbers or data
    if (text.match(/\d+/)) score += 1;
    
    // Contains quotes
    if (text.match(/["']/g)) score += 1;
    
    return score;
  }

  calculateRelevanceScore(article, query) {
    let score = 5; // Base score
    const queryTerms = query.toLowerCase().split(' ');
    const title = (article.title || '').toLowerCase();
    const description = (article.description || '').toLowerCase();
    const content = [title, description].join(' ');
    
    // Title relevance (0-3 points)
    if (title.includes(queryTerms[0])) score += 2;
    queryTerms.slice(1).forEach(term => {
      if (title.includes(term)) score += 0.5;
    });

    // Source quality (0-2 points)
    const domain = this.extractDomain(article.url || article.source?.url);
    if (this.sourceTiers.premium.some(s => domain?.includes(s))) score += 2;
    else if (this.sourceTiers.trusted.some(s => domain?.includes(s))) score += 1.5;
    else if (this.sourceTiers.reliable.some(s => domain?.includes(s))) score += 1;
    else if (this.sourceTiers.general.some(s => domain?.includes(s))) score += 0.5;

    // Content value indicators (0-2 points)
    let valueScore = 0;
    Object.values(this.contentValueIndicators).forEach(keywords => {
      keywords.forEach(keyword => {
        if (content.includes(keyword.toLowerCase())) valueScore += 0.2;
      });
    });
    score += Math.min(2, valueScore);
    
    // Content quality (0-2 points)
    const contentLength = (article.content || description || '').length;
    if (contentLength >= this.qualityIndicators.idealLength) score += 2;
    else if (contentLength >= this.qualityIndicators.goodLength) score += 1;
    
    // Recency (0-3 points)
    const publishedDate = new Date(article.publishedAt);
    const now = new Date();
    const hoursSincePublished = (now - publishedDate) / (1000 * 60 * 60);
    
    if (hoursSincePublished < 6) score += 3;
    else if (hoursSincePublished < 12) score += 2.5;
    else if (hoursSincePublished < 24) score += 2;
    else if (hoursSincePublished < 48) score += 1;
    else if (hoursSincePublished > 168) score -= 1; // Penalize week-old news
    
    // Normalize score between 1 and 10
    return Math.min(10, Math.max(1, score));
  }

  async searchNews(query, maxResults = 20) {
    try {
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          api_key: this.apiKey,
          q: query,
          tbm: 'nws',
          num: maxResults * 2, // Get more results to account for filtering
          gl: 'us', // US results
          hl: 'en',  // English language
          tbs: 'qdr:m6,sbd:1' // Last 6 months, sorted by date
        }
      });

      if (!response.data.news_results || response.data.news_results.length === 0) {
        logger.warn('No news results found for query:', query);
        return [];
      }

      const articlePromises = response.data.news_results
        .filter(article => article.title && article.link)
        .map(async article => {
          try {
            // Calculate initial relevance score based on title and snippet
            let relevanceScore = this.calculateInitialRelevanceScore(article, query);
            
            // Skip problematic sources but still include them with basic info
            if (article.link.includes('finance.yahoo.com') || article.link.includes('seekingalpha.com')) {
              return {
                title: this.cleanText(article.title),
                description: this.cleanText(article.snippet || ''),
                url: article.link,
                publishedAt: article.date || new Date().toISOString(),
                source: {
                  name: article.source || 'Unknown',
                  url: article.source_link || article.link,
                  icon: article.source_icon || '',
                  authors: article.authors || []
                },
                content: this.cleanText(article.snippet || article.title),
                relevanceScore
              };
            }

            const articleResponse = await axios.get(article.link, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
              },
              timeout: 5000,
              maxRedirects: 5
            });

            const $ = cheerio.load(articleResponse.data);
            const description = await this.extractDescription($, article);
            
            // Update relevance score based on full content
            relevanceScore = this.updateRelevanceScore(relevanceScore, description, query);
            
            return {
              title: this.cleanText(article.title),
              description: description,
              url: article.link,
              publishedAt: article.date || new Date().toISOString(),
              source: {
                name: article.source || 'Unknown',
                url: article.source_link || article.link,
                icon: article.source_icon || '',
                authors: article.authors || []
              },
              content: description,
              relevanceScore
            };
          } catch (error) {
            logger.error('Error fetching article details:', {
              error: error.message,
              url: article.link,
              timestamp: new Date().toISOString()
            });
            
            // Return basic article info even if fetching details fails
            return {
              title: this.cleanText(article.title),
              description: this.cleanText(article.snippet || ''),
              url: article.link,
              publishedAt: article.date || new Date().toISOString(),
              source: {
                name: article.source || 'Unknown',
                url: article.source_link || article.link,
                icon: article.source_icon || '',
                authors: article.authors || []
              },
              content: this.cleanText(article.snippet || article.title),
              relevanceScore: this.calculateInitialRelevanceScore(article, query)
            };
          }
        });

      const articles = await Promise.all(articlePromises);

      logger.info(`Found ${articles.length} articles from SerpApi`, {
        query,
        articleCount: articles.length,
        sources: articles.map(a => a.source.name)
      });

      return articles;
    } catch (error) {
      logger.error('Error fetching news from SerpApi:', {
        error: error.message,
        query,
        errorDetails: error.response?.data
      });
      return [];
    }
  }

  calculateInitialRelevanceScore(article, query) {
    let score = 0;
    const queryTerms = query.toLowerCase().split(' ');
    const title = article.title.toLowerCase();
    const snippet = (article.snippet || '').toLowerCase();

    // Check for exact symbol match
    if (title.includes(query.toLowerCase())) {
      score += 3;
    }

    // Check for stock-related terms
    const stockTerms = ['stock', 'shares', 'price', 'earnings', 'dividend', 'market'];
    stockTerms.forEach(term => {
      if (title.includes(term) || snippet.includes(term)) {
        score += 1;
      }
    });

    // Check for query terms in title and snippet
    queryTerms.forEach(term => {
      if (title.includes(term)) score += 2;
      if (snippet.includes(term)) score += 1;
    });

    // Normalize score to 0-10 range
    return Math.min(10, Math.max(0, score));
  }

  updateRelevanceScore(initialScore, content, query) {
    if (!content) return initialScore;
    
    let score = initialScore;
    const queryTerms = query.toLowerCase().split(' ');
    const contentLower = content.toLowerCase();

    // Check for query terms in content
    queryTerms.forEach(term => {
      if (contentLower.includes(term)) {
        score += 1;
      }
    });

    // Check for stock analysis indicators
    const analysisTerms = ['analysis', 'forecast', 'prediction', 'outlook', 'target', 'valuation'];
    analysisTerms.forEach(term => {
      if (contentLower.includes(term)) {
        score += 0.5;
      }
    });

    // Normalize score to 0-10 range
    return Math.min(10, Math.max(0, score));
  }

  async processArticle(article) {
    try {
      // Extract and clean the description
      let description = article.snippet || article.description || '';
      
      // If description is empty, try to extract from content
      if (!description && article.content) {
        description = article.content.split('.').slice(0, 3).join('.') + '.';
      }
      
      // Clean and normalize the description
      description = description
        .replace(/\s+/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      
      // Calculate initial relevance score
      const relevanceScore = this.calculateRelevanceScore(article);
      
      // Get source credibility
      const credibilityScore = await this.getSourceCredibility(article.source?.name);
      
      // Detect if content is opinion-based
      const isOpinionContent = this.detectOpinionContent(article);
      
      // Calculate bias assessment
      const biasAssessment = await this.assessBias(article);
      
      // Extract key metrics and numbers
      const metrics = this.extractMetrics(article);
      
      return {
        ...article,
        description,
        relevanceScore,
        credibilityScore,
        isOpinionContent,
        biasAssessment,
        metrics,
        processed: true,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing article:', error);
      return {
        ...article,
        error: error.message,
        processed: false
      };
    }
  }

  calculateRelevanceScore(article) {
    let score = 5; // Base score
    
    // Title relevance
    if (article.title) {
      if (article.title.toLowerCase().includes(this.symbol.toLowerCase())) score += 2;
      if (article.title.toLowerCase().includes('stock')) score += 1;
      if (article.title.toLowerCase().includes('market')) score += 1;
      if (article.title.toLowerCase().includes('analysis')) score += 1;
    }
    
    // Source quality
    if (article.source?.name) {
      const topSources = ['bloomberg', 'reuters', 'cnbc', 'wsj', 'financial times'];
      if (topSources.some(s => article.source.name.toLowerCase().includes(s))) {
        score += 2;
      }
    }
    
    // Content length
    const contentLength = (article.content || article.description || '').length;
    if (contentLength > 1000) score += 2;
    else if (contentLength > 500) score += 1;
    
    // Recency
    const publishedDate = new Date(article.publishedAt);
    const now = new Date();
    const hoursSincePublished = (now - publishedDate) / (1000 * 60 * 60);
    
    if (hoursSincePublished < 24) score += 3;
    else if (hoursSincePublished < 48) score += 2;
    else if (hoursSincePublished < 72) score += 1;
    
    return Math.min(10, Math.max(1, score)); // Ensure score is between 1 and 10
  }

  async getSourceCredibility(sourceName) {
    if (!sourceName) return { score: 50, rating: 'unknown' };
    
    const sourceLower = sourceName.toLowerCase();
    
    // Top tier financial sources
    const topTier = ['bloomberg', 'reuters', 'wsj', 'financial times', 'ft.com'];
    if (topTier.some(s => sourceLower.includes(s))) {
      return { score: 90, rating: 'high' };
    }
    
    // Second tier financial sources
    const secondTier = ['cnbc', 'marketwatch', 'seeking alpha', 'yahoo finance'];
    if (secondTier.some(s => sourceLower.includes(s))) {
      return { score: 80, rating: 'good' };
    }
    
    // General news sources
    const generalNews = ['nytimes', 'cnn', 'bbc', 'forbes'];
    if (generalNews.some(s => sourceLower.includes(s))) {
      return { score: 70, rating: 'medium' };
    }
    
    // Default for unknown sources
    return { score: 50, rating: 'unknown' };
  }

  detectOpinionContent(article) {
    const opinionKeywords = [
      'opinion',
      'analysis',
      'commentary',
      'perspective',
      'viewpoint',
      'editorial',
      'column'
    ];
    
    const content = [
      article.title || '',
      article.description || '',
      article.content || ''
    ].join(' ').toLowerCase();
    
    return opinionKeywords.some(keyword => content.includes(keyword));
  }

  async assessBias(article) {
    const content = [
      article.title || '',
      article.description || '',
      article.content || ''
    ].join(' ').toLowerCase();
    
    // Assess political bias
    let politicalBias = 'neutral';
    const leftBias = ['progressive', 'liberal', 'left-wing'];
    const rightBias = ['conservative', 'right-wing'];
    
    if (leftBias.some(term => content.includes(term))) {
      politicalBias = 'left-leaning';
    } else if (rightBias.some(term => content.includes(term))) {
      politicalBias = 'right-leaning';
    }
    
    // Assess sensationalism
    let sensationalism = 'low';
    const sensationalWords = [
      'shocking',
      'explosive',
      'incredible',
      'amazing',
      'revolutionary',
      'game-changing'
    ];
    
    const sensationalCount = sensationalWords.filter(word => 
      content.includes(word)
    ).length;
    
    if (sensationalCount > 3) {
      sensationalism = 'high';
    } else if (sensationalCount > 1) {
      sensationalism = 'medium';
    }
    
    return {
      politicalBias,
      sensationalism
    };
  }

  extractMetrics(article) {
    const content = [
      article.title || '',
      article.description || '',
      article.content || ''
    ].join(' ');
    
    const metrics = {
      percentages: [],
      prices: [],
      dates: []
    };
    
    // Extract percentages
    const percentageRegex = /(-?\d+\.?\d*)\s*%/g;
    let match;
    while ((match = percentageRegex.exec(content)) !== null) {
      metrics.percentages.push(parseFloat(match[1]));
    }
    
    // Extract prices
    const priceRegex = /\$\s*(\d+\.?\d*)/g;
    while ((match = priceRegex.exec(content)) !== null) {
      metrics.prices.push(parseFloat(match[1]));
    }
    
    // Extract dates
    const dateRegex = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
    while ((match = dateRegex.exec(content)) !== null) {
      metrics.dates.push(match[0]);
    }
    
    return metrics;
  }
}

module.exports = SerpApiService; 