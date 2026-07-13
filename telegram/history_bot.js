const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const db = require('./history_db');
const affiliate = require('./affiliate');

let token = process.env.HISTORY_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
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

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_*\[`])/g, '\\$1');
}

if (!token) {
  console.error('[History Bot Error] HISTORY_BOT_TOKEN, BOT_TOKEN or TELEGRAM_BOT_TOKEN is missing in the environment variables!');
  process.exit(1);
}

// Create the bot
const bot = new TelegramBot(token, { polling: true });

// Listen for polling errors and log clean one-liner summaries to prevent log flooding
bot.on('polling_error', (error) => {
  console.error(`⚠️ [History Bot Polling Error] Code: ${error.code || 'UNKNOWN'}, Message: ${error.message || error}`);
});

console.log('📈 Telegram Price Graph Price History Bot is starting up...');

// Helper: Standard menu buttons
function getMainMenuButtons() {
  const priceTrackerUsername = process.env.PRICE_TRACKER_BOT_USERNAME || 'PriceTrackerBot';
  return [
    [
      { text: "🔥 Today's Deals", url: "https://t.me/+HeHY-qoy3vsxYWU1" },
      { text: "🤖 Price Tracker Bot", url: `https://t.me/${priceTrackerUsername}` }
    ],
    [
      { text: "📢 Join Updates", url: "https://t.me/+rTx5B9g6XYxmNmE1" },
      { text: "❓ Help", callback_data: "help" }
    ]
  ];
}

// Helper: Check if user is Admin
function isAdmin(userId) {
  const adminIdsEnv = process.env.ADMIN_IDS || '';
  const adminIds = adminIdsEnv.split(',').map(id => id.trim());
  return adminIds.includes(String(userId));
}

// Pending tasks map for verification flow
const pendingTasks = new Map();

// Helper: Verify subscription and execute task
async function verifyUserAndExecute(msg, taskType, taskData, executeCallback) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const channel = process.env.AUTH_CHANNEL || '@botsxp';
  
  try {
    // Check if user is banned
    const dbUser = await db.getHistoryUser(userId);
    if (dbUser && dbUser.is_banned) {
      await bot.sendMessage(userId, '❌ You are banned from using this bot.');
      return;
    }

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
    // In case of API failure, let user proceed to avoid lockout
    await executeCallback();
  }
}

// Extract platform & pid from general URL (mirrors the tracker bot)
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
      if (pid) return { platform: 'flipkart', pid };
      const pathParts = parsed.pathname.split('/');
      const pIndex = pathParts.indexOf('p');
      if (pIndex !== -1 && pathParts[pIndex + 1]) {
        return { platform: 'flipkart', pid: pathParts[pIndex + 1] };
      }
    }
    if (host.includes('shopsy.in') || host.includes('shopsy.com')) {
      const pid = parsed.searchParams.get('pid');
      if (pid) return { platform: 'shopsy', pid };
      const pathParts = parsed.pathname.split('/');
      const pIndex = pathParts.indexOf('p');
      if (pIndex !== -1 && pathParts[pIndex + 1]) {
        return { platform: 'shopsy', pid: pathParts[pIndex + 1] };
      }
    }
    if (host.includes('myntra.com')) {
      const match = parsed.pathname.match(/\/(\d+)\/buy/i);
      if (match) return { platform: 'myntra', pid: match[1] };
      const matchAlt = parsed.pathname.match(/\/(\d+)/);
      if (matchAlt) return { platform: 'myntra', pid: matchAlt[1] };
    }
    if (host.includes('ajio.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9_]+)/i);
      if (match) {
        return { platform: 'ajio', pid: match[1].split('_')[0] };
      }
    }
    if (host.includes('meesho.com')) {
      const match = parsed.pathname.match(/\/p\/([a-zA-Z0-9]+)/i);
      if (match) return { platform: 'meesho', pid: match[1] };
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
    
    // Generic host extraction for fallback metadata parser
    const hostParts = host.split('.');
    if (hostParts.length >= 2) {
      const name = hostParts[hostParts.length - 2];
      const matchPath = parsed.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/i) || parsed.pathname.match(/\/product\/([a-zA-Z0-9_-]+)/i);
      const pid = matchPath ? matchPath[1] : encodeURIComponent(url);
      return { platform: name, pid };
    }
  } catch (e) {}
  return null;
}

