import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
  Image,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { productsAPI, ordersAPI, ridersAPI } from '../services/api';
import { Product, SellerOrder, RootStackParamList } from '../types';
import { formatStatus as formatStatusUtil, formatDate as formatDateUtil, formatShortId as formatShortIdUtil } from '../utils/helpers';

interface Rider {
  id: string;
  _id?: string;
  name: string;
  phone?: string;
  barangay?: string;
  city?: string;
  province?: string;
}

type FarmerDashboardNavigationProp = StackNavigationProp<RootStackParamList>;

const LALAMOVE_BOOKING_URL = 'https://web.lalamove.com/?shortlink=of9j9igz&c=ROW_ROW_USR-ALL_OWN_ACQ_WEB_ALL_Button&pid=WEB&af_xp=custom&source_caller=ui';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FFF3E0', text: '#E65100' },
  confirmed: { bg: '#E3F2FD', text: '#1565C0' },
  preparing: { bg: '#F3E5F5', text: '#7B1FA2' },
  ready: { bg: '#E0F7FA', text: '#00838F' },
  completed: { bg: '#E8F5E9', text: '#2E7D32' },
  delivered: { bg: '#E8F5E9', text: '#1B5E20' },
  cancelled: { bg: '#FFEBEE', text: '#C62828' },
  rejected: { bg: '#FFEBEE', text: '#C62828' },
};

