console.log('🚀 [Launcher] Starting both LootsExpert Telegram Bots (Tracker & History) in a single process...');

// Load environment variables
require('dotenv').config();

// Require tracker bot
console.log('🤖 [Launcher] Launching Price Tracker Bot...');
require('./bot.js');

// Require history bot
console.log('📈 [Launcher] Launching Price History Bot...');
require('./history_bot.js');
