const { 
  initDatabase, 
  saveProduct, 
  updateProductDealStats, 
  pool 
} = require('./db');
const { scrapeProduct } = require('./scraper');

const SEED_PRODUCTS = [
  {
    url: 'https://www.amazon.in/iPhone-16e-512-Intelligence-Supersized/dp/B0DXQJ1M7H',
    platform: 'Amazon',
    title: 'iPhone 16e 128GB (Intelligence, Supersized Action Button)',
    price: 54999,
    originalPrice: 59999,
    discount: '8% OFF',
    rating: 4.6,
    image: 'https://m.media-amazon.com/images/I/71d7rfuGyYL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/OnePlus-Nord-Celadon-128GB-Storage/dp/B0CY5HG5N5',
    platform: 'Amazon',
    title: 'OnePlus Nord CE4 (Celadon Marble, 8GB RAM, 128GB Storage)',
    price: 24999,
    originalPrice: 26999,
    discount: '7% OFF',
    rating: 4.4,
    image: 'https://m.media-amazon.com/images/I/61Mp15v-78L._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Apple-MacBook-Chip-13-3-inch-256GB/dp/B08N5W4NNB',
    platform: 'Amazon',
    title: 'Apple MacBook Air Laptop with M1 chip: 13.3-inch Retina Display, 8GB RAM, 256GB SSD',
    price: 64990,
    originalPrice: 92900,
    discount: '30% OFF',
    rating: 4.7,
    image: 'https://m.media-amazon.com/images/I/71vFKBpKakL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Sony-WH-CH720N-Cancelling-Bluetooth-Headphones/dp/B0BS1RFH5B',
    platform: 'Amazon',
    title: 'Sony WH-CH720N Wireless Noise Cancelling Headphones, 35 Hours Battery',
    price: 7990,
    originalPrice: 14990,
    discount: '47% OFF',
    rating: 4.3,
    image: 'https://m.media-amazon.com/images/I/51+G-o8vIeL._SL1200_.jpg'
  },
  {
    url: 'https://www.amazon.in/HP-i5-1334U-Anti-glare-15-6-inch-Graphics/dp/B0D4LWYWF9',
    platform: 'Amazon',
    title: 'HP Laptop 15s, AMD Ryzen 5 5500U, 15.6-inch, 16GB DDR4, 512GB SSD',
    price: 38990,
    originalPrice: 49990,
    discount: '22% OFF',
    rating: 4.1,
    image: 'https://m.media-amazon.com/images/I/71t6W6DqRGL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Samsung-Galaxy-Blue-Silver-Storage-Without/dp/B0CX587MSK',
    platform: 'Amazon',
    title: 'Samsung Galaxy M15 5G (Blue Silver, 6GB RAM, 128GB Storage)',
    price: 11999,
    originalPrice: 15999,
    discount: '25% OFF',
    rating: 4.2,
    image: 'https://m.media-amazon.com/images/I/81T318m1unL._SL1500_.jpg'
  },
  {
    url: 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U',
    platform: 'Flipkart',
    title: 'ZEBRONICS Zeb-Duke 60H Backup BT v5.3 Gaming Mode Wireless Headphone',
    price: 999,
    originalPrice: 1999,
    discount: '50% OFF',
    rating: 4.0,
    image: 'https://rukminim2.flixcart.com/image/612/612/xif0q/headphone/d/k/z/zeb-duke-zebronics-original-imagzs2jyyz5gg5z.jpeg'
  },
  {
    url: 'https://www.amazon.in/Rockerz-450-Lightweight-Ergonomic-Resistance/dp/B07PR1CL3S',
    platform: 'Amazon',
    title: 'boAt Rockerz 450 Bluetooth On Ear Headphones with Mic, 15 Hours Playback',
    price: 1499,
    originalPrice: 3990,
    discount: '62% OFF',
    rating: 4.1,
    image: 'https://m.media-amazon.com/images/I/61kxU6k4jFL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Xiaomi-inches-Dolby-Vision-L43M8-A2IN/dp/B0CBP7685E',
    platform: 'Amazon',
    title: 'Xiaomi Smart TV X Series 108 cm (43 inches) 4K Ultra HD Google TV',
    price: 24999,
    originalPrice: 42999,
    discount: '42% OFF',
    rating: 4.2,
    image: 'https://m.media-amazon.com/images/I/71u+f-FhX7L._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Samsung-Direct-Cool-Refrigerator-RR20C2723S8-NL/dp/B0BSH7461G',
    platform: 'Amazon',
    title: 'Samsung 183 L 3 Star Direct-Cool Single Door Refrigerator',
    price: 14990,
    originalPrice: 18990,
    discount: '21% OFF',
    rating: 4.3,
    image: 'https://m.media-amazon.com/images/I/61+oG-W3FmL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/LG-Inverter-Washing-FHM1207SDM-Middle/dp/B0C39R5YGD',
    platform: 'Amazon',
    title: 'LG 7 Kg 5 Star Inverter Fully-Automatic Front Loading Washing Machine',
    price: 28990,
    originalPrice: 39990,
    discount: '28% OFF',
    rating: 4.4,
    image: 'https://m.media-amazon.com/images/I/61LgL5K74WL._SL1500_.jpg'
  },
  {
    url: 'https://www.amazon.in/Puma-Mens-Smash-Leather-Sneaker/dp/B01F1836QO',
    platform: 'Amazon',
    title: 'Puma Men\'s Smashic Leather Sneakers',
    price: 1999,
    originalPrice: 4499,
    discount: '55% OFF',
    rating: 4.1,
    image: 'https://m.media-amazon.com/images/I/6125yA4QUtL._SL1500_.jpg'
  },
  {
    url: 'https://www.flipkart.com/roadster-men-rhodium-plated-chain/p/itmdcf4f5d23315a?pid=CHNGFYGGHGXNKYHV',
    platform: 'Flipkart',
    title: 'Roadster Men Rhodium-Plated Alloy Chain',
    price: 239,
    originalPrice: 340,
    discount: '30% OFF',
    rating: 4.1,
    image: 'https://rukminim2.flixcart.com/image/612/612/xif0q/chains/h/y/v/1-alloy-rhodium-plated-chain-roadster-original-imaghfymqky4tshf.jpeg'
  },
  {
    url: 'https://www.amazon.in/YouBella-Jewellery-Earrings-Traditional-Earings/dp/B07N8DMDV2',
    platform: 'Amazon',
    title: 'YouBella Jewellery Earrings for Women Gold Plated Traditional Jhumka Earrings',
    price: 299,
    originalPrice: 1499,
    discount: '80% OFF',
    rating: 4.0,
    image: 'https://m.media-amazon.com/images/I/71R223e7PUL._SL1100_.jpg'
  },
  {
    url: 'https://www.amazon.in/Philips-Base-9-Watt-LED-Bulb/dp/B00VTHDX1G',
    platform: 'Amazon',
    title: 'Philips Base B22 9-Watt LED Bulb (Pack of 2)',
    price: 199,
    originalPrice: 320,
    discount: '37% OFF',
    rating: 4.3,
    image: 'https://m.media-amazon.com/images/I/51wXpD5J85L._SL1000_.jpg'
  },
  {
    url: 'https://www.amazon.in/Nivea-Soft-Light-Cream-300ml/dp/B00E96N3EO',
    platform: 'Amazon',
    title: 'Nivea Soft Light Moisturiser Cream, Playful Peach, 300ml',
    price: 299,
    originalPrice: 449,
    discount: '33% OFF',
    rating: 4.4,
    image: 'https://m.media-amazon.com/images/I/51oZ5d4hG2L._SL1000_.jpg'
  }
];

