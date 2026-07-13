const { pool } = require('./db');

/**
 * Initialize Price History Bot database tables
 */
async function initHistoryDatabase() {
  try {
    const client = await pool.connect();
    console.log('🐘 [History Bot DB] Connected to PostgreSQL');
    
    // Create Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS history_users (
        user_id BIGINT PRIMARY KEY,
        first_name VARCHAR(255),
        username VARCHAR(255),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_banned BOOLEAN DEFAULT FALSE
      );
    `);
    
    // Create Product Cache table
    await client.query(`
      CREATE TABLE IF NOT EXISTS history_product_cache (
        platform VARCHAR(50) NOT NULL,
        pid VARCHAR(100) NOT NULL,
        last_scraped TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        response TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        PRIMARY KEY (platform, pid)
      );
    `);
    
    client.release();
    console.log('📊 [History Bot DB] Tables verified.');
  } catch (err) {
    console.error('❌ [History Bot DB] Initialization failed:', err);
  }
}

/**
 * Save / Register a Telegram user for History Bot
 */
async function saveHistoryUser(userId, firstName, username) {
  try {
    const query = `
      INSERT INTO history_users (user_id, first_name, username, last_active)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET first_name = EXCLUDED.first_name, username = EXCLUDED.username, last_active = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await pool.query(query, [userId, firstName, username]);
    return res.rows[0];
  } catch (err) {
    console.error('[History DB Error] saveHistoryUser:', err);
    return null;
  }
}

/**
 * Fetch a user
 */
async function getHistoryUser(userId) {
  try {
    const res = await pool.query('SELECT * FROM history_users WHERE user_id = $1 LIMIT 1', [userId]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('[History DB Error] getHistoryUser:', err);
    return null;
  }
}

/**
 * Ban a user
 */
async function banUser(userId) {
  try {
    const res = await pool.query(
      'UPDATE history_users SET is_banned = TRUE WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[History DB Error] banUser:', err);
    return null;
  }
}

/**
 * Unban a user
 */
async function unbanUser(userId) {
  try {
    const res = await pool.query(
      'UPDATE history_users SET is_banned = FALSE WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error('[History DB Error] unbanUser:', err);
    return null;
  }
}

/**
 * Fetch Stats
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

async function getHistoryStats() {
  try {
    const usersRes = await pool.query('SELECT COUNT(*) FROM history_users');
    const bannedRes = await pool.query('SELECT COUNT(*) FROM history_users WHERE is_banned = TRUE');
    const cachedRes = await pool.query('SELECT COUNT(*) FROM history_product_cache');
    
    return {
      totalUsers: parseInt(usersRes.rows[0].count),
      bannedUsers: parseInt(bannedRes.rows[0].count),
      cachedProducts: parseInt(cachedRes.rows[0].count)
    };
  } catch (err) {
    console.error('[History DB Error] getHistoryStats:', err);
    return null;
  }
}

/**
 * Get all users (for /broadcast)
 */
async function getAllHistoryUsers() {
  try {
    const res = await pool.query('SELECT user_id FROM history_users WHERE is_banned = FALSE');
    return res.rows.map(r => r.user_id);
  } catch (err) {
    console.error('[History DB Error] getAllHistoryUsers:', err);
    return [];
  }
}

/**
 * Fetch product history cache
 */
async function getHistoryCache(platform, pid) {
  try {
    const res = await pool.query(
      `SELECT * FROM history_product_cache 
       WHERE platform = $1 AND pid = $2 AND expires_at > CURRENT_TIMESTAMP 
       LIMIT 1`,
      [platform, pid]
    );
    if (res.rows[0]) {
      return JSON.parse(res.rows[0].response);
    }
    return null;
  } catch (err) {
    console.error('[History DB Error] getHistoryCache:', err);
    return null;
  }
}

/**
 * Save product history cache
 */
async function saveHistoryCache(platform, pid, responseObj, cacheTimeSeconds = 900) {
  try {
    const expiresAt = new Date(Date.now() + cacheTimeSeconds * 1000);
    const query = `
      INSERT INTO history_product_cache (platform, pid, response, expires_at, last_scraped)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (platform, pid) 
      DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at, last_scraped = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const res = await pool.query(query, [platform, pid, JSON.stringify(responseObj), expiresAt]);
    return res.rows[0];
  } catch (err) {
    console.error('[History DB Error] saveHistoryCache:', err);
    return null;
  }
}

/**
 * Clear cache
 */
async function clearHistoryCache() {
  try {
    const res = await pool.query('DELETE FROM history_product_cache');
    return res.rowCount;
  } catch (err) {
    console.error('[History DB Error] clearHistoryCache:', err);
    return 0;
  }
}

module.exports = {
  initHistoryDatabase,
  saveHistoryUser,
  getHistoryUser,
  banUser,
  unbanUser,
  getHistoryStats,
  getAllHistoryUsers,
  getHistoryCache,
  saveHistoryCache,
  getAdminDashboardStats,
  clearHistoryCache
};
