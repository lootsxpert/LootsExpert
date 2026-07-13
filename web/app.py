import os
import json
import urllib.request
import urllib.parse
import urllib.error
import ssl
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from werkzeug.security import generate_password_hash, check_password_hash
import cloudinary
import cloudinary.uploader
from werkzeug.utils import secure_filename
import time

# Configure SSL context to bypass verification for Railway internal API queries
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

# Load env variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.environ.get('SECRET_KEY', 'pricegraph_flask_session_secret_key_2026')

# Points to the Node.js Express API scraper service
NODE_API_URL = os.environ.get('NODE_API_URL', 'https://api-production-142c.up.railway.app/')

DATABASE_URL = os.environ.get('DATABASE_URL') or os.environ.get('DATABASE_PRIVATE_URL') or 'postgresql://postgres:yUAkumMqejYdHBijJxzmmRdmxrEKEiog@hayabusa.proxy.rlwy.net:42335/railway'

ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'PriceGraph@2026')

# Cloudinary Setup
CLOUDINARY_URL = os.environ.get('CLOUDINARY_URL')
if CLOUDINARY_URL:
    pass
else:
    cloudinary.config(
        cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME'),
        api_key = os.environ.get('CLOUDINARY_API_KEY'),
        api_secret = os.environ.get('CLOUDINARY_API_SECRET'),
        secure = True
    )

