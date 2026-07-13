class PriceHistoryPoint {
  final double price;
  final DateTime timestamp;

  PriceHistoryPoint({
    required this.price,
    required this.timestamp,
  });

  factory PriceHistoryPoint.fromJson(Map<String, dynamic> json) {
    return PriceHistoryPoint(
      price: double.tryParse(json['price']?.toString() ?? '0') ?? 0.0,
      timestamp: json['timestamp'] != null 
          ? DateTime.tryParse(json['timestamp'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'price': price,
      'timestamp': timestamp.toIso8601String(),
    };
  }
}
