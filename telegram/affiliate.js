const axios = require('axios');
const db = require('./db');

class AffiliateService {
  constructor() {
    this.providers = {};
  }

  registerProvider(name, provider) {
    this.providers[name] = provider;
  }

  async convert(url, platform) {
    // Determine provider key
    let key = 'earnkaro'; // Default for Myntra, Flipkart, Ajio, Meesho, Shopsy
    if (platform === 'amazon') {
      key = 'amazon';
    }
    
    const provider = this.providers[key] || this.providers['default'];
    if (provider) {
      return provider.convert(url, platform);
    }
    return url;
  }
}

class AmazonAffiliateProvider {
  constructor(tag) {
    this.tag = tag;
  }

  async convert(url, platform) {
    try {
      let currentTag = this.tag;
      try {
        const res = await db.pool.query(
          "SELECT tag_value FROM web_affiliate_configs WHERE platform ILIKE 'Amazon' LIMIT 1"
        );
        if (res.rows.length > 0) {
          currentTag = res.rows[0].tag_value;
        }
      } catch (dbErr) {
        console.warn('[Affiliate Service] Failed to query Amazon tag from DB, using fallback/env:', dbErr.message);
      }

      if (!currentTag) {
        console.warn('[Affiliate Service] Amazon Affiliate Tag is not configured.');
        return url;
      }
      
      const parsed = new URL(url);
      
      // Update/Append the tag parameter
      parsed.searchParams.set('tag', currentTag);
      const affUrl = parsed.toString();
      console.log(`[Affiliate Service] Amazon Link Converted:\n  Original: ${url}\n  Affiliate: ${affUrl}`);
      return affUrl;
    } catch (e) {
      console.error('[Affiliate Service] Amazon Link conversion failed:', e.message);
      return url;
    }
  }
}

class EarnKaroAffiliateProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async convert(url, platform) {
    try {
      let currentKey = this.apiKey;
      try {
        const res = await db.pool.query(
          "SELECT tag_value FROM web_affiliate_configs WHERE platform ILIKE 'EarnKaro' LIMIT 1"
        );
        if (res.rows.length > 0) {
          currentKey = res.rows[0].tag_value;
        }
      } catch (dbErr) {
        console.warn('[Affiliate Service] Failed to query EarnKaro key from DB, using fallback/env:', dbErr.message);
      }

      if (!currentKey) {
        console.warn('[Affiliate Service] EarnKaro API key is missing. Falling back to original URL.');
        return url;
      }

      // Normalize Flipkart URLs to strip '/dl/' prefix so EarnKaro processes them correctly
      let targetUrl = url;
      if (platform === 'flipkart' || url.includes('flipkart.com')) {
        try {
          const parsed = new URL(url);
          let pathname = parsed.pathname;
          if (pathname.startsWith('/dl/')) {
            pathname = pathname.substring(3);
          } else if (pathname === '/dl') {
            pathname = '/';
          }
          let cleanUrl = `https://www.flipkart.com${pathname}`;
          const pid = parsed.searchParams.get('pid');
          if (pid) {
            cleanUrl += `?pid=${pid}`;
          }
          targetUrl = cleanUrl;
        } catch (e) {
          console.warn('[Affiliate Service] Failed to clean Flipkart URL, using original:', e.message);
        }
      }
      
      // Call EarnKaro Affiliate Link Conversion API endpoint
      const endpoint = `https://ekaro-api.affiliaters.in/api/converter/public`;
      console.log(`[Affiliate Service] Converting link for ${platform} via new EarnKaro API...`);
      
      const response = await axios.post(endpoint, {
        deal: targetUrl,
        convert_option: 'convert_only'
      }, {
        headers: {
          'Authorization': `Bearer ${currentKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 6000
      });
      
      if (response.data && response.data.success === 1 && response.data.data) {
        const affUrl = response.data.data.trim();
        if (affUrl && affUrl.startsWith('http')) {
          console.log(`[Affiliate Service] EarnKaro Link Converted:\n  Original: ${url}\n  Affiliate: ${affUrl}`);
          return affUrl;
        }
      }
      
      console.log('[Affiliate Service] New EarnKaro API returned empty or unsuccessful status. Returning original URL.');
      return url;
    } catch (err) {
      console.warn(`[Affiliate Service Warning] New EarnKaro API call failed: ${err.message}. Gracefully falling back to original URL.`);
      return url;
    }
  }
}

// Instantiate and register standard providers
const affiliateService = new AffiliateService();

// Amazon Associates Tag
const amazonTag = process.env.AMAZON_AFF_TAG || 'wishlink_923495-21'; // Set fallback as standard
affiliateService.registerProvider('amazon', new AmazonAffiliateProvider(amazonTag));

// EarnKaro Provider
const earnkaroApiKey = process.env.EARNKARO_API || '';
affiliateService.registerProvider('earnkaro', new EarnKaroAffiliateProvider(earnkaroApiKey));

module.exports = affiliateService;
