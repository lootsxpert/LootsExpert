import 'dart:math';
import 'price_point.dart';

class Product {
  final int? id;
  final String url;
  final String platform;
  final String title;
  final String image;
  final double rating;
  final String? category;
  final double currentPrice;
  final double originalPrice;
  final String discount;
  final int dealScore;
  final String? dealTag;
  final String? historyUrl;
  final String? historySource;
  final List<PriceHistoryPoint> history;

  Product({
    this.id,
    required this.url,
    required this.platform,
    required this.title,
    required this.image,
    required this.rating,
    this.category,
    required this.currentPrice,
    required this.originalPrice,
    required this.discount,
    required this.dealScore,
    this.dealTag,
    this.historyUrl,
    this.historySource,
    required this.history,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    // The API scrape route returns success details nested differently or flat.
    // E.g., /api/scrape returns flat data: { platform, title, image, price, originalPrice, discount, rating, history: [...] }
    // /api/deals returns flat items matching database columns: { id, url, platform, title, image, rating, category, current_price, original_price, discount, deal_score, deal_tag, history_url }
    
    // Normalize prices (some are numeric, some string)
    double currPrice = 0.0;
    if (json['current_price'] != null) {
      currPrice = double.tryParse(json['current_price'].toString()) ?? 0.0;
    } else if (json['price'] != null) {
      currPrice = double.tryParse(json['price'].toString()) ?? 0.0;
    }

    double origPrice = 0.0;
    if (json['original_price'] != null) {
      origPrice = double.tryParse(json['original_price'].toString()) ?? currPrice;
    } else if (json['originalPrice'] != null) {
      origPrice = double.tryParse(json['originalPrice'].toString()) ?? currPrice;
    }

    // Parse history
    List<PriceHistoryPoint> historyPoints = [];
    if (json['history'] != null && json['history'] is List) {
      historyPoints = (json['history'] as List)
          .map((item) => PriceHistoryPoint.fromJson(item))
          .toList();
    }

    // Parse rating (decimals in PostgreSQL or float/int from live scrape)
    double parsedRating = 0.0;
    if (json['rating'] != null) {
      parsedRating = double.tryParse(json['rating'].toString()) ?? 0.0;
    }

    // Clean discount
    String discountStr = json['discount']?.toString() ?? '';
    if (discountStr.isEmpty && origPrice > currPrice && origPrice > 0) {
      int pct = (((origPrice - currPrice) / origPrice) * 100).round();
      discountStr = '$pct% OFF';
    }

    // Build the Product instance
    final product = Product(
      id: json['id'] as int?,
      url: json['url']?.toString() ?? '',
      platform: json['platform']?.toString() ?? 'Unknown',
      title: json['title']?.toString() ?? 'No Title',
      image: json['image']?.toString() ?? '',
      rating: parsedRating,
      category: json['category']?.toString(),
      currentPrice: currPrice,
      originalPrice: origPrice,
      discount: discountStr.isEmpty ? '0% OFF' : discountStr,
      dealScore: int.tryParse(json['deal_score']?.toString() ?? '') ?? 
                 int.tryParse(json['dealScore']?.toString() ?? '') ?? 0,
      dealTag: json['deal_tag']?.toString() ?? json['dealTag']?.toString(),
      historyUrl: json['history_url']?.toString() ?? json['historyUrl']?.toString(),
      historySource: json['historySource']?.toString(),
      history: historyPoints,
    );

    // If history is insufficient, fill with simulated fallback matching web behavior
    if (product.history.length < 2) {
      return product.copyWith(history: _generateSimulatedHistory(currPrice));
    }

    return product;
  }

  Product copyWith({List<PriceHistoryPoint>? history}) {
    return Product(
      id: id,
      url: url,
      platform: platform,
      title: title,
      image: image,
      rating: rating,
      category: category,
      currentPrice: currentPrice,
      originalPrice: originalPrice,
      discount: discount,
      dealScore: dealScore,
      dealTag: dealTag,
      historyUrl: historyUrl,
      historySource: historySource,
      history: history ?? this.history,
    );
  }

  // Fallback: Generate a 180-day random walk simulation
  static List<PriceHistoryPoint> _generateSimulatedHistory(double currentPrice) {
    final List<PriceHistoryPoint> simHistory = [];
    final int days = 180;
    double tempPrice = currentPrice;
    final DateTime today = DateTime.now();
    final Random random = Random();

    for (int i = days - 1; i >= 0; i--) {
      final DateTime date = today.subtract(Duration(days: i));
      // Fluctuate around currentPrice, bounds between 85% and 118% of current price
      final double fluctuation = (random.nextDouble() - 0.45) * 0.02 * currentPrice;
      tempPrice = max(currentPrice * 0.85, min(currentPrice * 1.18, tempPrice - fluctuation));

      simHistory.add(PriceHistoryPoint(
        price: tempPrice.roundToDouble(),
        timestamp: date,
      ));
    }
    
    // Ensure the last element matches exactly the current price
    if (simHistory.isNotEmpty) {
      simHistory[simHistory.length - 1] = PriceHistoryPoint(
        price: currentPrice,
        timestamp: today,
      );
    }

    return simHistory;
  }
}
