const { Pool } = require('pg');

let DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:yUAkumMqejYdHBijJxzmmRdmxrEKEiog@hayabusa.proxy.rlwy.net:42335/railway';
DATABASE_URL = DATABASE_URL.trim();
if (DATABASE_URL.startsWith('"') && DATABASE_URL.endsWith('"')) {
  DATABASE_URL = DATABASE_URL.slice(1, -1);
}
if (DATABASE_URL.startsWith("'") && DATABASE_URL.endsWith("'")) {
  DATABASE_URL = DATABASE_URL.slice(1, -1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
});

/**
 * Initialize database tables
 */
async function initDatabase() {
  try {
    const client = await pool.connect();
    console.log('🐘 [Telegram Bot DB] Connected to PostgreSQL');
    
    // Create Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_users (
        telegram_id BIGINT PRIMARY KEY,
        name TEXT,
        username TEXT,
        joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create Products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_products (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES telegram_users(telegram_id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        product_name TEXT NOT NULL,
        product_url TEXT NOT NULL,
        product_id VARCHAR(100) NOT NULL, -- "pid"
        image_url TEXT,
        current_price DECIMAL(12, 2) NOT NULL,
        last_price DECIMAL(12, 2) NOT NULL,
        tracking_status VARCHAR(20) DEFAULT 'active',
        aff_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, platform, product_id)
      );
    `);
    
    // Create Price History table
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES telegram_products(id) ON DELETE CASCADE,
        price DECIMAL(12, 2) NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_telegram_products_user ON telegram_products(user_id);
      CREATE INDEX IF NOT EXISTS idx_telegram_products_lookup ON telegram_products(platform, product_id);
      CREATE INDEX IF NOT EXISTS idx_telegram_history_product ON telegram_price_history(product_id);
    `);
    
    client.release();
    console.log('📊 [Telegram Bot DB] Tables and indexes verified.');
  } catch (err) {
    console.error('❌ [Telegram Bot DB] Initialization failed:', err);
  }
}

/**
 * Save / Register a Telegram user
 */
async function saveUser(telegramId, name, username) {
  try {
    const query = `
      INSERT INTO telegram_users (telegram_id, name, username, joined_date)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username
      RETURNING *;
    `;
    const res = await pool.query(query, [telegramId, name, username]);
    return res.rows[0];
  } catch (err) {
    console.error('[DB Error] saveUser:', err);
    return null;
  }
}

/**
 * Get active tracking count for a user
 */
async function getUserTrackedCount(userId) {
  try {
    const res = await pool.query(
      `SELECT COUNT(*) FROM telegram_products WHERE user_id = $1 AND tracking_status = 'active'`,
      [userId]
    );
    return parseInt(res.rows[0].count);
  } catch (err) {
    console.error('[DB Error] getUserTrackedCount:', err);
    return 0;
  }
}

/**
 * Get a specific product tracked by a user
 */
async function getUserTracking(userId, platform, productId) {
  try {
    const res = await pool.query(
      `SELECT * FROM telegram_products WHERE user_id = $1 AND platform = $2 AND product_id = $3 LIMIT 1`,
      [userId, platform, productId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] getUserTracking:', err);
    return null;
  }
}

/**
 * Check if an affiliate link already exists for a product globally in the database
 */
async function getExistingAffUrl(platform, productId) {
  try {
    const res = await pool.query(
      `SELECT aff_url FROM telegram_products 
       WHERE platform = $1 AND product_id = $2 AND aff_url IS NOT NULL 
       LIMIT 1`,
      [platform, productId]
    );
    return res.rows[0] ? res.rows[0].aff_url : null;
  } catch (err) {
    console.error('[DB Error] getExistingAffUrl:', err);
    return null;
  }
}

/**
 * Fetch a single product tracking by ID (including history)
 */
async function getProductById(id) {
  try {
    const res = await pool.query('SELECT * FROM telegram_products WHERE id = $1', [id]);
    const product = res.rows[0] || null;
    
    if (product) {
      const historyRes = await pool.query(
        'SELECT price, date FROM telegram_price_history WHERE product_id = $1 ORDER BY date ASC',
        [id]
      );
      product.price_history = historyRes.rows;
    }
    return product;
  } catch (err) {
    console.error('[DB Error] getProductById:', err);
    return null;
  }
}

/**
 * Add a new product tracking record
 */
async function addProduct(userId, platform, pid, name, url, affUrl, imageUrl, price) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const insertQuery = `
      INSERT INTO telegram_products (
        user_id, platform, product_name, product_url, product_id, 
        image_url, current_price, last_price, aff_url, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, platform, product_id)
      DO UPDATE SET 
        product_name = EXCLUDED.product_name,
        product_url = EXCLUDED.product_url,
        image_url = EXCLUDED.image_url,
        current_price = EXCLUDED.current_price,
        last_price = EXCLUDED.current_price,
        aff_url = EXCLUDED.aff_url,
        tracking_status = 'active',
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await client.query(insertQuery, [
      userId, platform, name, url, pid, 
      imageUrl, price, price, affUrl
    ]);
    
    const product = res.rows[0];
    
    // Check if central database already compiled price history points for this URL
    const centralProdRes = await client.query(
      'SELECT id FROM products WHERE url = $1 LIMIT 1',
      [url]
    );
    let copiedCount = 0;
    if (centralProdRes.rows.length > 0) {
      const centralProdId = centralProdRes.rows[0].id;
      // Copy all points from central price_history to user's telegram_price_history
      const copyRes = await client.query(
        `INSERT INTO telegram_price_history (product_id, price, date)
         SELECT $1, price, timestamp FROM price_history
         WHERE product_id = $2
         ON CONFLICT DO NOTHING`,
        [product.id, centralProdId]
      );
      copiedCount = copyRes.rowCount;
    }
    
    // If no points were copied, add the initial point
    if (copiedCount === 0) {
      await client.query(
        `INSERT INTO telegram_price_history (product_id, price, date) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [product.id, price]
      );
    }
    
    await client.query('COMMIT');
    return product;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB Error] addProduct:', err);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Delete a tracking record
 */
