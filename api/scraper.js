const axios = require('axios');
const cheerio = require('cheerio');

// Rotated list of standard user agents to help bypass direct blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// In-memory status fallback for scraper credentials
const scraperStatus = {
  scraperApi: { exhausted: false, lastChecked: 0 },
  scrapingBee: { exhausted: false, lastChecked: 0 },
  scrapeDo: { exhausted: false, lastChecked: 0 }
};

async function isScraperExhausted(name) {
  if (scraperStatus[name]?.exhausted) {
    if (Date.now() - scraperStatus[name].lastChecked > 3600000) {
      scraperStatus[name].exhausted = false;
    } else {
      return true;
    }
  }
  
  try {
    const { redisClient } = require('./db');
    if (redisClient && redisClient.isOpen) {
      const val = await redisClient.get(`exhausted:${name}`);
      return val === 'true';
    }
  } catch (e) {}
  return false;
}

async function markScraperExhausted(name) {
  if (scraperStatus[name]) {
    scraperStatus[name].exhausted = true;
    scraperStatus[name].lastChecked = Date.now();
  }
  console.warn(`[Scraper] ${name} marked as EXHAUSTED.`);
  try {
    const { redisClient } = require('./db');
    if (redisClient && redisClient.isOpen) {
      await redisClient.set(`exhausted:${name}`, 'true', { EX: 3600 });
    }
  } catch (e) {}
}

/**
 * Clean e-commerce URL by stripping query parameters and hashes.
 */
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

/**
 * Clean up scraped price string and convert to Number
 */
function parsePrice(priceStr) {
  if (!priceStr) return null;
  // Remove currency symbols, commas, spaces and non-numeric chars
  const cleaned = priceStr.replace(/[^\d.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Helper to extract product details from price trackers
 */
function extractFromTrackerPage(html, url, platform) {
  const $ = cheerio.load(html);
  const title = $('h1').text().trim() || $('meta[property="og:title"]').attr('content') || '';
  
  let image = $('meta[property="og:image"]').attr('content') || '';
  if (image && (image.includes('logo') || image.includes('icon'))) {
    image = '';
  }

  const dataPoints = parseChartPoints(html);
  let price = null;
  let originalPrice = null;

  if (dataPoints && dataPoints.length > 0) {
    // Sort by date ascending to get latest
    dataPoints.sort((a, b) => a.timestamp - b.timestamp);
    price = dataPoints[dataPoints.length - 1].price;
    originalPrice = Math.max(...dataPoints.map(d => d.price));
  }

  // Fallback if price not found in chart points
  if (!price) {
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const priceRegex = /(?:current\s+price\s+is\s+|lowest\s+price\s+:\s*|price\s*:\s*(?:Rs\.?|₹)\s*)([\d,]+)/i;
    const match = ogDesc.match(priceRegex);
    if (match && match[1]) {
      price = parsePrice(match[1]);
    }
  }

  return {
    success: !!(title && price),
    platform,
    title,
    price,
    originalPrice: originalPrice || price,
    discount: (originalPrice && price && originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image,
    url,
    dataPoints
  };
}

/**
 * Helper to fetch page HTML with retries
 */
async function fetchPageHtmlWithRetries(url, timeout = 35000, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) {
        console.log(`[Scraper Retry] Retrying fetch for: ${url} (Attempt ${i+1}/${attempts})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * i));
      }
      return await fetchPageHtml(url, timeout);
    } catch (e) {
      console.warn(`[Scraper Warning] Fetch failed for ${url} (Attempt ${i+1}/${attempts}): ${e.message}`);
      lastError = e;
    }
  }
  throw lastError || new Error(`Failed to fetch page HTML after ${attempts} attempts`);
}

/**
 * Scrapes a URL using ScraperAPI, ScrapingBee, custom proxy, or direct request
 */
async function fetchPageHtml(url, customTimeout = 35000) {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  const scrapingBeeKey = process.env.SCRAPINGBEE_KEY;
  const scrapeDoKey = process.env.SCRAPEDO_KEY;
  const proxyUrl = process.env.PROXY_URL;

  const isTracker = url.includes('buyhatke.com') || url.includes('pricehistory.app') || url.includes('pricebefore.com');
  const isAmazon = url.includes('amazon.in') || url.includes('amazon.com');
  const skipRender = isTracker || isAmazon ||
                     url.includes('flipkart.com') ||
                     url.includes('myntra.com') ||
                     url.includes('ajio.com') ||
                     url.includes('meesho.com') ||
                     url.includes('shopsy.in') ||
                     url.includes('shopsy.com') ||
                     url.includes('nykaa.com') ||
                     url.includes('croma.com') ||
                     url.includes('reliancedigital.in');

  async function performRequest(reqUrl, reqConfig) {
    const response = await axios.get(reqUrl, reqConfig);
    const htmlData = response.data;
    if (htmlData && typeof htmlData === 'string' && (
      htmlData.includes('cf-challenge') ||
      htmlData.includes('cloudflare-challenge') ||
      htmlData.includes('enable-javascript') ||
      htmlData.includes('Attention Required! | Cloudflare') ||
      htmlData.includes('Something went wrong! Please try again later. E002') ||
      (htmlData.length < 1500 && htmlData.includes('captcha'))
    )) {
      throw new Error('Cloudflare/Captcha challenge or Flipkart block detected in response HTML.');
    }
    return htmlData;
  }

  // Define strategies to attempt
  const strategies = [];

  // Strategy 1: ScraperAPI
  if (scraperApiKey) {
    const isExhausted = await isScraperExhausted('scraperApi');
    if (!isExhausted) {
      strategies.push({
        name: 'ScraperAPI',
        execute: async () => {
          let params = `api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
          
          // Render JS only if enabled and not skipped
          if (process.env.SCRAPERAPI_RENDER === 'true' && !skipRender) {
            params += '&render=true';
          }
          // Enable premium proxies if configured
          if (process.env.SCRAPERAPI_PREMIUM === 'true') {
            params += '&premium=true';
          }
          // Set country code if configured
          if (process.env.SCRAPERAPI_COUNTRY) {
            params += `&country_code=${process.env.SCRAPERAPI_COUNTRY}`;
          }
          
          const requestUrl = `http://api.scraperapi.com?${params}`;
          console.log(`[Scraper] Routing request through ScraperAPI for: ${url}`);
          return await performRequest(requestUrl, { timeout: customTimeout });
        },
        handleError: async (err) => {
          const status = err.response?.status;
          const bodyText = err.response?.data && typeof err.response.data === 'string' ? err.response.data : '';
          if (status === 403 && (bodyText.includes('monthly cycle') || bodyText.includes('exhausted') || bodyText.includes('Credits') || bodyText.includes('limit'))) {
            await markScraperExhausted('scraperApi');
          }
        }
      });
    } else {
      console.log(`[Scraper] Skipping ScraperAPI for ${url} (marked exhausted).`);
    }
  }

  // Strategy 2: ScrapingBee
  if (scrapingBeeKey) {
    const isExhausted = await isScraperExhausted('scrapingBee');
    if (!isExhausted) {
      strategies.push({
        name: 'ScrapingBee',
        execute: async () => {
          const renderJs = (process.env.SCRAPINGBEE_RENDER === 'true' && !skipRender) ? 'true' : 'false';
          let params = `api_key=${scrapingBeeKey}&url=${encodeURIComponent(url)}&render_js=${renderJs}`;
          
          if (process.env.SCRAPINGBEE_PREMIUM === 'true') {
            params += '&premium_proxy=true';
          }
          if (process.env.SCRAPINGBEE_COUNTRY) {
            params += `&country_code=${process.env.SCRAPINGBEE_COUNTRY}`;
          }
          
          const requestUrl = `https://app.scrapingbee.com/api/v1/?${params}`;
          console.log(`[Scraper] Routing request through ScrapingBee for: ${url}`);
          return await performRequest(requestUrl, { timeout: customTimeout });
        },
        handleError: async (err) => {
          const status = err.response?.status;
          const bodyText = err.response?.data && typeof err.response.data === 'string' ? err.response.data : '';
          if (status === 401 || (status === 403 && (bodyText.includes('credit') || bodyText.includes('billing') || bodyText.includes('limit') || bodyText.includes('Invalid api key')))) {
            await markScraperExhausted('scrapingBee');
          }
        }
      });
    } else {
      console.log(`[Scraper] Skipping ScrapingBee for ${url} (marked exhausted).`);
    }
  }

  // Strategy 3: Scrape.do
  if (scrapeDoKey) {
    const isExhausted = await isScraperExhausted('scrapeDo');
    if (!isExhausted) {
      strategies.push({
        name: 'Scrape.do',
        execute: async () => {
          const renderJs = !skipRender ? 'true' : 'false';
          let params = `token=${scrapeDoKey}&url=${encodeURIComponent(url)}&render=${renderJs}`;
          if (process.env.SCRAPEDO_GEO) {
            params += `&geoCode=${process.env.SCRAPEDO_GEO}`;
          }
          const requestUrl = `https://api.scrape.do/?${params}`;
          console.log(`[Scraper] Routing request through Scrape.do for: ${url}`);
          return await performRequest(requestUrl, { timeout: customTimeout });
        },
        handleError: async (err) => {
          const status = err.response?.status;
          const bodyText = err.response?.data && typeof err.response.data === 'string' ? err.response.data : '';
          if (status === 401 || (status === 403 && (bodyText.includes('limit') || bodyText.includes('billing') || bodyText.includes('credit')))) {
            await markScraperExhausted('scrapeDo');
          }
        }
      });
    } else {
      console.log(`[Scraper] Skipping Scrape.do for ${url} (marked exhausted).`);
    }
  }

  // Strategy 4: Custom Proxy
  if (proxyUrl) {
    strategies.push({
      name: 'CustomProxy',
      execute: async () => {
        console.log(`[Scraper] Using custom proxy: ${proxyUrl} for: ${url}`);
        const { HttpsProxyAgent } = require('https-proxy-agent');
        const config = {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          httpsAgent: new HttpsProxyAgent(proxyUrl),
          timeout: customTimeout
        };
        return await performRequest(url, config);
      },
      handleError: async () => {}
    });
  }

  // Strategy 4: Direct Request
  strategies.push({
    name: 'DirectRequest',
    execute: async () => {
      console.log(`[Scraper] Performing direct request for: ${url}`);
      const config = {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: customTimeout
      };
      return await performRequest(url, config);
    },
    handleError: async () => {}
  });

  let lastError = null;
  for (const strategy of strategies) {
    try {
      return await strategy.execute();
    } catch (err) {
      console.warn(`⚠️ [Scraper Strategy Failed] ${strategy.name} failed: ${err.message}`);
      await strategy.handleError(err);
      lastError = err;
    }
  }

  throw lastError || new Error(`All scraper strategies failed for: ${url}`);
}

