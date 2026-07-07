document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('search-form');
  const productUrlInput = document.getElementById('product-url');
  const loader = document.getElementById('loader');
  const errorContainer = document.getElementById('error-container');
  const errorMessage = document.getElementById('error-message');
  const resultCard = document.getElementById('result-card');
  const demoChips = document.querySelectorAll('.demo-chip');

  // DOM Elements for results
  const productPlatform = document.getElementById('product-platform');
  const productImg = document.getElementById('product-img');
  const productTitle = document.getElementById('product-title');
  const productStars = document.getElementById('product-stars');
  const productRating = document.getElementById('product-rating');
  const productPrice = document.getElementById('product-price');
  const productOriginalPrice = document.getElementById('product-original-price');
  const originalPriceContainer = document.getElementById('original-price-container');
  const productDiscount = document.getElementById('product-discount');
  const buyButton = document.getElementById('buy-button');
  const alertButton = document.getElementById('alert-button');
  const specsGrid = document.getElementById('specs-grid');
  const specsSection = document.getElementById('specs-section');

  // API base path (works relatively when hosted together, or falls back to localhost:3000)
  const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? ''
    : window.location.origin;

  // Handle Search Submission
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = productUrlInput.value.trim();
    if (!url) return;

    await fetchProductDetails(url);
  });

  // Handle Demo Chip Clicks
  demoChips.forEach(chip => {
    chip.addEventListener('click', async () => {
      const url = chip.getAttribute('data-url');
      productUrlInput.value = url;
      await fetchProductDetails(url);
    });
  });

  // Fetch Product Details from API
  async function fetchProductDetails(url) {
    // Reset states
    loader.classList.remove('hidden');
    errorContainer.classList.add('hidden');
    resultCard.classList.add('hidden');

    try {
      const response = await fetch(`${API_BASE}/api/scrape?url=${encodeURIComponent(url)}`);
      const data = await response.json();

      loader.classList.add('hidden');

      if (!response.ok || !data.success) {
        showError(data.error || 'Failed to retrieve details from the e-commerce store.');
        return;
      }

      renderResult(data);
    } catch (err) {
      loader.classList.add('hidden');
      showError('Could not connect to the scraper service. Please ensure the API server is running.');
    }
  }

  // Display Error message
  function showError(msg) {
    errorMessage.textContent = msg;
    errorContainer.classList.remove('hidden');
  }

  // Render Result Card
  function renderResult(data) {
    // Platform
    const platform = data.platform.toLowerCase();
    productPlatform.textContent = data.platform;
    productPlatform.className = `platform-badge ${platform}`;

    // Title
    productTitle.textContent = data.title || 'Product Title Not Found';

    // Image
    productImg.src = data.image || 'https://via.placeholder.com/350x350?text=No+Image+Available';
    productImg.alt = data.title || 'Product Image';

    // Price
    productPrice.textContent = formatPrice(data.price);
    
    // Original Price & Discount
    if (data.originalPrice && data.originalPrice > data.price) {
      originalPriceContainer.classList.remove('hidden');
      productOriginalPrice.textContent = `₹${formatPrice(data.originalPrice)}`;
      productDiscount.textContent = data.discount || 'Special Offer';
      productDiscount.classList.remove('hidden');
    } else {
      originalPriceContainer.classList.add('hidden');
      if (data.discount && data.discount !== '0%') {
        productDiscount.textContent = data.discount;
        productDiscount.classList.remove('hidden');
      } else {
        productDiscount.classList.add('hidden');
      }
    }

    // Rating
    if (data.rating) {
      productRating.textContent = `${data.rating} / 5`;
      renderStars(data.rating);
      document.getElementById('rating-section').classList.remove('hidden');
    } else {
      document.getElementById('rating-section').classList.add('hidden');
    }

    // Buy Button Link
    buyButton.href = data.url;
    buyButton.className = `btn btn-primary platform-${platform}`;
    
    // Set price alert action demo
    alertButton.onclick = () => {
      const target = prompt(`Enter target alert price in ₹ (Current: ₹${formatPrice(data.price)}):`);
      if (target) {
        alert(`🔔 Price alert set! We will notify you when price drops below ₹${target}.`);
      }
    };

    // Specs
    specsGrid.innerHTML = '';
    if (data.specs && data.specs.length > 0) {
      data.specs.forEach(spec => {
        const item = document.createElement('div');
        item.className = 'spec-item';
        
        const label = document.createElement('span');
        label.className = 'spec-label';
        label.textContent = spec.key;
        
        const value = document.createElement('span');
        value.className = 'spec-value';
        value.textContent = spec.value;

        item.appendChild(label);
        item.appendChild(value);
        specsGrid.appendChild(item);
      });
      specsSection.classList.remove('hidden');
    } else {
      specsSection.classList.add('hidden');
    }

    // Reveal result card
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth' });
  }

  // Format price helper
  function formatPrice(num) {
    if (!num) return 'N/A';
    return Number(num).toLocaleString('en-IN');
  }

  // Render Stars helper
  function renderStars(rating) {
    productStars.innerHTML = '';
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.4;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

    for (let i = 0; i < fullStars; i++) {
      productStars.innerHTML += '<i class="fa-solid fa-star"></i>';
    }
    if (halfStar) {
      productStars.innerHTML += '<i class="fa-solid fa-star-half-stroke"></i>';
    }
    for (let i = 0; i < emptyStars; i++) {
      productStars.innerHTML += '<i class="fa-regular fa-star"></i>';
    }
  }
});