// Generate the buy recommendation analysis
function getBuyRecommendation(current, lowest, highest, average) {
  if (!current || !lowest || !highest || !average) {
    return {
      text: "🟡 Average Deal",
      details: "Not enough price history points.",
      color: "🟡"
    };
  }

  const diffRange = highest - lowest;
  const isExcellent = (current <= lowest * 1.05) || (diffRange > 0 && (current - lowest) / diffRange <= 0.1);
  
  if (isExcellent) {
    return {
      text: "🟢 Excellent Time To Buy",
      details: "Current price is among the lowest recorded.",
      color: "🟢"
    };
  }
  
  if (current < average) {
    return {
      text: "🟢 Good Time To Buy",
      details: "Below average. Good time to buy.",
      color: "🟢"
    };
  }
  
  if (current <= average * 1.05) {
    return {
      text: "🟡 Average Deal",
      details: "You may wait for a better discount.",
      color: "🟡"
    };
  }
  
  return {
    text: "🔴 Not Recommended",
    details: "Current price is significantly above its historical average. Waiting may save money.",
    color: "🔴"
  };
}

// Generate the Chart.js line graph url using QuickChart
function generateChartUrl(historyPoints, range = 'all', productName = '') {
  let filtered = [...historyPoints].sort((a, b) => new Date(a.date) - new Date(b.date));
  const now = new Date();
  
  if (range === '1m') {
    const limitDate = new Date(now.setDate(now.getDate() - 30));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  } else if (range === '3m') {
    const limitDate = new Date(now.setDate(now.getDate() - 90));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  } else if (range === '6m') {
    const limitDate = new Date(now.setDate(now.getDate() - 180));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  }

  // Fallback if filter left no points
  if (filtered.length === 0) {
    filtered = historyPoints;
  }

  const labels = filtered.map(p => {
    const d = new Date(p.date);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });
  const prices = filtered.map(p => p.price);

  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Price (₹)',
        data: prices,
        borderColor: '#4f46e5',
        borderWidth: 3,
        fill: true,
        backgroundColor: 'rgba(79, 70, 229, 0.1)',
        pointRadius: filtered.length > 20 ? 0 : 3,
        pointBackgroundColor: '#818cf8',
        lineTension: 0.1
      }]
    },
    options: {
      title: {
        display: true,
        text: (productName.substring(0, 30) + '... History Trend'),
        fontSize: 14,
        fontColor: '#1e293b'
      },
      legend: {
        display: false
      },
      scales: {
        xAxes: [{
          gridLines: { display: false }
        }],
        yAxes: [{
          ticks: {
            callback: (val) => '₹' + val
          }
        }]
      }
    }
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

// Fetch historical data through API (with caching)
async function fetchProductHistory(platform, pid, url = '') {
  // Check local PostgreSQL Cache first if enabled
  const enableCache = process.env.ENABLE_CACHE !== 'False';
  if (enableCache) {
    const cached = await db.getHistoryCache(platform, pid);
    if (cached) {
      console.log(`[History Bot Cache] Cache hit for ${platform}:${pid}`);
      return cached;
    }
  }

  // Scrape via scraper service
  console.log(`[History Bot Scraper] Cache miss. Fetching via Express API: ${platform}:${pid}`);
  const response = await axios.get(`${scraperApiUrl}/api/history`, {
    params: {
      platform,
      pid,
      url: url || undefined
    },
    timeout: 30000
  });

  const data = response.data;
  if (data && data.success) {
    if (enableCache) {
      const cacheTTL = parseInt(process.env.CACHE_TIME) || 900;
      await db.saveHistoryCache(platform, pid, data, cacheTTL);
    }
    return data;
  }
  throw new Error('Failed to retrieve history from Central Scraper API.');
}

