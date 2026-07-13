import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../models/price_point.dart';
import '../theme/app_theme.dart';

class PriceChart extends StatefulWidget {
  final List<PriceHistoryPoint> history;

  const PriceChart({
    super.key,
    required this.history,
  });

  @override
  State<PriceChart> createState() => _PriceChartState();
}

class _PriceChartState extends State<PriceChart> {
  String _selectedRange = '3m'; // '1m', '3m', 'max'

  List<PriceHistoryPoint> get _filteredHistory {
    if (widget.history.isEmpty) return [];

    // Sort history by date first (just in case)
    final sorted = List<PriceHistoryPoint>.from(widget.history)
      ..sort((a, b) => a.timestamp.compareTo(b.timestamp));

    final now = DateTime.now();
    DateTime cutoff;
    if (_selectedRange == '1m') {
      cutoff = now.subtract(const Duration(days: 30));
    } else if (_selectedRange == '3m') {
      cutoff = now.subtract(const Duration(days: 90));
    } else {
      return sorted; // Max
    }

    final filtered = sorted.where((p) => p.timestamp.isAfter(cutoff)).toList();
    
    // If filtering left us with less than 2 items, return at least the last few items
    if (filtered.length < 2) {
      if (sorted.length >= 2) {
        return sorted.sublist(sorted.length - 2);
      }
      return sorted;
    }
    return filtered;
  }

  String _formatDate(DateTime dt) {
    final months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${dt.day} ${months[dt.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredHistory;

    if (filtered.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No historical price data available')),
      );
    }

    // Generate spots
    final List<FlSpot> spots = [];
    double minY = filtered.first.price;
    double maxY = filtered.first.price;

    final firstMs = filtered.first.timestamp.millisecondsSinceEpoch.toDouble();
    final lastMs = filtered.last.timestamp.millisecondsSinceEpoch.toDouble();

    for (int i = 0; i < filtered.length; i++) {
      final point = filtered[i];
      // Normalize X axis scale to make sure fl_chart handles it correctly
      // We can represent X as time progress from 0.0 to 1.0, or use timestamps.
      // Let's use timestamps directly, but we can set minX and maxX
      spots.add(FlSpot(
        point.timestamp.millisecondsSinceEpoch.toDouble(),
        point.price,
      ));

      if (point.price < minY) minY = point.price;
      if (point.price > maxY) maxY = point.price;
    }

    // Add padding to Y axis
    final yPadding = (maxY - minY) * 0.15;
    final chartMinY = (minY - yPadding).clamp(0.0, double.infinity);
    final chartMaxY = maxY + yPadding;

    return Column(
      children: [
        // Range Filters (1M, 3M, Max)
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Price History',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
              ),
            ),
            Row(
              children: [
                _buildRangeButton('1m', '1 Month'),
                const SizedBox(width: 6),
                _buildRangeButton('3m', '3 Month'),
                const SizedBox(width: 6),
                _buildRangeButton('max', 'Max'),
              ],
            ),
          ],
        ),
        const SizedBox(height: 20),
        
        // Chart Area
        SizedBox(
          height: 220,
          child: LineChart(
            LineChartData(
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                horizontalInterval: (chartMaxY - chartMinY) / 4,
                getDrawingHorizontalLine: (value) {
                  return const FlLine(
                    color: AppTheme.borderClean,
                    strokeWidth: 1,
                    dashArray: [5, 5],
                  );
                },
              ),
              titlesData: FlTitlesData(
                show: true,
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 45,
                    interval: (chartMaxY - chartMinY) / 3,
                    getTitlesWidget: (value, meta) {
                      if (value == meta.max || value == meta.min) return const SizedBox();
                      // Format to thousands for cleaner look if > 1000
                      String label;
                      if (value >= 1000) {
                        label = '₹${(value / 1000).toStringAsFixed(1)}k';
                      } else {
                        label = '₹${value.toStringAsFixed(0)}';
                      }
                      return Text(
                        label,
                        style: const TextStyle(
                          color: AppTheme.textMuted,
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      );
                    },
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    // Ensure we don't draw too many dates (e.g. limit to 3 or 4)
                    interval: (lastMs - firstMs) / 3.0 > 0 ? (lastMs - firstMs) / 3.0 : 1.0,
                    getTitlesWidget: (value, meta) {
                      if (value < firstMs || value > lastMs) return const SizedBox();
                      final date = DateTime.fromMillisecondsSinceEpoch(value.toInt());
                      return SideTitleWidget(
                        meta: meta,
                        space: 4.0,
                        child: Text(
                          _formatDate(date),
                          style: const TextStyle(
                            color: AppTheme.textMuted,
                            fontSize: 10,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              borderData: FlBorderData(show: false),
              minX: firstMs,
              maxX: lastMs,
              minY: chartMinY,
              maxY: chartMaxY,
              lineBarsData: [
                LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  color: AppTheme.accentIndigo,
                  barWidth: 3,
                  isStrokeCapRound: true,
                  dotData: const FlDotData(show: false),
                  belowBarData: BarAreaData(
                    show: true,
                    gradient: LinearGradient(
                      colors: [
                        AppTheme.accentIndigo.withOpacity(0.18),
                        AppTheme.accentIndigo.withOpacity(0.0),
                      ],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                ),
              ],
              lineTouchData: LineTouchData(
                handleBuiltInTouches: true,
                touchTooltipData: LineTouchTooltipData(
                  getTooltipItems: (List<LineBarSpot> touchedBarSpots) {
                    return touchedBarSpots.map((barSpot) {
                      final date = DateTime.fromMillisecondsSinceEpoch(barSpot.x.toInt());
                      final price = barSpot.y;
                      return LineTooltipItem(
                        '₹${price.toStringAsFixed(0)}\n${_formatDate(date)}',
                        const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      );
                    }).toList();
                  },
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildRangeButton(String range, String label) {
    final bool isActive = _selectedRange == range;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedRange = range;
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? AppTheme.accentIndigo : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isActive ? AppTheme.accentIndigo : AppTheme.borderClean,
            width: 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isActive ? Colors.white : AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
