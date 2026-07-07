document.addEventListener('DOMContentLoaded', () => {
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
  const ctx = document.getElementById('priceHistoryChart').getContext('2d');
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
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = productUrlInput.value.trim();
    if (!url) return;
    
    await fetchProductDetails(url);
  });
  
  // Handle quick demo chips
  document.querySelectorAll('.demo-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const url = chip.getAttribute('data-url');
      productUrlInput.value = url;
      await fetchProductDetails(url);
    });
  });

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
    
    // Buy button link
    buyButton.href = data.url;
    
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
    generatePriceAnalysis(currentPriceNum, data.history);
    
    // Show history source footnote & external tracker link button
    if (data.historySource) {
      historySourceInfo.innerHTML = `<i class="fa-solid fa-circle-info"></i> Historical prices imported from ${data.historySource}`;
      historySourceInfo.classList.remove('hidden');
    } else {
      historySourceInfo.classList.add('hidden');
    }
    
    if (data.historyUrl) {
      historySourceBtn.href = data.historyUrl;
      historySourceBtn.classList.remove('hidden');
    } else {
      historySourceBtn.href = '#';
      historySourceBtn.classList.add('hidden');
    }
    
    // Show main view
    resultView.classList.remove('hidden');
    
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
  function generatePriceAnalysis(currentPrice, dbHistory) {
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
    } else {
      // Fallback: Generate a 180-day random walk simulation
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
});
