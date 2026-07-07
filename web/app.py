import os
import re
import json
import random
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Load env variables
load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# Rotated standard user agents
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
]

def get_random_headers():
    return {
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
    }

def clean_price(price_str):
    if not price_str:
        return None
    # Strip currency symbols, commas, and other characters
    cleaned = re.sub(r'[^\d.]', '', price_str)
    try:
        return float(cleaned)
    except ValueError:
        return None

def fetch_html(url):
    scraper_api_key = os.environ.get('SCRAPERAPI_KEY')
    scraping_bee_key = os.environ.get('SCRAPINGBEE_KEY')
    proxy_url = os.environ.get('PROXY_URL')

    headers = get_random_headers()
    proxies = None

    # Handle proxy service options
    if scraper_api_key:
        print(f"[Flask Scraper] Routing through ScraperAPI for: {url}")
        target_url = f"http://api.scraperapi.com?api_key={scraper_api_key}&url={url}"
        response = requests.get(target_url, timeout=20)
    elif scraping_bee_key:
        print(f"[Flask Scraper] Routing through ScrapingBee for: {url}")
        target_url = f"https://app.scrapingbee.com/api/v1/?api_key={scraping_bee_key}&url={url}&render_js=false"
        response = requests.get(target_url, timeout=20)
    elif proxy_url:
        print(f"[Flask Scraper] Routing through custom proxy: {proxy_url}")
        proxies = {
            'http': proxy_url,
            'https': proxy_url
        }
        response = requests.get(url, headers=headers, proxies=proxies, timeout=15)
    else:
        print(f"[Flask Scraper] Direct request to: {url}")
        response = requests.get(url, headers=headers, timeout=15)

    response.raise_for_status()
    return response.text

def parse_flipkart(soup, url):
    # Title Selectors
    title_el = soup.find(class_="VU-ZEz") or soup.find(class_="B_NuCI") or soup.find("h1")
    title = title_el.get_text().strip() if title_el else ""

    # Price Selectors
    price_el = soup.find(class_="Nx95oM") or soup.find(class_="_30jeq3") or soup.find(class_="dyC4b1")
    price_text = price_el.get_text().strip() if price_el else ""

    # MRP Selectors
    original_price_el = soup.find(class_="_3I9_ca") or soup.find(class_="y31eF7")
    original_price_text = original_price_el.get_text().strip() if original_price_el else ""

    # Discount
    discount_el = soup.find(class_="_3Ay6Sb") or soup.find(class_="UkC1Ke")
    discount = discount_el.get_text().strip() if discount_el else ""

    # Image
    image = ""
    img_el = soup.select_one("img._396cs4, img.CXW8mj, ._0DkuPH img")
    if img_el and img_el.get('src'):
        image = img_el.get('src')
    else:
        # Fallback search
        for img in soup.find_all('img'):
            src = img.get('src', '')
            if 'image' in src and 'logo' not in src and 'icon' not in src:
                image = src
                break

    # Rating
    rating_el = soup.select_one("div._3LWZlK, div.XQD0XM")
    rating = None
    if rating_el:
        try:
            rating = float(rating_el.get_text().strip())
        except ValueError:
            pass

    # Specs
    specs = []
    for row in soup.select("._14cfVK, ._3k-BhJ, tr.WPA15N"):
        key_el = row.select_one("._2w35w* , ._2lznT*, td:first-child")
        val_el = row.select_one("._31275* , ._1h59_c, td:last-child")
        if key_el and val_el:
            specs.append({
                'key': key_el.get_text().strip(),
                'value': val_el.get_text().strip()
            })

    return {
        'success': True,
        'platform': 'Flipkart',
        'title': title,
        'price': clean_price(price_text),
        'originalPrice': clean_price(original_price_text),
        'discount': discount,
        'currency': '₹',
        'image': image,
        'rating': rating,
        'url': url,
        'specs': specs[:10]
    }

