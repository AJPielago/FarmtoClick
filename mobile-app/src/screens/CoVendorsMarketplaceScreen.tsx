import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { productsAPI, cartAPI, dtiAPI, API_BASE_URL } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { useCart } from '../context/CartContext';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '../theme';

const categories = [
  'Vegetables', 'Fruits', 'Grains & Cereals', 'Dairy & Eggs',
  'Meat & Poultry', 'Herbs & Spices', 'Baked Goods', 'Beverages',
  'Organic Products', 'Other',
];

const sortOptions = [
  { key: 'newest', label: 'Newest' },
  { key: 'price_low', label: 'Price: Low' },
  { key: 'price_high', label: 'Price: High' },
  { key: 'name_asc', label: 'A \u2192 Z' },
  { key: 'name_desc', label: 'Z \u2192 A' },
];

const CoVendorsMarketplaceScreen: React.FC = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const navigation = useNavigation();
  const { refreshCartCount } = useCart();

  // ---- Load products ----
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await productsAPI.getCovendors();
      const list = res.data?.products || res.data || [];
      const prodsWithSuggestions = [...list];

      try {
        const suggestions = await Promise.allSettled(
          list.map((p: any) =>
            dtiAPI.suggestPrice(p.name || '', p.unit || 'kg', p.category || '', 'co-vendors')
          )
        );
        suggestions.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value?.data) {
            prodsWithSuggestions[idx].suggested_price =
              result.value.data.suggested_price || result.value.data.auto_price || null;
            prodsWithSuggestions[idx].dti_confidence = result.value.data.confidence || 0;
          }
        });
      } catch (_e) {
        // quiet fail on DTI suggestions
      }
      setProducts(prodsWithSuggestions);
    } catch (err) {
      if (__DEV__) console.error('Failed to load covendors', err);
      setProducts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ---- Filter & sort ----
  const filterProducts = useCallback(() => {
    let result = [...products];

    if (selectedCategory) {
      result = result.filter(
        (p) => p.category && p.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }
    if (minPrice) {
      result = result.filter((p) => parseFloat(p.price) >= parseFloat(minPrice));
    }
    if (maxPrice) {
      result = result.filter((p) => parseFloat(p.price) <= parseFloat(maxPrice));
    }

    if (sortBy === 'price_low') {
      result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    } else if (sortBy === 'price_high') {
      result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } else if (sortBy === 'name_asc') {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'name_desc') {
      result.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else {
      result.sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    }

    setFiltered(result);
  }, [products, searchQuery, selectedCategory, minPrice, maxPrice, sortBy]);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  // Re-filter whenever dependencies change
  useEffect(() => {
    filterProducts();
  }, [filterProducts]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const onAddToCart = async (productId: string, productName?: string) => {
    try {
      await cartAPI.addToCart(productId, 1);
      refreshCartCount();
      Alert.alert('Added', `${productName || 'Item'} added to cart`);
    } catch (_err) {
      Alert.alert('Error', 'Failed to add to cart. Check your connection.');
    }
  };

  const resolveImage = (product: any) => {
    const val = product.image_url || product.image || '';
    if (!val) return null;
    if (val.startsWith('http')) return val;
    if (val.startsWith('/')) return `${API_BASE_URL}${val}`;
    return `${API_BASE_URL}/static/uploads/products/${val}`;
  };

  const safeText = (v: any) => (v === null || v === undefined ? '' : String(v));

  const currentSortLabel = sortOptions.find((s) => s.key === sortBy)?.label || 'Newest';

  const cycleSortBy = () => {
    const idx = sortOptions.findIndex((s) => s.key === sortBy);
    setSortBy(sortOptions[(idx + 1) % sortOptions.length].key);
  };

  // ---- Render ----
  const renderHeader = () => (
    <View>
      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle" size={18} color="#1565C0" />
        <Text style={styles.infoBannerText}>
          Vendor prices use a <Text style={{ fontWeight: '700' }}>15% DTI markup</Text>. Buy
          wholesale from fellow farmers.
        </Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={COLORS.textLight} />
          <TextInput
            placeholder="Search vendor products..."
            placeholderTextColor={COLORS.textLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={COLORS.textLight} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Ionicons
            name="options"
            size={20}
            color={showFilters ? COLORS.white : COLORS.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Expanded Filters */}
      {showFilters && (
        <View style={styles.filtersPanel}>
          <View style={styles.filterRowPrice}>
            <View style={styles.priceInputWrap}>
              <Text style={styles.filterLabel}>Min</Text>
              <TextInput
                placeholder="\u20B10"
                keyboardType="numeric"
                value={minPrice}
                onChangeText={setMinPrice}
                style={styles.priceInput}
              />
            </View>
            <Text style={styles.priceDash}>\u2014</Text>
            <View style={styles.priceInputWrap}>
              <Text style={styles.filterLabel}>Max</Text>
              <TextInput
                placeholder="\u20B1999"
                keyboardType="numeric"
                value={maxPrice}
                onChangeText={setMaxPrice}
                style={styles.priceInput}
              />
            </View>
            <TouchableOpacity style={styles.sortChip} onPress={cycleSortBy}>
              <Ionicons name="swap-vertical" size={14} color={COLORS.primary} />
              <Text style={styles.sortChipText}>{currentSortLabel}</Text>
            </TouchableOpacity>
          </View>

          {/* Clear Filters */}
          {(minPrice || maxPrice || selectedCategory || searchQuery) && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                setSearchQuery('');
                setSelectedCategory(null);
                setMinPrice('');
                setMaxPrice('');
                setSortBy('newest');
              }}
            >
              <Ionicons name="trash-outline" size={14} color="#dc2626" />
              <Text style={styles.clearBtnText}>Clear All Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Category Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContainer}
      >
        <TouchableOpacity
          style={[styles.chip, !selectedCategory && styles.chipActive]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text style={[styles.chipText, !selectedCategory && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, selectedCategory === c && styles.chipActive]}
            onPress={() => setSelectedCategory(selectedCategory === c ? null : c)}
          >
            <Text style={[styles.chipText, selectedCategory === c && styles.chipTextActive]}>
              {c}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Results Count */}
      <View style={styles.resultsBar}>
        <Text style={styles.resultsText}>
          {filtered.length} product{filtered.length !== 1 ? 's' : ''} found
        </Text>
      </View>
    </View>
  );

  const renderProduct = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('ProductDetail' as any, { product: item })}
    >
      {/* Image */}
      <View style={styles.cardImageWrap}>
        {resolveImage(item) ? (
          <Image source={{ uri: resolveImage(item) as string }} style={styles.cardImage} />
        ) : (
          <View style={styles.cardImagePlaceholder}>
            <Ionicons name="leaf" size={32} color={COLORS.textLight} />
          </View>
        )}
        {item.category ? (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{item.category}</Text>
          </View>
        ) : null}
        {(item.quantity || 0) < 20 && (item.quantity || 0) > 0 && (
          <View style={styles.lowStockBadge}>
            <Text style={styles.lowStockText}>Low Stock</Text>
          </View>
        )}
      </View>

      {/* Details */}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {safeText(item.name)}
        </Text>
        <Text style={styles.cardFarmer} numberOfLines={1}>
          <Ionicons name="person" size={11} color={COLORS.textSecondary} />{' '}
          {safeText(
            item.farmer_name || item.farmer?.farm_name || item.farmer?.name || 'Unknown Farmer'
          )}
        </Text>

        {item.suggested_price ? (
          <View style={styles.dtiTag}>
            <Ionicons name="shield-checkmark" size={12} color="#2e7d32" />
            <Text style={styles.dtiTagText}>
              DTI: {'\u20B1'}
              {Number(item.suggested_price).toFixed(2)}
              {item.dti_confidence > 0.7 ? ' \u2713' : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.cardPrice}>
              {'\u20B1'}
              {(parseFloat(item.price) || 0).toFixed(2)}
              <Text style={styles.cardUnit}>/{safeText(item.unit || 'kg')}</Text>
            </Text>
            <Text
              style={[
                styles.cardStock,
                { color: (item.quantity || 0) < 20 ? '#dc2626' : COLORS.textSecondary },
              ]}
            >
              {safeText(item.quantity || 0)} {safeText(item.unit || 'units')} left
            </Text>
          </View>
          <TouchableOpacity
            style={styles.addCartBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              onAddToCart(item.id || item._id, item.name);
            }}
          >
            <Ionicons name="cart" size={18} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading marketplace...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        keyExtractor={(item, idx) => item.id || item._id || `${item.name}-${idx}`}
        renderItem={renderProduct}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="storefront-outline" size={56} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>No Products Found</Text>
            <Text style={styles.emptyText}>
              {searchQuery || selectedCategory
                ? 'Try adjusting your filters or search query.'
                : 'There are no vendor products available at the moment. Check back later!'}
            </Text>
            {(searchQuery || selectedCategory) && (
              <TouchableOpacity
                style={styles.clearFiltersBtn}
                onPress={() => {
                  setSearchQuery('');
                  setSelectedCategory(null);
                  setMinPrice('');
                  setMaxPrice('');
                }}
              >
                <Text style={styles.clearFiltersBtnText}>Clear Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    color: COLORS.textSecondary,
  },
  listContent: {
    paddingBottom: 30,
  },
  columnWrapper: {
    paddingHorizontal: SPACING.m,
    gap: 10,
  },

  // Info Banner
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    marginHorizontal: SPACING.m,
    marginTop: SPACING.m,
    padding: SPACING.s,
    borderRadius: BORDER_RADIUS.m,
    gap: 8,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#1565C0',
    lineHeight: 17,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.m,
    marginTop: SPACING.m,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    paddingHorizontal: SPACING.m,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    height: '100%',
  },
  filterToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: BORDER_RADIUS.m,
    backgroundColor: COLORS.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterToggleBtnActive: {
    backgroundColor: COLORS.primary,
  },

  // Filters Panel
  filtersPanel: {
    marginHorizontal: SPACING.m,
    marginTop: SPACING.s,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.m,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.soft,
  },
  filterRowPrice: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  priceInputWrap: {
    flex: 1,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  priceInput: {
    height: 38,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.s,
    paddingHorizontal: 10,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  priceDash: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingHorizontal: 10,
    borderRadius: BORDER_RADIUS.s,
    backgroundColor: COLORS.primaryPale,
    gap: 4,
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: SPACING.s,
    gap: 4,
  },
  clearBtnText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '600',
  },

  // Category Chips
  chipsContainer: {
    paddingHorizontal: SPACING.m,
    paddingVertical: SPACING.m,
    gap: 8,
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
  },
  chipTextActive: {
    color: COLORS.white,
  },

  // Results Bar
  resultsBar: {
    paddingHorizontal: SPACING.m,
    marginBottom: SPACING.s,
  },
  resultsText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },

  // Product Card (Grid)
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
    ...SHADOWS.soft,
  },
  cardImageWrap: {
    width: '100%',
    height: 120,
    backgroundColor: COLORS.border,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  categoryBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
  },
  lowStockBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  lowStockText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#dc2626',
  },
  cardBody: {
    padding: 10,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  cardFarmer: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  dtiTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
    gap: 4,
  },
  dtiTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#2e7d32',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
  },
  cardUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  cardStock: {
    fontSize: 10,
    marginTop: 2,
  },
  addCartBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.soft,
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.m,
    marginBottom: SPACING.s,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  clearFiltersBtn: {
    marginTop: SPACING.m,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: BORDER_RADIUS.m,
    backgroundColor: COLORS.primaryPale,
  },
  clearFiltersBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
});

export default CoVendorsMarketplaceScreen;
