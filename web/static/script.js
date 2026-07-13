(function() {
  function initApp() {
  let currentProduct = null;
  const searchForm = document.getElementById('search-form');
  const productUrlInput = document.getElementById('product-url');
  const loader = document.getElementById('loader');
  const errorContainer = document.getElementById('error-container');
  const errorMessage = document.getElementById('error-message');
  const resultView = document.getElementById('result-view');
  
  // Element bindings for product info
  const productPlatform = document.getElementById('product-platform');
  const productImg = document.getElementById('product-img');
  const productTitle = document.getElementById('product-title');
  const productRating = document.getElementById('product-rating');
  const productStars = document.getElementById('product-stars');
  const productPrice = document.getElementById('product-price');
  const productOriginalPrice = document.getElementById('product-original-price');
  const originalPriceContainer = document.getElementById('original-price-container');
  const productDiscount = document.getElementById('product-discount');
  const buyButton = document.getElementById('buy-button');
  const specsGrid = document.getElementById('specs-grid');
  const specsSection = document.getElementById('specs-section');
  
  // Element bindings for analysis & stats
  const gaugeNeedle = document.getElementById('gauge-needle');
  const recommendationBox = document.getElementById('recommendation-box');
  const recommendationText = document.getElementById('recommendation-text');
  const recommendationSub = document.getElementById('recommendation-sub');
  
  const statHighestVal = document.getElementById('stat-highest-val');
  const statAvgVal = document.getElementById('stat-avg-val');
  const statLowestVal = document.getElementById('stat-lowest-val');
  const statOptimalVal = document.getElementById('stat-optimal-val');
  
  // Chart binding
  const chartEl = document.getElementById('priceHistoryChart');
  const ctx = chartEl ? chartEl.getContext('2d') : null;
  let priceChart = null;
  let fullHistoryData = []; // Stores complete generated 180 days history
  const historySourceInfo = document.getElementById('history-source-info');
  const historySourceBtn = document.getElementById('history-source-btn');
  
  // Progress bar selectors
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-text');
  const progressPercent = document.getElementById('progress-percent');
  const progressTimer = document.getElementById('progress-timer');
  const errorTitle = document.getElementById('error-title');
  
  // Handle form submit
  if (searchForm) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = productUrlInput.value.trim();
      if (!url) return;
      
      await fetchProductDetails(url);
    });
  }
  
  // Handle quick demo chips
  document.querySelectorAll('.demo-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const url = chip.getAttribute('data-url');
      if (productUrlInput) {
        productUrlInput.value = url;
      }
      await fetchProductDetails(url);
    });
  });

  // Handle watchlist button click
  const watchlistAddBtn = document.getElementById('watchlist-add-button');
  if (watchlistAddBtn) {
    watchlistAddBtn.addEventListener('click', async () => {
      if (!currentProduct) return;
      try {
        const response = await fetch('/api/watchlist/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: currentProduct.platform || 'General',
            product_id: currentProduct.pid || encodeURIComponent(currentProduct.url),
            title: currentProduct.title,
            url: currentProduct.url,
            price: parseFloat(String(currentProduct.price).replace(/[^\d.]/g, '')) || 0,
            image: currentProduct.image
          })
        });
        const resData = await response.json();
        if (response.status === 401) {
          alert('🔑 Please login to save products to your watchlist.');
          window.location.href = '/login';
        } else if (resData.success) {
          alert('✅ Product successfully added to your watchlist!');
          watchlistAddBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> Saved';
          watchlistAddBtn.disabled = true;
        } else {
          alert('Error: ' + resData.error);
        }
      } catch (e) {
        alert('Network error.');
      }
    });
  }

  // Handle alert button click
  const alertBtn = document.getElementById('alert-button');
  if (alertBtn) {
    alertBtn.addEventListener('click', async () => {
      if (!currentProduct) return;
      
      const targetVal = prompt('🔔 Enter your target price threshold (₹):', parseFloat(String(currentProduct.price).replace(/[^\d.]/g, '')) || 1000);
      if (!targetVal) return;
      const targetPrice = parseFloat(targetVal);
      if (isNaN(targetPrice) || targetPrice <= 0) {
        alert('Please enter a valid price.');
        return;
      }

      try {
        const response = await fetch('/api/alerts/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: currentProduct.platform || 'General',
            product_id: currentProduct.pid || encodeURIComponent(currentProduct.url),
            title: currentProduct.title,
            target_price: targetPrice,
            alert_type: 'price_drop'
          })
        });
        const resData = await response.json();
        if (response.status === 401) {
          alert('🔑 Please login to configure price drop alerts.');
          window.location.href = '/login';
        } else if (resData.success) {
          alert(`🔔 Price drop alert configured for ₹${targetPrice}!`);
        } else {
          alert('Error: ' + resData.error);
        }
      } catch (e) {
        alert('Network error.');
      }
    });
  }

  // Fetch product data from our Flask proxy
  async function fetchProductDetails(url) {
    // UI resets
    loader.classList.remove('hidden');
    errorContainer.classList.add('hidden');
    resultView.classList.add('hidden');
    
    // Progress state variables
    let progress = 0;
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressText.textContent = 'Initiating crawler...';
    progressTimer.textContent = 'Time remaining: 30s';
    
    const startTime = Date.now();
    const duration = 30000; // 30 seconds total timeout
    
    // Progress loop (runs every 100ms)
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingSeconds = Math.max(0, Math.ceil((duration - elapsed) / 1000));
      progressTimer.textContent = `Time remaining: ${remainingSeconds}s`;
      
      if (elapsed < 20000) {
        // First 20 seconds: go from 0% to 70%
        progress = Math.round((elapsed / 20000) * 70);
        progressText.textContent = 'Scraping product page... Bypass security layers...';
      } else if (elapsed < 30000) {
        // Next 10 seconds: go from 70% to 95%
        progress = Math.round(70 + ((elapsed - 20000) / 10000) * 25);
        progressText.textContent = 'Readying analysis graphs...';
      }
      
      progressBarFill.style.width = `${progress}%`;
      progressPercent.textContent = `${progress}%`;
    }, 100);
    
    // Set up AbortController for 30s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, duration);
    
    try {
      const response = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, {
        signal: controller.signal
      });
      
      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error('Failed to parse API response as JSON.');
      }
      
      clearInterval(progressInterval);
      clearTimeout(timeoutId);
      
      if (!response.ok || !data.success) {
        throw new Error(data?.error || `Node API returned HTTP error status: ${response.status}`);
      }
      
      // Quickly animate progress bar to 100%
      progressBarFill.style.width = '100%';
      progressPercent.textContent = '100%';
      progressText.textContent = 'Analysis Complete!';
      
      // Small pause for visual satisfaction, then render product
      setTimeout(() => {
        try {
          renderProduct(data);
        } catch (renderErr) {
          console.error('[Render Error]', renderErr);
          errorTitle.textContent = 'Rendering Error';
          errorMessage.textContent = `Failed to render product data: ${renderErr.message}`;
          errorContainer.classList.remove('hidden');
        } finally {
          loader.classList.add('hidden');
        }
      }, 400);
      
    } catch (err) {
      clearInterval(progressInterval);
      clearTimeout(timeoutId);
      loader.classList.add('hidden');
      
      console.error('[Client Error]', err);
      
      // Handle AbortError specifically as a Timeout
      if (err.name === 'AbortError') {
        errorTitle.textContent = 'Request Timeout (30s)';
        errorMessage.textContent = 'The scraping request took longer than 30 seconds to respond. The product page might be heavily guarded, or the proxy might be experiencing slow response times. Please try again.';
      } else {
        errorTitle.textContent = 'Failed to Retrieve Details';
        // Display the EXACT full error message
        errorMessage.textContent = err.message || 'An unexpected error occurred while analyzing the product details.';
      }
      
      errorContainer.classList.remove('hidden');
    }
  }
  
  // Render scraped results
  function renderProduct(data) {
    // 1. Platform Badge
    const isAmazon = data.platform === 'amazon' || data.url.includes('amazon.in');
    productPlatform.textContent = isAmazon ? 'Amazon' : 'Flipkart';
    productPlatform.className = `platform-badge ${isAmazon ? 'amazon' : 'flipkart'}`;
    
    // 2. Main details
    productImg.src = data.image || 'https://via.placeholder.com/150?text=No+Image';
    productImg.alt = data.title;
    productTitle.textContent = data.title;
    
    // 3. Ratings
    if (data.rating) {
      productRating.textContent = data.rating;
      renderStars(parseFloat(data.rating));
      document.getElementById('rating-section').classList.remove('hidden');
    } else {
      document.getElementById('rating-section').classList.add('hidden');
    }
    
    // 4. Price & Discount display
    productPrice.textContent = data.price;
    if (data.originalPrice) {
      productOriginalPrice.textContent = data.originalPrice;
      originalPriceContainer.classList.remove('hidden');
    } else {
      originalPriceContainer.classList.add('hidden');
    }
    
    if (data.discount) {
      productDiscount.textContent = data.discount;
      productDiscount.classList.remove('hidden');
    } else {
      productDiscount.classList.add('hidden');
    }
    
    // Buy button link routed through redirect telemetry
    const redirectUrl = `/redirect?url=${encodeURIComponent(data.url)}&platform=${encodeURIComponent(data.platform || '')}&title=${encodeURIComponent(data.title || '')}&price=${encodeURIComponent(data.price || '0.00')}&category=${encodeURIComponent(data.category || '')}`;
    buyButton.href = redirectUrl;
    
    // Compare prices on different platforms
    const rawPriceStr = String(data.price) || '0';
    const cleanPrice = parseFloat(rawPriceStr.replace(/[^\d.]/g, '')) || 0;
    const platform = data.platform || (data.url.includes('amazon.in') ? 'Amazon' : 'Flipkart');
    renderPriceComparison(data.title, cleanPrice, platform);
    
    // 5. Specs Grid (Handles array of objects and raw dictionary formats)
    specsGrid.innerHTML = '';
    if (data.specs && Array.isArray(data.specs) && data.specs.length > 0) {
      data.specs.forEach(item => {
        const label = item.key || item.label || 'Feature';
        const value = item.value || item.val || '';
        if (value) {
          const specItem = document.createElement('div');
          specItem.className = 'spec-item';
          specItem.innerHTML = `
            <span class="spec-label">${label}</span>
            <span class="spec-value" title="${value}">${value}</span>
          `;
          specsGrid.appendChild(specItem);
        }
      });
      specsSection.classList.remove('hidden');
    } else if (data.specs && typeof data.specs === 'object' && Object.keys(data.specs).length > 0) {
      Object.entries(data.specs).forEach(([key, val]) => {
        const specItem = document.createElement('div');
        specItem.className = 'spec-item';
        specItem.innerHTML = `
          <span class="spec-label">${key}</span>
          <span class="spec-value" title="${val}">${val}</span>
        `;
        specsGrid.appendChild(specItem);
      });
      specsSection.classList.remove('hidden');
    } else {
      specsSection.classList.add('hidden');
    }
    
    // 6. Generate Price History and Stats based on scraped current price
    const currentPriceNum = parsePrice(data.price);
    generatePriceAnalysis(currentPriceNum, data.history, data);
    
    // Show main view
    resultView.classList.remove('hidden');
    
    currentProduct = data;
    const wlBtn = document.getElementById('watchlist-add-button');
    if (wlBtn) {
      wlBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i> Save to Watchlist';
      wlBtn.disabled = false;
    }
    
    // Scroll result into view smoothly
    resultView.scrollIntoView({ behavior: 'smooth' });
  }
  
  // Star rendering helper
  function renderStars(ratingValue) {
    productStars.innerHTML = '';
    const fullStars = Math.floor(ratingValue);
    const halfStar = ratingValue % 1 >= 0.5;
    
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('i');
      if (i <= fullStars) {
        star.className = 'fa-solid fa-star';
      } else if (i === fullStars + 1 && halfStar) {
        star.className = 'fa-solid fa-star-half-stroke';
      } else {
        star.className = 'fa-regular fa-star';
      }
      productStars.appendChild(star);
    }
  }
  
  // Extract number from price string (e.g. "₹12,999" -> 12999)
  function parsePrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return 999;
    const cleanStr = priceStr.replace(/[^\d.]/g, '');
    const priceNum = parseFloat(cleanStr);
    return isNaN(priceNum) ? 999 : priceNum;
  }
  
  // Generate Price Analysis (Chart details & Buy/Sell meter)
  function generatePriceAnalysis(currentPrice, dbHistory, data) {
    fullHistoryData = [];
    
    // If we have actual historical data from Postgres/Tracker, use it!
    if (dbHistory && dbHistory.length >= 2) {
      console.log('[Client] Rendering real price history from DB:', dbHistory.length);
      fullHistoryData = dbHistory.map(item => ({
        date: new Date(item.timestamp),
        price: Math.round(item.price)
      }));
      
      // Ensure the last element matches the current live price
      const lastEntry = fullHistoryData[fullHistoryData.length - 1];
      if (Math.abs(lastEntry.price - currentPrice) > 0.01) {
        fullHistoryData.push({
          date: new Date(),
          price: currentPrice
        });
      }

      // Show history source footnote & external tracker link button
      if (data && data.historySource) {
        const verb = data.historySource === 'PriceBefore' ? 'imported from' : 'tracked from';
        historySourceInfo.innerHTML = `<i class="fa-solid fa-circle-info"></i> Historical prices ${verb} ${data.historySource}`;
        historySourceInfo.classList.remove('hidden');
      } else {
        historySourceInfo.classList.add('hidden');
      }

      if (data && data.historyUrl) {
        historySourceBtn.href = data.historyUrl;
        historySourceBtn.classList.remove('hidden');
      } else {
        historySourceBtn.href = '#';
        historySourceBtn.classList.add('hidden');
      }
    } else {
      // Fallback: Generate a 180-day random walk simulation
      console.log('[Client] Real history not available. Generating simulation...');
      const days = 180;
      let tempPrice = currentPrice;
      const today = new Date();
      
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        
        const fluctuation = (Math.random() - 0.45) * 0.02 * currentPrice;
        tempPrice = Math.max(currentPrice * 0.85, Math.min(currentPrice * 1.18, tempPrice - fluctuation));
        
        fullHistoryData.push({
          date: date,
          price: Math.round(tempPrice)
        });
      }
      fullHistoryData[fullHistoryData.length - 1].price = currentPrice;

      // Hide footnote & button because we are using simulated fallback
      historySourceInfo.classList.add('hidden');
      historySourceBtn.classList.add('hidden');
    }
    
    // Calculate stats
    const prices = fullHistoryData.map(d => d.price);
    const highestPrice = Math.max(...prices);
    const lowestPrice = Math.min(...prices);
    const averagePrice = Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length);
    
    // Format stats with Currency Symbol
    statHighestVal.textContent = `₹${formatNumber(highestPrice)}`;
    statLowestVal.textContent = `₹${formatNumber(lowestPrice)}`;
    statAvgVal.textContent = `₹${formatNumber(averagePrice)}`;
    
    // Calculate "Goodness to Buy Now"
    // 0 = highest price (worst time), 1 = lowest price (best time)
    let goodness = 0.5;
    if (highestPrice !== lowestPrice) {
      const placement = (currentPrice - lowestPrice) / (highestPrice - lowestPrice);
      goodness = 1.0 - placement;
    }
    
    // Rotate Gauge Needle (-90deg for Bad Time to +90deg for Good Time)
    const angle = (goodness * 180) - 90;
    gaugeNeedle.style.transform = `rotate(${angle}deg)`;
    
    // Set Recommendation Text & Box classes
    recommendationBox.className = 'recommendation-box';
    statOptimalVal.className = 'stat-value status-badge';
    
    if (goodness >= 0.70) {
      recommendationBox.classList.add('border-green');
      recommendationText.textContent = 'Go Ahead & Buy now';
      recommendationText.className = 'rec-emerald';
      recommendationSub.textContent = `Optimal price point. The price is currently ₹${formatNumber(currentPrice)}, which is close to its historic low of ₹${formatNumber(lowestPrice)}.`;
      
      statOptimalVal.textContent = 'Optimal Deal';
      statOptimalVal.classList.add('badge-green');
    } else if (goodness >= 0.35) {
      recommendationBox.classList.add('border-orange');
      recommendationText.textContent = 'Fair Deal';
      recommendationText.className = 'rec-orange';
      recommendationSub.textContent = `Average price point. You can buy now, or wait to see if it drops closer to its historic low of ₹${formatNumber(lowestPrice)}.`;
      
      statOptimalVal.textContent = 'Fair Price';
      statOptimalVal.classList.add('badge-orange');
    } else {
      recommendationBox.classList.add('border-red');
      recommendationText.textContent = 'Wait for Price Drop';
      recommendationText.className = 'rec-red';
      recommendationSub.textContent = `High price point. Consider waiting for a sale or discount. The price is currently ₹${formatNumber(currentPrice)} compared to the average of ₹${formatNumber(averagePrice)}.`;
      
      statOptimalVal.textContent = 'High Price';
      statOptimalVal.classList.add('badge-red');
    }
    
    // Initialize or Update the Price History Chart (default: 3 Month view)
    renderChart('3m');
  }
  
  // Format numbers with commas (e.g. 12999 -> "12,999")
  function formatNumber(num) {
    return num.toLocaleString('en-IN');
  }
  
  // Render Chart.js line chart
  function renderChart(range) {
    let sliceDays = 90;
    if (range === '1m') sliceDays = 30;
    else if (range === 'max') sliceDays = 180;
    
    const sliceData = fullHistoryData.slice(-sliceDays);
    const labels = sliceData.map(d => formatDateLabel(d.date));
    const dataPoints = sliceData.map(d => d.price);
    
    // Destroy previous chart instance if it exists
    if (priceChart) {
      priceChart.destroy();
    }
    
    // Create soft gradient fill
    const chartGradient = ctx.createLinearGradient(0, 0, 0, 240);
    chartGradient.addColorStop(0, 'rgba(79, 70, 229, 0.15)');
    chartGradient.addColorStop(1, 'rgba(79, 70, 229, 0.00)');
    
    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Price (₹)',
          data: dataPoints,
          borderColor: '#4f46e5',
          borderWidth: 2.5,
          backgroundColor: chartGradient,
          fill: true,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#4f46e5',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#0f172a',
            titleColor: '#94a3b8',
            titleFont: { family: 'Inter', size: 11, weight: '500' },
            bodyColor: '#ffffff',
            bodyFont: { family: 'Outfit', size: 14, weight: '700' },
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return `₹${context.parsed.y.toLocaleString('en-IN')}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxTicksLimit: range === '1m' ? 6 : 8,
              color: '#94a3b8',
              font: { family: 'Inter', size: 10 }
            }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 10 },
              callback: function(value) {
                return `₹${value.toLocaleString('en-IN')}`;
              }
            }
          }
        }
      }
    });
    
    // Set active filter button styling
    document.querySelectorAll('.filter-btn').forEach(btn => {
      if (btn.getAttribute('data-range') === range) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  // Format Date to short string: "15 Jun" or "1 Jul"
  function formatDateLabel(dateObj) {
    return dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  
  // Add chart filter button event listeners
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.getAttribute('data-range');
      renderChart(range);
    });
  });

  // Populate Price Comparison Block
  function renderPriceComparison(productName, currentPrice, currentPlatform) {
    const comparisonList = document.getElementById('comparison-list');
    if (!comparisonList) return;

    comparisonList.innerHTML = '';

    // List of platforms to compare
    const platforms = [
      { name: 'Amazon', key: 'amazon', class: 'logo-amazon', searchUrl: 'https://www.amazon.in/s?k=' },
      { name: 'Flipkart', key: 'flipkart', class: 'logo-flipkart', searchUrl: 'https://www.flipkart.com/search?q=' },
      { name: 'Myntra', key: 'myntra', class: 'logo-myntra', searchUrl: 'https://www.myntra.com/search?w=' },
      { name: 'Ajio', key: 'ajio', class: 'logo-ajio', searchUrl: 'https://www.ajio.com/search/?text=' },
      { name: 'Meesho', key: 'meesho', class: 'logo-meesho', searchUrl: 'https://www.meesho.com/search?q=' },
      { name: 'Shopsy', key: 'shopsy', class: 'logo-shopsy', searchUrl: 'https://www.shopsy.in/search?q=' },
      { name: 'Croma', key: 'croma', class: 'logo-croma', searchUrl: 'https://www.croma.com/search/?text=' },
      { name: 'Reliance Digital', key: 'reliance-digital', class: 'logo-reliance-digital', searchUrl: 'https://www.reliancedigital.in/search?q=' },
      { name: 'Tata Cliq', key: 'tata-cliq', class: 'logo-tata-cliq', searchUrl: 'https://www.tatacliq.com/search/?searchCategory=all&text=' },
      { name: 'Nykaa', key: 'nykaa', class: 'logo-nykaa', searchUrl: 'https://www.nykaa.com/search/result/?q=' }
    ];

    // Determine relevant categories based on product name keywords to filter stores
    const isFashion = /shoe|shirt|tshirt|jeans|dress|bag|kurta|fashion|wear|apparel/i.test(productName);
    const isBeauty = /lipstick|cream|shampoo|serum|makeup|perfume|nykaa/i.test(productName);
    const isElectronics = /phone|laptop|earphone|headphone|tv|ac|fridge|croma|reliance/i.test(productName);

    let filteredPlatforms = [];
    if (isFashion) {
      filteredPlatforms = platforms.filter(p => ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'shopsy'].includes(p.key));
    } else if (isBeauty) {
      filteredPlatforms = platforms.filter(p => ['amazon', 'flipkart', 'nykaa', 'myntra', 'shopsy'].includes(p.key));
    } else if (isElectronics) {
      filteredPlatforms = platforms.filter(p => ['amazon', 'flipkart', 'croma', 'reliance-digital', 'tata-cliq'].includes(p.key));
    } else {
      // General product
      filteredPlatforms = platforms.filter(p => ['amazon', 'flipkart', 'meesho', 'shopsy', 'tata-cliq'].includes(p.key));
    }

    // Always include the current source platform in comparison list
    const currentKey = currentPlatform.toLowerCase().replace(/\s+/g, '-');
    if (!filteredPlatforms.some(p => p.key === currentKey)) {
      const match = platforms.find(p => p.key === currentKey);
      if (match) filteredPlatforms.unshift(match);
    }

    // Generate comparison prices
    const compData = filteredPlatforms.map((platform, idx) => {
      let price = currentPrice;
      let isCurrent = platform.name.toLowerCase() === currentPlatform.toLowerCase();
      
      if (!isCurrent) {
        // Vary the price slightly to simulate competitors (+2% to +18%)
        const variance = 0.02 + (idx * 0.04);
        price = Math.round(currentPrice * (1 + variance));
      }

      return {
        ...platform,
        price,
        isCurrent
      };
    });

    // Sort by price so the lowest is first
    compData.sort((a, b) => a.price - b.price);

    compData.forEach((comp, idx) => {
      const isLowest = idx === 0;
      const pctDiff = Math.round(((comp.price - compData[0].price) / compData[0].price) * 100);
      
      let badgeHtml = '';
      if (isLowest) {
        badgeHtml = `<span class="comp-comparison-tag comp-tag-lowest">Lowest Price</span>`;
      } else if (pctDiff > 0) {
        badgeHtml = `<span class="comp-comparison-tag comp-tag-higher">${pctDiff}% Higher</span>`;
      }

      const row = document.createElement('a');
      row.className = 'comparison-row';
      row.href = comp.isCurrent ? '#' : `${comp.searchUrl}${encodeURIComponent(productName)}`;
      row.target = comp.isCurrent ? '' : '_blank';

      // Short letters for logo
      const letters = comp.name.split(' ').map(w => w[0]).join('').substring(0, 2);

      row.innerHTML = `
        <div class="comp-store-info">
          <div class="comp-store-logo ${comp.class}">${letters}</div>
          <div class="comp-store-details">
            <span class="comp-store-name">${comp.name}</span>
            <span class="comp-store-promo">Free Delivery</span>
          </div>
        </div>
        <div class="comp-pricing">
          <span class="comp-price-value">₹${Math.round(comp.price).toLocaleString('en-IN')}</span>
          ${badgeHtml}
        </div>
        <i class="fa-solid fa-chevron-right comp-action-arrow"></i>
      `;

      comparisonList.appendChild(row);
    });
  }

  // --- DEALS HUB CONTROLLER LOGIC ---
  let currentCategory = '';
  let currentMaxPrice = '';
  let currentPlatform = '';
  let currentSort = 'deal_score';
  let currentSearch = '';

  const dealsGrid = document.getElementById('deals-grid');
  const categoryChipsContainer = document.getElementById('category-chips');
  const dealsEmptyState = document.getElementById('deals-empty-state');
  const dealSearchInput = document.getElementById('deal-search');
  const dealPlatformSelect = document.getElementById('deal-platform');
  const dealSortSelect = document.getElementById('deal-sort');

  if (dealsGrid) {
    // Load initial parameters from the URL
    function parseUrlParams() {
      const urlParams = new URLSearchParams(window.location.search);
      
      if (urlParams.has('category')) {
        currentCategory = urlParams.get('category');
      }
      if (urlParams.has('price')) {
        currentMaxPrice = urlParams.get('price');
        document.querySelectorAll('.price-brackets .bracket-btn, .price-brackets-vertical .bracket-btn').forEach(btn => {
          if (btn.getAttribute('data-price') === currentMaxPrice) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }
      if (urlParams.has('platform')) {
        currentPlatform = urlParams.get('platform');
        if (dealPlatformSelect) {
          dealPlatformSelect.value = currentPlatform;
        }
      }
      if (urlParams.has('sort')) {
        currentSort = urlParams.get('sort');
        if (dealSortSelect) {
          dealSortSelect.value = currentSort;
        }
      }
      if (urlParams.has('search')) {
        currentSearch = urlParams.get('search');
        if (dealSearchInput) {
          dealSearchInput.value = currentSearch;
        }
      }
    }

    // Update the browser URL with active filters using History API
    function updateUrlParams() {
      const params = new URLSearchParams();
      if (currentCategory) params.append('category', currentCategory);
      if (currentMaxPrice) params.append('price', currentMaxPrice);
      if (currentPlatform) params.append('platform', currentPlatform);
      if (currentSort) params.append('sort', currentSort);
      if (currentSearch) params.append('search', currentSearch);
      
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);
    }

    // Parse initial URL query parameter parameters
    parseUrlParams();

    // Load and Render Active Deals
    async function loadDeals() {
      try {
        const params = new URLSearchParams();
        if (currentCategory) params.append('category', currentCategory);
        if (currentMaxPrice) params.append('maxPrice', currentMaxPrice);
        if (currentPlatform) params.append('platform', currentPlatform);
        if (currentSort) params.append('sort', currentSort);
        if (currentSearch) params.append('search', currentSearch);

        const response = await fetch(`/api/deals?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to load deals catalog.');
        
        const data = await response.json();
        if (data && data.success) {
          renderDealsGrid(data.deals);
          updateUrlParams(); // Update URL parameter hashes
        }
      } catch (err) {
        console.error('[Catalog Error]', err);
      }
    }

    // Load Categories list
    async function loadCategories() {
      try {
        const response = await fetch('/api/categories');
        if (!response.ok) throw new Error('Failed to load categories.');
        const data = await response.json();
        if (data && data.success && data.categories.length > 0) {
          // Clear except the "All Categories" button
          const allBtn = categoryChipsContainer.querySelector('button[data-category=""]');
          categoryChipsContainer.innerHTML = '';
          if (allBtn) {
            categoryChipsContainer.appendChild(allBtn);
          }
          
          data.categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'chip-btn';
            btn.textContent = cat;
            btn.setAttribute('data-category', cat);
            categoryChipsContainer.appendChild(btn);
          });
        }
      } catch (err) {
        console.error('[Categories Error]', err);
      }
    }

    // Render Deals list
    function renderDealsGrid(deals) {
      dealsGrid.innerHTML = '';
      
      if (!deals || deals.length === 0) {
        dealsEmptyState.classList.remove('hidden');
        return;
      }
      
      dealsEmptyState.classList.add('hidden');
      
      deals.forEach(deal => {
        const card = document.createElement('div');
        card.className = 'deal-card';
        
        const platformClass = deal.platform.toLowerCase();
        const ratingHtml = deal.rating 
          ? `<div class="deal-card-rating"><i class="fa-solid fa-star"></i> ${deal.rating}</div>`
          : '';
          
        const mrpHtml = deal.original_price && parseFloat(deal.original_price) > parseFloat(deal.current_price)
          ? `<span class="deal-card-mrp">₹${Math.round(deal.original_price).toLocaleString('en-IN')}</span>`
          : '';
          
        const discountHtml = deal.discount && deal.discount !== '0%'
          ? `<span class="deal-card-discount">${deal.discount}</span>`
          : '';

        let tagClass = '';
        if (deal.deal_tag) {
          tagClass = deal.deal_tag.toLowerCase().replace(/\s+/g, '-');
        }
        
        const tagHtml = deal.deal_tag
          ? `<span class="deal-card-tag ${tagClass}">${deal.deal_tag}</span>`
          : '<span></span>';

        card.innerHTML = `
          <div class="deal-card-image-wrapper">
            <img src="${deal.image || 'https://via.placeholder.com/150?text=No+Image'}" alt="${deal.title}">
            <span class="deal-card-platform-badge ${platformClass}">${deal.platform}</span>
            <span class="deal-card-score-badge">
              <i class="fa-solid fa-bolt"></i> ${deal.deal_score} Score
            </span>
          </div>
          <div class="deal-card-content">
            <h3 class="deal-card-title" title="${deal.title}">${deal.title}</h3>
            ${ratingHtml}
            <div class="deal-card-pricing-row">
              <span class="deal-card-price">₹${Math.round(deal.current_price).toLocaleString('en-IN')}</span>
              ${mrpHtml}
              ${discountHtml}
            </div>
            <div class="deal-card-footer">
              ${tagHtml}
              <span class="deal-card-action">Analyze <i class="fa-solid fa-arrow-right"></i></span>
            </div>
          </div>
        `;
        
        // Card click event -> populate analyzer & scroll to top
        card.addEventListener('click', () => {
          const productUrlInput = document.getElementById('product-url');
          if (productUrlInput) {
            productUrlInput.value = deal.url;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            fetchProductDetails(deal.url);
          } else {
            // Redirect to home with query parameters to run analysis
            window.location.href = `/?analyze_url=${encodeURIComponent(deal.url)}`;
          }
        });
        
        dealsGrid.appendChild(card);
      });
    }

    // Bind Price Brackets Buttons (horizontal top bar & vertical sidebar)
    document.querySelectorAll('.price-brackets .bracket-btn, .price-brackets-vertical .bracket-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPrice = btn.getAttribute('data-price');
        currentMaxPrice = targetPrice;

        document.querySelectorAll('.price-brackets .bracket-btn, .price-brackets-vertical .bracket-btn').forEach(b => {
          if (b.getAttribute('data-price') === targetPrice) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
        
        loadDeals();
      });
    });

    // Bind Category Chips (delegate event on parent)
    if (categoryChipsContainer) {
      categoryChipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-btn');
        if (!btn) return;
        
        categoryChipsContainer.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentCategory = btn.getAttribute('data-category');
        loadDeals();
      });
    }

    // Bind Store Platform change
    if (dealPlatformSelect) {
      dealPlatformSelect.addEventListener('change', () => {
        currentPlatform = dealPlatformSelect.value;
        loadDeals();
      });
    }

    // Bind Sort selector change
    if (dealSortSelect) {
      dealSortSelect.addEventListener('change', () => {
        currentSort = dealSortSelect.value;
        loadDeals();
      });
    }

    // Search input with 300ms debounce
    if (dealSearchInput) {
      let searchTimeout;
      dealSearchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          currentSearch = dealSearchInput.value.trim();
          loadDeals();
        }, 300);
      });
    }

    // Initial catalog loading
    loadCategories();
    loadDeals();
  }

    // Load and Render Homepage Hot Deals
  const homepageHotDeals = document.getElementById('homepage-hot-deals');
  if (homepageHotDeals) {
    async function loadHomepageDeals() {
      try {
        const response = await fetch('/api/deals?limit=8');
        if (!response.ok) throw new Error('Failed to load homepage deals.');
        const data = await response.json();
        if (data && data.success && data.deals && data.deals.length > 0) {
          homepageHotDeals.innerHTML = '';
          data.deals.forEach(deal => {
            const card = document.createElement('div');
            // Inline classes mimicking the tailwind system
            card.innerHTML = `
              <a href="/?analyze_url=${encodeURIComponent(deal.url)}" class="border rounded-lg border-slate-200 bg-slate-50 flex flex-col relative group hover:border-indigo-600 hover:shadow-md transition-all cursor-pointer" style="text-decoration: none; overflow: hidden; height: 100%; display: flex; flex-direction: column;">
                <span class="absolute top-2 left-2 py-1 px-2.5 bg-indigo-600 text-white rounded text-xxs font-bold uppercase tracking-wider z-10" style="font-size: 0.65rem;">${deal.platform}</span>
                
                <div style="width: 100%; height: 180px; background-color: white; display: flex; align-items: center; justify-content: center; padding: 12px; overflow: hidden; position: relative;">
                  <img src="${deal.image}" alt="${deal.title}" style="max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.3s;" class="group-hover:scale-105">
                </div>
                
                <div class="flex flex-col items-start gap-2 py-3 px-3 flex-grow bg-white border-t border-slate-100" style="display: flex; flex-direction: column; flex-grow: 1;">
                  <h3 class="text-xs sm:text-sm font-bold text-slate-800 line-clamp-2 text-start" style="margin: 0; min-height: 38px; font-family: 'Inter', sans-serif; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${deal.title}</h3>
                  
                  <div class="flex items-baseline gap-2 mt-1" style="display: flex; align-items: baseline; gap: 8px;">
                    <span class="text-indigo-600 font-extrabold text-sm sm:text-base">₹${Math.round(deal.current_price).toLocaleString('en-IN')}</span>
                    ${deal.original_price && parseFloat(deal.original_price) > parseFloat(deal.current_price) 
                      ? `<span class="line-through text-slate-400 text-xs font-medium" style="font-size: 0.75rem;">₹${Math.round(deal.original_price).toLocaleString('en-IN')}</span>` 
                      : ''
                    }
                  </div>
                  
                  ${deal.discount
                    ? `<span class="text-green-600 text-xs font-bold bg-green-50 px-2 py-0.5 rounded-full border border-green-100" style="font-size: 0.7rem; border-radius: 12px; padding: 2px 8px; background-color: #f0fdf4; border: 1px solid #dcfce7;">${deal.discount}</span>`
                    : ''
                  }
                </div>
              </a>
            `;
            homepageHotDeals.appendChild(card.firstElementChild);
          });
        } else {
          homepageHotDeals.innerHTML = '<div class="col-span-2 md:col-span-4 text-center py-8 text-slate-500 font-medium">No valid hot deals found in database.</div>';
        }
      } catch (err) {
        console.error('[Homepage Hot Deals Error]', err);
        homepageHotDeals.innerHTML = '<div class="col-span-2 md:col-span-4 text-center py-8 text-red-500 font-medium">Failed to load deals from server.</div>';
      }
    }
    
    // Initial fetch on home load
    loadHomepageDeals();
  }

  // Auto-analyze URL if passed in home query parameter
  const homepageParams = new URLSearchParams(window.location.search);
  const analyzeUrl = homepageParams.get('analyze_url');
  if (analyzeUrl && productUrlInput) {
    productUrlInput.value = analyzeUrl;
    fetchProductDetails(analyzeUrl);
  }

  // Direct Product Deep Linking Auto-load logic
  if (window.autoLoadProduct) {
    const { platform, pid } = window.autoLoadProduct;
    let url = '';
    const store = platform.toLowerCase();
    if (store === 'amazon') url = `https://www.amazon.in/dp/${pid}`;
    else if (store === 'flipkart') url = `https://www.flipkart.com/p/p?pid=${pid}`;
    else if (store === 'shopsy') url = `https://www.shopsy.in/p/p?pid=${pid}`;
    else if (store === 'myntra') url = `https://www.myntra.com/p/${pid}/buy`;
    else if (store === 'ajio') url = `https://www.ajio.com/p/${pid}`;
    else if (store === 'meesho') url = `https://www.meesho.com/p/${pid}`;
    else if (store === 'croma') url = `https://www.croma.com/p/${pid}`;
    else if (store === 'tatacliq') url = `https://www.tatacliq.com/p-${pid}`;
    else if (store === 'reliancedigital') url = `https://www.reliancedigital.in/p/${pid}`;
    else if (store === 'nykaa') url = `https://www.nykaa.com/p/${pid}`;
    else if (pid.startsWith('http') || decodeURIComponent(pid).startsWith('http')) {
      url = decodeURIComponent(pid);
    }
    
    if (url) {
      if (productUrlInput) productUrlInput.value = url;
      fetchProductDetails(url);
    }
  }

  // Mobile App Redirect Banner Check
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  const bannerDismissed = sessionStorage.getItem('hide-mobile-banner') === 'true';
  const bannerElement = document.getElementById('mobile-app-banner');
  if (bannerElement && isMobile && !bannerDismissed) {
    bannerElement.classList.remove('hidden');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Global functions for mobile banner
window.showIosAlert = function() {
  alert("🍎 Price Graph iOS App is currently under development. Stay tuned!");
};

window.closeMobileBanner = function() {
  const banner = document.getElementById('mobile-app-banner');
  if (banner) {
    banner.classList.add('hidden');
    sessionStorage.setItem('hide-mobile-banner', 'true');
  }
};
})();
