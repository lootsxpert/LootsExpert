const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

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

// Helper: Verify subscription and execute task
async function verifyUserAndExecute(msg, taskType, taskData, executeCallback) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const channel = process.env.AUTH_CHANNEL || '@botsxp';
  
  try {
    const member = await bot.getChatMember(channel, userId);
    const isMember = ['member', 'administrator', 'creator'].includes(member.status);
    
    if (isMember) {
      // Show temporary subscriber status message
      const statusMsg = await bot.sendMessage(chatId, '✅ You are a subscriber, continuing your task...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      
      // Execute actual task callback
      await executeCallback();
    } else {
      // Store pending task in-memory
      pendingTasks.set(userId, { type: taskType, data: taskData, execute: executeCallback });
      
      const channelLink = channel.startsWith('@') ? `https://t.me/${channel.substring(1)}` : `https://t.me/botsxp`;
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
  if (p === 'shopsy') return `https://www.shopsy.in/p/p?pid=${pid}`;
  if (p === 'myntra') return `https://www.myntra.com/p/${pid}/buy`;
  if (p === 'ajio') return `https://www.ajio.com/p/${pid}`;
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
        
        const response = await axios.get(`${scraperApiUrl}/api/scrape`, {
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
            ],
            getMainButtons()
          ]
        }
      };
      
      if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, { caption: confirmationText, ...opts });
      } else {
        await bot.sendMessage(chatId, confirmationText, opts);
      }
      
    } catch (err) {
      console.error('[Deep Link Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to load deep link product. Please try pasting a direct URL.');
    }
    return;
  }

  const name = msg.from.first_name || 'there';
  const welcomeText = `👋 Hello *${escapeMarkdown(name)}*!\n\n` +
    `I'm *PriceTrackerBot*, your personal assistant for tracking product prices.\n\n` +
    `I will notify you whenever the price goes up or down.\n\n` +
    `Simply send me a product link.\n\n` +
    `*Supported Websites:*\n` +
    `• Amazon\n• Flipkart\n• Shopsy\n• Ajio\n• Myntra\n• Meesho\n\n` +
    `Use /my_trackings to see tracked products.\n` +
    `Use /help for help.\n\n` +
    `*Also Try:*\n` +
    `@Amazon\\_Pricehistory\\_bot\n` +
    `@${escapeMarkdown(historyBotUsername)}`;

  const opts = {
    parse_mode: 'Markdown',
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
  await verifyUserAndExecute(msg, 'help', {}, async () => {
    const helpText = `🤖 *Price Tracker Bot Help*\n\n` +
      `*Commands:*\n` +
      `/my_trackings - View tracked products\n` +
      `/product_<product_id> - View product details\n` +
      `/stop_<product_id> - Stop tracking\n` +
      `/pricegraph - View list to generate graph\n` +
      `/pricegraph_<product_id> - Generate price graph\n\n` +
      `*How it works:*\n` +
      `1. Send a product link (Amazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, Croma, TataCliq, Reliance Digital, Nykaa, etc.)\n` +
      `2. Bot tracks the product\n` +
      `3. Receive notification whenever the price changes.`;

    await bot.sendMessage(msg.chat.id, helpText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [getMainButtons()] }
    });
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

      let reply = `📂 *Your Tracked Products*\n\n`;
      trackings.forEach((t, index) => {
        reply += `${index + 1}.\n` +
          `*${t.product_name.substring(0, 60)}...*\n` +
          `/product_${t.product_id}\n` +
          `/stop_${t.product_id}\n` +
          `*Current Price:* ₹${parseFloat(t.current_price).toLocaleString('en-IN')}\n\n` +
          `----------------\n\n`;
      });

      await bot.sendMessage(chatId, reply, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    } catch (err) {
      console.error('[Command /my_trackings Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to fetch tracking list.');
    }
  });
});

