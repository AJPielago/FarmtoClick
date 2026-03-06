import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { farmersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import 'leaflet/dist/leaflet.css';

/* ------------------------------------------------------------------ */
/*  Leaflet dynamic import helper – avoids SSR & bundler icon issues  */
/* ------------------------------------------------------------------ */
let L = null;
const getLeaflet = () => {
  if (!L) L = require('leaflet');
  return L;
};

const fixLeafletIcons = () => {
  const leaflet = getLeaflet();
  delete leaflet.Icon.Default.prototype._getIconUrl;
  leaflet.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
};

/* ------------------------------------------------------------------ */
/*  Simple map component rendered with plain Leaflet (no react-leaflet */
/*  wrapper to keep things lightweight and avoid version conflicts)    */
/* ------------------------------------------------------------------ */
const FarmMap = ({ lat, lng, label }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    fixLeafletIcons();
    const leaflet = getLeaflet();
    const map = leaflet.map(mapRef.current).setView([lat, lng], 14);
    leaflet
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);
    leaflet.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, label]);

  return <div ref={mapRef} style={{ width: '100%', height: '400px', borderRadius: '12px', zIndex: 0 }} />;
};

/* ------------------------------------------------------------------ */
/*  Geocode helper – uses free Nominatim API                          */
/* ------------------------------------------------------------------ */
const geocodeLocation = async (locationText) => {
  if (!locationText) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationText)}&limit=1`,
      { headers: { 'User-Agent': 'FarmToClick/1.0' } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (err) {
    console.error('Geocode error:', err);
  }
  return null;
};

/* ================================================================== */
/*  Farmer Profile Page                                               */
/* ================================================================== */
const FarmerProfile = () => {
  const { id } = useParams();
  const [farmer, setFarmer] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coords, setCoords] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);

  const loadFarmerProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await farmersAPI.getById(id);
      const data = response.data;
      setFarmer(data.farmer || data);
      setProducts(data.products || []);

      // Geocode farm location for the map
      const farmerData = data.farmer || data;
      const location =
        farmerData.farm_location ||
        farmerData.exact_address ||
        farmerData.overall_location;
      if (location) {
        const geo = await geocodeLocation(location);
        if (geo) setCoords(geo);
      }
    } catch (err) {
      console.error('Error loading farmer profile:', err);
      setError('Could not load farmer profile. Please try again later.');
    } finally {
      setIsLoading(false);
      setMapLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadFarmerProfile();
  }, [loadFarmerProfile]);

  /* ---------- loading / error states ---------- */
  if (isLoading) {
    return (
      <div className="farmer-profile-page">
        <Navbar activePage="farmers" />
        <div style={{ textAlign: 'center', padding: '6rem 2rem' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: '3rem', color: '#4CAF50' }}></i>
          <p style={{ marginTop: '1rem', color: '#666' }}>Loading farmer profile…</p>
        </div>
      </div>
    );
  }

  if (error || !farmer) {
    return (
      <div className="farmer-profile-page">
        <Navbar activePage="farmers" />
        <div style={{ textAlign: 'center', padding: '6rem 2rem' }}>
          <i className="fas fa-exclamation-triangle" style={{ fontSize: '3rem', color: '#f44336' }}></i>
          <h3 style={{ marginTop: '1rem', color: '#666' }}>{error || 'Farmer not found'}</h3>
          <Link to="/farmers" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
            <i className="fas fa-arrow-left"></i> Back to Farmers
          </Link>
        </div>
      </div>
    );
  }

  const farmLocation = farmer.farm_location || farmer.exact_address || farmer.overall_location;

  return (
    <div className="farmer-profile-page">
      <Navbar activePage="farmers" />

      {/* -------- header -------- */}
      <section className="farmer-header">
        <div className="container">
          <div className="farmer-profile-header">
            <div className="farmer-avatar-large">
              {farmer.profile_picture ? (
                <img src={typeof farmer.profile_picture === 'string' && farmer.profile_picture.startsWith('http') ? farmer.profile_picture : `/uploads/profiles/${farmer.profile_picture}`} alt={farmer.first_name} />
              ) : (
                <div className="avatar-placeholder">
                  <i className="fas fa-user-tie"></i>
                </div>
              )}
            </div>
            <div className="farmer-header-info">
              <h1>{farmer.first_name} {farmer.last_name || ''}</h1>
              <h2 className="farm-name">{farmer.farm_name || 'Local Farm'}</h2>
              <p className="location">
                <i className="fas fa-map-marker-alt"></i> {farmLocation || 'Location not specified'}
              </p>
              <p className="farmer-description">
                {farmer.farm_description || 'Dedicated to growing fresh, quality produce for our community.'}
              </p>
              <div className="farmer-contact">
                <a href={`mailto:${farmer.email}`} className="btn btn-primary">
                  <i className="fas fa-envelope"></i> Contact Farmer
                </a>
                <span className="phone">
                  <i className="fas fa-phone"></i> {farmer.farm_phone || farmer.phone || 'Contact via email'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* -------- map section -------- */}
      <section className="farmer-map-section" style={{ padding: '2rem 0' }}>
        <div className="container">
          <h2 style={{ marginBottom: '1rem' }}>
            <i className="fas fa-map-marked-alt" style={{ color: '#4CAF50', marginRight: '0.5rem' }}></i>
            Farm Location
          </h2>

          {mapLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', background: '#f5f5f5', borderRadius: '12px' }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#4CAF50' }}></i>
              <p style={{ marginTop: '0.5rem', color: '#666' }}>Loading map…</p>
            </div>
          ) : coords ? (
            <div style={{ borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
              <FarmMap
                lat={coords.lat}
                lng={coords.lng}
                label={`<strong>${farmer.farm_name || 'Farm'}</strong><br/>${farmLocation}`}
              />
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '3rem',
              background: '#f9f9f9',
              borderRadius: '12px',
              border: '2px dashed #ddd',
            }}>
              <i className="fas fa-map" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '0.5rem' }}></i>
              <p style={{ color: '#999' }}>
                {farmLocation
                  ? 'Could not pinpoint location on the map. Please check the address.'
                  : 'No farm location has been set yet.'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* -------- products -------- */}
      <section className="farmer-products">
        <div className="container">
          <h2>Available Products</h2>
          <div className="products-grid">
            {products.map((product) => (
              <div key={product.id || product._id} className="product-card">
                <div className="product-image">
                  {product.image_url || product.image ? (
                    <img
                      src={
                        (() => {
                          const val = (product.image_url || product.image || '');
                          if (!val) return '';
                          if (val.startsWith('http') || val.startsWith('/')) return val;
                          return `/uploads/products/${val}`;
                        })()
                      }
                      alt={product.name}
                    />
                  ) : (
                    <div className="product-placeholder">
                      <i className="fas fa-leaf"></i>
                    </div>
                  )}
                </div>
                <div className="product-info">
                  <h3>{product.name}</h3>
                  <p className="product-description">{product.description}</p>
                  <p className="product-price">
                    ₱{Number(product.price).toFixed(2)}/{product.unit}
                  </p>
                  <Link to={`/product/${product.id || product._id}`} className="btn btn-primary">
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {products.length === 0 && (
            <div className="no-products">
              <i className="fas fa-seedling"></i>
              <h3>No products available</h3>
              <p>This farmer hasn't listed any products yet.</p>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default FarmerProfile;