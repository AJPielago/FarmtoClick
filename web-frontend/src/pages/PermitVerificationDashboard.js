import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const PermitVerificationDashboard = () => {
  const { user } = useAuth();
  const [verifications, setVerifications] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    verified: 0,
    rejected: 0,
  });
  const [activeFilter, setActiveFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [selectedVerification, setSelectedVerification] = useState(null);
  const [flashMessages, setFlashMessages] = useState([]);

  const loadDashboardData = useCallback(async () => {
    try {
      // Fetch real data from backend API
      const token = localStorage.getItem('userToken');
      console.log('🔍 Fetching verifications...');
      console.log('✓ Token:', token ? 'Present' : 'Missing');
      
      // Check if user is admin first
      const userData = localStorage.getItem('userData');
      const user = userData ? JSON.parse(userData) : null;
      const isAdmin = user?.role === 'admin';
      
      // Use appropriate endpoint based on user role
      // Admin uses permit-verifications from database, users see their own status
      const endpoint = isAdmin 
        ? 'http://localhost:5001/api/admin/permit-verifications'
        : 'http://localhost:5001/api/user/verification-status';
      
      console.log('📡 Using endpoint:', endpoint);
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        credentials: 'include',
      });

      console.log('📡 API Response status:', response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || response.statusText;
        } catch (e) {
          // If response is not JSON, use status text
        }
        console.error('❌ API Error:', errorMessage);
        throw new Error(`API Error ${response.status}: ${errorMessage}`);
      }

      const data = await response.json();
      console.log('✅ Data received:', data);
      
      // Handle both admin endpoint and user endpoint responses
      let verifications = [];
      if (data.verifications) {
        // Admin endpoint response (from permit_verifications collection)
        verifications = data.verifications;
      } else if (data.status === 'found') {
        // User endpoint response - single verification
        verifications = [data.verification];
      } else if (data.status === 'not_submitted') {
        // User has no submission
        verifications = [];
      }
      
      // Transform backend data to match component expectations
      const transformedVerifications = verifications.map(v => ({
        ...v,
        // Map new permit_verifications format to expected fields
        farmer_name: v.user?.name || v.farmer_name || 'N/A',
        farm_name: v.user?.farm_name || v.permit_business_name || v.farm_name || 'N/A',
        email: v.user?.email || v.email || 'N/A',
        // Handle status from permit_verifications (status field) vs old format
        verification_status: v.status || v.verification_status,
        valid: v.valid || v.status === 'verified',
        rejected: v.status === 'rejected' || v.rejected,
        // Timestamps
        submitted_at: v.created_at || v.timestamp || v.submitted_at,
        // Confidence
        confidence: v.confidence || v.ml_confidence || 0,
        // Checks
        quality_check: v.quality_check?.passed || false,
        document_check: v.ml_is_permit || v.document_detection?.passed || false,
        ocr_check: !!v.dti_business_name || !!v.extracted_text,
        permit_check: v.qr_valid || v.permit_validation?.passed,
      }));
      
      console.log('Transformed verifications:', transformedVerifications);
      setVerifications(transformedVerifications);
      
      // Set stats
      if (data.stats) {
        // Admin response
        setStats({
          total: data.stats.total,
          verified: data.stats.verified,
          rejected: data.stats.rejected,
        });
      } else {
        // User response - count based on single verification
        const count = transformedVerifications.length;
        const verifiedCount = transformedVerifications.filter(v => v.verification_status === 'verified' || v.status === 'verified').length;
        setStats({
          total: count,
          verified: verifiedCount,
          rejected: count - verifiedCount,
        });
      }
    } catch (error) {
      console.error('❌ Dashboard error:', error.message);
      setFlashMessages([{ category: 'error', text: `Dashboard Error: ${error.message}. Check browser console for details.` }]);
      // Fallback to empty state on error
      setVerifications([]);
      setStats({
        total: 0,
        verified: 0,
        rejected: 0,
      });
    }
  }, []);

  useEffect(() => {
    if (user && user.is_admin) {
      loadDashboardData();
    }
  }, [user, loadDashboardData]);

  const filterVerifications = (filter) => {
    setActiveFilter(filter);
  };

  const viewDetails = (verification) => {
    setSelectedVerification(verification);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedVerification(null);
  };

  const filteredVerifications = verifications.filter(v => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'verified') return v.status === 'verified' || v.valid === true;
    if (activeFilter === 'rejected') return v.status === 'rejected' || v.rejected === true;
    return true;
  });

  // Close modal on clicking outside
  const handleModalClick = (e) => {
    if (e.target.classList.contains('modal')) {
      closeModal();
    }
  };

  if (!user || !user.is_admin) {
    return (
      <div className="permit-dashboard-page">
        <Navbar />

        <section className="products-page">
          <div className="container">
            <div className="no-products">
              <i className="fas fa-user-shield" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '16px' }}></i>
              <h3>Administrator Access Required</h3>
              <p>You need administrator privileges to access this page.</p>
              <Link to="/" className="btn btn-primary" style={{ marginTop: '16px' }}>Go to Home</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="permit-dashboard-page">
      {/* Navigation */}
      <Navbar />
      <div style={{ padding: '12px 20px' }}>
        <Link to="/admin-dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#2c7a2c', textDecoration: 'none', fontWeight: 600 }}>
          <i className="fas fa-arrow-left"></i> Admin Dashboard
        </Link>
      </div>

      {/* Flash Messages */}
      {flashMessages.length > 0 && (
        <div className="flash-messages">
          {flashMessages.map((message, index) => (
            <div key={index} className={`flash-message flash-${message.category}`}>
              <i className={`fas fa-${message.category === 'success' ? 'check-circle' : message.category === 'error' ? 'exclamation-circle' : 'info-circle'}`}></i>
              {message.text}
              <button className="flash-close" onClick={() => {
                const newMessages = [...flashMessages];
                newMessages.splice(index, 1);
                setFlashMessages(newMessages);
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="farmers-page" style={{ textAlign: 'left', width: '100%' }}>
        <div className="dashboard-container" style={{ textAlign: 'left', width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '20px', boxSizing: 'border-box' }}>
          {/* Statistics */}
          <div className="verification-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '30px', width: '100%' }}>
            <div className="stat-card">
              <div className="stat-number">{stats.total}</div>
              <div className="stat-label">Total Submissions</div>
            </div>
            <div className="stat-card">
              <div className="stat-number" style={{ color: '#28a745' }}>{stats.verified}</div>
              <div className="stat-label">Accepted</div>
            </div>
            <div className="stat-card">
              <div className="stat-number" style={{ color: '#dc3545' }}>{stats.rejected}</div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>

          {/* Filters */}
          <div className="filters" style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', marginBottom: '20px', width: '100%' }}>
            <button className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => filterVerifications('all')}>
              <i className="fas fa-list"></i> All
            </button>
            <button className={`filter-btn ${activeFilter === 'verified' ? 'active' : ''}`} onClick={() => filterVerifications('verified')}>
              <i className="fas fa-check"></i> Accepted
            </button>
            <button className={`filter-btn ${activeFilter === 'rejected' ? 'active' : ''}`} onClick={() => filterVerifications('rejected')}>
              <i className="fas fa-times"></i> Rejected
            </button>
          </div>

          {/* Verification List */}
          <div className="verification-list" style={{ textAlign: 'left', width: '100%' }}>
            {filteredVerifications.length > 0 ? (
              filteredVerifications.map(verification => (
                <div key={verification.id} className="verification-item" data-status={verification.valid ? 'verified' : 'rejected'} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="verification-details" style={{ textAlign: 'left', flex: 1 }}>
                    <h4 style={{ textAlign: 'left' }}>{verification.farmer_name}</h4>
                    <p style={{ textAlign: 'left' }}><strong>Farm:</strong> {verification.farm_name}</p>
                    <p style={{ textAlign: 'left' }}><strong>Confidence:</strong> {Math.round(verification.confidence * 100)}%</p>
                  </div>
                  <div className={`verification-status ${verification.valid ? 'status-valid' : 'status-rejected'}`}>
                    {verification.valid ? (
                      <><i className="fas fa-check"></i> Accepted</>
                    ) : (
                      <><i className="fas fa-times"></i> Rejected</>
                    )}
                  </div>
                  <div className="action-buttons">
                    <button className="btn btn-sm btn-outline" onClick={() => viewDetails(verification)}>
                      <i className="fas fa-eye"></i> Details
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                <i className="fas fa-inbox" style={{ fontSize: '3em', marginBottom: '10px', display: 'block' }}></i>
                <p>No permit submissions found</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Details Modal */}
      {showModal && selectedVerification && (
        <div className="modal" style={{ display: 'block' }} onClick={handleModalClick}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Verification Details</h2>
              <span className="close" onClick={closeModal}>&times;</span>
            </div>

            <div className="detail-section">
              <h3>User Information</h3>
              <div className="detail-item">
                <span className="detail-label">Farmer Name:</span>
                <span className="detail-value">{selectedVerification.farmer_name}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Farm Name:</span>
                <span className="detail-value">{selectedVerification.farm_name}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Email:</span>
                <span className="detail-value">{selectedVerification.email}</span>
              </div>
            </div>

            <div className="detail-section">
              <h3>Verification Results</h3>
              <div className="detail-item">
                <span className="detail-label">Overall Status:</span>
                <span className="detail-value">
                  <span className={`verification-status ${selectedVerification.valid ? 'status-valid' : 'status-rejected'}`}>
                    {selectedVerification.valid ? 'Accepted' : 'Rejected'}
                  </span>
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Confidence Score:</span>
                <span className="detail-value">
                  {Math.round(selectedVerification.confidence * 100)}%
                  <div className="confidence-bar">
                    <div className="confidence-fill" style={{ width: `${selectedVerification.confidence * 100}%` }}></div>
                  </div>
                </span>
              </div>
            </div>

            <div className="detail-section">
              <h3>Quality Checks</h3>
              <div className="detail-item">
                <span className="detail-label">Image Quality:</span>
                <span className="detail-value">{selectedVerification.quality_check ? <><i className="fas fa-check" style={{ color: '#28a745' }}></i> Pass</> : <><i className="fas fa-times" style={{ color: '#dc3545' }}></i> Fail</>}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Document Detection:</span>
                <span className="detail-value">{selectedVerification.document_check ? <><i className="fas fa-check" style={{ color: '#28a745' }}></i> Pass</> : <><i className="fas fa-times" style={{ color: '#dc3545' }}></i> Fail</>}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Text Extraction:</span>
                <span className="detail-value">{selectedVerification.ocr_check ? <><i className="fas fa-check" style={{ color: '#28a745' }}></i> Pass</> : <><i className="fas fa-times" style={{ color: '#dc3545' }}></i> Fail</>}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Permit Validation:</span>
                <span className="detail-value">{selectedVerification.permit_check ? <><i className="fas fa-check" style={{ color: '#28a745' }}></i> Pass</> : <><i className="fas fa-times" style={{ color: '#dc3545' }}></i> Fail</>}</span>
              </div>
            </div>

            <div className="detail-section">
              <h3>Extracted Text from Permit</h3>
              <div className="extracted-text">{selectedVerification.extracted_text || 'No text extracted'}</div>
            </div>

            <div className="detail-section">
              <h3>Verification Date</h3>
              <div className="detail-item">
                <span className="detail-label">Date & Time:</span>
                <span className="detail-value">
                  {selectedVerification.submitted_at ? new Date(selectedVerification.submitted_at).toLocaleString() : '-'}
                </span>
              </div>
            </div>

            {/* Rejection Reason - Only show if failed */}
            {!selectedVerification.valid && (
              <div className="detail-section" style={{ borderTop: '2px solid #dc3545', paddingTop: '20px', marginTop: '20px', backgroundColor: '#fff5f5', padding: '15px', borderRadius: '8px' }}>
                <h3 style={{ color: '#dc3545', marginTop: 0 }}>
                  <i className="fas fa-exclamation-circle"></i> Rejection Reason
                </h3>
                {(() => {
                  const reasons = [];
                  
                  // Generate reasons based on failed checks
                  if (!selectedVerification.quality_check) {
                    reasons.push('Image quality is too low or blurry. Please upload a clear, well-lit photo.');
                  }
                  if (!selectedVerification.document_check) {
                    reasons.push('The document in the image could not be detected or recognized. Ensure the permit is fully visible in the photo.');
                  }
                  if (!selectedVerification.ocr_check) {
                    reasons.push('Text could not be extracted from the permit image. Ensure the text is clear and readable.');
                  }
                  if (!selectedVerification.permit_check) {
                    if (selectedVerification.permit_validation?.message) {
                      reasons.push(selectedVerification.permit_validation.message);
                    } else {
                      reasons.push('The permit information does not match DTI records or the QR code data.');
                    }
                  }
                  
                  // Fallback if no specific reasons
                  if (reasons.length === 0) {
                    reasons.push('The permit verification failed. Please review the details above and resubmit with a clearer or valid permit.');
                  }
                  
                  return (
                    <ul style={{ color: '#666', lineHeight: '1.8', marginLeft: '20px' }}>
                      {reasons.map((reason, idx) => (
                        <li key={idx} style={{ marginBottom: '10px' }}>
                          <i className="fas fa-circle-notch" style={{ fontSize: '0.6em', marginRight: '8px', color: '#dc3545' }}></i>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      <Footer />

      {/* Inline Styles for Dashboard */}
      <style>{`
        .permit-dashboard-page {
          text-align: left !important;
        }
        .permit-dashboard-page .farmers-page {
          text-align: left !important;
          width: 100% !important;
        }
        .dashboard-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          text-align: left !important;
          width: 100%;
          box-sizing: border-box;
        }
        .verification-stats {
          display: grid !important;
          grid-template-columns: repeat(3, 1fr) !important;
          gap: 20px;
          margin-bottom: 30px;
          width: 100%;
        }
        @media (max-width: 768px) {
          .verification-stats {
            grid-template-columns: 1fr !important;
          }
        }
        .stat-card {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          text-align: center !important;
        }
        .stat-number {
          font-size: 2.5em;
          font-weight: bold;
          color: #2c7a2c;
          text-align: center !important;
        }
        .stat-label {
          color: #666;
          margin-top: 8px;
          text-align: center !important;
        }
        .verification-list {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          text-align: left !important;
          width: 100%;
        }
        .verification-item {
          border-bottom: 1px solid #eee;
          padding: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          text-align: left !important;
        }
        .verification-item:last-child { border-bottom: none; }
        .verification-item:hover { background: #f9f9f9; }
        .verification-status {
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 0.9em;
          font-weight: bold;
          white-space: nowrap;
        }
        .status-valid { background: #d4edda; color: #155724; }
        .status-rejected { background: #f8d7da; color: #721c24; }
        .verification-details { 
          flex: 1; 
          margin-right: 15px; 
          text-align: left !important;
        }
        .verification-details h4 { margin: 0 0 5px 0; color: #333; text-align: left !important; }
        .verification-details p { margin: 3px 0; font-size: 0.9em; color: #666; text-align: left !important; }
        .action-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        .filters {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
          justify-content: flex-start !important;
          width: 100%;
        }
        .filter-btn {
          padding: 8px 16px;
          border: 2px solid #ddd;
          background: white;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .filter-btn.active {
          background: #2c7a2c;
          color: white;
          border-color: #2c7a2c;
        }
        .filter-btn:hover { border-color: #2c7a2c; }
        .modal {
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0,0,0,0.5);
        }
        .modal-content {
          background-color: white;
          margin: 5% auto;
          padding: 30px;
          border-radius: 12px;
          width: 90%;
          max-width: 700px;
          max-height: 85vh;
          overflow-y: auto;
          text-align: left;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #eee;
          padding-bottom: 15px;
        }
        .modal-header h2 { margin: 0; text-align: left; }
        .close {
          font-size: 28px;
          font-weight: bold;
          color: #999;
          cursor: pointer;
        }
        .close:hover { color: #333; }
        .detail-section { 
          margin-bottom: 20px; 
          text-align: left;
        }
        .detail-section h3 {
          color: #2c7a2c;
          margin-bottom: 10px;
          border-bottom: 1px solid #ddd;
          padding-bottom: 8px;
          text-align: left;
        }
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #f0f0f0;
          text-align: left;
        }
        .detail-label { font-weight: bold; color: #666; text-align: left; }
        .detail-value { color: #333; text-align: right; flex: 1; margin-left: 15px; }
        .extracted-text {
          background: #f5f5f5;
          padding: 12px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 0.9em;
          line-height: 1.5;
          max-height: 200px;
          overflow-y: auto;
          border-left: 4px solid #2c7a2c;
          white-space: pre-wrap;
          text-align: left;
        }
        .confidence-bar {
          width: 100%;
          height: 20px;
          background: #e0e0e0;
          border-radius: 10px;
          overflow: hidden;
          margin-top: 8px;
        }
        .confidence-fill {
          height: 100%;
          background: linear-gradient(90deg, #d4edda, #2c7a2c);
          transition: width 0.3s ease;
        }
        .btn-sm { padding: 4px 8px; font-size: 0.85rem; }
        .btn-success { background: #28a745; color: white; border: none; }
        .btn-success:hover { background: #218838; }
        .btn-danger { background: #dc3545; color: white; border: none; }
        .btn-danger:hover { background: #c82333; }
      `}</style>
    </div>
  );
};

export default PermitVerificationDashboard;