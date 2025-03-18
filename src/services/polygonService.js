const { restClient } = require('@polygon.io/client-js');
const config = require('../config/config');

class PolygonService {
  constructor() {
    this.client = restClient(config.polygon.apiKey);
  }

  async getStockDetails(symbol) {
    try {
      const ticker = await this.client.reference.tickerDetails(symbol);
      return ticker.results;
    } catch (error) {
      console.error('Error fetching stock details:', error);
      throw error;
    }
  }

  async getDailyPrices(symbol, days = 30) {
    try {
      const now = new Date();
      const startDate = new Date(now.setDate(now.getDate() - days));
      const endDate = new Date();
      
      const formattedStartDate = startDate.toISOString().split('T')[0];
      const formattedEndDate = endDate.toISOString().split('T')[0];

      const aggs = await this.client.stocks.aggregates(
        symbol,
        1,
        'day',
        formattedStartDate,
        formattedEndDate
      );
      return aggs.results;
    } catch (error) {
      console.error('Error fetching stock prices:', error);
      throw error;
    }
  }

  async getTechnicalIndicators(symbol, days = 30) {
    try {
      const prices = await this.getDailyPrices(symbol, days);
      if (!prices || prices.length === 0) {
        throw new Error('No price data available');
      }

      // Calculate basic technical indicators
      const indicators = {
        sma: this.calculateSMA(prices, 20),
        rsi: this.calculateRSI(prices, 14),
        macd: this.calculateMACD(prices),
        volumeProfile: this.calculateVolumeProfile(prices),
        priceMomentum: this.calculatePriceMomentum(prices),
        volatility: this.calculateVolatility(prices)
      };

      return indicators;
    } catch (error) {
      console.error('Error calculating technical indicators:', error);
      throw error;
    }
  }

  calculateSMA(prices, period) {
    if (prices.length < period) return null;
    
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((acc, price) => acc + price.c, 0);
      sma.push(sum / period);
    }
    
    return {
      current: sma[sma.length - 1],
      trend: sma[sma.length - 1] > sma[sma.length - 2] ? 'up' : 'down',
      values: sma
    };
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i].c - prices[i - 1].c);
    }

    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? -change : 0);

    const avgGain = gains.slice(0, period).reduce((acc, gain) => acc + gain, 0) / period;
    const avgLoss = losses.slice(0, period).reduce((acc, loss) => acc + loss, 0) / period;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return {
      current: rsi,
      trend: rsi > 50 ? 'up' : 'down',
      overbought: rsi > 70,
      oversold: rsi < 30
    };
  }

  calculateMACD(prices) {
    if (prices.length < 26) return null;

    // Calculate 12-day and 26-day EMAs
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    // Calculate MACD line
    const macdLine = ema12 - ema26;
    
    // Calculate 9-day EMA of MACD line (signal line)
    const signalLine = this.calculateEMA([{ c: macdLine }], 9);

    // Calculate histogram
    const histogram = macdLine - signalLine;

    return {
      macdLine,
      signalLine,
      histogram,
      trend: macdLine > signalLine ? 'up' : 'down',
      crossover: macdLine > signalLine && macdLine - signalLine > 0
    };
  }

  calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    let ema = prices[0].c;

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i].c - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateVolumeProfile(prices) {
    const volumeProfile = {
      highVolume: prices.reduce((acc, price) => acc + price.v, 0) / prices.length,
      volumeTrend: prices[prices.length - 1].v > prices[prices.length - 2].v ? 'up' : 'down',
      averageVolume: prices.reduce((acc, price) => acc + price.v, 0) / prices.length
    };

    return volumeProfile;
  }

  calculatePriceMomentum(prices) {
    const momentum = {
      shortTerm: prices[prices.length - 1].c - prices[prices.length - 5].c,
      mediumTerm: prices[prices.length - 1].c - prices[prices.length - 10].c,
      longTerm: prices[prices.length - 1].c - prices[prices.length - 20].c
    };

    return momentum;
  }

  calculateVolatility(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i].c - prices[i - 1].c) / prices[i - 1].c);
    }

    const mean = returns.reduce((acc, ret) => acc + ret, 0) / returns.length;
    const variance = returns.reduce((acc, ret) => acc + Math.pow(ret - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility

    return {
      current: volatility,
      trend: volatility > 0.2 ? 'high' : 'low',
      value: volatility
    };
  }

  async getHistoricalPatterns(symbol, days = 90) {
    try {
      const prices = await this.getDailyPrices(symbol, days);
      if (!prices || prices.length === 0) {
        throw new Error('No price data available');
      }

      const patterns = {
        supportLevels: this.findSupportLevels(prices),
        resistanceLevels: this.findResistanceLevels(prices),
        trendStrength: this.calculateTrendStrength(prices),
        priceChannels: this.identifyPriceChannels(prices)
      };

      return patterns;
    } catch (error) {
      console.error('Error analyzing historical patterns:', error);
      throw error;
    }
  }

  findSupportLevels(prices) {
    const levels = [];
    for (let i = 2; i < prices.length - 2; i++) {
      if (prices[i].c < prices[i - 1].c && prices[i].c < prices[i - 2].c &&
          prices[i].c < prices[i + 1].c && prices[i].c < prices[i + 2].c) {
        levels.push(prices[i].c);
      }
    }
    return levels;
  }

  findResistanceLevels(prices) {
    const levels = [];
    for (let i = 2; i < prices.length - 2; i++) {
      if (prices[i].c > prices[i - 1].c && prices[i].c > prices[i - 2].c &&
          prices[i].c > prices[i + 1].c && prices[i].c > prices[i + 2].c) {
        levels.push(prices[i].c);
      }
    }
    return levels;
  }

  calculateTrendStrength(prices) {
    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);
    
    if (!sma20 || !sma50) return null;

    const currentPrice = prices[prices.length - 1].c;
    const strength = (currentPrice - sma20.current) / sma20.current;

    return {
      value: strength,
      trend: strength > 0 ? 'up' : 'down',
      strength: Math.abs(strength)
    };
  }

  identifyPriceChannels(prices) {
    const channels = [];
    let currentChannel = {
      upper: prices[0].c,
      lower: prices[0].c,
      start: 0
    };

    for (let i = 1; i < prices.length; i++) {
      if (prices[i].c > currentChannel.upper) {
        currentChannel.upper = prices[i].c;
      }
      if (prices[i].c < currentChannel.lower) {
        currentChannel.lower = prices[i].c;
      }

      // If channel is too wide, start a new one
      if (currentChannel.upper - currentChannel.lower > currentChannel.upper * 0.1) {
        channels.push({
          ...currentChannel,
          end: i - 1
        });
        currentChannel = {
          upper: prices[i].c,
          lower: prices[i].c,
          start: i
        };
      }
    }

    // Add the last channel
    channels.push({
      ...currentChannel,
      end: prices.length - 1
    });

    return channels;
  }
}

module.exports = new PolygonService(); 