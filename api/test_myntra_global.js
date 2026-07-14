require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  const myUrl = 'https://www.myntra.com/tshirts/roadster/roadster-men-black-cotton-pure-cotton-t-shirt/1990252/buy';
  
  // No country_code parameter!
  const requestUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(myUrl)}&render=true`;
  
  console.log('Fetching Myntra via global ScraperAPI with render=true...');
  try {
    const response = await axios.get(requestUrl, { timeout: 60000 });
    const html = response.data;
    const $ = cheerio.load(html);
    console.log('Title:', $('title').text().trim());
    console.log('HTML Length:', html.length);
    
    let hasMyx = false;
    $('script').each((i, el) => {
      const content = $(el).html() || '';
      if (content.includes('window.__myx')) {
        hasMyx = true;
        console.log('window.__myx found! Length:', content.length);
        console.log(content.substring(0, 500));
      }
    });
    if (!hasMyx) {
      console.log('window.__myx NOT found in HTML.');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
