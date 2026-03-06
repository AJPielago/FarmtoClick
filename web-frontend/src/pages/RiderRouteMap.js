import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STATUS_COLORS = {
  ready_for_ship: '#3b82f6',
  picked_up: '#8b5cf6',
  on_the_way: '#06b6d4',
  delivered: '#10b981',
  cancelled: '#ef4444',
  pending: '#f59e0b',
};

const getStatusLabel = (key) => {
  const map = {
    delivered: 'Delivered',
    picked_up: 'Picked Up',
    on_the_way: 'On the Way',
    ready_for_ship: 'Ready for Pickup',
    cancelled: 'Cancelled',
    pending: 'Pending',
  };
  return map[key] || (key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const RiderRouteMap = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [routeData, setRouteData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [riderPos, setRiderPos] = useState(null);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const polylineRef = useRef(null);
  const routeLayersRef = useRef([]);

  // Get rider location
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setRiderPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => console.warn('Could not get rider location'),
      { enableHighAccuracy: true }
    );
  }, []);

  const loadRoute = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await ordersAPI.getRiderRouteMap(
        riderPos?.lat,
        riderPos?.lng
      );
      setRouteData(res.data);
    } catch (err) {
      console.error('[RiderRouteMap] Load error:', err);
      setError(err?.response?.data?.error || 'Failed to load delivery route');
    } finally {
      setIsLoading(false);
    }
  }, [riderPos]);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role === 'rider') {
      loadRoute();
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading, riderPos, loadRoute]);

  // Initialize and update map
  useEffect(() => {
    if (!routeData || !mapRef.current) return;

    // Initialize map if not already
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([14.5995, 120.9842], 12); // Default: Manila

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    // Clear old markers, polyline, and route layers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];

    const stops = routeData.stops || [];
    if (stops.length === 0) return;

    const latlngs = [];

    // Rider position marker
    if (routeData.start && riderPos) {
      const riderIcon = L.divIcon({
        html: `<div style="
          background: #10b981; color: white; width: 36px; height: 36px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: bold; font-size: 16px; border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">📍</div>`,
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      const m = L.marker([riderPos.lat, riderPos.lng], { icon: riderIcon })
        .addTo(map)
        .bindPopup('<strong>You are here</strong>');
      markersRef.current.push(m);
      latlngs.push([riderPos.lat, riderPos.lng]);
    }

    // Delivery stop markers
    stops.forEach((stop) => {
      if (!stop.lat || !stop.lng) return;

      const statusColor = STATUS_COLORS[stop.delivery_status] || '#6b7280';
      const icon = L.divIcon({
        html: `<div style="
          background: ${statusColor}; color: white; width: 32px; height: 32px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: bold; font-size: 14px; border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">${stop.stop_number}</div>`,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const items = (stop.items || []).map(i => `${i.name || 'Item'} x${i.quantity || 1}`).join(', ');
      const popupContent = `
        <div style="min-width:200px">
          <strong>Stop #${stop.stop_number}</strong><br/>
          <span style="font-size:12px; color:${statusColor}; font-weight:600">${getStatusLabel(stop.delivery_status)}</span><br/>
          <hr style="margin:6px 0; border-color:#eee"/>
          <strong>${stop.buyer_name || 'Customer'}</strong><br/>
          ${stop.buyer_phone ? `📞 ${stop.buyer_phone}<br/>` : ''}
          📍 ${stop.address || 'No address'}<br/>
          ${items ? `📦 ${items}<br/>` : ''}
          💰 ₱${Number(stop.total_amount || 0).toFixed(2)}
        </div>
      `;
      const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map).bindPopup(popupContent);
      markersRef.current.push(marker);
      latlngs.push([stop.lat, stop.lng]);
    });

    // Fetch road-following route from OSRM and draw it
    const fetchOsrmRoute = async () => {
      if (latlngs.length < 2) {
        if (latlngs.length > 0) {
          map.setView(latlngs[0], 14);
        }
        return;
      }

      // Build OSRM coordinate string: lng,lat;lng,lat;...
      const coords = latlngs.map(([lat, lng]) => `${lng},${lat}`).join(';');
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;

      try {
        const resp = await fetch(osrmUrl);
        const data = await resp.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const routeGeometry = data.routes[0].geometry;

          // Draw the road-following route
          const routeLayer = L.geoJSON(routeGeometry, {
            style: {
              color: '#2c7a2c',
              weight: 5,
              opacity: 0.85,
            },
          }).addTo(map);
          routeLayersRef.current.push(routeLayer);

          // Fit bounds to the route
          map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

          // Add distance/duration info
          const route = data.routes[0];
          const distKm = (route.distance / 1000).toFixed(1);
          const durMin = Math.round(route.duration / 60);
          const infoHtml = `<div style="font-size:13px"><strong>Route:</strong> ${distKm} km · ~${durMin} min drive</div>`;
          const infoPopup = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, className: 'route-info-popup' })
            .setLatLng(latlngs[0])
            .setContent(infoHtml)
            .addTo(map);
          routeLayersRef.current.push(infoPopup);
        } else {
          // Fallback to straight-line polyline if OSRM fails
          console.warn('[RiderRouteMap] OSRM routing failed, falling back to straight line');
          polylineRef.current = L.polyline(latlngs, {
            color: '#2c7a2c',
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 8',
          }).addTo(map);
          const bounds = L.latLngBounds(latlngs);
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      } catch (err) {
        console.error('[RiderRouteMap] OSRM fetch error:', err);
        // Fallback to straight-line
        polylineRef.current = L.polyline(latlngs, {
          color: '#2c7a2c',
          weight: 4,
          opacity: 0.7,
          dashArray: '10, 8',
        }).addTo(map);
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    };

    fetchOsrmRoute();

    // Fit to markers immediately while waiting for OSRM
    if (latlngs.length > 0) {
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [routeData, riderPos]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  if (!user || user.role !== 'rider') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>This page is only available for riders.</p>
        <Link to="/" style={{ color: '#2c7a2c', fontWeight: 600 }}>Go Home</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0fdf4' }}>
      <Navbar activePage="rider-route-map" />

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #166534 0%, #15803d 50%, #22c55e 100%)',
        padding: '28px 20px 22px',
        color: 'white',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>🗺️ Delivery Route Map</h1>
            <p style={{ margin: '6px 0 0', opacity: 0.9, fontSize: 14 }}>
              Optimised route for today's deliveries using shortest-path algorithm
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to="/rider-dashboard" style={{
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)',
              color: 'white', padding: '8px 16px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14,
            }}>Dashboard</Link>
            <Link to="/rider-orders" style={{
              background: 'white', color: '#166534', padding: '8px 16px', borderRadius: 8,
              textDecoration: 'none', fontWeight: 600, fontSize: 14,
            }}>View Orders</Link>
          </div>
        </div>
      </section>

      {/* Content */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 16px' }}>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{
              width: 44, height: 44, border: '4px solid #e5e7eb', borderTopColor: '#22c55e',
              borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite',
            }} />
            <p style={{ color: '#6b7280', fontSize: 15 }}>Calculating optimal delivery route…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : error ? (
          <div style={{
            textAlign: 'center', padding: 40, background: 'white', borderRadius: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)', margin: '20px 0',
          }}>
            <p style={{ color: '#ef4444', fontSize: 16, fontWeight: 600 }}>⚠️ {error}</p>
            <button onClick={loadRoute} style={{
              marginTop: 12, background: '#22c55e', color: 'white', border: 'none', padding: '10px 24px',
              borderRadius: 8, cursor: 'pointer', fontWeight: 600,
            }}>Try Again</button>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <div style={{
              display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16,
            }}>
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Total Stops</span>
                <span style={statValueStyle}>{routeData?.stops?.length || 0}</span>
              </div>
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Total Distance</span>
                <span style={statValueStyle}>{routeData?.total_distance_km || 0} km</span>
              </div>
              {routeData?.estimated_duration_min > 0 && (
                <div style={statCardStyle}>
                  <span style={statLabelStyle}>Est. Drive Time</span>
                  <span style={statValueStyle}>~{routeData.estimated_duration_min} min</span>
                </div>
              )}
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Geocoded</span>
                <span style={statValueStyle}>{routeData?.geocoded_orders || 0} / {routeData?.total_orders || 0}</span>
              </div>
              {routeData?.unresolved_stops?.length > 0 && (
                <div style={{ ...statCardStyle, background: '#fef3c7', borderColor: '#f59e0b' }}>
                  <span style={{ ...statLabelStyle, color: '#92400e' }}>Unresolved</span>
                  <span style={{ ...statValueStyle, color: '#92400e' }}>{routeData.unresolved_stops.length}</span>
                </div>
              )}
              <button onClick={loadRoute} style={{
                marginLeft: 'auto', background: '#22c55e', color: 'white', border: 'none',
                padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}>🔄 Refresh Route</button>
            </div>

            {/* Map */}
            <div style={{
              background: 'white', borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 20,
            }}>
              <div ref={mapRef} style={{ height: 500, width: '100%' }} />
            </div>

            {/* Ordered stops list */}
            {routeData?.stops?.length > 0 && (
              <div style={{
                background: 'white', borderRadius: 12, padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 18, color: '#1f2937' }}>
                  📋 Optimised Delivery Sequence
                </h3>
                {routeData.stops.map((stop, idx) => {
                  const statusColor = STATUS_COLORS[stop.delivery_status] || '#6b7280';
                  return (
                    <div key={stop.order_id} style={{
                      display: 'flex', gap: 14, alignItems: 'flex-start',
                      padding: '14px 0',
                      borderBottom: idx < routeData.stops.length - 1 ? '1px solid #f3f4f6' : 'none',
                    }}>
                      {/* Stop number badge */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', background: statusColor,
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 15, flexShrink: 0,
                      }}>{stop.stop_number}</div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8, flexWrap: 'wrap' }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#1f2937', fontSize: 15 }}>
                              {stop.buyer_name || 'Customer'}
                            </span>
                            {stop.buyer_phone && (
                              <span style={{ marginLeft: 10, fontSize: 13, color: '#6b7280' }}>📞 {stop.buyer_phone}</span>
                            )}
                          </div>
                          <span style={{
                            fontSize: 12, fontWeight: 600, color: statusColor,
                            background: `${statusColor}18`, padding: '3px 10px', borderRadius: 20,
                          }}>{getStatusLabel(stop.delivery_status)}</span>
                        </div>
                        <p style={{ margin: '4px 0 2px', fontSize: 13, color: '#4b5563' }}>
                          📍 {stop.address || 'No address'}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                          💰 ₱{Number(stop.total_amount || 0).toFixed(2)}
                          {stop.items?.length > 0 &&
                            ` · ${stop.items.map(i => `${i.name || 'Item'} x${i.quantity || 1}`).join(', ')}`
                          }
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Unresolved addresses */}
            {routeData?.unresolved_stops?.length > 0 && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
                padding: 20, marginTop: 16,
              }}>
                <h4 style={{ margin: '0 0 10px', color: '#92400e' }}>⚠️ Could Not Geocode These Addresses</h4>
                {routeData.unresolved_stops.map(stop => (
                  <div key={stop.order_id} style={{ padding: '8px 0', borderBottom: '1px solid #fde68a' }}>
                    <span style={{ fontWeight: 600 }}>{stop.buyer_name}</span>
                    <span style={{ marginLeft: 10, color: '#92400e', fontSize: 13 }}>{stop.address || 'No address provided'}</span>
                  </div>
                ))}
              </div>
            )}

            {(!routeData?.stops || routeData.stops.length === 0) && !routeData?.unresolved_stops?.length && (
              <div style={{
                textAlign: 'center', padding: 60, background: 'white', borderRadius: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
                <h3 style={{ color: '#374151', margin: '0 0 8px' }}>No Active Deliveries</h3>
                <p style={{ color: '#6b7280', fontSize: 14 }}>You have no pending deliveries for today.</p>
                <Link to="/rider-orders" style={{
                  display: 'inline-block', marginTop: 16, background: '#22c55e', color: 'white',
                  padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontWeight: 600,
                }}>Go to Orders</Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const statCardStyle = {
  background: 'white',
  padding: '12px 18px',
  borderRadius: 10,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  border: '1px solid #e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 120,
};

const statLabelStyle = {
  fontSize: 12,
  color: '#6b7280',
  fontWeight: 500,
};

const statValueStyle = {
  fontSize: 20,
  fontWeight: 700,
  color: '#1f2937',
};

export default RiderRouteMap;