def parse_amazon(soup, url):
    # Title
    title_el = soup.find(id="productTitle")
    title = title_el.get_text().strip() if title_el else ""

    # Price Selector List
    price_selectors = [
        ".a-price-whole",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        ".apexPriceToPay span.a-offscreen",
        "#corePriceDisplay_desktop_feature_div .a-price-whole",
        "#corePrice_feature_div .a-price-whole"
    ]
    price_text = ""
    for selector in price_selectors:
        price_el = soup.select_one(selector)
        if price_el:
            price_text = price_el.get_text().strip()
            break

    # Original Price Selectors
    mrp_selectors = [
        ".a-line-through span.a-offscreen",
        "#basisPriceValue",
        ".basisPrice .a-offscreen",
        "#price .a-text-strike"
    ]
    original_price_text = ""
    for selector in mrp_selectors:
        mrp_el = soup.select_one(selector)
        if mrp_el:
            original_price_text = mrp_el.get_text().strip()
            break

    # Discount
    discount_selectors = [
        ".savingPercent",
        "#corePriceDisplay_desktop_feature_div .savingPercent",
        "#corePrice_feature_div .savingPercent"
    ]
    discount = ""
    for selector in discount_selectors:
        discount_el = soup.select_one(selector)
        if discount_el:
            discount = discount_el.get_text().strip().replace("-", "")
            break

    # Image
    image = ""
    landing_img = soup.find(id="landingImage")
    if landing_img:
        dyn_img = landing_img.get('data-a-dynamic-image')
        if dyn_img:
            try:
                # Parsed from json mapping image size -> resolution
                img_dict = json.loads(dyn_img)
                image = list(img_dict.keys())[0]
            except Exception:
                image = landing_img.get('src')
        else:
            image = landing_img.get('src')
            
    if not image:
        img_el = soup.find(id="imgBlkFront") or soup.select_one("#main-image-container img") or soup.select_one(".a-dynamic-image")
        if img_el:
            image = img_el.get('src')

    # Rating
    rating_el = soup.select_one(".a-icon-alt") or soup.select_one("i.a-icon-star span")
    rating = None
    if rating_el:
        rating_text = rating_el.get_text().strip()
        match = re.search(r'([0-9.]+)\s*out\s*of', rating_text, re.IGNORECASE) or re.search(r'([0-9.]+)\s*stars', rating_text, re.IGNORECASE) or re.search(r'([0-9.]+)', rating_text)
        if match:
            try:
                rating = float(match.group(1))
            except ValueError:
                pass

    # Specs
    specs = []
    for row in soup.select("#prodDetails table tr"):
        key = row.find('th')
        val = row.find('td')
        if key and val:
            specs.append({
                'key': key.get_text().strip(),
                'value': val.get_text().strip()
            })

    if not specs:
        for row in soup.select("#technicalSpecifications_section_1 tr"):
            key = row.select_one(".label")
            val = row.select_one(".value")
            if key and val:
                specs.append({
                    'key': key.get_text().strip(),
                    'value': val.get_text().strip()
                })

    parsed_price = clean_price(price_text)
    parsed_mrp = clean_price(original_price_text)

    # Calculate discount manually if missing
    if parsed_price and parsed_mrp and parsed_mrp > parsed_price and not discount:
        percent = round(((parsed_mrp - parsed_price) / parsed_mrp) * 100)
        discount = f"{percent}% off"

    return {
        'success': True,
        'platform': 'Amazon',
        'title': title,
        'price': parsed_price,
        'originalPrice': parsed_mrp or parsed_price,
        'discount': discount or '0%',
        'currency': '₹',
        'image': image,
        'rating': rating,
        'url': url,
        'specs': specs[:10]
    }

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/scrape")
def api_scrape():
    url = request.args.get('url')
    if not url:
        return jsonify({
            'success': False,
            'error': 'Product URL is required. Query parameter ?url=...'
        }), 400

    if not url.startswith('http://') and not url.startswith('https://'):
        return jsonify({
            'success': False,
            'error': 'Invalid URL format. URL must start with http:// or https://'
        }), 400

    try:
        html = fetch_html(url)
        soup = BeautifulSoup(html, 'html.parser')

        if 'flipkart.com' in url:
            data = parse_flipkart(soup, url)
            if not data.get('title'):
                return jsonify({
                    'success': False,
                    'error': 'Failed to parse Flipkart product details. Automated anti-bot block suspected.'
                }), 500
            return jsonify(data)
            
        elif 'amazon.in' in url or 'amazon.com' in url:
            data = parse_amazon(soup, url)
            if not data.get('title'):
                return jsonify({
                    'success': False,
                    'error': 'Failed to parse Amazon product details. Automated anti-bot block suspected.'
                }), 500
            return jsonify(data)
            
        else:
            return jsonify({
                'success': False,
                'error': 'Unsupported platform. Only Flipkart and Amazon URLs are supported.'
            }), 400

    except Exception as e:
        print(f"[Error Scrape Endpoint] {str(e)}")
        return jsonify({
            'success': False,
            'error': f'An error occurred: {str(e)}'
        }), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
