const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { scrapeProduct } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all domains so local dev is easy
app.use(cors());
app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Endpoint: Scrape product details
app.get('/api/scrape', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Product URL is required. Query parameter ?url=...'
    });
  }

  // Basic URL format validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format. URL must start with http:// or https://'
    });
  }

  try {
    const result = await scrapeProduct(url);
    if (!result.success) {
      return res.status(500).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[Server Error]', err);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred: ' + err.message
    });
  }
});

// Serve frontend web client as static assets
app.use(express.static(path.join(__dirname, '../web')));

// Fallback to index.html for single page app router style
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 PriceTrack API running on: http://localhost:${PORT}`);
  console.log(`📦 Serving web assets from: ${path.join(__dirname, '../web')}`);
  console.log(`==================================================`);
});
