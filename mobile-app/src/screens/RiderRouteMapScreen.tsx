import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Platform,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ordersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';

type Nav = StackNavigationProp<RootStackParamList>;

const COLORS = {
  primary: '#166534',
  primaryLight: '#22c55e',
  surface: '#ffffff',
  background: '#f0fdf4',
  text: '#1f2937',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
  error: '#ef4444',
  warning: '#f59e0b',
};

const STATUS_COLORS: Record<string, string> = {
  ready_for_ship: '#3b82f6',
  picked_up: '#8b5cf6',
  on_the_way: '#06b6d4',
  delivered: '#10b981',
  cancelled: '#ef4444',
  pending: '#f59e0b',
};

const getStatusLabel = (key: string) => {
  const map: Record<string, string> = {
    delivered: 'Delivered',
    picked_up: 'Picked Up',
    on_the_way: 'On the Way',
    ready_for_ship: 'Ready for Pickup',
    cancelled: 'Cancelled',
    pending: 'Pending',
  };
  return map[key] || (key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

type Stop = {
  order_id: string;
  stop_number: number;
  address: string;
  lat: number | null;
  lng: number | null;
  buyer_name: string;
  buyer_phone: string;
  status: string;
  delivery_status: string;
  total_amount: number;
  items: Array<{ name?: string; quantity?: number }>;
};

type RouteData = {
  stops: Stop[];
  unresolved_stops: Stop[];
  total_distance_km: number;
  start: { lat: number; lng: number; label: string } | null;
  total_orders: number;
  geocoded_orders: number;
  message?: string;
};

const generateMapHtml = (stops: Stop[], riderLat?: number, riderLng?: number): string => {
  const markers = stops
    .filter((s) => s.lat && s.lng)
    .map(
      (s) => `{
      lat: ${s.lat}, lng: ${s.lng},
      num: ${s.stop_number},
      name: ${JSON.stringify(s.buyer_name || 'Customer')},
      address: ${JSON.stringify(s.address || '')},
      phone: ${JSON.stringify(s.buyer_phone || '')},
      amount: ${s.total_amount || 0},
      status: ${JSON.stringify(s.delivery_status || 'pending')},
      color: ${JSON.stringify(STATUS_COLORS[s.delivery_status] || '#6b7280')}
    }`
    )
    .join(',\n');

  const riderMarker =
    riderLat && riderLng
      ? `L.marker([${riderLat}, ${riderLng}], {
      icon: L.divIcon({
        html: '<div style="background:#10b981;color:white;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">📍</div>',
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
    }).addTo(map).bindPopup('<b>You are here</b>');
    latlngs.unshift([${riderLat}, ${riderLng}]);`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    #map { width: 100%; height: 100vh; }
    .leaflet-popup-content { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var stops = [${markers}];
    var map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OSM', maxZoom: 19
    }).addTo(map);

    var latlngs = [];
    ${riderMarker}

    stops.forEach(function(s) {
      var icon = L.divIcon({
        html: '<div style="background:' + s.color + ';color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">' + s.num + '</div>',
        className: '', iconSize: [30, 30], iconAnchor: [15, 15]
      });
      var popup = '<b>Stop #' + s.num + '</b><br/>' +
        '<span style="color:' + s.color + ';font-weight:600;font-size:11px">' + s.status.replace(/_/g,' ').toUpperCase() + '</span><br/>' +
        '<b>' + s.name + '</b><br/>' +
        (s.phone ? '📞 ' + s.phone + '<br/>' : '') +
        '📍 ' + s.address + '<br/>' +
        '₱' + s.amount.toFixed(2);
      L.marker([s.lat, s.lng], { icon: icon }).addTo(map).bindPopup(popup);
      latlngs.push([s.lat, s.lng]);
    });

    // Fit markers first
    if (latlngs.length > 0) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    } else {
      map.setView([14.5995, 120.9842], 12);
    }

    // Fetch road-following route from OSRM
    if (latlngs.length > 1) {
      var coords = latlngs.map(function(ll) { return ll[1] + ',' + ll[0]; }).join(';');
      var osrmUrl = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson&steps=true';
      fetch(osrmUrl)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            var routeLayer = L.geoJSON(data.routes[0].geometry, {
              style: { color: '#166534', weight: 5, opacity: 0.85 }
            }).addTo(map);
            map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
            var distKm = (data.routes[0].distance / 1000).toFixed(1);
            var durMin = Math.round(data.routes[0].duration / 60);
            L.popup({ closeButton: false, autoClose: false, closeOnClick: false })
              .setLatLng(latlngs[0])
              .setContent('<b>Route:</b> ' + distKm + ' km · ~' + durMin + ' min')
              .addTo(map);
          } else {
            L.polyline(latlngs, { color: '#166534', weight: 4, opacity: 0.7, dashArray: '10, 8' }).addTo(map);
          }
        })
        .catch(function() {
          L.polyline(latlngs, { color: '#166534', weight: 4, opacity: 0.7, dashArray: '10, 8' }).addTo(map);
        });
    }
  </script>