// Command: /product_<id>
bot.onText(/\/product_([a-zA-Z0-9]+)/, async (msg, match) => {
  const productPid = match[1];

  await verifyUserAndExecute(msg, 'product', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    const infoMsg = await bot.sendMessage(chatId, '🔍 Getting Product Info...');

    try {
      const product = await db.getProductByPid(chatId, productPid);
      await bot.deleteMessage(chatId, infoMsg.message_id);

      if (!product || String(product.user_id) !== String(chatId)) {
        await bot.sendMessage(chatId, '❌ Product not found or you are not tracking it.');
        return;
      }

      const caption = `🛍️ *${escapeMarkdown(product.platform.toUpperCase())} Product Details*\n\n` +
        `📌 *${escapeMarkdown(product.product_name)}*\n\n` +
        `💵 *Current Price:* ₹${parseFloat(product.current_price).toLocaleString('en-IN')}\n` +
        `🏪 *Platform:* ${escapeMarkdown(product.platform.toUpperCase())}\n` +
        `🔗 [Product Link](${product.product_url})`;

      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Buy Now', url: product.aff_url || product.product_url }],
            [
              { text: '❌ Stop Tracking', callback_data: `stop:${product.product_id}` },
              { text: '📊 Price Graph', callback_data: `graph:${product.product_id}` }
            ],
            [
              { text: '🔍 View Full Price History', url: `https://t.me/${historyBotUsername}?start=graph_${product.platform}_${product.product_id}` }
            ],
            getMainButtons()
          ]
        }
      };

      if (product.image_url) {
        await bot.sendPhoto(chatId, product.image_url, { caption: caption, ...opts });
      } else {
        await bot.sendMessage(chatId, caption, opts);
      }
    } catch (err) {
      console.error('[Command /product Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to retrieve product information.');
    }
  });
});

