/**
 * Source Validation Service
 * 
 * This service validates news sources for credibility and helps filter out potentially
 * biased or unreliable sources. It uses a combination of:
 * 1. Known source reputation database
 * 2. Text analysis for bias detection
 * 3. Domain validation
 * 4. Content-based heuristics
 */

class SourceValidationService {
  constructor() {
    // Media Bias/Fact Check inspired ratings
    // These are simplified versions of MBFC categories
    this.sourceReliabilityDatabase = {
      // High reliability sources
      'reuters.com': { reliability: 'high', bias: 'minimal', factualReporting: 'very high' },
      'ap.org': { reliability: 'high', bias: 'minimal', factualReporting: 'very high' },
      'apnews.com': { reliability: 'high', bias: 'minimal', factualReporting: 'very high' },
      'bloomberg.com': { reliability: 'high', bias: 'minimal', factualReporting: 'high' },
      'wsj.com': { reliability: 'high', bias: 'center-right', factualReporting: 'high' },
      'ft.com': { reliability: 'high', bias: 'center', factualReporting: 'high' },
      'cnbc.com': { reliability: 'high', bias: 'center', factualReporting: 'high' },
      'economist.com': { reliability: 'high', bias: 'center', factualReporting: 'very high' },
      'barrons.com': { reliability: 'high', bias: 'center-right', factualReporting: 'high' },
      'morningstar.com': { reliability: 'high', bias: 'center', factualReporting: 'high' },
      'seekingalpha.com': { reliability: 'medium', bias: 'center', factualReporting: 'high' },
      'marketwatch.com': { reliability: 'high', bias: 'center', factualReporting: 'high' },
      'investors.com': { reliability: 'medium', bias: 'right', factualReporting: 'mostly factual' },
      'fool.com': { reliability: 'high', bias: 'center', factualReporting: 'high' },
      'investopedia.com': { reliability: 'high', bias: 'minimal', factualReporting: 'very high' },
      
      // Medium reliability sources
      'businessinsider.com': { reliability: 'medium', bias: 'center-left', factualReporting: 'mostly factual' },
      'forbes.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      'yahoo.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      'finance.yahoo.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      'cnn.com': { reliability: 'medium', bias: 'left', factualReporting: 'mostly factual' },
      'foxbusiness.com': { reliability: 'medium', bias: 'right', factualReporting: 'mostly factual' },
      'thestreet.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      'benzinga.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      'zacks.com': { reliability: 'medium', bias: 'center', factualReporting: 'high' },
      'marketbeat.com': { reliability: 'medium', bias: 'center', factualReporting: 'mostly factual' },
      
      // Lower reliability sources (more caution needed)
      'thefool.com': { reliability: 'low', bias: 'center', factualReporting: 'mixed' },
      'thefly.com': { reliability: 'low', bias: 'center', factualReporting: 'mixed' },
      'investorplace.com': { reliability: 'low', bias: 'center', factualReporting: 'mixed' },
      'stocktwits.com': { reliability: 'low', bias: 'center', factualReporting: 'mixed' },
      'reddit.com': { reliability: 'low', bias: 'varies', factualReporting: 'mixed' },
      
      // Default for unknown sources
      'default': { reliability: 'unknown', bias: 'unknown', factualReporting: 'unknown' }
    };
    
    // Terms that might indicate bias
    this.biasIndicators = {
      leftBias: [
        'progressive', 'liberal', 'socialism', 'leftist', 'radical',
        'woke', 'democratic socialism', 'far-left'
      ],
      rightBias: [
        'conservative', 'right-wing', 'traditional', 'nationalist', 
        'far-right', 'alt-right', 'patriot'
      ],
      sensationalism: [
        'breaking', 'shocking', 'bombshell', 'explosive', 'outrageous',
        'unbelievable', 'jaw-dropping', 'stunning', 'mind-blowing',
        'exclusive', 'scandal', 'catastrophic', 'disaster', 'crisis'
      ]
    };
    
    // Terms that indicate opinion rather than fact
    this.opinionIndicators = [
      'opinion', 'editorial', 'commentary', 'perspective', 'viewpoint',
      'analysis', 'our take', 'we believe', 'we think', 'in our view'
    ];
  }

  /**
   * Evaluate an article's source for reliability
   * @param {Object} article - The article to validate
   * @returns {Object} The article with added credibility metrics
   */
  validateArticleSource(article) {
    if (!article || !article.url) {
      return { ...article, sourceCredibility: 'unknown', biasAssessment: 'unknown' };
    }
    
    // Extract domain from URL
    const domain = this.extractDomain(article.url);
    
    // Check domain against known source database
    const sourceInfo = this.getSourceInfo(domain);
    
    // Check for bias indicators in content
    const biasAssessment = this.assessContentBias(article);
    
    // Generate a credibility score
    const credibilityScore = this.calculateCredibilityScore(sourceInfo, biasAssessment);
    
    // Return article with added credibility information
    return {
      ...article,
      sourceCredibility: sourceInfo,
      biasAssessment,
      credibilityScore,
      isOpinionContent: this.isLikelyOpinion(article)
    };
  }
  
