require('dotenv').config();
const stockController = require('./src/controllers/stockController');
const logger = require('./src/utils/logger');
const cacheService = require('./src/services/cacheService');

async function runTests() {
    const symbol = 'AAPL';
    const numRuns = 10;
    const results = [];
    const errors = [];
    let cacheHits = 0;
    let freshAnalyses = 0;

    console.log(`Starting ${numRuns} test runs for ${symbol}...\n`);

    // Clear cache for AAPL first
    console.log('Clearing cache for AAPL...');
    await cacheService.clearSymbolCache(symbol);
    console.log('Cache cleared, starting tests...\n');

    const startTime = Date.now();

    for (let i = 0; i < numRuns; i++) {
        console.log(`\nTest Run ${i + 1}/${numRuns}`);
        const runStartTime = Date.now();

        try {
            const req = { params: { symbol } };
            const res = {
                json: (data) => {
                    const runTime = (Date.now() - runStartTime) / 1000;
                    const isCached = data.source === 'cache';
                    if (isCached) cacheHits++;
                    else freshAnalyses++;

                    results.push({
                        run: i + 1,
                        time: runTime,
                        source: data.source,
                        articles: data.articles?.length || 0,
                        timeframes: Object.keys(data.sentimentAnalysis || {}).length,
                        isCached
                    });

                    console.log(`Run ${i + 1} completed in ${runTime.toFixed(2)}s`);
                    console.log(`Source: ${data.source}, Articles: ${data.articles?.length || 0}, Timeframes: ${Object.keys(data.sentimentAnalysis || {}).length}`);
                }
            };

            await stockController.analyzeStock(req, res);
        } catch (error) {
            errors.push({
                run: i + 1,
                error: error.message
            });
            console.error(`Error in run ${i + 1}:`, error.message);
        }
    }

    const totalTime = (Date.now() - startTime) / 1000;

    console.log('\nTest Summary:');
    console.log('-------------');
    console.log(`Total runs: ${numRuns}`);
    console.log(`Successful runs: ${results.length}`);
    console.log(`Failed runs: ${errors.length}`);
    console.log(`Total time: ${totalTime.toFixed(2)}s`);
    console.log(`Average time per run: ${(totalTime / numRuns).toFixed(2)}s`);
    console.log(`Cache hits: ${cacheHits}`);
    console.log(`Fresh analyses: ${freshAnalyses}`);
    console.log(`Cache hit rate: ${((cacheHits / numRuns) * 100).toFixed(2)}%`);

    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(err => {
            console.log(`Run ${err.run}: ${err.error}`);
        });
    }
}

runTests().catch(console.error); 