async function stopTracking(id) {
  try {
    const res = await pool.query('DELETE FROM telegram_products WHERE id = $1 RETURNING *', [id]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] stopTracking:', err);
    return null;
  }
}

/**
 * Fetch all tracked products for a user
 */
async function getUserTrackings(userId) {
  try {
    const res = await pool.query(
      `SELECT * FROM telegram_products WHERE user_id = $1 AND tracking_status = 'active' ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB Error] getUserTrackings:', err);
    return [];
  }
}

/**
 * Fetch all active trackings across all users for scheduling
 */
async function getAllActiveTrackings() {
  try {
    const res = await pool.query(
      `SELECT * FROM telegram_products WHERE tracking_status = 'active'`
    );
    return res.rows;
  } catch (err) {
    console.error('[DB Error] getAllActiveTrackings:', err);
    return [];
  }
}

/**
 * Update a product's price and record history if changed
 */
async function updateProductPrice(productId, newPrice) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Lock row and get current price
    const prodRes = await client.query(
      'SELECT current_price FROM telegram_products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (prodRes.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    
    const lastPrice = parseFloat(prodRes.rows[0].current_price);
    
    // Check if price changed
    if (Math.abs(lastPrice - newPrice) > 0.01) {
      console.log(`[Telegram Scheduler] Price changed from ₹${lastPrice} to ₹${newPrice} for product ID ${productId}`);
      
      const updateRes = await client.query(`
        UPDATE telegram_products 
        SET last_price = current_price,
            current_price = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
      `, [newPrice, productId]);
      
      // Save history log
      await client.query(
        'INSERT INTO telegram_price_history (product_id, price, date) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [productId, newPrice]
      );
      
      await client.query('COMMIT');
      return { changed: true, product: updateRes.rows[0], oldPrice: lastPrice };
    }
    
    await client.query('COMMIT');
    return { changed: false };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB Error] updateProductPrice:', err);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Admin Stats query
 */
async function getAdminDashboardStats() {
  try {
    const startedTrackerRes = await pool.query('SELECT COUNT(*) FROM telegram_users');
    const startedHistoryRes = await pool.query('SELECT COUNT(*) FROM history_users');
    const addedProductsRes = await pool.query('SELECT COUNT(DISTINCT user_id) FROM telegram_products');
    const activeTrackingRes = await pool.query("SELECT COUNT(*) FROM telegram_products WHERE tracking_status = 'active'");
    
    return {
      startedTracker: parseInt(startedTrackerRes.rows[0].count) || 0,
      startedHistory: parseInt(startedHistoryRes.rows[0].count) || 0,
      addedProducts: parseInt(addedProductsRes.rows[0].count) || 0,
      activeTracking: parseInt(activeTrackingRes.rows[0].count) || 0
    };
  } catch (err) {
    console.error('[DB Stats Error] getAdminDashboardStats:', err);
    return null;
  }
}

async function getStats() {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM telegram_users');
    const productsCount = await pool.query('SELECT COUNT(*) FROM telegram_products');
    const activeProducts = await pool.query("SELECT COUNT(*) FROM telegram_products WHERE tracking_status = 'active'");
    
    return {
      totalUsers: parseInt(usersCount.rows[0].count),
      totalProducts: parseInt(productsCount.rows[0].count),
      activeProducts: parseInt(activeProducts.rows[0].count)
    };
  } catch (err) {
    console.error('[DB Error] getStats:', err);
    return null;
  }
}

/**
 * Fetch a single product tracking by Platform Product ID (pid) for a specific user (including history)
 */
async function getProductByPid(userId, productPid) {
  try {
    const res = await pool.query(
      'SELECT * FROM telegram_products WHERE user_id = $1 AND product_id = $2 LIMIT 1',
      [userId, productPid]
    );
    const product = res.rows[0] || null;
    
    if (product) {
      const historyRes = await pool.query(
        'SELECT price, date FROM telegram_price_history WHERE product_id = $1 ORDER BY date ASC',
        [product.id]
      );
      product.price_history = historyRes.rows;
    }
    return product;
  } catch (err) {
    console.error('[DB Error] getProductByPid:', err);
    return null;
  }
}

/**
 * Stop tracking a product by Platform Product ID (pid) for a specific user
 */
async function stopTrackingByPid(userId, productPid) {
  try {
    const res = await pool.query(
      `UPDATE telegram_products SET tracking_status = 'stopped', updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND product_id = $2 RETURNING *`,
      [userId, productPid]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[DB Error] stopTrackingByPid:', err);
    return null;
  }
}

/**
 * Fetch all registered user IDs (for /broadcast)
 */
async function getAllUsers() {
  try {
    const res = await pool.query('SELECT telegram_id FROM telegram_users');
    return res.rows.map(r => r.telegram_id);
  } catch (err) {
    console.error('[DB Error] getAllUsers:', err);
    return [];
  }
}

module.exports = {
  initDatabase,
  saveUser,
  getUserTrackedCount,
  getUserTracking,
  getExistingAffUrl,
  getProductById,
  getProductByPid,
  addProduct,
  stopTracking,
  stopTrackingByPid,
  getUserTrackings,
  getAllActiveTrackings,
  updateProductPrice,
  getStats,
  getAllUsers,
  getAdminDashboardStats,
  pool
};
