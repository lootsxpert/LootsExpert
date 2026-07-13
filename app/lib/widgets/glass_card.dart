import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class GlassCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final double? width;
  final double? height;
  final Color? color;
  final double borderRadius;
  final Border? border;

  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16.0),
    this.margin,
    this.width,
    this.height,
    this.color,
    this.borderRadius = 16.0,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? AppTheme.bgCard,
        borderRadius: BorderRadius.circular(borderRadius),
        border: border ?? Border.all(color: AppTheme.borderClean, width: 1.0),
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
      child: child,
    );
  }
}
