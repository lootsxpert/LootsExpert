const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();
const https = require('https');
const http = require('http');
const urlModule = require('url');

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
let scraperApiUrl = process.env.SCRAPER_API_URL || process.env.NODE_API_URL || 'https://api-production-142c.up.railway.app';
if (scraperApiUrl.endsWith('/')) {
  scraperApiUrl = scraperApiUrl.slice(0, -1);
}

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
const activeBroadcasts = new Map();


// Helper: Verify subscription and execute task

// Helper: Check if user is banned
async function isUserBanned(chatId) {
  try {
    const user = await db.getHistoryUser(chatId);
    return user?.is_banned === true;
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
  
  // Clean up and default limit to last 3 months to prevent messy/crowded graph
  const defaultLimitDate = new Date();
  defaultLimitDate.setMonth(defaultLimitDate.getMonth() - 3);
  
  if (range === '1m') {
    const limitDate = new Date(now.setDate(now.getDate() - 30));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  } else if (range === '3m') {
    const limitDate = new Date(now.setDate(now.getDate() - 90));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  } else if (range === '6m') {
    const limitDate = new Date(now.setDate(now.getDate() - 180));
    filtered = filtered.filter(p => new Date(p.date) >= limitDate);
  } else {
    // Default to last 3 months for all/other ranges to keep graph clean
    filtered = filtered.filter(p => new Date(p.date) >= defaultLimitDate);
  }

  // Fallback if filter left no points
  if (filtered.length === 0) {
    filtered = historyPoints;
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const labels = filtered.map(p => {
    const d = new Date(p.date);
    return `${d.getDate()} ${monthNames[d.getMonth()]}`;
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
        text: productName.substring(0, 32) + '... History Trend',
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

  return `https://quickchart.io/chart?w=600&h=350&bkg=ffffff&f=jpg&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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
      // Cache price history results for 15 days
      const cacheTTL = parseInt(process.env.CACHE_TIME) || 1296000;
      await db.saveHistoryCache(platform, pid, data, cacheTTL);
    }
    return data;
  }
  throw new Error('Failed to retrieve history from Central Scraper API.');
}

// Render Result Card for User
async function renderHistoryCard(chatId, platform, pid, range = 'all', editMessageId = null, refreshData = false, originalUserUrl = '') {
  let resultMsg = null;
  let extraMsgs = [];
  let timer1 = null;
  let timer2 = null;

  // Deletion/Cleanup helper
  async function cleanupProgress() {
    clearTimeout(timer1);
    clearTimeout(timer2);
    if (editMessageId) {
      await bot.deleteMessage(chatId, editMessageId).catch(() => {});
    }
    if (resultMsg) {
      await bot.deleteMessage(chatId, resultMsg.message_id).catch(() => {});
    }
    for (const m of extraMsgs) {
      if (m) {
        await bot.deleteMessage(chatId, m.message_id).catch(() => {});
      }
    }
  }

  try {
    if (editMessageId) {
      await bot.editMessageText('⏳ Generating Graph & Recommendation...', { chat_id: chatId, message_id: editMessageId }).catch(() => {});
    } else {
      resultMsg = await bot.sendMessage(chatId, '🔍 Finding Product...\n📈 Fetching Price History...');
    }

    // Set up status timers
    if (!editMessageId) {
      timer1 = setTimeout(async () => {
        try {
          const statusText = `⏳ *Scraping is taking a bit longer than expected...*\n\nWe are still compiling the price graph. Please wait a moment while we compile the details...`;
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
    }

    if (refreshData) {
      await db.clearHistoryCache(platform, pid);
    }

    let data;
    try {
      data = await fetchProductHistory(platform, pid, originalUserUrl);
    } catch (err) {
      console.log('[History Bot Fetch] First attempt failed. Retrying...');
      await new Promise(resolve => setTimeout(resolve, 6000));
      try {
        data = await fetchProductHistory(platform, pid, originalUserUrl);
      } catch (retryErr) {
        throw retryErr;
      }
    }
    const history = data.history || [];
    
    if (history.length === 0) {
      const msgText = `⚠ *No historical price data is available for this product yet.*\n\n` +
        `Current Price: ₹${parseFloat(data.price).toLocaleString('en-IN')}`;
      await cleanupProgress();
      await bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
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
    const affiliateUrl = await affiliate.convert(data.url || `https://www.amazon.in/dp/${pid}`, platform);
    const textCaption = `🏷 <a href="${affiliateUrl}"><b>${escapeHTML(data.title)}</b></a>\n\n` +
      `💰 <b>Current :</b> ₹${currentPrice.toLocaleString('en-IN')}\n` +
      `📉 <b>Lowest :</b> ₹${lowestPrice.toLocaleString('en-IN')}\n` +
      `📈 <b>Highest :</b> ₹${highestPrice.toLocaleString('en-IN')}\n` +
      `📊 <b>Average :</b> ₹${averagePrice.toLocaleString('en-IN')}\n` +
      `🔥 <b>Drop From Peak :</b> ${dropFromPeak}%\n\n` +
      `🛍 <b>Recommendation</b>\n` +
      `${rec.color} <b>${escapeHTML(rec.text)}</b>\n<i>${escapeHTML(rec.details)}</i>`;

    // Inline buttons for timeline filters & buy now
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
      ]
    ];

    const chartUrl = generateChartUrl(history, range, data.title);
    
    // Merge product image and graph using the QuickChart Watermark API
    const finalChartUrl = chartUrl;

    // Send photo or edit existing photo message
    await cleanupProgress();

    try {
      console.log('[History Bot] Downloading consolidated watermark chart image buffer...');
      const imgRes = await axios.get(finalChartUrl, { responseType: 'arraybuffer', timeout: 8000 });
      const imageBuffer = Buffer.from(imgRes.data, 'binary');
      
      await bot.sendPhoto(chatId, imageBuffer, {
        caption: textCaption,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineKeyboard }
      }, {
        filename: 'chart.jpg',
        contentType: 'image/jpeg'
      });
    } catch (sendErr) {
      console.error('[Consolidated Send Error, falling back to plain chart buffer]', sendErr.message);
      try {
        const plainRes = await axios.get(chartUrl, { responseType: 'arraybuffer', timeout: 8000 });
        const plainBuffer = Buffer.from(plainRes.data, 'binary');
        await bot.sendPhoto(chatId, plainBuffer, {
          caption: textCaption,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        }, {
          filename: 'chart.jpg',
          contentType: 'image/jpeg'
        });
      } catch (fallbackErr) {
        console.error('[Fallback Chart Send Error]', fallbackErr.message);
        // Last-resort fallback: send URL directly (in case axios fails but Telegram can fetch)
        await bot.sendPhoto(chatId, chartUrl, {
          caption: textCaption,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        }).catch(() => {});
      }
    }

  } catch (err) {
    console.error('[History Card Render Error]', err.message);
    const errMsg = `❌ *Scraping Failed*\n\nUnable to fetch price history at the moment.\n\nPlease try again later.`;
    await cleanupProgress();
    await bot.sendMessage(chatId, errMsg, { parse_mode: 'Markdown' });
  }
}

