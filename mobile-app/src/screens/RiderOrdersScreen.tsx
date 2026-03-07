import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { ordersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';

type RiderOrdersNavigationProp = StackNavigationProp<RootStackParamList>;

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

const RiderOrdersScreen: React.FC = () => {
  const { user } = useAuth();
  const navigation = useNavigation<RiderOrdersNavigationProp>();
  const [orders, setOrders] = useState<RiderOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proofs, setProofs] = useState<Record<string, any>>({});
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Per-order GPS tracking
  const locationSubscriptions = useRef<Record<string, Location.LocationSubscription>>({});
  const [trackingOrders, setTrackingOrders] = useState<Set<string>>(new Set());

  const loadOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await ordersAPI.getRiderOrders();
      setOrders(res.data?.orders || []);
    } catch (error) {
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user || user.role !== 'rider') {
        navigation.navigate('MainTabs');
        return;
      }
      loadOrders();
    }, [user, navigation, loadOrders])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  // Cleanup all GPS on unmount
  useEffect(() => {
    return () => {
      Object.values(locationSubscriptions.current).forEach((sub) => sub.remove());
      locationSubscriptions.current = {};
    };
  }, []);

  // Auto-manage GPS: start for on_the_way, stop for everything else
  useEffect(() => {
    orders.forEach((o) => {
      const st = (o.delivery_status || o.status || '').toLowerCase();
      if (st === 'on_the_way' && !locationSubscriptions.current[o.id]) {
        startGpsForOrder(o.id);
      }
    });
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
      if (locationSubscriptions.current[orderId]) return;

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
      if (__DEV__) console.error('Error starting GPS:', err);
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
        Alert.alert('Accepted', 'Delivery accepted. GPS tracking started automatically.');
        await startGpsForOrder(orderId);
        loadOrders();
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
      const permissionResult = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera permissions to upload proof.');
        return;
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'] as any,
            quality: 0.7,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'] as any,
            quality: 0.7,
          });

      if (!result.canceled && result.assets?.length) {
        setProofs((prev) => ({ ...prev, [orderId]: result.assets[0] }));
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to select image.');
    }
  };

  const updateStatus = async (orderId: string, status: string) => {
    try {
      if (status === 'delivered' && !proofs[orderId]) {
        Alert.alert('Proof Required', 'Please upload a delivery proof photo.');
        return;
      }

      let payload: any = { status };
      if (status === 'delivered' && proofs[orderId]) {
        const formData = new FormData();
        formData.append('status', status);

        const uri = proofs[orderId].uri;
        const filename = uri.split('/').pop() || `delivery_${orderId}.jpg`;
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';

        formData.append('delivery_proof', {
          uri,
          name: filename,
          type,
        } as any);
        payload = formData;
      }

      const res = await ordersAPI.updateRiderOrderStatus(orderId, payload);
      const data = res.data || {};
      if (data.success) {
        setProofs((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
        if (status === 'delivered') {
          // GPS auto-stops when order leaves on_the_way
          stopGpsForOrder(orderId);
        }
        Alert.alert('Success', `Order ${status} successfully! GPS tracking stopped.`);
        loadOrders();
      } else {
        Alert.alert('Error', data.message || 'Failed to update order status');
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to update order status');
    }
  };

  const formatStatus = (status?: string) => {
    return (status || 'pending')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatDate = (value?: string) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatShortId = (value: string) => {
    if (!value) return '';
    return value.slice(0, 6);
  };

  if (!user || user.role !== 'rider') {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="bicycle-outline" size={64} color="#ccc" />
        <Text style={styles.emptyTitle}>Rider Access Only</Text>
        <Text style={styles.emptyText}>You do not have access to rider orders.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assigned Orders</Text>
        <Text style={styles.headerSubtitle}>Upload proof before marking delivered.</Text>
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(76,175,80,0.12)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, alignSelf: 'flex-start' }}
          onPress={() => navigation.navigate('RiderRouteMap' as any)}
        >
          <Ionicons name="map-outline" size={16} color="#4CAF50" />
          <Text style={{ color: '#4CAF50', fontWeight: '600', fontSize: 13 }}>View Route Map</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="receipt-outline" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No orders assigned</Text>
          <Text style={styles.emptyText}>Assigned orders will show up here.</Text>
        </View>
      ) : (
        <View style={styles.ordersList}>
          {orders.map((order) => {
            const statusValue = (order.delivery_status || order.status || 'pending').toLowerCase();
            const proof = proofs[order.id];
            const statusUpdatedAt = order.delivery_status_updated_at || order.updated_at || order.created_at;
            const isTracking = trackingOrders.has(order.id);
            return (
              <View key={order.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>Order #{formatShortId(order.id)}</Text>
                    <Text style={styles.orderDate}>
                      {order.created_at
                        ? new Date(order.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.orderStatus}>{formatStatus(statusValue)}</Text>
                    <Text style={styles.orderDate}>{formatDate(statusUpdatedAt)}</Text>
                    {isTracking && (
                      <View style={styles.gpsIndicator}>
                        <Ionicons name="navigate" size={11} color="#4CAF50" />
                        <Text style={styles.gpsText}> GPS Active</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.orderMeta}>
                  <Text style={styles.metaLabel}>Buyer</Text>
                  <Text style={styles.metaValue}>{order.buyer_name || 'Customer'}</Text>
                  {order.buyer_phone && (
                    <Text style={styles.metaValue}>{order.buyer_phone}</Text>
                  )}
                </View>

                {(order.shipping_address || order.delivery_address) && (
                  <View style={styles.orderMeta}>
                    <Text style={styles.metaLabel}>Address</Text>
                    <Text style={styles.metaValue}>
                      {order.shipping_address || order.delivery_address}
                    </Text>
                  </View>
                )}

                {order.delivery_notes && (
                  <View style={styles.orderMeta}>
                    <Text style={styles.metaLabel}>Notes</Text>
                    <Text style={styles.metaValue}>{order.delivery_notes}</Text>
                  </View>
                )}

                {order.items && order.items.length > 0 && (
                  <View style={styles.orderItems}>
                    <Text style={styles.metaLabel}>Items</Text>
                    {order.items.map((item, idx) => (
                      <Text key={idx} style={styles.metaValue}>
                        • {item.name || 'Item'} x{item.quantity || 1}
                      </Text>
                    ))}
                  </View>
                )}

                {order.delivery_proof_url && (
                  <View style={styles.orderItems}>
                    <Text style={styles.metaLabel}>Delivery Proof</Text>
                    <Image
                      source={{ uri: order.delivery_proof_url }}
                      style={styles.proofImage}
                    />
                  </View>
                )}

                {/* Seller marked as picked_up → Rider sees Accept button */}
                {statusValue === 'picked_up' && (
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAcceptOrder(order.id)}
                    disabled={acceptingId === order.id}
                  >
                    {acceptingId === order.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color="#fff" />
                        <Text style={styles.acceptText}>  Accept Delivery</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

                {/* On the way → GPS is automatic, show proof + delivered button */}
                {statusValue === 'on_the_way' && (
                  <View style={styles.proofSection}>
                    <Text style={styles.metaLabel}>Delivery Proof</Text>
                    {proof ? (
                      <Image source={{ uri: proof.uri }} style={styles.proofImage} />
                    ) : (
                      <Text style={styles.metaValue}>No proof selected</Text>
                    )}
                    <View style={styles.proofActions}>
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => pickProof(order.id, true)}
                      >
                        <Text style={styles.secondaryText}>Take Photo</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => pickProof(order.id, false)}
                      >
                        <Text style={styles.secondaryText}>Choose File</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.actionButton, !proof && styles.disabledButton]}
                      onPress={() => updateStatus(order.id, 'delivered')}
                      disabled={!proof}
                    >
                      <Text style={styles.actionText}>Mark Delivered</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
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
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#E8F5E9',
    marginTop: 6,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  ordersList: {
    padding: 16,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  orderDate: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  orderStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
  },
  gpsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  gpsText: {
    fontSize: 10,
    color: '#4CAF50',
    fontWeight: '600',
  },
  orderMeta: {
    marginTop: 6,
  },
  metaLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    color: '#333',
  },
  orderItems: {
    marginTop: 10,
  },
  acceptButton: {
    backgroundColor: '#FF9800',
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  acceptText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  actionButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  actionText: {
    color: '#fff',
    fontWeight: '600',
  },
  proofSection: {
    marginTop: 10,
  },
  proofActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  secondaryButton: {
    backgroundColor: '#E8F5E9',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  secondaryText: {
    color: '#2E7D32',
    fontWeight: '600',
  },
  proofImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    marginTop: 6,
  },
  disabledButton: {
    opacity: 0.6,
  },
});

export default RiderOrdersScreen;
