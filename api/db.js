const { Pool } = require('pg');
const { createClient } = require('redis');

// Database URLs
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:yUAkumMqejYdHBijJxzmmRdmxrEKEiog@hayabusa.proxy.rlwy.net:42335/railway';
const REDIS_URL = process.env.REDIS_URL || 'redis://default:QTnNEjgbYgOuqQwxaBLNyKlodHdlfwIC@hayabusa.proxy.rlwy.net:51042';

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

    client.release();
    console.log('📊 Database tables initialized successfully.');
  } catch (err) {
    console.error('[Database Init Error] Failed to initialize tables:', err);
  }
}

/**
 * Find a product by its URL
 */
async function getProductByUrl(url) {
  try {
    const res = await pool.query('SELECT * FROM products WHERE url = $1', [url]);
    return res.rows[0] || null;
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

module.exports = {
  initDatabase,
  getProductByUrl,
  saveProduct,
  getPriceHistory,
  addPriceLogIfChanged,
  importPriceHistoryBatch,
  updateProductHistoryUrl,
  redisClient
};