# Local Upload Fallback
UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def upload_image_helper(file):
    if not file:
        return None
    is_cloudinary_configured = (
        CLOUDINARY_URL is not None or 
        (os.environ.get('CLOUDINARY_CLOUD_NAME') is not None and 
         os.environ.get('CLOUDINARY_API_KEY') is not None)
    )
    if is_cloudinary_configured:
        try:
            upload_result = cloudinary.uploader.upload(file)
            return upload_result.get('secure_url')
        except Exception as e:
            print(f"[Cloudinary Upload Error] {str(e)}. Falling back to local storage.")
    try:
        filename = secure_filename(file.filename)
        filename = f"{int(time.time())}_{filename}"
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        return f"/static/uploads/{filename}"
    except Exception as e:
        print(f"[Local Upload Error] {str(e)}")
        return None

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Create web_users table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                profile_pic TEXT,
                recovery_question TEXT NOT NULL,
                recovery_answer_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        # Create web_watchlist table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_watchlist (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES web_users(id) ON DELETE CASCADE,
                platform VARCHAR(50) NOT NULL,
                product_id VARCHAR(100) NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                price DECIMAL(12, 2),
                image TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, platform, product_id)
            );
        """)
        
        # Create web_alerts table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_alerts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES web_users(id) ON DELETE CASCADE,
                platform VARCHAR(50) NOT NULL,
                product_id VARCHAR(100) NOT NULL,
                title TEXT NOT NULL,
                target_price DECIMAL(12, 2) NOT NULL,
                alert_type VARCHAR(50) DEFAULT 'price_drop',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        # Create web_notifications table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES web_users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create web_categories table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                description TEXT,
                image_url TEXT,
                icon_class VARCHAR(50) DEFAULT 'fa-solid fa-tag',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create web_supported_stores table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_supported_stores (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                logo_url TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create web_marquee_items table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_marquee_items (
                id SERIAL PRIMARY KEY,
                text VARCHAR(255) NOT NULL,
                logo_url TEXT,
                link VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create web_affiliate_configs table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_affiliate_configs (
                id SERIAL PRIMARY KEY,
                platform VARCHAR(100) UNIQUE NOT NULL,
                tag_value VARCHAR(255) NOT NULL,
                conversion_rate NUMERIC(5, 2) DEFAULT 2.00,
                commission_rate NUMERIC(5, 2) DEFAULT 5.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Create web_redirect_logs table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS web_redirect_logs (
                id SERIAL PRIMARY KEY,
                platform VARCHAR(100) NOT NULL,
                product_title TEXT,
                category VARCHAR(100),
                price NUMERIC(10, 2) DEFAULT 0.00,
                url TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Seed categories if empty
        cur.execute("SELECT COUNT(*) FROM web_categories")
        if cur.fetchone()[0] == 0:
            default_categories = [
                ('Mobiles', 'iPhones, Samsung Galaxy, OnePlus, and budget smartphones.', 'fa-solid fa-mobile-screen'),
                ('Laptops', 'Gaming laptops, MacBook, Ultrabooks, and school accessories.', 'fa-solid fa-laptop'),
                ('Electronics', 'Smart TVs, wireless speakers, smartwatches, and headphones.', 'fa-solid fa-plug'),
                ('Fashion', 'Men\'s and women\'s clothing, athletic shoes, and watches.', 'fa-solid fa-shirt'),
                ('Home Appliances', 'Refrigerators, washing machines, microwaves, and air conditioners.', 'fa-solid fa-fan'),
                ('Beauty & Care', 'Skincare products, perfumes, hair dryers, and cosmetics.', 'fa-solid fa-sparkles'),
                ('Furniture', 'Office chairs, study desks, sofas, and dining tables.', 'fa-solid fa-couch'),
                ('Kitchen', 'Mixer grinders, air fryers, water purifiers, and cookware.', 'fa-solid fa-blender')
            ]
            cur.executemany("INSERT INTO web_categories (name, description, icon_class) VALUES (%s, %s, %s)", default_categories)
            print("Seeded default categories!")

        # Seed stores if empty
        cur.execute("SELECT COUNT(*) FROM web_supported_stores")
        if cur.fetchone()[0] == 0:
            default_stores = [
                ('Flipkart', 'https://compare.buyhatke.com/images/site_icons_m/flipkart1.png'),
                ('Amazon', 'https://compare.buyhatke.com/images/site_icons_m/amazon.png'),
                ('Myntra', 'https://compare.buyhatke.com/images/site_icons_m/myntra.png'),
                ('Ajio', 'https://compare.buyhatke.com/images/site_icons_m/ajio.png'),
                ('Meesho', 'https://compare.buyhatke.com/images/site_icons_m/meesho.png'),
                ('Nykaa', 'https://compare.buyhatke.com/images/site_icons_m/nykaa.png'),
                ('Tata Cliq', 'https://compare.buyhatke.com/images/site_icons_m/tatacliq.png'),
                ('Ikea', 'https://compare.buyhatke.com/images/site_icons_m/ikea.png'),
                ('Apple', 'https://compare.buyhatke.com/images/site_icons_m/apple.png'),
                ('Jio Mart', 'https://compare.buyhatke.com/images/site_icons_m/jiomart.png'),
                ('MakeMyTrip', 'https://compare.buyhatke.com/images/site_icons_m/makemytrip.png'),
                ('Samsung', 'https://compare.buyhatke.com/images/site_icons_m/samsung.png'),
                ('BookMyShow', 'https://compare.buyhatke.com/images/site_icons_m/bookMyShow.png'),
                ('Croma', 'https://compare.buyhatke.com/images/site_icons_m/croma.png'),
                ('FirstCry', 'https://compare.buyhatke.com/images/site_icons_m/firstCry.png'),
                ('Decathlon', 'https://compare.buyhatke.com/images/site_icons_m/decathlon.png'),
                ('Lenskart', 'https://compare.buyhatke.com/images/site_icons_m/lenskart.png'),
                ('Redbus', 'https://compare.buyhatke.com/images/site_icons_m/redbus.png')
            ]
            cur.executemany("INSERT INTO web_supported_stores (name, logo_url) VALUES (%s, %s)", default_stores)
            print("Seeded default stores!")

        # Seed marquee items if empty
        cur.execute("SELECT COUNT(*) FROM web_marquee_items")
        if cur.fetchone()[0] == 0:
            default_marquees = [
                ('Amazon', 'https://compare.buyhatke.com/images/site_icons_m/amazon.png', '/deals?platform=Amazon'),
                ('Flipkart', 'https://compare.buyhatke.com/images/site_icons_m/flipkart1.png', '/deals?platform=Flipkart'),
                ('Myntra', 'https://compare.buyhatke.com/images/site_icons_m/myntra.png', '/deals?platform=Myntra'),
                ('Meesho', 'https://compare.buyhatke.com/images/site_icons_m/meesho.png', '/deals?platform=Meesho'),
                ('Croma', 'https://compare.buyhatke.com/images/site_icons_m/croma.png', '/deals?platform=Croma'),
                ('Ajio', 'https://compare.buyhatke.com/images/site_icons_m/ajio.png', '/deals?platform=Ajio'),
                ('Nykaa', 'https://compare.buyhatke.com/images/site_icons_m/nykaa.png', '/deals?platform=Nykaa'),
                ('Tata Cliq', 'https://compare.buyhatke.com/images/site_icons_m/tatacliq.png', '/deals?platform=TatacliQ')
            ]
            cur.executemany("INSERT INTO web_marquee_items (text, logo_url, link) VALUES (%s, %s, %s)", default_marquees)
            print("Seeded default marquee items!")

        # Seed default affiliate configurations if empty
        cur.execute("SELECT COUNT(*) FROM web_affiliate_configs")
        if cur.fetchone()[0] == 0:
            default_affiliates = [
                ('Amazon', 'pricegraph-21', 2.50, 4.00),
                ('Flipkart', 'pg-21', 2.00, 6.00),
                ('Myntra', 'myntra-pg', 2.00, 5.00),
                ('Ajio', 'ajio-pg', 1.80, 8.00),
                ('Meesho', 'meesho-pg', 3.00, 10.00),
                ('Nykaa', 'nykaa-pg', 2.20, 6.00)
            ]
            cur.executemany("INSERT INTO web_affiliate_configs (platform, tag_value, conversion_rate, commission_rate) VALUES (%s, %s, %s, %s)", default_affiliates)
            print("Seeded default affiliate configs!")
        
        conn.commit()
        cur.close()
        conn.close()
        print("🐘 [Flask DB] Database tables verified successfully.")
    except Exception as e:
        print(f"❌ [Flask DB Error] Failed to initialize database: {e}")

# Call DB init
init_db()


@app.route("/<path:target_url>")
def catch_all_url(target_url):
    print(f"[Catch-All Router] Received fallback URL path: {target_url}")
    
    # If the URL is written as pricegraph.in/https://www.amazon.in/..., the browser or Flask
    # merges double slashes to single slashes (https:/www.amazon.in/...). We reconstruct this.
    reconstructed_url = target_url
    if reconstructed_url.startswith("http:/") and not reconstructed_url.startswith("http://"):
        reconstructed_url = "http://" + reconstructed_url[6:]
    elif reconstructed_url.startswith("https:/") and not reconstructed_url.startswith("https://"):
        reconstructed_url = "https://" + reconstructed_url[7:]
    
    # Verify if it looks like a valid product URL
    url_lower = reconstructed_url.lower()
    supported_keywords = ["amazon", "flipkart", "myntra", "ajio", "meesho", "shopsy", "croma", "reliancedigital", "tatacliq", "nykaa"]
    
    if any(keyword in url_lower for keyword in supported_keywords):
        try:
            # Query db for marquee and categories just like homepage "/"
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            
            # Fetch marquee items
            cur.execute("SELECT text, link, logo_url FROM web_marquee_items ORDER BY id ASC")
            marquee_items = cur.fetchall()
            
            # Fetch supported stores
            cur.execute("SELECT name, logo_url FROM web_supported_stores ORDER BY name ASC")
            supported_stores = cur.fetchall()
            
            cur.close()
            conn.close()
        except Exception as e:
            print(f"[Catch-All Router Error] Database connection failed: {str(e)}")
            marquee_items = []
            supported_stores = []
            
        return render_template(
            "index.html", 
            marquee_items=marquee_items, 
            supported_stores=supported_stores, 
            auto_search_url=reconstructed_url
        )
    
    # If it is not a product link, redirect to home page
    return redirect("/")
@app.route("/")
def index():
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT name, logo_url FROM web_supported_stores ORDER BY name ASC")
        stores = cur.fetchall()
        cur.execute("SELECT text, logo_url, link FROM web_marquee_items ORDER BY created_at DESC")
        marquees = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[Database Error in index route] {str(e)}")
        stores = []
        marquees = []
        
    return render_template("index.html", supported_stores=stores, marquee_items=marquees)

@app.route("/app")
def bh_app():
    return render_template("myindex.html")

@app.route("/deals")
@app.route("/deal")
@app.route("/store")
@app.route("/store/")
def deals_catalog():
    return render_template("deals.html")

# Proxy route for Node.js API
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
        
        with urllib.request.urlopen(req, timeout=15, context=ssl_context) as response:
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
        
        with urllib.request.urlopen(req, timeout=10, context=ssl_context) as response:
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
        base_url = NODE_API_URL.rstrip('/')
        encoded_product_url = urllib.parse.quote(url)
        target_url = f"{base_url}/api/scrape?url={encoded_product_url}"
        
        print(f"[Flask Proxy] Forwarding scraping request to Node API: {target_url}")
        
        req = urllib.request.Request(
            target_url,
            headers={'User-Agent': 'PriceGraph-Flask-Proxy/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=25, context=ssl_context) as response:
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

# Auth Routes
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name")
        username = request.form.get("username")
        email = request.form.get("email")
        password = request.form.get("password")
        profile_pic = request.form.get("profile_pic", "")
        recovery_question = request.form.get("recovery_question")
        recovery_answer = request.form.get("recovery_answer")
        
        if not (name and username and email and password and recovery_question and recovery_answer):
            return render_template("register.html", error="All fields are required.")
            
        password_hash = generate_password_hash(password)
        recovery_answer_hash = generate_password_hash(recovery_answer.strip().lower())
        
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO web_users (name, username, email, password_hash, profile_pic, recovery_question, recovery_answer_hash)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (name, username, email, password_hash, profile_pic, recovery_question, recovery_answer_hash))
            conn.commit()
            cur.close()
            conn.close()
            return redirect(url_for("login", msg="Registration successful. Please login."))
        except psycopg2.IntegrityError:
            return render_template("register.html", error="Username or Email already exists.")
        except Exception as e:
            return render_template("register.html", error=f"Registration failed: {str(e)}")
            
    return render_template("register.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    msg = request.args.get("msg", "")
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        
        if not username or not password:
            return render_template("login.html", error="Username and password are required.")
            
        # Admin Login check
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session.clear()
            session['admin'] = True
            session['username'] = username
            return redirect(url_for("admin"))
            
        # User Login check
        try:
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT * FROM web_users WHERE username = %s LIMIT 1", (username,))
            user = cur.fetchone()
            cur.close()
            conn.close()
            
            if user and check_password_hash(user['password_hash'], password):
                session.clear()
                session['user_id'] = user['id']
                session['username'] = user['username']
                session['name'] = user['name']
                session['profile_pic'] = user['profile_pic'] or ''
                return redirect(url_for("dashboard"))
            else:
                return render_template("login.html", error="Invalid username or password.")
        except Exception as e:
            return render_template("login.html", error=f"Login error: {str(e)}")
            
    return render_template("login.html", msg=msg)

@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    step = request.form.get("step", "1")
    username = request.form.get("username")
    
    if request.method == "POST":
        if step == "1":
            if not username:
                return render_template("forgot_password.html", step="1", error="Username is required.")
            try:
                conn = get_db_connection()
                cur = conn.cursor(cursor_factory=RealDictCursor)
                cur.execute("SELECT recovery_question FROM web_users WHERE username = %s LIMIT 1", (username,))
                user = cur.fetchone()
                cur.close()
                conn.close()
                
                if user:
                    return render_template("forgot_password.html", step="2", username=username, question=user['recovery_question'])
                else:
                    return render_template("forgot_password.html", step="1", error="Username not found.")
            except Exception as e:
                return render_template("forgot_password.html", step="1", error=f"Error: {str(e)}")
                
        elif step == "2":
            recovery_answer = request.form.get("recovery_answer")
            new_password = request.form.get("new_password")
            
            if not recovery_answer or not new_password:
                return render_template("forgot_password.html", step="2", username=username, error="All fields are required.")
                
            try:
                conn = get_db_connection()
                cur = conn.cursor(cursor_factory=RealDictCursor)
                cur.execute("SELECT * FROM web_users WHERE username = %s LIMIT 1", (username,))
                user = cur.fetchone()
                
                if user and check_password_hash(user['recovery_answer_hash'], recovery_answer.strip().lower()):
                    new_hash = generate_password_hash(new_password)
                    cur.execute("UPDATE web_users SET password_hash = %s WHERE username = %s", (new_hash, username))
                    conn.commit()
                    cur.close()
                    conn.close()
                    return redirect(url_for("login", msg="Password reset successful. Please login."))
                else:
                    cur.close()
                    conn.close()
                    return render_template("forgot_password.html", step="2", username=username, question=user['recovery_question'] if user else "Question", error="Incorrect recovery answer.")
            except Exception as e:
                return render_template("forgot_password.html", step="2", username=username, error=f"Error: {str(e)}")
                
    return render_template("forgot_password.html", step="1")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

# User Dashboard
@app.route("/dashboard")
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for("login", msg="Please login to access the dashboard."))
        
    user_id = session['user_id']
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get user details
        cur.execute("SELECT * FROM web_users WHERE id = %s LIMIT 1", (user_id,))
        user = cur.fetchone()
        
        # Get watchlist
        cur.execute("SELECT * FROM web_watchlist WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        watchlist = cur.fetchall()
        
        # Get alerts
        cur.execute("SELECT * FROM web_alerts WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        alerts = cur.fetchall()
        
        # Get notifications
        cur.execute("SELECT * FROM web_notifications WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        notifications = cur.fetchall()
        
        cur.close()
        conn.close()
        
        return render_template("dashboard.html", user=user, watchlist=watchlist, alerts=alerts, notifications=notifications)
    except Exception as e:
        return f"Database Error: {str(e)}"

# Watchlist API Endpoints
@app.route("/api/watchlist/add", methods=["POST"])
def add_to_watchlist():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    data = request.json
    user_id = session['user_id']
    platform = data.get('platform')
    product_id = data.get('product_id')
    title = data.get('title')
    url = data.get('url')
    price = data.get('price')
    image = data.get('image')
    
    if not (platform and product_id and title and url):
        return jsonify({'success': False, 'error': 'Missing parameters'}), 400
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO web_watchlist (user_id, platform, product_id, title, url, price, image)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, platform, product_id) DO NOTHING
        """, (user_id, platform, product_id, title, url, price, image))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/watchlist/remove", methods=["POST"])