// Command: /start (including deep linking support)
bot.onText(/^\/start(?: (.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const deepLink = match[1];

  if (await isUserBanned(chatId)) return;

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

// Command: /about
bot.onText(/\/about/, async (msg) => {
  await verifyUserAndExecute(msg, 'about', {}, async () => {
    const aboutText = `ℹ *About Price History Bot*\n\n` +
      `• *Version:* 1.0\n` +
      `• *Supported Stores:* Amazon, Flipkart, Myntra, Ajio, Meesho, Shopsy, Croma, TataCliq, Reliance Digital, Nykaa, and more.\n` +
      `• *Developer:* Price Graph Devs\n\n` +
      `Fetches live price history charts dynamically using high-fidelity scraping coordinate systems.`;

    await bot.sendMessage(msg.chat.id, aboutText, { parse_mode: 'Markdown' });
  });
});

// Command: /stats (Admin)
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  try {
    const stats = await db.getAdminDashboardStats();
    if (stats) {
      const statsText = `📊 *Price History Bot Stats*\n\n` +
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

// Command: /cache_clear (Admin)
bot.onText(/\/cache_clear/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const count = await db.clearHistoryCache();
  await bot.sendMessage(chatId, `🧹 Cache cleared successfully. Removed ${count} items.`);
});

// Command: /ban <userId> (Admin)
bot.onText(/^\/ban(?:[_ ]?([0-9]+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const targetId = match[1];
  const user = await db.banUser(targetId);
  if (user) {
    await bot.sendMessage(chatId, `✅ User ${targetId} has been banned.`);
  } else {
    await bot.sendMessage(chatId, `⚠️ User ${targetId} not found.`);
  }
});

// Command: /unban <userId> (Admin)
bot.onText(/^\/unban(?:[_ ]?([0-9]+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const targetId = match[1];
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

  activeBroadcasts.set(chatId, { state: 'awaiting_content' });
  await bot.sendMessage(chatId, `🎙 *Broadcast Mode Enabled*\n\nSend the message (text, photo, or video with caption) that you want to broadcast to all users next.\n\n_You do not need to reply to this message. Just send it._`, { parse_mode: 'Markdown' });
});


// Anti-spam rate limiting map
const userRateLimits = new Map();

// Message Listener for product URLs
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption;
  
  // Check if banned
  if (await isUserBanned(chatId)) {
    if (!isAdmin(chatId)) {
      await bot.sendMessage(chatId, '❌ You have been banned from using this bot by the administrator.');
      return;
    }
  }

  // Anti-spam check
  const userId = msg.from?.id;
  if (userId && !isAdmin(chatId)) {
    const now = Date.now();
    if (!userRateLimits.has(userId)) {
      userRateLimits.set(userId, []);
    }
    const timestamps = userRateLimits.get(userId);
    const recent = timestamps.filter(t => now - t < 10000);
    recent.push(now);
    userRateLimits.set(userId, recent);
    
    if (recent.length > 5) {
      await bot.sendMessage(chatId, '⚠️ *Anti-Spam System:* You are sending too many messages. Please wait 10 seconds before trying again.', { parse_mode: 'Markdown' });
      return;
    }
  }

  // Save history user immediately on any interaction
  await db.saveHistoryUser(chatId, msg.from?.first_name || '', msg.from?.username || '').catch(() => {});

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

  if (!text || text.startsWith('/')) return;

  const urlRegex = /(https?:\/[^\s]+)/gi;
  const matches = text.match(urlRegex);
  
  if (!matches) {
    // Help fallback if no URL in simple text
    const helpText = `🤖 *How To Use*\n\n` +
      `1. Copy any product link.\n` +
      `2. Send it here.\n` +
      `3. Instantly view price graph.`;
    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: getMainMenuButtons() } });
    return;
  }

  const productUrl = matches[0];
  let resolvedUrl = productUrl;
  const urlLower = productUrl.toLowerCase();
  const isShort = !urlLower.includes('amazon.in') && !urlLower.includes('flipkart.com') && 
                  !urlLower.includes('shopsy.in') && !urlLower.includes('myntra.com') && 
                  !urlLower.includes('ajio.com') && !urlLower.includes('meesho.com') &&
                  !urlLower.includes('croma.com') && !urlLower.includes('tatacliq.com') &&
                  !urlLower.includes('reliancedigital.in') && !urlLower.includes('nykaa.com');
                  
  if (isShort) {
    const statusMsg = await bot.sendMessage(chatId, '🔍 Resolving link...');
    resolvedUrl = await expandUrl(productUrl);
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
  }
  const detected = detectPlatformAndPid(resolvedUrl);
  
  await verifyUserAndExecute(msg, 'check_history', { url: resolvedUrl, detected: detected }, async () => {
    if (!detected) {
      await bot.sendMessage(chatId, '❌ This shopping platform is currently not supported.', {
        reply_markup: { inline_keyboard: getMainMenuButtons() }
      });
      return;
    }

    const { platform, pid } = detected;
    await renderHistoryCard(chatId, platform, pid, 'all', null, false, resolvedUrl);
  });
});

// Callback Query Handler (buttons clicks)
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
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId, `📢 *Broadcast completed*\n\n• Success: ${success}\n• Failed: ${failed}`, {
        parse_mode: 'Markdown'
      });
      return;
    }
  }

  // Verify membership query callback
  if (callbackData === 'verify_member' || callbackData === 'verify_subscription') {
    const userId = callbackQuery.from.id;
    const channel = "-1003849048564";
    
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
