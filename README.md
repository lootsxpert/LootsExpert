# PriceTrack: E-Commerce Product Price Analyzer & Bot

PriceTrack is a monorepo containing a Python Flask web application, a Node.js Express API, and a Telegram bot that extracts and displays price details, ratings, images, and specifications for products from **Amazon India** and **Flipkart**.

---

## Folder Structure
- `web/`: A Python Flask web server serving the beautiful glassmorphic dark-mode dashboard. Includes its own BeautifulSoup4-based scraper.
- `api/`: An Express.js backend containing scraping endpoints and Cheerio parsers.
- `telegram/`: A Node.js Telegram Bot wrapper to parse links and return styled messages with product photos.

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
Create a `.env` file in the `web/` directory:
```env
PORT=5000

# Optional keys for bypassing bot detection in production
SCRAPERAPI_KEY=your_scraper_api_key
# SCRAPINGBEE_KEY=your_scraping_bee_key
# PROXY_URL=your_proxy_url
```

Create a `.env` file in the `api/` directory (if using the Node.js API separately):
```env
PORT=3000
SCRAPERAPI_KEY=your_scraper_api_key
```

Create a `.env` file in the `telegram/` directory:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SCRAPER_API_URL=http://localhost:5000  # Points to the Flask app (or Node API at port 3000)
```

### 3. Run the Services
Start the Flask Web App:
```bash
npm run start:web
# or
python3 web/app.py
```
The dashboard will be available at [http://localhost:5000](http://localhost:5000).

Start the Telegram Bot (in a separate terminal):
```bash
npm run start:telegram
```

---

## Anti-Bot Protection Integration
Amazon and Flipkart employ sophisticated anti-scraping systems. To bypass blocking:
1. **Direct Request (Default)**: Utilizes randomized headers and rotating User-Agents. Works well locally but might get blocked on server environments like Railway.
2. **ScraperAPI / ScrapingBee**: Strongly recommended for production. Simply provide `SCRAPERAPI_KEY` or `SCRAPINGBEE_KEY` in the `web/.env` or `api/.env` files. The scraping engines will automatically route requests through their proxy networks.

---

## Deploying to Railway

Railway allows you to deploy this entire monorepo as separate services using the provided `Procfile`:

1. **Connect your repository** to Railway.
2. Railway will detect the monorepo and build it using Nixpacks (which installs both Python and Node.js automatically).
3. **Web Service (Flask Dashboard & Scraper)**:
   - Start Command override: `web` process in Procfile (runs Gunicorn automatically)
   - Expose the PORT variable.
   - Set environment variables (`SCRAPERAPI_KEY` etc.) in Railway.
4. **Telegram Bot Worker Service**:
   - Create a second service from the same repo.
   - Start Command override: `npm run start:telegram`
   - Set the environment variables:
     - `TELEGRAM_BOT_TOKEN`
     - `SCRAPER_API_URL` (Point to your deployed Web Service URL, e.g. `https://your-flask-app.up.railway.app`)
