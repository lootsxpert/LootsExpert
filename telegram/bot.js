const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const scraperApiUrl = process.env.SCRAPER_API_URL || 'http://localhost:3000';

if (!token) {
  console.error('[Error] TELEGRAM_BOT_TOKEN is missing in the environment variables!');
  process.exit(1);
}

// Create a bot that uses polling
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Telegram LootsExpert Bot is starting up...');

// Help and Start command
bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `👋 Hello! I am the *LootsExpert Bot*.\n\n` +
    `Send me a Flipkart or Amazon India product link, and I will extract the latest price, image, rating, and details for you.\n\n` +
    `*How to use:*\n` +
    `Just paste a link like:\n` +
    `\`https://www.flipkart.com/...\` or \`https://www.amazon.in/...\``;

  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Listener for general messages containing URLs
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) {
    return;
  }

  // Regex to extract Flipkart or Amazon URL from text
  const urlRegex = /(https?:\/\/[^\s]+(?:flipkart\.com|amazon\.(?:in|com))[^\s]*)/i;
  const match = text.match(urlRegex);

  if (!match) {
    // If user sent a non-URL message, gently guide them
    return;
  }

  const productUrl = match[1];
  console.log(`[Bot] Received scraping request for URL: ${productUrl}`);

  // Send a temporary "thinking" message
  const statusMsg = await bot.sendMessage(chatId, '🔍 Analyzing product link... Please wait.', {
    reply_to_message_id: msg.message_id
  });

  try {
    // Query our Express Scraper API endpoint
    const response = await axios.get(`${scraperApiUrl}/api/scrape`, {
      params: { url: productUrl },
      timeout: 20000
    });

    const data = response.data;

    if (!data || !data.success) {
      await bot.deleteMessage(chatId, statusMsg.message_id);
      await bot.sendMessage(
        chatId, 
        `❌ *Failed to parse product details.*\nThis could be due to automated anti-bot blockages. Try configuring ScraperAPI or ScrapingBee keys.`, 
        { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
      );
      return;
    }

    // Format rich markdown message card
    let caption = `🛍️ *${data.platform} Product Details*\n\n` +
      `📌 *${data.title}*\n\n` +
      `💵 *Price:* ₹${Number(data.price).toLocaleString('en-IN')}\n`;

    if (data.originalPrice && data.originalPrice > data.price) {
      caption += `🏷️ *MRP:* ₹${Number(data.originalPrice).toLocaleString('en-IN')}\n` +
        `🔥 *Discount:* ${data.discount}\n`;
    }

    if (data.rating) {
      caption += `⭐️ *Rating:* ${data.rating} / 5\n`;
    }

    // Delete the "thinking" message before sending details
    await bot.deleteMessage(chatId, statusMsg.message_id);

    // Send product image if available, else send text
    if (data.image) {
      const opts = {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🛒 View Product', url: data.url }
          ]]
        },
        reply_to_message_id: msg.message_id
      };
      await bot.sendPhoto(chatId, data.image, opts);
    } else {
      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🛒 View Product', url: data.url }
          ]]
        },
        reply_to_message_id: msg.message_id
      };
      await bot.sendMessage(chatId, caption, opts);
    }

  } catch (error) {
    console.error('[Bot Error]', error.message);
    await bot.deleteMessage(chatId, statusMsg.message_id);
    
    let errMsg = `⚠️ *Error retrieving details.*\n`;
    if (error.response && error.response.data && error.response.data.error) {
      errMsg += `Reason: ${error.response.data.error}`;
    } else {
      errMsg += `Could not connect to the LootsExpert scraping API. Make sure the API backend is deployed and running.`;
    }

    await bot.sendMessage(chatId, errMsg, {
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id
    });
  }
});
