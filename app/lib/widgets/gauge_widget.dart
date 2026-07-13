import 'dart:math';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class GaugeWidget extends StatefulWidget {
  final double goodness; // 0.0 (Worst/High Price) to 1.0 (Best/Optimal)

  const GaugeWidget({
    super.key,
    required this.goodness,
  });

  @override
  State<GaugeWidget> createState() => _GaugeWidgetState();
}

class _GaugeWidgetState extends State<GaugeWidget> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1200),
      vsync: this,
    );
    _animation = Tween<double>(begin: 0.5, end: widget.goodness.clamp(0.0, 1.0)).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );
    _controller.forward();
    super.initState();
  }

  @override
  void didUpdateWidget(covariant GaugeWidget oldWidget) {
    if (oldWidget.goodness != widget.goodness) {
      _animation = Tween<double>(
        begin: _animation.value,
        end: widget.goodness.clamp(0.0, 1.0),
      ).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeOut),
      );
      _controller.reset();
      _controller.forward();
    }
    super.didUpdateWidget(oldWidget);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return CustomPaint(
          size: const Size(200, 110),
          painter: _GaugePainter(goodness: _animation.value),
        );
      },
    );
  }
}

class _GaugePainter extends CustomPainter {
  final double goodness;

  _GaugePainter({required this.goodness});

  @override
  void paint(Canvas canvas, Size size) {
    final double width = size.width;
    final double height = size.height;
    
    // The center of the semi-circle is at the bottom center of the canvas
    final Offset center = Offset(width / 2, height - 10);
    final double radius = min(width / 2 - 15, height - 20);

    // 1. Draw background track (grey arc)
    final Paint trackPaint = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 14.0
      ..strokeCap = StrokeCap.round;

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      pi, // Start angle: 180 degrees (left)
      pi, // Sweep angle: 180 degrees (to right)
      false,
      trackPaint,
    );

    // 2. Draw colored gradient arc
    final Rect arcRect = Rect.fromCircle(center: center, radius: radius);
    final Paint gradientPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 14.0
      ..strokeCap = StrokeCap.round
      ..shader = SweepGradient(
        colors: const [
          AppTheme.colorRed,     // Red (High Price)
          AppTheme.colorOrange,  // Orange/Yellow (Fair Price)
          AppTheme.colorGreen,   // Green (Optimal Price)
          AppTheme.colorGreenDark, // Deep Green
        ],
        stops: const [0.0, 0.4, 0.75, 1.0],
        startAngle: pi,
        endAngle: 2 * pi,
      ).createShader(arcRect);

    // Draw the colored gauge arc. We sweep exactly pi * goodness to fill up to the needle
    canvas.drawArc(
      arcRect,
      pi,
      pi * goodness,
      false,
      gradientPaint,
    );

    // 3. Draw needle
    final Paint needlePaint = Paint()
      ..color = AppTheme.accentIndigo
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    // Angle in radians (pi to 2*pi)
    final double needleAngle = pi + (goodness * pi);
    final double needleLength = radius * 0.82;

    // Calculate tip point
    final Offset tip = Offset(
      center.dx + needleLength * cos(needleAngle),
      center.dy + needleLength * sin(needleAngle),
    );

    // Calculate base perpendicular offsets for drawing a triangle needle
    final double perpendicularAngle = needleAngle + pi / 2;
    final double baseWidth = 5.0;
    
    final Offset leftBase = Offset(
      center.dx + baseWidth * cos(perpendicularAngle),
      center.dy + baseWidth * sin(perpendicularAngle),
    );
    final Offset rightBase = Offset(
      center.dx - baseWidth * cos(perpendicularAngle),
      center.dy - baseWidth * sin(perpendicularAngle),
    );

    final Path needlePath = Path()
      ..moveTo(leftBase.dx, leftBase.dy)
      ..lineTo(rightBase.dx, rightBase.dy)
      ..lineTo(tip.dx, tip.dy)
      ..close();

    canvas.drawPath(needlePath, needlePaint);
    canvas.drawCircle(center, 8.0, needlePaint);

    // Inner center circle (hub cap)
    canvas.drawCircle(
      center, 
      4.0, 
      Paint()..color = Colors.white..style = PaintingStyle.fill
    );
  }

  @override
  bool shouldRepaint(covariant _GaugePainter oldDelegate) {
    return oldDelegate.goodness != goodness;
  }
}