// Render Result Card for User
async function renderHistoryCard(chatId, platform, pid, range = 'all', editMessageId = null, refreshData = false) {
  try {
    let resultMsg;
    if (editMessageId) {
      await bot.editMessageText('⏳ Generating Graph & Recommendation...', { chat_id: chatId, message_id: editMessageId }).catch(() => {});
    } else {
      resultMsg = await bot.sendMessage(chatId, '🔍 Finding Product...\n📈 Fetching Price History...');
    }

    if (refreshData) {
      await db.clearHistoryCache(platform, pid);
    }

    const data = await fetchProductHistory(platform, pid);
    const history = data.history || [];
    
    if (history.length === 0) {
      const msgText = `⚠ *No historical price data is available for this product yet.*\n\n` +
        `Current Price: ₹${parseFloat(data.price).toLocaleString('en-IN')}`;
      if (editMessageId) {
        await bot.editMessageText(msgText, { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown' });
      } else {
        await bot.deleteMessage(chatId, resultMsg.message_id).catch(() => {});
        await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      }
      return;
    }

    // Stats calculations
    const prices = history.map(h => h.price);
    const currentPrice = data.price || prices[prices.length - 1];
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = Math.round(prices.reduce((sum, val) => sum + val, 0) / prices.length);
    const originalPrice = data.originalPrice || currentPrice;
    
    const dropFromPeak = highestPrice > currentPrice ? Math.round(((highestPrice - currentPrice) / highestPrice) * 100) : 0;
    const rec = getBuyRecommendation(currentPrice, lowestPrice, highestPrice, averagePrice);

    // Format output text
    const textCaption = `🏷 *${escapeMarkdown(data.title)}*\n\n` +
      `💰 *Current :* ₹${currentPrice.toLocaleString('en-IN')}\n` +
      `📉 *Lowest :* ₹${lowestPrice.toLocaleString('en-IN')}\n` +
      `📈 *Highest :* ₹${highestPrice.toLocaleString('en-IN')}\n` +
      `📊 *Average :* ₹${averagePrice.toLocaleString('en-IN')}\n` +
      `🔥 *Drop From Peak :* ${dropFromPeak}%\n\n` +
      `🛍 *Recommendation*\n` +
      `${rec.color} *${escapeMarkdown(rec.text)}*\n_${escapeMarkdown(rec.details)}_\n\n` +
      `Platform: ${escapeMarkdown(data.platform || platform.toUpperCase())}`;

    // Inline buttons for timeline filters & buy now
    const affiliateUrl = await affiliate.convert(data.url || `https://www.amazon.in/dp/${pid}`, platform);
    const trackerUsername = process.env.PRICE_TRACKER_BOT_USERNAME || 'PriceTrackerBot';
    const inlineKeyboard = [
      [{ text: '🛒 Buy Now', url: affiliateUrl }],
      [
        { text: range === '1m' ? '● 1 Month' : '1 Month', callback_data: `f:${platform}:${pid}:1m` },
        { text: range === '3m' ? '● 3 Months' : '3 Months', callback_data: `f:${platform}:${pid}:3m` },
        { text: range === '6m' ? '● 6 Months' : '6 Months', callback_data: `f:${platform}:${pid}:6m` },
        { text: range === 'all' ? '● All Time' : 'All Time', callback_data: `f:${platform}:${pid}:all` }
      ],
      [
        { text: '🔔 Track Price Alerts', url: `https://t.me/${trackerUsername}?start=track_${platform}_${pid}` },
        { text: '🔄 Refresh', callback_data: `r:${platform}:${pid}` }
      ],
      getMainMenuButtons()[0]
    ];

    const chartUrl = generateChartUrl(history, range, data.title);

    // Send photo or edit existing photo message
    if (editMessageId || (resultMsg && editMessageId)) {
      await bot.deleteMessage(chatId, editMessageId || resultMsg.message_id).catch(() => {});
    } else if (resultMsg) {
      await bot.deleteMessage(chatId, resultMsg.message_id).catch(() => {});
    }

    await bot.sendPhoto(chatId, chartUrl, {
      caption: textCaption,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

  } catch (err) {
    console.error('[History Card Render Error]', err.message);
    const errMsg = `❌ *Scraping Failed*\n\nUnable to fetch price history at the moment.\n\nPlease try again later.`;
    if (editMessageId) {
      await bot.editMessageText(errMsg, { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, errMsg, { parse_mode: 'Markdown' });
    }
  }
}

// Command: /start (including deep linking support)
bot.onText(/^\/start(?: (.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const deepLink = match[1];

  await db.saveHistoryUser(chatId, msg.from.first_name || '', msg.from.username || '');

  if (deepLink && deepLink.startsWith('graph_')) {
    // Deep Link format: graph_<store>_<pid>
    const parts = deepLink.split('_');
    const store = parts[1];
    const pid = parts[2];
    
    if (store && pid) {
      await renderHistoryCard(chatId, store, pid);
      return;
    }
  }

  const name = msg.from.first_name || 'shopper';
  const welcomeText = `👋 *Welcome to Price History Bot* ${escapeMarkdown(name)}!\n\n` +
    `Track product prices before you buy.\n\n` +
    `Simply send any Amazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, or similar product link.\n\n` +
    `You'll instantly see:\n` +
    `📈 *Price History*\n` +
    `📉 *Lowest Price*\n` +
    `📊 *Average Price*\n` +
    `🔥 *Buy Recommendation*\n\n` +
    `*Supported Stores:*\n` +
    `• Amazon\n• Flipkart\n• Myntra\n• Ajio\n• Meesho\n• Shopsy\n• Croma / TataCliq / Reliance Digital / Nykaa (via search)`;

  await bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: getMainMenuButtons() }
  });
});

// Command: /help
bot.onText(/\/help/, async (msg) => {
  await verifyUserAndExecute(msg, 'help', {}, async () => {
    const helpText = `🤖 *How To Use*\n\n` +
      `1. Copy any product link.\n` +
      `2. Send it here.\n` +
      `3. Instantly view:\n` +
      `✔ Price Graph\n` +
      `✔ Lowest Price\n` +
      `✔ Highest Price\n` +
      `✔ Average Price\n` +
      `✔ Buy Recommendation`;

    await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: getMainMenuButtons() } });
  });
});

