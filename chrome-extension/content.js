// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeProduct") {
    try {
      const data = scrapeProductDetails();
      sendResponse({ success: true, data });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

function scrapeProductDetails() {
  const url = window.location.href;
  let platform = 'Store';
  
  if (url.includes('shopsy.in') || url.includes('shopsy.com')) {
    platform = 'Shopsy';
  } else if (url.includes('flipkart.com')) {
    platform = 'Flipkart';
  }

  // Title Selectors
  let title = getText('.VU-ZEz') || 
              getText('span.B_NuCI') || 
              getText('h1');

  // Robust Price Scraper
  let priceText = '';
  // Try standard Flipkart/Shopsy selectors first
  const priceSelectors = [
    '.Nx95oM',
    '._30jeq3',
    '.dyC4b1',
    '._16v6WS'
  ];
  
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const txt = el.textContent.trim();
      if (txt.includes('₹') || /^\d+$/.test(txt.replace(/[^\d]/g, ''))) {
        priceText = txt;
        break;
      }
    }
  }

  // Fallback 1: Search for elements with ₹ symbol
  if (!priceText) {
    const elements = Array.from(document.querySelectorAll('span, div'));
    for (const el of elements) {
      // Find leaf elements containing ₹ and a valid price format
      if (el.children.length === 0 && el.textContent.includes('₹')) {
        const txt = el.textContent.trim();
        const num = txt.replace(/[^\d]/g, '');
        if (num && parseInt(num, 10) > 10 && parseInt(num, 10) < 500000) {
          // Verify it's not the original/MRP price (original price is usually smaller font, line-through)
          const isLineThrough = window.getComputedStyle(el).textDecoration.includes('line-through') || 
                               el.closest('del') || 
                               (el.parentElement && window.getComputedStyle(el.parentElement).textDecoration.includes('line-through'));
          if (!isLineThrough) {
            priceText = txt;
            break;
          }
        }
      }
    }
  }
  
  // Original Price / MRP Selectors
  let originalPriceText = '';
  const originalPriceSelectors = ['._3I9_ca', '.y31eF7'];
  for (const sel of originalPriceSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      originalPriceText = el.textContent.trim();
      break;
    }
  }

  // Fallback 2: Look for line-through elements
  if (!originalPriceText) {
    const strikeEls = Array.from(document.querySelectorAll('span, div, del'));
    for (const el of strikeEls) {
      const style = window.getComputedStyle(el);
      const isStrike = style.textDecoration.includes('line-through') || el.tagName === 'DEL';
      if (isStrike && el.textContent.includes('₹')) {
        originalPriceText = el.textContent.trim();
        break;
      }
    }
  }

  // Discount Selectors
  let discount = getText('._3Ay6Sb') || 
                 getText('.UkC1Ke') || 
                 '';
  
  if (!discount) {
    // Look for elements containing "% off" or "% OFF"
    const elements = Array.from(document.querySelectorAll('span, div'));
    for (const el of elements) {
      if (el.children.length === 0 && /% off/i.test(el.textContent)) {
        discount = el.textContent.trim();
        break;
      }
    }
  }

  // Image Selectors
  let image = '';
  const imgElement = document.querySelector('img._396cs4, img.CXW8mj, ._0DkuPH img, img.jzoTab');
  if (imgElement) {
    image = imgElement.src;
  } else {
    // Fallback: look for large product images
    const images = Array.from(document.querySelectorAll('img'));
    for (const img of images) {
      const src = img.src || '';
      if (src.includes('/image/') || src.includes('/blob/') || src.includes('prd-img') || src.includes('shopsy')) {
        image = src;
        break;
      }
    }
  }

  // Rating Selectors
  let ratingText = getText('div._3LWZlK') || 
                   getText('div.XQD0XM') || 
                   '';
  
  const rating = ratingText ? parseFloat(ratingText) : null;
  const price = parsePrice(priceText);
  const originalPrice = parsePrice(originalPriceText) || price;

  return {
    url,
    platform,
    title: title || document.title,
    price,
    originalPrice,
    discount,
    image,
    rating
  };
}

function getText(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}
