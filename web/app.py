import os
import json
import urllib.request
import urllib.parse
import urllib.error
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Load env variables
load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')

# Points to the Node.js Express API scraper service
NODE_API_URL = os.environ.get('NODE_API_URL', 'http://localhost:3000')

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/deals")
def api_deals():
    try:
        base_url = NODE_API_URL.rstrip('/')
        query_string = request.query_string.decode('utf-8')
        target_url = f"{base_url}/api/deals"
        if query_string:
            target_url += f"?{query_string}"
            
        print(f"[Flask Proxy] Forwarding deals catalog request to Node API: {target_url}")
        
        req = urllib.request.Request(
            target_url,
            headers={'User-Agent': 'PriceGraph-Flask-Proxy/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())
            return jsonify(data)
            
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode())
            return jsonify(error_data), e.code
        except Exception:
            return jsonify({
                'success': False,
                'error': f'Node API returned HTTP error: {e.code} ({e.reason})'
            }), e.code
    except Exception as e:
        print(f"[Flask Proxy Error] {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to connect to Node.js scraper service: {str(e)}'
        }), 500

@app.route("/api/categories")
def api_categories():
    try:
        base_url = NODE_API_URL.rstrip('/')
        target_url = f"{base_url}/api/categories"
        
        print(f"[Flask Proxy] Forwarding categories request to Node API: {target_url}")
        
        req = urllib.request.Request(
            target_url,
            headers={'User-Agent': 'PriceGraph-Flask-Proxy/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            return jsonify(data)
            
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode())
            return jsonify(error_data), e.code
        except Exception:
            return jsonify({
                'success': False,
                'error': f'Node API returned HTTP error: {e.code} ({e.reason})'
            }), e.code
    except Exception as e:
        print(f"[Flask Proxy Error] {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to connect to Node.js scraper service: {str(e)}'
        }), 500

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
        # Construct path to Node.js API endpoint
        base_url = NODE_API_URL.rstrip('/')
        encoded_product_url = urllib.parse.quote(url)
        target_url = f"{base_url}/api/scrape?url={encoded_product_url}"
        
        print(f"[Flask Proxy] Forwarding scraping request to Node API: {target_url}")
        
        req = urllib.request.Request(
            target_url,
            headers={'User-Agent': 'PriceGraph-Flask-Proxy/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=25) as response:
            data = json.loads(response.read().decode())
            return jsonify(data)

    except urllib.error.HTTPError as e:
        # Handle Node API HTTP errors and pass them along
        try:
            error_data = json.loads(e.read().decode())
            return jsonify(error_data), e.code
        except Exception:
            return jsonify({
                'success': False,
                'error': f'Node API returned HTTP error: {e.code} ({e.reason})'
            }), e.code

    except Exception as e:
        print(f"[Flask Proxy Error] {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to connect to Node.js scraper service: {str(e)}'
        }), 500

# Info Pages Route definitions
@app.route("/privacy-policy")
def privacy_policy():
    title = "Privacy Policy"
    content = """
    <h2>Introduction</h2>
    <p>At Price Graph, we value your trust and are committed to protecting your privacy. This policy outlines how we handle and protect any data collected during your visit to pricegraph.in or through our Telegram bots.</p>
    <h2>Data Collection & Processing</h2>
    <p>We do not collect personally identifiable information unless explicitly provided by you. We only store product URLs and historical pricing details associated with alerts you request.</p>
    <h2>Cookies & Trackers</h2>
    <p>We use minimal cookie storage strictly for maintaining user sessions and tracking active filters.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/terms")
def terms():
    title = "Terms & Conditions"
    content = """
    <h2>Terms of Use</h2>
    <p>Welcome to Price Graph (pricegraph.in). By accessing our web application or Telegram bots, you agree to comply with and be bound by these terms.</p>
    <h2>Service Limitations</h2>
    <p>We crawl publicly available e-commerce listings to fetch pricing data. We do not guarantee the completeness or absolute accuracy of live deals and prices. Always double-check on the final store checkout page.</p>
    <h2>Intellectual Property</h2>
    <p>Amazon, Flipkart, Myntra, Ajio, Meesho, and Shopsy logos and brand names are trademarks of their respective owners.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/affiliate-policy")
def affiliate_policy():
    title = "Affiliate Policy"
    content = """
    <h2>Affiliate Links Disclosure</h2>
    <p>Price Graph is supported by its users. When you browse deals or set alerts on our platform, we automatically convert product links into affiliate links using store developer sub-networks.</p>
    <h2>Earnings & Pricing</h2>
    <p>Purchasing through an affiliate link does NOT increase the cost of your item. We earn a small percentage commission directly from the retailer, which helps us fund servers and crawlers.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/about")
def about():
    title = "About Price Graph"
    content = """
    <h2>Our Vision</h2>
    <p>Price Graph is India's premium e-commerce tracking hub. Our goal is to help shoppers bypass fake markups and find authentic historical lowest prices across major shopping destinations.</p>
    <h2>Core Technology</h2>
    <p>We utilize automated price scanners to map charts daily, giving you complete visualization of price histories over 1 month, 3 months, or maximum crawled duration.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/contact")
def contact():
    title = "Contact Us"
    content = """
    <h2>Get in Touch</h2>
    <p>Have questions, ideas, or feedback? Reach out to our team directly through our Telegram updates channel or support bots:</p>
    <ul>
      <li><strong>Support Bot:</strong> <a href="https://t.me/imovies_contact_bot" target="_blank">@imovies_contact_bot</a></li>
      <li><strong>Updates Channel:</strong> <a href="https://t.me/The_PriceHistory_Bot" target="_blank">@The_PriceHistory_Bot</a></li>
      <li><strong>Email:</strong> support@pricegraph.in</li>
    </ul>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/what-we-do")
def what_we_do():
    title = "What We Do"
    content = """
    <h2>Smart Shopping Assistance</h2>
    <p>We parse raw e-commerce listings and store them inside historical indices. Here is what Price Graph delivers:</p>
    <ul>
      <li><strong>Live Deal Scanner:</strong> Monitors thousands of products to find real drops and highlights hot deals.</li>
      <li><strong>Telegram Alerts:</strong> Sends instant Telegram messages the second your tracked items fall below your target price.</li>
      <li><strong>Historical Pricing:</strong> Shows interactive charts displaying average, highest, and optimal buying status.</li>
    </ul>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/how-we-earn")
def how_we_earn():
    title = "How We Earn"
    content = """
    <h2>Zero Subscription Fees</h2>
    <p>Our tools, charts, and bots are completely free to use. We do not require credit cards or premium memberships.</p>
    <h2>Referral Incentives</h2>
    <p>We maintain our servers entirely through affiliate partnership programs. When you click buy buttons or set alerts, a referral cookie helps us qualify for store developer commissions.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/supported-stores")
def supported_stores():
    title = "Supported Stores"
    content = """
    <h2>Indian E-Commerce Coverage</h2>
    <p>Price Graph actively tracks products on major platforms including:</p>
    <ul>
      <li><strong>Amazon India:</strong> Electronics, fashion, and home goods.</li>
      <li><strong>Flipkart:</strong> Electronics, appliances, and accessories.</li>
      <li><strong>Myntra & Ajio:</strong> Trend clothing, footwear, and cosmetics.</li>
      <li><strong>Shopsy & Meesho:</strong> Budget daily utility listings.</li>
    </ul>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/advertise")
def advertise():
    title = "Advertise With Us"
    content = """
    <h2>Reach Premium Shoppers</h2>
    <p>Price Graph helps thousands of value-conscious buyers find products. If you are a brand or merchant looking to promote deals, get in touch.</p>
    <p>Contact us via email: <strong>ads@pricegraph.in</strong> or write to our support desk.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/pricing-intelligence")
def pricing_intelligence():
    title = "Pricing Intelligence"
    content = """
    <h2>Advanced Pricing Dynamics</h2>
    <p>Our algorithms calculate optimal buy recommendations by analyzing price standard deviation, mean values, and recent drop levels.</p>
    <p>This allows shoppers to determine if current discounts represent a genuine drop or a temporary markup.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/amazon-tracker")
def amazon_tracker():
    title = "Amazon Price History Tracker"
    content = """
    <h2>Track Amazon India Prices</h2>
    <p>Paste any Amazon.in listing link in our search box above to fetch full statistics. We generate interactive charts so you can see if discounts are real before buying.</p>
    <p>You can also start our Telegram Bot to get notified immediately when prices drop.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/flipkart-tracker")
def flipkart_tracker():
    title = "Flipkart Price History Tracker"
    content = """
    <h2>Track Flipkart Listings</h2>
    <p>Monitor your favorite Flipkart products. We automatically track prices, filter fake discounts, and send alerts when deals go live.</p>
    """
    return render_template("info.html", title=title, content=content)

@app.route("/amazon-quiz")
def amazon_quiz():
    title = "Amazon Quiz Answers"
    content = """
    <h2>Daily Amazon Quiz Answers</h2>
    <p>Get instant verified answers for the daily Amazon FunZone quizzes to win exciting rewards, credits, and shopping vouchers.</p>
    """
    return render_template("info.html", title=title, content=content)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
