require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function fetchScraperAPI(url, render = false, premium = false) {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  let params = `api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
  if (render) params += '&render=true';
  if (premium) params += '&premium=true';
  const requestUrl = `http://api.scraperapi.com?${params}`;
  console.log(`Sending ScraperAPI request: ${requestUrl.replace(scraperApiKey, 'HIDDEN')}`);
  const response = await axios.get(requestUrl, { timeout: 45000 });
  return response.data;
}

async function test() {
  const productUrl = 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U';
  const searchUrl = `https://compare.buyhatke.com/search?q=${encodeURIComponent(productUrl)}`;
  
  console.log('Testing with standard ScraperAPI (no render)...');
  try {
    const html = await fetchScraperAPI(searchUrl, false, false);
    fs.writeFileSync('bh_std.html', html);
    console.log('Saved bh_std.html, Length:', html.length);
  } catch (e) {
    console.error('Std failed:', e.message);
  }

  console.log('\nTesting with ScraperAPI (render=true)...');
  try {
    const html = await fetchScraperAPI(searchUrl, true, false);
    fs.writeFileSync('bh_render.html', html);
    console.log('Saved bh_render.html, Length:', html.length);
  } catch (e) {
    console.error('Render failed:', e.message);
  }
}

test();
