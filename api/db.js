const { Pool } = require('pg');
const { createClient } = require('redis');

// Database URLs
let DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:yUAkumMqejYdHBijJxzmmRdmxrEKEiog@hayabusa.proxy.rlwy.net:42335/railway';
let REDIS_URL = process.env.REDIS_URL || 'redis://default:QTnNEjgbYgOuqQwxaBLNyKlodHdlfwIC@hayabusa.proxy.rlwy.net:51042';

DATABASE_URL = DATABASE_URL.trim();
if (DATABASE_URL.startsWith('"') && DATABASE_URL.endsWith('"')) DATABASE_URL = DATABASE_URL.slice(1, -1);
if (DATABASE_URL.startsWith("'") && DATABASE_URL.endsWith("'")) DATABASE_URL = DATABASE_URL.slice(1, -1);

if (REDIS_URL) {
  REDIS_URL = REDIS_URL.trim();
  if (REDIS_URL.startsWith('"') && REDIS_URL.endsWith('"')) REDIS_URL = REDIS_URL.slice(1, -1);
  if (REDIS_URL.startsWith("'") && REDIS_URL.endsWith("'")) REDIS_URL = REDIS_URL.slice(1, -1);
}

// 1. PostgreSQL pool configuration
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
});

// 2. Redis Client configuration
let redisClient = null;
if (REDIS_URL) {
  redisClient = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.warn('[Redis] Connection failed, disabling Redis functionality.');
          return new Error('[Redis] Max retries reached');
        }
        return Math.min(retries * 500, 2000);
      }
    }
  });

  redisClient.on('error', (err) => console.error('[Redis Error]', err));
  redisClient.connect().then(() => console.log('🔌 Connected to Redis')).catch(err => {
    console.error('[Redis] Failed to connect on startup:', err.message);
    redisClient = null; // Fallback to disable redis caching gracefully
  });
}

/**
 * Initialize Postgres Tables
 */
