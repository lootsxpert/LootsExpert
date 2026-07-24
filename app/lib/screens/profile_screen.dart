import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_card.dart';
import 'auth_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  User? _currentUser;
  bool _isImporting = false;
  String _customName = '';
  final _nameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _currentUser = AuthService.currentUser;
    AuthService.userChanges.listen((user) {
      if (mounted) {
        setState(() {
          _currentUser = user;
        });
      }
    });
    _loadCustomName();
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _loadCustomName() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _customName = prefs.getString('user_custom_name') ?? '';
      _nameController.text = _customName;
    });
  }

  Future<void> _saveCustomName(String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_custom_name', name);
    setState(() {
      _customName = name;
    });
  }

  Future<void> _launchURL(String urlString) async {
    final Uri url = Uri.parse(urlString);
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not launch $urlString')),
        );
      }
    }
  }

  Future<void> _syncProductsCloud() async {
    setState(() {
      _isImporting = true;
    });

    // Simulate calling the backend to fetch synced tracked products by using the User's unique ID
    await Future.delayed(const Duration(seconds: 2));

    if (mounted) {
      setState(() {
        _isImporting = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Successfully synced 3 products from cloud database!'),
          backgroundColor: AppTheme.accentIndigo,
        ),
      );
    }
  }

  void _showEditNameDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Set Custom Name'),
        content: TextField(
          controller: _nameController,
          decoration: const InputDecoration(
            hintText: 'Enter your name',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              _saveCustomName(_nameController.text.trim());
              Navigator.pop(context);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final displayName = _customName.isNotEmpty 
        ? _customName 
        : (_currentUser?.displayName ?? _currentUser?.email?.split('@').first ?? 'Add Name');

    return Scaffold(
      backgroundColor: AppTheme.bgMain,
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(left: 20.0, right: 20.0, top: 40.0, bottom: 20.0),
        child: Column(
          children: [
            // User details card
            GlassCard(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 32,
                    backgroundColor: AppTheme.primary.withOpacity(0.1),
                    backgroundImage: _currentUser?.photoURL != null
                        ? NetworkImage(_currentUser!.photoURL!)
                        : null,
                    child: _currentUser?.photoURL == null
                        ? const Icon(Icons.person, size: 36, color: AppTheme.primary)
                        : null,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                displayName,
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.edit, size: 18, color: AppTheme.primary),
                              onPressed: _showEditNameDialog,
                              tooltip: 'Edit Name',
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _currentUser?.email ?? 'Sign in to sync your items',
                          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Website & Telegram Links List
            GlassCard(
              padding: const EdgeInsets.all(8),
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.language, color: Colors.blueAccent),
                    title: const Text('Our Website', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    subtitle: const Text('pricegraph.in'),
                    trailing: const Icon(Icons.open_in_new, size: 16, color: AppTheme.textMuted),
                    onTap: () => _launchURL('https://pricegraph.in'),
                  ),
                  const Divider(height: 1, color: AppTheme.borderClean),
                  ListTile(
                    leading: const Icon(Icons.privacy_tip_outlined, color: Colors.green),
                    title: const Text('Privacy Policy', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    trailing: const Icon(Icons.open_in_new, size: 16, color: AppTheme.textMuted),
                    onTap: () => _launchURL('https://pricegraph.in/privacy'),
                  ),
                  const Divider(height: 1, color: AppTheme.borderClean),
                  ListTile(
                    leading: const Icon(Icons.telegram, color: Color(0xFF54A9EB)),
                    title: const Text('Tracker Bot', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    subtitle: const Text('Track items on Telegram'),
                    trailing: const Icon(Icons.open_in_new, size: 16, color: AppTheme.textMuted),
                    onTap: () => _launchURL('https://t.me/THE_TRACKER_BOT'),
                  ),
                  const Divider(height: 1, color: AppTheme.borderClean),
                  ListTile(
                    leading: const Icon(Icons.telegram, color: Color(0xFF54A9EB)),
                    title: const Text('History Bot', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    subtitle: const Text('Check price history on Telegram'),
                    trailing: const Icon(Icons.open_in_new, size: 16, color: AppTheme.textMuted),
                    onTap: () => _launchURL('https://t.me/THE_HISTORY_BOT'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Logout Action
            if (_currentUser != null)
              GlassCard(
                padding: const EdgeInsets.all(8),
                child: ListTile(
                  leading: const Icon(Icons.logout, color: Colors.redAccent),
                  title: const Text('Sign Out', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                  trailing: const Icon(Icons.chevron_right, color: AppTheme.textMuted),
                  onTap: () async {
                    await AuthService.signOut();
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Successfully signed out.')),
                      );
                    }
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
