import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import 'product_detail_screen.dart';
import 'main_navigation.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _urlController = TextEditingController();
  bool _isLoading = false;
  String _loadingText = 'Initiating crawler...';
  double _loadingPercent = 0.0;
  String? _errorMessage;
  Timer? _loadingTimer;

  // Pre-configured demo links from the web app
  final List<Map<String, String>> _demos = [
    {
      'title': 'HP Laptop',
      'icon': 'laptop',
      'url': 'https://www.amazon.in/HP-i5-1334U-Anti-glare-15-6-inch-Graphics/dp/B0D4LWYWF9'
    },
    {
      'title': 'iPhone 16e',
      'icon': 'phone_iphone',
      'url': 'https://www.amazon.in/iPhone-16e-512-Intelligence-Supersized/dp/B0DXQJ1M7H'
    },
    {
      'title': 'Headphones',
      'icon': 'headphones',
      'url': 'https://www.flipkart.com/zebronics-zeb-duke-60h-backup-bt-v5-3-gaming-mode-enc-led-lights-dual-pairing-bluetooth/p/itm688c968a793cd?pid=ACCFRR83EFREFT2U&lid=LSTACCFRR83EFREFT2UDRHPHC&marketplace=FLIPKART&cmpid=content_headphone_8965229628_gmc'
    }
  ];

  @override
  void dispose() {
    _urlController.dispose();
    _loadingTimer?.cancel();
    super.dispose();
  }

  void _startLoadingSimulation() {
    _loadingTimer?.cancel();
    setState(() {
      _isLoading = true;
      _loadingText = 'Initiating crawler...';
      _loadingPercent = 0.05;
      _errorMessage = null;
    });

    int seconds = 0;
    _loadingTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      seconds++;
      if (!mounted) return;

      setState(() {
        if (seconds == 2) {
          _loadingText = 'Resolving product page...';
          _loadingPercent = 0.25;
        } else if (seconds == 5) {
          _loadingText = 'Extracting prices & details...';
          _loadingPercent = 0.55;
        } else if (seconds == 8) {
          _loadingText = 'Querying historical data...';
          _loadingPercent = 0.80;
        } else if (seconds == 11) {
          _loadingText = 'Finalizing analysis...';
          _loadingPercent = 0.95;
        }
      });
    });
  }

  void _triggerScraping(String url) async {
    final cleanUrl = url.trim();
    if (cleanUrl.isEmpty) return;

    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setState(() {
        _errorMessage = 'Invalid URL format. URL must start with http:// or https://';
      });
      return;
    }

    _startLoadingSimulation();

    try {
      final product = await ApiService.scrapeProduct(cleanUrl);
      _loadingTimer?.cancel();
      
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _urlController.clear();
      });

      // Navigate to detail page
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => ProductDetailScreen(
            initialProduct: product,
            productUrl: cleanUrl,
          ),
        ),
      );
    } catch (e) {
      _loadingTimer?.cancel();
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  IconData _getIconData(String name) {
    switch (name) {
      case 'laptop':
        return Icons.laptop_chromebook;
      case 'phone_iphone':
        return Icons.phone_iphone;
      case 'headphones':
        return Icons.headphones;
      default:
        return Icons.shopping_bag;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Hero Eyebrow
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.auto_awesome, color: AppTheme.primary, size: 14),
                      SizedBox(width: 6),
                      Text(
                        'Price History & Tracker',
                        style: TextStyle(
                          color: AppTheme.primary,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Hero Headline
            RichText(
              text: const TextSpan(
                text: 'Find ',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 32,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
                children: [
                  TextSpan(
                    text: 'Real Deals\n',
                    style: TextStyle(color: AppTheme.colorGreen),
                  ),
                  TextSpan(text: 'Skip the '),
                  TextSpan(
                    text: 'Fake Ones',
                    style: TextStyle(color: AppTheme.colorRed),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            
            // Subtitle
            const Text(
              'Track genuine price drops, compare across stores, and shop smarter every day',
              style: TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 24),

            // Search Bar Input Form
            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppTheme.borderClean, width: 1.0),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x040F172A),
                    offset: Offset(0, 4),
                    blurRadius: 10,
                  ),
                ],
              ),
              padding: const EdgeInsets.all(4.0),
              child: Row(
                children: [
                  const SizedBox(width: 12),
                  const Icon(Icons.search, color: AppTheme.textMuted),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _urlController,
                      enabled: !_isLoading,
                      decoration: const InputDecoration(
                        hintText: 'Paste Flipkart / Amazon link...',
                        hintStyle: TextStyle(color: AppTheme.textMuted, fontSize: 13),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 12),
                      ),
                      keyboardType: TextInputType.url,
                      onSubmitted: _triggerScraping,
                    ),
                  ),
                  ElevatedButton(
                    onPressed: _isLoading 
                        ? null 
                        : () => _triggerScraping(_urlController.text),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: const Text('Search', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Quick Demo Links
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Quick Demo:',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textSecondary,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: _demos.map((d) {
                    return Expanded(
                      child: GestureDetector(
                        onTap: _isLoading
                            ? null
                            : () {
                                _urlController.text = d['url']!;
                                _triggerScraping(d['url']!);
                              },
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.borderClean, width: 1.0),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                _getIconData(d['icon']!), 
                                size: 13, 
                                color: AppTheme.textSecondary
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  d['title']!,
                                  style: const TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.textSecondary,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
            const SizedBox(height: 30),

            // Hot Promo Banner
            GestureDetector(
              onTap: () {
                // Find parent MainNavigationState to switch tabs
                final navState = context.findAncestorStateOfType<MainNavigationState>();
                if (navState != null) {
                  navState.switchTab(1); // Switch to Deals Catalog tab
                }
              },
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16.0),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.primary.withOpacity(0.08),
                      AppTheme.accentIndigo.withOpacity(0.04),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16.0),
                  border: Border.all(color: AppTheme.primary.withOpacity(0.15), width: 1.0),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppTheme.accentIndigo,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.bolt, color: Colors.white, size: 12),
                          SizedBox(width: 4),
                          Text(
                            'HOT DEAL SCANNER',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'FLAT 15% - 70% OFF',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Real-time tracked price drops on Amazon, Flipkart, Myntra and more. Skip the fake markups!',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Row(
                      children: [
                        Text(
                          'View Best Discounts',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.primary,
                          ),
                        ),
                        SizedBox(width: 4),
                        Icon(Icons.arrow_forward, color: AppTheme.primary, size: 14),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Loading state
            if (_isLoading)
              GlassCard(
                child: Column(
                  children: [
                    LinearProgressIndicator(
                      value: _loadingPercent,
                      backgroundColor: AppTheme.borderClean,
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _loadingText,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        Text(
                          '${(_loadingPercent * 100).toInt()}%',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.primary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

            // Error state
            if (_errorMessage != null)
              Container(
                padding: const EdgeInsets.all(16.0),
                decoration: BoxDecoration(
                  color: AppTheme.colorRed.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(16.0),
                  border: Border.all(color: AppTheme.colorRed.withOpacity(0.2), width: 1.0),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.colorRed, size: 22),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Failed to Retrieve Details',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.colorRed,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            _errorMessage!,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.textSecondary,
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Text(
                              '💡 Tip: Make sure your scraper backend is running, and that the API Base URL is correctly configured in Settings.',
                              style: TextStyle(
                                fontSize: 10.5,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