async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log('🐘 Connected to PostgreSQL Database');
    
    // Create products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        platform VARCHAR(50),
        title TEXT,
        image TEXT,
        rating DECIMAL(3, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Migration: ensure history_url column exists
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS history_url TEXT;
    `);

    // Migration: ensure deal score, tags, and category columns exist
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS current_price DECIMAL(12, 2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price DECIMAL(12, 2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS discount VARCHAR(50);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS deal_score INTEGER DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS deal_tag VARCHAR(50);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS highest_price DECIMAL(12, 2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS lowest_price DECIMAL(12, 2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS average_price DECIMAL(12, 2);
    `);
    
    // Create price history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        price DECIMAL(12, 2) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create index on product_id and timestamp
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);
      CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp);
    `);

    // Migration: ensure is_banned column exists in telegram_users (linked by tracker)
    await client.query(`
      ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;
    `).catch(() => {});

    // Automatically clean up old data points older than 3 months
    await client.query("DELETE FROM price_history WHERE timestamp < NOW() - INTERVAL '3 months'").catch(() => {});
    await client.query("DELETE FROM telegram_price_history WHERE date < NOW() - INTERVAL '3 months'").catch(() => {});

    client.release();
    console.log('📊 Database tables initialized successfully.');
  } catch (err) {
    console.error('[Database Init Error] Failed to initialize tables:', err);
  }
}

/**
 * Classify product title into a standard shopping category
 */
function classifyCategory(title, url) {
  const t = (title || '').toLowerCase();
  
  if (t.includes('phone') || t.includes('mobile') || t.includes('smartphone') || t.includes('iphone') || t.includes('galaxy') || t.includes('pixel') || t.includes('oneplus')) {
    return 'Electronics';
  }
  if (t.includes('laptop') || t.includes('notebook') || t.includes('macbook') || t.includes('computer') || t.includes('monitor') || t.includes('keyboard') || t.includes('mouse') || t.includes('pc') || t.includes('chromebook')) {
    return 'Computers & Accessories';
  }
  if (t.includes('tv') || t.includes('television') || t.includes('smart tv') || t.includes('led tv')) {
    return 'Smart Televisions';
  }
  if (t.includes('fridge') || t.includes('refrigerator')) {
    return 'Refrigerators';
  }
  if (t.includes('washing machine') || t.includes('washer') || t.includes('dryer')) {
    return 'Washing Machines';
  }
  if (t.includes('headphone') || t.includes('earphone') || t.includes('earbuds') || t.includes('buds') || t.includes('speaker') || t.includes('soundbar') || t.includes('audio') || t.includes('mic')) {
    return 'Electronics';
  }
  if (t.includes('shoe') || t.includes('sneaker') || t.includes('sandal') || t.includes('crocs') || t.includes('footwear') || t.includes('boot') || t.includes('runner') || t.includes('slippers')) {
    return 'Shoes';
  }
  if (t.includes('ring') || t.includes('necklace') || t.includes('bracelet') || t.includes('earring') || t.includes('jewel') || t.includes('chain') || t.includes('pendant')) {
    return 'Jewellery';
  }
  if (t.includes('tool') || t.includes('drill') || t.includes('screw') || t.includes('home improvement') || t.includes('bulb') || t.includes('led light') || t.includes('shower') || t.includes('tap')) {
    return 'Home Improvement';
  }
  if (t.includes('shampoo') || t.includes('cream') || t.includes('serum') || t.includes('makeup') || t.includes('soap') || t.includes('perfume') || t.includes('grooming') || t.includes('face wash') || t.includes('moisturizer')) {
    return 'Health & Personal Care';
  }
  if (t.includes('t-shirt') || t.includes('shirt') || t.includes('jeans') || t.includes('jacket') || t.includes('apparel') || t.includes('clothing') || t.includes('hoodie')) {
    return 'Fashion & Apparel';
  }
  
  return 'Electronics'; // Default category
}

/**
 * Calculate standard composite deal score (0 to 100)
 */
function calculateDealScore(current, lowest, average, highest, originalPrice) {
  if (!current) return 0;
  if (!lowest) lowest = current;
  if (!highest) highest = current;
  if (!average) average = current;
  
  // Calculate discount percentage if original price (MRP) is available
  const discountPercent = originalPrice && originalPrice > current 
    ? ((originalPrice - current) / originalPrice) * 100 
    : 0;

  // Proximity to lowest price (0 to 100)
  let proximityScore = 50;
  if (highest > lowest) {
    proximityScore = ((highest - current) / (highest - lowest)) * 100;
  } else if (current < lowest) {
    proximityScore = 100;
  }
  
  // Average comparison score (0 to 100)
  let averageCompareScore = 50;
  if (current < average) {
    const maxDrop = average - lowest;
    if (maxDrop > 0) {
      averageCompareScore = 50 + ((average - current) / maxDrop) * 50;
    } else {
      averageCompareScore = 100;
    }
  } else if (current > average) {
    const maxRise = highest - average;
    if (maxRise > 0) {
      averageCompareScore = 50 - ((current - average) / maxRise) * 50;
    } else {
      averageCompareScore = 0;
    }
  }

  // Weight the components: 50% proximity, 30% discount, 20% average comparison
  let score = (proximityScore * 0.5) + (discountPercent * 0.3) + (averageCompareScore * 0.2);
  
  // Clamp between 0 and 100
  score = Math.max(0, Math.min(100, score));
  return Math.round(score);
}

/**
 * Updates a product's dynamic pricing and deal attributes based on history metrics
 */
async function updateProductDealStats(productId, currentPrice, originalPrice, discount, productTitle) {
  if (!currentPrice || isNaN(currentPrice)) return;
  try {
    const history = await getPriceHistory(productId);
    const prices = history.map(h => h.price);
    
    // Add current price to calculations if not present
    if (prices.length === 0) prices.push(currentPrice);
    
    const lowest = Math.min(...prices, currentPrice);
    const highest = Math.max(...prices, currentPrice);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    
    const score = calculateDealScore(currentPrice, lowest, average, highest, originalPrice);
    
    let dealTag = '';
    // Tagging logic
    if (currentPrice <= lowest * 1.005) {
      dealTag = 'Lowest Ever';
    } else if (currentPrice <= lowest * 1.02) {
      dealTag = 'All-time Low';
    } else if (score >= 85) {
      dealTag = 'Hot Deal';
    } else if (score >= 70) {
      dealTag = 'Good Deal';
    }
    
    const category = classifyCategory(productTitle);

    const query = `
      UPDATE products 
      SET current_price = $1,
          original_price = $2,
          discount = $3,
          category = $4,
          deal_score = $5,
          deal_tag = $6,
          highest_price = $7,
          lowest_price = $8,
          average_price = $9,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10;
    `;
    await pool.query(query, [
      currentPrice, 
      originalPrice || currentPrice, 
      discount || '0%', 
      category, 
      score, 
      dealTag, 
      highest,
      lowest,
      Math.round(average * 100) / 100,
      productId
    ]);
    
    console.log(`[DB Deal Scan] Product ID ${productId} stats updated: price=₹${currentPrice}, score=${score}, tag='${dealTag}', category='${category}'`);
  } catch (err) {
    console.error(`[DB Error] Failed to update product deal stats for ID ${productId}:`, err);
  }
}

function detectPlatformAndPid(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    
    if (host.includes('amazon.in') || host.includes('amazon.com')) {
      const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        return { platform: 'amazon', pid: asinMatch[1] };
      }
    }
    if (host.includes('flipkart.com')) {
      const pid = parsed.searchParams.get('pid');
      if (pid) {
        return { platform: 'flipkart', pid };
      }
      const pathParts = parsed.pathname.split('/');
      const pIndex = pathParts.indexOf('p');
      if (pIndex !== -1 && pathParts[pIndex + 1]) {
        return { platform: 'flipkart', pid: pathParts[pIndex + 1] };
      }
    }
    if (host.includes('shopsy.in') || host.includes('shopsy.com')) {
      const pid = parsed.searchParams.get('pid');
      if (pid) {
        return { platform: 'shopsy', pid };
      }
      const pathParts = parsed.pathname.split('/');
      const pIndex = pathParts.indexOf('p');
      if (pIndex !== -1 && pathParts[pIndex + 1]) {
        return { platform: 'shopsy', pid: pathParts[pIndex + 1] };
      }
    }
    if (host.includes('myntra.com')) {
      const match = parsed.pathname.match(/\/(\d+)\/buy/i);
      if (match) {
        return { platform: 'myntra', pid: match[1] };
      }
      const matchAlt = parsed.pathname.match(/\/(\d+)/);
      if (matchAlt) {
        return { platform: 'myntra', pid: matchAlt[1] };
      }
    }
    if (host.includes('ajio.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9_]+)/i);
      if (match) {
        const parts = match[1].split('_');
        return { platform: 'ajio', pid: parts[0] };
      }
    }
    if (host.includes('meesho.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/i);
      if (match) {
        return { platform: 'meesho', pid: match[1] };
      }
    }
    if (host.includes('croma.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/) || parsed.pathname.match(/-([a-zA-Z0-9]+)$/);
      const pid = match ? match[1] : parsed.pathname.split('/').pop() || 'croma_pid';
      return { platform: 'croma', pid };
    }
    if (host.includes('tatacliq.com')) {
      const match = parsed.pathname.match(/\/p-([a-zA-Z0-9]+)/) || parsed.pathname.match(/-([a-zA-Z0-9]+)$/);
      const pid = match ? match[1] : parsed.pathname.split('/').pop() || 'tatacliq_pid';
      return { platform: 'tatacliq', pid };
    }
    if (host.includes('reliancedigital.in')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/);
      const pid = match ? match[1] : parsed.pathname.split('/').pop() || 'reliancedigital_pid';
      return { platform: 'reliancedigital', pid };
    }
    if (host.includes('nykaa.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/) || parsed.searchParams.get('productId');
      const pid = match ? (typeof match === 'string' ? match : match[1]) : parsed.pathname.split('/').pop() || 'nykaa_pid';
      return { platform: 'nykaa', pid };
    }
  } catch (e) {}
  return null;
}

/**
 * Find a product by its platform and PID
 */
async function getProductByPid(platform, pid) {
  if (!platform || !pid) return null;
  try {
    const query = `
      SELECT * FROM products 
      WHERE platform ILIKE $1 
        AND (url LIKE $2 OR url LIKE $3)
      LIMIT 1
    `;
    const res = await pool.query(query, [platform, `%pid=${pid}%`, `%/${pid}%`]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] getProductByPid:', err);
    return null;
  }
}

/**
 * Find a product by its URL
 */
async function getProductByUrl(url) {
  try {
    const res = await pool.query('SELECT * FROM products WHERE url = $1', [url]);
    if (res.rows[0]) return res.rows[0];
    
    // Fallback: try to match by platform & pid if the URL contains one
    const detected = detectPlatformAndPid(url);
    if (detected) {
      const pidProduct = await getProductByPid(detected.platform, detected.pid);
      if (pidProduct) return pidProduct;
    }
    return null;
  } catch (err) {
    console.error('[DB Error] getProductByUrl:', err);
    return null;
  }
}

/**
 * Save or update product info
 */
async function saveProduct(data) {
  try {
    const { url, platform, title, image, rating } = data;
    const query = `
      INSERT INTO products (url, platform, title, image, rating, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (url) 
      DO UPDATE SET 
        platform = EXCLUDED.platform,
        title = EXCLUDED.title,
        image = EXCLUDED.image,
        rating = EXCLUDED.rating,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await pool.query(query, [url, platform, title, image, rating]);
    return res.rows[0];
  } catch (err) {
    console.error('[DB Error] saveProduct:', err);
    return null;
  }
}