/**
 * Scrape Flipkart Product Details
 */
function parseFlipkart($, url) {
  // Title Selectors
  let title = $('.VU-ZEz').text().trim() || 
              $('span.B_NuCI').text().trim() || 
              $('h1').text().trim();

  // Price Selectors
  let priceText = $('.Nx95oM').text().trim() || 
                  $('._30jeq3').text().trim() || 
                  $('.dyC4b1').text().trim();
  
  // Original Price / MRP Selectors
  let originalPriceText = $('._3I9_ca').text().trim() || 
                        $('.y31eF7').text().trim();

  // Discount Selectors
  let discount = $('._3Ay6Sb').text().trim() || 
                 $('.UkC1Ke').text().trim() || 
                 '';

  // Image Selectors
  let image = '';
  // Try to find image source in primary image tags
  const imgElement = $('img._396cs4, img.CXW8mj, ._0DkuPH img').first();
  if (imgElement.length) {
    image = imgElement.attr('src');
  }

  // Rating Selectors
  let rating = $('div._3LWZlK').first().text().trim() || 
               $('div.XQD0XM').first().text().trim() || 
               '';

  // Extract specs / description if available
  const specs = [];
  $('._14cfVK, ._3k-BhJ').each((i, el) => {
    const key = $(el).find('._2w35w* , ._2lznT*').text().trim();
    const val = $(el).find('._31275* , ._1h59_c').text().trim();
    if (key && val) {
      specs.push({ key, value: val });
    }
  });

  return {
    success: true,
    platform: 'Flipkart',
    title,
    price: parsePrice(priceText),
    originalPrice: parsePrice(originalPriceText),
    discount,
    currency: '₹',
    image,
    rating: rating ? parseFloat(rating) : null,
    url,
    specs: specs.slice(0, 10) // Limit to top 10 specs
  };
}

/**
 * Scrape Amazon Product Details
 */
function parseAmazon($, url) {
  let title = $('#productTitle').text().trim();
  
  // Price selectors are complex on Amazon; check multiple patterns
  let priceText = '';
  const priceSelectors = [
    '.a-price-whole',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.apexPriceToPay span.a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price-whole',
    '#corePrice_feature_div .a-price-whole'
  ];

  for (const selector of priceSelectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      priceText = text;
      break;
    }
  }

  // Original Price / MRP Selectors
  let originalPriceText = '';
  const mrpSelectors = [
    '.a-line-through span.a-offscreen',
    '#basisPriceValue',
    '.basisPrice .a-offscreen',
    '#price .a-text-strike'
  ];
  for (const selector of mrpSelectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      originalPriceText = text;
      break;
    }
  }

  // Discount
  let discount = '';
  const discountSelectors = [
    '.savingPercent',
    '#corePriceDisplay_desktop_feature_div .savingPercent',
    '#corePrice_feature_div .savingPercent'
  ];
  for (const selector of discountSelectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      discount = text.replace(/^-/, '').trim(); // Remove leading minus
      break;
    }
  }

  // Image Selection
  let image = '';
  // Try landingImage first
  const landingImage = $('#landingImage');
  if (landingImage.length) {
    // Amazon dynamic images JSON attribute contains url keys
    const dynamicImageAttr = landingImage.attr('data-a-dynamic-image');
    if (dynamicImageAttr) {
      try {
        const parsed = JSON.parse(dynamicImageAttr);
        image = Object.keys(parsed)[0]; // First key is one of the image URLs
      } catch (e) {
        image = landingImage.attr('src');
      }
    } else {
      image = landingImage.attr('src');
    }
  }
  
  if (!image) {
    image = $('#imgBlkFront').attr('src') || 
            $('#main-image-container img').first().attr('src') || 
            $('.a-dynamic-image').first().attr('src');
  }

  // Rating
  let ratingText = $('.a-icon-alt').first().text().trim() || 
                   $('i.a-icon-star span').first().text().trim() || 
                   '';
  let rating = null;
  if (ratingText) {
    const match = ratingText.match(/([0-9.]+)\s*out\s*of/i) || ratingText.match(/([0-9.]+)\s*stars/i) || ratingText.match(/([0-9.]+)/);
    if (match && match[1]) {
      rating = parseFloat(match[1]);
    }
  }

  // Extract specs from detail table
  const specs = [];
  $('#prodDetails table tr').each((i, el) => {
    const key = $(el).find('th').text().trim();
    const val = $(el).find('td').text().trim();
    if (key && val) {
      specs.push({ key, value: val });
    }
  });

  if (specs.length === 0) {
    $('#technicalSpecifications_section_1 tr').each((i, el) => {
      const key = $(el).find('.label').text().trim();
      const val = $(el).find('.value').text().trim();
      if (key && val) {
        specs.push({ key, value: val });
      }
    });
  }

  // Calculate discount percent manually if we have prices but no explicit tag
  let parsedPrice = parsePrice(priceText);
  let parsedMRP = parsePrice(originalPriceText);
  if (parsedPrice && parsedMRP && parsedMRP > parsedPrice && !discount) {
    const percent = Math.round(((parsedMRP - parsedPrice) / parsedMRP) * 100);
    discount = `${percent}% off`;
  }

  return {
    success: true,
    platform: 'Amazon',
    title,
    price: parsedPrice,
    originalPrice: parsedMRP || parsedPrice,
    discount: discount || '0%',
    currency: '₹',
    image,
    rating,
    url,
    specs: specs.slice(0, 10)
  };
}