def remove_from_watchlist():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    data = request.json
    user_id = session['user_id']
    platform = data.get('platform')
    product_id = data.get('product_id')
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            DELETE FROM web_watchlist WHERE user_id = %s AND platform = %s AND product_id = %s
        """, (user_id, platform, product_id))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Alerts API Endpoints
@app.route("/api/alerts/add", methods=["POST"])
def add_alert():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    data = request.json
    user_id = session['user_id']
    platform = data.get('platform')
    product_id = data.get('product_id')
    title = data.get('title')
    target_price = data.get('target_price')
    alert_type = data.get('alert_type', 'price_drop')
    
    if not (platform and product_id and title and target_price):
        return jsonify({'success': False, 'error': 'Missing parameters'}), 400
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO web_alerts (user_id, platform, product_id, title, target_price, alert_type)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (user_id, platform, product_id, title, target_price, alert_type))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/alerts/delete", methods=["POST"])
def delete_alert():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    data = request.json
    user_id = session['user_id']
    alert_id = data.get('alert_id')
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM web_alerts WHERE id = %s AND user_id = %s", (alert_id, user_id))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/notifications/read", methods=["POST"])
def read_notifications():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    user_id = session['user_id']
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("UPDATE web_notifications SET is_read = TRUE WHERE user_id = %s", (user_id,))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/user/profile", methods=["POST"])
def update_profile():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        
    user_id = session['user_id']
    name = request.form.get("name")
    email = request.form.get("email")
    password = request.form.get("password")
    profile_pic = request.form.get("profile_pic", "")
    
    if not name or not email:
        return jsonify({'success': False, 'error': 'Name and Email are required.'}), 400
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        if password:
            password_hash = generate_password_hash(password)
            cur.execute("""
                UPDATE web_users SET name = %s, email = %s, profile_pic = %s, password_hash = %s WHERE id = %s
            """, (name, email, profile_pic, password_hash, user_id))
        else:
            cur.execute("""
                UPDATE web_users SET name = %s, email = %s, profile_pic = %s WHERE id = %s
            """, (name, email, profile_pic, user_id))
            
        conn.commit()
        cur.close()
        conn.close()
        
        session['name'] = name
        session['profile_pic'] = profile_pic
        
        return redirect(url_for("dashboard"))
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# Admin Panel
@app.route("/admin")
def admin():
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get users count and list
        cur.execute("SELECT id, name, username, email, created_at FROM web_users ORDER BY created_at DESC")
        users = cur.fetchall()
        
        # Get products count and list from telegram_products pool (we connect to same pool)
        cur.execute("SELECT id, platform, product_name, current_price, tracking_status FROM telegram_products ORDER BY created_at DESC LIMIT 50")
        products = cur.fetchall()
        
        # Get counts
        cur.execute("SELECT COUNT(*) FROM web_users")
        total_web_users = cur.fetchone()['count']
        
        cur.execute("SELECT COUNT(*) FROM telegram_products")
        total_products = cur.fetchone()['count']

        # Get categories, stores, and marquee items for admin panel management
        cur.execute("SELECT id, name, description, image_url, icon_class FROM web_categories ORDER BY name ASC")
        admin_categories = cur.fetchall()
        
        cur.execute("SELECT id, name, logo_url FROM web_supported_stores ORDER BY name ASC")
        admin_stores = cur.fetchall()
        
        cur.execute("SELECT id, text, logo_url, link FROM web_marquee_items ORDER BY created_at DESC")
        admin_marquees = cur.fetchall()

        # Get affiliate configs
        cur.execute("SELECT id, platform, tag_value, conversion_rate, commission_rate FROM web_affiliate_configs ORDER BY platform ASC")
        affiliate_configs = cur.fetchall()
        
        # Calculate totals from web_redirect_logs and join with configs for rates
        # Projected commission = SUM(click_price * (conversion_rate / 100) * (commission_rate / 100))
        # Projected referrals = SUM(conversion_rate / 100)
        cur.execute("""
            SELECT 
                COUNT(*)::integer as total_taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as total_referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as forecast_earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
        """)
        totals_row = cur.fetchone()
        
        # Format values to avoid decimal types passing directly
        totals = {
            'total_taps': totals_row['total_taps'] if totals_row else 0,
            'total_referrals': round(float(totals_row['total_referrals']), 1) if totals_row else 0.0,
            'forecast_earnings': round(float(totals_row['forecast_earnings']), 2) if totals_row else 0.0
        }
        
        # Day Breakdown
        cur.execute("""
            SELECT 
                TO_CHAR(l.created_at, 'YYYY-MM-DD') as period,
                COUNT(*)::integer as taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
            GROUP BY period
            ORDER BY period DESC
            LIMIT 30
        """)
        day_stats_raw = cur.fetchall()
        day_stats = [{
            'period': r['period'],
            'taps': r['taps'],
            'referrals': round(float(r['referrals']), 1),
            'earnings': round(float(r['earnings']), 2)
        } for r in day_stats_raw]
        
        # Month Breakdown
        cur.execute("""
            SELECT 
                TO_CHAR(l.created_at, 'YYYY-MM') as period,
                COUNT(*)::integer as taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
            GROUP BY period
            ORDER BY period DESC
        """)
        month_stats_raw = cur.fetchall()
        month_stats = [{
            'period': r['period'],
            'taps': r['taps'],
            'referrals': round(float(r['referrals']), 1),
            'earnings': round(float(r['earnings']), 2)
        } for r in month_stats_raw]
        
        # Year Breakdown
        cur.execute("""
            SELECT 
                TO_CHAR(l.created_at, 'YYYY') as period,
                COUNT(*)::integer as taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
            GROUP BY period
            ORDER BY period DESC
        """)
        year_stats_raw = cur.fetchall()
        year_stats = [{
            'period': r['period'],
            'taps': r['taps'],
            'referrals': round(float(r['referrals']), 1),
            'earnings': round(float(r['earnings']), 2)
        } for r in year_stats_raw]
        
        # Category Breakdown
        cur.execute("""
            SELECT 
                COALESCE(NULLIF(l.category, ''), 'Uncategorized') as period,
                COUNT(*)::integer as taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
            GROUP BY period
            ORDER BY taps DESC
        """)
        category_stats_raw = cur.fetchall()
        category_stats = [{
            'period': r['period'],
            'taps': r['taps'],
            'referrals': round(float(r['referrals']), 1),
            'earnings': round(float(r['earnings']), 2)
        } for r in category_stats_raw]
        
        # Product Breakdown
        cur.execute("""
            SELECT 
                COALESCE(NULLIF(l.product_title, ''), 'Unknown Product') as period,
                COUNT(*)::integer as taps,
                COALESCE(SUM(c.conversion_rate / 100.0), 0)::numeric as referrals,
                COALESCE(SUM(l.price * (c.conversion_rate / 100.0) * (c.commission_rate / 100.0)), 0)::numeric as earnings
            FROM web_redirect_logs l
            LEFT JOIN web_affiliate_configs c ON l.platform ILIKE c.platform
            GROUP BY period
            ORDER BY taps DESC
            LIMIT 15
        """)
        product_stats_raw = cur.fetchall()
        product_stats = [{
            'period': r['period'],
            'taps': r['taps'],
            'referrals': round(float(r['referrals']), 1),
            'earnings': round(float(r['earnings']), 2)
        } for r in product_stats_raw]
        
        cur.close()
        conn.close()
        
        return render_template(
            "admin.html", 
            users=users, 
            products=products, 
            total_users=total_web_users, 
            total_products=total_products,
            categories=admin_categories,
            stores=admin_stores,
            marquees=admin_marquees,
            affiliates=affiliate_configs,
            totals=totals,
            day_stats=day_stats,
            month_stats=month_stats,
            year_stats=year_stats,
            category_stats=category_stats,
            product_stats=product_stats,
            msg=request.args.get('msg'),
            error=request.args.get('error')
        )
    except Exception as e:
        return f"Database Error: {str(e)}"

# Info/Static Pages Routing
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

# PRD catalog pages
@app.route("/coupons")
def coupons():
    return render_template("coupons.html")

@app.route("/categories")
def categories():
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT name, description, image_url, icon_class FROM web_categories ORDER BY name ASC")
        cats = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[Database Error in categories route] {str(e)}")
        cats = []
        
    return render_template("categories.html", categories=cats)

@app.route("/brands")
def brands():
    return render_template("brands.html")

@app.route("/faq")
def faq():
    return render_template("faq.html")

@app.route("/product/<platform>/<pid>")
def product_details(platform, pid):
    return render_template("index.html", platform=platform, pid=pid)

@app.route("/maintenance")
def maintenance():
    return render_template("error.html", error_code="MAINTENANCE", error_title="System Maintenance", error_desc="We are updating our price crawling nodes. Check back in a few minutes!")


# ==============================================================================
# Admin Dynamic Management Endpoints (Categories, Stores, Marquee)
# ==============================================================================

@app.route("/admin/category/add", methods=["POST"])
def admin_category_add():
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
    
    name = request.form.get("name")
    description = request.form.get("description")
    icon_class = request.form.get("icon_class", "fa-solid fa-tag")
    file = request.files.get("image")
    
    if not name:
        return redirect(url_for("admin", error="Category name is required."))
        
    image_url = None
    if file and file.filename != '':
        image_url = upload_image_helper(file)
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO web_categories (name, description, image_url, icon_class) VALUES (%s, %s, %s, %s) ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, image_url = COALESCE(EXCLUDED.image_url, web_categories.image_url), icon_class = EXCLUDED.icon_class",
            (name, description, image_url, icon_class)
        )
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg=f"Category '{name}' added/updated successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"

@app.route("/admin/category/delete/<int:cat_id>", methods=["POST"])
def admin_category_delete(cat_id):
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM web_categories WHERE id = %s", (cat_id,))
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg="Category deleted successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"

@app.route("/admin/store/add", methods=["POST"])
def admin_store_add():
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    name = request.form.get("name")
    file = request.files.get("logo")
    
    if not name:
        return redirect(url_for("admin", error="Store name is required."))
    if not file or file.filename == '':
        return redirect(url_for("admin", error="Store logo image is required."))
        
    logo_url = upload_image_helper(file)
    if not logo_url:
        return redirect(url_for("admin", error="Failed to upload logo."))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO web_supported_stores (name, logo_url) VALUES (%s, %s) ON CONFLICT (name) DO UPDATE SET logo_url = EXCLUDED.logo_url",
            (name, logo_url)
        )
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg=f"Supported store '{name}' added successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"

@app.route("/admin/store/delete/<int:store_id>", methods=["POST"])
def admin_store_delete(store_id):
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM web_supported_stores WHERE id = %s", (store_id,))
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg="Supported store deleted successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"

@app.route("/admin/marquee/add", methods=["POST"])
def admin_marquee_add():
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    text = request.form.get("text")
    link = request.form.get("link")
    file = request.files.get("logo")
    
    if not text:
        return redirect(url_for("admin", error="Marquee text is required."))
        
    logo_url = None
    if file and file.filename != '':
        logo_url = upload_image_helper(file)
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO web_marquee_items (text, logo_url, link) VALUES (%s, %s, %s)",
            (text, logo_url, link)
        )
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg="Marquee item added successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"

@app.route("/admin/marquee/delete/<int:item_id>", methods=["POST"])
def admin_marquee_delete(item_id):
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM web_marquee_items WHERE id = %s", (item_id,))
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg="Marquee item deleted successfully!"))
    except Exception as e:
        return f"Database Error: {str(e)}"


# ==============================================================================
# Outbound Affiliate Redirect & Click-Tracking Telemetry
# ==============================================================================

@app.route("/redirect")
def outbound_redirect():
    target_url = request.args.get('url')
    platform = request.args.get('platform', 'General')
    title = request.args.get('title', '')
    category = request.args.get('category', '')
    price_val = request.args.get('price', '0.00')
    
    if not target_url:
        return "URL parameter is required. Usage: /redirect?url=...", 400
        
    try:
        import re
        price_cleaned = re.sub(r'[^\d.]', '', str(price_val))
        price = float(price_cleaned) if price_cleaned else 0.00
    except Exception:
        price = 0.00
        
    # Log the redirect click telemetry
    tag = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO web_redirect_logs (platform, product_title, category, price, url) VALUES (%s, %s, %s, %s, %s)",
            (platform, title, category, price, target_url)
        )
        
        # Query platform tag
        cur.execute("SELECT tag_value FROM web_affiliate_configs WHERE platform ILIKE %s", (platform,))
        row = cur.fetchone()
        tag = row[0] if row else None
        
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[Redirect Tracking Error] {str(e)}")
        
    # Build final url applying tag parameter
    final_url = target_url
    if tag:
        try:
            parsed_url = urllib.parse.urlparse(target_url)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            
            lower_platform = platform.lower()
            if 'amazon' in lower_platform:
                query_params['tag'] = [tag]
            elif 'flipkart' in lower_platform:
                query_params['affid'] = [tag]
            elif 'myntra' in lower_platform:
                query_params['utm_source'] = ['affiliate']
                query_params['utm_campaign'] = [tag]
            else:
                query_params['subid'] = [tag]
                
            new_query = urllib.parse.urlencode(query_params, doseq=True)
            final_url = urllib.parse.urlunparse((
                parsed_url.scheme,
                parsed_url.netloc,
                parsed_url.path,
                parsed_url.params,
                new_query,
                parsed_url.fragment
            ))
        except Exception as e:
            print(f"[Affiliate URL Injection Error] {str(e)}")
            
    return redirect(final_url)

@app.route("/admin/affiliate/save", methods=["POST"])
def admin_affiliate_save():
    if 'admin' not in session:
        return redirect(url_for("login", msg="Access restricted to administrator."))
        
    platform = request.form.get("platform")
    tag_value = request.form.get("tag_value")
    conv_rate = request.form.get("conversion_rate", "2.00")
    comm_rate = request.form.get("commission_rate", "5.00")
    
    if not platform or not tag_value:
        return redirect(url_for("admin", error="Platform and referral tag value are required.", tab="affiliate"))
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO web_affiliate_configs (platform, tag_value, conversion_rate, commission_rate) VALUES (%s, %s, %s, %s) ON CONFLICT (platform) DO UPDATE SET tag_value = EXCLUDED.tag_value, conversion_rate = EXCLUDED.conversion_rate, commission_rate = EXCLUDED.commission_rate",
            (platform, tag_value, float(conv_rate), float(comm_rate))
        )
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for("admin", msg=f"Affiliate config for {platform} saved successfully!", tab="affiliate"))
    except Exception as e:
        return redirect(url_for("admin", error=f"Database Error: {str(e)}", tab="affiliate"))

# Error pages routing
@app.errorhandler(404)
def page_not_found(e):
    return render_template("error.html", error_code="404", error_title="Page Not Found", error_desc="The page you are looking for does not exist or has been moved."), 404

@app.errorhandler(500)
def internal_server_error(e):
    return render_template("error.html", error_code="500", error_title="Internal Error", error_desc="A server error occurred. We are looking into it!"), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
