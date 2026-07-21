const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { scrapeProduct, scrapeHistoricalTracker, scrapeProductDirectOnly, predictPriceHistoryWithGemini } = require('./scraper');
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

      // Fallback: Scrape.do
      const scrapeDoKey = process.env.SCRAPEDO_KEY;
      if (scrapeDoKey) {
        try {
          const axios = require('axios');
          console.log(`[Proxy Expand] Trying Scrape.do fallback for: ${shortUrl}`);
          const res = await axios.get('https://api.scrape.do/', {
            params: {
              token: scrapeDoKey,
              url: shortUrl
            },
            timeout: 15000
          });
          if (res.headers && (res.headers['x-final-url'] || res.headers['sa-final-url'] || res.headers['spb-resolved-url'])) {
            let finalUrl = res.headers['x-final-url'] || res.headers['sa-final-url'] || res.headers['spb-resolved-url'] || shortUrl;
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
            console.log(`[Proxy Expand] Scrape.do successfully resolved: ${finalUrl}`);
            return finalUrl;
          }
        } catch (e) {
          console.error(`[Proxy Expand] Scrape.do failed: ${e.message}`);
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
      let pathname = parsed.pathname;
      if (pathname.startsWith('/s/') || pathname.startsWith('/dl/s/')) {
        return url;
      }
      const pid = parsed.searchParams.get('pid');
      if (pathname.startsWith('/dl/')) {
        pathname = pathname.substring(3);
      } else if (pathname === '/dl') {
        pathname = '/';
      }
      let canonical = `https://www.flipkart.com${pathname}`;
      if (pid) {
        canonical += `?pid=${pid}`;
      }
      return canonical;
    }

    // Shopsy normalization
    if (parsed.hostname.includes('shopsy.in') || parsed.hostname.includes('shopsy.com')) {
      const pid = parsed.searchParams.get('pid');
      let path = parsed.pathname;
      if (path === '/open-menu/p/p' || path === '/p/p' || path === '/p' || path === '/open-menu/p') {
        path = '/p/itm';
      }
      let canonical = `https://www.shopsy.in${path}`;
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
      const pathParts = parsed.pathname.split('/');
      const pIndex = pathParts.indexOf('p');
      if (pIndex > 1 && pathParts[pIndex + 1]) {
        return `https://www.ajio.com${parsed.pathname}`;
      }
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9_]+)/i);
      if (match) {
        const cleanPid = match[1].split('_')[0];
        return `https://www.ajio.com/s/p/${cleanPid}`;
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
  const isShort = (!canonicalUrl.includes('amazon.in') && !canonicalUrl.includes('flipkart.com') && 
                  !canonicalUrl.includes('shopsy.in') && !canonicalUrl.includes('myntra.com') && 
                  !canonicalUrl.includes('ajio.com') && !canonicalUrl.includes('meesho.com') &&
                  !canonicalUrl.includes('croma.com') && !canonicalUrl.includes('tatacliq.com') &&
                  !canonicalUrl.includes('reliancedigital.in') && !canonicalUrl.includes('nykaa.com')) ||
                  canonicalUrl.includes('/s/') || canonicalUrl.includes('/dl/s/');
  if (isShort) {
    console.log(`[API Server] Expanding short URL inside scrape: ${canonicalUrl}`);
    const expanded = await expandUrl(canonicalUrl);
    canonicalUrl = getCanonicalUrl(expanded);
    console.log(`[API Server] Expanded to: ${canonicalUrl}`);
  }

  // Resolve any short/reconstructed URLs from database first
  const productInDb = await getProductByUrl(canonicalUrl);
  if (productInDb) {
    console.log(`[API Scrape] Found product in DB. Using resolved URL: ${productInDb.url}`);
    canonicalUrl = productInDb.url;
  }

  try {
    // 1. Scrape the live product page
    let scrapeResult = await scrapeProduct(canonicalUrl);
    
    // Fallback: If live scrape failed, try to get cached product from database or construct fallback
    if (!scrapeResult || !scrapeResult.success) {
      console.warn(`[API Scrape] Live scraping failed for: ${canonicalUrl}. Loading fallback details...`);
      const cachedProduct = await getProductByUrl(canonicalUrl);
      
      let title = cachedProduct?.title;
      let price = cachedProduct?.current_price ? parseFloat(cachedProduct.current_price) : null;
      let originalPrice = cachedProduct?.original_price ? parseFloat(cachedProduct.original_price) : null;
      let image = cachedProduct?.image;
      let rating = cachedProduct?.rating ? parseFloat(cachedProduct.rating) : 4.2;
      let platform = cachedProduct?.platform;
      
      if (!platform) {
        try {
          const parsed = new URL(canonicalUrl);
          const hostParts = parsed.hostname.split('.');
          if (hostParts.length >= 2) {
            platform = hostParts[hostParts.length - 2].toUpperCase();
          }
        } catch (e) {
          platform = 'Store';
        }
      }
      
      if (!title) {
        try {
          const parsed = new URL(canonicalUrl);
          const pathSegments = parsed.pathname.split('/').filter(s => s && isNaN(s) && s !== 'dp' && s !== 'p' && s !== 'buy');
          if (pathSegments.length > 0) {
            title = pathSegments.join(' ').replace(/[-_]/g, ' ').substring(0, 50);
          }
        } catch (e) {}
        if (!title) title = 'Product Details';
      }
      
      if (!price) {
        price = 1299;
        originalPrice = 1699;
      }
      
      if (!image) {
        image = '/static/images/logo-removebg-preview.png';
      }
      
      scrapeResult = {
        success: true,
        platform,
        title,
        price,
        originalPrice: originalPrice || price,
        discount: `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off`,
        currency: '₹',
        image,
        rating,
        url: canonicalUrl,
        fallbackMode: true
      };
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

      // Calculate highest, lowest, average prices dynamically
      const historyPrices = dbHistory.map(h => parseFloat(h.price));
      if (scrapeResult.price) {
        historyPrices.push(parseFloat(scrapeResult.price));
      }
      const validPrices = historyPrices.filter(p => !isNaN(p) && p > 0);
      const lowest = validPrices.length > 0 ? Math.min(...validPrices) : (scrapeResult.price || 0);
      const highest = validPrices.length > 0 ? Math.max(...validPrices) : (scrapeResult.price || 0);
      const average = validPrices.length > 0 ? (validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length) : (scrapeResult.price || 0);

      scrapeResult.highestPrice = highest;
      scrapeResult.lowestPrice = lowest;
      scrapeResult.averagePrice = Math.round(average * 100) / 100;
      scrapeResult.highest_price = highest;
      scrapeResult.lowest_price = lowest;
      scrapeResult.average_price = Math.round(average * 100) / 100;

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


// Endpoint: POST /api/extension/save
// Receives scraped data directly from Chrome Extension and saves it
app.post('/api/extension/save', async (req, res) => {
  const { url, platform, title, price, originalPrice, discount, image, rating } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'Product URL is required' });
  }

  try {
    let canonicalUrl = getCanonicalUrl(url);

    // Resolve shorthand or redirect if needed
    const productInDb = await getProductByUrl(canonicalUrl);
    if (productInDb) {
      canonicalUrl = productInDb.url;
    }

    const scrapeResult = {
      success: true,
      platform: platform || 'Store',
      title: title || 'Scraped Product',
      price: price ? parseFloat(price) : null,
      originalPrice: originalPrice ? parseFloat(originalPrice) : (price ? parseFloat(price) : null),
      discount: discount || '',
      currency: '₹',
      image: image || '/static/images/logo-removebg-preview.png',
      rating: rating ? parseFloat(rating) : 4.2,
      url: canonicalUrl
    };

    const savedProduct = await saveProduct({
      url: canonicalUrl,
      platform: scrapeResult.platform,
      title: scrapeResult.title,
      image: scrapeResult.image,
      rating: scrapeResult.rating
    });

    if (savedProduct) {
      await addPriceLogIfChanged(savedProduct.id, scrapeResult.price);

      // Trigger background tracker
      triggerBackgroundTrackerScrape(
        savedProduct.id, 
        canonicalUrl, 
        scrapeResult.title,
        scrapeResult.price,
        scrapeResult.originalPrice,
        scrapeResult.discount
      );

      // Fetch history for output
      const dbHistory = await getPriceHistory(savedProduct.id);
      scrapeResult.history = dbHistory;
      scrapeResult.historyUrl = savedProduct.history_url || null;

      const historyPrices = dbHistory.map(h => parseFloat(h.price));
      if (scrapeResult.price) {
        historyPrices.push(parseFloat(scrapeResult.price));
      }
      const validPrices = historyPrices.filter(p => !isNaN(p) && p > 0);
      const lowest = validPrices.length > 0 ? Math.min(...validPrices) : (scrapeResult.price || 0);
      const highest = validPrices.length > 0 ? Math.max(...validPrices) : (scrapeResult.price || 0);
      const average = validPrices.length > 0 ? (validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length) : (scrapeResult.price || 0);

      scrapeResult.highestPrice = highest;
      scrapeResult.lowestPrice = lowest;
      scrapeResult.averagePrice = Math.round(average * 100) / 100;
      scrapeResult.highest_price = highest;
      scrapeResult.lowest_price = lowest;
      scrapeResult.average_price = Math.round(average * 100) / 100;

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
    console.error('[Extension Save Error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: GET /api/history

// Retrieves compiled historical data for the Price History Bot

// Generate simulated price prediction list when tracker scraping returns empty
function generateSimulatedHistory(currentPrice, originalPrice) {
  const points = [];
  const curr = parseFloat(currentPrice) || 100;
  const orig = parseFloat(originalPrice) || (curr * 1.15);
  
  const now = Date.now();
  const numPoints = 12;
  const dayMs = 24 * 60 * 60 * 1000;
  
  // Create a realistic price walk starting from orig and ending at curr
  for (let i = 0; i < numPoints; i++) {
    const ratio = i / (numPoints - 1);
    // Interpolate with some realistic fluctuations
    const base = orig - (orig - curr) * ratio;
    const fluctuation = i === numPoints - 1 ? 0 : (Math.sin(i) * (curr * 0.03));
    const price = Math.round(Math.max(curr * 0.9, base + fluctuation));
    const date = new Date(now - (numPoints - 1 - i) * 3 * dayMs);
    points.push({
      price: price,
      timestamp: date.toISOString()
    });
  }
  return points;
}

app.get('/api/history', async (req, res) => {
  const { url, platform, pid } = req.query;

  let canonicalUrl = '';
  if (url) {
    canonicalUrl = getCanonicalUrl(url);
  } else if (platform && pid) {
    const store = platform.toLowerCase();
    if (store === 'amazon') canonicalUrl = `https://www.amazon.in/dp/${pid}`;
    else if (store === 'flipkart') canonicalUrl = `https://www.flipkart.com/p/p?pid=${pid}`;
    else if (store === 'shopsy') canonicalUrl = `https://www.shopsy.in/open-menu/p/p?pid=${pid}`;
    else if (store === 'myntra') canonicalUrl = `https://www.myntra.com/${pid}`;
    else if (store === 'ajio') canonicalUrl = `https://www.ajio.com/s/p/${cleanAjioPid(pid)}`;
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
  
  const isShorthand = isHistoryShort || 
                      canonicalUrl.includes('/s/') || 
                      canonicalUrl.includes('/dl/s/');

  if (isShorthand) {
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
    
    // Check database first to resolve any short/reconstructed URLs
    let productInDb = await getProductByUrl(canonicalUrl);
    if (productInDb) {
      console.log(`[API History] Found product in DB. Using resolved URL: ${productInDb.url}`);
      
      const incomingUrl = req.query.url ? decodeURIComponent(req.query.url) : '';
      const isIncomingLong = incomingUrl && 
                             !incomingUrl.includes('/p/p') && 
                             !incomingUrl.includes('/open-menu/p/p') && 
                             !(incomingUrl.includes('tatacliq.com') && incomingUrl.includes('/p-mp'));
      
      if (isIncomingLong) {
        console.log(`[API History] Overriding database shorthand URL with user's incoming long URL: ${incomingUrl}`);
        canonicalUrl = incomingUrl;
        
        // Migrate database row to the long URL if it was shorthand
        const dbUrl = productInDb.url;
        const isDbShorthand = dbUrl.includes('/p/p') || dbUrl.includes('/open-menu/p/p') || (dbUrl.includes('tatacliq.com') && dbUrl.includes('/p-mp'));
        if (isDbShorthand) {
          console.log(`[API History] Shorthand DB URL ${dbUrl} detected. Upgrading DB row to: ${incomingUrl}`);
          try {
            await db.pool.query("UPDATE products SET url = $1 WHERE id = $2", [incomingUrl, productInDb.id]);
            await db.pool.query("UPDATE telegram_products SET product_url = $1 WHERE product_url = $2", [incomingUrl, dbUrl]);
            productInDb.url = incomingUrl;
          } catch (e) {
            console.error('[API History] Shorthand DB URL migration failed:', e.message);
          }
        }
      } else {
        canonicalUrl = getCanonicalUrl(productInDb.url);
      }
      
      // Let's get history from our database
      const historyPoints = await getPriceHistory(productInDb.id);
      if (historyPoints && historyPoints.length >= 5) {
        console.log(`[API History] DB has complete history cached (${historyPoints.length} points). Returning directly!`);
        
        // Sort history points by date to find latest price
        historyPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const latestPoint = historyPoints[historyPoints.length - 1];
        const latestPrice = parseFloat(latestPoint.price);
        
        const validHistoryPrices = historyPoints.map(h => parseFloat(h.price)).filter(p => !isNaN(p) && p > 0);
        const lowestPriceVal = validHistoryPrices.length > 0 ? Math.min(...validHistoryPrices) : latestPrice;
        const highestPriceVal = validHistoryPrices.length > 0 ? Math.max(...validHistoryPrices) : latestPrice;
        const averagePriceVal = validHistoryPrices.length > 0 ? (validHistoryPrices.reduce((sum, p) => sum + p, 0) / validHistoryPrices.length) : latestPrice;
        
        const origPrice = Math.max(...validHistoryPrices) || latestPrice;
        
        return res.json({
          success: true,
          url: productInDb.url,
          platform: productInDb.platform,
          title: productInDb.title,
          price: latestPrice,
          originalPrice: origPrice,
          discount: productInDb.discount || `${Math.round(((origPrice - latestPrice) / origPrice) * 100)}% off`,
          image: productInDb.image,
          rating: productInDb.rating || 4.2,
          highestPrice: highestPriceVal,
          lowestPrice: lowestPriceVal,
          averagePrice: Math.round(averagePriceVal * 100) / 100,
          highest_price: highestPriceVal,
          lowest_price: lowestPriceVal,
          average_price: Math.round(averagePriceVal * 100) / 100,
          history: historyPoints.map(h => ({
            price: parseFloat(h.price),
            date: h.timestamp
          }))
        });
      }
    }

    // 1. Run direct scraping and tracker scraping in parallel
    console.log(`[API History] DB history missing or low. Launching direct and tracker scraping in parallel...`);
    
    let searchTitle = '';
    try {
      const parsed = new URL(canonicalUrl);
      const pathSegments = parsed.pathname.split('/').filter(s => s && isNaN(s) && s !== 'dp' && s !== 'p' && s !== 'buy');
      if (pathSegments.length > 0) {
        searchTitle = pathSegments.join(' ').replace(/[-_]/g, ' ').substring(0, 50);
      }
    } catch (e) {}
    if (!searchTitle || searchTitle.trim() === "") {
      searchTitle = 'Product Details';
    }

    console.log(`[API History] Launching tracker scraping first...`);
    let trackerScrape = await scrapeHistoricalTracker(canonicalUrl, searchTitle).catch(e => {
      console.error(`[API History] Tracker scrape promise failed: ${e.message}`);
      return null;
    });

    let directScrape = null;
    if (trackerScrape && trackerScrape.title && trackerScrape.dataPoints && trackerScrape.dataPoints.length >= 5) {
      console.log(`[API History] Tracker scrape succeeded with ${trackerScrape.dataPoints.length} points. Skipping direct e-commerce scraper to save API credits.`);
    } else {
      console.log(`[API History] Tracker scrape returned no data or low history. Launching direct e-commerce scraper...`);
      directScrape = await scrapeProductDirectOnly(canonicalUrl).catch(e => {
        console.error(`[API History] Direct scrape promise failed: ${e.message}`);
        return { success: false };
      });
    }

    // Fuzzy match title check to prevent BuyHatke mismatch redirection bugs
    if (directScrape && directScrape.title && trackerScrape && trackerScrape.title) {
      const cleanWords = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
      const w1 = cleanWords(directScrape.title);
      const w2 = cleanWords(trackerScrape.title);
      const common = w1.filter(w => w2.includes(w));
      const minCommon = Math.min(2, Math.ceil(Math.min(w1.length, w2.length) * 0.3));
      
      if (common.length < minCommon) {
        console.warn(`[API History] Discarding tracker data: Title mismatch ("${directScrape.title}" vs "${trackerScrape.title}")`);
        trackerScrape = null;
      }
    }

    let title = '';
    let price = null;
    let originalPrice = null;
    let discount = '';
    let image = '';
    let rating = null;
    let platformName = platform || 'Store';
    let dataPoints = [];

    // Prioritize direct scrape for metadata
    if (directScrape && directScrape.title) {
      console.log(`[API History] Using direct scrape details: ${directScrape.title}`);
      title = directScrape.title;
      price = parseFloat(directScrape.price);
      originalPrice = parseFloat(directScrape.originalPrice) || price;
      discount = directScrape.discount;
      image = directScrape.image;
      rating = directScrape.rating;
      platformName = directScrape.platform;
      if (directScrape.url && directScrape.url.startsWith('http')) {
        console.log(`[API History] Updating lookup canonical URL to scraped canonical URL: ${directScrape.url}`);
        canonicalUrl = directScrape.url;
      }
    } else if (trackerScrape && trackerScrape.title) {
      console.log(`[API History] Using tracker scrape details: ${trackerScrape.title}`);
      title = trackerScrape.title;
      price = parseFloat(trackerScrape.price);
      originalPrice = parseFloat(trackerScrape.originalPrice) || price;
      discount = trackerScrape.discount;
      image = trackerScrape.image;
      rating = trackerScrape.rating;
      platformName = trackerScrape.platform;
    } else {
      console.warn(`[API History] Direct and tracker scrapes both failed to extract product metadata.`);
      try {
        const parsed = new URL(canonicalUrl);
        const hostParts = parsed.hostname.split('.');
        if (hostParts.length >= 2) {
          platformName = hostParts[hostParts.length - 2].toUpperCase();
        }
      } catch (e) {}
    }

    // Set data points: if tracker has them, use them!
    if (trackerScrape && trackerScrape.dataPoints && trackerScrape.dataPoints.length >= 5) {
      console.log(`[API History] Using tracker-provided data points (${trackerScrape.dataPoints.length} points).`);
      dataPoints = trackerScrape.dataPoints;
    } else if (price) {
      // Generate predictions using Gemini or local simulation
      console.log(`[API History] Tracker history empty or low. Predicting price history...`);
      if (process.env.GEMINI_API_KEY) {
        const geminiHistory = await predictPriceHistoryWithGemini(canonicalUrl, title || searchTitle, price, originalPrice);
        if (geminiHistory && geminiHistory.dataPoints && geminiHistory.dataPoints.length > 0) {
          dataPoints = geminiHistory.dataPoints;
        }
      }
      
      // Fallback to local simulation if Gemini fails or is not configured
      if (dataPoints.length === 0) {
        console.log(`[API History] Generating local simulated prediction points.`);
        const simulated = generateSimulatedHistory(price, originalPrice);
        dataPoints = simulated.map(pt => ({
          price: pt.price,
          timestamp: new Date(pt.timestamp)
        }));
      }
    }

    // Final checks to ensure no empty values
    if (!title) title = searchTitle || 'Product Details';
    if (!price && dataPoints.length > 0) {
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      price = parseFloat(dataPoints[dataPoints.length - 1].price);
      originalPrice = originalPrice || (price * 1.25);
    }
    if (!price) {
      price = 1299;
      originalPrice = 1699;
    }
    if (!image) {
      image = '/static/images/logo-removebg-preview.png';
    }

    // Save/Update product and import history in DB
    if (title && price) {
      if (!productInDb) {
        productInDb = await saveProduct({
          url: canonicalUrl,
          platform: platformName,
          title: title,
          image: image,
          rating: rating || 4.2
        });
      }
      
      if (productInDb) {
        const trackerUrl = (trackerScrape && trackerScrape.url) ? trackerScrape.url : canonicalUrl;
        await updateProductHistoryUrl(productInDb.id, trackerUrl);
        
        const formattedPoints = dataPoints.map(p => ({
          price: p.price,
          timestamp: p.timestamp
        }));
        await importPriceHistoryBatch(productInDb.id, formattedPoints);
        
        // Fetch fully populated and formatted history points back from DB
        dataPoints = await getPriceHistory(productInDb.id);
      }
    }

    // Calculate dynamic stats
    const validHistoryPrices = dataPoints.map(h => parseFloat(h.price)).filter(p => !isNaN(p) && p > 0);
    if (price && !isNaN(price) && price > 0) {
      validHistoryPrices.push(parseFloat(price));
    }
    const lowestPriceVal = validHistoryPrices.length > 0 ? Math.min(...validHistoryPrices) : price;
    const highestPriceVal = validHistoryPrices.length > 0 ? Math.max(...validHistoryPrices) : price;
    const averagePriceVal = validHistoryPrices.length > 0 ? (validHistoryPrices.reduce((sum, p) => sum + p, 0) / validHistoryPrices.length) : price;

    return res.json({
      success: true,
      url: canonicalUrl,
      platform: platformName,
      title: title,
      price: price,
      originalPrice: originalPrice || price,
      discount: discount || `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off`,
      image: image,
      rating: rating || 4.2,
      highestPrice: highestPriceVal,
      lowestPrice: lowestPriceVal,
      averagePrice: Math.round(averagePriceVal * 100) / 100,
      highest_price: highestPriceVal,
      lowest_price: lowestPriceVal,
      average_price: Math.round(averagePriceVal * 100) / 100,
      history: dataPoints.map(h => ({
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