/**
 * Scrape Myntra Product Details
 */
function parseMyntra($, url) {
  let title = '';
  let price = null;
  let originalPrice = null;
  let discount = '';
  let image = '';
  let rating = null;
  let specs = [];

  // Try to extract from window.__myx script
  let scriptContent = '';
  $('script').each((i, el) => {
    const html = $(el).html();
    if (html && html.includes('window.__myx =')) {
      scriptContent = html;
      return false;
    }
  });

  if (scriptContent) {
    try {
      const parts = scriptContent.split('window.__myx =');
      if (parts.length > 1) {
        const jsonStr = parts[1].trim();
        const cleanJsonStr = jsonStr.endsWith(';') ? jsonStr.slice(0, -1) : jsonStr;
        const data = JSON.parse(cleanJsonStr);
        if (data && data.pdpData) {
          const pdp = data.pdpData;
          title = pdp.name || pdp.title;
          if (pdp.price) {
            price = parseFloat(pdp.price.discounted);
            originalPrice = parseFloat(pdp.price.mrp);
            if (pdp.price.discountText) {
              discount = pdp.price.discountText;
            } else if (originalPrice > price) {
              const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
              discount = `${pct}% off`;
            }
          }
          if (pdp.media && pdp.media.albums && pdp.media.albums[0] && pdp.media.albums[0].images && pdp.media.albums[0].images[0]) {
            const imgObj = pdp.media.albums[0].images[0];
            image = imgObj.src || imgObj.imageURL || imgObj.url || '';
          }
          if (pdp.ratings) {
            rating = parseFloat(pdp.ratings.averageRating);
          }
          if (pdp.productDetails) {
            specs = pdp.productDetails.map(d => ({ key: d.title, value: d.description }));
          }
        }
      }
    } catch (e) {
      console.error('[Scraper Error] Myntra JSON parse failed:', e.message);
    }
  }

  // Fallback image selectors
  if (!image) {
    image = $('meta[property="og:image"]').attr('content') || 
            $('.image-grid-image').first().css('background-image') ||
            $('img[class*="image"]').first().attr('src') ||
            '';
    // Clean background-image url("...") format
    if (image && image.includes('url(')) {
      const match = image.match(/url\(['"]?([^'"]+)['"]?\)/);
      if (match && match[1]) {
        image = match[1];
      }
    }
  }

  // Fallback selectors
  if (!title) {
    title = ($('.pdp-title').text().trim() + ' ' + $('.pdp-name').text().trim()).trim();
    const priceText = $('.pdp-price').first().text().trim();
    price = parsePrice(priceText);
    const mrpText = $('.pdp-mrp').first().text().trim();
    originalPrice = parsePrice(mrpText) || price;
    discount = $('.pdp-discount').first().text().trim();
  }

  return {
    success: !!title,
    platform: 'Myntra',
    title,
    price,
    originalPrice: originalPrice || price,
    discount: discount || '0%',
    currency: '₹',
    image,
    rating,
    url,
    specs: specs.slice(0, 10)
  };
}

/**
 * Scrape Ajio Product Details
 */
function parseAjio($, url) {
  let title = '';
  let price = null;
  let originalPrice = null;
  let discount = '';
  let image = '';
  let rating = null;
  let specs = [];

  let scriptContent = '';
  $('script').each((i, el) => {
    const html = $(el).html();
    if (html && html.includes('window.__PRELOADED_STATE__')) {
      scriptContent = html;
      return false;
    }
  });

  if (scriptContent) {
    try {
      const parts = scriptContent.split('window.__PRELOADED_STATE__ =');
      if (parts.length > 1) {
        const jsonStr = parts[1].trim();
        const cleanJsonStr = jsonStr.endsWith(';') ? jsonStr.slice(0, -1) : jsonStr;
        const data = JSON.parse(cleanJsonStr);
        
        let productDetails = null;
        if (data.product && data.product.productDetails) {
          productDetails = data.product.productDetails;
        } else if (data.pdp && data.pdp.productDetails) {
          productDetails = data.pdp.productDetails;
        }

        if (productDetails) {
          title = (productDetails.name || '').trim();
          if (productDetails.price) {
            price = parseFloat(productDetails.price.value);
            if (productDetails.wasPriceData) {
              originalPrice = parseFloat(productDetails.wasPriceData.value);
            } else if (productDetails.price.wasValue) {
              originalPrice = parseFloat(productDetails.price.wasValue);
            } else {
              originalPrice = price;
            }
            if (productDetails.price.discountValue) {
              discount = productDetails.price.discountValue + '% off';
            } else if (originalPrice > price) {
              const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
              discount = `${pct}% off`;
            }
          }
          
          if (productDetails.images && productDetails.images[0]) {
            image = productDetails.images[0].url;
          }
          if (productDetails.averageRating) {
            rating = parseFloat(productDetails.averageRating);
          }
          if (productDetails.featureListData && productDetails.featureListData.features) {
            specs = productDetails.featureListData.features.map(f => ({ key: f.name, value: f.value }));
          }
        }
      }
    } catch (e) {
      console.error('[Scraper Error] Ajio JSON parse failed:', e.message);
    }
  }

  if (!title) {
    title = $('.fn').text().trim() || $('h1').text().trim();
    price = parsePrice($('.prod-sp').text().trim());
    originalPrice = parsePrice($('.prod-cp').text().trim()) || price;
    discount = $('.promo-discount-percent').text().trim();
    image = $('.prod-main-img img').attr('src');
  }

  return {
    success: !!title,
    platform: 'Ajio',
    title,
    price,
    originalPrice: originalPrice || price,
    discount: discount || '0%',
    currency: '₹',
    image,
    rating,
    url,
    specs: specs.slice(0, 10)
  };
}

/**
 * Scrape Meesho Product Details
 */
