const axios = require('axios');
const cheerio = require('cheerio');

function extractSlug(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    
    if (url.includes('amazon.in') || url.includes('amazon.com')) {
      const parts = pathname.split('/');
      const dpIndex = parts.indexOf('dp');
      if (dpIndex > 0 && parts[dpIndex - 1]) {
        return parts[dpIndex - 1].replace(/-/g, ' ');
      }
    }
    
    if (url.includes('flipkart.com') || url.includes('shopsy')) {
      const parts = pathname.split('/');
      const pIndex = parts.indexOf('p');
      if (pIndex > 0 && parts[pIndex - 1]) {
        return parts[pIndex - 1].replace(/-/g, ' ');
      }
    }

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

async function testTrackerDirect(productUrl, trackerName) {
  const slug = extractSlug(productUrl);
  console.log(`\nURL: ${productUrl}\nParsed Slug: "${slug}"`);

  let searchUrl = '';
  if (trackerName === 'PriceHistoryApp') {
    searchUrl = `https://pricehistory.app/search?q=${encodeURIComponent(slug)}`;
  } else if (trackerName === 'PriceBefore') {
    searchUrl = `https://pricebefore.com/search/?q=${encodeURIComponent(slug)}`;
  } else if (trackerName === 'BuyHatke') {
    searchUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(slug)}`;
  }

  console.log(`Direct Request to ${trackerName}: ${searchUrl}`);
  try {
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });
    const html = response.data;
    const $ = cheerio.load(html);
    console.log(`${trackerName} Response Title:`, $('title').text().trim());
    
    // Find matching links
    let links = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (trackerName === 'PriceHistoryApp' && href.includes('/product/')) {
        links.push(href);
      } else if (trackerName === 'BuyHatke' && href.includes('/products/')) {
        links.push(href);
      } else if (trackerName === 'PriceBefore' && href.includes('/p/') && href.endsWith('.html')) {
        links.push(href);
      }
    });
    console.log(`${trackerName} Product links found:`, links.slice(0, 3));
  } catch (e) {
    console.error(`${trackerName} request failed:`, e.message);
  }
}

async function run() {
  const fkUrl = 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U';
  const myUrl = 'https://www.myntra.com/tshirts/roadster/roadster-men-black-cotton-pure-cotton-t-shirt/1990252/buy';
  
  await testTrackerDirect(fkUrl, 'PriceHistoryApp');
  await testTrackerDirect(fkUrl, 'PriceBefore');
  await testTrackerDirect(fkUrl, 'BuyHatke');

  await testTrackerDirect(myUrl, 'PriceHistoryApp');
  await testTrackerDirect(myUrl, 'PriceBefore');
  await testTrackerDirect(myUrl, 'BuyHatke');
}

run();
