const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();
const https = require('https');
const http = require('http');
const urlModule = require('url');

const ID_SUFFIX = 'YE6WHE87';

function expandUrl(shortUrl) {
  return new Promise((resolve) => {
    let redirectsCount = 0;
    
    function follow(urlStr) {
      if (redirectsCount >= 10) {
        resolve(urlStr);
        return;
      }
      
      let parsed;
      try {
        parsed = new urlModule.URL(urlStr);
      } catch (err) {
        resolve(urlStr);
        return;
      }
      
      const client = parsed.protocol === 'https:' ? https : http;
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      };
      
      const req = client.request(urlStr, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectsCount++;
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            nextUrl = new urlModule.URL(nextUrl, urlStr).href;
          }
          follow(nextUrl);
        } else {
          let finalUrl = urlStr;
          try {
            const urlObj = new urlModule.URL(urlStr);
            const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
            for (const param of paramsToCheck) {
              const val = urlObj.searchParams.get(param);
              if (val && val.startsWith('http')) {
                finalUrl = decodeURIComponent(val);
                break;
              }
            }
          } catch (e) {}
          resolve(finalUrl);
        }
      });
      
      req.on('error', (err) => {
        resolve(urlStr);
      });
      
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(urlStr);
      });
      
      req.end();
    }
    
    follow(shortUrl);
  }).then(async (resolved) => {
    // If direct resolve failed to expand (returned same URL), try ScraperAPI first
    if (resolved === shortUrl) {
      const scraperApiKey = process.env.SCRAPERAPI_KEY || process.env.SCRAPER_API_KEY;
      if (scraperApiKey) {
        try {
          const axios = require('axios');
          console.log(`[Proxy Expand] Trying ScraperAPI for: ${shortUrl}`);
          const res = await axios.get('http://api.scraperapi.com', {
            params: {
              api_key: scraperApiKey,
              url: shortUrl,
              follow_redirect: 'false'
            },
            timeout: 12000
          });
          if (res.headers && res.headers['sa-final-url']) {
            let finalUrl = res.headers['sa-final-url'];
            try {
              const urlObj = new URL(finalUrl);
              const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
              for (const param of paramsToCheck) {
                const val = urlObj.searchParams.get(param);
                if (val && val.startsWith('http')) {
                  finalUrl = decodeURIComponent(val);
                  break;
                }
              }
            } catch (e) {}
            console.log(`[Proxy Expand] ScraperAPI successfully resolved: ${finalUrl}`);
            return finalUrl;
          }
        } catch (e) {
          console.warn(`[Proxy Expand] ScraperAPI failed: ${e.message}. Trying ScrapingBee fallback...`);
        }
      }
      
      // Fallback: ScrapingBee
      const scrapingBeeKey = process.env.SCRAPINGBEE_KEY || process.env.SCRAPING_BEE_KEY;
      if (scrapingBeeKey) {
        try {
          const axios = require('axios');
          console.log(`[Proxy Expand] Trying ScrapingBee fallback for: ${shortUrl}`);
          const res = await axios.get('https://app.scrapingbee.com/api/v1/', {
            params: {
              api_key: scrapingBeeKey,
              url: shortUrl
            },
            timeout: 15000
          });
          if (res.headers && res.headers['spb-resolved-url']) {
            let finalUrl = res.headers['spb-resolved-url'];
            try {
              const urlObj = new URL(finalUrl);
              const paramsToCheck = ['dl', 'dest', 'redirect', 'to', 'target', 'url', 'redirect_url'];
              for (const param of paramsToCheck) {
                const val = urlObj.searchParams.get(param);
                if (val && val.startsWith('http')) {
                  finalUrl = decodeURIComponent(val);
                  break;
                }
              }
            } catch (e) {}
            console.log(`[Proxy Expand] ScrapingBee successfully resolved: ${finalUrl}`);
            return finalUrl;
          }
        } catch (e) {
          console.error(`[Proxy Expand] ScrapingBee failed: ${e.message}`);
        }
      }
    }
    return resolved;
  });
}

const db = require('./db');
const affiliate = require('./affiliate');

let token = process.env.TELEGRAM_BOT_TOKEN;
if (token) {
  token = token.trim();
  // Strip surrounding quotes
  if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1);
  if (token.startsWith("'") && token.endsWith("'")) token = token.slice(1, -1);
  // Strip accidental escaped quotes
  if (token.startsWith('\\"') && token.endsWith('\\"')) token = token.slice(2, -2);
  if (token.startsWith('\\"')) token = token.slice(2);
}
let scraperApiUrl = process.env.SCRAPER_API_URL || 'http://localhost:3000';
if (scraperApiUrl.endsWith('/')) {
  scraperApiUrl = scraperApiUrl.slice(0, -1);
}

const historyBotUsername = process.env.PRICE_HISTORY_BOT_USERNAME || 'The_PriceHistory_Bot';

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[`])/g, '\\$1');
}

function escapeHTML(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if (!token) {
  console.error('[Error] TELEGRAM_BOT_TOKEN is missing in the environment variables!');
  process.exit(1);
}

// Create a bot that uses polling
const bot = new TelegramBot(token, { polling: true });

// Listen for polling errors and log clean one-liner summaries to prevent log flooding
bot.on('polling_error', (error) => {
  console.error(`⚠️ [Tracker Bot Polling Error] Code: ${error.code || 'UNKNOWN'}, Message: ${error.message || error}`);
});

console.log('🤖 Telegram Price Graph Price Tracker Bot is starting up...');

// Helper: Main inline buttons that must appear in most messages
function getMainButtons() {
  return [
    { text: "🔥 Today's Deals", url: "https://t.me/+HeHY-qoy3vsxYWU1" },
    { text: "📊 PriceHistory Deals", url: "https://t.me/+rTx5B9g6XYxmNmE1" },
    { text: "📢 Report Issues", url: "https://t.me/imovies_contact_bot" }
  ];
}

// Pending tasks map for verification flow
const pendingTasks = new Map();
const activeBroadcasts = new Map();


// Helper: Verify subscription and execute task

// Helper: Check if user is banned
async function isUserBanned(chatId) {
  try {
    const res = await db.pool.query('SELECT is_banned FROM telegram_users WHERE telegram_id = $1', [chatId]);
    return res.rows[0]?.is_banned === true;
  } catch (err) {
    return false;
  }
}

async function verifyUserAndExecute(msg, taskType, taskData, executeCallback) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const channel = "-1003849048564";
  const channelName = process.env.TELEGRAM_CHANNEL || "@BotsXP";
  const channelLink = channelName.startsWith('@') ? `https://t.me/${channelName.substring(1)}` : `https://t.me/${channelName}`;
  
  try {
    // Check if user is banned
    const banned = await isUserBanned(chatId);
    if (banned) {
      await bot.sendMessage(chatId, '❌ You have been banned from using this bot by the administrator.');
      return;
    }

    const member = await bot.getChatMember(channel, userId);
    const isMember = ['member', 'administrator', 'creator'].includes(member.status);
    
    if (isMember) {
      // Execute actual task callback directly
      await executeCallback();
    } else {
      // Store pending task in-memory
      pendingTasks.set(userId, { type: taskType, data: taskData, execute: executeCallback });
      
      await bot.sendMessage(chatId, '⚠️ Please subscribe to our updates channel to use the bot:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔔 Join Updates Channel', url: channelLink }],
            [{ text: '🔄 Check Joined', callback_data: 'verify_subscription' }]
          ]
        }
      });
    }
  } catch (err) {
    console.error('[Verification Check Error]', err.message);
    // In case of API failure or if bot is not admin in channel, let user proceed to avoid lockout
    await executeCallback();
  }
}

