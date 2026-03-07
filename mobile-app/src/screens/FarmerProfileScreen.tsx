import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  Linking,
  Alert,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { farmersAPI, API_BASE_URL } from '../services/api';
import { Farmer, Product, RootStackParamList } from '../types';

type FarmerProfileRouteProp = RouteProp<RootStackParamList, 'FarmerProfile'>;
type FarmerProfileNavigationProp = StackNavigationProp<RootStackParamList>;

const FarmerProfileScreen: React.FC = () => {
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const route = useRoute<FarmerProfileRouteProp>();
  const navigation = useNavigation<FarmerProfileNavigationProp>();
  const { farmerId } = route.params;

  const loadFarmerProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await farmersAPI.getById(farmerId);
      const data = response.data;
      setFarmer(data.farmer || data);
      setProducts(data.products || []);
    } catch (err) {
      if (__DEV__) console.error('Error loading farmer profile:', err);
      setError('Could not load farmer profile. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [farmerId]);

  useEffect(() => {
    loadFarmerProfile();
  }, [loadFarmerProfile]);

  const handleContact = async () => {
    if (farmer?.email) {
      try {
        await Linking.openURL(`mailto:${farmer.email}`);
      } catch {
        Alert.alert('Error', 'Unable to open email client.');
      }
    }
  };

  const handleCall = async () => {
    const phone = farmer?.farm_phone || farmer?.phone;
    if (phone) {
      try {
        await Linking.openURL(`tel:${phone}`);
      } catch {
        Alert.alert('Error', 'Unable to open phone dialer.');
      }
    }
  };

  const navigateToProduct = (product: Product) => {
    navigation.navigate('ProductDetail', { product });
  };

  const renderProductItem = ({ item }: { item: Product }) => (
    <TouchableOpacity
      style={styles.productCard}
      onPress={() => navigateToProduct(item)}
    >
      <Image
        source={{
          uri: item.image_url
            ? (item.image_url.startsWith('http') ? item.image_url : `${API_BASE_URL}${item.image_url}`)
            : item.image
            ? `${API_BASE_URL}/static/uploads/products/${item.image}`
            : 'https://via.placeholder.com/100',
        }}
        style={styles.productImage}
      />
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.productPrice}>₱{item.price}</Text>
        <Text style={styles.productStock}>
          {item.quantity} {item.unit} available
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading farmer profile...</Text>
      </View>
    );
  }

  if (error || !farmer) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={80} color="#dc3545" />
        <Text style={styles.errorTitle}>Oops!</Text>
        <Text style={styles.errorText}>{error || 'Farmer not found'}</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={18} color="#fff" />
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const farmLocation =
    farmer.farm_location || farmer.exact_address || farmer.overall_location;
  const farmPhone = farmer.farm_phone || farmer.phone;

  return (
    <ScrollView style={styles.container}>
      {/* Header Section */}
      <View style={styles.headerSection}>
        <View style={styles.avatarContainer}>
          {farmer.profile_picture ? (
            <Image
              source={{
                uri: (typeof farmer.profile_picture === 'string' && farmer.profile_picture.startsWith('http')) ? farmer.profile_picture : `${API_BASE_URL}/static/uploads/profiles/${farmer.profile_picture}`,
              }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={50} color="#fff" />
            </View>
          )}
          {farmer.is_verified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
            </View>
          )}
        </View>

        <Text style={styles.farmerName}>
          {farmer.first_name} {farmer.last_name || ''}
        </Text>
        <Text style={styles.farmName}>{farmer.farm_name || 'Local Farm'}</Text>

        <View style={styles.locationRow}>
          <Ionicons name="location" size={18} color="#E8F5E9" />
          <Text style={styles.locationText}>
            {farmLocation || 'Location not specified'}
          </Text>
        </View>
      </View>

      {/* Contact Section */}
      <View style={styles.contactSection}>
        <TouchableOpacity
          style={[styles.contactButton, styles.emailButton]}
          onPress={handleContact}
        >
          <Ionicons name="mail" size={22} color="#fff" />
          <Text style={styles.contactButtonText}>Contact</Text>
        </TouchableOpacity>

        {farmPhone && (
          <TouchableOpacity
            style={[styles.contactButton, styles.phoneButton]}
            onPress={handleCall}
          >
            <Ionicons name="call" size={22} color="#4CAF50" />
            <Text style={styles.phoneButtonText}>Call</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About the Farm</Text>
        <Text style={styles.aboutText}>
          {farmer.farm_description ||
            'Dedicated to growing fresh, quality produce for our community.'}
        </Text>

        {farmPhone && (
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={20} color="#666" />
            <Text style={styles.infoText}>{farmPhone}</Text>
          </View>
        )}

        {farmer.email && (
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={20} color="#666" />
            <Text style={styles.infoText}>{farmer.email}</Text>
          </View>
        )}

        {farmLocation && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={20} color="#666" />
            <Text style={[styles.infoText, { flex: 1 }]}>{farmLocation}</Text>
          </View>
        )}
      </View>

      {/* Products Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Products</Text>
          <Text style={styles.productCount}>{products.length} items</Text>
        </View>

        {products.length === 0 ? (
          <View style={styles.emptyProducts}>
            <Ionicons name="basket-outline" size={50} color="#ccc" />
            <Text style={styles.emptyText}>No products available</Text>
          </View>
        ) : (
          <FlatList
            data={products}
            renderItem={renderProductItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.productsListContent}
          />
        )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
    gap: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerSection: {
    backgroundColor: '#4CAF50',
    padding: 25,
    alignItems: 'center',
    paddingTop: 15,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 15,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#fff',
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 2,
  },
  farmerName: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
  },
  farmName: {
    fontSize: 18,
    color: '#E8F5E9',
    marginTop: 5,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  locationText: {
    color: '#E8F5E9',
    fontSize: 14,
    flex: 1,
    textAlign: 'center',
  },
  contactSection: {
    flexDirection: 'row',
    gap: 12,
    padding: 15,
    paddingTop: 20,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  emailButton: {
    backgroundColor: '#4CAF50',
  },
  phoneButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  contactButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  phoneButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 12,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  productCount: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  aboutText: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
    marginBottom: 15,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
  },
  emptyProducts: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
  },
  productsListContent: {
    paddingVertical: 5,
  },
  productCard: {
    width: 160,
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    marginRight: 12,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: 120,
    backgroundColor: '#eee',
  },
  productInfo: {
    padding: 10,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  productStock: {
    fontSize: 12,
    color: '#888',
    marginTop: 3,
  },
});

export default FarmerProfileScreen;
