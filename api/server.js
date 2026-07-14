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
  updateProductDealStats,
  pool,
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

const http = require('http');
const https = require('https');
const urlModule = require('url');

// Expand short URLs dynamically
function expandUrl(shortUrl) {
  return new Promise((resolve) => {
    let redirectsCount = 0;
    
    function follow(urlStr) {
      if (redirectsCount >= 10) {
        resolve(urlStr);
        return;
      }
      
      let parsed;
      try {
        parsed = new urlModule.URL(urlStr);
      } catch (err) {
        resolve(urlStr);
        return;
      }
      
      const client = parsed.protocol === 'https:' ? https : http;
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      };
      
      const req = client.request(urlStr, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectsCount++;
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            nextUrl = new urlModule.URL(nextUrl, urlStr).href;
          }
          follow(nextUrl);
        } else {
          let finalUrl = urlStr;
          try {
            const urlObj = new urlModule.URL(urlStr);
            const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
            for (const param of paramsToCheck) {
              const val = urlObj.searchParams.get(param);
              if (val && val.startsWith('http')) {
                finalUrl = decodeURIComponent(val);
                break;
              }
            }
          } catch (e) {}
          resolve(finalUrl);
        }
      });
      
      req.on('error', (err) => {
        resolve(urlStr);
      });
      
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(urlStr);
      });
      
      req.end();
    }
    
    follow(shortUrl);
  }).then(async (resolved) => {
    // If direct resolve failed to expand (returned same URL), try ScraperAPI first
    if (resolved === shortUrl) {
      const scraperApiKey = process.env.SCRAPERAPI_KEY || process.env.SCRAPER_API_KEY;
      if (scraperApiKey) {
        try {
          const axios = require('axios');
          console.log(`[Proxy Expand] Trying ScraperAPI for: ${shortUrl}`);
          const res = await axios.get('http://api.scraperapi.com', {
            params: {
              api_key: scraperApiKey,
              url: shortUrl,
              follow_redirect: 'false'
            },
            timeout: 12000
          });
          if (res.headers && res.headers['sa-final-url']) {
            let finalUrl = res.headers['sa-final-url'];
            try {
              const urlObj = new URL(finalUrl);
              const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
              for (const param of paramsToCheck) {
                const val = urlObj.searchParams.get(param);
                if (val && val.startsWith('http')) {
                  finalUrl = decodeURIComponent(val);
                  break;
                }
              }
            } catch (e) {}
            console.log(`[Proxy Expand] ScraperAPI successfully resolved: ${finalUrl}`);
            return finalUrl;
          }
        } catch (e) {
          console.warn(`[Proxy Expand] ScraperAPI failed: ${e.message}. Trying ScrapingBee fallback...`);
        }
      }
      
      // Fallback: ScrapingBee
      const scrapingBeeKey = process.env.SCRAPINGBEE_KEY || process.env.SCRAPING_BEE_KEY;
      if (scrapingBeeKey) {
        try {
          const axios = require('axios');
          console.log(`[Proxy Expand] Trying ScrapingBee fallback for: ${shortUrl}`);
          const res = await axios.get('https://app.scrapingbee.com/api/v1/', {
            params: {
              api_key: scrapingBeeKey,
              url: shortUrl
            },
            timeout: 15000
          });
          if (res.headers && res.headers['spb-resolved-url']) {
            let finalUrl = res.headers['spb-resolved-url'];
            try {
              const urlObj = new URL(finalUrl);
              const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
              for (const param of paramsToCheck) {
                const val = urlObj.searchParams.get(param);
                if (val && val.startsWith('http')) {
                  finalUrl = decodeURIComponent(val);
                  break;
                }
              }
            } catch (e) {}
            console.log(`[Proxy Expand] ScrapingBee successfully resolved: ${finalUrl}`);
            return finalUrl;
          }
        } catch (e) {
          console.error(`[Proxy Expand] ScrapingBee failed: ${e.message}`);
        }
      }
    }
    return resolved;
  });
}

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
      let canonical = `https://www.flipkart.com${parsed.pathname}`;
      if (pid) {
        canonical += `?pid=${pid}`;
      }
      return canonical;
    }

    // Shopsy normalization
    if (parsed.hostname.includes('shopsy.in') || parsed.hostname.includes('shopsy.com')) {
      const pid = parsed.searchParams.get('pid');
      let canonical = `https://www.shopsy.in${parsed.pathname}`;
      if (pid) {
        canonical += `?pid=${pid}`;
      }
      return canonical;
    }

    // Myntra normalization
    if (parsed.hostname.includes('myntra.com')) {
      const match = parsed.pathname.match(/\/(\d+)/);
      if (match) {
        return `https://www.myntra.com/${match[1]}`;
      }
    }

    // Ajio normalization
    if (parsed.hostname.includes('ajio.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9_]+)/i);
      if (match) {
        const cleanPid = match[1].split('_')[0];
        return `https://www.ajio.com/p/${cleanPid}`;
      }
    }

    // Meesho normalization
    if (parsed.hostname.includes('meesho.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/i);
      if (match) {
        return `https://www.meesho.com/p/${match[1]}`;
      }
    }
    
    return url;
  } catch (e) {
    return url;
  }
}