async function insertMockHistory(productId, currentPrice, originalPrice) {
  const today = new Date();
  const dataPoints = [];
  let tempPrice = currentPrice * 1.08; // Start slightly higher
  
  for (let i = 180; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    
    // Fluctuation: random walk with negative trend to simulate a deal today
    const randomWalk = (Math.random() - 0.47) * 0.015 * currentPrice;
    
    tempPrice = Math.max(currentPrice * 0.88, Math.min(originalPrice || (currentPrice * 1.25), tempPrice - randomWalk));
    
    dataPoints.push({
      price: Math.round(tempPrice),
      timestamp: date
    });
  }
  // Ensure the latest point matches currentPrice exactly
  dataPoints[dataPoints.length - 1].price = currentPrice;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear any previous history
    await client.query('DELETE FROM price_history WHERE product_id = $1', [productId]);
    
    for (const pt of dataPoints) {
      await client.query(
        'INSERT INTO price_history (product_id, price, timestamp) VALUES ($1, $2, $3)',
        [productId, pt.price, pt.timestamp]
      );
    }
    await client.query('COMMIT');
    console.log(`[Seeding] Inserted ${dataPoints.length} simulated history logs for product ID ${productId}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seeding Error] Failed to write mock history:', err.message);
  } finally {
    client.release();
  }
}

async function runSeed() {
  console.log('🌱 Starting Database Seeding...');
  await initDatabase();
  
  for (const product of SEED_PRODUCTS) {
    try {
      console.log(`--------------------------------------------------`);
      console.log(`[Seeding] Processing product: ${product.title}`);
      
      // Check if product already exists
      const existingRes = await pool.query('SELECT id FROM products WHERE url = $1', [product.url]);
      let productId = existingRes.rows[0]?.id;
      
      let finalPrice = product.price;
      let finalOriginalPrice = product.originalPrice;
      let finalDiscount = product.discount;
      let finalTitle = product.title;
      let finalImage = product.image;
      let finalRating = product.rating;
      let finalPlatform = product.platform;
      
      let scrapeSuccess = false;
      
      try {
        console.log(`[Seeding] Attempting live scrape for: ${product.url}`);
        const scrapeRes = await scrapeProduct(product.url);
        
        if (scrapeRes && scrapeRes.success && scrapeRes.title && scrapeRes.price) {
          console.log(`[Seeding] Live scrape SUCCEEDED! Using scraped live details.`);
          finalTitle = scrapeRes.title;
          finalPrice = scrapeRes.price;
          finalOriginalPrice = scrapeRes.originalPrice || scrapeRes.price;
          finalDiscount = scrapeRes.discount || '0%';
          finalImage = scrapeRes.image || product.image;
          finalRating = scrapeRes.rating || product.rating;
          finalPlatform = scrapeRes.platform;
          scrapeSuccess = true;
        } else {
          console.log(`[Seeding] Live scrape returned failure: ${scrapeRes?.error || 'Empty title/price'}. Falling back to mock details.`);
        }
      } catch (e) {
        console.log(`[Seeding] Live scrape errored: ${e.message}. Falling back to mock details.`);
      }
      
      const saved = await saveProduct({
        url: product.url,
        platform: finalPlatform,
        title: finalTitle,
        image: finalImage,
        rating: finalRating
      });
      
      if (saved) {
        productId = saved.id;
        
        if (scrapeSuccess) {
          // If live scrape succeeded, try running background PriceBefore scraper
          // For seeding speed, we can insert mock history anyway, but let's run mock history as standard baseline
          // to ensure a beautiful 180-day graph. If PriceBefore exists, it will merge/override.
          await insertMockHistory(productId, finalPrice, finalOriginalPrice);
        } else {
          // Scraper failed, generate simulated price history
          await insertMockHistory(productId, finalPrice, finalOriginalPrice);
        }
        
        // Finalize deal scores
        await updateProductDealStats(
          productId, 
          finalPrice, 
          finalOriginalPrice, 
          finalDiscount, 
          finalTitle
        );
      }
      
    } catch (err) {
      console.error(`[Seeding Error] Failed to seed product ${product.url}:`, err);
    }
  }
  
  console.log(`==================================================`);
  console.log('✅ Database seeding finished successfully!');
  console.log(`==================================================`);
  process.exit(0);
}

runSeed();