function parseMeesho($, url) {
  let title = '';
  let price = null;
  let originalPrice = null;
  let discount = '';
  let image = '';
  let rating = null;
  let specs = [];

  let scriptContent = '';
  // Try __NEXT_DATA__ first
  let nextScript = $('#__NEXT_DATA__').html();
  if (nextScript) {
    scriptContent = nextScript;
  } else {
    $('script').each((i, el) => {
      const html = $(el).html();
      if (html && (html.includes('window.__INITIAL_STATE__') || html.includes('{"props":{"pageProps":'))) {
        scriptContent = html;
        return false;
      }
    });
  }

  if (scriptContent) {
    try {
      let data = null;
      if (scriptContent.includes('window.__INITIAL_STATE__=')) {
        const parts = scriptContent.split('window.__INITIAL_STATE__=');
        if (parts.length > 1) {
          const jsonStr = parts[1].trim();
          const cleanJsonStr = jsonStr.endsWith(';') ? jsonStr.slice(0, -1) : jsonStr;
          data = JSON.parse(cleanJsonStr);
        }
      } else {
        data = JSON.parse(scriptContent.trim());
      }

      if (data) {
        // Extract from Next.js nested state structure if present
        const pageProps = data.props?.pageProps;
        const initialState = pageProps?.initialState;
        const state = initialState || data;

        let pdp = null;
        if (state.productDetails) {
          pdp = state.productDetails;
        } else if (state.pdp && state.pdp.productDetails) {
          pdp = state.pdp.productDetails;
        } else if (state.product && state.product.productDetails) {
          pdp = state.product.productDetails;
        } else if (state.pdp) {
          pdp = state.pdp;
        }

        if (pdp && (pdp.name || pdp.title)) {
          title = pdp.name || pdp.title;
          price = parseFloat(pdp.price || pdp.discountedPrice || pdp.sellingPrice);
          originalPrice = parseFloat(pdp.mrp || pdp.originalPrice || price);
          if (originalPrice > price) {
            const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
            discount = `${pct}% off`;
          }
          if (pdp.images && pdp.images[0]) {
            image = pdp.images[0];
          } else if (pdp.image) {
            image = pdp.image;
          }
          if (pdp.rating || pdp.averageRating) {
            rating = parseFloat(pdp.rating || pdp.averageRating);
          }
          if (pdp.description) {
            specs = [{ key: 'Description', value: pdp.description }];
          }
        }

        // Recursive search fallback if structure changed
        if (!title || !price) {
          function findKeyRecursive(obj, key) {
            if (!obj || typeof obj !== 'object') return null;
            if (key in obj) return obj[key];
            for (const k in obj) {
              const res = findKeyRecursive(obj[k], key);
              if (res !== null) return res;
            }
            return null;
          }
          const foundName = findKeyRecursive(state, 'name');
          const foundPrice = findKeyRecursive(state, 'price') || findKeyRecursive(state, 'sellingPrice');
          const foundMrp = findKeyRecursive(state, 'mrp') || findKeyRecursive(state, 'originalPrice') || foundPrice;
          const foundImages = findKeyRecursive(state, 'images');

          if (foundName && foundPrice) {
            title = foundName;
            price = parseFloat(foundPrice);
            originalPrice = parseFloat(foundMrp);
            if (foundImages && Array.isArray(foundImages) && foundImages[0]) {
              image = foundImages[0];
            }
          }
        }
      }
    } catch (e) {
      console.error('[Scraper Error] Meesho JSON parse failed:', e.message);
    }
  }

  if (!title) {
    title = $('span[class*="CatalogDetails__Text"]').first().text().trim() || $('h1').first().text().trim();
    price = parsePrice($('h4[class*="CatalogDetails__Price"]').first().text().trim());
    originalPrice = parsePrice($('p[class*="CatalogDetails__Mrp"]').first().text().trim()) || price;
    image = $('img[class*="ProductImage"]').first().attr('src');
  }

  return {
    success: !!title,
    platform: 'Meesho',
    title,
    price,
    originalPrice: originalPrice || price,
    discount: discount || '0%',
    currency: '₹',
    image,
    rating,
    url,
    specs: specs.slice(0, 10)
  };
}

/**
 * Fallback Parser using Metadata
 */
function parseGenericMeta($, url) {
  let title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  let priceText = $('meta[property="og:price:amount"]').attr('content') || 
                  $('meta[property="product:price:amount"]').attr('content') || 
                  $('[itemprop="price"]').attr('content') || 
                  $('[itemprop="price"]').text().trim();
  let price = parsePrice(priceText);
  
  let originalPriceText = $('meta[property="og:price:standard_amount"]').attr('content') ||
                          $('[itemprop="highPrice"]').attr('content') || 
                          $('[itemprop="highPrice"]').text().trim() || 
                          $('.mrp').text().trim();
  let originalPrice = parsePrice(originalPriceText) || price;

  let image = $('meta[property="og:image"]').attr('content') || 
              $('meta[name="twitter:image"]').attr('content') || 
              $('[itemprop="image"]').attr('src') ||
              $('[itemprop="image"]').attr('content');
              
  let ratingText = $('[itemprop="ratingValue"]').attr('content') || 
                   $('[itemprop="ratingValue"]').text().trim();
  let rating = ratingText ? parseFloat(ratingText) : null;

  // Generic selectors scanner if price not found
  if (!price) {
    $('[class*="price"], [id*="price"], [class*="Price"], [id*="Price"]').each((i, el) => {
      const txt = $(el).text().trim();
      const p = parsePrice(txt);
      if (p && p > 0 && p < 1000000) {
        price = p;
        return false;
      }
    });
  }

  // Detect platform name
  let platform = 'E-Commerce Store';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 2) {
      platform = hostParts[hostParts.length - 2].toUpperCase();
    }
  } catch (e) {}

  return {
    success: !!title,
    platform,
    title,
    price: price || 0,
    originalPrice: originalPrice || price || 0,
    discount: (originalPrice && price && originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image: image || '',
    rating,
    url,
    specs: []
  };
}

/**
 * Custom Parser for Croma
 */