// Command: /stop_<id>
bot.onText(/\/stop_([a-zA-Z0-9]+)/, async (msg, match) => {
  const productPid = match[1];

  await verifyUserAndExecute(msg, 'stop', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, '🗑️ Deleting Product...');

    try {
      const product = await db.getProductByPid(chatId, productPid);
      if (!product || String(product.user_id) !== String(chatId)) {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, '❌ Product tracking record not found.');
        return;
      }

      await db.stopTrackingByPid(chatId, productPid);
      await bot.deleteMessage(chatId, statusMsg.message_id);
      
      await bot.sendMessage(chatId, `✅ *Product removed successfully.*\n\nYou will no longer receive alerts.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    } catch (err) {
      console.error('[Command /stop Error]', err.message);
      await bot.sendMessage(chatId, '⚠️ Failed to delete tracking record.');
    }
  });
});

// Command: /pricegraph (with optional product ID)
bot.onText(/^\/pricegraph(?:[_ ](.+))?$/, async (msg, match) => {
  const productPid = match[1];
  
  await verifyUserAndExecute(msg, 'pricegraph', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    
    if (productPid) {
      const statusMsg = await bot.sendMessage(chatId, '📊 Generating price graph...');
      try {
        const product = await db.getProductByPid(chatId, productPid);
        if (product && product.price_history && product.price_history.length > 0) {
          const labels = product.price_history.map(h => {
            const d = new Date(h.date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          });
          const prices = product.price_history.map(h => parseFloat(h.price));
          
          const chartConfig = {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Price History (₹)',
                data: prices,
                borderColor: '#4f46e5',
                borderWidth: 2,
                fill: false,
                pointRadius: 4,
                backgroundColor: '#818cf8'
              }]
            },
            options: {
              title: {
                display: true,
                text: product.product_name.substring(0, 25) + '... Trend'
              }
            }
          };
          
          const graphUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          await bot.sendPhoto(chatId, graphUrl, {
            caption: `📊 Price History graph for *${product.product_name}*`,
            parse_mode: 'Markdown'
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
        
        let reply = `📈 *Generate Price Graph*\n\nSelect a product to generate its price history graph:\n\n`;
        trackings.forEach((t, index) => {
          reply += `${index + 1}. *${t.product_name.substring(0, 60)}...*\n` +
                   `📊 Generate Graph: /pricegraph_${t.product_id}\n\n`;
        });
        
        await bot.sendMessage(chatId, reply, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
      } catch (err) {
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, '⚠️ Failed to fetch tracking list.');
      }
    }
  });
});

// Command alias for click triggering: /pricegraph_<id>
bot.onText(/\/pricegraph_([a-zA-Z0-9]+)/, async (msg, match) => {
  const productPid = match[1];
  await verifyUserAndExecute(msg, 'pricegraph', { pid: productPid }, async () => {
    const chatId = msg.chat.id;
    const statusMsg = await bot.sendMessage(chatId, '📊 Generating price graph...');
    try {
      const product = await db.getProductByPid(chatId, productPid);
      if (product && product.price_history && product.price_history.length > 0) {
        const labels = product.price_history.map(h => {
          const d = new Date(h.date);
          return `${d.getDate()}/${d.getMonth() + 1}`;
        });
        const prices = product.price_history.map(h => parseFloat(h.price));
        
        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Price History (₹)',
              data: prices,
              borderColor: '#4f46e5',
              borderWidth: 2,
              fill: false,
              pointRadius: 4,
              backgroundColor: '#818cf8'
            }]
          },
          options: {
            title: {
              display: true,
              text: product.product_name.substring(0, 25) + '... Trend'
            }
          }
        };
        
        const graphUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        await bot.sendPhoto(chatId, graphUrl, {
          caption: `📊 Price History graph for *${product.product_name}*`,
          parse_mode: 'Markdown'
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
  });
});

// Command: /broadcast (Admin)
bot.onText(/\/broadcast/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  await bot.sendMessage(chatId, `🎙 Send the message (text, photo, or video with caption) that you want to broadcast.\n\nReply to this message with your content.`);
  
  // Set next message listener
  const listenerId = bot.onReplyToMessage(chatId, msg.message_id, async (reply) => {
    bot.removeReplyListener(listenerId);
    
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
      // Courteous broadcast sleep
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    await bot.editMessageText(`📢 *Broadcast completed*\n\n• Success: ${success}\n• Failed: ${failed}`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  });
});

// Command: /stats (Admin)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  const joined = await checkMembership(msg);
  if (!joined) return;

  if (!isAdmin(chatId)) {
    return; // Silent ignore for non-admins
  }

  try {
    const stats = await db.getStats();
    if (stats) {
      const statsText = `📊 *Price Tracker Bot Stats*\n\n` +
        `• *Total Users:* ${stats.totalUsers}\n` +
        `• *Total Products:* ${stats.totalProducts}\n` +
        `• *Active Trackings:* ${stats.activeProducts}`;
        
      await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, '⚠️ Failed to calculate stats.');
    }
  } catch (err) {
    await bot.sendMessage(chatId, '⚠️ Stats query errored.');
  }
});

// Callback Query Handler (Inline button clicks)
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const callbackData = callbackQuery.data;
  
  // Extract actions
  if (callbackData.startsWith('track:')) {
    const parts = callbackData.split(':');
    const action = parts[1]; // yes, cancel
    
    if (action === 'cancel') {
      await bot.answerCallbackQuery(callbackQuery.id);
      await bot.editMessageText('❌ Tracking cancelled.', {
        chat_id: chatId,
        message_id: message.message_id
      });
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
            `⚠️ *Tracking limit reached.*\n\n` +
            `You are already tracking the maximum number of products allowed (${limit}).\n\n` +
            `Please remove one or more products from /my_trackings before adding a new one.`, 
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Check if already tracking
        const alreadyTracking = await db.getUserTracking(chatId, store, pid);
        if (alreadyTracking) {
          await bot.sendMessage(
            chatId, 
            `ℹ️ *You're already tracking this product.*\n\nWe'll notify you whenever its price changes.`,
            {
              parse_mode: 'Markdown',
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
        const response = await axios.get(`${scraperApiUrl}/api/scrape`, {
          params: { url: url },
          timeout: 20000
        });
        
        const data = response.data;
        if (!data || !data.success) {
          await bot.sendMessage(chatId, '❌ Failed to scrape product details. Please try again.');
          return;
        }
        
        // Convert to affiliate URL (check global DB first to avoid redundant API hits)
        let affUrl = await db.getExistingAffUrl(store, pid);
        if (!affUrl) {
          affUrl = await affiliate.convert(url, store);
        }
        
        // Add to database
        const saved = await db.addProduct(
          chatId,
          store,
          pid,
          data.title,
          url,
          affUrl,
          data.image,
          parseFloat(data.price)
        );
        
        if (saved) {
          const successMsg = `✅ *Product added successfully!*\n\n` +
            `🏷 *${escapeMarkdown(data.title)}*\n\n` +
            `💰 *Current Price:* ₹${parseFloat(data.price).toLocaleString('en-IN')}\n\n` +
            `🔔 Price tracking has been enabled.\nYou'll receive a notification whenever the price changes.`;
            
          const opts = {
            parse_mode: 'Markdown',
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
      await db.stopTrackingByPid(chatId, productPid);
      await bot.sendMessage(chatId, '✅ *Product removed successfully.*\n\nYou will no longer receive alerts.', {
        parse_mode: 'Markdown',
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
      const product = await db.getProductByPid(chatId, productPid);
      if (product && product.price_history && product.price_history.length > 0) {
        // Construct QuickChart config
        const labels = product.price_history.map(h => {
          const d = new Date(h.date);
          return `${d.getDate()}/${d.getMonth() + 1}`;
        });
        const prices = product.price_history.map(h => parseFloat(h.price));
        
        const chartConfig = {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Price History (₹)',
              data: prices,
              borderColor: '#4f46e5',
              borderWidth: 2,
              fill: false,
              pointRadius: 4,
              backgroundColor: '#818cf8'
            }]
          },
          options: {
            title: {
              display: true,
              text: product.product_name.substring(0, 25) + '... Trend'
            }
          }
        };
        
        const graphUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        await bot.sendPhoto(chatId, graphUrl, {
          caption: `📊 Price History graph for *${product.product_name}*`,
          parse_mode: 'Markdown'
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

    let reply = `📂 *Your Tracked Products*\n\n`;
    trackings.forEach((t, index) => {
      reply += `${index + 1}.\n` +
        `*${t.product_name.substring(0, 60)}...*\n` +
        `/product_${t.product_id}\n` +
        `/stop_${t.product_id}\n` +
        `*Current Price:* ₹${parseFloat(t.current_price).toLocaleString('en-IN')}\n\n` +
        `----------------\n\n`;
    });

    await bot.sendMessage(chatId, reply, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [getMainButtons()] }
    });
  }

  if (callbackData === 'verify_subscription') {
    const userId = callbackQuery.from.id;
    const channel = process.env.AUTH_CHANNEL || '@botsxp';
    
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

  // Skip commands
  if (!text || text.startsWith('/')) {
    return;
  }

  // Regex check for product URL
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const matches = text.match(urlRegex);
  
  if (!matches) {
    // If message contains no URL
    await verifyUserAndExecute(msg, 'help', {}, async () => {
      await bot.sendMessage(
        chatId, 
        `Link not found.\n\nGive me a product link and I will alert you whenever the price changes.`,
        { reply_markup: { inline_keyboard: [getMainButtons()] } }
      );
    });
    return;
  }

  const productUrl = matches[0];
  const detected = detectPlatformAndPid(productUrl);
  
  await verifyUserAndExecute(msg, 'track_url', { url: productUrl, detected: detected }, async () => {
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
        `⚠️ *Tracking limit reached.*\n\n` +
        `You are already tracking ${currentCount} products.\n\n` +
        `Please remove one or more products from /my_trackings before adding a new one.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Check if already tracking
    const alreadyTracking = await db.getUserTracking(chatId, platform, pid);
    if (alreadyTracking) {
      await bot.sendMessage(
        chatId,
        `ℹ️ *You're already tracking this product.*\n\nWe'll notify you whenever its price changes.`,
        {
          parse_mode: 'Markdown',
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
    const statusMsg = await bot.sendMessage(chatId, 'Please Wait...!!');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      await bot.editMessageText('Getting Product Info...', { chat_id: chatId, message_id: statusMsg.message_id });
      
      // Scrape details from API scraper service
      const response = await axios.get(`${scraperApiUrl}/api/scrape`, {
        params: { url: productUrl },
        timeout: 20000
      });
      
      const data = response.data;
      if (!data || !data.success) {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, 'Failed to get your product.\n\nPlease report it to the admin.', {
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
        return;
      }

      const livePrice = parseFloat(data.price);
      
      // Out of Stock check
      if (!livePrice || isNaN(livePrice) || livePrice <= 0) {
        await bot.deleteMessage(chatId, statusMsg.message_id);
        await bot.sendMessage(chatId, 'Looks like this product is Out Of Stock.\n\nPlease try again later.', {
          reply_markup: { inline_keyboard: [getMainButtons()] }
        });
        return;
      }

      await bot.editMessageText('Adding Your Product...', { chat_id: chatId, message_id: statusMsg.message_id });
      
      // Convert to affiliate URL (check global DB first to avoid redundant API hits)
      let affUrl = await db.getExistingAffUrl(platform, pid);
      if (!affUrl) {
        affUrl = await affiliate.convert(productUrl, platform);
      }
      
      // Save to database
      const saved = await db.addProduct(
        chatId,
        platform,
        pid,
        data.title,
        productUrl,
        affUrl,
        data.image,
        livePrice
      );
      
      await bot.deleteMessage(chatId, statusMsg.message_id);
      
      if (saved) {
        const successText = `🛍️ *Tracking your product*\n\n` +
          `*${escapeMarkdown(data.title)}*\n\n` +
          `*Current Price:*\n₹${livePrice.toLocaleString('en-IN')}\n\n` +
          `/product_${saved.product_id}\n` +
          `/stop_${saved.product_id}`;
          
        const opts = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛒 Buy Now', url: affUrl || productUrl }],
              [
                { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${platform}_${pid}` },
                { text: '📂 My Trackings', callback_data: 'my_trackings' }
              ],
              getMainButtons()
            ]
          }
        };

        if (data.image) {
          await bot.sendPhoto(chatId, data.image, { caption: successText, ...opts });
        } else {
          await bot.sendMessage(chatId, successText, opts);
        }
      }
      
    } catch (err) {
      console.error('[Automatic Tracking Error]', err.message);
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId, 'Failed to get your product.\n\nPlease report it to the admin.', {
        reply_markup: { inline_keyboard: [getMainButtons()] }
      });
    }
  });
});