// Helper: Detect platform and product ID from URL
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
    
    // Generic fallback for any other site
    const hostParts = host.split('.');
    if (hostParts.length >= 2) {
      const name = hostParts[hostParts.length - 2];
      const matchPath = parsed.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/i) || parsed.pathname.match(/\/product\/([a-zA-Z0-9_-]+)/i);
      const pid = matchPath ? matchPath[1] : encodeURIComponent(url);
      return { platform: name, pid };
    }
  } catch (e) {
    // URL parse error
  }
  return null;
}

// Helper: Reconstruct standard URL from platform & pid
function reconstructUrl(platform, pid) {
  const p = platform.toLowerCase();
  if (p === 'amazon') return `https://www.amazon.in/dp/${pid}`;
  if (p === 'flipkart') return `https://www.flipkart.com/p/p?pid=${pid}`;
  if (p === 'shopsy') return `https://www.shopsy.in/open-menu/p/p?pid=${pid}`;
  if (p === 'myntra') return `https://www.myntra.com/${pid}`;
  if (p === 'ajio') return `https://www.ajio.com/s/p/${pid}`;
  if (p === 'meesho') return `https://www.meesho.com/p/${pid}`;
  if (p === 'croma') return `https://www.croma.com/p/${pid}`;
  if (p === 'tatacliq') return `https://www.tatacliq.com/p-${pid}`;
  if (p === 'reliancedigital') return `https://www.reliancedigital.in/p/${pid}`;
  if (p === 'nykaa') return `https://www.nykaa.com/p/${pid}`;
  
  if (pid.startsWith('http') || decodeURIComponent(pid).startsWith('http')) {
    return decodeURIComponent(pid);
  }
  return null;
}

// Helper: Check if user is Admin
function isAdmin(userId) {
  const adminIdsEnv = process.env.ADMIN_IDS || '';
  const adminIds = adminIdsEnv.split(',').map(id => id.trim());
  return adminIds.includes(String(userId));
}

// Command: /start (including deep link support)
bot.onText(/^\/start(?: (.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const deepLinkParam = match[1];

  // Save User
  await db.saveUser(chatId, msg.from.first_name || '', msg.from.username || '');

  if (deepLinkParam && deepLinkParam.startsWith('track_')) {
    // Process deep link start parameter: track_<store>_<pid>
    try {
      const parts = deepLinkParam.split('_');
      const store = parts[1];
      const pid = parts[2];
      
      if (!store || !pid) {
        await bot.sendMessage(chatId, '⚠️ Invalid track link parameter.');
        return;
      }

      // Check tracking limit
      const limit = parseInt(process.env.MAX_TRACK_PRODUCTS) || 10;
      const currentCount = await db.getUserTrackedCount(chatId);
      if (currentCount >= limit) {
        await bot.sendMessage(
          chatId, 
          `⚠️ <b>Tracking limit reached.</b>\n\n` +
          `You are already tracking ${currentCount} products.\n\n` +
          `Please remove one or more products from /my_trackings before adding a new one.`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      const statusMsg = await bot.sendMessage(chatId, '🔍 Checking product info...');
      
      // Look up product in the main products pool or construct and scrape it
      let productTitle = '';
      let productPrice = 0;
      let originalPrice = 0;
      let discount = '';
      let imageUrl = '';
      let url = reconstructUrl(store, pid);
      
      // Try to find if already tracked/crawled in main products table
      const poolQuery = `SELECT * FROM products WHERE platform ILIKE $1 AND url LIKE $2 LIMIT 1`;
      const poolRes = await db.pool.query(poolQuery, [store, `%${pid}%`]);
      
      if (poolRes.rows.length > 0) {
        const poolProd = poolRes.rows[0];
        productTitle = poolProd.title;
        productPrice = parseFloat(poolProd.current_price) || 0;
        originalPrice = parseFloat(poolProd.original_price) || productPrice;
        discount = poolProd.discount || '0%';
        imageUrl = poolProd.image;
      } else {
        // Scrape live details from central scraper
        if (!url) {
          await bot.deleteMessage(chatId, statusMsg.message_id);
          await bot.sendMessage(chatId, '❌ Unsupported store in link.');
          return;
        }
        
        const response = await axios.get(`${scraperApiUrl}/api/history`, {
          params: { url: url },
          timeout: 20000
        });
        
        const data = response.data;
        if (data && data.success) {
          productTitle = data.title;
          productPrice = parseFloat(data.price) || 0;
          originalPrice = parseFloat(data.originalPrice) || productPrice;
          discount = data.discount || '0%';
          imageUrl = data.image;
        } else {
          await bot.deleteMessage(chatId, statusMsg.message_id);
          await bot.sendMessage(chatId, '❌ Product ID not found. Check if it\'s a product url.');
          return;
        }
      }
      
      await bot.deleteMessage(chatId, statusMsg.message_id);
      
      // Show confirmation preview card
      const confirmationText = `🏷 *${escapeMarkdown(productTitle)}*\n\n` +
        `💰 *Current Price:* ₹${productPrice.toLocaleString('en-IN')}\n` +
        `🏪 *Store:* ${escapeMarkdown(store.toUpperCase())}\n\n` +
        `Would you like to track this product?\n` +
        `You'll receive a Telegram notification whenever the price changes.`;
        
      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Track', callback_data: `track:yes:${store}:${pid}` },
              { text: '❌ Cancel', callback_data: `track:cancel` }
            ]
          ]
        }
      };
      
      await bot.sendMessage(chatId, confirmationText, opts);
      
    } catch (err) {
      console.error('[Deep Link Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to load deep link product. Please try pasting a direct URL.');
    }
    return;
  }

  const name = msg.from.first_name || 'there';
  const trackerBotUsername = process.env.PRICE_TRACKER_BOT_USERNAME || 'The_PriceTracker_bot';
  const historyBotUsername = process.env.PRICE_HISTORY_BOT_USERNAME || 'The_PriceHistory_Bot';
  const welcomeText = `👋 Hello <b>${name}</b>!\n\n` +
    `I'm <b>@${trackerBotUsername}</b>, your personal assistant for tracking product prices.\n\n` +
    `I will notify you whenever the price goes up or down.\n\n` +
    `Simply send me a product link.\n\n` +
    `⚠️ <b>Note on Supported Stores:</b>\n` +
    `• <b>Supported:</b> Amazon India, Croma, Myntra, Meesho, AJio\n` +
    `• <b>Low Success Rate:</b> Shopsy\n` +
    `• <b>Unsupported:</b> Reliance Digital, Nykaa, Tata Cliq, and other stores\n\n` +
    `Use /my_trackings to see tracked products.\n` +
    `Use /help for help.\n\n` +
    `<b>Also Try:</b>\n` +
    `@${historyBotUsername}`;

  const opts = {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        getMainButtons()
      ]
    }
  };

  await bot.sendMessage(chatId, welcomeText, opts);
});

