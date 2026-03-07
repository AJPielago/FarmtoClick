import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ordersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';

type Nav = StackNavigationProp<RootStackParamList>;

type RiderOrder = {
  id: string;
  status?: string;
  delivery_status?: string;
  created_at?: string;
  updated_at?: string;
  delivery_status_updated_at?: string;
  buyer_name?: string;
  buyer_phone?: string;
  shipping_name?: string;
  shipping_phone?: string;
  shipping_address?: string;
  delivery_address?: string;
  delivery_notes?: string;
  items?: Array<{ name?: string; quantity?: number }>;
  total_amount?: number;
  delivery_proof_url?: string;
};

const RiderDashboardScreen: React.FC = () => {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [orders, setOrders] = useState<RiderOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [proofs, setProofs] = useState<Record<string, any>>({});

  // GPS tracking state – keyed by order id
  const locationSubscriptions = useRef<Record<string, Location.LocationSubscription>>({});
  const [trackingOrders, setTrackingOrders] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const [dashRes, ordersRes] = await Promise.all([
        ordersAPI.getRiderDashboard(),
        ordersAPI.getRiderOrders(),
      ]);
      setDashboardData(dashRes.data);
      setOrders(ordersRes.data?.orders || []);
    } catch (error) {
      if (__DEV__) console.error('Failed to load rider dashboard:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cleanup all GPS subscriptions on unmount
  useEffect(() => {
    return () => {
      Object.values(locationSubscriptions.current).forEach((sub) => sub.remove());
      locationSubscriptions.current = {};
    };
  }, []);

  // Auto-start GPS for orders already on_the_way when screen loads
  useEffect(() => {
    orders.forEach((o) => {
      const st = (o.delivery_status || o.status || '').toLowerCase();
      if (st === 'on_the_way' && !locationSubscriptions.current[o.id]) {
        startGpsForOrder(o.id);
      }
    });
    // Stop GPS for orders no longer on_the_way
    Object.keys(locationSubscriptions.current).forEach((oid) => {
      const order = orders.find((o) => o.id === oid);
      const st = order ? (order.delivery_status || order.status || '').toLowerCase() : '';
      if (st !== 'on_the_way') {
        stopGpsForOrder(oid);
      }
    });
  }, [orders]);

  const startGpsForOrder = async (orderId: string) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to track delivery.');
        return;
      }
      if (locationSubscriptions.current[orderId]) return; // already tracking

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
        async (loc) => {
          try {
            await ordersAPI.updateOrderLocation(orderId, loc.coords.latitude, loc.coords.longitude);
          } catch (err) {
            if (__DEV__) console.error(`GPS update failed for ${orderId}`, err);
          }
        },
      );
      locationSubscriptions.current[orderId] = sub;
      setTrackingOrders((prev) => new Set(prev).add(orderId));
    } catch (err) {
      if (__DEV__) console.error('Error starting GPS for order', orderId, err);
    }
  };

  const stopGpsForOrder = (orderId: string) => {
    const sub = locationSubscriptions.current[orderId];
    if (sub) {
      sub.remove();
      delete locationSubscriptions.current[orderId];
    }
    setTrackingOrders((prev) => {
      const next = new Set(prev);
      next.delete(orderId);
      return next;
    });
  };

  const handleAcceptOrder = async (orderId: string) => {
    try {
      setAcceptingId(orderId);
      const res = await ordersAPI.acceptRiderOrder(orderId);
      if (res.data?.success) {
        Alert.alert('Accepted', 'You accepted the delivery. GPS tracking started automatically.');
        await startGpsForOrder(orderId);
        loadData();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to accept order');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to accept order');
    } finally {
      setAcceptingId(null);
    }
  };

  const pickProof = async (orderId: string, useCamera: boolean) => {
    try {
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera permissions.');
        return;
      }
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.7 });
      if (!result.canceled && result.assets?.length) {
        setProofs((prev) => ({ ...prev, [orderId]: result.assets[0] }));
      }
    } catch {
      Alert.alert('Error', 'Failed to select image.');
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    const proof = proofs[orderId];
    if (!proof) {
      Alert.alert('Proof Required', 'Please upload a delivery proof photo first.');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('status', 'delivered');
      const uri = proof.uri;
      const filename = uri.split('/').pop() || `delivery_${orderId}.jpg`;
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';
      formData.append('delivery_proof', { uri, name: filename, type } as any);

      const res = await ordersAPI.updateRiderOrderStatus(orderId, formData);
      if (res.data?.success) {
        // GPS tracking auto-stops for this order
        stopGpsForOrder(orderId);
        setProofs((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
        Alert.alert('Success', 'Order marked as delivered. GPS tracking stopped.');
        loadData();
      } else {
        Alert.alert('Error', res.data?.message || 'Failed to update order');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to update order');
    }
  };

  const formatStatus = (s?: string) =>
    (s || 'pending').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const formatDate = (v?: string) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const formatShortId = (v: string) => (v ? v.slice(0, 6) : '');

  if (!user || user.role !== 'rider') {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="bicycle-outline" size={64} color="#ccc" />
        <Text style={styles.emptyText}>Rider access only.</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  const pendingAcceptOrders = orders.filter(
    (o) => (o.delivery_status || o.status || '').toLowerCase() === 'picked_up',
  );
  const activeOrders = orders.filter(
    (o) => (o.delivery_status || o.status || '').toLowerCase() === 'on_the_way',
  );
  const completedOrders = orders.filter((o) => {
    const st = (o.delivery_status || o.status || '').toLowerCase();
    return st === 'delivered' || st === 'completed';
  });

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Rider Dashboard</Text>
        <Text style={styles.subtitle}>Welcome back, {user.first_name || 'Rider'}!</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Ionicons name="alert-circle-outline" size={28} color="#FF9800" />
          <Text style={styles.statValue}>{pendingAcceptOrders.length}</Text>
          <Text style={styles.statLabel}>Awaiting Accept</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="bicycle-outline" size={28} color="#4CAF50" />
          <Text style={styles.statValue}>{activeOrders.length}</Text>
          <Text style={styles.statLabel}>In Transit</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="checkmark-circle-outline" size={28} color="#2196F3" />
          <Text style={styles.statValue}>{dashboardData?.completed_deliveries || completedOrders.length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      {/* Quick Links */}
      <View style={styles.quickLinks}>
        <TouchableOpacity style={styles.quickLink} onPress={() => navigation.navigate('RiderOrders')}>
          <Ionicons name="list-outline" size={20} color="#4CAF50" />
          <Text style={styles.quickLinkText}>All Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickLink} onPress={() => navigation.navigate('RiderRouteMap' as any)}>
          <Ionicons name="map-outline" size={20} color="#4CAF50" />
          <Text style={styles.quickLinkText}>Route Map</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickLink} onPress={() => navigation.navigate('RiderPrintableReports')}>
          <Ionicons name="document-text-outline" size={20} color="#4CAF50" />
          <Text style={styles.quickLinkText}>Reports</Text>
        </TouchableOpacity>
      </View>

      {/* Awaiting Acceptance Section */}
      {pendingAcceptOrders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="alert-circle" size={18} color="#FF9800" /> Awaiting Your Acceptance
          </Text>
          {pendingAcceptOrders.map((order) => (
            <View key={order.id} style={[styles.orderCard, styles.pendingCard]}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderNumber}>Order #{formatShortId(order.id)}</Text>
                  <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: '#FFF3E0' }]}>
                  <Text style={[styles.statusText, { color: '#E65100' }]}>Picked Up</Text>
                </View>
              </View>
              <View style={styles.orderMeta}>
                <Text style={styles.metaLabel}>Buyer</Text>
                <Text style={styles.metaValue}>{order.buyer_name || order.shipping_name || 'Customer'}</Text>
              </View>
              {(order.shipping_address || order.delivery_address) && (
                <View style={styles.orderMeta}>
                  <Text style={styles.metaLabel}>Address</Text>
                  <Text style={styles.metaValue}>{order.shipping_address || order.delivery_address}</Text>
                </View>
              )}
              {order.items && order.items.length > 0 && (
                <View style={styles.orderMeta}>
                  <Text style={styles.metaLabel}>Items</Text>
                  {order.items.map((item, idx) => (
                    <Text key={idx} style={styles.metaValue}>• {item.name || 'Item'} x{item.quantity || 1}</Text>
                  ))}
                </View>
              )}
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={() => handleAcceptOrder(order.id)}
                disabled={acceptingId === order.id}
              >
                {acceptingId === order.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.acceptButtonText}>  Accept Delivery</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Active Deliveries Section */}
      {activeOrders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="bicycle" size={18} color="#4CAF50" /> Active Deliveries
          </Text>
          {activeOrders.map((order) => {
            const proof = proofs[order.id];
            const isTracking = trackingOrders.has(order.id);
            return (
              <View key={order.id} style={[styles.orderCard, styles.activeCard]}>
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>Order #{formatShortId(order.id)}</Text>
                    <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                  </View>
                  <View style={styles.headerRight}>
                    <View style={[styles.statusBadge, { backgroundColor: '#E8F5E9' }]}>
                      <Text style={[styles.statusText, { color: '#2E7D32' }]}>On The Way</Text>
                    </View>
                    {isTracking && (
                      <View style={styles.gpsIndicator}>
                        <Ionicons name="navigate" size={12} color="#4CAF50" />
                        <Text style={styles.gpsText}> GPS Active</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.orderMeta}>
                  <Text style={styles.metaLabel}>Buyer</Text>
                  <Text style={styles.metaValue}>{order.buyer_name || order.shipping_name || 'Customer'}</Text>
                  {(order.buyer_phone || order.shipping_phone) && (
                    <Text style={styles.metaValue}>{order.buyer_phone || order.shipping_phone}</Text>
                  )}
                </View>
                {(order.shipping_address || order.delivery_address) && (
                  <View style={styles.orderMeta}>
                    <Text style={styles.metaLabel}>Address</Text>
                    <Text style={styles.metaValue}>{order.shipping_address || order.delivery_address}</Text>
                  </View>
                )}
                {order.delivery_notes && (
                  <View style={styles.orderMeta}>
                    <Text style={styles.metaLabel}>Notes</Text>
                    <Text style={styles.metaValue}>{order.delivery_notes}</Text>
                  </View>
                )}

                {/* Delivery proof section */}
                <View style={styles.proofSection}>
                  <Text style={styles.metaLabel}>Delivery Proof</Text>
                  {proof ? (
                    <Image source={{ uri: proof.uri }} style={styles.proofImage} />
                  ) : (
                    <Text style={styles.metaValue}>No proof selected</Text>
                  )}
                  <View style={styles.proofActions}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => pickProof(order.id, true)}>
                      <Text style={styles.secondaryText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => pickProof(order.id, false)}>
                      <Text style={styles.secondaryText}>Choose File</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={[styles.deliveredButton, !proof && styles.disabledButton]}
                    onPress={() => handleMarkDelivered(order.id)}
                    disabled={!proof}
                  >
                    <Ionicons name="checkmark-done" size={18} color="#fff" />
                    <Text style={styles.deliveredButtonText}>  Mark Delivered</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Completed Section (recent) */}
      {completedOrders.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="checkmark-circle" size={18} color="#2196F3" /> Recently Completed
          </Text>
          {completedOrders.slice(0, 5).map((order) => (
            <View key={order.id} style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderNumber}>Order #{formatShortId(order.id)}</Text>
                  <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: '#E3F2FD' }]}>
                  <Text style={[styles.statusText, { color: '#1565C0' }]}>
                    {formatStatus(order.delivery_status || order.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.metaValue}>{order.buyer_name || order.shipping_name || 'Customer'}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Empty state */}
      {orders.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No orders assigned yet</Text>
          <Text style={styles.emptySubtitle}>Orders will appear here once assigned to you.</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#4CAF50', padding: 24, paddingTop: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 15, color: '#E8F5E9', marginTop: 4 },
  statsContainer: { flexDirection: 'row', justifyContent: 'space-around', marginTop: -20, paddingHorizontal: 10 },
  statCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center',
    width: '30%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  statValue: { fontSize: 22, fontWeight: 'bold', color: '#333', marginTop: 6 },
  statLabel: { fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' },
  quickLinks: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 16, paddingHorizontal: 16 },
  quickLink: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2,
  },
  quickLinkText: { marginLeft: 6, color: '#4CAF50', fontWeight: '600', fontSize: 13 },
  section: { padding: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 12 },
  orderCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#eee',
  },
  pendingCard: { borderColor: '#FFE0B2', borderWidth: 1.5 },
  activeCard: { borderColor: '#C8E6C9', borderWidth: 1.5 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  headerRight: { alignItems: 'flex-end' },
  orderNumber: { fontSize: 15, fontWeight: '600', color: '#333' },
  orderDate: { fontSize: 12, color: '#777', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderMeta: { marginTop: 6 },
  metaLabel: { fontSize: 12, color: '#666', marginBottom: 2 },
  metaValue: { fontSize: 13, color: '#333' },
  gpsIndicator: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  gpsText: { fontSize: 10, color: '#4CAF50', fontWeight: '600' },
  acceptButton: {
    backgroundColor: '#FF9800', flexDirection: 'row', paddingVertical: 12,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  acceptButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  proofSection: { marginTop: 10 },
  proofActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondaryButton: { backgroundColor: '#E8F5E9', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  secondaryText: { color: '#2E7D32', fontWeight: '600' },
  proofImage: { width: '100%', height: 180, borderRadius: 10, marginTop: 6 },
  deliveredButton: {
    backgroundColor: '#4CAF50', flexDirection: 'row', paddingVertical: 12,
    borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  deliveredButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabledButton: { opacity: 0.5 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: '#666', marginTop: 6, textAlign: 'center' },
  emptyText: { fontSize: 16, color: '#666', marginTop: 10 },
});

export default RiderDashboardScreen;