// Background Scheduler
function startScheduler() {
  const intervalMinutes = parseInt(process.env.TRACKING_INTERVAL_MINUTES) || 30;
  console.log(`⏰ [Telegram Scheduler] Initializing tracker scheduler to run every ${intervalMinutes} minutes...`);
  
  setInterval(async () => {
    console.log('⏰ [Telegram Scheduler] Starting price update loop...');
    try {
      const activeProducts = await db.getAllActiveTrackings();
      console.log(`⏰ [Telegram Scheduler] Checking prices for ${activeProducts.length} tracked products...`);
      
      for (const product of activeProducts) {
        try {
          // Scrape product live
          const response = await axios.get(`${scraperApiUrl}/api/scrape`, {
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
                
                let notifyMsg = '';
                if (diff < 0) {
                  notifyMsg = `📢 *Price Changed!*\n\n` +
                    `*${escapeMarkdown(product.product_name)}*\n\n` +
                    `*Old Price:* ₹${oldPrice.toLocaleString('en-IN')}\n` +
                    `*Current Price:* ₹${newPrice.toLocaleString('en-IN')}\n` +
                    `*Difference:* -₹${Math.abs(diff).toLocaleString('en-IN')} (-${pct}%)\n`;
                } else {
                  notifyMsg = `📈 *Price Increased!*\n\n` +
                    `*${escapeMarkdown(product.product_name)}*\n\n` +
                    `*Old Price:* ₹${oldPrice.toLocaleString('en-IN')}\n` +
                    `*New Price:* ₹${newPrice.toLocaleString('en-IN')}\n` +
                    `*Difference:* +₹${diff.toLocaleString('en-IN')} (+${pct}%)\n`;
                }
                
                const opts = {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🛒 Buy Now', url: product.aff_url || product.product_url }],
                      [
                        { text: '📊 Price Graph', callback_data: `graph:${product.product_id}` },
                        { text: '📈 Price History', url: `https://t.me/${historyBotUsername}?start=graph_${product.platform}_${product.product_id}` }
                      ],
                      getMainButtons()
                    ]
                  }
                };
                
                await bot.sendMessage(userChatId, notifyMsg, opts);
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
  }, intervalMinutes * 60 * 1000);
}

// Start database and scheduler
db.initDatabase().then(() => {
  startScheduler();
});