// Command: /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  if (await isUserBanned(chatId)) return;

  const helpText = `🤖 <b>Price Tracker Bot Help</b>\n\n` +
    `<b>Commands:</b>\n` +
    `/my_trackings - View tracked products\n` +
    `/product &lt;product_id&gt; - View product details\n` +
    `/stop &lt;product_id&gt; - Stop tracking\n` +
    `/pricegraph - View list to generate graph\n` +
    `/pricegraph &lt;product_id&gt; - Generate price graph\n\n` +
    `<b>How it works:</b>\n` +
    `1. Send a product link (Amazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, Croma, TataCliq, Reliance Digital, Nykaa, etc.)\n` +
    `2. Bot tracks the product\n` +
    `3. Receive notification whenever the price changes.`;

  await bot.sendMessage(chatId, helpText, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [getMainButtons()] }
  });
});

// Command: /my_trackings
bot.onText(/\/my_trackings/, async (msg) => {
  await verifyUserAndExecute(msg, 'my_trackings', {}, async () => {
    const chatId = msg.chat.id;
    const loadingMsg = await bot.sendMessage(chatId, '🔍 Fetching Your Products...');

    try {
      const trackings = await db.getUserTrackings(chatId);
      await bot.deleteMessage(chatId, loadingMsg.message_id);

      if (trackings.length === 0) {
        await bot.sendMessage(chatId, 'You are not tracking any products.', {
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
        return;
      }

      let reply = `📂 <b>Your Tracked Products</b>\n\n`;
      trackings.forEach((t, index) => {
        const link = t.aff_url || t.product_url;
        reply += `${index + 1}.\n` +
          `<a href="${link}"><b>${escapeHTML(t.product_name.substring(0, 60))}...</b></a>\n` +
          `/product_${t.id}${ID_SUFFIX}\n` +
          `/stop_${t.id}${ID_SUFFIX}\n` +
          `<b>Current Price:</b> ₹${parseFloat(t.current_price).toLocaleString('en-IN')}\n\n` +
          `----------------\n\n`;
      });

      await bot.sendMessage(chatId, reply, {
        parse_mode: 'HTML'
      });
    } catch (err) {
      console.error('[Command /my_trackings Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to fetch tracking list.');
    }
  });
});

// Command: /product<id>
bot.onText(/^\/product(?:[_ ]?([a-zA-Z0-9]+))?$/, async (msg, match) => {
  let productPid = match[1];
  if (!productPid) {
    await bot.sendMessage(msg.chat.id, '❌ Please specify a product ID. Example: `/product 45` or `/product_45`', { parse_mode: 'HTML' });
    return;
  }
  
  if (productPid && productPid.endsWith(ID_SUFFIX)) {
    productPid = productPid.slice(0, -ID_SUFFIX.length);
  }

  await verifyUserAndExecute(msg, 'product', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    const infoMsg = await bot.sendMessage(chatId, '🔍 Getting Product Info...');

    try {
      let product = null;
      if (/^\d+$/.test(productPid)) {
        product = await db.getProductById(parseInt(productPid));
      } else {
        product = await db.getProductByPid(chatId, productPid);
      }
      await bot.deleteMessage(chatId, infoMsg.message_id);

      if (!product || String(product.user_id) !== String(chatId) || product.tracking_status !== 'active') {
        await bot.sendMessage(chatId, '❌ Product not found or you are not tracking it.');
        return;
      }

      let lowestPrice = parseFloat(product.current_price);
      let highestPrice = parseFloat(product.current_price);
      if (product.price_history && product.price_history.length > 0) {
        const prices = product.price_history.map(h => parseFloat(h.price));
        lowestPrice = Math.min(...prices, lowestPrice);
        highestPrice = Math.max(...prices, highestPrice);
      }

      const clickableName = `<a href="${product.aff_url || product.product_url}"><b>${escapeHTML(product.product_name)}</b></a>`;

      const caption = `🛍️ <b>${escapeHTML(product.platform.toUpperCase())} Product Details</b>\n\n` +
        `📌 ${clickableName}\n\n` +
        `💵 <b>Current Price:</b> ₹${parseFloat(product.current_price).toLocaleString('en-IN')}\n` +
        `📈 <b>Highest Price:</b> ₹${highestPrice.toLocaleString('en-IN')}\n` +
        `📉 <b>Lowest Price:</b> ₹${lowestPrice.toLocaleString('en-IN')}`;

      const opts = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Buy Now', url: product.aff_url || product.product_url }],
            [
              { text: '❌ Stop Tracking', callback_data: `stop:${product.id}` },
              { text: '📊 Price Graph', callback_data: `graph:${product.id}` }
            ],
            [
              { text: '🔍 View Full Price History', url: `https://t.me/${historyBotUsername}?start=graph_${product.platform}_${product.product_id}` }
            ]
          ]
        }
      };

      await bot.sendMessage(chatId, caption, opts);
    } catch (err) {
      console.error('[Command /product Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to retrieve product information.');
    }
  });
});