// Command: /about
bot.onText(/\/about/, async (msg) => {
  await verifyUserAndExecute(msg, 'about', {}, async () => {
    const aboutText = `ℹ *About Price History Bot*\n\n` +
      `• *Version:* 1.0\n` +
      `• *Supported Stores:* Amazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, Croma, TataCliq, Reliance Digital, Nykaa, and more.\n` +
      `• *Developer:* Price Graph Devs\n\n` +
      `Fetches live price history charts dynamically using high-fidelity scraping coordinate systems.`;

    await bot.sendMessage(msg.chat.id, aboutText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: getMainMenuButtons() } });
  });
});

// Command: /stats (Admin)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  try {
    const stats = await db.getHistoryStats();
    const trackerStats = `📊 *Price History Bot Stats*\n\n` +
      `• *Total Users:* ${stats.totalUsers}\n` +
      `• *Banned Users:* ${stats.bannedUsers}\n` +
      `• *Cached Products:* ${stats.cachedProducts}`;
    await bot.sendMessage(chatId, trackerStats, { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, '⚠️ Error loading stats.');
  }
});

// Command: /cache_clear (Admin)
bot.onText(/\/cache_clear/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const count = await db.clearHistoryCache();
  await bot.sendMessage(chatId, `🧹 Cache cleared successfully. Removed ${count} items.`);
});

// Command: /ban <userId> (Admin)
bot.onText(/\/ban (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const targetId = parseInt(match[1]);
  const user = await db.banUser(targetId);
  if (user) {
    await bot.sendMessage(chatId, `✅ User ${targetId} has been banned.`);
  } else {
    await bot.sendMessage(chatId, `⚠️ User ${targetId} not found.`);
  }
});

