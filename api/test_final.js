require('dotenv').config();
const { scrapeProduct } = require('./scraper');

async function test() {
  const urls = [
    'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U', // Flipkart Product
    'https://www.myntra.com/tshirts/roadster/roadster-men-black-cotton-pure-cotton-t-shirt/1990252/buy', // Myntra Product
    'https://www.amazon.in/dp/B0CHX1W1XY' // Amazon Product
  ];

  for (const url of urls) {
    console.log(`\n=======================================\nTesting URL: ${url}`);
    try {
      const res = await scrapeProduct(url);
      console.log('Result:', JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('Error occurred:', err);
    }
  }
}

test();