// Command: /stop<id>
bot.onText(/^\/stop(?:[_ ]?([a-zA-Z0-9]+))?$/, async (msg, match) => {
  let productPid = match[1];
  if (!productPid) {
    await bot.sendMessage(msg.chat.id, '❌ Please specify a product ID. Example: `/stop 45` or `/stop_45`', { parse_mode: 'HTML' });
    return;
  }

  if (productPid && productPid.endsWith(ID_SUFFIX)) {
    productPid = productPid.slice(0, -ID_SUFFIX.length);
  }

  await verifyUserAndExecute(msg, 'stop', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, '🗑️ Deleting Product...');

    try {
      let product = null;
      if (/^\d+$/.test(productPid)) {
        product = await db.getProductById(parseInt(productPid));
      } else {
        product = await db.getProductByPid(chatId, productPid);
      }
      
      if (!product || String(product.user_id) !== String(chatId)) {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, '❌ Product tracking record not found.');
        return;
      }

      if (/^\d+$/.test(productPid)) {
        await db.stopTrackingById(parseInt(productPid));
      } else {
        await db.stopTrackingByPid(chatId, productPid);
      }
      await bot.deleteMessage(chatId, statusMsg.message_id);
      
      await bot.sendMessage(chatId, `✅ <b>Product removed successfully.</b>\n\nYou will no longer receive alerts.`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    } catch (err) {
      console.error('[Command /stop Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to delete tracking record.');
    }
  });
});