const FarmerDashboardScreen: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rejectionOrderId, setRejectionOrderId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isUpdatingOrder, setIsUpdatingOrder] = useState(false);
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [showRiderPicker, setShowRiderPicker] = useState(false);
  const [riderPickerOrderId, setRiderPickerOrderId] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectOrderId, setRejectOrderId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  const { user } = useAuth();
  const navigation = useNavigation<FarmerDashboardNavigationProp>();

  const loadFarmerData = useCallback(async () => {
    if (!user?.is_farmer) {
      setIsLoading(false);
      return;
    }
    try {
      const [productsRes, ordersRes, ridersRes] = await Promise.all([
        productsAPI.getProducts(),
        ordersAPI.getSellerOrders(),
        ridersAPI.getActive(),
      ]);
      setProducts(productsRes.data?.products || []);
      setSellerOrders(ordersRes.data?.orders || []);
      setRiders(ridersRes.data?.riders || []);
    } catch (error) {
      if (__DEV__) console.error('Error loading farmer data:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadFarmerData();
    }, [loadFarmerData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadFarmerData();
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    if (status === 'rejected') {
      setRejectOrderId(orderId);
      setRejectReasonInput('');
      setShowRejectModal(true);
      return;
    }

    setIsUpdatingOrder(true);
    try {
      await ordersAPI.updateSellerOrderStatus(orderId, { status });
      Alert.alert('Success', `Order ${status} successfully!`);
      loadFarmerData();
    } catch (error) {
      Alert.alert('Error', 'Failed to update order status');
    } finally {
      setIsUpdatingOrder(false);
    }
  };

  const confirmRejectOrder = async () => {
    if (!rejectReasonInput.trim()) {
      Alert.alert('Error', 'Rejection reason is required');
      return;
    }
    if (!rejectOrderId) return;
    setShowRejectModal(false);
    setIsUpdatingOrder(true);
    try {
      await ordersAPI.updateSellerOrderStatus(rejectOrderId, {
        status: 'rejected',
        reason: rejectReasonInput.trim(),
      });
      Alert.alert('Success', 'Order rejected successfully');
      loadFarmerData();
    } catch (error) {
      Alert.alert('Error', 'Failed to reject order');
    } finally {
      setIsUpdatingOrder(false);
      setRejectOrderId(null);
      setRejectReasonInput('');
    }
  };

  const openLalamoveBooking = async () => {
    try {
      await Linking.openURL(LALAMOVE_BOOKING_URL);
    } catch {
      Alert.alert('Error', 'Unable to open Lalamove booking page.');
    }
  };

  const normalizeText = (value: any) => (value || '').toString().toLowerCase();

  const getOrderAddressText = (order: SellerOrder) =>
    `${order.shipping_address || ''} ${(order as any).delivery_address || ''}`.trim();

  const riderMatchesOrder = (order: SellerOrder, rider: Rider) => {
    const addressText = normalizeText(getOrderAddressText(order));
    if (!addressText) return false;
    const city = normalizeText(rider.city);
    const province = normalizeText(rider.province);
    const barangay = normalizeText(rider.barangay);
    if (city && addressText.includes(city)) return true;
    if (province && addressText.includes(province)) return true;
    if (barangay && addressText.includes(barangay)) return true;
    return false;
  };

  const openRiderPicker = (orderId: string) => {
    setRiderPickerOrderId(orderId);
    setShowRiderPicker(true);
  };

  const assignRider = async (rider: Rider) => {
    if (!riderPickerOrderId) return;
    const order = sellerOrders.find((o) => (o._id || o.id) === riderPickerOrderId);
    if (!order) return;

    if (!riderMatchesOrder(order, rider)) {
      Alert.alert('Mismatch', 'Rider must match buyer barangay/city/province.');
      return;
    }

    try {
      setAssigningOrderId(riderPickerOrderId);
      const res = await ordersAPI.assignRider(riderPickerOrderId, { rider_id: rider.id || rider._id });
      if (res.data?.success !== false) {
        Alert.alert('Success', `Assigned ${rider.name} to order`);
        setShowRiderPicker(false);
        setRiderPickerOrderId(null);
        loadFarmerData();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to assign rider');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to assign rider');
    } finally {
      setAssigningOrderId(null);
    }
  };

  const formatStatus = (status: string) => formatStatusUtil(status);

  const formatPaymentMethod = (method?: string) => {
    if (!method) {
      return 'Not specified';
    }

    const normalized = method.toString().trim().toLowerCase();
    const knownMethods: Record<string, string> = {
      gcash: 'GCash',
      qrph: 'QRPh',
      mobile: 'Mobile Money',
      card: 'Card',
      cash: 'Cash',
      cod: 'Cash on Delivery',
      bank: 'Bank Transfer',
    };

    return knownMethods[normalized] || formatStatus(method);
  };

  const getStatusStyle = (status: string) => {
    const normalized = (status || 'pending').toLowerCase().replace(/[_\s]+/g, '');
    return STATUS_COLORS[normalized] || STATUS_COLORS.pending;
  };

  const formatDate = (dateStr: string) => formatDateUtil(dateStr);

  const formatShortId = (value: string) => formatShortIdUtil(value);

  // Calculate stats
  const availableCount = products.filter((p) => p.available !== false && p.quantity > 0).length;
  const outOfStockCount = products.length - availableCount;
  const pendingOrders = sellerOrders.filter(
    (o) => o.status === 'pending' || o.status === 'confirmed'
  ).length;
  const totalRevenue = sellerOrders
    .filter((o) => o.status === 'completed' || o.status === 'delivered')
    .reduce((sum, o) => sum + (o.total_amount || o.total || 0), 0);

  if (!user?.is_farmer) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="storefront-outline" size={80} color="#ccc" />
        <Text style={styles.emptyTitle}>Not a Seller</Text>
        <Text style={styles.emptyText}>
          You need to be a verified seller to access this dashboard
        </Text>
        <TouchableOpacity
          style={styles.startSellingButton}
          onPress={() => navigation.navigate('StartSelling')}
        >
          <Text style={styles.startSellingButtonText}>Start Selling</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Shop</Text>
        <Text style={styles.headerSubtitle}>
          {user.farm_name || `${user.first_name}'s Farm`}
        </Text>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => navigation.navigate('ManageProducts')}
        >
          <Ionicons name="cube" size={28} color="#4CAF50" />
          <Text style={styles.statNumber}>{products.length}</Text>
          <Text style={styles.statLabel}>Total Products</Text>
        </TouchableOpacity>

        <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
          <Ionicons name="checkmark-circle" size={28} color="#2E7D32" />
          <Text style={styles.statNumber}>{availableCount}</Text>
          <Text style={styles.statLabel}>Available</Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: '#FFEBEE' }]}>
          <Ionicons name="alert-circle" size={28} color="#C62828" />
          <Text style={styles.statNumber}>{outOfStockCount}</Text>
          <Text style={styles.statLabel}>Out of Stock</Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
          <Ionicons name="time" size={28} color="#E65100" />
          <Text style={styles.statNumber}>{pendingOrders}</Text>
          <Text style={styles.statLabel}>Pending Orders</Text>
        </View>
      </View>

      {/* Revenue Card */}
      <View style={styles.revenueCard}>
        <View style={styles.revenueInfo}>
          <Text style={styles.revenueLabel}>Total Revenue</Text>
          <Text style={styles.revenueAmount}>₱{totalRevenue.toFixed(2)}</Text>
        </View>
        <Ionicons name="trending-up" size={40} color="#4CAF50" />
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('ManageProducts')}
          >
            <Ionicons name="add-circle" size={24} color="#fff" />
            <Text style={styles.actionButtonText}>Manage Products</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#FF9800' }]}
            onPress={openLalamoveBooking}
          >
            <Ionicons name="bicycle" size={24} color="#fff" />
            <Text style={styles.actionButtonText}>Book Delivery</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#1565C0' }]}
            onPress={() => navigation.navigate('CoVendorsMarketplace' as any)}
          >
            <Ionicons name="storefront" size={24} color="#fff" />
            <Text style={styles.actionButtonText}>Vendors Market</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Recent Orders */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Orders</Text>
          <Text style={styles.orderCount}>{sellerOrders.length} orders</Text>
        </View>

        {sellerOrders.length === 0 ? (
          <View style={styles.emptyOrders}>
            <Ionicons name="receipt-outline" size={50} color="#ccc" />
            <Text style={styles.emptyOrdersText}>No orders yet</Text>
          </View>
        ) : (
          sellerOrders.slice(0, 5).map((order) => {
            const orderId = order._id || order.id;
            const statusStyle = getStatusStyle(order.status);
            const total = order.total_amount || order.total || 0;
            const paymentMethodLabel = formatPaymentMethod(order.payment_method);

            return (
              <View key={orderId} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>
                      #{order.order_number || formatShortId(orderId)}
                    </Text>
                    <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                    {order.buyer_name && (
                      <Text style={styles.buyerName}>by {order.buyer_name}</Text>
                    )}
                    <Text style={styles.paymentMethod}>Payment: {paymentMethodLabel}</Text>
                  </View>
                  <View style={styles.orderRight}>
                    <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[styles.statusText, { color: statusStyle.text }]}>
                        {formatStatus(order.status)}
                      </Text>
                    </View>
                    <Text style={styles.orderTotal}>₱{total.toFixed(2)}</Text>
                  </View>
                </View>

                {/* Order Items */}
                {order.items && order.items.length > 0 && (
                  <View style={styles.orderItems}>
                    {order.items.map((item, idx) => (
                      <Text key={idx} style={styles.orderItem}>
                        • {item.product_name} x{item.quantity}
                      </Text>
                    ))}
                  </View>
                )}

                {order.delivery_proof_url && (
                  <View style={styles.orderItems}>
                    <Text style={styles.orderItemLabel}>Delivery Proof</Text>
                    <Image
                      source={{ uri: order.delivery_proof_url }}
                      style={styles.proofImage}
                      resizeMode="cover"
                    />
                  </View>
                )}

                {/* Shipping Info */}
                {(order.shipping_name || order.shipping_phone || order.shipping_address) && (
                  <View style={styles.orderItems}>
                    <Text style={styles.orderItemLabel}>Shipping Info</Text>
                    {order.shipping_name && (
                      <Text style={styles.orderItem}>Recipient: {order.shipping_name}</Text>
                    )}
                    {order.shipping_phone && (
                      <Text style={styles.orderItem}>Phone: {order.shipping_phone}</Text>
                    )}
                    {order.shipping_address && (
                      <Text style={styles.orderItem}>Address: {order.shipping_address}</Text>
                    )}
                    {(order as any).delivery_notes && (
                      <Text style={styles.orderItem}>Notes: {(order as any).delivery_notes}</Text>
                    )}
                  </View>
                )}

                {/* Assigned Rider Info */}
                {(order as any).assigned_rider_name && (
                  <View style={styles.orderItems}>
                    <Text style={styles.orderItemLabel}>Assigned Rider</Text>
                    <Text style={styles.orderItem}>Name: {(order as any).assigned_rider_name}</Text>
                    {(order as any).assigned_rider_phone && (
                      <Text style={styles.orderItem}>Phone: {(order as any).assigned_rider_phone}</Text>
                    )}
                  </View>
                )}

                {/* Order Actions - Full Lifecycle */}
                {order.status === 'pending' && (
                  <View style={styles.orderActions}>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, styles.confirmBtn]}
                      onPress={() => updateOrderStatus(orderId, 'approved')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, styles.rejectBtn]}
                      onPress={() => updateOrderStatus(orderId, 'rejected')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionTextDanger}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {(order.status === 'confirmed' || order.status === 'approved') && (
                  <View style={styles.orderActions}>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, styles.prepareBtn]}
                      onPress={() => updateOrderStatus(orderId, 'preparing')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Start Preparing</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, styles.readyBtn]}
                      onPress={() => updateOrderStatus(orderId, 'ready_for_ship')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Mark Ready</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {order.status === 'ready_for_ship' && (
                  <View style={styles.orderActions}>
                    {!(order as any).assigned_rider_id && (
                      <TouchableOpacity
                        style={[styles.orderActionBtn, { backgroundColor: '#2196F3' }]}
                        onPress={() => openRiderPicker(orderId)}
                        disabled={isUpdatingOrder}
                      >
                        <Text style={styles.orderActionText}>Assign Rider</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.orderActionBtn, { backgroundColor: '#9C27B0' }]}
                      onPress={() => updateOrderStatus(orderId, 'picked_up')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Mark Picked Up</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {order.status === 'picked_up' && (
                  <View style={styles.orderActions}>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, { backgroundColor: '#FF5722' }]}
                      onPress={() => updateOrderStatus(orderId, 'on_the_way')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Mark On the Way</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {order.status === 'on_the_way' && (
                  <View style={styles.orderActions}>
                    <TouchableOpacity
                      style={[styles.orderActionBtn, styles.confirmBtn]}
                      onPress={() => updateOrderStatus(orderId, 'delivered')}
                      disabled={isUpdatingOrder}
                    >
                      <Text style={styles.orderActionText}>Mark Delivered</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>

      {/* Rider Picker Modal inline */}
      {showRiderPicker && (
        <View style={styles.riderPickerOverlay}>
          <View style={styles.riderPickerCard}>
            <View style={styles.riderPickerHeader}>
              <Text style={styles.riderPickerTitle}>Select a Rider</Text>
              <TouchableOpacity onPress={() => setShowRiderPicker(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            <Text style={styles.riderPickerHint}>
              Riders matching the order's delivery area are highlighted.
            </Text>
            {riders.length === 0 ? (
              <Text style={styles.emptyOrdersText}>No active riders available</Text>
            ) : (
              riders.map((rider) => {
                const order = sellerOrders.find((o) => (o._id || o.id) === riderPickerOrderId);
                const isMatch = order ? riderMatchesOrder(order, rider) : false;
                return (
                  <TouchableOpacity
                    key={rider.id || rider._id}
                    style={[
                      styles.riderPickerItem,
                      isMatch && styles.riderPickerItemMatch,
                    ]}
                    onPress={() => assignRider(rider)}
                    disabled={assigningOrderId === (rider.id || rider._id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.riderPickerName}>{rider.name}</Text>
                      {rider.phone && <Text style={styles.riderPickerMeta}>{rider.phone}</Text>}
                      <Text style={styles.riderPickerArea}>
                        {[rider.barangay, rider.city, rider.province].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                    {isMatch && (
                      <View style={styles.matchBadge}>
                        <Text style={styles.matchBadgeText}>Match</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      )}

      {/* Rejection Reason Modal (cross-platform replacement for Alert.prompt) */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject Order</Text>
            <Text style={styles.modalSubtitle}>Please provide a reason for rejection:</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter rejection reason..."
              value={rejectReasonInput}
              onChangeText={setRejectReasonInput}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => { setShowRejectModal(false); setRejectOrderId(null); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalRejectBtn]}
                onPress={confirmRejectOrder}
              >
                <Text style={styles.modalRejectText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.bottomPadding} />
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
  startSellingButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  startSellingButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  revenueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  revenueInfo: {
    flex: 1,
  },
  revenueLabel: {
    fontSize: 14,
    color: '#666',
  },
  revenueAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginTop: 5,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 12,
    padding: 15,
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
  },
  orderCount: {
    fontSize: 14,
    color: '#666',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyOrders: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyOrdersText: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
  },
  orderCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  orderDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  buyerName: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 2,
  },
  paymentMethod: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 5,
  },
  orderItems: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  orderItem: {
    fontSize: 13,
    color: '#555',
    marginBottom: 3,
  },
  orderItemLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  proofImage: {
    width: 160,
    height: 120,
    borderRadius: 8,
  },
  orderActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  orderActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmBtn: {
    backgroundColor: '#4CAF50',
  },
  rejectBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dc3545',
  },
  prepareBtn: {
    backgroundColor: '#9C27B0',
  },
  readyBtn: {
    backgroundColor: '#00BCD4',
  },
  orderActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  orderActionTextDanger: {
    color: '#dc3545',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomPadding: {
    height: 30,
  },
  riderPickerOverlay: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 12,
    padding: 15,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  riderPickerCard: {},
  riderPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  riderPickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  riderPickerHint: {
    fontSize: 12,
    color: '#888',
    marginBottom: 10,
  },
  riderPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
    marginBottom: 6,
  },
  riderPickerItemMatch: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  riderPickerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  riderPickerMeta: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  riderPickerArea: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  matchBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  matchBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  // Rejection Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
    backgroundColor: '#f9f9f9',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelBtn: {
    backgroundColor: '#f0f0f0',
  },
  modalCancelText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 15,
  },
  modalRejectBtn: {
    backgroundColor: '#dc3545',
  },
  modalRejectText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});

export default FarmerDashboardScreen;