// Endpoint: GET /api/proxy-image (Bypass amazon blocking)
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      timeout: 10000
    });
    
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 24h
    res.send(response.data);
  } catch (err) {
    console.error('[Image Proxy Error]', err.message);
    res.status(500).send('Failed to fetch image');
  }
});

// Endpoint: GET /api/deals (Aggregated Catalog)
app.get('/api/deals', async (req, res) => {
  try {
    const { category, maxPrice, platform, search, sort } = req.query;
    
    let query = 'SELECT * FROM products WHERE current_price IS NOT NULL';
    const params = [];
    
    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    
    if (maxPrice) {
      params.push(parseFloat(maxPrice));
      query += ` AND current_price <= $${params.length}`;
    }
    
    if (platform) {
      params.push(platform);
      query += ` AND platform ILIKE $${params.length}`;
    }
    
    if (search) {
      params.push(`%${search}%`);
      query += ` AND title ILIKE $${params.length}`;
    }
    
    // Sort clause
    if (sort === 'price_asc') {
      query += ' ORDER BY current_price ASC';
    } else if (sort === 'price_desc') {
      query += ' ORDER BY current_price DESC';
    } else if (sort === 'popularity') {
      query += ' ORDER BY rating DESC NULLS LAST, id DESC';
    } else {
      // Default to best deal score (descending)
      query += ' ORDER BY deal_score DESC, id DESC';
    }
    
    const dbRes = await pool.query(query, params);
    
    return res.json({
      success: true,
      count: dbRes.rows.length,
      deals: dbRes.rows
    });
  } catch (err) {
    console.error('[API Error] GET /api/deals:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: GET /api/categories
app.get('/api/categories', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category ASC');
    const categories = dbRes.rows.map(r => r.category);
    return res.json({
      success: true,
      categories
    });
  } catch (err) {
    console.error('[API Error] GET /api/categories:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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

  let canonicalUrl = getCanonicalUrl(url);
  // Expand short URLs dynamically
  const isShort = !canonicalUrl.includes('amazon.in') && !canonicalUrl.includes('flipkart.com') && 
                  !canonicalUrl.includes('shopsy.in') && !canonicalUrl.includes('myntra.com') && 
                  !canonicalUrl.includes('ajio.com') && !canonicalUrl.includes('meesho.com') &&
                  !canonicalUrl.includes('croma.com') && !canonicalUrl.includes('tatacliq.com') &&
                  !canonicalUrl.includes('reliancedigital.in') && !canonicalUrl.includes('nykaa.com');
  if (isShort) {
    console.log(`[API Server] Expanding short URL inside scrape: ${canonicalUrl}`);
    const expanded = await expandUrl(canonicalUrl);
    canonicalUrl = getCanonicalUrl(expanded);
    console.log(`[API Server] Expanded to: ${canonicalUrl}`);
  }

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

      // Trigger background tracker scraping in parallel if not done recently, passing pricing variables
      triggerBackgroundTrackerScrape(
        savedProduct.id, 
        canonicalUrl, 
        scrapeResult.title,
        scrapeResult.price,
        scrapeResult.originalPrice,
        scrapeResult.discount
      );

      // Fetch the compiled price history list
      const dbHistory = await getPriceHistory(savedProduct.id);
      scrapeResult.history = dbHistory;
      scrapeResult.historyUrl = savedProduct.history_url || null;

      // Determine history source for client badge
      const hasOldEntries = dbHistory.some(h => (new Date() - new Date(h.timestamp)) > 24 * 60 * 60 * 1000);
      scrapeResult.historySource = hasOldEntries ? 'PriceBefore' : scrapeResult.platform;
      
      // Update deal scores in products table immediately (will use latest history)
      await updateProductDealStats(
        savedProduct.id, 
        scrapeResult.price, 
        scrapeResult.originalPrice, 
        scrapeResult.discount, 
        scrapeResult.title
      );
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

// Endpoint: GET /api/history
// Retrieves compiled historical data for the Price History Bot
app.get('/api/history', async (req, res) => {
  const { url, platform, pid } = req.query;

  let canonicalUrl = '';
  if (url) {
    canonicalUrl = getCanonicalUrl(url);
  } else if (platform && pid) {
    const store = platform.toLowerCase();
    if (store === 'amazon') canonicalUrl = `https://www.amazon.in/dp/${pid}`;
    else if (store === 'flipkart') canonicalUrl = `https://www.flipkart.com/p/p?pid=${pid}`;
    else if (store === 'shopsy') canonicalUrl = `https://www.shopsy.in/p/p?pid=${pid}`;
    else if (store === 'myntra') canonicalUrl = `https://www.myntra.com/${pid}`;
    else if (store === 'ajio') canonicalUrl = `https://www.ajio.com/p/${cleanAjioPid(pid)}`;
    else if (store === 'meesho') canonicalUrl = `https://www.meesho.com/p/${pid}`;
    else if (store === 'croma') canonicalUrl = `https://www.croma.com/p/${pid}`;
    else if (store === 'tatacliq') canonicalUrl = `https://www.tatacliq.com/p-${pid}`;
    else if (store === 'reliancedigital') canonicalUrl = `https://www.reliancedigital.in/p/${pid}`;
    else if (store === 'nykaa') canonicalUrl = `https://www.nykaa.com/p/${pid}`;
    else if (pid.startsWith('http') || decodeURIComponent(pid).startsWith('http')) {
      canonicalUrl = decodeURIComponent(pid);
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported store platform.' });
    }
  } else {
    return res.status(400).json({ success: false, error: 'Either url or both platform and pid must be provided.' });
  }

  // Expand short URLs dynamically inside history lookup
  const isHistoryShort = !canonicalUrl.includes('amazon.in') && !canonicalUrl.includes('flipkart.com') && 
                         !canonicalUrl.includes('shopsy.in') && !canonicalUrl.includes('myntra.com') && 
                         !canonicalUrl.includes('ajio.com') && !canonicalUrl.includes('meesho.com') &&
                         !canonicalUrl.includes('croma.com') && !canonicalUrl.includes('tatacliq.com') &&
                         !canonicalUrl.includes('reliancedigital.in') && !canonicalUrl.includes('nykaa.com');
  if (isHistoryShort) {
    console.log(`[API Server] Expanding short URL inside history lookup: ${canonicalUrl}`);
    const expandedHistory = await expandUrl(canonicalUrl);
    canonicalUrl = getCanonicalUrl(expandedHistory);
    console.log(`[API Server] History lookup expanded to: ${canonicalUrl}`);
  }

  // Helper helper to strip extra AJIO pid info if needed
  function cleanAjioPid(rawPid) {
    return rawPid.split('_')[0];
  }

  try {
    console.log(`[API History] Fetching history for URL: ${canonicalUrl}`);
    
    // 1. Fetch/Scrape the live details of the product
    const scrapeResult = await scrapeProduct(canonicalUrl);
    if (!scrapeResult.success) {
      return res.status(500).json({ success: false, error: scrapeResult.error });
    }

    // 2. Try to get cached history from our PostgreSQL database first
    let productInDb = await getProductByUrl(canonicalUrl);
    let historyPoints = [];
    
    if (productInDb) {
      historyPoints = await getPriceHistory(productInDb.id);
    }

    // 3. If we don't have enough history in DB, fetch from external provider PriceBefore
    if (historyPoints.length < 5) {
      console.log(`[API History] DB history points (${historyPoints.length}) low. Scrape from PriceBefore...`);
      const externalHistory = await scrapeHistoricalTracker(canonicalUrl, scrapeResult.title, scrapeResult.price);
      
      if (externalHistory && externalHistory.dataPoints && externalHistory.dataPoints.length > 0) {
        if (!productInDb) {
          productInDb = await saveProduct({
            url: canonicalUrl,
            platform: scrapeResult.platform,
            title: scrapeResult.title,
            image: scrapeResult.image,
            rating: scrapeResult.rating
          });
        }
        
        if (productInDb) {
          await updateProductHistoryUrl(productInDb.id, externalHistory.url);
          
          const formattedPoints = externalHistory.dataPoints.map(p => ({
            price: p.price,
            timestamp: p.timestamp
          }));
          await importPriceHistoryBatch(productInDb.id, formattedPoints);
          
          historyPoints = await getPriceHistory(productInDb.id);
        }
      }
    }

    // Add current price point if missing or changed
    const livePrice = parseFloat(scrapeResult.price);
    if (livePrice && !isNaN(livePrice)) {
      if (historyPoints.length > 0) {
        const lastPoint = historyPoints[historyPoints.length - 1];
        if (Math.abs(parseFloat(lastPoint.price) - livePrice) > 0.01) {
          historyPoints.push({
            price: livePrice,
            timestamp: new Date()
          });
        }
      } else {
        historyPoints.push({
          price: livePrice,
          timestamp: new Date()
        });
      }
    }

    return res.json({
      success: true,
      platform: scrapeResult.platform,
      title: scrapeResult.title,
      price: livePrice,
      originalPrice: parseFloat(scrapeResult.originalPrice) || livePrice,
      discount: scrapeResult.discount,
      image: scrapeResult.image,
      rating: scrapeResult.rating,
      history: historyPoints.map(h => ({
        price: parseFloat(h.price),
        date: h.timestamp
      }))
    });
  } catch (err) {
    console.error('[API History Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Run tracker scrape in background using Redis locks/coordination
 */
async function triggerBackgroundTrackerScrape(productId, canonicalUrl, productTitle, currentPrice, originalPrice, discount) {
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
    scrapeHistoricalTracker(canonicalUrl, productTitle, currentPrice).then(async (resultObj) => {
      if (resultObj && resultObj.dataPoints && resultObj.dataPoints.length > 0) {
        // Save the external history page URL in our products table
        await updateProductHistoryUrl(productId, resultObj.url);

        // Map points to fit database structure
        const formattedPoints = resultObj.dataPoints.map(p => ({
          price: p.price,
          timestamp: p.timestamp
        }));
        await importPriceHistoryBatch(productId, formattedPoints);
        
        // Recalculate deal stats now that history is fully imported
        await updateProductDealStats(productId, currentPrice, originalPrice, discount, productTitle);
      }
    }).catch(err => {
      console.error(`[Background Error] Tracker scrape failed for product ${productId}:`, err.message);
    });
  } catch (err) {
    console.error('[Background Manager Error]', err);
  }
}

/**
 * Daily scheduler to crawl and update prices of tracked products
 */
function startDailyScheduler() {
  console.log('[Scheduler] Initializing daily price scan scheduler...');
  
  // Set standard daily checking interval (24 hours)
  const intervalMs = 24 * 60 * 60 * 1000;
  
  setInterval(async () => {
    console.log('[Scheduler] Starting daily price update loop for tracked catalog...');
    try {
      const dbRes = await pool.query('SELECT id, url, title FROM products');
      console.log(`[Scheduler] Found ${dbRes.rows.length} products to re-scrape.`);
      
      for (const product of dbRes.rows) {
        try {
          console.log(`[Scheduler] Updating product: ${product.title || product.url}`);
          const scrapeResult = await scrapeProduct(product.url);
          if (scrapeResult.success) {
            await saveProduct({
              url: product.url,
              platform: scrapeResult.platform,
              title: scrapeResult.title,
              image: scrapeResult.image,
              rating: scrapeResult.rating
            });
            
            await addPriceLogIfChanged(product.id, scrapeResult.price);
            
            await updateProductDealStats(
              product.id,
              scrapeResult.price,
              scrapeResult.originalPrice,
              scrapeResult.discount,
              scrapeResult.title
            );
          }
          // Sleep for 4 seconds to be courteous to target websites
          await new Promise(resolve => setTimeout(resolve, 4000));
        } catch (e) {
          console.error(`[Scheduler Error] Failed to update product URL ${product.url}:`, e.message);
        }
      }
      console.log('[Scheduler] Daily update loop finished successfully.');
    } catch (err) {
      console.error('[Scheduler Error] Failed during daily scan:', err.message);
    }
  }, intervalMs);
}

// Start database and start listening
initDatabase().then(() => {
  startDailyScheduler();
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Price Graph API running on: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
});
