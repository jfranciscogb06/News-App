const SerpApiService = require('../services/serpApiService');
require('dotenv').config();

async function testDateParsing() {
    const serpApiService = new SerpApiService();
    
    // Test cases with different date formats
    const testDates = [
        "2 hours ago",
        "3 days ago",
        "1 week ago",
        "2 months ago",
        "5 minutes ago",
        "yesterday",
        "Apr 14, 2024"
    ];

    console.log("Testing date parsing...\n");
    
    testDates.forEach(dateStr => {
        const parsedDate = serpApiService.parseRelativeDate(dateStr);
        console.log(`Input: "${dateStr}"`);
        console.log(`Parsed: ${parsedDate.toISOString()}\n`);
    });
}

// Run the test
testDateParsing()
    .then(() => console.log("Test completed successfully"))
    .catch(error => console.error("Test failed:", error)); 