const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { scrapeProduct, scrapeHistoricalTracker } = require('./scraper');
const { 
  initDatabase, 
  getProductByUrl, 
  saveProduct, 
  getPriceHistory, 
  addPriceLogIfChanged, 
  importPriceHistoryBatch,
  updateProductHistoryUrl,
  redisClient
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Normalize URLs to avoid duplicate entries for the same product
function getCanonicalUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Amazon normalization
    if (parsed.hostname.includes('amazon.in') || parsed.hostname.includes('amazon.com')) {
      const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        return `https://www.amazon.in/dp/${asinMatch[1]}`;
      }
    }
    
    // Flipkart normalization
    if (parsed.hostname.includes('flipkart.com')) {
      const pid = parsed.searchParams.get('pid');
      // Strip everything except pathname and pid
      let canonical = `https://www.flipkart.com${parsed.pathname}`;
      if (pid) {
        canonical += `?pid=${pid}`;
      }
      return canonical;
    }
    
    return url;
  } catch (e) {
    return url;
  }
}

// Endpoint: Scrape product details & manage history
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Product URL is required. Query parameter ?url=...'
    });
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format. URL must start with http:// or https://'
    });
  }

  const canonicalUrl = getCanonicalUrl(url);

  try {
    // 1. Scrape the live product page
    const scrapeResult = await scrapeProduct(canonicalUrl);
    if (!scrapeResult.success) {
      return res.status(500).json(scrapeResult);
    }

    // 2. Save product info and log price
    const savedProduct = await saveProduct({
      url: canonicalUrl,
      platform: scrapeResult.platform,
      title: scrapeResult.title,
      image: scrapeResult.image,
      rating: scrapeResult.rating
    });

    if (savedProduct) {
      // Delta logging: only add price point if it changed
      await addPriceLogIfChanged(savedProduct.id, scrapeResult.price);

      // Trigger background tracker scraping in parallel if not done recently, passing title fallback
      triggerBackgroundTrackerScrape(savedProduct.id, canonicalUrl, scrapeResult.title);

      // Fetch the compiled price history list
      const dbHistory = await getPriceHistory(savedProduct.id);
      scrapeResult.history = dbHistory;
      scrapeResult.historyUrl = savedProduct.history_url || null;

      // Determine history source for client badge
      const hasOldEntries = dbHistory.some(h => (new Date() - new Date(h.timestamp)) > 24 * 60 * 60 * 1000);
      scrapeResult.historySource = hasOldEntries ? 'PriceBefore' : 'LootsExpert';
    }

    return res.json(scrapeResult);
  } catch (err) {
    console.error('[Server Error]', err);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred: ' + err.message
    });
  }
});

/**
 * Run tracker scrape in background using Redis locks/coordination
 */
async function triggerBackgroundTrackerScrape(productId, canonicalUrl, productTitle) {
  const redisKey = `tracker_check:${productId}`;
  
  try {
    if (redisClient && redisClient.isOpen) {
      // Check if we've already tried importing for this product in the last 24h
      const exists = await redisClient.get(redisKey);
      if (exists) {
        return;
      }
      // Set lock for 24 hours (86400 seconds)
      await redisClient.set(redisKey, 'true', { EX: 86400 });
    }
    
    // Execute tracker scrape asynchronously
    console.log(`[Background] Launching parallel tracker scrape for product ID ${productId}...`);
    scrapeHistoricalTracker(canonicalUrl, productTitle).then(async (resultObj) => {
      if (resultObj && resultObj.dataPoints && resultObj.dataPoints.length > 0) {
        // Save the external history page URL in our products table
        await updateProductHistoryUrl(productId, resultObj.url);

        // Map points to fit database structure
        const formattedPoints = resultObj.dataPoints.map(p => ({
          price: p.price,
          timestamp: p.timestamp
        }));
        await importPriceHistoryBatch(productId, formattedPoints);
      }
    }).catch(err => {
      console.error(`[Background Error] Tracker scrape failed for product ${productId}:`, err.message);
    });
  } catch (err) {
    console.error('[Background Manager Error]', err);
  }
}

// Start database and start listening
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 LootsExpert API running on: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
});