// Command: /pricegraph (with optional product ID)
bot.onText(/^\/pricegraph(?:[_ ]?([a-zA-Z0-9]+))?$/, async (msg, match) => {
  const productPid = match[1];
  
  await verifyUserAndExecute(msg, 'pricegraph', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    
    if (productPid) {
      const statusMsg = await bot.sendMessage(chatId, '📊 Generating price graph...');
      try {
        let product = null;
        if (/^\d+$/.test(productPid)) {
          product = await db.getProductById(parseInt(productPid));
        } else {
          product = await db.getProductByPid(chatId, productPid);
        }
        if (product && product.price_history && product.price_history.length > 0) {
          // Filter to last 3 months
          const limitDate = new Date();
          limitDate.setMonth(limitDate.getMonth() - 3);
          let filteredHistory = [...product.price_history].sort((a, b) => new Date(a.date) - new Date(b.date));
          filteredHistory = filteredHistory.filter(h => new Date(h.date) >= limitDate);
          if (filteredHistory.length === 0) {
            filteredHistory = product.price_history;
          }
          
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const labels = filteredHistory.map(h => {
            const d = new Date(h.date);
            return `${d.getDate()} ${monthNames[d.getMonth()]}`;
          });
          const prices = filteredHistory.map(h => parseFloat(h.price));
          
          const chartConfig = {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Price (₹)',
                data: prices,
                borderColor: '#4f46e5',
                borderWidth: 3,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 4,
                fill: true,
                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                lineTension: 0.3
              }]
            },
            options: {
              plugins: {
                background: {
                  color: 'white'
                }
              },
              title: {
                display: true,
                text: product.product_name.substring(0, 32) + '... Trend',
                fontSize: 14,
                fontColor: '#000000',
                fontFamily: 'Inter'
              },
              legend: {
                display: false
              },
              scales: {
                xAxes: [{
                  scaleLabel: {
                    display: true,
                    labelString: 'Time',
                    fontColor: '#000000',
                    fontFamily: 'Inter',
                    fontSize: 10,
                    fontStyle: 'bold'
                  },
                  gridLines: { display: false, drawBorder: false },
                  ticks: {
                    fontFamily: 'Inter',
                    fontColor: '#000000',
                    fontSize: 10,
                    maxTicksLimit: 8
                  }
                }],
                yAxes: [{
                  scaleLabel: {
                    display: true,
                    labelString: 'Price',
                    fontColor: '#000000',
                    fontFamily: 'Inter',
                    fontSize: 10,
                    fontStyle: 'bold'
                  },
                  gridLines: { color: '#e2e8f0', drawBorder: false },
                  ticks: {
                    fontFamily: 'Inter',
                    fontColor: '#000000',
                    fontSize: 10,
                    callback: (val) => '₹' + parseInt(val).toLocaleString('en-IN')
                  }
                }]
              }
            },
            backgroundColor: 'white'
          };
          
          const graphUrl = `https://quickchart.io/chart?w=600&h=350&backgroundColor=white&f=jpg&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          const graphClickable = `<a href="${product.aff_url || product.product_url}"><b>${escapeHTML(product.product_name)}</b></a>`;
          await bot.sendPhoto(chatId, graphUrl, {
            caption: `📊 Price History graph for ${graphClickable}`,
            parse_mode: 'HTML'
          });
        } else {
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          await bot.sendMessage(chatId, '⚠️ Not enough price history points to generate a graph.');
        }
      } catch (err) {
        console.error('[Pricegraph command error]', err.message);
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, '⚠️ Failed to generate chart.');
      }
    } else {
      const loadingMsg = await bot.sendMessage(chatId, '🔍 Fetching Your Products...');
      try {
        const trackings = await db.getUserTrackings(chatId);
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        
        if (trackings.length === 0) {
          await bot.sendMessage(chatId, 'You are not tracking any products. Send me a product URL to start tracking.');
          return;
        }
        
        let reply = `📈 <b>Generate Price Graph</b>\n\nSelect a product to generate its price history graph:\n\n`;
        trackings.forEach((t, index) => {
          reply += `${index + 1}. <b>${escapeHTML(t.product_name.substring(0, 60))}...</b>\n` +
                   `📊 Generate Graph: /pricegraph_${t.id}\n\n`;
        });
        
        await bot.sendMessage(chatId, reply, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
      } catch (err) {
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, '⚠️ Failed to fetch tracking list.');
      }
    }
  });
});



// Command: /broadcast (Admin)
// Command: /ban <userId> (Admin)
bot.onText(/^\/ban(?:[_ ]?([0-9]+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  const targetUserId = match[1];
  if (!targetUserId) {
    await bot.sendMessage(chatId, '❌ Please specify a user ID to ban. Example: `/ban 12345678`', { parse_mode: 'Markdown' });
    return;
  }
  
  const result = await db.banUser(targetUserId);
  if (result) {
    await bot.sendMessage(chatId, `✅ User ${targetUserId} has been banned.`);
  } else {
    await bot.sendMessage(chatId, `❌ Failed to ban user ${targetUserId}.`);
  }
});

// Command: /unban <userId> (Admin)
bot.onText(/^\/unban(?:[_ ]?([0-9]+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  const targetUserId = match[1];
  if (!targetUserId) {
    await bot.sendMessage(chatId, '❌ Please specify a user ID to unban. Example: `/unban 12345678`', { parse_mode: 'Markdown' });
    return;
  }
  
  const result = await db.unbanUser(targetUserId);
  if (result) {
    await bot.sendMessage(chatId, `✅ User ${targetUserId} has been unbanned.`);
  } else {
    await bot.sendMessage(chatId, `❌ Failed to unban user ${targetUserId}.`);
  }
});


bot.onText(/\/broadcast/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  activeBroadcasts.set(chatId, { state: 'awaiting_content' });
  await bot.sendMessage(chatId, `🎙 *Broadcast Mode Enabled*\n\nSend the message (text, photo, or video with caption) that you want to broadcast to all users next.\n\n_You do not need to reply to this message. Just send it._`, { parse_mode: 'Markdown' });
});

// Command: /stats (Admin)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isAdmin(chatId)) {
    return; // Silent ignore for non-admins
  }

  try {
    const stats = await db.getAdminDashboardStats();
    if (stats) {
      const statsText = `📊 *Price Tracker Bot Stats*\n\n` +
        `👤 *Users Started (Tracker Bot):* ${stats.startedTracker}\n` +
        `👤 *Users Started (History Bot):* ${stats.startedHistory}\n` +
        `👥 *Users Who Added Products:* ${stats.addedProducts}\n` +
        `🛍️ *Total Products Tracking:* ${stats.activeTracking}`;
        
      await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, '⚠️ Failed to calculate stats.');
    }
  } catch (err) {
    console.error('[Stats Command Error]', err.message);
    await bot.sendMessage(chatId, '⚠️ Error loading stats.');
  }
});

// Callback Query Handler (Inline button clicks)
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const callbackData = callbackQuery.data;
  
  if (callbackData.startsWith('confirm_broadcast:')) {
    const action = callbackData.split(':')[1];
    
    if (action === 'no') {
      activeBroadcasts.delete(chatId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Broadcast cancelled.' });
      if (message.photo || message.video) {
        await bot.deleteMessage(chatId, message.message_id).catch(() => {});
        await bot.sendMessage(chatId, '❌ Broadcast cancelled.');
      } else {
        await bot.editMessageText('❌ Broadcast cancelled.', {
          chat_id: chatId,
          message_id: message.message_id
        }).catch(async () => {
          await bot.deleteMessage(chatId, message.message_id).catch(() => {});
          await bot.sendMessage(chatId, '❌ Broadcast cancelled.');
        });
      }
      return;
    }
    
    if (action === 'yes') {
      const broadcastState = activeBroadcasts.get(chatId);
      if (!broadcastState || broadcastState.state !== 'confirming') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'No pending broadcast found.' });
        return;
      }
      
      activeBroadcasts.delete(chatId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Starting broadcast...' });
      await bot.deleteMessage(chatId, message.message_id).catch(() => {});
      
      const reply = broadcastState.content;
      const statusMsg = await bot.sendMessage(chatId, '📤 Broadcasting message in progress...');
      const users = await db.getAllUsers();
      
      let success = 0;
      let failed = 0;
      
      for (const userId of users) {
        try {
          if (reply.photo) {
            const fileId = reply.photo[reply.photo.length - 1].file_id;
            await bot.sendPhoto(userId, fileId, { caption: reply.caption || '', parse_mode: 'HTML' });
          } else if (reply.video) {
            await bot.sendVideo(userId, reply.video.file_id, { caption: reply.caption || '', parse_mode: 'HTML' });
          } else if (reply.text) {
            await bot.sendMessage(userId, reply.text, { parse_mode: 'HTML' });
          }
          success++;
        } catch (err) {
          failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId, `📢 *Broadcast completed*\n\n• Success: ${success}\n• Failed: ${failed}`, {
        parse_mode: 'Markdown'
      });
      return;
    }
  }
  
  // Extract actions
  if (callbackData.startsWith('track:')) {
    const parts = callbackData.split(':');
    const action = parts[1]; // yes, cancel
    
    if (action === 'cancel') {
      await bot.answerCallbackQuery(callbackQuery.id);
      if (message.photo || message.document) {
        await bot.deleteMessage(chatId, message.message_id).catch(() => {});
        await bot.sendMessage(chatId, '❌ Tracking cancelled.');
      } else {
        await bot.editMessageText('❌ Tracking cancelled.', {
          chat_id: chatId,
          message_id: message.message_id
        }).catch(async () => {
          await bot.deleteMessage(chatId, message.message_id).catch(() => {});
          await bot.sendMessage(chatId, '❌ Tracking cancelled.');
        });
      }
      return;
    }
    
    if (action === 'yes') {
      const store = parts[2];
      const pid = parts[3];
      
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Adding product...' });
      
      try {
        // Validate tracking limits
        const limit = parseInt(process.env.MAX_TRACK_PRODUCTS) || 10;
        const currentCount = await db.getUserTrackedCount(chatId);
        
        if (currentCount >= limit) {
          await bot.sendMessage(
            chatId, 
            `⚠️ <b>Tracking limit reached.</b>\n\n` +
            `You are already tracking the maximum number of products allowed (${limit}).\n\n` +
            `Please remove one or more products from /my_trackings before adding a new one.`, 
            { parse_mode: 'HTML' }
          );
          return;
        }
        // Check if already tracking
        const alreadyTracking = await db.getUserTracking(chatId, store, pid);
        if (alreadyTracking && alreadyTracking.tracking_status === 'active') {
          await bot.sendMessage(
            chatId, 
            `ℹ️ <b>You're already tracking this product.</b>\n\nWe'll notify you whenever its price changes.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📂 My Trackings', callback_data: 'my_trackings' },
                    { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${store}_${pid}` }
                  ]
                ]
              }
            }
          );
          return;
        }
        
        // Reconstruct URL and scrape live details
        const url = reconstructUrl(store, pid);
        const response = await axios.get(`${scraperApiUrl}/api/history`, {
          params: { url: url },
          timeout: 20000
        });
        
        const data = response.data;
        if (!data || !data.success) {
          await bot.sendMessage(chatId, '❌ Failed to scrape product details. Please try again.');
          return;
        }

        // Set targetUrl to the resolved clean canonical URL returned by the API server
        let targetUrl = (data.url && data.url.startsWith('http')) ? data.url : url;
        
        // Convert to affiliate URL
        let affUrl = null;
        if (store === 'amazon') {
          // Amazon checks DB first to avoid API limit hits
          affUrl = await db.getExistingAffUrl(store, pid);
          if (!affUrl || affUrl === targetUrl) {
            affUrl = await affiliate.convert(targetUrl, store);
          }
        } else {
          // For non-Amazon (Earnkaro stores), hit the EarnKaro API every time first
          try {
            affUrl = await affiliate.convert(targetUrl, store);
          } catch (e) {
            console.error('[Affiliate Conversion Error] Failed Earnkaro conversion:', e.message);
          }
          // If EarnKaro API failed or returned original link, fallback to existing DB link
          if (!affUrl || affUrl === targetUrl) {
            affUrl = await db.getExistingAffUrl(store, pid);
          }
        }
        // If still no affiliate URL was resolved, fallback to the resolved long URL
        if (!affUrl) {
          affUrl = targetUrl;
        }
        
        // Add to database
        const saved = await db.addProduct(
          chatId,
          store,
          pid,
          data.title,
          targetUrl,
          affUrl,
          data.image,
          parseFloat(data.price)
        );
        
        if (saved) {
          const clickableName = `<a href="${affUrl || targetUrl}"><b>${escapeHTML(data.title)}</b></a>`;
          const successMsg = `✅ <b>Product added successfully!</b>\n\n` +
            `📌 ${clickableName}\n\n` +
            `💰 <b>Current Price:</b> ₹${parseFloat(data.price).toLocaleString('en-IN')}\n\n` +
            `🔔 Price tracking has been enabled.\nYou'll receive a notification whenever the price changes.\n\n` +
            `/product_${saved.id}${ID_SUFFIX}\n` +
            `/stop_${saved.id}${ID_SUFFIX}`;
            
          const opts = {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛒 Buy Now', url: affUrl || url }],
                [
                  { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${store}_${pid}` },
                  { text: '📂 My Trackings', callback_data: 'my_trackings' }
                ],
                getMainButtons()
              ]
            }
          };
          
          await bot.sendMessage(chatId, successMsg, opts);
        }
      } catch (err) {
        console.error('[Callback Yes_Track Error]', err.message);
        await bot.sendMessage(chatId, '⚠️ Failed to start tracking product.');
      }
    }
  }
  
  if (callbackData.startsWith('stop:')) {
    const productPid = callbackData.split(':')[1];
    await bot.answerCallbackQuery(callbackQuery.id);
    
    try {
      if (/^\d+$/.test(productPid)) {
        await db.stopTrackingById(parseInt(productPid));
      } else {
        await db.stopTrackingByPid(chatId, productPid);
      }
      await bot.sendMessage(chatId, '✅ <b>Product removed successfully.</b>\n\nYou will no longer receive alerts.', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    } catch (err) {
      await bot.sendMessage(chatId, '⚠️ Failed to delete tracking record.');
    }
  }
  
  if (callbackData.startsWith('graph:')) {
    const productPid = callbackData.split(':')[1];
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Generating price graph...' });
    
    try {
      let product = null;
      if (/^\d+$/.test(productPid)) {
        product = await db.getProductById(parseInt(productPid));
      } else {
        product = await db.getProductByPid(chatId, productPid);
      }
      
      if (product && product.price_history && product.price_history.length > 0) {
        // Filter to last 3 months
        const limitDate = new Date();
        limitDate.setMonth(limitDate.getMonth() - 3);
        let filteredHistory = [...product.price_history].sort((a, b) => new Date(a.date) - new Date(b.date));
        filteredHistory = filteredHistory.filter(h => new Date(h.date) >= limitDate);
        if (filteredHistory.length === 0) {
          filteredHistory = product.price_history;
        }

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const labels = filteredHistory.map(h => {
          const d = new Date(h.date);
          return `${d.getDate()} ${monthNames[d.getMonth()]}`;
        });
        const prices = filteredHistory.map(h => parseFloat(h.price));
        
        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Price (₹)',
              data: prices,
              borderColor: '#4f46e5',
              borderWidth: 3,
              pointBackgroundColor: '#4f46e5',
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              pointRadius: 4,
              fill: true,
              backgroundColor: 'rgba(79, 70, 229, 0.1)',
              lineTension: 0.3
            }]
          },
          options: {
            plugins: {
              background: {
                color: 'white'
              }
            },
            title: {
              display: true,
              text: product.product_name.substring(0, 32) + '... Trend',
              fontSize: 14,
              fontColor: '#000000',
              fontFamily: 'Inter'
            },
            legend: {
              display: false
            },
            scales: {
              xAxes: [{
                scaleLabel: {
                  display: true,
                  labelString: 'Time',
                  fontColor: '#000000',
                  fontFamily: 'Inter',
                  fontSize: 10,
                  fontStyle: 'bold'
                },
                gridLines: { display: false, drawBorder: false },
                ticks: {
                  fontFamily: 'Inter',
                  fontColor: '#000000',
                  fontSize: 10,
                  maxTicksLimit: 8
                }
              }],
              yAxes: [{
                scaleLabel: {
                  display: true,
                  labelString: 'Price',
                  fontColor: '#000000',
                  fontFamily: 'Inter',
                  fontSize: 10,
                  fontStyle: 'bold'
                },
                gridLines: { color: '#e2e8f0', drawBorder: false },
                ticks: {
                  fontFamily: 'Inter',
                  fontColor: '#000000',
                  fontSize: 10,
                  callback: (val) => '₹' + parseInt(val).toLocaleString('en-IN')
                }
              }]
            }
          },
          backgroundColor: 'white'
        };
        
        const graphUrl = `https://quickchart.io/chart?w=600&h=350&backgroundColor=white&f=jpg&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        const graphClickable = `<a href="${product.aff_url || product.product_url}"><b>${escapeHTML(product.product_name)}</b></a>`;
        await bot.sendPhoto(chatId, graphUrl, {
          caption: `📊 Price History graph for ${graphClickable}`,
          parse_mode: 'HTML'
        });
      } else {
        await bot.sendMessage(chatId, '⚠️ Not enough price history points to generate a graph.');
      }
    } catch (err) {
      console.error('[Graph Generation Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to generate chart.');
    }
  }
  
  if (callbackData === 'my_trackings') {
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const trackings = await db.getUserTrackings(chatId);
    if (trackings.length === 0) {
      await bot.sendMessage(chatId, 'You are not tracking any products.', {
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
      return;
    }

    let reply = `📂 <b>Your Tracked Products</b>\n\n`;
    trackings.forEach((t, index) => {
      const link = t.aff_url || t.product_url;
      reply += `${index + 1}.\n` +
        `<a href="${link}"><b>${escapeHTML(t.product_name.substring(0, 60))}...</b></a>\n` +
        `/product_${t.id}\n` +
        `/stop_${t.id}\n` +
        `<b>Current Price:</b> ₹${parseFloat(t.current_price).toLocaleString('en-IN')}\n\n` +
        `----------------\n\n`;
    });

    await bot.sendMessage(chatId, reply, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [getMainButtons()] }
    });
  }

  if (callbackData === 'verify_subscription') {
    const userId = callbackQuery.from.id;
    const channel = "-1003849048564";
    
    try {
      const member = await bot.getChatMember(channel, userId);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      
      if (isMember) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "✅ Subscription verified!" });
        await bot.editMessageText("🎉 Thank you for subscribing! Executing your pending task...", {
          chat_id: chatId,
          message_id: message.message_id
        }).catch(() => {});
        
        const task = pendingTasks.get(userId);
        if (task && task.execute) {
          pendingTasks.delete(userId);
          await task.execute();
        } else {
          await bot.sendMessage(chatId, "Verification successful! You can now use the bot.");
        }
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "⚠️ You have not joined yet! Please join the channel first.",
          show_alert: true
        });
      }
    } catch (err) {
      console.error('[verify_subscription error]', err.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Error checking membership status." });
    }
  }
});

