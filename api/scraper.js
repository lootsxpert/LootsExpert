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
 * Scrapes a URL using ScraperAPI, ScrapingBee, custom proxy, or direct request
 */
async function fetchPageHtml(url) {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  const scrapingBeeKey = process.env.SCRAPINGBEE_KEY;
  const proxyUrl = process.env.PROXY_URL;

  let requestUrl = url;
  let config = {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Device-Memory': '8',
      'Downlink': '10',
      'ECT': '4g',
      'RTT': '50',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 30000
  };

  // Route through proxy services if API keys are available
  if (scraperApiKey) {
    console.log(`[Scraper] Routing request through ScraperAPI for: ${url}`);
    let params = `api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
    if (process.env.SCRAPERAPI_RENDER === 'true') {
      params += '&render=true';
    }
    if (process.env.SCRAPERAPI_PREMIUM === 'true') {
      params += '&premium=true';
    }
    if (process.env.SCRAPERAPI_COUNTRY) {
      params += `&country_code=${process.env.SCRAPERAPI_COUNTRY}`;
    }
    requestUrl = `http://api.scraperapi.com?${params}`;
  } else if (scrapingBeeKey) {
    console.log(`[Scraper] Routing request through ScrapingBee for: ${url}`);
    const renderJs = process.env.SCRAPINGBEE_RENDER === 'true' ? 'true' : 'false';
    let params = `api_key=${scrapingBeeKey}&url=${encodeURIComponent(url)}&render_js=${renderJs}`;
    if (process.env.SCRAPINGBEE_PREMIUM === 'true') {
      params += '&premium_proxy=true';
    }
    if (process.env.SCRAPINGBEE_COUNTRY) {
      params += `&country_code=${process.env.SCRAPINGBEE_COUNTRY}`;
    }
    requestUrl = `https://app.scrapingbee.com/api/v1/?${params}`;
  } else if (proxyUrl) {
    console.log(`[Scraper] Using custom proxy: ${proxyUrl}`);
    // Support proxy setting in Axios
    const { HttpsProxyAgent } = require('https-proxy-agent');
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
  } else {
    console.log(`[Scraper] Performing direct request for: ${url}`);
  }

  const response = await axios.get(requestUrl, config);
  return response.data;
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
  const imgElement = $('img._396cs4, img.CXW8mj, ._0DkuPH img, img[src*="image/"]').first();
  if (imgElement.length) {
    image = imgElement.attr('src');
  } else {
    // Fallback search
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('imagedeps') || (src && src.includes('image') && !src.includes('logo') && !src.includes('icon'))) {
        image = src;
        return false;
      }
    });
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
    if (html && html.includes('window.__myx')) {
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
            image = pdp.media.albums[0].images[0].src;
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

  // Fallback selectors
  if (!title) {
    title = $('.pdp-title').text().trim() + ' ' + $('.pdp-name').text().trim();
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
          title = productDetails.name;
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
  $('script').each((i, el) => {
    const html = $(el).html();
    if (html && html.includes('window.__INITIAL_STATE__')) {
      scriptContent = html;
      return false;
    }
  });

  if (scriptContent) {
    try {
      const parts = scriptContent.split('window.__INITIAL_STATE__=');
      if (parts.length > 1) {
        const jsonStr = parts[1].trim();
        const cleanJsonStr = jsonStr.endsWith(';') ? jsonStr.slice(0, -1) : jsonStr;
        const data = JSON.parse(cleanJsonStr);

        let pdp = null;
        if (data.productDetails) {
          pdp = data.productDetails;
        } else if (data.pdp && data.pdp.productDetails) {
          pdp = data.pdp.productDetails;
        } else if (data.product && data.product.productDetails) {
          pdp = data.product.productDetails;
        }

        if (pdp) {
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
      }
    } catch (e) {
      console.error('[Scraper Error] Meesho JSON parse failed:', e.message);
    }
  }

  if (!title) {
    title = $('span[class*="CatalogDetails__Text"]').first().text().trim() || $('h1').text().trim();
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
 * Main Scrape Function
 */
async function scrapeProduct(url) {
  let attempts = 3;
  let lastError = null;
  let parsedData = null;

  for (let i = 0; i < attempts; i++) {
    try {
      if (!url) {
        throw new Error('URL is required');
      }

      if (i > 0) {
        // Sleep between retries
        await new Promise(resolve => setTimeout(resolve, 1000 * i));
      }

      const html = await fetchPageHtml(url);
      const $ = cheerio.load(html);
      let data;

      if (url.includes('flipkart.com')) {
        data = parseFlipkart($, url);
        if (!data.title) {
          throw new Error('Failed to parse Flipkart product details.');
        }
      } else if (url.includes('shopsy.in') || url.includes('shopsy.com')) {
        data = parseFlipkart($, url);
        if (!data.title) {
          throw new Error('Failed to parse Shopsy product details.');
        }
        data.platform = 'Shopsy';
      } else if (url.includes('amazon.in') || url.includes('amazon.com')) {
        data = parseAmazon($, url);
        if (!data.title) {
          throw new Error('Failed to parse Amazon product details.');
        }
      } else if (url.includes('myntra.com')) {
        data = parseMyntra($, url);
        if (!data.title) {
          throw new Error('Failed to parse Myntra product details.');
        }
      } else if (url.includes('ajio.com')) {
        data = parseAjio($, url);
        if (!data.title) {
          throw new Error('Failed to parse Ajio product details.');
        }
      } else if (url.includes('meesho.com')) {
        data = parseMeesho($, url);
        if (!data.title) {
          throw new Error('Failed to parse Meesho product details.');
        }
      } else {
        data = parseGenericMeta($, url);
        if (!data.title) {
          throw new Error('Failed to parse product details from target site.');
        }
      }

      parsedData = data;

      // If we got the product details but there is no image (or image is empty), let's retry!
      if (!data.image || data.image.trim() === '') {
        throw new Error('No image extracted.');
      }

      return data; // Success!

    } catch (err) {
      console.log(`⚠️ [Scraper Attempt ${i+1}/${attempts} Failed] URL: ${url}. Error: ${err.message}`);
      lastError = err;
    }
  }

  // Fallback: If we managed to parse the product but just couldn't extract the image, return the product anyway rather than throwing!
  if (parsedData && parsedData.title) {
    console.log(`[Scraper Fallback] Returning parsed product data with missing image.`);
    return parsedData;
  }

  return {
    success: false,
    error: lastError ? lastError.message : 'Failed to scrape product after 3 attempts'
  };
}

/**
 * Attempts to scrape historical price details from PriceBefore
 */
async function scrapeHistoricalTracker(productUrl, productTitle) {
  try {
    let html = '';
    let productPageLink = '';
    
    // 1. Try URL search first
    const searchUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(productUrl)}`;
    console.log(`[Tracker Scrape] Searching PriceBefore for URL: ${productUrl}`);
    try {
      html = await fetchPageHtml(searchUrl);
      const $ = cheerio.load(html);
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/p/') && href.endsWith('.html')) {
          productPageLink = href.startsWith('http') ? href : `https://pricebefore.com${href}`;
          return false;
        }
      });
    } catch (e) {
      console.warn(`[Tracker Scrape] URL search failed: ${e.message}`);
    }
    
    // 2. Fallback: Search by clean product title
    if (!productPageLink && productTitle) {
      const cleanTitle = productTitle.split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s]/g, '');
      const searchTitleUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(cleanTitle)}`;
      console.log(`[Tracker Scrape] URL search returned nothing. Trying title fallback: "${cleanTitle}"`);
      
      try {
        html = await fetchPageHtml(searchTitleUrl);
        const $ = cheerio.load(html);
        $('a').each((i, el) => {
          const href = $(el).attr('href');
          if (href && href.includes('/p/') && href.endsWith('.html')) {
            productPageLink = href.startsWith('http') ? href : `https://pricebefore.com${href}`;
            return false;
          }
        });
      } catch (e) {
        console.warn(`[Tracker Scrape] Title search failed: ${e.message}`);
      }
    }
    
    if (!productPageLink) {
      console.log(`[Tracker Scrape] No matching product page found on PriceBefore.`);
      return null;
    }
    
    console.log(`[Tracker Scrape] Fetching product tracker page: ${productPageLink}`);
    const pageHtml = await fetchPageHtml(productPageLink);
    
    const dataPoints = [];
    const scriptRegex = /\[\s*(\d{12,13})\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
    
    const $$ = cheerio.load(pageHtml);
    $$('script').each((i, el) => {
      const scriptContent = $$(el).html();
      if (scriptContent && (scriptContent.includes('Highcharts') || scriptContent.includes('chart') || scriptContent.includes('series'))) {
        let match;
        scriptRegex.lastIndex = 0;
        while ((match = scriptRegex.exec(scriptContent)) !== null) {
          const timestamp = parseInt(match[1]);
          const price = parseFloat(match[2]);
          dataPoints.push({
            timestamp: new Date(timestamp),
            price: price
          });
        }
      }
    });
    
    if (dataPoints.length > 0) {
      console.log(`[Tracker Scrape] Successfully parsed ${dataPoints.length} history points from PriceBefore!`);
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      return {
        url: productPageLink,
        source: 'PriceBefore',
        dataPoints: dataPoints
      };
    }
    
    console.log(`[Tracker Scrape] No chart data found inside script tags on page.`);
    return null;
  } catch (err) {
    console.error(`[Tracker Scrape Error] ${err.message}`);
    return null;
  }
}

module.exports = {
  scrapeProduct,
  scrapeHistoricalTracker
};
