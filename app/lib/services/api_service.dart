import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';

class ApiService {
  static const String _baseUrlKey = 'api_base_url';
  static const String defaultBaseUrl = 'https://api-production-142c.up.railway.app';

  /// Fetch the current API Base URL from settings, defaulting to the production backend
  static Future<String> getApiBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    String url = prefs.getString(_baseUrlKey) ?? defaultBaseUrl;
    // Normalize: remove trailing slash
    if (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  /// Update the API Base URL in user preferences
  static Future<bool> setApiBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    String cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.substring(0, cleanUrl.length - 1);
    }
    return await prefs.setString(_baseUrlKey, cleanUrl);
  }

  /// Calls GET /api/scrape?url=<productUrl>
  static Future<Product> scrapeProduct(String productUrl) async {
    final baseUrl = await getApiBaseUrl();
    final encodedUrl = Uri.encodeComponent(productUrl);
    final requestUri = Uri.parse('$baseUrl/api/scrape?url=$encodedUrl');

    print('[ApiService] Scraping URL: $requestUri');
    final response = await http.get(
      requestUri,
      headers: {'User-Agent': 'PriceGraph-Flutter-App/1.0'},
    ).timeout(const Duration(seconds: 30));

    if (response.statusCode == 200) {
      final jsonResponse = jsonDecode(response.body);
      if (jsonResponse is Map<String, dynamic> && jsonResponse['success'] == true) {
        return Product.fromJson(jsonResponse);
      } else {
        final errorMsg = jsonResponse['error'] ?? 'Scraper failed to parse this product';
        throw Exception(errorMsg);
      }
    } else {
      Map<String, dynamic>? errorJson;
      try {
        errorJson = jsonDecode(response.body);
      } catch (_) {}
      final errorMsg = errorJson?['error'] ?? 'HTTP Error: ${response.statusCode}';
      throw Exception(errorMsg);
    }
  }

  /// Calls GET /api/deals with optional filters
  static Future<List<Product>> getDeals({
    String? category,
    double? maxPrice,
    String? platform,
    String? search,
    String? sort,
  }) async {
    final baseUrl = await getApiBaseUrl();
    
    // Construct query parameters
    final Map<String, String> queryParams = {};
    if (category != null && category.isNotEmpty) {
      queryParams['category'] = category;
    }
    if (maxPrice != null) {
      queryParams['maxPrice'] = maxPrice.toString();
    }
    if (platform != null && platform.isNotEmpty && platform != 'All') {
      queryParams['platform'] = platform;
    }
    if (search != null && search.isNotEmpty) {
      queryParams['search'] = search;
    }
    if (sort != null && sort.isNotEmpty) {
      queryParams['sort'] = sort;
    }

    final uri = Uri.parse('$baseUrl/api/deals').replace(queryParameters: queryParams);
    print('[ApiService] Fetching deals: $uri');

    final response = await http.get(
      uri,
      headers: {'User-Agent': 'PriceGraph-Flutter-App/1.0'},
    ).timeout(const Duration(seconds: 15));

    if (response.statusCode == 200) {
      final jsonResponse = jsonDecode(response.body);
      if (jsonResponse is Map<String, dynamic> && jsonResponse['success'] == true) {
        final dealsList = jsonResponse['deals'] as List?;
        if (dealsList == null) return [];
        return dealsList.map((item) => Product.fromJson(item)).toList();
      } else {
        throw Exception(jsonResponse['error'] ?? 'Failed to load deals catalog');
      }
    } else {
      throw Exception('Failed to connect to backend: status ${response.statusCode}');
    }
  }

  /// Calls GET /api/categories
  static Future<List<String>> getCategories() async {
    final baseUrl = await getApiBaseUrl();
    final uri = Uri.parse('$baseUrl/api/categories');
    print('[ApiService] Fetching categories: $uri');

    final response = await http.get(
      uri,
      headers: {'User-Agent': 'PriceGraph-Flutter-App/1.0'},
    ).timeout(const Duration(seconds: 10));

    if (response.statusCode == 200) {
      final jsonResponse = jsonDecode(response.body);
      if (jsonResponse is Map<String, dynamic> && jsonResponse['success'] == true) {
        final cats = jsonResponse['categories'] as List?;
        if (cats == null) return [];
        return cats.map((e) => e.toString()).toList();
      } else {
        throw Exception(jsonResponse['error'] ?? 'Failed to load categories');
      }
    } else {
      throw Exception('Failed to connect to backend: status ${response.statusCode}');
    }
  }
}
