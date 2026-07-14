require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function fetchScraperAPI(url, render = false, premium = false, keep_headers = false) {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  let params = `api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
  if (render) params += '&render=true';
  if (premium) params += '&premium=true';
  if (keep_headers) params += '&keep_headers=true';
  const requestUrl = `http://api.scraperapi.com?${params}`;
  console.log(`Sending ScraperAPI request (no country): ${requestUrl.replace(scraperApiKey, 'HIDDEN')}`);
  const response = await axios.get(requestUrl, { timeout: 30000 });
  return response.data;
}

async function test() {
  const urls = {
    flipkart: 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm2d83c1ce4734b',
    myntra: 'https://www.myntra.com/tshirts/roadster/roadster-men-black-cotton-pure-cotton-t-shirt/1990252/buy',
    buyhatke: 'https://compare.buyhatke.com/search?q=https%3A%2F%2Fwww.flipkart.com%2Fzebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth%2Fp%2Fitm688c968a793cd%3Fpid%3DACCFRR83EFREFT2U'
  };

  for (const [name, url] of Object.entries(urls)) {
    console.log(`\nTesting ${name}...`);
    try {
      const html = await fetchScraperAPI(url, true, false, false); // render=true
      fs.writeFileSync(`${name}_no_country.html`, html);
      const cheerio = require('cheerio');
      const $ = cheerio.load(html);
      console.log(`${name} Title:`, $('title').text().trim());
      console.log(`${name} Body snippet:`, $('body').text().replace(/\s+/g, ' ').trim().substring(0, 200));
    } catch (e) {
      console.error(`${name} failed:`, e.message);
    }
  }
}

test();
