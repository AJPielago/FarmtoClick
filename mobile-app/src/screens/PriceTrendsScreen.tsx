import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { dtiAPI } from '../services/api';

interface TrendableProduct {
  name: string;
  unit?: string;
  category?: string;
}

interface TrendData {
  product_name: string;
  unit: string;
  historical_prices: Array<{ date: string; min_price: number; max_price: number; avg_price: number }>;
  forecast: Array<{ date: string; predicted_price: number }>;
  current_price?: number;
  tomorrow_price?: number;
  price_direction?: string;
}

interface AccuracyData {
  accuracy_percentage?: number;
  mae?: number;
  rmse?: number;
  mape?: number;
  backtest?: Array<{ date: string; actual: number; predicted: number; error: number }>;
}

const FORECAST_RANGES = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
];

const PriceTrendsScreen: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.is_admin;

  const [products, setProducts] = useState<TrendableProduct[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<TrendableProduct | null>(null);
  const [forecastRange, setForecastRange] = useState(30);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [accuracyData, setAccuracyData] = useState<AccuracyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTrendableProducts();
  }, []);

  const loadTrendableProducts = async () => {
    try {
      setLoadingProducts(true);
      const res = await dtiAPI.getTrendableProducts();
      const raw: any[] = res.data?.products || res.data || [];
      // Backend returns `product_name`; normalise to `name` used by the UI
      setProducts(
        raw.map((p: any) => ({
          name: p.name || p.product_name || '',
          unit: p.unit,
          category: p.category,
        }))
      );
    } catch (error) {
      if (__DEV__) console.error('Error loading trendable products:', error);
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadTrendData = useCallback(async (product: TrendableProduct) => {
    try {
      setLoading(true);
      const [trendRes, accuracyRes] = await Promise.allSettled([
        dtiAPI.getTrends(product.name, forecastRange),
        isAdmin ? dtiAPI.getPredictionAccuracy(product.name) : Promise.reject('not admin'),
      ]);

      if (trendRes.status === 'fulfilled') {
        setTrendData(trendRes.value.data);
      }

      if (accuracyRes.status === 'fulfilled') {
        setAccuracyData(accuracyRes.value.data);
      } else {
        setAccuracyData(null);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading trend data:', error);
      Alert.alert('Error', 'Failed to load price trend data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [forecastRange, isAdmin]);

  const selectProduct = (product: TrendableProduct) => {
    setSelectedProduct(product);
    loadTrendData(product);
  };

  useEffect(() => {
    if (selectedProduct) {
      loadTrendData(selectedProduct);
    }
  }, [forecastRange]);

  const filteredProducts = products.filter((p) =>
    (p.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPriceDirection = (direction?: string) => {
    if (!direction) return { icon: 'remove' as const, color: '#666', label: 'Stable' };
    if (direction === 'up') return { icon: 'trending-up' as const, color: '#F44336', label: 'Rising' };
    if (direction === 'down') return { icon: 'trending-down' as const, color: '#4CAF50', label: 'Falling' };
    return { icon: 'remove' as const, color: '#666', label: 'Stable' };
  };

  const getBuyingAdvice = (direction?: string) => {
    if (direction === 'up') return 'Prices are expected to rise. Consider buying now.';
    if (direction === 'down') return 'Prices may decrease. You could wait for better deals.';
    return 'Prices are expected to remain stable.';
  };

  const onRefresh = () => {
    setRefreshing(true);
    if (selectedProduct) {
      loadTrendData(selectedProduct);
    } else {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Price Trends</Text>
        <Text style={styles.headerSubtitle}>
          {isAdmin ? 'Analyze market trends and forecast accuracy' : 'See price forecasts and buying advice'}
        </Text>
      </View>

      {/* Product Search */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Select Product</Text>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#999"
          />
        </View>

        {loadingProducts ? (
          <ActivityIndicator size="small" color="#4CAF50" style={{ marginTop: 10 }} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.productChips}>
            {filteredProducts.slice(0, 20).map((product, idx) => (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.productChip,
                  selectedProduct?.name === product.name && styles.productChipActive,
                ]}
                onPress={() => selectProduct(product)}
              >
                <Text
                  style={[
                    styles.productChipText,
                    selectedProduct?.name === product.name && styles.productChipTextActive,
                  ]}
                >
                  {product.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Forecast Range */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Forecast Range</Text>
        <View style={styles.rangeRow}>
          {FORECAST_RANGES.map((range) => (
            <TouchableOpacity
              key={range.value}
              style={[
                styles.rangeChip,
                forecastRange === range.value && styles.rangeChipActive,
              ]}
              onPress={() => setForecastRange(range.value)}
            >
              <Text
                style={[
                  styles.rangeChipText,
                  forecastRange === range.value && styles.rangeChipTextActive,
                ]}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Loading */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading price data...</Text>
        </View>
      )}

      {/* No Selection */}
      {!selectedProduct && !loading && (
        <View style={styles.emptyState}>
          <Ionicons name="analytics-outline" size={60} color="#ccc" />
          <Text style={styles.emptyTitle}>Select a Product</Text>
          <Text style={styles.emptyText}>Choose a product above to view price trends</Text>
        </View>
      )}

      {/* Trend Data - Consumer View */}
      {trendData && !loading && !isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What This Means for You</Text>

          {/* Price Summary Cards */}
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCard, { backgroundColor: '#E3F2FD' }]}>
              <Text style={styles.summaryLabel}>Current Price</Text>
              <Text style={styles.summaryValue}>₱{(trendData.current_price || 0).toFixed(2)}</Text>
              <Text style={styles.summaryUnit}>per {trendData.unit || 'unit'}</Text>
            </View>

            <View style={[styles.summaryCard, { backgroundColor: '#E8F5E9' }]}>
              <Text style={styles.summaryLabel}>Tomorrow</Text>
              <Text style={styles.summaryValue}>₱{(trendData.tomorrow_price || 0).toFixed(2)}</Text>
              <View style={styles.directionRow}>
                {(() => {
                  const dir = getPriceDirection(trendData.price_direction);
                  return (
                    <>
                      <Ionicons name={dir.icon} size={16} color={dir.color} />
                      <Text style={[styles.directionText, { color: dir.color }]}>{dir.label}</Text>
                    </>
                  );
                })()}
              </View>
            </View>

            {trendData.forecast && trendData.forecast.length > 0 && (
              <View style={[styles.summaryCard, { backgroundColor: '#FFF3E0', width: '100%' }]}>
                <Text style={styles.summaryLabel}>
                  {forecastRange}-Day Forecast
                </Text>
                <Text style={styles.summaryValue}>
                  ₱{trendData.forecast[trendData.forecast.length - 1]?.predicted_price?.toFixed(2) || '—'}
                </Text>
              </View>
            )}
          </View>

          {/* Buying Advice */}
          <View style={styles.adviceCard}>
            <Ionicons name="bulb" size={24} color="#FF9800" />
            <Text style={styles.adviceText}>{getBuyingAdvice(trendData.price_direction)}</Text>
          </View>
        </View>
      )}

      {/* Trend Data - Admin View */}
      {trendData && !loading && isAdmin && (
        <>
          {/* Historical Prices Table */}
          {trendData.historical_prices && trendData.historical_prices.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Historical Prices</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 2 }]}>Date</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader]}>Min</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader]}>Max</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader]}>Avg</Text>
              </View>
              {trendData.historical_prices.slice(-10).map((entry, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{entry.date}</Text>
                  <Text style={styles.tableCell}>₱{entry.min_price?.toFixed(2)}</Text>
                  <Text style={styles.tableCell}>₱{entry.max_price?.toFixed(2)}</Text>
                  <Text style={[styles.tableCell, { fontWeight: '600' }]}>₱{entry.avg_price?.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Forecast Table */}
          {trendData.forecast && trendData.forecast.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Forecast ({forecastRange} days)</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 2 }]}>Date</Text>
                <Text style={[styles.tableCell, styles.tableCellHeader]}>Predicted</Text>
              </View>
              {trendData.forecast.map((entry, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{entry.date}</Text>
                  <Text style={[styles.tableCell, { color: '#4CAF50', fontWeight: '600' }]}>
                    ₱{entry.predicted_price?.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Prediction Accuracy */}
          {accuracyData && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Prediction Accuracy Report</Text>
              <View style={styles.accuracyGrid}>
                <View style={styles.accuracyCard}>
                  <Text style={styles.accuracyLabel}>Accuracy</Text>
                  <Text style={[styles.accuracyValue, { color: '#4CAF50' }]}>
                    {(accuracyData.accuracy_percentage || 0).toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.accuracyCard}>
                  <Text style={styles.accuracyLabel}>MAE</Text>
                  <Text style={styles.accuracyValue}>
                    ₱{(accuracyData.mae || 0).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.accuracyCard}>
                  <Text style={styles.accuracyLabel}>RMSE</Text>
                  <Text style={styles.accuracyValue}>
                    ₱{(accuracyData.rmse || 0).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.accuracyCard}>
                  <Text style={styles.accuracyLabel}>MAPE</Text>
                  <Text style={styles.accuracyValue}>
                    {(accuracyData.mape || 0).toFixed(1)}%
                  </Text>
                </View>
              </View>

              {/* Backtest Table */}
              {accuracyData.backtest && accuracyData.backtest.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: 15 }]}>Backtest Comparison</Text>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableCell, styles.tableCellHeader, { flex: 2 }]}>Date</Text>
                    <Text style={[styles.tableCell, styles.tableCellHeader]}>Actual</Text>
                    <Text style={[styles.tableCell, styles.tableCellHeader]}>Predicted</Text>
                    <Text style={[styles.tableCell, styles.tableCellHeader]}>Error</Text>
                  </View>
                  {accuracyData.backtest.map((entry, idx) => (
                    <View key={idx} style={styles.tableRow}>
                      <Text style={[styles.tableCell, { flex: 2 }]}>{entry.date}</Text>
                      <Text style={styles.tableCell}>₱{entry.actual?.toFixed(2)}</Text>
                      <Text style={styles.tableCell}>₱{entry.predicted?.toFixed(2)}</Text>
                      <Text
                        style={[
                          styles.tableCell,
                          { color: Math.abs(entry.error) > 5 ? '#F44336' : '#4CAF50' },
                        ]}
                      >
                        {entry.error?.toFixed(2)}%
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
        </>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 20,
    paddingTop: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#E8F5E9',
    marginTop: 5,
  },
  section: {
    backgroundColor: '#fff',
    margin: 15,
    marginBottom: 0,
    borderRadius: 12,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 42,
    fontSize: 15,
    color: '#333',
  },
  productChips: {
    marginTop: 10,
    flexDirection: 'row',
  },
  productChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  productChipActive: {
    backgroundColor: '#4CAF50',
  },
  productChipText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
  },
  productChipTextActive: {
    color: '#fff',
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  rangeChipActive: {
    backgroundColor: '#2196F3',
  },
  rangeChipText: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
  },
  rangeChipTextActive: {
    color: '#fff',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 15,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    width: '48%',
    borderRadius: 12,
    padding: 15,
    marginBottom: 5,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  summaryUnit: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  directionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  adviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
    gap: 12,
  },
  adviceText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    padding: 8,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: '#333',
  },
  tableCellHeader: {
    fontWeight: 'bold',
    color: '#555',
  },
  accuracyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accuracyCard: {
    width: '47%',
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  accuracyLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  accuracyValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
});

export default PriceTrendsScreen;
