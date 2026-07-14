const axios = require('axios');
const fs = require('fs');

async function fetchDirect(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br'
  };

  console.log(`Sending direct request to: ${url}`);
  const response = await axios.get(url, { headers, timeout: 15000 });
  return response.data;
}

async function test() {
  const productUrl = 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U';
  const searchUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(productUrl)}`;
  console.log('Searching BuyHatke directly...');
  try {
    const searchHtml = await fetchDirect(searchUrl);
    fs.writeFileSync('buyhatke_search.html', searchHtml);
    const cheerio = require('cheerio');
    let $ = cheerio.load(searchHtml);
    
    console.log('Title of search page:', $('title').text().trim());
    console.log('Number of links:', $('a').length);
    
    // Log all links to see if any link has products or comparison
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href.includes('/product') || href.includes('buyhatke') || i < 15) {
        console.log(`Link ${i}: href="${href}" text="${text}"`);
      }
    });
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