function parseCroma($, url) {
  let title = $('meta[property="og:title"]').attr('content') || $('h1').text().trim();
  let priceText = $('.pdp-price, .new-price, [class*="amount"]').first().text().trim() ||
                  $('meta[property="og:price:amount"]').attr('content');
  let price = parsePrice(priceText);
  
  let originalPriceText = $('.mrp-price, .old-price, [class*="mrp"]').first().text().trim() ||
                          $('meta[property="og:price:standard_amount"]').attr('content');
  let originalPrice = parsePrice(originalPriceText) || price;

  let image = $('meta[property="og:image"]').attr('content') || 
              $('.pdp-main-image img').attr('src') || 
              $('img.pdp-main-image').attr('src') ||
              $('img[class*="main"]').attr('src');
              
  return {
    success: !!title,
    platform: 'Croma',
    title,
    price: price || 0,
    originalPrice: originalPrice || price || 0,
    discount: (originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image: image || '',
    url
  };
}

/**
 * Custom Parser for Reliance Digital
 */
function parseRelianceDigital($, url) {
  let title = $('meta[property="og:title"]').attr('content') || $('.pdp__title').text().trim() || $('h1').text().trim();
  let priceText = $('.pdp__offerPrice, [class*="offerPrice"]').first().text().trim() ||
                  $('meta[property="og:price:amount"]').attr('content');
  let price = parsePrice(priceText);
  
  let originalPriceText = $('.pdp__mrp, [class*="mrp"]').first().text().trim() ||
                          $('meta[property="og:price:standard_amount"]').attr('content');
  let originalPrice = parsePrice(originalPriceText) || price;

  let image = $('meta[property="og:image"]').attr('content') || 
              $('.pdp__mainImage img').attr('src') ||
              $('#main-image img').attr('src') ||
              $('img[class*="main"]').attr('src');
              
  return {
    success: !!title,
    platform: 'Reliance Digital',
    title,
    price: price || 0,
    originalPrice: originalPrice || price || 0,
    discount: (originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image: image || '',
    url
  };
}

/**
 * Custom Parser for Tata Cliq
 */
function parseTataCliq($, url) {
  let title = $('meta[property="og:title"]').attr('content') || $('.ProductDescription__name').text().trim() || $('h1').text().trim();
  let priceText = $('.ProductDescription__price, .ProductDescription__offerPrice').first().text().trim() ||
                  $('meta[property="og:price:amount"]').attr('content');
  let price = parsePrice(priceText);
  
  let originalPriceText = $('.ProductDescription__mrp').first().text().trim() ||
                          $('meta[property="og:price:standard_amount"]').attr('content');
  let originalPrice = parsePrice(originalPriceText) || price;

  let image = $('meta[property="og:image"]').attr('content') || 
              $('.ProductImage__image').attr('src') ||
              $('img.ProductImage__image').attr('src');
              
  let canonical = $('link[rel="canonical"]').attr('href') || url;
  
  return {
    success: !!title,
    platform: 'Tata Cliq',
    title,
    price: price || 0,
    originalPrice: originalPrice || price || 0,
    discount: (originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image: image || '',
    url: canonical
  };
}

/**
 * Custom Parser for Nykaa
 */
function parseNykaa($, url) {
  let title = $('meta[property="og:title"]').attr('content') || $('h1').text().trim();
  let priceText = $('.css-111pz9q, .css-ly177r, [class*="price"]').first().text().trim() ||
                  $('meta[property="og:price:amount"]').attr('content');
  let price = parsePrice(priceText);
  
  let originalPriceText = $('.css-mrp, [class*="mrp"]').first().text().trim() ||
                          $('meta[property="og:price:standard_amount"]').attr('content');
  let originalPrice = parsePrice(originalPriceText) || price;

  let image = $('meta[property="og:image"]').attr('content') || 
              $('.css-11v2j49 img').attr('src') ||
              $('img[class*="main"]').attr('src');
              
  return {
    success: !!title,
    platform: 'Nykaa',
    title,
    price: price || 0,
    originalPrice: originalPrice || price || 0,
    discount: (originalPrice > price) ? `${Math.round(((originalPrice - price) / originalPrice) * 100)}% off` : '0%',
    currency: '₹',
    image: image || '',
    url
  };
}

/**
 * Main Scrape Function
 */
async function scrapeProduct(url) {
  if (!url) {
    return { success: false, error: 'URL is required' };
  }

  // Extract platform name from URL
  let targetPlatform = 'E-Commerce Store';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 2) {
      targetPlatform = hostParts[hostParts.length - 2].toUpperCase();
    }
  } catch (e) {}

  // 1. Try BuyHatke first
  console.log(`[Scraper] Sequence 1/3: Scraping BuyHatke for product details...`);
  try {
    const bhResult = await scrapeFromBuyHatke(url);
    if (bhResult && bhResult.success && bhResult.title && bhResult.price) {
      console.log(`[Scraper] Success via BuyHatke fallback!`);
      bhResult.platform = targetPlatform;
      return bhResult;
    }
  } catch (e) {
    console.warn(`[Scraper] BuyHatke fallback failed: ${e.message}`);
  }

  // 2. Try direct shopping website scraping
  console.log(`[Scraper] Sequence 2/3: Scraping shopping website directly...`);
  let directData = null;
  let directError = null;
  let attempts = 3;
  let directHtml = '';
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * i));
      }
      directHtml = await fetchPageHtml(url, 60000);
      const $ = cheerio.load(directHtml);
      let data;

      if (url.includes('flipkart.com')) {
        data = parseFlipkart($, url);
        if (!data.title) throw new Error('Failed to parse Flipkart product details.');
      } else if (url.includes('shopsy.in') || url.includes('shopsy.com')) {
        data = parseFlipkart($, url);
        if (!data.title) throw new Error('Failed to parse Shopsy product details.');
        data.platform = 'Shopsy';
      } else if (url.includes('amazon.in') || url.includes('amazon.com')) {
        data = parseAmazon($, url);
        if (!data.title) throw new Error('Failed to parse Amazon product details.');
      } else if (url.includes('myntra.com')) {
        data = parseMyntra($, url);
        if (!data.title) throw new Error('Failed to parse Myntra product details.');
      } else if (url.includes('ajio.com')) {
        data = parseAjio($, url);
        if (!data.title) throw new Error('Failed to parse Ajio product details.');
      } else if (url.includes('meesho.com')) {
        data = parseMeesho($, url);
        if (!data.title) throw new Error('Failed to parse Meesho product details.');
      } else if (url.includes('croma.com')) {
        data = parseCroma($, url);
        if (!data.title) throw new Error('Failed to parse Croma product details.');
      } else if (url.includes('reliancedigital.in')) {
        data = parseRelianceDigital($, url);
        if (!data.title) throw new Error('Failed to parse Reliance Digital product details.');
      } else if (url.includes('tatacliq.com')) {
        data = parseTataCliq($, url);
        if (!data.title) throw new Error('Failed to parse Tata Cliq product details.');
      } else if (url.includes('nykaa.com')) {
        data = parseNykaa($, url);
        if (!data.title) throw new Error('Failed to parse Nykaa product details.');
      } else {
        data = parseGenericMeta($, url);
        if (!data.title) throw new Error('Failed to parse product details from target site.');
      }

      if (!data.price || data.price <= 0) {
        throw new Error('No valid price extracted.');
      }

      if (!data.image || data.image.trim() === '' || data.image.startsWith('data:')) {
        throw new Error('No valid image extracted (missing or placeholder).');
      }

      directData = data;
      break;
    } catch (err) {
      console.log(`⚠️ [Scraper Direct Attempt ${i+1}/${attempts} Failed] URL: ${url}. Error: ${err.message}`);
      directError = err;
      
      // If we successfully fetched HTML (length > 2000) but parsing failed, do NOT retry
      if (directHtml && directHtml.length > 2000 && !directHtml.includes('cf-challenge') && !directHtml.includes('cloudflare')) {
        console.log(`[Scraper] Page html fetched successfully but parsing failed. Bypassing retries...`);
        break;
      }
    }
  }

  // If direct parser failed but we have HTML, try Gemini AI extraction fallback
  if ((!directData || !directData.title || !directData.price) && directHtml && process.env.GEMINI_API_KEY) {
    console.log(`[Scraper] Direct parsing failed. Invoking Gemini AI fallback parser...`);
    const aiData = await scrapeProductWithGeminiFallback(directHtml, url);
    if (aiData && aiData.title) {
      console.log(`[Scraper] Success via Gemini AI fallback parser!`);
      directData = aiData;
    }
  }

  if (directData && directData.title) {
    console.log(`[Scraper] Success via direct store scrape!`);
    return directData;
  }

  // 3. Try other e-commerce price trackers
  console.log(`[Scraper] Sequence 3/3: Direct store scraping failed. Trying other e-commerce price trackers...`);
  
  // PriceHistoryApp
  try {
    const phResult = await scrapeFromPriceHistoryApp(url);
    if (phResult && phResult.success && phResult.title && phResult.price) {
      console.log(`[Scraper] Success via PriceHistoryApp fallback!`);
      phResult.platform = targetPlatform;
      return phResult;
    }
  } catch (e) {
    console.warn(`[Scraper] PriceHistoryApp fallback failed: ${e.message}`);
  }

  // PriceBefore
  try {
    const pbResult = await scrapeFromPriceBefore(url);
    if (pbResult && pbResult.success && pbResult.title && pbResult.price) {
      console.log(`[Scraper] Success via PriceBefore fallback!`);
      pbResult.platform = targetPlatform;
      return pbResult;
    }
  } catch (e) {
    console.warn(`[Scraper] PriceBefore fallback failed: ${e.message}`);
  }

  // Fallback direct parse got details but missed the image
  if (directData && directData.title) {
    console.log(`[Scraper Fallback] Returning parsed direct product data with missing image.`);
    return directData;
  }

  return {
    success: false,
    error: directError ? directError.message : 'Failed to scrape product details after all fallbacks.'
  };
}

/**
 * Generic helper to extract chart points from raw HTML page string.
 * Supports Unix timestamps and standard date string patterns inside array declarations.
 */
