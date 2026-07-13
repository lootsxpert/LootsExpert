import 'package:flutter/material.dart';
import 'screens/main_navigation.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const LootsExpertApp());
}

class LootsExpertApp extends StatelessWidget {
  const LootsExpertApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Price Graph',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const MainNavigation(),
    );
  }
}
