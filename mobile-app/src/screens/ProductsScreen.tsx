import React, { useEffect, useState } from 'react';
// updated imports
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { productsAPI, API_BASE_URL, cartAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { Product } from '../types';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '../theme';
import { resolveProductImage } from '../utils/helpers';
import { ProductGridSkeleton } from '../components/SkeletonLoading';

type RootStackParamList = {
  Products: undefined;
  ProductDetail: { product: Product };
};

type ProductsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Products'>;

const ProductsScreen: React.FC = () => {
  const { refreshCartCount } = useCart();
  const navigation = useNavigation<ProductsScreenNavigationProp>();

  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Initialize min/max as strings to handle input clear
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('rating_high');
  const [showFilters, setShowFilters] = useState(false);

  const categories = ['All', 'Vegetables', 'Fruits', 'Grains', 'Dairy', 'Baked Goods', 'Beverages', 'Other'];
  
  const resolveImage = resolveProductImage;

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [products, searchQuery, selectedCategory, minPrice, maxPrice, sortBy]);

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      const response = await productsAPI.getAll();
      setProducts(response.data);
    } catch (error) {
      if (__DEV__) console.error('Error loading products:', error);
      Alert.alert('Error', 'Failed to load products');
    } finally {
      setIsLoading(false);
    }
  };

  const filterProducts = () => {
    let result = [...products];

    // Category
    if (selectedCategory && selectedCategory !== 'All') {
      result = result.filter(p => p.category?.toLowerCase() === selectedCategory.toLowerCase());
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name.toLowerCase().includes(q) || 
        p.description?.toLowerCase().includes(q)
      );
    }

    // Price Range
    if (minPrice) {
      result = result.filter(p => p.price >= parseFloat(minPrice));
    }
    if (maxPrice) {
      result = result.filter(p => p.price <= parseFloat(maxPrice));
    }

    // Sort
    switch (sortBy) {
      case 'price_low':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price_high':
        result.sort((a, b) => b.price - a.price);
        break;
      case 'name_asc':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'rating_high':
        // Mock rating sort if needed, simplified for now
        break;
      case 'newest':
      default:
        // Assuming id or created_at sort if available
        break;
    }

    setFilteredProducts(result);
  };


  const addToCart = async (product: Product) => {
    try {
      await cartAPI.addToCart(product.id, 1);
      refreshCartCount();
      Alert.alert('Success', `${product.name} added to cart!`);
    } catch (error: any) {
        if (error.response?.status === 401) {
            Alert.alert('Please Login', 'You must be logged in to add items to cart.');
            navigation.navigate('Login' as any);
        } else {
            const msg = error.response?.data?.message || 'Could not add to cart.';
            Alert.alert('Error', msg);
        }
    }
  };

  const renderProductItem = ({ item }: { item: Product }) => (
    <TouchableOpacity
      style={styles.productCard}
      onPress={() => navigation.navigate('ProductDetail', { product: item })}
      activeOpacity={0.9}
    >
      <CachedImage
        source={{ uri: resolveImage(item.image_url, item.image) }}
        style={styles.productImage}
        resizeMode="cover"
      />
      
      {item.quantity <= 0 && (
          <View style={styles.outOfStockOverlay}>
              <Text style={styles.outOfStockText}>Out of Stock</Text>
          </View>
      )}

      <View style={styles.productInfo}>
        <View style={styles.headerRow}>
             <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
             {item.average_rating != null && (
               <View style={styles.ratingContainer}>
                  <Ionicons name="star" size={12} color={COLORS.accent} />
                  <Text style={styles.ratingText}>{Number(item.average_rating).toFixed(1)}</Text>
               </View>
             )}
        </View>
        
        <Text style={styles.farmerName}>{item.farmer_name}</Text>
        
        <View style={styles.priceRow}>
          <Text style={styles.currency}>₱</Text>
          <Text style={styles.price}>{item.price}</Text>
          <Text style={styles.unit}>/{item.unit}</Text>
          
          <TouchableOpacity 
            style={[styles.addButton, item.quantity <= 0 && styles.disabledButton]}
            onPress={(e) => { e.stopPropagation(); addToCart(item); }}
            disabled={item.quantity <= 0}
          >
            <Ionicons name="add" size={20} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={COLORS.textLight} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search fresh products..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={COLORS.textLight}
          />
          <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.filterButton}>
             <Ionicons name="options-outline" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {/* Categories Chip List */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryChip,
                selectedCategory === cat || (cat === 'All' && !selectedCategory) ? styles.categoryChipActive : null
              ]}
              onPress={() => setSelectedCategory(cat === 'All' ? null : cat)}
            >
              <Text style={[
                styles.categoryText,
                selectedCategory === cat || (cat === 'All' && !selectedCategory) ? styles.categoryTextActive : null
              ]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        
        {/* Filters Expandable */}
        {showFilters && (
            <View style={styles.filtersContainer}>
                <View style={styles.filterRow}>
                    <TextInput 
                        style={styles.priceInput} 
                        placeholder="Min Price" 
                        keyboardType="numeric"
                        value={minPrice}
                        onChangeText={setMinPrice}
                    />
                    <Text style={styles.dash}>-</Text>
                    <TextInput 
                        style={styles.priceInput} 
                        placeholder="Max Price" 
                        keyboardType="numeric"
                        value={maxPrice}
                        onChangeText={setMaxPrice}
                    />
                </View>
                <View style={styles.sortRow}>
                    {['price_low', 'price_high', 'name_asc'].map(opt => (
                        <TouchableOpacity 
                            key={opt}
                            style={[styles.sortChip, sortBy === opt && styles.sortChipActive]}
                            onPress={() => setSortBy(opt)}
                        >
                            <Text style={[styles.sortText, sortBy === opt && styles.sortTextActive]}>
                                {opt.replace('_', ' ').toUpperCase()}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        )}
      </View>

      {isLoading ? (
        <ProductGridSkeleton />
      ) : (
        <FlatList
          data={filteredProducts}
          renderItem={renderProductItem}
          keyExtractor={(item) => item.id.toString()}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="basket-outline" size={64} color={COLORS.textLight} />
              <Text style={styles.emptyText}>No products found</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: SPACING.m,
    paddingVertical: SPACING.m,
    backgroundColor: COLORS.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    paddingHorizontal: SPACING.m,
    height: 50,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.m,
    ...SHADOWS.soft,
  },
  searchIcon: {
    marginRight: SPACING.s,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: COLORS.text,
  },
  filterButton: {
    padding: SPACING.xs,
  },
  categoryList: {
    paddingBottom: SPACING.m,
  },
  categoryChip: {
    paddingHorizontal: SPACING.m,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.s,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryText: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  categoryTextActive: {
    color: COLORS.white,
    fontFamily: 'Inter-SemiBold',
  },
  filtersContainer: {
    backgroundColor: COLORS.surface,
    padding: SPACING.m,
    borderRadius: BORDER_RADIUS.m,
    marginBottom: SPACING.m,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.m,
  },
  priceInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.s,
    paddingHorizontal: SPACING.s,
    backgroundColor: COLORS.background,
    textAlign: 'center',
  },
  dash: {
    marginHorizontal: SPACING.s,
    color: COLORS.textSecondary,
  },
  sortRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.s,
  },
  sortChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.s,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  sortChipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  sortText: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: COLORS.text,
  },
  sortTextActive: {
    color: COLORS.primary,
    fontFamily: 'Inter-SemiBold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: SPACING.m,
    paddingBottom: SPACING.xxl,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: SPACING.m,
  },
  productCard: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.soft,
  },
  productImage: {
    width: '100%',
    height: 140,
    backgroundColor: COLORS.background,
  },
  outOfStockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  outOfStockText: {
    color: COLORS.white,
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  productInfo: {
    padding: SPACING.s,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  productName: {
    flex: 1,
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    color: COLORS.text,
    marginRight: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning + '20',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ratingText: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: COLORS.text,
    marginLeft: 2,
  },
  farmerName: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: SPACING.s,
    fontFamily: 'Inter-Regular',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  currency: {
    fontSize: 12,
    color: COLORS.primary,
    fontFamily: 'Inter-Bold',
    marginTop: 4,
  },
  price: {
    fontSize: 16,
    color: COLORS.primary,
    fontFamily: 'Inter-Bold',
  },
  unit: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginLeft: 2,
    marginTop: 4,
  },
  addButton: {
    marginLeft: 'auto',
    backgroundColor: COLORS.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: COLORS.textLight,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  emptyText: {
    marginTop: SPACING.m,
    fontSize: 16,
    color: COLORS.textSecondary,
    fontFamily: 'Inter-Medium',
  },
});

export default ProductsScreen;
