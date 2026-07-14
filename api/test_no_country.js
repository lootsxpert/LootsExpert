require('dotenv').config();
const axios = require('axios');

async function fetchScraperAPI(url, useCountry = false) {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  let params = `api_key=${scraperApiKey}&url=${encodeURIComponent(url)}`;
  if (useCountry && process.env.SCRAPERAPI_COUNTRY) {
    params += `&country_code=${process.env.SCRAPERAPI_COUNTRY}`;
  }
  const requestUrl = `http://api.scraperapi.com?${params}`;
  console.log(`Sending ScraperAPI request (useCountry=${useCountry}): ${requestUrl.replace(scraperApiKey, 'HIDDEN')}`);
  const response = await axios.get(requestUrl, { timeout: 20000 });
  return response.data;
}

async function test() {
  const url = 'https://www.amazon.in/dp/B0CHX1W1XY';
  
  console.log('Testing with country_code=in...');
  try {
    const html = await fetchScraperAPI(url, true);
    console.log('With country_code Success! Length:', html.length);
  } catch (e) {
    console.error('With country_code Failed:', e.message);
  }

  console.log('\nTesting without country_code...');
  try {
    const html = await fetchScraperAPI(url, false);
    console.log('Without country_code Success! Length:', html.length);
  } catch (e) {
    console.error('Without country_code Failed:', e.message);
  }
}

test();
