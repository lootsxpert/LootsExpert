require('dotenv').config();
const { scrapeHistoricalTracker } = require('./scraper');

async function run() {
  const url = 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U';
  console.log('Testing scrapeHistoricalTracker for Flipkart...');
  try {
    const result = await scrapeHistoricalTracker(url, 'Zebronics duke');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

run();
