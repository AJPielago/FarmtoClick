import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CachedImage } from '../components/CachedImage';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { productsAPI, cartAPI, API_BASE_URL } from '../services/api';
// @ts-ignore
import ProductReviews from '../components/ProductReviews';
import { Product, RootStackParamList } from '../types';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '../theme';
import { resolveProductImage } from '../utils/helpers';

type ProductDetailRouteProp = RouteProp<RootStackParamList, 'ProductDetail'>;
type ProductDetailNavigationProp = StackNavigationProp<RootStackParamList>;

const { width, height } = Dimensions.get('window');

const ProductDetailScreen: React.FC = () => {
  const route = useRoute<ProductDetailRouteProp>();
  const navigation = useNavigation<ProductDetailNavigationProp>();
  const { user } = useAuth();
  const { refreshCartCount } = useCart();
  const { product } = route.params;

  const [quantity, setQuantity] = useState(1);
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(true);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const resolveImage = resolveProductImage;

  // Build image array for carousel
  const productImages: string[] = (() => {
    if (product.image_urls && product.image_urls.length > 0) {
      return product.image_urls;
    }
    const fallback = resolveImage(product.image_url, product.image);
    return fallback ? [fallback] : [];
  })();

  // Load favorite state from storage
  useEffect(() => {
    const loadFavorite = async () => {
      try {
        const favs = await AsyncStorage.getItem('favorites');
        if (favs) {
          const parsed: string[] = JSON.parse(favs);
          setFavorite(parsed.includes(product._id));
        }
      } catch (e) {
        // ignore
      }
    };
    loadFavorite();
  }, [product._id]);

  const toggleFavorite = useCallback(async () => {
    try {
      const favs = await AsyncStorage.getItem('favorites');
      let parsed: string[] = favs ? JSON.parse(favs) : [];
      if (parsed.includes(product._id)) {
        parsed = parsed.filter(id => id !== product._id);
        setFavorite(false);
      } else {
        parsed.push(product._id);
        setFavorite(true);
      }
      await AsyncStorage.setItem('favorites', JSON.stringify(parsed));
    } catch (e) {
      if (__DEV__) console.error('Error toggling favorite:', e);
    }
  }, [product._id]);

  useEffect(() => {
    loadRelatedProducts();
  }, [product]);

  const loadRelatedProducts = async () => {
    try {
      setIsLoadingRelated(true);
      const response = await productsAPI.getAll();
      const allProducts: Product[] = response.data || [];
      const related = allProducts.filter(
        (p) => p.farmer_id === product.farmer_id && p.id !== product.id
      );
      setRelatedProducts(related.slice(0, 6));
    } catch (error) {
      if (__DEV__) console.error('Error loading related products:', error);
    } finally {
      setIsLoadingRelated(false);
    }
  };

  const incrementQuantity = () => {
    if (quantity < (product.quantity || 999)) {
      setQuantity((q) => q + 1);
    }
  };

  const decrementQuantity = () => {
    if (quantity > 1) {
      setQuantity((q) => q - 1);
    }
  };

  const addToCart = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please login to add items to your cart.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }

    try {
      setIsAddingToCart(true);
      await cartAPI.addToCart(product.id, quantity);
      refreshCartCount(); // update badge
      Alert.alert('Added to Cart', `${quantity} x ${product.name} added to your cart!`, [
        { text: 'Continue Shopping', style: 'cancel' },
        { text: 'View Cart', onPress: () => navigation.navigate('MainTabs', { screen: 'Cart' } as any) },
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to add to cart');
    } finally {
      setIsAddingToCart(false);
    }
  };
 
  const navigateToRelatedProduct = (relProduct: Product) => {
    navigation.push('ProductDetail', { product: relProduct });
  };

  const navigateToFarmer = () => {
    if (product.farmer_id) {
      navigation.navigate('FarmerProfile', { farmerId: product.farmer_id });
    }
  };

  const inStock = product.available !== false && product.quantity > 0;

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      
      {/* Header Image Background */}
      <View style={styles.imageContainer}>
        {productImages.length > 1 ? (
          <>
            <FlatList
              data={productImages}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, index) => `product-img-${index}`}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                setActiveImageIndex(idx);
              }}
              renderItem={({ item }) => (
                <CachedImage
                  source={{ uri: item }}
                  style={styles.producImage}
                  resizeMode="cover"
                />
              )}
            />
            {/* Pagination Dots */}
            <View style={styles.paginationDots}>
              {productImages.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    idx === activeImageIndex && styles.dotActive,
                  ]}
                />
              ))}
            </View>
          </>
        ) : (
          <CachedImage
            source={{ uri: productImages[0] || resolveImage(product.image_url, product.image) }}
            style={styles.producImage}
            resizeMode="cover"
          />
        )}
        <View style={styles.headerOverlay} />
        
        {/* Header Actions */}
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={toggleFavorite}
          >
            <Ionicons 
              name={favorite ? "heart" : "heart-outline"} 
              size={24} 
              color={favorite ? COLORS.error : COLORS.white} 
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        style={styles.contentContainer} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <View style={styles.detailsCard}>
          <View style={styles.titleRow}>
            <Text style={styles.productName}>{product.name}</Text>
            {product.average_rating != null && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={14} color={COLORS.accent} />
                <Text style={styles.ratingText}>{Number(product.average_rating).toFixed(1)}</Text>
              </View>
            )}
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceValue}>₱{product.price}</Text>
            <Text style={styles.priceUnit}>/{product.unit}</Text>
            
            {/* Stock Status Badge */}
            <View style={[
              styles.stockBadge, 
              { backgroundColor: inStock ? '#E8F5E9' : '#FFEBEE' }
            ]}>
              <Text style={{ 
                color: inStock ? COLORS.success : COLORS.error, 
                fontSize: 12, 
                fontWeight: '600' 
              }}>
                {inStock ? 'In Stock' : 'Out of Stock'}
              </Text>
            </View>
          </View>

          {/* Farmer Info */}
          <TouchableOpacity style={styles.farmerCard} onPress={navigateToFarmer}>
            <View style={styles.farmerAvatar}>
              <Ionicons name="person" size={20} color={COLORS.primary} />
            </View>
            <View style={styles.farmerInfo}>
              <Text style={styles.farmerLabel}>Farmer</Text>
              <Text style={styles.farmerName}>{product.farmer_name}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.descriptionText}>
              {product.description || 'Freshly harvested from local farms directly to your table. Grown with care and sustainable farming practices to ensure the best quality and taste for your family.'}
            </Text>
          </View>

          {/* Product Details Grid */}
          <View style={styles.gridSection}>
            <View style={styles.gridItem}>
              <Ionicons name="leaf-outline" size={24} color={COLORS.success} />
              <Text style={styles.gridLabel}>Category</Text>
              <Text style={styles.gridValue}>{(product as any).category || 'Fresh Produce'}</Text>
            </View>
            <View style={styles.gridItem}>
              <Ionicons name="location-outline" size={24} color={COLORS.primary} />
              <Text style={styles.gridLabel}>Origin</Text>
              <Text style={styles.gridValue}>{product.farmer_name ? 'Local Farm' : 'Local'}</Text>
            </View>
            <View style={styles.gridItem}>
              <Ionicons name="cube-outline" size={24} color={COLORS.secondary} />
              <Text style={styles.gridLabel}>Stock</Text>
              <Text style={styles.gridValue}>{product.quantity} {product.unit}</Text>
            </View>
          </View>

           {/* Related Products */}
            {relatedProducts.length > 0 && (
                <View style={styles.relatedSection}>
                    <Text style={styles.sectionTitle}>More from this Farmer</Text>
                    <FlatList
                        horizontal
                        data={relatedProducts}
                        keyExtractor={(item) => item.id.toString()}
                        renderItem={({ item }) => (
                            <TouchableOpacity 
                                style={styles.relatedCard}
                                onPress={() => navigateToRelatedProduct(item)}
                            >
                                <CachedImage 
                                    source={{ uri: resolveImage(item.image_url, item.image) }} 
                                    style={styles.relatedImage} 
                                />
                                <Text style={styles.relatedName} numberOfLines={1}>{item.name}</Text>
                                <Text style={styles.relatedPrice}>₱{item.price}</Text>
                            </TouchableOpacity>
                        )}
                        showsHorizontalScrollIndicator={false}
                    />
                </View>
            )}
        </View>
      </ScrollView>

      {/* Floating Bottom Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.quantityContainer}>
          <TouchableOpacity 
            style={styles.qtyBtn} 
            onPress={decrementQuantity}
            disabled={quantity <= 1}
          >
            <Ionicons name="remove" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.qtyText}>{quantity}</Text>
          <TouchableOpacity 
            style={styles.qtyBtn}
            onPress={incrementQuantity}
            disabled={!inStock || quantity >= product.quantity}
          >
            <Ionicons name="add" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={[styles.addToCartBtn, (!inStock || isAddingToCart) && styles.disabledBtn]}
          onPress={addToCart}
          disabled={!inStock || isAddingToCart}
        >
          {isAddingToCart ? (
             <ActivityIndicator color="white" />
          ) : (
             <>
               <Text style={styles.btnText}>Add to Cart</Text>
               <Text style={styles.btnPrice}>₱{(product.price * quantity).toFixed(0)}</Text>
             </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  imageContainer: {
    height: height * 0.45,
    width: '100%',
    position: 'absolute',
    top: 0,
  },
  producImage: {
    width: width,
    height: '100%',
    backgroundColor: COLORS.border,
  },
  paginationDots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  headerActions: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.l,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    flex: 1,
    marginTop: height * 0.38,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  detailsCard: {
    padding: SPACING.l,
    minHeight: height * 0.6,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.s,
  },
  productName: {
    ...TYPOGRAPHY.h1,
    flex: 1,
    marginRight: SPACING.m,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    ...SHADOWS.soft,
  },
  ratingText: {
    marginLeft: 4,
    fontWeight: '700',
    color: COLORS.text,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: SPACING.l,
  },
  priceValue: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.primary,
  },
  priceUnit: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginLeft: 2,
    marginRight: SPACING.m,
  },
  stockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  farmerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: SPACING.m,
    borderRadius: BORDER_RADIUS.l,
    marginBottom: SPACING.l,
    ...SHADOWS.soft,
  },
  farmerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.m,
  },
  farmerInfo: {
    flex: 1,
  },
  farmerLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  farmerName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.s,
  },
  descriptionText: {
    ...TYPOGRAPHY.body,
    lineHeight: 24,
    color: COLORS.textSecondary,
  },
  gridSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.l,
    marginBottom: SPACING.xl,
  },
  gridItem: {
    alignItems: 'center',
  },
  gridLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  gridValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.l,
    paddingVertical: SPACING.m,
    paddingBottom: 30, // Safe area
    flexDirection: 'row',
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...SHADOWS.strong,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 30,
    paddingHorizontal: 6,
    paddingVertical: 6,
    marginRight: SPACING.m,
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  qtyText: {
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 16,
  },
  addToCartBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    height: 54,
    borderRadius: 27,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.l,
    ...SHADOWS.medium,
  },
  disabledBtn: {
    backgroundColor: COLORS.textLight,
  },
  btnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  btnPrice: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontWeight: '600',
  },
  relatedSection: {
      marginTop: SPACING.m,
      marginBottom: SPACING.l,
  },
  relatedCard: {
      marginRight: SPACING.m,
      width: 120,
  },
  relatedImage: {
      width: 120,
      height: 120,
      borderRadius: BORDER_RADIUS.m,
      marginBottom: SPACING.s,
      backgroundColor: COLORS.border,
  },
  relatedName: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.text,
      marginBottom: 2,
  },
  relatedPrice: {
      fontSize: 14,
      fontWeight: 'bold',
      color: COLORS.primary,
  },
});

export default ProductDetailScreen;