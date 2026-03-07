import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { ordersAPI, productsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Order, RootStackParamList } from '../types';

type OrdersScreenNavigationProp = StackNavigationProp<RootStackParamList>;

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FFF3E0', text: '#E65100' },
  confirmed: { bg: '#E3F2FD', text: '#1565C0' },
  approved: { bg: '#E3F2FD', text: '#1565C0' },
  preparing: { bg: '#F3E5F5', text: '#7B1FA2' },
  ready: { bg: '#E0F7FA', text: '#00838F' },
  ready_for_ship: { bg: '#E0F7FA', text: '#00838F' },
  picked_up: { bg: '#FFF8E1', text: '#F57F17' },
  on_the_way: { bg: '#FFF3E0', text: '#E65100' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  delivered: { bg: '#E8F5E9', text: '#1B5E20' },
  cancelled: { bg: '#FFEBEE', text: '#C62828' },
  rejected: { bg: '#FFEBEE', text: '#C62828' },
};

const OrdersScreen: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [trackingLoading, setTrackingLoading] = useState<string | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState<string | null>(null);
  const [confirmingReceipt, setConfirmingReceipt] = useState<string | null>(null);

  const { user } = useAuth();
  const navigation = useNavigation<OrdersScreenNavigationProp>();

  const loadOrders = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    try {
      const response = await ordersAPI.getOrders();
      setOrders(response.data || []);
    } catch (error) {
      if (__DEV__) console.error('Error loading orders:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadOrders();
  };

  const toggleOrder = (orderId: string) => {
    setExpandedOrders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const getStatusStyle = (status: string) => {
    const normalized = (status || 'pending').toLowerCase().replace(/[\s]+/g, '_');
    return STATUS_COLORS[normalized] || STATUS_COLORS.pending;
  };

  const formatStatus = (status: string) => {
    return (status || 'pending')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatShortId = (value: string) => {
    if (!value) return '';
    return value.slice(0, 6);
  };

  const refreshTracking = async (orderId: string) => {
    try {
      setTrackingLoading(orderId);
      const res = await ordersAPI.getOrderTracking(orderId);
      if (res.data) {
        // Refresh full order list to get updated tracking
        await loadOrders();
        Alert.alert('Updated', 'Delivery status refreshed');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to refresh tracking');
    } finally {
      setTrackingLoading(null);
    }
  };

  const verifyPayment = async (orderId: string) => {
    try {
      setVerifyingPayment(orderId);
      const res = await ordersAPI.confirmPaymongo(orderId);
      if (res.data?.success !== false) {
        Alert.alert('Success', 'Payment verified successfully');
        await loadOrders();
      } else {
        Alert.alert('Info', res.data?.message || 'Payment not yet confirmed');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to verify payment');
    } finally {
      setVerifyingPayment(null);
    }
  };

  const openProductForReview = async (productId?: string) => {
    if (!productId) {
      Alert.alert('Unavailable', 'Product details are missing for this order item.');
      return;
    }

    try {
      const res = await productsAPI.getById(productId);
      const product = res.data;
      if (!product?.id) {
        Alert.alert('Error', 'Product not found.');
        return;
      }
      navigation.navigate('ProductDetail', { product });
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to open product details');
    }
  };

  const handleConfirmReceived = async (orderId: string) => {
    Alert.alert(
      'Confirm Receipt',
      'Have you received this order?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Received',
          onPress: async () => {
            try {
              setConfirmingReceipt(orderId);
              const res = await ordersAPI.confirmOrderReceived(orderId);
              if (res.data?.success) {
                Alert.alert('Thank you!', res.data.completed
                  ? 'Order completed successfully.'
                  : 'Receipt confirmed. The order will be completed once the rider also marks it.');
                loadOrders();
              } else {
                Alert.alert('Error', res.data?.message || 'Failed to confirm receipt');
              }
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.message || 'Failed to confirm receipt');
            } finally {
              setConfirmingReceipt(null);
            }
          },
        },
      ],
    );
  };

  const renderOrderItem = ({ item }: { item: Order }) => {
    const orderId = item._id || item.id;
    const isExpanded = expandedOrders.has(orderId);
    const statusStyle = getStatusStyle(item.status);
    const total = item.total_amount || item.total || 0;
    const isDelivered = (item.delivery_status || item.status || '').toLowerCase() === 'delivered';
    const isCompleted = (item.delivery_status || item.status || '').toLowerCase() === 'completed';
    const customerConfirmed = (item as any).customer_confirmed === true;

    return (
      <View style={styles.orderCard}>
        <TouchableOpacity
          style={styles.orderHeader}
          onPress={() => toggleOrder(orderId)}
          activeOpacity={0.7}
        >
          <View style={styles.orderHeaderLeft}>
            <Text style={styles.orderNumber}>
              Order #{item.order_number || formatShortId(orderId)}
            </Text>
            <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
          </View>
          <View style={styles.orderHeaderRight}>
            <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
              <Text style={[styles.statusText, { color: statusStyle.text }]}>
                {formatStatus(item.status)}
              </Text>
            </View>
            <Text style={styles.orderTotal}>₱{total.toFixed(2)}</Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#666"
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.orderDetails}>
            {/* Order Items */}
            {item.items && item.items.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Items</Text>
                {item.items.map((orderItem, index) => (
                  <View key={index} style={styles.orderItem}>
                    <Text style={styles.itemName}>
                      {orderItem.product_name} x{orderItem.quantity}
                    </Text>
                    <Text style={styles.itemPrice}>
                      ₱{(orderItem.price * orderItem.quantity).toFixed(2)}
                    </Text>
                    {isDelivered && (
                      <TouchableOpacity
                        style={styles.reviewBtn}
                        onPress={() => openProductForReview(orderItem.product_id)}
                      >
                        <Text style={styles.reviewBtnText}>Review</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Order Info */}
            <View style={styles.detailSection}>
              <Text style={styles.detailTitle}>Order Details</Text>

              {orderId && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Order ID</Text>
                  <Text style={styles.infoValue}>{formatShortId(orderId)}</Text>
                </View>
              )}
              
              {item.payment_method && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Payment</Text>
                  <Text style={styles.infoValue}>{item.payment_method}</Text>
                </View>
              )}

              {item.delivery_status && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Delivery Status</Text>
                  <Text style={styles.infoValue}>{formatStatus(item.delivery_status)}</Text>
                </View>
              )}

              {item.delivery_tracking_id && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Tracking ID</Text>
                  <Text style={styles.infoValue}>{formatShortId(item.delivery_tracking_id)}</Text>
                </View>
              )}

              {item.logistics_provider && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Logistics</Text>
                  <Text style={styles.infoValue}>{item.logistics_provider}</Text>
                </View>
              )}

              {item.shipping_name && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Recipient</Text>
                  <Text style={styles.infoValue}>{item.shipping_name}</Text>
                </View>
              )}

              {item.shipping_phone && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Phone</Text>
                  <Text style={styles.infoValue}>{item.shipping_phone}</Text>
                </View>
              )}

              {item.shipping_address && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Address</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>
                    {item.shipping_address}
                  </Text>
                </View>
              )}

              {item.delivery_notes && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Notes</Text>
                  <Text style={[styles.infoValue, { flex: 1 }]}>
                    {item.delivery_notes}
                  </Text>
                </View>
              )}

              {item.delivery_proof_url && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Delivery Proof</Text>
                  <Image
                    source={{ uri: item.delivery_proof_url }}
                    style={styles.proofImage}
                    resizeMode="cover"
                  />
                </View>
              )}
            </View>

            {/* Delivery Updates */}
            {item.delivery_updates && item.delivery_updates.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Tracking Updates</Text>
                {item.delivery_updates.map((update, index) => (
                  <View key={index} style={styles.updateItem}>
                    <View style={styles.updateDot} />
                    <View style={styles.updateContent}>
                      <Text style={styles.updateStatus}>{formatStatus(update.status || item.delivery_status || item.status)}</Text>
                      <Text style={styles.updateTime}>
                        {formatDate((update as any).updated_at || update.timestamp || (update as any).time)}
                      </Text>
                      {update.description && (
                        <Text style={styles.updateDesc}>{update.description}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Assigned Rider */}
            {(item as any).assigned_rider_name && (
              <View style={styles.detailSection}>
                <Text style={styles.detailTitle}>Assigned Rider</Text>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Name</Text>
                  <Text style={styles.infoValue}>{(item as any).assigned_rider_name}</Text>
                </View>
                {(item as any).assigned_rider_phone && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Phone</Text>
                    <Text style={styles.infoValue}>{(item as any).assigned_rider_phone}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.orderActionRow}>
              {item.delivery_tracking_id && (
                <TouchableOpacity
                  style={styles.trackingBtn}
                  onPress={() => refreshTracking(orderId)}
                  disabled={trackingLoading === orderId}
                >
                  {trackingLoading === orderId ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color="#fff" />
                      <Text style={styles.trackingBtnText}>Refresh Tracking</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {(item as any).payment_provider === 'paymongo' &&
                (item as any).payment_status !== 'paid' && (
                  <TouchableOpacity
                    style={[styles.trackingBtn, { backgroundColor: '#FF9800' }]}
                    onPress={() => verifyPayment(orderId)}
                    disabled={verifyingPayment === orderId}
                  >
                    {verifyingPayment === orderId ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="card" size={16} color="#fff" />
                        <Text style={styles.trackingBtnText}>Verify Payment</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              {isDelivered && !customerConfirmed && !isCompleted && (
                <TouchableOpacity
                  style={[styles.trackingBtn, { backgroundColor: '#4CAF50' }]}
                  onPress={() => handleConfirmReceived(orderId)}
                  disabled={confirmingReceipt === orderId}
                >
                  {confirmingReceipt === orderId ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={16} color="#fff" />
                      <Text style={styles.trackingBtnText}>Confirm Received</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {customerConfirmed && (
                <View style={[styles.trackingBtn, { backgroundColor: '#E8F5E9' }]}>
                  <Ionicons name="checkmark-circle" size={16} color="#2E7D32" />
                  <Text style={[styles.trackingBtnText, { color: '#2E7D32' }]}>Receipt Confirmed</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="lock-closed-outline" size={80} color="#ccc" />
        <Text style={styles.emptyTitle}>Please Login</Text>
        <Text style={styles.emptyText}>You need to be logged in to view your orders</Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.loginButtonText}>Login Now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading orders...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Orders</Text>
        <Text style={styles.headerSubtitle}>Track and manage all your orders</Text>
      </View>

      <FlatList
        data={orders}
        renderItem={renderOrderItem}
        keyExtractor={(item) => item._id || item.id}
        contentContainerStyle={styles.listContainer}
        removeClippedSubviews={true}
        maxToRenderPerBatch={8}
        windowSize={5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />
        }
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Ionicons name="receipt-outline" size={60} color="#ccc" />
            <Text style={styles.emptyListTitle}>No Orders Yet</Text>
            <Text style={styles.emptyListText}>
              Start shopping to see your orders here!
            </Text>
            <TouchableOpacity
              style={styles.shopButton}
              onPress={() => navigation.navigate('MainTabs')}
            >
              <Text style={styles.shopButtonText}>Browse Products</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
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
    paddingTop: 15,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
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
  },
  loginButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 15,
    paddingBottom: 30,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
  },
  orderHeaderLeft: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  orderDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  orderHeaderRight: {
    alignItems: 'flex-end',
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  orderDetails: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    padding: 15,
  },
  detailSection: {
    marginBottom: 15,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  itemName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4CAF50',
    marginLeft: 8,
  },
  reviewBtn: {
    marginLeft: 8,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reviewBtnText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
    width: 100,
  },
  infoValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  proofImage: {
    width: 140,
    height: 100,
    borderRadius: 8,
    marginLeft: 8,
  },
  updateItem: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  updateDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
    marginTop: 4,
    marginRight: 10,
  },
  updateContent: {
    flex: 1,
  },
  updateStatus: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  updateTime: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  updateDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  emptyList: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyListTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  emptyListText: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
  shopButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 8,
  },
  shopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  orderActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  trackingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  trackingBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default OrdersScreen;