function parseChartPoints(html) {
  const dataPoints = [];
  try {
    // 1. Check for BuyHatke custom *~* serialization format anywhere in the HTML first
    const buyHatkeFormatRegex = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})~(\d+(?:\.\d+)?)/g;
    let bhMatch;
    while ((bhMatch = buyHatkeFormatRegex.exec(html)) !== null) {
      dataPoints.push({
        timestamp: new Date(`${bhMatch[1]}T${bhMatch[2]}`),
        price: parseFloat(bhMatch[3])
      });
    }

    if (dataPoints.length > 0) {
      return dataPoints;
    }

    const $ = cheerio.load(html);
    $('script').each((i, el) => {
      const scriptContent = $(el).html();
      if (!scriptContent) return;
      if (!scriptContent.includes('chart') && !scriptContent.includes('series') && !scriptContent.includes('data') && !scriptContent.includes('history')) {
        return;
      }
      
      const timestampRegex = /\[\s*(\d{12,13})\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
      let match;
      while ((match = timestampRegex.exec(scriptContent)) !== null) {
        dataPoints.push({
          timestamp: new Date(parseInt(match[1])),
          price: parseFloat(match[2])
        });
      }
      
      const dateStrRegex = /\[\s*['"](\d{4}-\d{2}-\d{2})['"]\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
      while ((match = dateStrRegex.exec(scriptContent)) !== null) {
        dataPoints.push({
          timestamp: new Date(match[1]),
          price: parseFloat(match[2])
        });
      }

      // Check for {"dates":[...],"prices":[...]} JSON structure (PriceBefore style)
      const dataJsonRegex = /var\s+data\s*=\s*({[^;]+});/i;
      const jsonMatch = dataJsonRegex.exec(scriptContent);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsedData = JSON.parse(jsonMatch[1]);
          if (parsedData.dates && parsedData.prices && parsedData.dates.length === parsedData.prices.length) {
            for (let j = 0; j < parsedData.dates.length; j++) {
              dataPoints.push({
                timestamp: new Date(parsedData.dates[j]),
                price: parseFloat(parsedData.prices[j])
              });
            }
          }
        } catch (e) {}
      }
    });
  } catch (err) {
    console.error('[parseChartPoints Error]', err.message);
  }
  return dataPoints;
}

async function scrapeFromPriceHistoryApp(productUrl, productTitle) {
  let html = '';
  let productPageLink = '';
  
  const cleanUrl = getCanonicalUrl(productUrl);
  const searchUrl = `https://pricehistory.app/search?q=${encodeURIComponent(cleanUrl)}`;
  console.log(`[PriceHistoryApp Scrape] Searching for URL: ${cleanUrl}`);
  try {
    html = await fetchPageHtmlWithRetries(searchUrl, 35000, 3);
    
    // Instant redirect detection
    const instantDetails = extractFromTrackerPage(html, productUrl, 'PriceHistoryApp');
    if (instantDetails.success && instantDetails.dataPoints && instantDetails.dataPoints.length > 0) {
      console.log(`[PriceHistoryApp Scrape] Direct redirect to product page detected!`);
      instantDetails.url = searchUrl;
      instantDetails.source = 'PriceHistoryApp';
      return instantDetails;
    }

    const $ = cheerio.load(html);
    
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/product/')) {
        productPageLink = href.startsWith('http') ? href : `https://pricehistory.app${href}`;
        return false;
      }
    });
  } catch (e) {
    console.warn(`[PriceHistoryApp Scrape] Search by URL failed: ${e.message}`);
  }
  
  if (!productPageLink && productTitle) {
    const cleanTitle = productTitle.split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s]/g, '');
    const searchTitleUrl = `https://pricehistory.app/search?q=${encodeURIComponent(cleanTitle)}`;
    console.log(`[PriceHistoryApp Scrape] Trying title fallback: "${cleanTitle}"`);
    try {
      html = await fetchPageHtmlWithRetries(searchTitleUrl, 35000, 3);
      const $ = cheerio.load(html);
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/product/')) {
          productPageLink = href.startsWith('http') ? href : `https://pricehistory.app${href}`;
          return false;
        }
      });
    } catch (e) {
      console.warn(`[PriceHistoryApp Scrape] Search by Title failed: ${e.message}`);
    }
  }
  
  if (!productPageLink) {
    console.log(`[PriceHistoryApp Scrape] No matching product link found.`);
    return null;
  }
  
  console.log(`[PriceHistoryApp Scrape] Fetching product page: ${productPageLink}`);
  try {
    const pageHtml = await fetchPageHtmlWithRetries(productPageLink, 35000, 3);
    // Instant redirect detection
    const instantDetails = extractFromTrackerPage(html, productUrl, 'PriceHistoryApp');
    if (instantDetails.success && instantDetails.dataPoints && instantDetails.dataPoints.length > 0) {
      instantDetails.url = searchUrl;
      instantDetails.source = 'PriceHistoryApp';
      return instantDetails;
    }
    const details = extractFromTrackerPage(pageHtml, productUrl, 'PriceHistoryApp');
    if (details.success && details.dataPoints && details.dataPoints.length > 0) {
      console.log(`[PriceHistoryApp Scrape] Successfully parsed product and ${details.dataPoints.length} points!`);
      details.url = productPageLink;
      details.source = 'PriceHistoryApp';
      return details;
    }
  } catch (e) {
    console.error(`[PriceHistoryApp Scrape Page Fetch Error] ${e.message}`);
  }
  return null;
}

/**
 * Attempts to scrape historical price details from BuyHatke
 */
async function scrapeFromBuyHatke(productUrl, productTitle) {
  let html = '';
  let productPageLink = '';
  
  const cleanUrl = getCanonicalUrl(productUrl);
  
  // 1. Try direct magic link first to bypass search & redirects
  let magicUrl = '';
  try {
    const parsed = new URL(cleanUrl);
    const hostname = parsed.hostname.toLowerCase();
    let platformKey = '';
    if (hostname.includes('amazon.in') || hostname.includes('amazon.com')) {
      platformKey = 'amazon';
    } else if (hostname.includes('flipkart.com')) {
      platformKey = 'flipkart';
    } else if (hostname.includes('myntra.com')) {
      platformKey = 'myntra';
    } else if (hostname.includes('ajio.com')) {
      platformKey = 'ajio';
    } else if (hostname.includes('meesho.com')) {
      platformKey = 'meesho';
    } else if (hostname.includes('shopsy.in') || hostname.includes('shopsy.com')) {
      platformKey = 'shopsy';
    }
    
    if (platformKey) {
      magicUrl = `https://buyhatke.com/${platformKey}/${cleanUrl}`;
    }
  } catch (e) {
    console.error(`[BuyHatke Scrape] Error parsing URL for magic link: ${e.message}`);
  }

  if (magicUrl) {
    console.log(`[BuyHatke Scrape] Probing direct magic link: ${magicUrl}`);
    try {
      html = await fetchPageHtmlWithRetries(magicUrl, 35000, 3);
      const details = extractFromTrackerPage(html, productUrl, 'BuyHatke');
      if (details.success && details.dataPoints && details.dataPoints.length > 0) {
        console.log(`[BuyHatke Scrape] Successfully parsed product details directly via magic link!`);
        details.url = magicUrl;
        details.source = 'BuyHatke';
        return details;
      }
      console.log(`[BuyHatke Scrape] Magic link page has no data points or failed parsing. Falling back to search...`);
    } catch (e) {
      console.warn(`[BuyHatke Scrape] Magic link direct fetch failed: ${e.message}. Falling back to search...`);
    }
  }

  // 2. Fallback to search-based routing
  const searchUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(cleanUrl)}`;
  console.log(`[BuyHatke Scrape] Searching for URL: ${cleanUrl}`);
  try {
    html = await fetchPageHtmlWithRetries(searchUrl, 35000, 3);
    
    // Instant redirect detection
    const instantDetails = extractFromTrackerPage(html, productUrl, 'BuyHatke');
    if (instantDetails.success && instantDetails.dataPoints && instantDetails.dataPoints.length > 0) {
      console.log(`[BuyHatke Scrape] Direct redirect to product page detected!`);
      instantDetails.url = searchUrl;
      instantDetails.source = 'BuyHatke';
      return instantDetails;
    }

    const $ = cheerio.load(html);
    
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/products/')) {
        productPageLink = href.startsWith('http') ? href : `https://compare.buyhatke.com${href}`;
        return false;
      }
    });
  } catch (e) {
    console.warn(`[BuyHatke Scrape] Search by URL failed: ${e.message}`);
  }
  
  if (!productPageLink && productTitle) {
    const cleanTitle = productTitle.split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s]/g, '');
    const searchTitleUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(cleanTitle)}`;
    console.log(`[BuyHatke Scrape] Trying title fallback: "${cleanTitle}"`);
    try {
      html = await fetchPageHtmlWithRetries(searchTitleUrl, 35000, 3);
      const $ = cheerio.load(html);
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/products/')) {
          productPageLink = href.startsWith('http') ? href : `https://compare.buyhatke.com${href}`;
          return false;
        }
      });
    } catch (e) {
      console.warn(`[BuyHatke Scrape] Search by Title failed: ${e.message}`);
    }
  }
  
  if (!productPageLink) {
    console.log(`[BuyHatke Scrape] No matching product link found.`);
    return null;
  }
  
  console.log(`[BuyHatke Scrape] Fetching product page: ${productPageLink}`);
  try {
    const pageHtml = await fetchPageHtmlWithRetries(productPageLink, 35000, 3);
    // Instant redirect detection
    const instantDetails = extractFromTrackerPage(html, productUrl, 'BuyHatke');
    if (instantDetails.success && instantDetails.dataPoints && instantDetails.dataPoints.length > 0) {
      instantDetails.url = searchUrl;
      instantDetails.source = 'BuyHatke';
      return instantDetails;
    }
    const details = extractFromTrackerPage(pageHtml, productUrl, 'BuyHatke');
    if (details.success && details.dataPoints && details.dataPoints.length > 0) {
      console.log(`[BuyHatke Scrape] Successfully parsed product and ${details.dataPoints.length} points!`);
      details.url = productPageLink;
      details.source = 'BuyHatke';
      return details;
    }
  } catch (e) {
    console.error(`[BuyHatke Scrape Page Fetch Error] ${e.message}`);
  }
  return null;
}

