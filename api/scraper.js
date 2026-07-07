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
    timeout: 15000
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
 * Main Scrape Function
 */
async function scrapeProduct(url) {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    const html = await fetchPageHtml(url);
    const $ = cheerio.load(html);

    if (url.includes('flipkart.com')) {
      const data = parseFlipkart($, url);
      if (!data.title) {
        throw new Error('Failed to parse Flipkart product details. Could be anti-bot block.');
      }
      return data;
    } else if (url.includes('amazon.in') || url.includes('amazon.com')) {
      const data = parseAmazon($, url);
      if (!data.title) {
        throw new Error('Failed to parse Amazon product details. Could be anti-bot block.');
      }
      return data;
    } else {
      throw new Error('Unsupported platform. Only Flipkart and Amazon URLs are supported.');
    }
  } catch (error) {
    console.error(`[Scraper Error] ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  scrapeProduct
};
