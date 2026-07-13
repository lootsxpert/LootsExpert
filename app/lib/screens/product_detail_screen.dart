import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/gauge_widget.dart';
import '../widgets/price_chart.dart';

class ProductDetailScreen extends StatefulWidget {
  final Product initialProduct;
  final String productUrl;

  const ProductDetailScreen({
    super.key,
    required this.initialProduct,
    required this.productUrl,
  });

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  late Product _product;
  bool _isRefreshing = false;
  String? _refreshError;

  @override
  void initState() {
    _product = widget.initialProduct;
    super.initState();
  }

  Future<void> _refreshDetails() async {
    setState(() {
      _isRefreshing = true;
      _refreshError = null;
    });

    try {
      final updatedProduct = await ApiService.scrapeProduct(widget.productUrl);
      if (mounted) {
        setState(() {
          _product = updatedProduct;
          _isRefreshing = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isRefreshing = false;
          _refreshError = e.toString().replaceAll('Exception: ', '');
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update: $_refreshError')),
        );
      }
    }
  }

  Future<void> _launchUrl(String urlString) async {
    final uri = Uri.parse(urlString);
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not open store link.')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }

  void _showSetAlertDial() {
    final controller = TextEditingController(
      text: _product.currentPrice.toInt().toString(),
    );

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.notifications_active_outlined, color: AppTheme.accentIndigo),
              SizedBox(width: 8),
              Text('Set Price Alert', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'We\'ll notify you when the price falls below your target threshold.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  prefixText: '₹ ',
                  labelText: 'Target Price',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: AppTheme.accentIndigo, width: 1.5),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel', style: TextStyle(color: AppTheme.textMuted)),
            ),
            ElevatedButton(
              onPressed: () {
                final targetVal = controller.text.trim();
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Price alert successfully scheduled at ₹$targetVal!'),
                    backgroundColor: AppTheme.colorGreen,
                  ),
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.accentIndigo,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('Set Alert'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    // 1. Calculate historical metrics
    final prices = _product.history.map((p) => p.price).toList();
    final double highestPrice = prices.isNotEmpty ? prices.reduce((a, b) => a > b ? a : b) : _product.currentPrice;
    final double lowestPrice = prices.isNotEmpty ? prices.reduce((a, b) => a < b ? a : b) : _product.currentPrice;
    final double averagePrice = prices.isNotEmpty ? (prices.reduce((a, b) => a + b) / prices.length).roundToDouble() : _product.currentPrice;

    // 2. Calculate Buy Recommendation "Goodness"
    double goodness = 0.5;
    if (highestPrice != lowestPrice) {
      double placement = (_product.currentPrice - lowestPrice) / (highestPrice - lowestPrice);
      goodness = (1.0 - placement).clamp(0.0, 1.0);
    }

    // Determine presentation values matching style.css thresholds
    String recTitle = 'Fair Deal';
    String recDesc = '';
    Color recColor = AppTheme.colorOrange;
    String statusBadge = 'Fair Price';

    if (goodness >= 0.70) {
      recTitle = 'Go Ahead & Buy now';
      recDesc = 'Optimal price point. The price is currently ₹${_formatPrice(_product.currentPrice)}, which is close to its historic low of ₹${_formatPrice(lowestPrice)}.';
      recColor = AppTheme.colorGreen;
      statusBadge = 'Optimal Deal';
    } else if (goodness >= 0.35) {
      recTitle = 'Fair Deal';
      recDesc = 'Average price point. You can buy now, or wait to see if it drops closer to its historic low of ₹${_formatPrice(lowestPrice)}.';
      recColor = AppTheme.colorOrange;
      statusBadge = 'Fair Price';
    } else {
      recTitle = 'Wait for Price Drop';
      recDesc = 'High price point. Consider waiting for a sale or discount. The price is currently ₹${_formatPrice(_product.currentPrice)} compared to the average of ₹${_formatPrice(averagePrice)}.';
      recColor = AppTheme.colorRed;
      statusBadge = 'High Price';
    }

    // Platform Badge Theme
    Color platformColor = AppTheme.primary;
    if (_product.platform.toLowerCase().contains('amazon')) {
      platformColor = const Color(0xFFFF9900);
    } else if (_product.platform.toLowerCase().contains('flipkart')) {
      platformColor = const Color(0xFF2874F0);
    } else if (_product.platform.toLowerCase().contains('myntra')) {
      platformColor = const Color(0xFFE61B72);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Analysis Report', style: TextStyle(fontWeight: FontWeight.bold)),
        centerTitle: true,
        actions: [
          IconButton(
            icon: _isRefreshing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.textPrimary),
                  )
                : const Icon(Icons.refresh),
            onPressed: _isRefreshing ? null : _refreshDetails,
            tooltip: 'Re-scrape Product',
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshDetails,
        color: AppTheme.primary,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 1. Product Detail GlassCard
                GlassCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Product Image & Badging Section
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 100,
                            height: 100,
                            padding: const EdgeInsets.all(8.0),
                            decoration: BoxDecoration(
                              color: AppTheme.bgMain,
                              borderRadius: BorderRadius.circular(12.0),
                              border: Border.all(color: AppTheme.borderClean, width: 0.8),
                            ),
                            child: _product.image.isNotEmpty
                                ? Image.network(
                                    _product.image,
                                    fit: BoxFit.contain,
                                    errorBuilder: (context, error, stackTrace) =>
                                        const Icon(Icons.image_not_supported, color: AppTheme.textMuted),
                                  )
                                : const Icon(Icons.image, color: AppTheme.textMuted),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Platform Tag
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: platformColor,
                                    borderRadius: BorderRadius.circular(4.0),
                                  ),
                                  child: Text(
                                    _product.platform,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 9,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                
                                // Title
                                Text(
                                  _product.title,
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.textPrimary,
                                    height: 1.3,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                
                                // Rating
                                if (_product.rating > 0)
                                  Row(
                                    children: [
                                      const Icon(Icons.star, color: Colors.amber, size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        _product.rating.toStringAsFixed(1),
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                          color: AppTheme.textSecondary,
                                        ),
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      
                      // Pricing Row
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          const Text(
                            '₹',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          Text(
                            _formatPrice(_product.currentPrice),
                            style: const TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.w900,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                          const SizedBox(width: 10),
                          if (_product.originalPrice > _product.currentPrice) ...[
                            const Text(
                              'MRP: ',
                              style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                            ),
                            Text(
                              '₹${_formatPrice(_product.originalPrice)}',
                              style: const TextStyle(
                                fontSize: 13,
                                color: AppTheme.textMuted,
                                decoration: TextDecoration.lineThrough,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: AppTheme.colorGreen.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(6.0),
                              ),
                              child: Text(
                                _product.discount,
                                style: const TextStyle(
                                  color: AppTheme.colorGreen,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 18),
                      
                      // Action Buttons
                      Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: ElevatedButton.icon(
                              onPressed: () => _launchUrl(_product.url),
                              icon: const Icon(Icons.shopping_cart, size: 16),
                              label: Text('Buy on ${_product.platform}'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.primary,
                                foregroundColor: Colors.white,
                                elevation: 0,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            flex: 1,
                            child: OutlinedButton.icon(
                              onPressed: _showSetAlertDial,
                              icon: const Icon(Icons.notifications_none, size: 16),
                              label: const Text('Set Alert'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.textSecondary,
                                side: const BorderSide(color: AppTheme.borderClean),
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),

                // 2. Buy Recommendation Card (Gauge + recommendation box)
                GlassCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Should you buy now?',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                      
                      // Gauge widget
                      GaugeWidget(goodness: goodness),
                      const SizedBox(height: 6),
                      
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.sentiment_very_dissatisfied, color: AppTheme.colorRed, size: 14),
                              const SizedBox(width: 4),
                              Text('High Price', style: TextStyle(color: AppTheme.colorRed, fontSize: 10, fontWeight: FontWeight.bold)),
                            ],
                          ),
                          Row(
                            children: [
                              Text('Optimal Price', style: TextStyle(color: AppTheme.colorGreen, fontSize: 10, fontWeight: FontWeight.bold)),
                              const SizedBox(width: 4),
                              Icon(Icons.sentiment_very_satisfied, color: AppTheme.colorGreen, size: 14),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      
                      // Recommendation description box
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14.0),
                        decoration: BoxDecoration(
                          color: recColor.withOpacity(0.06),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: recColor.withOpacity(0.2), width: 1.0),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Our Recommendation',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.textMuted,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              recTitle,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: recColor,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              recDesc,
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppTheme.textSecondary,
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),

                // 3. Stats Dashboard Grid
                const Text(
                  'Price Stats',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 10),
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 2.1,
                  children: [
                    _buildStatCard('Highest Price', '₹${_formatPrice(highestPrice)}', Icons.arrow_upward, AppTheme.colorRed),
                    _buildStatCard('Average Price', '₹${_formatPrice(averagePrice)}', Icons.remove, AppTheme.textSecondary),
                    _buildStatCard('Lowest Price', '₹${_formatPrice(lowestPrice)}', Icons.arrow_downward, AppTheme.colorGreen),
                    _buildStatCard('Current Status', statusBadge, Icons.check_circle_outline, recColor, isStatus: true),
                  ],
                ),
                const SizedBox(height: 22),

                // 4. Line Chart
                GlassCard(
                  child: PriceChart(history: _product.history),
                ),
                const SizedBox(height: 20),

                // Footnote Details
                if (_product.historySource != null)
                  Center(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.info_outline, size: 12, color: AppTheme.textMuted),
                        const SizedBox(width: 4),
                        Text(
                          'Historical prices tracked from ${_product.historySource}',
                          style: const TextStyle(fontSize: 10, color: AppTheme.textMuted),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),

                // Footnote Action button to history url
                if (_product.historyUrl != null && _product.historyUrl!.isNotEmpty)
                  Center(
                    child: OutlinedButton.icon(
                      onPressed: () => _launchUrl(_product.historyUrl!),
                      icon: const Icon(Icons.open_in_new, size: 12),
                      label: const Text('View Original History Page', style: TextStyle(fontSize: 11)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.textSecondary,
                        side: const BorderSide(color: AppTheme.borderClean),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      ),
                    ),
                  ),
                const SizedBox(height: 30),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStatCard(String label, String value, IconData icon, Color color, {bool isStatus = false}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderClean),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 12, color: color),
              const SizedBox(width: 4),
              Text(
                label,
                style: const TextStyle(fontSize: 9.5, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 6),
          isStatus
              ? Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                )
              : Text(
                  value,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
        ],
      ),
    );
  }

  String _formatPrice(double price) {
    if (price == price.toInt()) {
      return price.toInt().toString().replaceAllMapped(
            RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
            (Match m) => '${m[1]},',
          );
    }
    return price.toStringAsFixed(2);
  }
}
