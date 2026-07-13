import 'package:flutter/material.dart';

class AppTheme {
  // Primary & Accent Colors
  static const Color primary = Color(0xFF2563EB); // Web Blue
  static const Color accentIndigo = Color(0xFF4F46E5);
  static const Color accentIndigoLight = Color(0xFF818CF8);
  
  // Background & Surface
  static const Color bgMain = Color(0xFFF8FAFC);
  static const Color bgCard = Color(0xFFFFFFFF);
  static const Color borderClean = Color(0xFFE2E8F0);
  
  // Text Colors
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF475569);
  static const Color textMuted = Color(0xFF94A3B8);
  
  // Status Colors
  static const Color colorGreen = Color(0xFF10B981);
  static const Color colorGreenDark = Color(0xFF059669);
  static const Color colorOrange = Color(0xFFF59E0B);
  static const Color colorRed = Color(0xFFEF4444);

  // Card Decoration with Glassmorphism shadow & subtle border
  static BoxDecoration glassCardDecoration = BoxDecoration(
    color: bgCard,
    borderRadius: BorderRadius.circular(16.0),
    border: Border.all(color: borderClean, width: 1.0),
    boxShadow: const [
      BoxShadow(
        color: Color(0x050F172A),
        offset: Offset(0, 4),
        blurRadius: 6,
        spreadRadius: -1,
      ),
      BoxShadow(
        color: Color(0x0A0F172A),
        offset: Offset(0, 10),
        blurRadius: 15,
        spreadRadius: -3,
      ),
    ],
  );

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: bgMain,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primary,
        surface: bgCard,
        onSurface: textPrimary,
        primary: primary,
        secondary: accentIndigo,
      ),
      cardTheme: CardThemeData(
        color: bgCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16.0),
          side: const BorderSide(color: borderClean, width: 1.0),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        iconTheme: IconThemeData(color: textPrimary),
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 20,
          fontWeight: FontWeight.bold,
        ),
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          color: textPrimary,
          fontSize: 28,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.5,
        ),
        headlineMedium: TextStyle(
          color: textPrimary,
          fontSize: 22,
          fontWeight: FontWeight.bold,
        ),
        titleLarge: TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
        bodyLarge: TextStyle(
          color: textSecondary,
          fontSize: 16,
        ),
        bodyMedium: TextStyle(
          color: textSecondary,
          fontSize: 14,
        ),
        labelMedium: TextStyle(
          color: textMuted,
          fontSize: 12,
        ),
      ),
    );
  }
}