// Listener for general messages containing URLs (automatic track)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption;
  
  // Save user immediately on any interaction
  await db.saveUser(chatId, msg.from?.first_name || '', msg.from?.username || '').catch(() => {});

  // Check if admin is currently in broadcast setup flow
  if (isAdmin(chatId) && activeBroadcasts.has(chatId)) {
    const broadcastState = activeBroadcasts.get(chatId);
    if (broadcastState.state === 'awaiting_content') {
      activeBroadcasts.set(chatId, { state: 'confirming', content: msg });
      
      const opts = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Yes, Broadcast', callback_data: 'confirm_broadcast:yes' },
              { text: '❌ Cancel', callback_data: 'confirm_broadcast:no' }
            ]
          ]
        }
      };
      
      await bot.sendMessage(chatId, '📝 *Preview of your broadcast message:*', { parse_mode: 'Markdown' });
      
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await bot.sendPhoto(chatId, fileId, { caption: msg.caption || '', ...opts });
      } else if (msg.video) {
        await bot.sendVideo(chatId, msg.video.file_id, { caption: msg.caption || '', ...opts });
      } else if (msg.text) {
        await bot.sendMessage(chatId, msg.text, opts);
      } else {
        activeBroadcasts.delete(chatId);
        await bot.sendMessage(chatId, '❌ Unsupported broadcast message type. Broadcast flow cancelled.');
      }
      return;
    }
  }

  // Skip commands
  if (!text || text.startsWith('/')) {
    return;
  }

  // Regex check for product URL
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const matches = text.match(urlRegex);
  
  if (!matches) {
    // If message contains no URL
    await bot.sendMessage(
      chatId, 
      `Link not found.\n\nGive me a product link and I will alert you whenever the price changes.`,
      { reply_markup: { inline_keyboard: [getMainButtons()] } }
    );
    return;
  }

  const productUrl = matches[0];
  let resolvedUrl = productUrl;
  const urlLower = productUrl.toLowerCase();
  const isGenericShort = !urlLower.includes('amazon.in') && !urlLower.includes('flipkart.com') && 
                         !urlLower.includes('shopsy.in') && !urlLower.includes('myntra.com') && 
                         !urlLower.includes('ajio.com') && !urlLower.includes('meesho.com') &&
                         !urlLower.includes('croma.com') && !urlLower.includes('tatacliq.com') &&
                         !urlLower.includes('reliancedigital.in') && !urlLower.includes('nykaa.com');
                         
  const isFlipkartShort = urlLower.includes('flipkart.com') && (urlLower.includes('/s/') || urlLower.includes('/dl/s/'));
  const isShopsyShort = urlLower.includes('shopsy.in') && (urlLower.includes('/s/') || urlLower.includes('/dl/s/'));
  
  if (isGenericShort || isFlipkartShort || isShopsyShort) {
    const statusMsg = await bot.sendMessage(chatId, '🔍 Resolving link...');
    try {
      const res = await axios.get(`${scraperApiUrl}/api/history`, {
        params: { url: productUrl },
        timeout: 30000
      });
      if (res.data && res.data.success && res.data.url) {
        resolvedUrl = res.data.url;
      } else {
        resolvedUrl = await expandUrl(productUrl);
      }
    } catch (e) {
      console.warn('[Resolving short link via API failed, using fallback]', e.message);
      resolvedUrl = await expandUrl(productUrl);
    }
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
  }
  const detected = detectPlatformAndPid(resolvedUrl);
  
  await verifyUserAndExecute(msg, 'track_url', { url: resolvedUrl, detected: detected }, async () => {
    if (!detected) {
      // Unsupported platform
      await bot.sendMessage(
        chatId,
        `Unsupported platform.\n\n*Supported:*\nAmazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, Croma, TataCliq, Reliance Digital, Nykaa, or any other generic URL.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [getMainButtons()] } }
      );
      return;
    }

    const { platform, pid } = detected;

    // Validate limits
    const limit = parseInt(process.env.MAX_TRACK_PRODUCTS) || 10;
    const currentCount = await db.getUserTrackedCount(chatId);
    
    if (currentCount >= limit) {
      await bot.sendMessage(
        chatId, 
        `⚠️ <b>Tracking limit reached.</b>\n\n` +
        `You are already tracking ${currentCount} products.\n\n` +
        `Please remove one or more products from /my_trackings before adding a new one.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Check if already tracking
    const alreadyTracking = await db.getUserTracking(chatId, platform, pid);
    if (alreadyTracking && alreadyTracking.tracking_status === 'active') {
      await bot.sendMessage(
        chatId,
        `ℹ️ <b>You're already tracking this product.</b>\n\nWe'll notify you whenever its price changes.`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📂 My Trackings', callback_data: 'my_trackings' },
                { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${platform}_${pid}` }
              ]
            ]
          }
        }
      );
      return;
    }

    // Sequence of replies: Please Wait...!! -> Getting Product Info... -> Adding Your Product...
    let resultMsg = null;
    let extraMsgs = [];
    let timer1 = null;
    let timer2 = null;

    resultMsg = await bot.sendMessage(chatId, 'Please Wait...!!');
    
    // Set up status timers
    timer1 = setTimeout(async () => {
      try {
        const statusText = `⏳ *Scraping is taking a bit longer than expected...*\n\nWe are still retrieving the product details, please wait...`;
        const m = await bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
        extraMsgs.push(m);
      } catch (e) {}
    }, 10000); // 10 seconds

    timer2 = setTimeout(async () => {
      try {
        const stillText = `⏳ *Still onto this...*\n\nIt is taking longer than usual, but we are still crawling the data. Please hang tight!`;
        const m = await bot.sendMessage(chatId, stillText, { parse_mode: 'Markdown' });
        extraMsgs.push(m);
      } catch (e) {}
    }, 60000); // 60 seconds (1 minute)

    const cleanupProgress = async () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      if (resultMsg) {
        await bot.deleteMessage(chatId, resultMsg.message_id).catch(() => {});
      }
      for (const m of extraMsgs) {
        if (m) {
          await bot.deleteMessage(chatId, m.message_id).catch(() => {});
        }
      }
    };

    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      await bot.editMessageText('Getting Product Info...', { chat_id: chatId, message_id: resultMsg.message_id }).catch(() => {});
      
      // Scrape details from API scraper service with a 30s timeout and a 6s loading retry fallback
      let response;
      try {
        response = await axios.get(`${scraperApiUrl}/api/history`, {
          params: { url: productUrl },
          timeout: 30000
        });
      } catch (err) {
        console.log('[Automatic Tracking Fetch] First attempt failed. Retrying...');
        await new Promise(resolve => setTimeout(resolve, 6000));
        
        try {
          response = await axios.get(`${scraperApiUrl}/api/history`, {
            params: { url: productUrl },
            timeout: 30000
          });
        } catch (retryErr) {
          throw retryErr;
        }
      }
      
      const data = response.data;
      if (!data || !data.success) {
        await cleanupProgress();
        await bot.sendMessage(chatId, 'Failed to get your product.\n\nPlease report it to the admin.', {
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
        return;
      }

      const livePrice = parseFloat(data.price);
      
      // Out of Stock check
      if (!livePrice || isNaN(livePrice) || livePrice <= 0) {
        await cleanupProgress();
        await bot.sendMessage(chatId, 'Looks like this product is Out Of Stock.\n\nPlease try again later.', {
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
        return;
      }

      await cleanupProgress();

      // Show confirmation preview card
      const confirmationText = `🏷️ <b>${escapeHTML(data.title)}</b>\n\n` +
        `💰 <b>Current Price:</b> ₹${livePrice.toLocaleString('en-IN')}\n` +
        `🏪 <b>Store:</b> ${escapeHTML(platform.toUpperCase())}\n\n` +
        `Would you like to track this product?\n` +
        `You'll receive a Telegram notification whenever the price changes.`;
        
      const opts = {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Track', callback_data: `track:yes:${platform}:${pid}` },
              { text: '❌ Cancel', callback_data: `track:cancel` }
            ]
          ]
        }
      };

      await bot.sendMessage(chatId, confirmationText, opts);
    } catch (err) {
      console.error('[Automatic Tracking Error]', err.message);
      await cleanupProgress();
      await bot.sendMessage(chatId, 'Failed to get your product.\n\nPlease report it to the admin.', {
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    }
  });
});

// Background Scheduler
function startScheduler() {
  // Read tracking interval from environment: prioritize TRACKING_INTERVAL_HOURS, fallback to TRACKING_INTERVAL_MINUTES
  let intervalMs;
  let intervalText;
  if (process.env.TRACKING_INTERVAL_HOURS) {
    const hours = parseFloat(process.env.TRACKING_INTERVAL_HOURS);
    intervalMs = hours * 60 * 60 * 1000;
    intervalText = `${hours} hours`;
  } else {
    const minutes = parseInt(process.env.TRACKING_INTERVAL_MINUTES) || 30;
    intervalMs = minutes * 60 * 1000;
    intervalText = `${minutes} minutes`;
  }
  console.log(`⏰ [Telegram Scheduler] Initializing tracker scheduler to run every ${intervalText}...`);
  
  setInterval(async () => {
    console.log('⏰ [Telegram Scheduler] Starting price update loop...');
    try {
      const activeProducts = await db.getAllActiveTrackings();
      console.log(`⏰ [Telegram Scheduler] Checking prices for ${activeProducts.length} tracked products...`);
      
      for (const product of activeProducts) {
        try {
          // Scrape product live
          const response = await axios.get(`${scraperApiUrl}/api/history`, {
            params: { url: product.product_url },
            timeout: 25000
          });
          
          if (response.data && response.data.success) {
            const livePrice = parseFloat(response.data.price);
            if (livePrice && !isNaN(livePrice)) {
              const updateResult = await db.updateProductPrice(product.id, livePrice);
              
              if (updateResult && updateResult.changed) {
                // Price changed! Notify user
                const userChatId = product.user_id;
                const oldPrice = updateResult.oldPrice;
                const newPrice = livePrice;
                const diff = newPrice - oldPrice;
                const pct = ((Math.abs(diff) / oldPrice) * 100).toFixed(1);
                
                let currentAffUrl = null;
                if (product.platform === 'amazon') {
                  currentAffUrl = await db.getExistingAffUrl(product.platform, product.product_id);
                  if (!currentAffUrl || currentAffUrl === product.product_url) {
                    currentAffUrl = await affiliate.convert(product.product_url, product.platform);
                  }
                } else {
                  try {
                    currentAffUrl = await affiliate.convert(product.product_url, product.platform);
                  } catch (e) {
                    console.error('[Scheduler Affiliate Error]', e.message);
                  }
                  if (!currentAffUrl || currentAffUrl === product.product_url) {
                    currentAffUrl = await db.getExistingAffUrl(product.platform, product.product_id);
                  }
                }
                if (!currentAffUrl) {
                  currentAffUrl = product.product_url;
                }
                const clickableName = `<a href="${currentAffUrl}"><b>${escapeHTML(product.product_name)}</b></a>`;
                let notifyMsg = '';
                if (diff < 0) {
                   notifyMsg = `📢 <b>Price Changed!</b>\n\n` +
                    `${clickableName}\n\n` +
                    `<b>Old Price:</b> ₹${oldPrice.toLocaleString('en-IN')}\n` +
                    `<b>Current Price:</b> ₹${newPrice.toLocaleString('en-IN')}\n` +
                    `<b>Difference:</b> -₹${Math.abs(diff).toLocaleString('en-IN')} (-${pct}%)\n\n` +
                    `/product_${product.id}${ID_SUFFIX} Click For More Details\n` +
                    `/stop_${product.id}${ID_SUFFIX} For Stop tracking This product`;
                } else {
                   notifyMsg = `📈 <b>Price Increased!</b>\n\n` +
                    `${clickableName}\n\n` +
                    `<b>Old Price:</b> ₹${oldPrice.toLocaleString('en-IN')}\n` +
                    `<b>New Price:</b> ₹${newPrice.toLocaleString('en-IN')}\n` +
                    `<b>Difference:</b> +₹${diff.toLocaleString('en-IN')} (+${pct}%)\n\n` +
                    `/product_${product.id}${ID_SUFFIX} Click For More Details\n` +
                    `/stop_${product.id}${ID_SUFFIX} For Stop tracking This product`;
                }
                
                const opts = {
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🛒 Buy Now', url: currentAffUrl }],
                      [
                        { text: '📊 Price Graph', callback_data: `graph:${product.id}` },
                        { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${product.platform}_${product.product_id}` }
                      ]
                    ]
                  }
                };
                
                await bot.sendMessage(userChatId, notifyMsg, opts).catch(() => {});
              }
            }
          }
          // courteous pause
          await new Promise(resolve => setTimeout(resolve, 4000));
        } catch (e) {
          console.error(`⏰ [Telegram Scheduler Error] Failed to update product ${product.id}:`, e.message);
        }
      }
      console.log('⏰ [Telegram Scheduler] Price update loop completed.');
    } catch (err) {
      console.error('⏰ [Telegram Scheduler Error]', err.message);
    }
  }, intervalMs);
}

// Start database and scheduler
db.initDatabase().then(() => {
  startScheduler();
});
