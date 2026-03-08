import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const FarmerVerify = () => {
  const { user, token, updateUser } = useAuth();
  const navigate = useNavigate();

  // Farm form data
  const [formData, setFormData] = useState({
    farm_phone: user?.farm_phone || '',
    farm_location: user?.farm_location || '',
    exact_address: user?.exact_address || '',
    farm_description: user?.farm_description || '',
    permit_business_name: user?.permit_business_name || '',
    permit_owner_name: user?.permit_owner_name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
  });

  // Photo states
  const [farmPhotoFile, setFarmPhotoFile] = useState(null);
  const [farmPhotoPreview, setFarmPhotoPreview] = useState(null);
  const [permitPhotoFile, setPermitPhotoFile] = useState(null);
  const [permitPhotoPreview, setPermitPhotoPreview] = useState(null);

  // Camera states
  const [farmCameraActive, setFarmCameraActive] = useState(false);
  const [permitCameraActive, setPermitCameraActive] = useState(false);

  // Refs
  const farmVideoRef = useRef(null);
  const permitVideoRef = useRef(null);
  const farmCanvasRef = useRef(null);
  const permitCanvasRef = useRef(null);
  const farmFileInputRef = useRef(null);
  const permitFileInputRef = useRef(null);

  // Stream refs
  const farmStreamRef = useRef(null);
  const permitStreamRef = useRef(null);

  const [isLoading, setIsLoading] = useState(false);
  
  // Client-side validation error states
  const [validationErrors, setValidationErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');

  // Attach stream to video element after it renders
  useEffect(() => {
    if (farmCameraActive && farmVideoRef.current && farmStreamRef.current) {
      farmVideoRef.current.srcObject = farmStreamRef.current;
    }
  }, [farmCameraActive]);

  useEffect(() => {
    if (permitCameraActive && permitVideoRef.current && permitStreamRef.current) {
      permitVideoRef.current.srcObject = permitStreamRef.current;
    }
  }, [permitCameraActive]);

  // Geolocation function
  const getLocationFromGPS = async () => {
    if (!navigator.geolocation) {
      setValidationErrors({ ...validationErrors, farm_location: 'Geolocation is not supported by this browser.' });
      return;
    }

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
          farm_location: data.display_name,
        }));
        setValidationErrors(prev => {
          const errors = { ...prev };
          delete errors.farm_location;
          return errors;
        });
      } else {
        setFormData(prev => ({
          ...prev,
          farm_location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        }));
      }
    } catch (error) {
      setValidationErrors({ ...validationErrors, farm_location: 'Unable to retrieve GPS location. Please enter manually.' });
    }
  };

  // Farm Photo Camera
  const startFarmCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      farmStreamRef.current = stream;
      // Set state first so the <video> element renders, then useEffect attaches the stream
      setFarmCameraActive(true);
      setValidationErrors(prev => {
        const errors = { ...prev };
        delete errors.farm_photo;
        return errors;
      });
    } catch (error) {
      setValidationErrors({ ...validationErrors, farm_photo: 'Camera access denied. Please use Upload Photo instead.' });
    }
  };

  const captureFarmPhoto = () => {
    if (!farmVideoRef.current || !farmCanvasRef.current) return;

    const video = farmVideoRef.current;
    const canvas = farmCanvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Flip the canvas
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setFarmPhotoPreview(url);

        const file = new File([blob], 'farm_photo.jpg', { type: 'image/jpeg' });
        setFarmPhotoFile(file);

        if (farmStreamRef.current) {
          farmStreamRef.current.getTracks().forEach(track => track.stop());
          farmStreamRef.current = null;
        }
        setFarmCameraActive(false);
        setValidationErrors(prev => {
          const errors = { ...prev };
          delete errors.farm_photo;
          return errors;
        });
        setSuccessMessage('Farm photo captured successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      }
    }, 'image/jpeg', 0.92);
  };

  const uploadFarmPhoto = (e) => {
    const file = e.target.files?.[0];
    // Reset input value so the same file can be selected again
    e.target.value = '';
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setValidationErrors({ ...validationErrors, farm_photo: 'Farm photo must be less than 5MB.' });
        return;
      }
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setValidationErrors({ ...validationErrors, farm_photo: 'Farm photo must be an image file.' });
        return;
      }
      setFarmPhotoFile(file);
      setFarmPhotoPreview(URL.createObjectURL(file));
      setValidationErrors(prev => {
        const errors = { ...prev };
        delete errors.farm_photo;
        return errors;
      });
      setSuccessMessage('Farm photo uploaded successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const clearFarmPhoto = () => {
    setFarmPhotoFile(null);
    setFarmPhotoPreview(null);
    if (farmFileInputRef.current) {
      farmFileInputRef.current.value = '';
    }
    if (farmStreamRef.current) {
      farmStreamRef.current.getTracks().forEach(track => track.stop());
      farmStreamRef.current = null;
    }
    setFarmCameraActive(false);
  };

  // Permit Photo Camera
  const startPermitCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      permitStreamRef.current = stream;
      // Set state first so the <video> element renders, then useEffect attaches the stream
      setPermitCameraActive(true);
      setValidationErrors(prev => {
        const errors = { ...prev };
        delete errors.permit_photo;
        return errors;
      });
    } catch (error) {
      setValidationErrors({ ...validationErrors, permit_photo: 'Camera access denied. Please use Upload Photo instead.' });
    }
  };

  const capturePermitPhoto = () => {
    if (!permitVideoRef.current || !permitCanvasRef.current) return;

    const video = permitVideoRef.current;
    const canvas = permitCanvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Flip the canvas
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setPermitPhotoPreview(url);

        const file = new File([blob], 'business_permit.jpg', { type: 'image/jpeg' });
        setPermitPhotoFile(file);

        if (permitStreamRef.current) {
          permitStreamRef.current.getTracks().forEach(track => track.stop());
          permitStreamRef.current = null;
        }
        setPermitCameraActive(false);
        setValidationErrors(prev => {
          const errors = { ...prev };
          delete errors.permit_photo;
          return errors;
        });
        setSuccessMessage('Business permit photo captured successfully!');
        setTimeout(() => setSuccessMessage(''), 3000);
      }
    }, 'image/jpeg', 0.92);
  };

  const uploadPermitPhoto = (e) => {
    const file = e.target.files?.[0];
    // Reset input value so the same file can be selected again
    e.target.value = '';
    if (file) {
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setValidationErrors({ ...validationErrors, permit_photo: 'Permit photo must be less than 5MB.' });
        return;
      }
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setValidationErrors({ ...validationErrors, permit_photo: 'Permit photo must be an image file.' });
        return;
      }
      setPermitPhotoFile(file);
      setPermitPhotoPreview(URL.createObjectURL(file));
      setValidationErrors(prev => {
        const errors = { ...prev };
        delete errors.permit_photo;
        return errors;
      });
      setSuccessMessage('Business permit photo uploaded successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const clearPermitPhoto = () => {
    setPermitPhotoFile(null);
    setPermitPhotoPreview(null);
    if (permitFileInputRef.current) {
      permitFileInputRef.current.value = '';
    }
    if (permitStreamRef.current) {
      permitStreamRef.current.getTracks().forEach(track => track.stop());
      permitStreamRef.current = null;
    }
    setPermitCameraActive(false);
  };

  // Form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSuccessMessage('');
    
    // Client-side validation
    const errors = {};

    // Validate farm details if not already a farmer
    if (!user?.is_farmer) {
      if (!formData.farm_phone || formData.farm_phone.trim() === '') {
        errors.farm_phone = 'Farm phone is required.';
      } else if (!/^\+?[\d\s\-()]+$/.test(formData.farm_phone)) {
        errors.farm_phone = 'Please enter a valid phone number.';
      }

      if (!formData.farm_location || formData.farm_location.trim() === '') {
        errors.farm_location = 'Farm location is required. Use GPS to auto-fill.';
      }

      if (!formData.exact_address || formData.exact_address.trim() === '') {
        errors.exact_address = 'Exact farm address is required.';
      } else if (formData.exact_address.length < 10) {
        errors.exact_address = 'Please provide a more detailed address.';
      }

      if (!formData.farm_description || formData.farm_description.trim() === '') {
        errors.farm_description = 'Farm description is required.';
      } else if (formData.farm_description.length < 20) {
        errors.farm_description = 'Farm description must be at least 20 characters.';
      }
    }

    // Validate permit details
    if (!formData.permit_business_name || formData.permit_business_name.trim() === '') {
      errors.permit_business_name = 'Business name is required.';
    } else if (formData.permit_business_name.length < 3) {
      errors.permit_business_name = 'Business name must be at least 3 characters.';
    }

    if (!formData.permit_owner_name || formData.permit_owner_name.trim() === '') {
      errors.permit_owner_name = 'Owner/Proprietor name is required.';
    } else if (formData.permit_owner_name.length < 3) {
      errors.permit_owner_name = 'Owner name must be at least 3 characters.';
    }

    // Validate photos
    if (!farmPhotoFile) {
      errors.farm_photo = 'Farm photo is required. Please capture or upload a photo.';
    }

    if (!permitPhotoFile) {
      errors.permit_photo = 'DTI Business Permit photo is required. Please capture or upload a photo.';
    }

    // If there are validation errors, display them
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      window.scrollTo(0, 0);
      return;
    }

    setValidationErrors({});
    setIsLoading(true);

    const formDataToSend = new FormData();
    if (!user?.is_farmer) {
      formDataToSend.append('farm_phone', formData.farm_phone);
      formDataToSend.append('farm_location', formData.farm_location);
      formDataToSend.append('exact_address', formData.exact_address);
      formDataToSend.append('farm_description', formData.farm_description);
    }
    formDataToSend.append('farm_photo', farmPhotoFile);
    formDataToSend.append('business_permit_photo', permitPhotoFile);
    formDataToSend.append('permit_business_name', formData.permit_business_name);
    formDataToSend.append('permit_owner_name', formData.permit_owner_name);

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL || ''}/farmer/verify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formDataToSend,
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update user context if verification was successful
        if (data.status === 'verified' && data.user) {
          const updatedUser = {
            ...user,
            ...data.user,
            is_farmer: true,
            role: 'farmer',
          };
          updateUser(updatedUser);
        }
        
        // Include confidence score in success message
        const confidenceMsg = data.confidence_percentage ? ` (Confidence: ${data.confidence_percentage})` : '';
        setSuccessMessage(`Verification submitted successfully!${confidenceMsg} Redirecting...`);
        setTimeout(() => navigate('/farmers'), 2000);
      } else {
        // Display server-side validation errors with confidence score if available
        const errorData = await response.json();
        const errorMsg = errorData.error || errorData.message || 'An error occurred while submitting.';
        const confidenceMsg = errorData.confidence_percentage ? ` (Confidence: ${errorData.confidence_percentage})` : '';
        setValidationErrors({ submit: `Submission issue: ${errorMsg}${confidenceMsg}` });
        window.scrollTo(0, 0);
      }
    } catch (error) {
      setValidationErrors({ submit: 'Network error. Please check your connection and try again.' });
      window.scrollTo(0, 0);
    } finally {
      setIsLoading(false);
    }
  };



  return (
    <div className="farmer-verify-page">
      <Navbar activePage="farmers" />

      {/* Verification Form Section */}
      <section className="farmers-page-main">
        <div className="container">
          <div className="profile-form-container">
            <div className="form-section">
              {/* Error/Success Messages */}
              {Object.keys(validationErrors).length > 0 && (
                <div style={{
                  background: '#ffebee',
                  border: '1px solid #ef5350',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px'
                }}>
                  <p style={{ color: '#c62828', fontWeight: 600, margin: '0 0 8px 0' }}>
                    <i className="fas fa-exclamation-circle" style={{ marginRight: '8px' }}></i>
                    Please fix the following errors:
                  </p>
                  <ul style={{ color: '#d32f2f', margin: '0', paddingLeft: '20px' }}>
                    {Object.entries(validationErrors).map(([field, message]) => (
                      <li key={field} style={{ marginBottom: '4px' }}>
                        {message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {successMessage && (
                <div style={{
                  background: '#e8f5e9',
                  border: '1px solid #66bb6a',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px'
                }}>
                  <p style={{ color: '#2e7d32', fontWeight: 600, margin: 0 }}>
                    <i className="fas fa-check-circle" style={{ marginRight: '8px' }}></i>
                    {successMessage}
                  </p>
                </div>
              )}

              {user?.business_verification_status && (
                <p className="section-description">
                  Current status: <strong>{user.business_verification_status.charAt(0).toUpperCase() + user.business_verification_status.slice(1)}</strong>
                </p>
              )}

              {user?.farmer_application_status && !user?.is_farmer && (
                <p className="section-description">
                  Application status: <strong>{user.farmer_application_status.charAt(0).toUpperCase() + user.farmer_application_status.slice(1)}</strong>
                </p>
              )}

              <div className="form-grid">
                <div className="form-group full-width">
                  <form onSubmit={handleSubmit}>
                    {/* Farm Details - Only show if not already a farmer */}
                    {!user?.is_farmer && (
                      <div style={{ marginBottom: '12px' }}>
                        <div className="form-group full-width">
                          <label htmlFor="farm_phone">Farm Phone</label>
                          <input
                            type="text"
                            id="farm_phone"
                            value={formData.farm_phone}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, farm_phone: e.target.value }));
                              if (validationErrors.farm_phone) {
                                setValidationErrors(prev => {
                                  const errors = { ...prev };
                                  delete errors.farm_phone;
                                  return errors;
                                });
                              }
                            }}
                            required
                            style={{
                              borderColor: validationErrors.farm_phone ? '#d32f2f' : '',
                              backgroundColor: validationErrors.farm_phone ? '#ffebee' : ''
                            }}
                          />
                          {validationErrors.farm_phone && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.farm_phone}
                            </small>
                          )}
                        </div>

                        <div className="form-group full-width">
                          <label htmlFor="farm_location">Farm Location (City/Area)</label>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                            <input
                              type="text"
                              id="farm_location"
                              value={formData.farm_location}
                              onChange={(e) => {
                                setFormData(prev => ({ ...prev, farm_location: e.target.value }));
                                if (validationErrors.farm_location) {
                                  setValidationErrors(prev => {
                                    const errors = { ...prev };
                                    delete errors.farm_location;
                                    return errors;
                                  });
                                }
                              }}
                              readOnly
                              required
                              style={{ 
                                flex: 1, 
                                backgroundColor: '#f5f5f5',
                                borderColor: validationErrors.farm_location ? '#d32f2f' : ''
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={getLocationFromGPS}
                              style={{ whiteSpace: 'nowrap', padding: '8px 12px', height: 'fit-content' }}
                              title="Get your GPS location"
                            >
                              <i className="fas fa-map-marker-alt"></i> Use GPS
                            </button>
                          </div>
                          {validationErrors.farm_location && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.farm_location}
                            </small>
                          )}
                          {!validationErrors.farm_location && (
                            <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                              ✓ <strong>Accurate location detection</strong> • Uses OpenStreetMap for precise address resolution
                            </small>
                          )}
                        </div>

                        <div className="form-group full-width">
                          <label htmlFor="exact_address">Exact Farm Address</label>
                          <input
                            type="text"
                            id="exact_address"
                            placeholder="e.g., 123 Farm Road, Barangay San Jose, Municipality"
                            value={formData.exact_address}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, exact_address: e.target.value }));
                              if (validationErrors.exact_address) {
                                setValidationErrors(prev => {
                                  const errors = { ...prev };
                                  delete errors.exact_address;
                                  return errors;
                                });
                              }
                            }}
                            required
                            style={{ 
                              width: '100%',
                              borderColor: validationErrors.exact_address ? '#d32f2f' : '',
                              backgroundColor: validationErrors.exact_address ? '#ffebee' : ''
                            }}
                          />
                          {validationErrors.exact_address && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.exact_address}
                            </small>
                          )}
                          {!validationErrors.exact_address && (
                            <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                              Street address, barangay, and municipality details - <strong>This is the most important field</strong>
                            </small>
                          )}
                        </div>

                        <div className="form-group full-width">
                          <label htmlFor="farm_description">Farm Description</label>
                          <textarea
                            id="farm_description"
                            rows="4"
                            value={formData.farm_description}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, farm_description: e.target.value }));
                              if (validationErrors.farm_description) {
                                setValidationErrors(prev => {
                                  const errors = { ...prev };
                                  delete errors.farm_description;
                                  return errors;
                                });
                              }
                            }}
                            required
                            style={{
                              borderColor: validationErrors.farm_description ? '#d32f2f' : '',
                              backgroundColor: validationErrors.farm_description ? '#ffebee' : ''
                            }}
                          />
                          {validationErrors.farm_description && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.farm_description}
                            </small>
                          )}
                        </div>
                      </div>
                    )}

                    {/* FARM PHOTO SECTION */}
                    <div style={{ borderTop: '2px solid #e0e0e0', paddingTop: '20px', marginBottom: '30px' }}>
                      <h3 style={{ marginBottom: '15px' }}>
                        <i className="fas fa-id-card" style={{ color: '#2c7a2c', marginRight: '8px' }}></i>
                        Permit Details &mdash; Name Verification
                      </h3>
                      <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                        <p style={{ color: '#2e7d32', margin: 0, fontSize: '0.92em' }}>
                          <i className="fas fa-info-circle"></i>{' '}
                          <strong>Enter the names exactly as they appear on your DTI Business Permit.</strong>{' '}
                          We cross-check these against DTI records to verify ownership.
                        </p>
                      </div>
                      <div className="form-grid" style={{ marginBottom: '12px' }}>
                        <div className="form-group">
                          <label htmlFor="permit_business_name">
                            <i className="fas fa-store" style={{ marginRight: '4px' }}></i>
                            Business Name (on DTI Permit)
                          </label>
                          <input
                            type="text"
                            id="permit_business_name"
                            placeholder="e.g., Juan's Fresh Farm Products"
                            value={formData.permit_business_name}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, permit_business_name: e.target.value }));
                              if (validationErrors.permit_business_name) {
                                setValidationErrors(prev => {
                                  const errors = { ...prev };
                                  delete errors.permit_business_name;
                                  return errors;
                                });
                              }
                            }}
                            required
                            style={{
                              borderColor: validationErrors.permit_business_name ? '#d32f2f' : '',
                              backgroundColor: validationErrors.permit_business_name ? '#ffebee' : ''
                            }}
                          />
                          {validationErrors.permit_business_name && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.permit_business_name}
                            </small>
                          )}
                          {!validationErrors.permit_business_name && (
                            <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                              The registered business name shown on your DTI certificate
                            </small>
                          )}
                        </div>
                        <div className="form-group">
                          <label htmlFor="permit_owner_name">
                            <i className="fas fa-user-tie" style={{ marginRight: '4px' }}></i>
                            Owner / Proprietor Name (on DTI Permit)
                          </label>
                          <input
                            type="text"
                            id="permit_owner_name"
                            placeholder="e.g., Juan Dela Cruz"
                            value={formData.permit_owner_name}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, permit_owner_name: e.target.value }));
                              if (validationErrors.permit_owner_name) {
                                setValidationErrors(prev => {
                                  const errors = { ...prev };
                                  delete errors.permit_owner_name;
                                  return errors;
                                });
                              }
                            }}
                            required
                            style={{
                              borderColor: validationErrors.permit_owner_name ? '#d32f2f' : '',
                              backgroundColor: validationErrors.permit_owner_name ? '#ffebee' : ''
                            }}
                          />
                          {validationErrors.permit_owner_name && (
                            <small style={{ color: '#d32f2f', display: 'block', marginTop: '4px' }}>
                              {validationErrors.permit_owner_name}
                            </small>
                          )}
                          {!validationErrors.permit_owner_name && (
                            <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>
                              The owner/proprietor name on the permit &mdash; must match your account name
                            </small>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* FARM PHOTO SECTION */}
                    <div style={{ borderTop: '2px solid #e0e0e0', paddingTop: '20px', marginBottom: '30px' }}>
                      <h3 style={{ marginBottom: '15px' }}>
                        <i className="fas fa-image" style={{ color: '#2c7a2c', marginRight: '8px' }}></i>
                        Farm Photo (Required)
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginBottom: '15px' }}>
                        {farmCameraActive ? (
                          <video
                            ref={farmVideoRef}
                            autoPlay
                            muted
                            playsInline
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              borderRadius: '12px',
                              background: '#111',
                              transform: 'scaleX(-1)',
                            }}
                          />
                        ) : null}
                        {farmPhotoPreview && !farmCameraActive ? (
                          <img
                            src={farmPhotoPreview}
                            alt="Farm preview"
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              borderRadius: '12px',
                              border: '2px dashed #2c7a2c',
                            }}
                          />
                        ) : null}
                        {!farmPhotoPreview && !farmCameraActive ? (
                          <div
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              height: '300px',
                              border: '2px dashed #ccc',
                              borderRadius: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: '#f9f9f9',
                            }}
                          >
                            <span style={{ color: '#999' }}>Farm photo will appear here</span>
                          </div>
                        ) : null}
                      </div>
                      <canvas ref={farmCanvasRef} style={{ display: 'none' }} />
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {!farmCameraActive ? (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={startFarmCamera}
                          >
                            <i className="fas fa-camera"></i> Open Camera
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={captureFarmPhoto}
                          >
                            <i className="fas fa-camera-retro"></i> Capture Photo
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => farmFileInputRef.current?.click()}
                        >
                          <i className="fas fa-file-upload"></i> Upload Photo
                        </button>
                        {farmPhotoPreview && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={clearFarmPhoto}
                          >
                            <i className="fas fa-times"></i> Clear
                          </button>
                        )}
                      </div>
                      <input
                        ref={farmFileInputRef}
                        id="farmPhotoInput"
                        type="file"
                        accept="image/*"
                        onChange={uploadFarmPhoto}
                        style={{ display: 'none' }}
                      />
                      {validationErrors.farm_photo && (
                        <small style={{ color: '#d32f2f', display: 'block', marginTop: '8px', fontWeight: 500 }}>
                          <i className="fas fa-exclamation-circle" style={{ marginRight: '4px' }}></i>
                          {validationErrors.farm_photo}
                        </small>
                      )}
                      {!validationErrors.farm_photo && (
                        <small style={{ color: '#666', marginTop: '8px', display: 'block' }}>
                          Clear photo of your farm. Max 5MB.
                        </small>
                      )}
                    </div>

                    {/* PERMIT PHOTO SECTION */}
                    <div style={{ borderTop: '2px solid #e0e0e0', paddingTop: '20px', marginBottom: '15px' }}>
                      <h3 style={{ marginBottom: '15px' }}>
                        <i className="fas fa-qrcode" style={{ color: '#2c7a2c', marginRight: '8px' }}></i>
                        DTI Business Permit (Required)
                      </h3>
                      <div style={{
                        background: '#f0faf0', border: '1px solid #b8dbb8',
                        borderRadius: '10px', padding: '16px', marginBottom: '18px'
                      }}>
                        <p style={{ color: '#2c5f2c', margin: '0 0 10px 0', fontWeight: 600 }}>
                          <i className="fas fa-info-circle"></i> How QR Verification Works
                        </p>
                        <ol style={{ color: '#444', margin: 0, paddingLeft: '20px', lineHeight: 1.8 }}>
                          <li>Take a <strong>clear photo</strong> of your DTI Business Permit certificate.</li>
                          <li>Make sure the <strong>QR code</strong> on the permit is clearly visible and not blurred.</li>
                          <li>Our system will <strong>scan the QR code</strong> and extract the business information from it.</li>
                          <li>The QR code information will be <strong>cross-checked</strong> with the permit details and your provided information.</li>
                          <li>If everything matches, you will be <strong>instantly verified</strong> as a farmer.</li>
                        </ol>
                      </div>
                      <div style={{
                        background: '#fff8e1', border: '1px solid #ffe082',
                        borderRadius: '10px', padding: '12px', marginBottom: '18px'
                      }}>
                        <p style={{ color: '#8d6e00', margin: 0, fontSize: '0.92em' }}>
                          <i className="fas fa-lightbulb"></i>{' '}
                          <strong>Tips for best results:</strong>{' '}
                          Place the permit on a flat surface with good lighting. Ensure the QR code fills a good portion of the image. Avoid glare, shadows, and creases over the QR code.
                        </p>
                      </div>
                      <p style={{ color: '#666', marginBottom: '15px' }}>
                        Upload or capture a photo of your DTI Business Permit. The system will automatically scan the QR code for instant verification.
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginBottom: '15px' }}>
                        {permitCameraActive ? (
                          <video
                            ref={permitVideoRef}
                            autoPlay
                            muted
                            playsInline
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              borderRadius: '12px',
                              background: '#111',
                              transform: 'scaleX(-1)',
                            }}
                          />
                        ) : null}
                        {permitPhotoPreview && !permitCameraActive ? (
                          <img
                            src={permitPhotoPreview}
                            alt="Permit/ID Preview"
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              borderRadius: '12px',
                              border: '2px dashed #d9534f',
                            }}
                          />
                        ) : null}
                        {!permitPhotoPreview && !permitCameraActive ? (
                          <div
                            style={{
                              width: '100%',
                              maxWidth: '520px',
                              height: '300px',
                              border: '2px dashed #ccc',
                              borderRadius: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: '#f9f9f9',
                              flexDirection: 'column',
                              gap: '8px',
                            }}
                          >
                            <i className="fas fa-qrcode" style={{ fontSize: '48px', color: '#bbb' }}></i>
                            <span style={{ color: '#999' }}>Upload a photo of your DTI permit showing the QR code</span>
                          </div>
                        ) : null}
                      </div>
                      <canvas ref={permitCanvasRef} style={{ display: 'none' }} />
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {!permitCameraActive ? (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={startPermitCamera}
                          >
                            <i className="fas fa-camera"></i> Open Camera
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={capturePermitPhoto}
                          >
                            <i className="fas fa-camera-retro"></i> Capture Photo
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => permitFileInputRef.current?.click()}
                        >
                          <i className="fas fa-file-upload"></i> Upload Photo
                        </button>
                        {permitPhotoPreview && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={clearPermitPhoto}
                          >
                            <i className="fas fa-times"></i> Clear
                          </button>
                        )}
                      </div>
                      <input
                        ref={permitFileInputRef}
                        id="permitPhotoInput"
                        type="file"
                        accept="image/*"
                        onChange={uploadPermitPhoto}
                        style={{ display: 'none' }}
                      />
                      {validationErrors.permit_photo && (
                        <small style={{ color: '#d32f2f', display: 'block', marginTop: '8px', fontWeight: 500 }}>
                          <i className="fas fa-exclamation-circle" style={{ marginRight: '4px' }}></i>
                          {validationErrors.permit_photo}
                        </small>
                      )}
                      {!validationErrors.permit_photo && (
                        <small style={{ color: '#666', marginTop: '8px', display: 'block' }}>
                          <i className="fas fa-qrcode" style={{ marginRight: '4px' }}></i>
                          Ensure the QR code is visible and unobstructed. Max 5MB.
                        </small>
                      )}
                    </div>

                    {/* Submit Buttons */}
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px', borderTop: '2px solid #e0e0e0', paddingTop: '20px' }}>
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="btn btn-primary"
                      >
                        <i className="fas fa-check"></i> {isLoading ? 'Submitting...' : 'Submit Verification'}
                      </button>
                      <Link to="/farmers" className="btn btn-outline">Back</Link>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default FarmerVerify;