/**
 * Retrieve price logs for a product
 */
async function getPriceHistory(productId) {
  try {
    const query = `
      SELECT price, timestamp 
      FROM price_history 
      WHERE product_id = $1 
      ORDER BY timestamp ASC;
    `;
    const res = await pool.query(query, [productId]);
    return res.rows.map(row => ({
      price: parseFloat(row.price),
      timestamp: row.timestamp
    }));
  } catch (err) {
    console.error('[DB Error] getPriceHistory:', err);
    return [];
  }
}

/**
 * Delta Logging: Insert a new price log ONLY if the price changed
 */
async function addPriceLogIfChanged(productId, price) {
  if (!price || isNaN(price)) return false;
  
  try {
    // Get the most recent price point
    const lastLogQuery = `
      SELECT price FROM price_history 
      WHERE product_id = $1 
      ORDER BY timestamp DESC 
      LIMIT 1;
    `;
    const lastLogRes = await pool.query(lastLogQuery, [productId]);
    const lastPrice = lastLogRes.rows[0] ? parseFloat(lastLogRes.rows[0].price) : null;
    
    // If different or first entry, save it
    if (lastPrice === null || Math.abs(lastPrice - price) > 0.01) {
      console.log(`[Delta Log] Price changed from ₹${lastPrice} to ₹${price}. Logging new entry.`);
      await pool.query(
        'INSERT INTO price_history (product_id, price, timestamp) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [productId, price]
      );
      return true;
    }
    
    console.log(`[Delta Log] Price unchanged (₹${price}). Skipping log.`);
    return false;
  } catch (err) {
    console.error('[DB Error] addPriceLogIfChanged:', err);
    return false;
  }
}