  /**
   * Extract domain from a URL
   * @param {string} url - Full article URL
   * @returns {string} Domain name
   */
  extractDomain(url) {
    try {
      // Remove protocol and get domain
      const domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0].toLowerCase();
      return domain;
    } catch (error) {
      console.error('Error extracting domain:', error);
      return '';
    }
  }
  
  /**
   * Get source information from the database
   * @param {string} domain - Domain name
   * @returns {Object} Source reliability information
   */
  getSourceInfo(domain) {
    // Check exact domain match
    if (this.sourceReliabilityDatabase[domain]) {
      return this.sourceReliabilityDatabase[domain];
    }
    
    // Check for partial domain matches
    for (const knownDomain in this.sourceReliabilityDatabase) {
      if (domain.includes(knownDomain) || knownDomain.includes(domain)) {
        return this.sourceReliabilityDatabase[knownDomain];
      }
    }
    
    // Return default if no match
    return this.sourceReliabilityDatabase['default'];
  }
  
  /**
   * Assess content for bias based on text analysis
   * @param {Object} article - Article object with title and description/content
   * @returns {Object} Bias assessment
   */
  assessContentBias(article) {
    const text = (article.title + ' ' + (article.description || article.content || '')).toLowerCase();
    
    // Check for bias indicators
    const leftBiasTerms = this.biasIndicators.leftBias.filter(term => text.includes(term));
    const rightBiasTerms = this.biasIndicators.rightBias.filter(term => text.includes(term));
    const sensationalismTerms = this.biasIndicators.sensationalism.filter(term => text.includes(term));
    
    // Calculate bias scores
    const leftBiasScore = leftBiasTerms.length;
    const rightBiasScore = rightBiasTerms.length;
    const sensationalismScore = sensationalismTerms.length;
    
    // Determine political leaning bias
    let politicalBias = 'neutral';
    if (leftBiasScore > 0 && leftBiasScore > rightBiasScore) {
      politicalBias = leftBiasScore >= 2 ? 'strong-left' : 'moderate-left';
    } else if (rightBiasScore > 0 && rightBiasScore > leftBiasScore) {
      politicalBias = rightBiasScore >= 2 ? 'strong-right' : 'moderate-right';
    }
    
    // Determine sensationalism level
    let sensationalism = 'low';
    if (sensationalismScore >= 3) {
      sensationalism = 'high';
    } else if (sensationalismScore >= 1) {
      sensationalism = 'moderate';
    }
    
    return {
      politicalBias,
      sensationalism,
      leftBiasTerms,
      rightBiasTerms,
      sensationalismTerms
    };
  }
  
  /**
   * Check if content is likely an opinion piece rather than factual reporting
   * @param {Object} article - Article to analyze
   * @returns {boolean} Whether it's likely opinion content
   */
  isLikelyOpinion(article) {
    const text = (article.title + ' ' + (article.description || article.content || '')).toLowerCase();
    
    // Check for opinion indicators
    return this.opinionIndicators.some(term => text.includes(term));
  }
  
  /**
   * Calculate a numeric credibility score based on source and content analysis
   * @param {Object} sourceInfo - Source reliability info
   * @param {Object} biasAssessment - Content bias assessment
   * @returns {Object} Credibility evaluation
   */
  calculateCredibilityScore(sourceInfo, biasAssessment) {
    // Start with base score based on known source reliability
    let baseScore = 50; // Default for unknown sources
    
    // Adjust base score based on known reliability
    if (sourceInfo.reliability === 'high') {
      baseScore = 80;
    } else if (sourceInfo.reliability === 'medium') {
      baseScore = 65;
    } else if (sourceInfo.reliability === 'low') {
      baseScore = 40;
    }
    
    // Adjust for factual reporting level
    if (sourceInfo.factualReporting === 'very high') {
      baseScore += 15;
    } else if (sourceInfo.factualReporting === 'high') {
      baseScore += 10;
    } else if (sourceInfo.factualReporting === 'mostly factual') {
      baseScore += 5;
    } else if (sourceInfo.factualReporting === 'mixed') {
      baseScore -= 10;
    } else if (sourceInfo.factualReporting === 'low') {
      baseScore -= 20;
    }
    
    // Adjust for sensationalism
    if (biasAssessment.sensationalism === 'high') {
      baseScore -= 15;
    } else if (biasAssessment.sensationalism === 'moderate') {
      baseScore -= 7;
    }
    
    // Adjust for strong political bias
    if (biasAssessment.politicalBias === 'strong-left' || biasAssessment.politicalBias === 'strong-right') {
      baseScore -= 10;
    } else if (biasAssessment.politicalBias === 'moderate-left' || biasAssessment.politicalBias === 'moderate-right') {
      baseScore -= 5;
    }
    
    // Cap score between 0 and 100
    const finalScore = Math.max(0, Math.min(100, baseScore));
    
    // Generate a text rating
    let rating;
    if (finalScore >= 80) {
      rating = 'high credibility';
    } else if (finalScore >= 65) {
      rating = 'credible';
    } else if (finalScore >= 50) {
      rating = 'moderate credibility';
    } else if (finalScore >= 30) {
      rating = 'questionable';
    } else {
      rating = 'low credibility';
    }
    
    return {
      score: finalScore,
      rating
    };
  }
  
  /**
   * Filter a list of articles based on credibility requirements
   * @param {Array} articles - List of articles to filter
   * @param {Object} options - Filtering options
   * @returns {Array} Filtered articles
   */
  filterArticlesByCredibility(articles, options = {}) {
    const {
      minCredibilityScore = 50,
      excludeOpinions = false,
      maxSensationalism = 'high',
      balanceBias = false
    } = options;
    
    // First, validate all articles
    const validatedArticles = articles.map(article => this.validateArticleSource(article));
    
    // Filter by credibility score
    let filteredArticles = validatedArticles.filter(article => 
      article.credibilityScore && article.credibilityScore.score >= minCredibilityScore);
    
    // Optionally exclude opinion pieces
    if (excludeOpinions) {
      filteredArticles = filteredArticles.filter(article => !article.isOpinionContent);
    }
    
    // Filter by sensationalism level
    if (maxSensationalism === 'low') {
      filteredArticles = filteredArticles.filter(article => 
        article.biasAssessment && article.biasAssessment.sensationalism === 'low');
    } else if (maxSensationalism === 'moderate') {
      filteredArticles = filteredArticles.filter(article => 
        article.biasAssessment && ['low', 'moderate'].includes(article.biasAssessment.sensationalism));
    }
    
    // Option to balance political bias in the results
    if (balanceBias && filteredArticles.length > 1) {
      // Count articles by bias
      const biasCounts = {
        left: filteredArticles.filter(a => 
          a.biasAssessment && ['moderate-left', 'strong-left'].includes(a.biasAssessment.politicalBias)).length,
        right: filteredArticles.filter(a => 
          a.biasAssessment && ['moderate-right', 'strong-right'].includes(a.biasAssessment.politicalBias)).length,
        neutral: filteredArticles.filter(a => 
          a.biasAssessment && a.biasAssessment.politicalBias === 'neutral').length
      };
      
      // If imbalanced, try to create a more balanced set
      if (Math.abs(biasCounts.left - biasCounts.right) > 1) {
        // Sort by credibility score
        filteredArticles.sort((a, b) => b.credibilityScore.score - a.credibilityScore.score);
        
        // Create a balanced set prioritizing higher credibility
        const balancedSet = [];
        const leftBiased = filteredArticles.filter(a => 
          a.biasAssessment && ['moderate-left', 'strong-left'].includes(a.biasAssessment.politicalBias));
        const rightBiased = filteredArticles.filter(a => 
          a.biasAssessment && ['moderate-right', 'strong-right'].includes(a.biasAssessment.politicalBias));
        const neutral = filteredArticles.filter(a => 
          a.biasAssessment && a.biasAssessment.politicalBias === 'neutral');
        
        // Add neutral articles first
        balancedSet.push(...neutral);
        
        // Add equal numbers of left and right articles
        const countToAdd = Math.min(leftBiased.length, rightBiased.length);
        for (let i = 0; i < countToAdd; i++) {
          balancedSet.push(leftBiased[i]);
          balancedSet.push(rightBiased[i]);
        }
        
        // Add any remaining articles up to the original count, prioritizing highest credibility
        const remaining = filteredArticles.filter(a => !balancedSet.includes(a))
          .sort((a, b) => b.credibilityScore.score - a.credibilityScore.score);
        
        balancedSet.push(...remaining.slice(0, filteredArticles.length - balancedSet.length));
        
        // Use the balanced set if we didn't lose too many articles
        if (balancedSet.length >= filteredArticles.length * 0.7) {
          filteredArticles = balancedSet;
        }
      }
    }
    
    return filteredArticles;
  }
}

module.exports = new SourceValidationService(); 