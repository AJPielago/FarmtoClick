import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const Profile = () => {
  const { user, updateProfile } = useAuth();
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    overall_location: '',
    shipping_address: '',
    overall_location_2: '',
    shipping_address_2: '',
    farm_name: '',
    farm_phone: '',
    farm_location: '',
    farm_description: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const [removeProfilePicture, setRemoveProfilePicture] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        overall_location: user.overall_location || '',
        shipping_address: user.shipping_address || '',
        overall_location_2: user.overall_location_2 || '',
        shipping_address_2: user.shipping_address_2 || '',
        farm_name: user.farm_name || '',
        farm_phone: user.farm_phone || '',
        farm_location: user.farm_location || '',
        farm_description: user.farm_description || '',
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
      if (user.profile_picture) {
        if (typeof user.profile_picture === 'string' && user.profile_picture.startsWith('http')) {
          setProfilePreview(user.profile_picture);
        } else {
          setProfilePreview(`/uploads/profiles/${user.profile_picture}`);
        }
      }
    }
  }, [user]);

  const handleChange = (e) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleProfilePictureChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setProfilePicture(file);
      setProfilePreview(URL.createObjectURL(file));
      setRemoveProfilePicture(false);
    }
  };

  const handleRemoveProfilePicture = () => {
    setProfilePicture(null);
    setProfilePreview('/images/default-avatar.svg');
    setRemoveProfilePicture(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getLocationFromGPS = async () => {
    const btn = document.getElementById('getLocationBtn');
    const originalText = btn.innerHTML;

    if (!navigator.geolocation) {
      setFlashMessages([{ category: 'error', text: 'Geolocation is not supported by this browser.' }]);
      return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting location...';
    btn.disabled = true;

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000,
        });
      });

      const { latitude, longitude } = position.coords;

      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`
      );
      const data = await response.json();

      if (data && data.display_name) {
        setFormData(prev => ({
          ...prev,
          overall_location: data.display_name,
        }));
        btn.innerHTML = '<i class="fas fa-check"></i> Location set!';
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
        }, 2000);
      } else {
        setFormData(prev => ({
          ...prev,
          shipping_address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        }));
        setFlashMessages([{ category: 'info', text: 'Could not get full address, but coordinates have been set.' }]);
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    } catch (error) {
      let errorMessage = 'Unable to get your location. ';
      if (error.code === 1) errorMessage += 'Please allow location access and try again.';
      else if (error.code === 2) errorMessage += 'Location information is unavailable.';
      else if (error.code === 3) errorMessage += 'Location request timed out.';
      else errorMessage += 'An unknown error occurred.';
      setFlashMessages([{ category: 'error', text: errorMessage }]);
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Password validation
    if (formData.new_password || formData.confirm_password) {
      if (!formData.current_password) {
        setFlashMessages([{ category: 'error', text: 'Please enter your current password to change password' }]);
        return;
      }
      if (formData.new_password !== formData.confirm_password) {
        setFlashMessages([{ category: 'error', text: 'New passwords do not match' }]);
        return;
      }
      if (formData.new_password.length < 6) {
        setFlashMessages([{ category: 'error', text: 'Password must be at least 6 characters long' }]);
        return;
      }
    }

    setIsLoading(true);

    const formDataToSend = new FormData();
    formDataToSend.append('first_name', formData.first_name);
    formDataToSend.append('last_name', formData.last_name);
    formDataToSend.append('email', formData.email);
    formDataToSend.append('phone', formData.phone);
    formDataToSend.append('overall_location', formData.overall_location);
    formDataToSend.append('shipping_address', formData.shipping_address);
    formDataToSend.append('overall_location_2', formData.overall_location_2);
    formDataToSend.append('shipping_address_2', formData.shipping_address_2);
    
    if (user?.is_farmer) {
      formDataToSend.append('farm_name', formData.farm_name);
      formDataToSend.append('farm_phone', formData.farm_phone);
      formDataToSend.append('farm_location', formData.farm_location);
      formDataToSend.append('farm_description', formData.farm_description);
    }

    if (formData.current_password && formData.new_password) {
      formDataToSend.append('current_password', formData.current_password);
      formDataToSend.append('new_password', formData.new_password);
    }

    if (profilePicture) {
      formDataToSend.append('profile_picture', profilePicture);
    }
    formDataToSend.append('remove_profile_picture', removeProfilePicture ? '1' : '0');

    const success = await updateProfile(formDataToSend);
    setIsLoading(false);

    if (success) {
      setFlashMessages([{ category: 'success', text: 'Profile updated successfully!' }]);
      setFormData(prev => ({ ...prev, current_password: '', new_password: '', confirm_password: '' }));
    } else {
      setFlashMessages([{ category: 'error', text: 'Failed to update profile. Please try again.' }]);
    }
  };

  if (!user) {
    return (
      <div className="profile-page">
        <Navbar />
        <div className="container">
          <div className="auth-message" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <i className="fas fa-lock" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '20px' }}></i>
            <h2>Please login to view your profile</h2>
            <p>You need to be logged in to access your profile page.</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: '20px' }}>Login Now</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {/* Navigation */}
      <Navbar />

      <main className="main-content">
        <div className="container">
          <div className="profile-header">
            <h1><i className="fas fa-user-circle"></i> My Profile</h1>
            <p>Manage your account information and preferences</p>
          </div>

          {/* Flash Messages */}
          {flashMessages.length > 0 && (
            <div className="flash-messages">
              {flashMessages.map((message, index) => (
                <div key={index} className={`flash-message flash-${message.category}`}>
                  <i className={`fas fa-${message.category === 'success' ? 'check-circle' : 'exclamation-circle'}`}></i>
                  {message.text}
                  <button className="flash-close" onClick={() => setFlashMessages(prev => prev.filter((_, i) => i !== index))}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="profile-content">
            <div className="profile-form-container">
              <form onSubmit={handleSubmit} className="profile-form" encType="multipart/form-data">
                {/* Personal Information */}
                <div className="form-section">
                  <h2><i className="fas fa-user"></i> Personal Information</h2>
                  
                  <div className="profile-picture-upload">
                    <label className="profile-picture-label">Profile Picture (Optional)</label>
                    <div className="profile-picture-preview">
                      <img
                        id="profilePreview"
                        src={profilePreview || '/images/default-avatar.svg'}
                        alt="Profile"
                        style={{ width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer' }}
                        onClick={() => fileInputRef.current?.click()}
                        onError={(e) => { e.target.src = '/images/default-avatar.svg'; }}
                      />
                      <div className="profile-picture-overlay">
                        <button type="button" className="btn btn-small btn-outline" onClick={() => fileInputRef.current?.click()}>Change Photo</button>
                        <input
                          type="file"
                          id="profile_picture"
                          name="profile_picture"
                          accept="image/*"
                          style={{ display: 'none' }}
                          ref={fileInputRef}
                          onChange={handleProfilePictureChange}
                        />
                        {(user.profile_picture || profilePicture) && (
                          <button type="button" className="btn btn-small btn-outline remove-photo" onClick={handleRemoveProfilePicture}>Remove</button>
                        )}
                      </div>
                    </div>
                    <p className="section-description">JPG, PNG or GIF. Max 5 MB.</p>
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label htmlFor="first_name">First Name</label>
                      <input type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                      <label htmlFor="last_name">Last Name</label>
                      <input type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                      <label htmlFor="email">Email Address</label>
                      <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                      <label htmlFor="phone">Phone Number</label>
                      <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} placeholder="123-456-7890" />
                    </div>
                  </div>
                </div>

                {/* Farm Information - Only for farmers */}
                {user.is_farmer && (
                  <div className="form-section">
                    <h2><i className="fas fa-seedling"></i> Farm Information</h2>
                    <div className="form-grid">
                      <div className="form-group">
                        <label htmlFor="farm_name">Farm Name</label>
                        <input type="text" id="farm_name" name="farm_name" value={formData.farm_name} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label htmlFor="farm_phone">Farm Phone</label>
                        <input type="tel" id="farm_phone" name="farm_phone" value={formData.farm_phone} onChange={handleChange} />
                      </div>
                      <div className="form-group full-width">
                        <label htmlFor="farm_location">Farm Location</label>
                        <input type="text" id="farm_location" name="farm_location" value={formData.farm_location} onChange={handleChange} placeholder="City, State" />
                      </div>
                      <div className="form-group full-width">
                        <label htmlFor="farm_description">Farm Description</label>
                        <textarea id="farm_description" name="farm_description" rows="4" value={formData.farm_description} onChange={handleChange} placeholder="Tell us about your farm..." />
                      </div>
                    </div>
                  </div>
                )}

                {/* Shipping Information */}
                <div className="form-section">
                  <h2><i className="fas fa-truck"></i> Shipping Information</h2>
                  <p className="section-description">Your name and phone number from registration will be used for shipping</p>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Full Name</label>
                      <div className="info-display" style={{ padding: '12px', background: '#f5f5f5', borderRadius: '8px' }}>{user.first_name} {user.last_name}</div>
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <div className="info-display" style={{ padding: '12px', background: '#f5f5f5', borderRadius: '8px' }}>{user.phone || 'Not provided'}</div>
                    </div>
                    <div className="form-group full-width">
                      <label htmlFor="overall_location">Overall Location</label>
                      <div className="address-input-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                        <input type="text" id="overall_location" name="overall_location" value={formData.overall_location} onChange={handleChange} placeholder="City, Province, Country (auto-generated)" style={{ flex: '1 1 260px', minWidth: 0 }} />
                        <button type="button" id="getLocationBtn" className="btn btn-small btn-outline" onClick={getLocationFromGPS}>
                          <i className="fas fa-map-marker-alt"></i> Get Location
                        </button>
                      </div>
                    </div>
                    <div className="form-group full-width">
                      <label htmlFor="shipping_address">Exact Address</label>
                      <input type="text" id="shipping_address" name="shipping_address" value={formData.shipping_address} onChange={handleChange} placeholder="Block, lot, street, or any specific location details" />
                    </div>
                  </div>

                  {/* Second Shipping Address (Optional) */}
                  <div style={{ marginTop: '20px', padding: '16px', background: '#f8faf8', borderRadius: '10px', border: '1px dashed #c8e6c9' }}>
                    <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem', color: '#2c7a2c', fontWeight: 700 }}>
                      <i className="fas fa-plus-circle" style={{ marginRight: '6px' }}></i>
                      Second Shipping Address (Optional)
                    </h3>
                    <p className="section-description" style={{ marginTop: 0 }}>Add an alternative address you can choose during checkout</p>
                    <div className="form-grid">
                      <div className="form-group full-width">
                        <label htmlFor="overall_location_2">Overall Location</label>
                        <input type="text" id="overall_location_2" name="overall_location_2" value={formData.overall_location_2} onChange={handleChange} placeholder="City, Province, Country" />
                      </div>
                      <div className="form-group full-width">
                        <label htmlFor="shipping_address_2">Exact Address</label>
                        <input type="text" id="shipping_address_2" name="shipping_address_2" value={formData.shipping_address_2} onChange={handleChange} placeholder="Block, lot, street, or any specific location details" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Change Password */}
                <div className="form-section">
                  <h2><i className="fas fa-lock"></i> Change Password</h2>
                  <p className="section-description">Leave blank to keep current password</p>
                  <div className="form-grid">
                    <div className="form-group">
                      <label htmlFor="current_password">Current Password</label>
                      <input type="password" id="current_password" name="current_password" value={formData.current_password} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="new_password">New Password</label>
                      <input type="password" id="new_password" name="new_password" value={formData.new_password} onChange={handleChange} minLength="6" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="confirm_password">Confirm New Password</label>
                      <input type="password" id="confirm_password" name="confirm_password" value={formData.confirm_password} onChange={handleChange} minLength="6" />
                    </div>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={isLoading}>
                    <i className="fas fa-save"></i> {isLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <Link to="/" className="btn btn-outline">
                    <i className="fas fa-arrow-left"></i> Back to Home
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;