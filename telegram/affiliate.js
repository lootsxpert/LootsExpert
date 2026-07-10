const axios = require('axios');

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
      if (!this.tag) {
        console.warn('[Affiliate Service] Amazon Affiliate Tag is not configured in environment variables.');
        return url;
      }
      
      const parsed = new URL(url);
      
      // Update/Append the tag parameter
      parsed.searchParams.set('tag', this.tag);
      return parsed.toString();
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
      if (!this.apiKey) {
        console.warn('[Affiliate Service] EarnKaro API key (EARNKARO_API) is missing in environment variables. Falling back to original URL.');
        return url;
      }
      
      // Call EarnKaro Affiliate Link Conversion API endpoint
      // E.g., http://api.earnkaro.com/v1/convert?api_key=...&url=...
      const endpoint = `https://api.earnkaro.com/v1/convert`;
      console.log(`[Affiliate Service] Converting link for ${platform} via EarnKaro API...`);
      
      const response = await axios.get(endpoint, {
        params: {
          api_key: this.apiKey,
          url: url
        },
        timeout: 6000
      });
      
      if (response.data) {
        const affUrl = response.data.aff_url || response.data.converted_url || response.data.url;
        if (affUrl) {
          console.log(`[Affiliate Service] Link converted successfully: ${affUrl}`);
          return affUrl;
        }
      }
      
      console.log('[Affiliate Service] EarnKaro returned empty or unexpected structure. Returning original URL.');
      return url;
    } catch (err) {
      console.warn(`[Affiliate Service Warning] EarnKaro API call failed: ${err.message}. Gracefully falling back to original URL.`);
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
