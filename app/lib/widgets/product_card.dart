import 'package:flutter/material.dart';
import '../models/product.dart';
import '../theme/app_theme.dart';
import '../screens/product_detail_screen.dart';

class ProductCard extends StatelessWidget {
  final Product product;

  const ProductCard({
    super.key,
    required this.product,
  });

  @override
  Widget build(BuildContext context) {
    // Determine platform badge color
    Color platformColor = AppTheme.primary;
    if (product.platform.toLowerCase().contains('amazon')) {
      platformColor = const Color(0xFFFF9900); // Amazon Orange
    } else if (product.platform.toLowerCase().contains('flipkart')) {
      platformColor = const Color(0xFF2874F0); // Flipkart Blue
    } else if (product.platform.toLowerCase().contains('myntra')) {
      platformColor = const Color(0xFFE61B72); // Myntra Pink
    }

    // Determine deal score color
    Color dealScoreColor = AppTheme.textSecondary;
    if (product.dealScore >= 75) {
      dealScoreColor = AppTheme.colorGreen;
    } else if (product.dealScore >= 40) {
      dealScoreColor = AppTheme.colorOrange;
    } else if (product.dealScore > 0) {
      dealScoreColor = AppTheme.colorRed;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16.0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.0),
        border: Border.all(color: AppTheme.borderClean, width: 1.0),
        boxShadow: const [
          BoxShadow(
            color: Color(0x030F172A),
            offset: Offset(0, 4),
            blurRadius: 6,
            spreadRadius: -1,
          ),
          BoxShadow(
            color: Color(0x060F172A),
            offset: Offset(0, 10),
            blurRadius: 15,
            spreadRadius: -3,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16.0),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => ProductDetailScreen(
                    initialProduct: product,
                    productUrl: product.url,
                  ),
                ),
              );
            },
            child: Padding(
              padding: const EdgeInsets.all(12.0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Product Image
                  Stack(
                    children: [
                      Container(
                        width: 90,
                        height: 90,
                        padding: const EdgeInsets.all(6.0),
                        decoration: BoxDecoration(
                          color: AppTheme.bgMain,
                          borderRadius: BorderRadius.circular(12.0),
                          border: Border.all(color: AppTheme.borderClean, width: 0.8),
                        ),
                        child: product.image.isNotEmpty
                            ? Image.network(
                                product.image,
                                fit: BoxFit.contain,
                                errorBuilder: (context, error, stackTrace) =>
                                    const Icon(Icons.image_not_supported, color: AppTheme.textMuted),
                              )
                            : const Icon(Icons.image, color: AppTheme.textMuted),
                      ),
                      
                      // Platform Badge
                      Positioned(
                        top: 4,
                        left: 4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: platformColor,
                            borderRadius: BorderRadius.circular(4.0),
                          ),
                          child: Text(
                            product.platform,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 8,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 14),

                  // Product Metadata Details
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Category and Deal Score
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              product.category ?? 'Unclassified',
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.textMuted,
                              ),
                            ),
                            if (product.dealScore > 0)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: dealScoreColor.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6.0),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.bolt, size: 10, color: dealScoreColor),
                                    Text(
                                      'Score: ${product.dealScore}',
                                      style: TextStyle(
                                        color: dealScoreColor,
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 6),

                        // Title
                        Text(
                          product.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                            height: 1.3,
                          ),
                        ),
                        const SizedBox(height: 8),

                        // Rating & Price row
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            // Ratings
                            Row(
                              children: [
                                const Icon(Icons.star, color: Colors.amber, size: 14),
                                const SizedBox(width: 2),
                                Text(
                                  product.rating > 0 ? product.rating.toStringAsFixed(1) : '—',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),

                            // Prices
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.baseline,
                                  textBaseline: TextBaseline.alphabetic,
                                  children: [
                                    if (product.originalPrice > product.currentPrice)
                                      Text(
                                        '₹${_formatPrice(product.originalPrice)}',
                                        style: const TextStyle(
                                          fontSize: 10,
                                          color: AppTheme.textMuted,
                                          decoration: TextDecoration.lineThrough,
                                        ),
                                      ),
                                    if (product.originalPrice > product.currentPrice)
                                      const SizedBox(width: 4),
                                    Text(
                                      '₹${_formatPrice(product.currentPrice)}',
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w800,
                                        color: AppTheme.textPrimary,
                                      ),
                                    ),
                                  ],
                                ),
                                if (product.originalPrice > product.currentPrice)
                                  Text(
                                    product.discount,
                                    style: const TextStyle(
                                      fontSize: 9,
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.colorGreen,
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
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