// Command: /unban <userId> (Admin)
bot.onText(/\/unban (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const targetId = parseInt(match[1]);
  const user = await db.unbanUser(targetId);
  if (user) {
    await bot.sendMessage(chatId, `✅ User ${targetId} has been unbanned.`);
  } else {
    await bot.sendMessage(chatId, `⚠️ User ${targetId} not found.`);
  }
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
    const users = await db.getAllHistoryUsers();
    
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

// Message Listener for product URLs
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption;

  if (!text || text.startsWith('/')) return;

  const urlRegex = /(https?:\/[^\s]+)/gi;
  const matches = text.match(urlRegex);
  
  if (!matches) {
    await verifyUserAndExecute(msg, 'help', {}, async () => {
      // Help fallback if no URL in simple text
      const helpText = `🤖 *How To Use*\n\n` +
        `1. Copy any product link.\n` +
        `2. Send it here.\n` +
        `3. Instantly view price graph.`;
      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: getMainMenuButtons() } });
    });
    return;
  }

  const productUrl = matches[0];
  const detected = detectPlatformAndPid(productUrl);
  
  await verifyUserAndExecute(msg, 'check_history', { url: productUrl, detected: detected }, async () => {
    if (!detected) {
      await bot.sendMessage(chatId, '❌ This shopping platform is currently not supported.', {
        reply_markup: { inline_keyboard: getMainMenuButtons() }
      });
      return;
    }

    const { platform, pid } = detected;
    await renderHistoryCard(chatId, platform, pid, 'all', null, false);
  });
});

// Callback Query Handler (buttons clicks)
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const callbackData = callbackQuery.data;

  // Verify membership query callback
  if (callbackData === 'verify_member' || callbackData === 'verify_subscription') {
    const userId = callbackQuery.from.id;
    const channel = process.env.AUTH_CHANNEL || '@botsxp';
    
    try {
      const member = await bot.getChatMember(channel, userId);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      
      if (isMember) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Verified successfully!' });
        await bot.editMessageText("🎉 Thank you for subscribing! Executing your pending task...", {
          chat_id: chatId,
          message_id: message.message_id
        }).catch(() => {});
        
        const task = pendingTasks.get(userId);
        if (task && task.execute) {
          pendingTasks.delete(userId);
          await task.execute();
        } else {
          await bot.sendMessage(chatId, 'Welcome! Send me a product URL to check its price history.', {
            reply_markup: { inline_keyboard: getMainMenuButtons() }
          });
        }
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ You still have not joined the channel.', show_alert: true });
      }
    } catch (err) {
      console.error('[verify_subscription error]', err.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error checking membership status.' });
    }
    return;
  }

  if (callbackData === 'help') {
    await bot.answerCallbackQuery(callbackQuery.id);
    const helpText = `🤖 *How To Use*\n\n` +
      `1. Copy any product link.\n` +
      `2. Send it here.\n` +
      `3. Instantly view:\n` +
      `✔ Price Graph\n` +
      `✔ Lowest Price\n` +
      `✔ Highest Price\n` +
      `✔ Average Price\n` +
      `✔ Buy Recommendation`;
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: getMainMenuButtons() } });
    return;
  }

  // Filter timeline: f:platform:pid:range
  if (callbackData.startsWith('f:')) {
    const parts = callbackData.split(':');
    const platform = parts[1];
    const pid = parts[2];
    const range = parts[3];
    
    await bot.answerCallbackQuery(callbackQuery.id, { text: `Filtering graph: ${range}` });
    await renderHistoryCard(chatId, platform, pid, range, message.message_id, false);
    return;
  }

  // Refresh data: r:platform:pid
  if (callbackData.startsWith('r:')) {
    const parts = callbackData.split(':');
    const platform = parts[1];
    const pid = parts[2];
    
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Refreshing price history...' });
    await renderHistoryCard(chatId, platform, pid, 'all', message.message_id, true);
    return;
  }
});

// Start database
db.initHistoryDatabase();
