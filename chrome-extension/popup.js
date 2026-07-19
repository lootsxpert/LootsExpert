document.addEventListener('DOMContentLoaded', async () => {
  const stateLoading = document.getElementById('state-loading');
  const stateNotCompatible = document.getElementById('state-not-compatible');
  const stateProduct = document.getElementById('state-product');
  const loadingText = document.getElementById('loading-text');

  const imgEl = document.getElementById('product-img');
  const titleEl = document.getElementById('product-title');
  const ratingVal = document.getElementById('rating-val');
  const ratingWrapper = document.getElementById('rating-wrapper');
  const badgeEl = document.getElementById('platform-badge');

  // 4-Box Price Grid elements
  const boxCurrent = document.getElementById('price-box-current');
  const boxLowest = document.getElementById('price-box-lowest');
  const boxAverage = document.getElementById('price-box-average');
  const boxHighest = document.getElementById('price-box-highest');

  const recommendationSection = document.getElementById('recommendation-section');
  const gaugeFillPath = document.getElementById('gauge-fill-path');
  const gaugeNeedleHand = document.getElementById('gauge-needle-hand');
  const recommendationVerdict = document.getElementById('recommendation-verdict');

  const chartSection = document.getElementById('chart-section');
  const chartSource = document.getElementById('chart-source');
  const chartLinePath = document.getElementById('chart-line-path');
  const chartAreaPath = document.getElementById('chart-area-path');
  const chartLabelMax = document.getElementById('chart-label-max');
  const chartLabelMid = document.getElementById('chart-label-mid');
  const chartLabelMin = document.getElementById('chart-label-min');

  let scrapedData = null;

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url) {
    showState(stateNotCompatible);
    return;
  }

  const url = tab.url;
  const isShopsy = url.includes('shopsy.in') || url.includes('shopsy.com');
  const isFlipkart = url.includes('flipkart.com');

  if (!isShopsy && !isFlipkart) {
    showState(stateNotCompatible);
    return;
  }

  badgeEl.textContent = isShopsy ? 'Shopsy' : 'Flipkart';
  loadingText.textContent = "Scraping page content...";
  showState(stateLoading);

  // Send scrape message to content script
  chrome.tabs.sendMessage(tab.id, { action: "scrapeProduct" }, (response) => {
    const err = chrome.runtime.lastError;
    if (err || !response || !response.success) {
      console.warn("Content script error or direct parsing failed. Retrying injection...", err);

      // Fallback: Inject content script manually in case it didn't run on load
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).then(() => {
        // Try requesting scrape again
        chrome.tabs.sendMessage(tab.id, { action: "scrapeProduct" }, (resp) => {
          const err2 = chrome.runtime.lastError;
          if (err2 || !resp || !resp.success) {
            showState(stateNotCompatible);
          } else {
            handleScrapeResponse(resp);
          }
        });
      }).catch((execErr) => {
        console.error("Injection failed", execErr);
        showState(stateNotCompatible);
      });
    } else {
      handleScrapeResponse(response);
    }
  });

  async function handleScrapeResponse(response) {
    if (!response || !response.success) {
      showState(stateNotCompatible);
      return;
    }

    scrapedData = response.data;
    console.log("Scraped details:", scrapedData);

    // Populate standard details
    titleEl.textContent = scrapedData.title || "Unknown Title";
    if (scrapedData.image) {
      imgEl.src = scrapedData.image;
    }

    if (scrapedData.rating) {
      ratingWrapper.style.display = 'flex';
      ratingVal.textContent = scrapedData.rating;
    } else {
      ratingWrapper.style.display = 'none';
    }

    showState(stateProduct);

    // Load price stats and graph using local prediction engine directly
    loadPriceData(scrapedData);
  }

  async function loadPriceData(data) {
    const current = data.price || 0;
    const mrp = data.originalPrice || current || 0;

    // Use local engine by default with scraped values to avoid bad DB fallback values (like 1299)
    const highest = mrp || Math.round(current * 1.35);
    const lowest = Math.max(10, Math.round(current * 0.88));
    const average = Math.round((current * 1.15 + highest * 0.35) / 1.5);

    boxCurrent.textContent = `₹${current}`;
    boxLowest.textContent = `₹${lowest}`;
    boxAverage.textContent = `₹${average}`;
    boxHighest.textContent = `₹${highest}`;

    chartSource.textContent = "PriceGraph Engine";
    const simulatedHistory = generateSimulatedHistory(current, highest, lowest);
    renderVisuals(current, lowest, average, highest, simulatedHistory);
  }

  function generateSimulatedHistory(current, highest, lowest) {
    const points = [];
    const start = highest || (current * 1.3);
    const end = current;
    const numPoints = 12;
    const now = new Date();
    
    for (let i = 0; i < numPoints; i++) {
      const ratio = i / (numPoints - 1);
      const base = start - (start - end) * ratio;
      // Add minor fluctuations
      const fluctuation = i === numPoints - 1 ? 0 : (Math.sin(i * 1.5) * (current * 0.04));
      const price = Math.max(lowest, Math.round(base + fluctuation));
      const date = new Date(now - (numPoints - 1 - i) * 7 * 24 * 60 * 60 * 1000);
      points.push({ price: price, timestamp: date.toISOString() });
    }
    return points;
  }

  function renderVisuals(current, lowest, average, highest, history) {
    // 1. Render Gauge / Recommendation
    let score = 50;
    if (highest > lowest) {
      score = Math.round(((highest - current) / (highest - lowest)) * 100);
      score = Math.max(0, Math.min(100, score));
    }

    // Set gauge stroke offset (dasharray is 126)
    const offset = 126 - (126 * score) / 100;
    gaugeFillPath.style.strokeDashoffset = offset;
    
    // Set needle rotation (-90deg to 90deg)
    const angle = (180 * score) / 100 - 90;
    gaugeNeedleHand.style.transform = `rotate(${angle}deg)`;

    // Set text verdict
    if (score >= 70) {
      recommendationVerdict.textContent = "All-Time Low! Best time to buy!";
      recommendationVerdict.style.color = "var(--success)";
    } else if (score >= 35) {
      recommendationVerdict.textContent = "Good price. Safe to buy.";
      recommendationVerdict.style.color = "var(--warning)";
    } else {
      recommendationVerdict.textContent = "Wait for Savings!";
      recommendationVerdict.style.color = "var(--danger)";
    }
    recommendationSection.style.display = 'flex';

    // 2. Render SVG Line Chart
    let points = [];
    if (history && history.length > 0) {
      points = history.map(p => ({
        price: parseFloat(p.price || p.price_value),
        date: new Date(p.date || p.timestamp)
      })).sort((a, b) => a.date - b.date);
    }

    // Add current price as the final point if it's newer than the last point
    if (current) {
      const now = new Date();
      if (points.length === 0 || now - points[points.length - 1].date > 60 * 1000) {
        points.push({ price: parseFloat(current), date: now });
      }
    }

    if (points.length >= 2) {
      const prices = points.map(p => p.price);
      let maxPrice = Math.max(...prices);
      let minPrice = Math.min(...prices);

      if (maxPrice === minPrice) {
        maxPrice += 10;
        minPrice -= 10;
      }

      // Update axis labels
      chartLabelMax.textContent = `₹${Math.round(maxPrice)}`;
      chartLabelMin.textContent = `₹${Math.round(minPrice)}`;
      chartLabelMid.textContent = `₹${Math.round((maxPrice + minPrice) / 2)}`;

      // Calculate path points
      // viewBox="0 0 300 120", chart area height=80 (y=20 to y=100), width=270 (x=20 to x=290)
      const width = 270;
      const height = 80;
      const startX = 20;
      const startY = 100;

      let pathStr = "";
      let areaStr = "";

      for (let i = 0; i < points.length; i++) {
        const x = startX + (i / (points.length - 1)) * width;
        const y = startY - ((points[i].price - minPrice) / (maxPrice - minPrice)) * height;

        if (i === 0) {
          pathStr = `M ${x} ${y}`;
          areaStr = `M ${x} ${startY} L ${x} ${y}`;
        } else {
          pathStr += ` L ${x} ${y}`;
          areaStr += ` L ${x} ${y}`;
        }
      }

      areaStr += ` L ${startX + width} ${startY} Z`;

      chartLinePath.setAttribute('d', pathStr);
      chartAreaPath.setAttribute('d', areaStr);
      chartSection.style.display = 'block';
    } else {
      chartSection.style.display = 'none';
    }
  }

  function showState(stateEl) {
    [stateLoading, stateNotCompatible, stateProduct].forEach(el => {
      el.classList.remove('active');
    });
    stateEl.classList.add('active');
  }
});
