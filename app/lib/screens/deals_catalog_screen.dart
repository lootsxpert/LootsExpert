import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/product_card.dart';

class DealsCatalogScreen extends StatefulWidget {
  const DealsCatalogScreen({super.key});

  @override
  State<DealsCatalogScreen> createState() => _DealsCatalogScreenState();
}

class _DealsCatalogScreenState extends State<DealsCatalogScreen> {
  final TextEditingController _searchController = TextEditingController();
  List<Product> _deals = [];
  List<String> _categories = ['All'];
  
  bool _isLoading = true;
  String? _errorMessage;

  // Filter and Sorting state
  String _selectedCategory = 'All';
  String _selectedPlatform = 'All';
  String _selectedSort = 'deal_score_desc'; // 'deal_score_desc', 'price_asc', 'price_desc', 'popularity'
  
  final List<Map<String, String>> _platforms = [
    {'label': 'All Platforms', 'value': 'All'},
    {'label': 'Amazon', 'value': 'Amazon'},
    {'label': 'Flipkart', 'value': 'Flipkart'},
    {'label': 'Myntra', 'value': 'Myntra'},
    {'label': 'Ajio', 'value': 'Ajio'},
    {'label': 'Meesho', 'value': 'Meesho'},
  ];

  final List<Map<String, String>> _sortOptions = [
    {'label': 'Best Deal Score', 'value': 'deal_score_desc'},
    {'label': 'Price: Low to High', 'value': 'price_asc'},
    {'label': 'Price: High to Low', 'value': 'price_desc'},
    {'label': 'Popularity', 'value': 'popularity'},
  ];

  @override
  void initState() {
    _loadData();
    super.initState();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // 1. Fetch categories
      final fetchedCats = await ApiService.getCategories();
      
      // 2. Fetch deals
      final fetchedDeals = await ApiService.getDeals(
        category: _selectedCategory == 'All' ? null : _selectedCategory,
        platform: _selectedPlatform == 'All' ? null : _selectedPlatform,
        search: _searchController.text.trim(),
        sort: _selectedSort,
      );

      if (mounted) {
        setState(() {
          _categories = ['All', ...fetchedCats];
          _deals = fetchedDeals;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = e.toString().replaceAll('Exception: ', '');
        });
      }
    }
  }

  void _onSearchChanged(String val) {
    // Reload deals on search submit/change
    _loadData();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Filter Settings Panel
        Container(
          color: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          child: Column(
            children: [
              // Search Input Bar
              Container(
                decoration: BoxDecoration(
                  color: AppTheme.bgMain,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.borderClean, width: 1.0),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 10.0),
                child: Row(
                  children: [
                    const Icon(Icons.search, color: AppTheme.textMuted, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _searchController,
                        decoration: const InputDecoration(
                          hintText: 'Search within deals...',
                          hintStyle: TextStyle(color: AppTheme.textMuted, fontSize: 12),
                          border: InputBorder.none,
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 8.0),
                        ),
                        style: const TextStyle(fontSize: 13),
                        onSubmitted: _onSearchChanged,
                      ),
                    ),
                    if (_searchController.text.isNotEmpty)
                      GestureDetector(
                        onTap: () {
                          _searchController.clear();
                          _loadData();
                        },
                        child: const Icon(Icons.clear, color: AppTheme.textMuted, size: 16),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 10),

              // Filter Dropdowns
              Row(
                children: [
                  // Platform Filter
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppTheme.borderClean),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedPlatform,
                          isExpanded: true,
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11, fontWeight: FontWeight.w600),
                          items: _platforms.map((p) {
                            return DropdownMenuItem<String>(
                              value: p['value'],
                              child: Text(p['label']!),
                            );
                          }).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() => _selectedPlatform = val);
                              _loadData();
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Category Filter
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppTheme.borderClean),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedCategory,
                          isExpanded: true,
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11, fontWeight: FontWeight.w600),
                          items: _categories.map((c) {
                            return DropdownMenuItem<String>(
                              value: c,
                              child: Text(
                                c == 'All' ? 'All Categories' : c,
                                overflow: TextOverflow.ellipsis,
                              ),
                            );
                          }).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() => _selectedCategory = val);
                              _loadData();
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Sort Filter
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppTheme.borderClean),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedSort,
                          isExpanded: true,
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11, fontWeight: FontWeight.w600),
                          items: _sortOptions.map((s) {
                            return DropdownMenuItem<String>(
                              value: s['value'],
                              child: Text(s['label']!),
                            );
                          }).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() => _selectedSort = val);
                              _loadData();
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        // Deals List View
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadData,
            color: AppTheme.primary,
            child: _buildListContent(),
          ),
        ),
      ],
    );
  }

  Widget _buildListContent() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.primary),
      );
    }

    if (_errorMessage != null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20.0),
        children: [
          Container(
            padding: const EdgeInsets.all(16.0),
            decoration: BoxDecoration(
              color: AppTheme.colorRed.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.colorRed.withOpacity(0.2)),
            ),
            child: Column(
              children: [
                const Icon(Icons.error_outline, color: AppTheme.colorRed, size: 36),
                const SizedBox(height: 12),
                const Text(
                  'Failed to load deals catalog',
                  style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.colorRed),
                ),
                const SizedBox(height: 6),
                Text(
                  _errorMessage!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 12),
                ElevatedButton(
                  onPressed: _loadData,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.colorRed,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('Retry'),
                )
              ],
            ),
          )
        ],
      );
    }

    if (_deals.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(40),
        children: [
          const SizedBox(height: 40),
          Icon(Icons.shopping_bag_outlined, size: 60, color: AppTheme.textMuted.withOpacity(0.5)),
          const SizedBox(height: 16),
          const Text(
            'No Deals Found',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 8),
          const Text(
            'Try adjusting your category/platform filters or query.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
          ),
        ],
      );
    }

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16.0),
      itemCount: _deals.length,
      itemBuilder: (context, index) {
        return ProductCard(product: _deals[index]);
      },
    );
  }
}
