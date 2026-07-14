require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

function extractSlug(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    
    if (url.includes('myntra.com')) {
      const parts = pathname.split('/');
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i] && parts[i] !== 'buy' && isNaN(parts[i])) {
          return parts[i].replace(/-/g, ' ');
        }
      }
    }
    const segments = pathname.split('/').filter(s => s && s.length > 3 && isNaN(s) && s !== 'buy' && s !== 'p' && s !== 'dp');
    if (segments.length > 0) {
      segments.sort((a, b) => b.length - a.length);
      return segments[0].replace(/-/g, ' ').replace(/_/g, ' ');
    }
  } catch (e) {}
  return '';
}

async function test() {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  const myUrl = 'https://www.myntra.com/tshirts/roadster/roadster-men-black-cotton-pure-cotton-t-shirt/1990252/buy';
  const slug = extractSlug(myUrl);
  console.log('Slug:', slug);
  
  const searchUrl = `https://pricehistory.app/search?q=${encodeURIComponent(slug)}`;
  const requestUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(searchUrl)}`;
  
  console.log('Fetching search results from PriceHistory.app via ScraperAPI...');
  try {
    const response = await axios.get(requestUrl);
    const html = response.data;
    const $ = cheerio.load(html);
    console.log('Title:', $('title').text().trim());
    
    let links = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('/product/')) {
        links.push(href);
      }
    });
    console.log('Found product links:', links.slice(0, 5));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
