import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../services/notification_service.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import 'product_detail_screen.dart';

class TrackedProductsScreen extends StatefulWidget {
  const TrackedProductsScreen({super.key});

  @override
  State<TrackedProductsScreen> createState() => _TrackedProductsScreenState();
}

class _TrackedProductsScreenState extends State<TrackedProductsScreen> {
  List<Map<String, dynamic>> _trackedItems = [];
  bool _isLoading = true;
  bool _isChecking = false;

  @override
  void initState() {
    super.initState();
    _loadTrackedProducts();
  }

  Future<void> _loadTrackedProducts() async {
    final prefs = await SharedPreferences.getInstance();
    final String? rawData = prefs.getString('tracked_products_list');
    if (rawData != null && rawData.isNotEmpty) {
      try {
        final List<dynamic> decoded = jsonDecode(rawData);
        setState(() {
          _trackedItems = decoded.cast<Map<String, dynamic>>();
          _isLoading = false;
        });
      } catch (e) {
        setState(() {
          _trackedItems = [];
          _isLoading = false;
        });
      }
    } else {
      setState(() {
        _trackedItems = [];
        _isLoading = false;
      });
    }
  }

  Future<void> _checkPriceChanges() async {
    if (_trackedItems.isEmpty) return;
    setState(() {
      _isChecking = true;
    });

    int updatedCount = 0;
    final prefs = await SharedPreferences.getInstance();

    for (int i = 0; i < _trackedItems.length; i++) {
      final item = _trackedItems[i];
      final String url = item['url'] ?? '';
      final double oldPrice = (item['price'] as num?)?.toDouble() ?? 0.0;

      if (url.isEmpty) continue;

      try {
        final updatedProduct = await ApiService.scrapeProduct(url);
        final double newPrice = updatedProduct.currentPrice;

        if (newPrice != oldPrice) {
          updatedCount++;
          // Trigger local notification
          String titleStr = 'Price Changed!';
          String bodyStr = '${updatedProduct.title.length > 30 ? updatedProduct.title.substring(0, 30) + '...' : updatedProduct.title} updated from ₹${oldPrice.toInt()} to ₹${newPrice.toInt()}';
          
          if (newPrice < oldPrice) {
            titleStr = '🎉 Price Dropped!';
          }

          await NotificationService.showPriceChangeNotification(
            id: i + 100,
            title: titleStr,
            body: bodyStr,
          );

          _trackedItems[i]['price'] = newPrice;
          _trackedItems[i]['last_checked'] = DateTime.now().toIso8601String();
        }
      } catch (e) {
        // Skip failed items gracefully
      }
    }

    await prefs.setString('tracked_products_list', jsonEncode(_trackedItems));
    if (mounted) {
      setState(() {
        _isChecking = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(updatedCount > 0
              ? 'Checked prices: $updatedCount item(s) changed!'
              : 'Checked prices: No changes detected.'),
        ),
      );
    }
  }

  Future<void> _removeTrackedProduct(int index) async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _trackedItems.removeAt(index);
    });
    await prefs.setString('tracked_products_list', jsonEncode(_trackedItems));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Product removed from tracking list.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgMain,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Tracked Products',
          style: TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.extrabold,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: _isChecking
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                : const Icon(Icons.sync, color: AppTheme.primary),
            onPressed: _isChecking ? null : _checkPriceChanges,
            tooltip: 'Check Price Updates',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _trackedItems.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.bookmark_border_rounded,
                          size: 64,
                          color: AppTheme.textMuted,
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'No Tracked Products',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Track any product while browsing or searching to automatically monitor price changes!',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 13,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _checkPriceChanges,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16.0),
                    itemCount: _trackedItems.length,
                    itemBuilder: (context, index) {
                      final item = _trackedItems[index];
                      final title = item['title'] ?? 'Product';
                      final image = item['image'] ?? '';
                      final platform = item['platform'] ?? 'General';
                      final price = (item['price'] as num?)?.toDouble() ?? 0.0;
                      final url = item['url'] ?? '';

                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12.0),
                        child: GlassCard(
                          padding: const EdgeInsets.all(12),
                          child: Row(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Container(
                                  width: 60,
                                  height: 60,
                                  color: Colors.white,
                                  child: image.isNotEmpty
                                      ? Image.network(
                                          image,
                                          fit: BoxFit.contain,
                                          errorBuilder: (context, error, stackTrace) =>
                                              const Icon(Icons.shopping_bag_outlined,
                                                  color: AppTheme.textMuted),
                                        )
                                      : const Icon(Icons.shopping_bag_outlined,
                                          color: AppTheme.textMuted),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: AppTheme.primary.withOpacity(0.1),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        platform.toUpperCase(),
                                        style: const TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.extrabold,
                                          color: AppTheme.primary,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                        color: AppTheme.textPrimary,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '₹${price.toInt()}',
                                      style: const TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.extrabold,
                                        color: AppTheme.accentIndigo,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline,
                                    color: Colors.redAccent, size: 20),
                                onPressed: () => _removeTrackedProduct(index),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