/**
 * Batch insert price history points (used during external import from trackers)
 */
async function importPriceHistoryBatch(productId, historyPoints) {
  if (!historyPoints || historyPoints.length === 0) return;
  try {
    // Filter out duplicates that might already exist around the same timestamps
    const existing = await getPriceHistory(productId);
    const existingTimes = new Set(existing.map(p => new Date(p.timestamp).toDateString()));
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const point of historyPoints) {
        const pointDate = new Date(point.timestamp);
        if (!existingTimes.has(pointDate.toDateString())) {
          await client.query(
            'INSERT INTO price_history (product_id, price, timestamp) VALUES ($1, $2, $3)',
            [productId, point.price, pointDate]
          );
        }
      }
      await client.query('COMMIT');
      console.log(`[Import] Successfully imported ${historyPoints.length} price points for product ${productId}.`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB Error] importPriceHistoryBatch:', err);
  }
}

/**
 * Update the external tracker history URL for a product
 */
async function updateProductHistoryUrl(productId, historyUrl) {
  try {
    await pool.query('UPDATE products SET history_url = $1 WHERE id = $2', [historyUrl, productId]);
    console.log(`[DB] Updated history URL for product ${productId} to: ${historyUrl}`);
    return true;
  } catch (err) {
    console.error('[DB Error] updateProductHistoryUrl:', err);
    return false;
  }
}


/**
 * Ban user in tracker bot (telegram_users table)
 */
async function banUser(userId) {
  try {
    const res = await pool.query(
      'UPDATE telegram_users SET is_banned = TRUE WHERE telegram_id = $1 RETURNING *',
      [userId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] banUser:', err);
    return null;
  }
}

/**
 * Unban user in tracker bot (telegram_users table)
 */
async function unbanUser(userId) {
  try {
    const res = await pool.query(
      'UPDATE telegram_users SET is_banned = FALSE WHERE telegram_id = $1 RETURNING *',
      [userId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] unbanUser:', err);
    return null;
  }
}

module.exports = {
  banUser,
  unbanUser,
  initDatabase,
  getProductByUrl,
  saveProduct,
  getPriceHistory,
  addPriceLogIfChanged,
  importPriceHistoryBatch,
  updateProductHistoryUrl,
  updateProductDealStats,
  classifyCategory,
  pool,
  redisClient
};
