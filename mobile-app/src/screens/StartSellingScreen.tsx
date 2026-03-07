import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';

type StartSellingNavigationProp = StackNavigationProp<RootStackParamList>;

const StartSellingScreen: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { user, updateProfile } = useAuth();
  const navigation = useNavigation<StartSellingNavigationProp>();

  const handleActivateSeller = async () => {
    setIsLoading(true);
    try {
      const success = await updateProfile({ is_farmer: true });
      if (success) {
        Alert.alert(
          'Congratulations! 🎉',
          'Your seller account has been activated. You can now access My Shop to manage your farm profile and products.',
          [
            {
              text: 'Go to My Shop',
              onPress: () => navigation.navigate('FarmerDashboard'),
            },
          ]
        );
      } else {
        Alert.alert('Error', 'Failed to activate seller account. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to activate seller account. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="lock-closed-outline" size={80} color="#ccc" />
          <Text style={styles.emptyTitle}>Login Required</Text>
          <Text style={styles.emptyText}>
            Please login or create an account to start selling on FarmtoClick.
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={styles.primaryButtonText}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('Register')}
            >
              <Text style={styles.outlineButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (user.is_farmer) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle" size={80} color="#4CAF50" />
          <Text style={styles.emptyTitle}>You're Already a Seller!</Text>
          <Text style={styles.emptyText}>
            Manage your shop and products from your dashboard.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('FarmerDashboard')}
          >
            <Ionicons name="storefront" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Go to My Shop</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Hero Section */}
      <View style={styles.heroSection}>
        <View style={styles.heroIcon}>
          <Ionicons name="storefront" size={60} color="#4CAF50" />
        </View>
        <Text style={styles.heroTitle}>Start Selling on FarmtoClick</Text>
        <Text style={styles.heroSubtitle}>
          Join thousands of farmers selling fresh produce directly to customers
        </Text>
      </View>

      {/* Benefits Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Why Sell on FarmtoClick?</Text>

        <View style={styles.benefitCard}>
          <View style={[styles.benefitIcon, { backgroundColor: '#E3F2FD' }]}>
            <Ionicons name="people" size={28} color="#1565C0" />
          </View>
          <View style={styles.benefitContent}>
            <Text style={styles.benefitTitle}>Direct to Customers</Text>
            <Text style={styles.benefitText}>
              Sell directly to customers without middlemen
            </Text>
          </View>
        </View>

        <View style={styles.benefitCard}>
          <View style={[styles.benefitIcon, { backgroundColor: '#E8F5E9' }]}>
            <Ionicons name="cash" size={28} color="#2E7D32" />
          </View>
          <View style={styles.benefitContent}>
            <Text style={styles.benefitTitle}>Better Profits</Text>
            <Text style={styles.benefitText}>
              Keep more of your earnings with transparent pricing
            </Text>
          </View>
        </View>

        <View style={styles.benefitCard}>
          <View style={[styles.benefitIcon, { backgroundColor: '#FFF3E0' }]}>
            <Ionicons name="phone-portrait" size={28} color="#E65100" />
          </View>
          <View style={styles.benefitContent}>
            <Text style={styles.benefitTitle}>Easy Management</Text>
            <Text style={styles.benefitText}>
              Manage products, orders, and inventory from your phone
            </Text>
          </View>
        </View>

        <View style={styles.benefitCard}>
          <View style={[styles.benefitIcon, { backgroundColor: '#F3E5F5' }]}>
            <Ionicons name="bicycle" size={28} color="#7B1FA2" />
          </View>
          <View style={styles.benefitContent}>
            <Text style={styles.benefitTitle}>Delivery Support</Text>
            <Text style={styles.benefitText}>
              Easy integration with Lalamove for deliveries
            </Text>
          </View>
        </View>
      </View>

      {/* Getting Started Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How It Works</Text>

        <View style={styles.stepCard}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>1</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Activate Your Account</Text>
            <Text style={styles.stepText}>
              Click the button below to become a seller
            </Text>
          </View>
        </View>

        <View style={styles.stepCard}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>2</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Set Up Your Shop</Text>
            <Text style={styles.stepText}>
              Add your farm details and upload your products
            </Text>
          </View>
        </View>

        <View style={styles.stepCard}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>3</Text>
          </View>
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Start Selling</Text>
            <Text style={styles.stepText}>
              Receive orders and manage your farm business
            </Text>
          </View>
        </View>
      </View>

      {/* CTA Section */}
      <View style={styles.ctaSection}>
        <Text style={styles.ctaText}>Ready to start your farming business?</Text>
        <TouchableOpacity
          style={[styles.activateButton, isLoading && styles.activateButtonDisabled]}
          onPress={handleActivateSeller}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.activateButtonText}>Activate Seller Account</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={18} color="#666" />
          <Text style={styles.backButtonText}>Back to Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4CAF50',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 10,
  },
  outlineButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
  },
  heroSection: {
    backgroundColor: '#4CAF50',
    padding: 30,
    alignItems: 'center',
  },
  heroIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#E8F5E9',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
  section: {
    backgroundColor: '#fff',
    margin: 15,
    marginBottom: 0,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  benefitIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  benefitText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  stepNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  stepNumberText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  stepText: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  ctaSection: {
    padding: 20,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  activateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
    width: '100%',
    justifyContent: 'center',
  },
  activateButtonDisabled: {
    opacity: 0.6,
  },
  activateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    gap: 5,
  },
  backButtonText: {
    color: '#666',
    fontSize: 14,
  },
});

export default StartSellingScreen;
