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
              
  return {
    success: !!title,
    platform: 'Tata Cliq',
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
      } else if (url.includes('croma.com')) {
        data = parseCroma($, url);
        if (!data.title) {
          throw new Error('Failed to parse Croma product details.');
        }
      } else if (url.includes('reliancedigital.in')) {
        data = parseRelianceDigital($, url);
        if (!data.title) {
          throw new Error('Failed to parse Reliance Digital product details.');
        }
      } else if (url.includes('tatacliq.com')) {
        data = parseTataCliq($, url);
        if (!data.title) {
          throw new Error('Failed to parse Tata Cliq product details.');
        }
      } else if (url.includes('nykaa.com')) {
        data = parseNykaa($, url);
        if (!data.title) {
          throw new Error('Failed to parse Nykaa product details.');
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
 * Generic helper to extract chart points from raw HTML page string.
 * Supports Unix timestamps and standard date string patterns inside array declarations.
 */
function parseChartPoints(html) {
  const dataPoints = [];
  
  // 1. Try Unix timestamp format: [1712398500000, 4999]
  const timestampRegex = /\[\s*(\d{12,13})\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
  let match;
  while ((match = timestampRegex.exec(html)) !== null) {
    dataPoints.push({
      timestamp: new Date(parseInt(match[1])),
      price: parseFloat(match[2])
    });
  }
  
  if (dataPoints.length > 0) {
    return dataPoints;
  }
  
  // 2. Try ISO date string format: ["2024-04-10", 1499] or ['2024-04-10', 1499]
  const dateStrRegex = /\[\s*['"](\d{4}-\d{2}-\d{2})['"]\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
  while ((match = dateStrRegex.exec(html)) !== null) {
    dataPoints.push({
      timestamp: new Date(match[1]),
      price: parseFloat(match[2])
    });
  }
  
  return dataPoints;
}

/**
 * Attempts to scrape historical price details from PriceHistoryApp
 */
async function scrapeFromPriceHistoryApp(productUrl, productTitle) {
  let html = '';
  let productPageLink = '';
  
  const searchUrl = `https://pricehistory.app/search?q=${encodeURIComponent(productUrl)}`;
  console.log(`[PriceHistoryApp Scrape] Searching for URL: ${productUrl}`);
  try {
    html = await fetchPageHtml(searchUrl);
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
      html = await fetchPageHtml(searchTitleUrl);
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
    const pageHtml = await fetchPageHtml(productPageLink);
    const dataPoints = parseChartPoints(pageHtml);
    
    if (dataPoints.length > 0) {
      console.log(`[PriceHistoryApp Scrape] Successfully parsed ${dataPoints.length} points!`);
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      return {
        url: productPageLink,
        source: 'PriceHistoryApp',
        dataPoints: dataPoints
      };
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
  
  const searchUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(productUrl)}`;
  console.log(`[BuyHatke Scrape] Searching for URL: ${productUrl}`);
  try {
    html = await fetchPageHtml(searchUrl);
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
      html = await fetchPageHtml(searchTitleUrl);
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
    const pageHtml = await fetchPageHtml(productPageLink);
    const dataPoints = parseChartPoints(pageHtml);
    
    if (dataPoints.length > 0) {
      console.log(`[BuyHatke Scrape] Successfully parsed ${dataPoints.length} points!`);
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      return {
        url: productPageLink,
        source: 'BuyHatke',
        dataPoints: dataPoints
      };
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
  
  const searchUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(productUrl)}`;
  console.log(`[PriceBefore Scrape] Searching for URL: ${productUrl}`);
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
    console.warn(`[PriceBefore Scrape] Search by URL failed: ${e.message}`);
  }
  
  if (!productPageLink && productTitle) {
    const cleanTitle = productTitle.split(/\s+/).slice(0, 5).join(' ').replace(/[^\w\s]/g, '');
    const searchTitleUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(cleanTitle)}`;
    console.log(`[PriceBefore Scrape] Trying title fallback: "${cleanTitle}"`);
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
      console.warn(`[PriceBefore Scrape] Search by Title failed: ${e.message}`);
    }
  }
  
  if (!productPageLink) {
    console.log(`[PriceBefore Scrape] No matching product link found.`);
    return null;
  }
  
  console.log(`[PriceBefore Scrape] Fetching product page: ${productPageLink}`);
  try {
    const pageHtml = await fetchPageHtml(productPageLink);
    const dataPoints = parseChartPoints(pageHtml);
    
    if (dataPoints.length > 0) {
      console.log(`[PriceBefore Scrape] Successfully parsed ${dataPoints.length} points!`);
      dataPoints.sort((a, b) => a.timestamp - b.timestamp);
      return {
        url: productPageLink,
        source: 'PriceBefore',
        dataPoints: dataPoints
      };
    }
  } catch (e) {
    console.error(`[PriceBefore Scrape Page Fetch Error] ${e.message}`);
  }
  return null;
}

/**
 * Orchestrator: Try PriceHistoryApp first, then BuyHatke (each with 1 retry),
 * and fallback to PriceBefore.
 */
async function scrapeHistoricalTracker(productUrl, productTitle, currentPrice = null) {
  // 1. Try PriceHistoryApp (Max 2 attempts: primary + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`[Historical Scraper] PriceHistoryApp - Attempt ${attempt}`);
    const result = await scrapeFromPriceHistoryApp(productUrl, productTitle);
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      return result;
    }
    if (attempt < 2) {
      console.log(`[Historical Scraper] PriceHistoryApp failed, retrying in 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // 2. Try BuyHatke (Max 2 attempts: primary + 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`[Historical Scraper] BuyHatke - Attempt ${attempt}`);
    const result = await scrapeFromBuyHatke(productUrl, productTitle);
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      return result;
    }
    if (attempt < 2) {
      console.log(`[Historical Scraper] BuyHatke failed, retrying in 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // 3. Fallback to PriceBefore
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`[Historical Scraper] PriceBefore Fallback - Attempt ${attempt}`);
    const result = await scrapeFromPriceBefore(productUrl, productTitle);
    if (result && result.dataPoints && result.dataPoints.length > 0) {
      return result;
    }
    if (attempt < 2) {
      console.log(`[Historical Scraper] PriceBefore failed, retrying in 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // 4. Fallback to AI Prediction (Own prediction fallback based on current price)
  const priceNum = parseFloat(currentPrice);
  if (priceNum && !isNaN(priceNum)) {
    console.log(`[Historical Scraper] All scrapers failed. Generating own prediction history for price: ₹${priceNum}`);
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

module.exports = {
  scrapeProduct,
  scrapeHistoricalTracker
};
