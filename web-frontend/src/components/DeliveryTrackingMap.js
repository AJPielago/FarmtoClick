import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import 'leaflet-routing-machine';
import api from '../services/api';

// Fix Leaflet default icon issue in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Custom icon for the rider
const riderIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3721/3721619.png', // A motorcycle icon
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Custom icon for the destination
const destinationIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/149/149059.png', // A simple map pin
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Component to handle routing logic inside the MapContainer
const RoutingMachine = ({ riderLocation, destinationCoords }) => {
  const map = useMap();
  const routingControlRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    // Create new route control only once
    const routingControl = L.Routing.control({
      waypoints: [],
      routeWhileDragging: false,
      addWaypoints: false,
      fitSelectedRoutes: true,
      showAlternatives: false,
      show: false, // Hide the text instructions panel
      lineOptions: {
        styles: [{ color: '#4CAF50', weight: 5 }],
        extendToWaypoints: true,
        missingRouteTolerance: 0
      },
      createMarker: () => null // We handle markers manually
    }).addTo(map);

    routingControlRef.current = routingControl;

    return () => {
      if (routingControl && map) {
        try {
          // Instead of map.removeControl, we use the control's own remove method
          // which cleans up its internal layers properly before removing from map
          routingControl.getPlan().setWaypoints([]);
          map.removeControl(routingControl);
        } catch (e) {
          console.error("Error removing routing control", e);
        }
      }
    };
  }, [map]);

  useEffect(() => {
    if (routingControlRef.current && riderLocation && destinationCoords) {
      try {
        routingControlRef.current.setWaypoints([
          L.latLng(riderLocation[0], riderLocation[1]),
          L.latLng(destinationCoords[0], destinationCoords[1])
        ]);
      } catch (e) {
        console.error("Error setting waypoints", e);
      }
    }
  }, [riderLocation, destinationCoords]);

  return null;
};

const DeliveryTrackingMap = ({ orderId, destinationAddress }) => {
  const [riderLocation, setRiderLocation] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // 1. Geocode the destination address once
  useEffect(() => {
    const geocodeAddress = async () => {
      try {
        // Using Nominatim (OpenStreetMap's free geocoding API)
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destinationAddress)}`);
        const data = await response.json();
        if (data && data.length > 0) {
          setDestinationCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        } else {
          console.warn("Could not geocode destination address:", destinationAddress);
        }
      } catch (err) {
        console.error("Geocoding error:", err);
      }
    };

    if (destinationAddress) {
      geocodeAddress();
    }
  }, [destinationAddress]);

  // 2. Poll the backend for the rider's location
  useEffect(() => {
    const fetchLocation = async () => {
      try {
        const res = await api.get(`/api/orders/${orderId}/location`);
        if (res.data && res.data.location) {
          setRiderLocation([res.data.location.lat, res.data.location.lng]);
          setLastUpdated(new Date(res.data.location.updated_at));
          setError(null);
        }
      } catch (err) {
        console.error("Error fetching rider location:", err);
        // Don't show error if it's just a 404 (location not available yet)
        if (err.response && err.response.status !== 404) {
          setError("Could not fetch rider location.");
        }
      }
    };

    // Fetch immediately
    fetchLocation();

    // Then poll every 10 seconds
    const intervalId = setInterval(fetchLocation, 10000);

    return () => clearInterval(intervalId);
  }, [orderId]);

  if (!riderLocation && !destinationCoords) {
    return (
      <div style={{ backgroundColor: '#f3f4f6', padding: '24px', borderRadius: '8px', textAlign: 'center', color: '#6b7280' }}>
        Waiting for GPS tracking to start...
      </div>
    );
  }

  // Default center to rider, or destination, or a fallback
  const center = riderLocation || destinationCoords || [14.5995, 120.9842]; // Manila fallback

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', color: '#4b5563' }}>
        <span>Live Delivery Tracking</span>
        {lastUpdated && (
          <span>Last updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        )}
      </div>
      
      {error && <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>}

      <div style={{ height: '400px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #eee', position: 'relative', zIndex: 0 }}>
        <MapContainer 
          center={center} 
          zoom={13} 
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {riderLocation && (
            <Marker position={riderLocation} icon={riderIcon}>
              <Popup>Rider's Current Location</Popup>
            </Marker>
          )}

          {destinationCoords && (
            <Marker position={destinationCoords} icon={destinationIcon}>
              <Popup>Delivery Destination: {destinationAddress}</Popup>
            </Marker>
          )}

          {riderLocation && destinationCoords && (
            <RoutingMachine 
              riderLocation={riderLocation} 
              destinationCoords={destinationCoords} 
            />
          )}
        </MapContainer>
      </div>
    </div>
  );
};

export default DeliveryTrackingMap;