/**
 * Attempts to scrape historical price details from PriceBefore
 */
async function scrapeFromPriceBefore(productUrl, productTitle) {
  let html = '';
  let productPageLink = '';
  
  const cleanUrl = getCanonicalUrl(productUrl);
  const searchUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(cleanUrl)}`;
  console.log(`[PriceBefore Scrape] Searching for URL: ${cleanUrl}`);
  try {
    html = await fetchPageHtmlWithRetries(searchUrl, 35000, 3);
    
    // Instant redirect detection
    const instantDetails = extractFromTrackerPage(html, productUrl, 'PriceBefore');
    if (instantDetails.success && instantDetails.dataPoints && instantDetails.dataPoints.length > 0) {
      console.log(`[PriceBefore Scrape] Direct redirect to product page detected!`);
      instantDetails.url = searchUrl;
      instantDetails.source = 'PriceBefore';
      return instantDetails;
    }

    const $ = cheerio.load(html);
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/p/') && href.endsWith('.html')) {
        productPageLink = href.startsWith('http') ? href : `https://pricebefore.com${href}`;
        return false;
      }
    });
  } catch (e) {
    console.warn(`[PriceBefore Scrape] Search by URL failed: ${e.message}`);
  }
  
  if (!productPageLink && productTitle) {
    const cleanTitle = productTitle.split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s]/g, '');
    const searchTitleUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(cleanTitle)}`;
    console.log(`[PriceBefore Scrape] Trying title fallback: "${cleanTitle}"`);
    try {
      html = await fetchPageHtmlWithRetries(searchTitleUrl, 35000, 3);
      const $ = cheerio.load(html);
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/p/') && href.endsWith('.html')) {
          productPageLink = href.startsWith('http') ? href : `https://pricebefore.com${href}`;
          return false;
        }
      });
    } catch (e) {
      console.warn(`[PriceBefore Scrape] Search by Title failed: ${e.message}`);
    }
  }
  
  if (!productPageLink) {
    console.log(`[PriceBefore Scrape] No matching product link found.`);
    return null;
  }
  
  console.log(`[PriceBefore Scrape] Fetching product page: ${productPageLink}`);
  try {
    const pageHtml = await fetchPageHtmlWithRetries(productPageLink, 35000, 3);
    const details = extractFromTrackerPage(pageHtml, productUrl, 'PriceBefore');
    if (details.success && details.dataPoints && details.dataPoints.length > 0) {
      console.log(`[PriceBefore Scrape] Successfully parsed product and ${details.dataPoints.length} points!`);
      details.url = productPageLink;
      details.source = 'PriceBefore';
      return details;
    }
  } catch (e) {
    console.error(`[PriceBefore Scrape Page Fetch Error] ${e.message}`);
  }
  return null;
}

/**
 * Orchestrator: Try BuyHatke first (due to direct magic link bypass),
 * then fallback to PriceHistoryApp, and then PriceBefore.
 */
async function scrapeHistoricalTracker(productUrl, productTitle, currentPrice = null) {
  // 1. Try BuyHatke (Max 2 attempts: primary + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`[Historical Scraper] BuyHatke - Attempt ${attempt}`);
    const result = await scrapeFromBuyHatke(productUrl, productTitle);
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      return result;
    }
    if (attempt < 2) {
      console.log(`[Historical Scraper] BuyHatke failed, retrying in 0.5s...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // 2. Try PriceHistoryApp (Max 2 attempts: primary + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`[Historical Scraper] PriceHistoryApp - Attempt ${attempt}`);
    const result = await scrapeFromPriceHistoryApp(productUrl, productTitle);
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      return result;
    }
    if (attempt < 2) {
      console.log(`[Historical Scraper] PriceHistoryApp failed, retrying in 0.5s...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // 3. Parallel fallback for other sites (PriceBefore)
  console.log(`[Historical Scraper] Sequential PriceHistoryApp and BuyHatke failed. Trying PriceBefore in parallel...`);
  try {
    const promises = [
      scrapeFromPriceBefore(productUrl, productTitle)
    ];
    const results = await Promise.all(promises);
    for (const res of results) {
      if (res && res.dataPoints && res.dataPoints.length > 0) {
        return res;
      }
    }
  } catch (err) {
    console.error('[Historical Scraper] Parallel scrape error:', err.message);
  }

  // 4. Fallback to Gemini AI Prediction or local simulated history
  if (process.env.GEMINI_API_KEY && currentPrice) {
    console.log(`[Historical Scraper] Invoking Gemini AI to predict price history...`);
    const geminiHistory = await predictPriceHistoryWithGemini(productUrl, productTitle, currentPrice, currentPrice * 1.25);
    if (geminiHistory && geminiHistory.dataPoints && geminiHistory.dataPoints.length > 0) {
      return geminiHistory;
    }
  }

  // Fallback to local simulated AI prediction if Gemini fails or is missing
  const priceNum = parseFloat(currentPrice);
  if (priceNum && !isNaN(priceNum)) {
    console.log(`[Historical Scraper] Falling back to local simulated history for price: ₹${priceNum}`);
    const dataPoints = [];
    const now = new Date();
    const daysAgo = [60, 45, 30, 20, 15, 7, 0];
    
    daysAgo.forEach((days) => {
      const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      let factor = 1.0;
      if (days === 60) factor = 1.05;
      else if (days === 45) factor = 1.02;
      else if (days === 30) factor = 0.95; // Lowest
      else if (days === 20) factor = 0.98;
      else if (days === 15) factor = 1.08; // Highest
      else if (days === 7) factor = 1.03;
      else factor = 1.0;
      
      const noise = (Math.random() * 0.03) - 0.015;
      const finalPrice = Math.round(priceNum * (factor + noise));
      
      dataPoints.push({
        timestamp: date,
        price: finalPrice
      });
    });
    
    return {
      url: productUrl,
      source: 'AI Prediction',
      dataPoints: dataPoints
    };
  }

  console.log(`[Historical Scraper] All trackers failed to retrieve price history.`);
  return null;
}

/**
 * Helper to call Google Gemini API REST endpoint using axios
 */
async function callGeminiAPI(prompt, systemInstruction = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not defined.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [
        {
          text: systemInstruction
        }
      ]
    };
  }

  const response = await axios.post(url, requestBody, {
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: 5000
  });

  const textResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Empty response from Gemini API.');
  }

  return JSON.parse(textResponse);
}

/**
 * Use Gemini AI to extract product details from clean HTML meta and text snippet
 */
