import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  TextInput,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../context/AuthContext';
import { productsAPI, cartAPI, API_BASE_URL } from '../services/api';
import { useCart } from '../context/CartContext';
import { Product } from '../types';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { resolveProductImage } from '../utils/helpers';
import { HomeScreenSkeleton } from '../components/SkeletonLoading';

type HomeScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;

import { RootStackParamList } from '../types';

const { width } = Dimensions.get('window');

const HomeScreen: React.FC = () => {
  const { refreshCartCount } = useCart();

  const handleAddToCart = async (product: Product) => {
    try {
      await cartAPI.addToCart(product.id, 1);
      refreshCartCount();
      Alert.alert('Added to Cart', `${product.name} has been added to your cart.`);
    } catch (err) {
      Alert.alert('Error', 'Failed to add to cart. Please try again.');
    }
  };

  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [popularProducts, setPopularProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const navigation = useNavigation<HomeScreenNavigationProp>();

  useEffect(() => {
    loadFeaturedProducts();
  }, []);

  const loadFeaturedProducts = async () => {
    try {
      if (!refreshing) setIsLoading(true);
      const response = await productsAPI.getAll();
      // Get first 6 products as featured
      setFeaturedProducts(response.data.slice(0, 5));
      setPopularProducts(response.data.slice(5, 15));
    } catch (error) {
      if (__DEV__) console.error('Error loading products:', error);
      Alert.alert('Error', 'Failed to load products');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFeaturedProducts();
  }, []);

  const navigateToProductDetail = (product: Product) => {
    navigation.navigate('ProductDetail', { product });
  };

  const renderProductCard = (product: Product) => (
    <TouchableOpacity
      key={product.id}
      style={styles.productCard}
      onPress={() => navigateToProductDetail(product)}
      activeOpacity={0.9}
    >
      <CachedImage
        source={{ uri: resolveProductImage(product.image_url, product.image) }}
        style={styles.productImage}
        resizeMode="cover"
      />
      <View style={styles.promoBadge}>
        <Text style={styles.promoText}>Fresh</Text>
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.productFarmer} numberOfLines={1}>
           {product.farmer_name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.currency}>₱</Text>
          <Text style={styles.productPrice}>{product.price}</Text>
          <Text style={styles.unit}>/{product.unit}</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={(e) => {
          e.stopPropagation?.();
          handleAddToCart(product);
        }}
      >
        <Ionicons name="add" size={20} color="white" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderHorizontalProduct = (product: Product) => (
    <TouchableOpacity
      key={product.id}
      style={styles.horizontalCard}
      onPress={() => navigateToProductDetail(product)}
      activeOpacity={0.8}
    >
      <CachedImage 
        source={{ uri: resolveProductImage(product.image_url, product.image) }} 
        style={styles.horizontalImage} 
      />
      <View style={styles.horizontalInfo}>
        <Text style={styles.horizontalName} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.horizontalFarmer}>By {product.farmer_name}</Text>
        {product.average_rating != null && (
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={12} color={COLORS.accent} />
            <Text style={styles.ratingText}>{Number(product.average_rating).toFixed(1)}</Text>
          </View>
        )}
        <Text style={styles.horizontalPrice}>₱{product.price}</Text>
      </View>
       <TouchableOpacity
        style={styles.horizontalAddButton}
        onPress={(e) => {
          e.stopPropagation?.();
          handleAddToCart(product);
        }}
      >
        <Ionicons name="cart-outline" size={18} color={COLORS.success} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (isLoading) {
    return <HomeScreenSkeleton />;
  }

  // Time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <View style={styles.wrapper}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        {/* Modern Header Section */}
        <View style={styles.headerContainer}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.greetingText}>{getGreeting()},</Text>
              <Text style={styles.userNameText}>{user?.first_name || 'Guest'}!</Text>
            </View>
            <TouchableOpacity style={styles.profileButton} onPress={() => navigation.navigate('Profile' as any)}>
               {user?.profile_picture ? (
                  <CachedImage source={{ uri: (typeof user.profile_picture === 'string' && user.profile_picture.startsWith('http')) ? user.profile_picture : `${API_BASE_URL}/static/uploads/profiles/${user.profile_picture}` }} style={styles.profileImage} />
               ) : (
                  <Ionicons name="person" size={24} color={COLORS.primary} />
               )}
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity 
            style={styles.searchBar} 
            activeOpacity={0.9}
            onPress={() => navigation.navigate('MainTabs', { screen: 'Products' } as any)}
          >
            <Ionicons name="search-outline" size={20} color={COLORS.textSecondary} />
            <Text style={styles.searchTextPlaceholder}>Search fresh vegetables, fruits...</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.contentContainer}>
          {/* Categories - Horizontal Scroll */}
          <View style={styles.categoriesSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Categories</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
              {[
                { name: 'All', icon: 'grid-outline', color: '#E8F5E9' },
                { name: 'Vegetables', icon: 'leaf-outline', color: '#E3F2FD' },
                { name: 'Fruits', icon: 'nutrition-outline', color: '#FFF3E0' },
                { name: 'Grains', icon: 'flower-outline', color: '#F3E5F5' },
                { name: 'Dairy', icon: 'water-outline', color: '#E0F7FA' },
              ].map((cat, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.categoryPill, { backgroundColor: cat.color }]}
                  onPress={() => navigation.navigate('MainTabs', { screen: 'Products', params: { category: cat.name !== 'All' ? cat.name : undefined } } as any)}
                >
                  <Ionicons name={cat.icon as any} size={20} color={COLORS.textSecondary} />
                  <Text style={styles.categoryText}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Featured - Carousel Style */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Featured Harvest</Text>
              <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Products' } as any)}>
                <Text style={styles.seeAllText}>See All</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredScroll}>
              {featuredProducts.map(renderProductCard)}
            </ScrollView>
          </View>

          {/* Vendors Marketplace Banner - Farmers & Admins */}
          {user && (user.is_farmer || user.is_admin) && (
            <TouchableOpacity
              style={styles.vendorBanner}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CoVendorsMarketplace' as any)}
            >
              <View style={styles.vendorBannerContent}>
                <Text style={styles.vendorBannerTitle}>Vendors Marketplace</Text>
                <Text style={styles.vendorBannerSubtitle}>Buy wholesale from fellow farmers at DTI-guided prices</Text>
                <View style={styles.vendorBannerBtn}>
                  <Text style={styles.vendorBannerBtnText}>Browse Now</Text>
                  <Ionicons name="arrow-forward" size={14} color={COLORS.primary} />
                </View>
              </View>
              <Ionicons name="storefront" size={70} color="rgba(255,255,255,0.18)" style={styles.promoIcon} />
            </TouchableOpacity>
          )}

          {/* Promo Banner */}
          <View style={styles.promoBanner}>
             <View style={styles.promoContent}>
                <Text style={styles.promoTitle}>Farm to Table</Text>
                <Text style={styles.promoSubtitle}>Get 20% off on your first order!</Text>
                <TouchableOpacity style={styles.promoButton}>
                   <Text style={styles.promoButtonText}>Shop Now</Text>
                </TouchableOpacity>
             </View>
             <Ionicons name="basket" size={80} color="rgba(255,255,255,0.2)" style={styles.promoIcon} />
          </View>

          {/* Popular / Vertical List */}
          <View style={styles.section}>
             <Text style={styles.sectionTitle}>Popular Near You</Text>
             <View style={styles.verticalList}>
                {popularProducts.length > 0 ? popularProducts.map(renderHorizontalProduct) : (
                   <Text style={{color: COLORS.textSecondary, textAlign: 'center', marginTop: 20}}>No more products to show.</Text>
                )}
             </View>
          </View>

        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: SPACING.m,
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
  },
  headerContainer: {
    paddingHorizontal: SPACING.l,
    paddingTop: SPACING.xl + 20, // Status bar offset
    paddingBottom: SPACING.xl,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: SPACING.m,
    ...SHADOWS.medium,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.l,
  },
  greetingText: {
    ...TYPOGRAPHY.body,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  userNameText: {
    ...TYPOGRAPHY.h2,
    color: COLORS.white,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.m,
    height: 50,
    borderRadius: BORDER_RADIUS.l,
    ...SHADOWS.soft,
  },
  searchTextPlaceholder: {
    marginLeft: SPACING.s,
    color: COLORS.textLight,
    fontSize: 14,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  categoriesSection: {
    marginBottom: SPACING.l,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.l,
    marginBottom: SPACING.m,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  categoriesScroll: {
    paddingHorizontal: SPACING.l,
    gap: SPACING.s,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  categoryText: {
    marginLeft: 6,
    fontWeight: '600',
    color: COLORS.text,
    fontSize: 13,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  featuredScroll: {
    paddingHorizontal: SPACING.l,
    gap: SPACING.m,
  },
  productCard: {
    width: width * 0.45,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.l,
    padding: 10,
    ...SHADOWS.soft,
    marginBottom: SPACING.s,
  },
  productImage: {
    width: '100%',
    height: 130,
    borderRadius: BORDER_RADIUS.m,
    marginBottom: SPACING.s,
    backgroundColor: COLORS.border,
  },
  promoBadge: {
    position: 'absolute',
    top: 18,
    left: 18,
    backgroundColor: 'rgba(46, 125, 50, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  promoText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  productInfo: {
    paddingHorizontal: 4,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  productFarmer: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currency: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
    marginRight: 1,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  unit: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginLeft: 2,
  },
  addButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: COLORS.primary,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.medium,
  },
  promoBanner: {
    marginHorizontal: SPACING.l,
    backgroundColor: COLORS.secondary, // Orange
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.l,
    marginBottom: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    height: 140,
  },
  promoContent: {
    flex: 1, 
    zIndex: 2,
  },
  promoTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  promoSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginBottom: 12,
    maxWidth: '80%',
  },
  promoButton: {
    backgroundColor: COLORS.white,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  promoButtonText: {
    color: COLORS.secondary,
    fontWeight: '700',
    fontSize: 12,
  },
  promoIcon: {
    position: 'absolute',
    right: -10,
    bottom: -10,
    transform: [{ rotate: '-15deg' }],
  },
  vendorBanner: {
    marginHorizontal: SPACING.l,
    backgroundColor: '#1565C0',
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.l,
    marginBottom: SPACING.m,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    ...SHADOWS.medium,
  },
  vendorBannerContent: {
    flex: 1,
    zIndex: 2,
  },
  vendorBannerTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  vendorBannerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginBottom: 10,
    maxWidth: '85%',
  },
  vendorBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignSelf: 'flex-start',
    gap: 4,
  },
  vendorBannerBtnText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  verticalList: {
    paddingHorizontal: SPACING.l,
    gap: SPACING.m,
  },
  horizontalCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.l,
    padding: 10,
    ...SHADOWS.soft,
    alignItems: 'center',
  },
  horizontalImage: {
    width: 70,
    height: 70,
    borderRadius: BORDER_RADIUS.m,
    backgroundColor: COLORS.border,
  },
  horizontalInfo: {
    flex: 1,
    marginLeft: SPACING.m,
    justifyContent: 'center',
  },
  horizontalName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  horizontalFarmer: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  horizontalPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  horizontalAddButton: {
    padding: 8,
    backgroundColor: COLORS.primaryPale,
    borderRadius: 12,
  },
});

export default HomeScreen;