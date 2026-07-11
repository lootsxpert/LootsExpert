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
    return render_template("privacy_policy.html")

@app.route("/terms")
def terms():
    return render_template("terms.html")

@app.route("/affiliate-policy")
def affiliate_policy():
    return render_template("affiliate_policy.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/contact")
def contact():
    return render_template("contact.html")

@app.route("/what-we-do")
def what_we_do():
    return render_template("what_we_do.html")

@app.route("/how-we-earn")
def how_we_earn():
    return render_template("how_we_earn.html")

@app.route("/supported-stores")
def supported_stores():
    return render_template("supported_stores.html")

@app.route("/advertise")
def advertise():
    return render_template("advertise.html")

@app.route("/pricing-intelligence")
def pricing_intelligence():
    return render_template("pricing_intelligence.html")

@app.route("/amazon-tracker")
def amazon_tracker():
    return render_template("amazon_tracker.html")

@app.route("/flipkart-tracker")
def flipkart_tracker():
    return render_template("flipkart_tracker.html")

@app.route("/amazon-quiz")
def amazon_quiz():
    return render_template("amazon_quiz.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
