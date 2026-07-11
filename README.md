# Price Graph: Centralized E-Commerce Price Tracker

Price Graph is a monorepo containing a Python Flask web application, a Node.js Express scraping API, and a Telegram bot that extracts and displays price details, ratings, images, and specifications for products from **Amazon India** and **Flipkart**.

---

## Architecture
Both the **Price Graph Flask Web Client** and the **Telegram Bot** query a centralized **Node.js Express API** which handles all the scraping, parsing, and anti-bot mitigation logic.

```
                  ┌──────────────────────┐
                  │  Flask Web Client    │
                   │  (Price Graph UI)   │
                  └──────────┬───────────┘
                             │ (urllib Proxy)
                             ▼
┌──────────────┐  /api/scrape  ┌──────────────────────┐
│ Telegram Bot ├──────────────>│ Node.js Scraper API  │
└──────────────┘               └──────────┬───────────┘
                                          │ (Axios/Cheerio)
                                          ▼
                               ┌──────────────────────┐
                               │  Amazon / Flipkart   │
                               └──────────────────────┘
```

---

## Folder Structure
- `api/`: Centralized Node.js scraping backend (Express, Axios, Cheerio). Exposes scraping endpoint.
- `web/`: A Python Flask web server serving the glassmorphic dashboard. Proxies scraper requests to the Node.js API.
- `telegram/`: A Node.js Telegram Bot that queries the Node.js API and replies to messages containing product links.

---

## Getting Started Locally

### 1. Install Dependencies
Install Node.js dependencies for the API and Telegram Bot from the root directory:
```bash
npm install
```

Install Python dependencies for the Flask Web app:
```bash
pip install -r web/requirements.txt
```

### 2. Configure Environment Variables
Create a `.env` file in the `api/` directory:
```env
PORT=3000

# Optional keys for bypassing bot detection in production
SCRAPERAPI_KEY=your_scraper_api_key
# SCRAPINGBEE_KEY=your_scraping_bee_key
# PROXY_URL=your_proxy_url
```

Create a `.env` file in the `web/` directory:
```env
PORT=5000
NODE_API_URL=http://localhost:3000
```

Create a `.env` file in the `telegram/` directory:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SCRAPER_API_URL=http://localhost:3000
```

### 3. Run the Services
Start the Express Scraper API (port 3000):
```bash
npm run start:api
```

Start the Flask Web App (port 5000):
```bash
npm run start:web
```
The dashboard is now available at [http://localhost:5000](http://localhost:5000).

Start the Telegram Bot (in a separate terminal):
```bash
npm run start:telegram
```

---

## Anti-Bot Protection Integration
Amazon and Flipkart employ sophisticated anti-scraping systems. To bypass blocking, configure one of the following variables in `api/.env`:
- `SCRAPERAPI_KEY`
- `SCRAPINGBEE_KEY`
- `PROXY_URL`

The Node.js scraper will automatically route all requests through their proxy networks.

---

## Deploying to Railway

Railway allows you to deploy this entire monorepo as separate services using the provided `Procfile`:

1. **Connect your repository** to Railway.
2. **Node.js Scraper API Service**:
   - Start Command override: `npm run start:api`
   - Expose the PORT variable (default: `3000`).
   - Add environmental variables (`SCRAPERAPI_KEY`, etc.).
3. **Price Graph Flask Web Client**:
   - Start Command override: `web` process in Procfile (runs Gunicorn automatically)
   - Expose the PORT variable (default: `5000`).
   - Add environmental variable `NODE_API_URL` pointing to your deployed Scraper API Service.
4. **Price Graph Telegram Bot**:
   - Create a third service from the same repo.
   - Start Command override: `npm run start:telegram`
   - Add environmental variables: `TELEGRAM_BOT_TOKEN` and `SCRAPER_API_URL` (pointing to your Scraper API Service).
