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

  async getDailyPrices(symbol) {
    try {
      const now = new Date();
      const yesterday = new Date(now.setDate(now.getDate() - 1));
      const formattedDate = yesterday.toISOString().split('T')[0];

      const aggs = await this.client.stocks.aggregates(
        symbol,
        1,
        'day',
        formattedDate,
        formattedDate
      );
      return aggs.results;
    } catch (error) {
      console.error('Error fetching stock prices:', error);
      throw error;
    }
  }
}

module.exports = new PolygonService(); 