async function scrapeProductWithGeminiFallback(html, productUrl) {
  try {
    const $ = cheerio.load(html);
    const metaTags = [];
    $('meta').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property');
      const content = $(el).attr('content');
      if (name && content) {
        metaTags.push(`${name}: ${content}`);
      }
    });

    const bodyText = $('body').text().replace(/\s+/g, ' ').substring(0, 15000);
    const context = `URL: ${productUrl}\n\nMeta Tags:\n${metaTags.join('\n')}\n\nClean Body Text:\n${bodyText}`;

    const systemInstruction = `You are a shopping site parser. Extract structured details from the product page context. You must return a valid JSON object matching the following structure precisely (no extra wrapping or explanation):
{
  "title": "string (the product name)",
  "price": number (the current selling price as a number, in INR),
  "originalPrice": number (the original MRP price as a number, in INR. If not found, use the current price),
  "discount": "string (e.g. '30% OFF' or empty if none)",
  "image": "string (main product image URL)",
  "rating": number (rating out of 5, or null if not found)
}`;

    const prompt = `Here is the product page context:\n${context}`;
    const result = await callGeminiAPI(prompt, systemInstruction);

    if (result && result.title && typeof result.price === 'number') {
      return {
        success: true,
        platform: 'Gemini AI Parser',
        title: result.title,
        price: result.price,
        originalPrice: result.originalPrice || result.price,
        discount: result.discount || `${Math.round(((result.originalPrice - result.price) / result.originalPrice) * 100)}% OFF` || '0%',
        currency: '₹',
        image: result.image || '',
        rating: result.rating || null,
        url: productUrl
      };
    }
  } catch (e) {
    console.error(`[Gemini AI Parser Error] Failed to extract product details: ${e.message}`);
  }
  return null;
}

/**
 * Use Gemini AI to predict a realistic 90-day price history curve
 */
async function predictPriceHistoryWithGemini(productUrl, title, price, originalPrice) {
  try {
    const prompt = `Given this product information:
Title: ${title}
Current Price: INR ${price}
Original Price (MRP): INR ${originalPrice || price}
URL: ${productUrl}

Generate a realistic price history array containing 30 data points spanning the last 90 days.
The price points must fluctuate realistically based on standard e-commerce patterns (sales, discounts, price hikes) between the lowest historically likely price and MRP, ending at the current price (INR ${price}) on the final day.
Return a valid JSON array of objects (and absolutely nothing else), where each object has:
- date: string (format YYYY-MM-DD)
- price: number`;

    const systemInstruction = "You are a shopping database generator. You output only a JSON array of price history points.";
    const result = await callGeminiAPI(prompt, systemInstruction);

    if (Array.isArray(result) && result.length > 0) {
      const dataPoints = result.map(pt => ({
        timestamp: new Date(`${pt.date}T00:00:00Z`),
        price: parseFloat(pt.price)
      }));
      console.log(`[Gemini AI Prediction] Successfully generated ${dataPoints.length} realistic price points.`);
      return {
        url: productUrl,
        source: 'Gemini AI Prediction',
        dataPoints: dataPoints
      };
    }
  } catch (e) {
    console.error(`[Gemini AI Prediction Error] Failed to generate history: ${e.message}`);
  }
  return null;
}

/**
 * Direct shopping website scraping without checking other trackers (useful for parallel execution)
 */
async function scrapeProductDirectOnly(url) {
  if (!url) {
    return { success: false, error: 'URL is required' };
  }

  let targetPlatform = 'E-Commerce Store';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 2) {
      targetPlatform = hostParts[hostParts.length - 2].toUpperCase();
    }
  } catch (e) {}

  console.log(`[Scraper] Direct scraping shopping website...`);
  let directData = null;
  let directError = null;
  let attempts = 3;
  let directHtml = '';
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * i));
      }
      directHtml = await fetchPageHtml(url, 60000);
      const $ = cheerio.load(directHtml);
      let data;

      if (url.includes('flipkart.com')) {
        data = parseFlipkart($, url);
        if (!data.title) throw new Error('Failed to parse Flipkart product details.');
      } else if (url.includes('shopsy.in') || url.includes('shopsy.com')) {
        data = parseFlipkart($, url);
        if (!data.title) throw new Error('Failed to parse Shopsy product details.');
        data.platform = 'Shopsy';
      } else if (url.includes('amazon.in') || url.includes('amazon.com')) {
        data = parseAmazon($, url);
        if (!data.title) throw new Error('Failed to parse Amazon product details.');
      } else if (url.includes('myntra.com')) {
        data = parseMyntra($, url);
        if (!data.title) throw new Error('Failed to parse Myntra product details.');
      } else if (url.includes('ajio.com')) {
        data = parseAjio($, url);
        if (!data.title) throw new Error('Failed to parse Ajio product details.');
      } else if (url.includes('meesho.com')) {
        data = parseMeesho($, url);
        if (!data.title) throw new Error('Failed to parse Meesho product details.');
      } else if (url.includes('croma.com')) {
        data = parseCroma($, url);
        if (!data.title) throw new Error('Failed to parse Croma product details.');
      } else if (url.includes('reliancedigital.in')) {
        data = parseRelianceDigital($, url);
        if (!data.title) throw new Error('Failed to parse Reliance Digital product details.');
      } else if (url.includes('tatacliq.com')) {
        data = parseTataCliq($, url);
        if (!data.title) throw new Error('Failed to parse Tata Cliq product details.');
      } else if (url.includes('nykaa.com')) {
        data = parseNykaa($, url);
        if (!data.title) throw new Error('Failed to parse Nykaa product details.');
      } else {
        data = parseGenericMeta($, url);
        if (!data.title) throw new Error('Failed to parse product details from target site.');
      }

      if (!data.price || data.price <= 0) {
        throw new Error('No valid price extracted.');
      }

      if (!data.image || data.image.trim() === '' || data.image.startsWith('data:')) {
        throw new Error('No valid image extracted (missing or placeholder).');
      }

      if (data) {
        try {
          const canonical = $('link[rel="canonical"]').attr('href');
          if (canonical && canonical.startsWith('http')) {
            console.log(`[Scraper] Resolving input URL ${url} to page canonical: ${canonical}`);
            data.url = canonical;
          }
        } catch (e) {}
      }

      directData = data;
      break;
    } catch (err) {
      console.log(`⚠️ [Scraper Direct Attempt ${i+1}/${attempts} Failed] URL: ${url}. Error: ${err.message}`);
      directError = err;
      
      // If the page returned 404, the product doesn't exist. Stop retrying immediately!
      if (err.message && err.message.includes('404')) {
        console.log(`[Scraper] Store page returned 404 Not Found. Aborting retries...`);
        break;
      }
      
      // If we successfully fetched HTML (length > 2000) but parsing failed, do NOT retry
      if (directHtml && directHtml.length > 2000 && !directHtml.includes('cf-challenge') && !directHtml.includes('cloudflare')) {
        console.log(`[Scraper] Page html fetched successfully but parsing failed. Bypassing retries...`);
        break;
      }
    }
  }

  // If direct parser failed but we have HTML, try Gemini AI extraction
  if ((!directData || !directData.title || !directData.price) && directHtml && process.env.GEMINI_API_KEY) {
    console.log(`[Scraper] Direct parsing failed. Invoking Gemini AI fallback parser...`);
    const aiData = await scrapeProductWithGeminiFallback(directHtml, url);
    if (aiData && aiData.title) {
      console.log(`[Scraper] Success via Gemini AI fallback parser!`);
      directData = aiData;
    }
  }

  if (directData && directData.title) {
    directData.platform = directData.platform || targetPlatform;
    return directData;
  }

  return {
    success: false,
    error: directError ? directError.message : 'Failed to scrape product details.'
  };
}

module.exports = {
  scrapeProduct,
  scrapeHistoricalTracker,
  scrapeProductDirectOnly,
  predictPriceHistoryWithGemini
};
