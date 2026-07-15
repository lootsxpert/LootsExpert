require('dotenv').config();
const { predictPriceHistoryWithGemini, scrapeProductDirectOnly } = require('./scraper');

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ ERROR: GEMINI_API_KEY is not defined in api/.env or environment.");
    console.log("Please add GEMINI_API_KEY=your_key to api/.env and run again.");
    process.exit(1);
  }

  console.log("✅ GEMINI_API_KEY is defined. Proceeding with tests...");

  try {
    console.log("\n--- Testing predictPriceHistoryWithGemini ---");
    const testTitle = "Mast & Harbour Oversized Shoulder Bag";
    const testUrl = "https://www.myntra.com/35159415";
    const result = await predictPriceHistoryWithGemini(testUrl, testTitle, 927, 3199);
    
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      console.log(`✅ Success! Predicted ${result.dataPoints.length} data points.`);
      console.log("Sample Data Point:", result.dataPoints[0]);
    } else {
      console.error("❌ Failed to predict price history.");
    }
  } catch (e) {
    console.error("❌ Exception during prediction test:", e.message);
  }

  try {
    console.log("\n--- Testing scrapeProductDirectOnly with Gemini fallback ---");
    const testUrl = "https://www.myntra.com/35159415";
    const result = await scrapeProductDirectOnly(testUrl);
    
    if (result && result.title) {
      console.log("✅ Success! Scraped product details:");
      console.log(" - Title:", result.title);
      console.log(" - Price:", result.price);
      console.log(" - Image:", result.image);
      console.log(" - Platform:", result.platform);
    } else {
      console.error("❌ Failed to scrape product direct only.");
    }
  } catch (e) {
    console.error("❌ Exception during direct scraping test:", e.message);
  }
}

testGemini();