</body>
</html>`;
};

const RiderRouteMapScreen: React.FC = () => {
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(true);

  // Get rider GPS
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setRiderPos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch (err) {
        if (__DEV__) console.warn('Could not get rider location', err);
      }
    })();
  }, []);

  const loadRoute = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await ordersAPI.getRiderRouteMap(riderPos?.lat, riderPos?.lng);
      setRouteData(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load route');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [riderPos]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRoute();
  };

  const openGoogleMapsRoute = () => {
    if (!routeData?.stops?.length) return;
    const validStops = routeData.stops.filter((s) => s.lat && s.lng);
    if (!validStops.length) return;

    const dest = validStops[validStops.length - 1];
    const waypoints = validStops.slice(0, -1).map((s) => `${s.lat},${s.lng}`).join('|');
    const origin = riderPos ? `${riderPos.lat},${riderPos.lng}` : `${validStops[0].lat},${validStops[0].lng}`;

    const url = Platform.select({
      ios: `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest.lat},${dest.lng}&waypoints=${waypoints}&travelmode=driving`,
      default: `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest.lat},${dest.lng}&waypoints=${waypoints}&travelmode=driving`,
    });

    Linking.openURL(url).catch(() => {});
  };

  const openSingleNavigation = (lat: number, lng: number) => {
    const origin = riderPos ? `${riderPos.lat},${riderPos.lng}` : '';
    const url = `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${origin}` : ''}&destination=${lat},${lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => {});
  };

  if (!user || user.role !== 'rider') {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textSecondary} />
        <Text style={{ color: COLORS.textSecondary, marginTop: 12 }}>Access denied. Riders only.</Text>
      </View>
    );
  }

  const stops = routeData?.stops || [];
  const unresolvedStops = routeData?.unresolved_stops || [];
  const mapHtml = generateMapHtml(stops, riderPos?.lat, riderPos?.lng);

  return (
    <View style={styles.container}>
      {isLoading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primaryLight} />
          <Text style={{ color: COLORS.textSecondary, marginTop: 12 }}>Calculating optimal route…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning" size={48} color={COLORS.error} />
          <Text style={{ color: COLORS.error, marginTop: 12, fontWeight: '600' }}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadRoute}>
            <Text style={{ color: 'white', fontWeight: '600' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryLight} />}
          stickyHeaderIndices={[]}
        >
          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Stops</Text>
              <Text style={styles.statValue}>{stops.length}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Distance</Text>
              <Text style={styles.statValue}>{routeData?.total_distance_km || 0} km</Text>
            </View>
            {(routeData as any)?.estimated_duration_min > 0 && (
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Drive</Text>
                <Text style={styles.statValue}>~{(routeData as any).estimated_duration_min}m</Text>
              </View>
            )}
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Geocoded</Text>
              <Text style={styles.statValue}>{routeData?.geocoded_orders || 0}/{routeData?.total_orders || 0}</Text>
            </View>
          </View>

          {/* Toggle Map/List */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, showMap && styles.toggleBtnActive]}
              onPress={() => setShowMap(true)}
            >
              <Ionicons name="map" size={16} color={showMap ? 'white' : COLORS.primary} />
              <Text style={[styles.toggleText, showMap && styles.toggleTextActive]}>Map</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, !showMap && styles.toggleBtnActive]}
              onPress={() => setShowMap(false)}
            >
              <Ionicons name="list" size={16} color={!showMap ? 'white' : COLORS.primary} />
              <Text style={[styles.toggleText, !showMap && styles.toggleTextActive]}>Stops</Text>
            </TouchableOpacity>
          </View>

          {/* Navigate All button */}
          {stops.length > 0 && (
            <TouchableOpacity style={styles.navigateAllBtn} onPress={openGoogleMapsRoute}>
              <Ionicons name="navigate" size={18} color="white" />
              <Text style={styles.navigateAllText}>Navigate All Stops in Google Maps</Text>
            </TouchableOpacity>
          )}

          {showMap ? (
            /* Map View */
            stops.length > 0 ? (
              <View style={styles.mapContainer}>
                <WebView
                  originWhitelist={['*']}
                  source={{ html: mapHtml }}
                  style={styles.webview}
                  javaScriptEnabled
                  domStorageEnabled
                  scrollEnabled={false}
                  nestedScrollEnabled={false}
                />
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="mail-open-outline" size={56} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>No Active Deliveries</Text>
                <Text style={styles.emptySubtext}>You have no pending deliveries for today.</Text>
              </View>
            )
          ) : (
            /* Stops List */
            <>
              {stops.map((stop, idx) => {
                const statusColor = STATUS_COLORS[stop.delivery_status] || '#6b7280';
                const items = (stop.items || []).map((i) => `${i.name || 'Item'} x${i.quantity || 1}`).join(', ');

                return (
                  <View key={stop.order_id} style={styles.stopCard}>
                    <View style={styles.stopRow}>
                      <View style={[styles.stopBadge, { backgroundColor: statusColor }]}>
                        <Text style={styles.stopBadgeText}>{stop.stop_number}</Text>
                      </View>
                      <View style={styles.stopInfo}>
                        <View style={styles.stopHeader}>
                          <Text style={styles.stopName}>{stop.buyer_name || 'Customer'}</Text>
                          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                            <Text style={[styles.statusText, { color: statusColor }]}>
                              {getStatusLabel(stop.delivery_status)}
                            </Text>
                          </View>
                        </View>
                        {stop.buyer_phone ? (
                          <Text style={styles.stopDetail}>📞 {stop.buyer_phone}</Text>
                        ) : null}
                        <Text style={styles.stopDetail}>📍 {stop.address || 'No address'}</Text>
                        <Text style={styles.stopDetail}>
                          💰 ₱{Number(stop.total_amount || 0).toFixed(2)}
                          {items ? ` · ${items}` : ''}
                        </Text>
                      </View>
                    </View>
                    {stop.lat && stop.lng && (
                      <TouchableOpacity
                        style={styles.navigateBtn}
                        onPress={() => openSingleNavigation(stop.lat!, stop.lng!)}
                      >
                        <Ionicons name="navigate-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.navigateBtnText}>Navigate</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* Unresolved */}
          {unresolvedStops.length > 0 && (
            <View style={styles.unresolvedCard}>
              <Text style={styles.unresolvedTitle}>⚠️ Unresolved Addresses</Text>
              {unresolvedStops.map((s) => (
                <View key={s.order_id} style={styles.unresolvedItem}>
                  <Text style={styles.unresolvedName}>{s.buyer_name || 'Customer'}</Text>
                  <Text style={styles.unresolvedAddr}>{s.address || 'No address provided'}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </View>
  );
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  retryBtn: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 2,
  },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  toggleBtnActive: {
    backgroundColor: COLORS.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  toggleTextActive: {
    color: 'white',
  },
  navigateAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    marginHorizontal: 12,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  navigateAllText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  mapContainer: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    height: 380,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  webview: {
    flex: 1,
    width: SCREEN_WIDTH - 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  stopCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stopRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stopBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  stopInfo: {
    flex: 1,
  },
  stopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stopName: {
    fontWeight: '600',
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  stopDetail: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    gap: 6,
  },
  navigateBtnText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  unresolvedCard: {
    backgroundColor: '#fffbeb',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  unresolvedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 8,
  },
  unresolvedItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  unresolvedName: {
    fontWeight: '600',
    color: '#92400e',
    fontSize: 13,
  },
  unresolvedAddr: {
    color: '#b45309',
    fontSize: 12,
    marginTop: 2,
  },
});

export default RiderRouteMapScreen;
