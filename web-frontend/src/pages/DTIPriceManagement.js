import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dtiAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const DTIPriceManagement = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [flashMessages, setFlashMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('records'); // records, upload

  // manual and bulk entry removed

  // PDF upload
  const [pdfFile, setPdfFile] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);

  // Search/filter
  const [searchQuery, setSearchQuery] = useState('');
  
  // (no toggle) always show newest-per-product unless a date filter is set
  // Date filter (yyyy-mm-dd) — when set, display records from that date
  const [selectedDate, setSelectedDate] = useState('');

  // (delete features removed) selection and bulk-delete state removed

  const units = ['kg', 'g', 'piece', 'pack', 'bunch', 'bundle', 'box', 'tray', 'liter', 'ml', 'lb', 'can', 'bottle'];

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const res = await dtiAPI.getPrices();
      setRecords(res.data?.records || []);
    } catch (error) {
      console.error('Failed to load DTI records:', error);
      setFlashMessages([{ category: 'error', text: 'Failed to load DTI price records.' }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.is_admin) {
      loadRecords();
    }
  }, [user, loadRecords]);

  // manual entry removed

  const handlePdfUpload = async (e) => {
    e.preventDefault();
    if (!pdfFile) {
      setFlashMessages([{ category: 'error', text: 'Please select a PDF file.' }]);
      return;
    }
    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('pdf', pdfFile);
      const res = await dtiAPI.uploadPdf(formData);
      setUploadResult(res.data);
      setFlashMessages([{ category: 'success', text: res.data.message || 'PDF processed successfully!' }]);
      setPdfFile(null);
      // Reset file input
      const fileInput = document.getElementById('dti-pdf-input');
      if (fileInput) fileInput.value = '';
      loadRecords();
    } catch (error) {
      const errData = error.response?.data;
      setFlashMessages([{ category: 'error', text: errData?.error || 'Failed to process PDF.' }]);
      if (errData?.raw_text_preview) {
        setUploadResult({ raw_text_preview: errData.raw_text_preview, error: true });
      }
    } finally {
      setLoading(false);
    }
  };

  // bulk entry removed

  // bulk helpers removed

  // Delete functions intentionally removed — records are preserved on uploads

  const filteredRecords = records.filter(rec =>
    !searchQuery || rec.product_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Build list of records after applying optional date filter
  const recordsAfterDateFilter = (() => {
    if (!selectedDate) return filteredRecords;
    // selectedDate is yyyy-mm-dd
    return filteredRecords.filter(rec => {
      if (!rec.uploaded_at) return false;
      const d = new Date(rec.uploaded_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}` === selectedDate;
    });
  })();

  // Compute newest record per product (by uploaded_at) from recordsAfterDateFilter
  const newestPerProduct = (() => {
    const m = new Map();
    for (const rec of recordsAfterDateFilter) {
      const key = rec.product_name_lower || (rec.product_name || '').toLowerCase().trim();
      const ts = rec.uploaded_at ? (new Date(rec.uploaded_at)).getTime() : 0;
      const existing = m.get(key);
      if (!existing) {
        m.set(key, rec);
      } else {
        const existingTs = existing.uploaded_at ? (new Date(existing.uploaded_at)).getTime() : 0;
        if (ts >= existingTs) m.set(key, rec);
      }
    }
    return Array.from(m.values());
  })();

  // Which records to display in the main table
  // If a date is selected -> show records for that date
  // If a search query is present -> show all matching records (historical included)
  // Otherwise -> show newest-per-product
  const displayedRecords = selectedDate ? recordsAfterDateFilter : (searchQuery ? filteredRecords : newestPerProduct);

  // Unique upload dates available (yyyy-mm-dd) for quick select
  const availableDates = (() => {
    const s = new Set();
    for (const rec of records) {
      if (!rec.uploaded_at) continue;
      const d = new Date(rec.uploaded_at);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      s.add(`${yyyy}-${mm}-${dd}`);
    }
    return Array.from(s).sort().reverse();
  })();

  // Group records by batch
  const batches = {};
  filteredRecords.forEach(rec => {
    const key = rec.batch_id || 'unknown';
    if (!batches[key]) {
      batches[key] = {
        batch_id: key,
        source: rec.source_file,
        date: rec.uploaded_at,
        records: []
      };
    }
    batches[key].records.push(rec);
  });

  // Delete currently displayed records (soft-delete via backend)
  const deleteDisplayedRecords = async () => {
    if (!window.confirm(`Delete ${displayedRecords.length} displayed record(s)? This will deactivate them.`)) return;
    if (!displayedRecords || displayedRecords.length === 0) return;
    try {
      setLoading(true);
      const ids = displayedRecords.map(r => r._id).filter(Boolean);
      if (ids.length === 0) {
        setFlashMessages([{ category: 'error', text: 'No valid records to delete.' }]);
        return;
      }
      const res = await dtiAPI.bulkDelete(ids, false);
      setFlashMessages([{ category: 'success', text: res.data?.message || `${ids.length} record(s) deleted.` }]);
      // reload records
      await loadRecords();
    } catch (error) {
      setFlashMessages([{ category: 'error', text: error.response?.data?.error || 'Failed to delete records.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!user || !user.is_admin) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h1>Access Denied</h1>
        <p>This page is only available for administrators.</p>
        <Link to="/" className="btn btn-primary">Go Home</Link>
      </div>
    );
  }

  return (
    <div className="manage-products-page">
      {/* Navigation */}
      <Navbar />

      <div style={{ padding: '12px 20px' }}>
        <Link to="/admin-dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#2c7a2c', textDecoration: 'none', fontWeight: 600 }}>
          <i className="fas fa-arrow-left"></i> Admin Dashboard
        </Link>
      </div>

      <section className="products-page">
        <div className="container">
          {/* Flash Messages */}
          {flashMessages.length > 0 && (
            <div className="flash-messages" style={{ marginBottom: '20px' }}>
              {flashMessages.map((msg, i) => (
                <div key={i} className={`alert alert-${msg.category}`}
                  style={{
                    padding: '12px 16px', borderRadius: '8px', marginBottom: '8px',
                    background: msg.category === 'success' ? '#d4edda' : '#f8d7da',
                    color: msg.category === 'success' ? '#155724' : '#721c24',
                    border: `1px solid ${msg.category === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
                  }}>
                  {msg.text}
                  <button onClick={() => setFlashMessages(flashMessages.filter((_, idx) => idx !== i))}
                    style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '24px', borderBottom: '2px solid #e9ecef' }}>
            {[
              { key: 'records', icon: 'fas fa-list', label: 'Price Records' },
              { key: 'upload', icon: 'fas fa-file-pdf', label: 'Upload PDF' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '12px 24px', border: 'none', cursor: 'pointer',
                  background: activeTab === tab.key ? '#4CAF50' : 'transparent',
                  color: activeTab === tab.key ? '#fff' : '#666',
                  fontWeight: activeTab === tab.key ? '600' : '400',
                  borderRadius: '8px 8px 0 0', fontSize: '0.95rem',
                  transition: 'all 0.2s',
                }}>
                <i className={tab.icon} style={{ marginRight: '8px' }}></i>{tab.label}
              </button>
            ))}
          </div>

          {/* TAB: Price Records */}
          {activeTab === 'records' && (
            <div className="profile-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <h2 style={{ margin: 0 }}>
                  <i className="fas fa-database"></i> DTI Price Records ({filteredRecords.length})
                </h2>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="text" placeholder="Search products..."
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: '6px', width: '250px' }}
                  />
                  
                  <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd' }}>
                    <option value="">All Dates</option>
                    {availableDates.map(d => (
                      <option key={d} value={d}>{new Date(d).toLocaleDateString()}</option>
                    ))}
                  </select>
                  <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd' }} />
                  <button onClick={() => setSelectedDate('')} className="btn btn-outline" style={{ padding: '6px 10px' }}>Clear</button>
                  <button onClick={deleteDisplayedRecords}
                    className="btn btn-danger" disabled={displayedRecords.length === 0 || loading}
                    style={{ padding: '6px 10px', background: '#dc3545', color: '#fff', border: 'none' }}>
                    <i className="fas fa-trash"></i> Delete Displayed ({displayedRecords.length})
                  </button>
                  <div style={{ color: '#666', fontSize: '0.9rem' }}>
                    Showing <strong>{displayedRecords.length}</strong> of <strong>{filteredRecords.length}</strong> record(s)
                  </div>
                </div>
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#4CAF50' }}></i>
                  <p>Loading records...</p>
                </div>
              ) : displayedRecords.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                        <th style={thStyle}>Product Name</th>
                        <th style={thStyle}>Price Low</th>
                        <th style={thStyle}>Price High</th>
                        <th style={thStyle}>Average</th>
                        <th style={thStyle}>Unit</th>
                        <th style={thStyle}>Source</th>
                        <th style={thStyle}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRecords.map((rec, i) => (
                        <tr key={rec._id || i} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={tdStyle}><strong>{rec.product_name}</strong></td>
                          <td style={tdStyle}>₱{rec.price_low?.toFixed(2)}</td>
                          <td style={tdStyle}>₱{rec.price_high?.toFixed(2)}</td>
                          <td style={tdStyle}>₱{rec.average_price?.toFixed(2)}</td>
                          <td style={tdStyle}>{rec.unit}</td>
                          <td style={tdStyle}>
                            <span style={{ fontSize: '0.8rem', color: '#888' }}>
                              {rec.source_file === 'manual_entry' ? '✏️ Manual' : rec.source_file === 'bulk_manual_entry' ? '📋 Bulk' : `📄 ${rec.source_file?.substring(0, 20)}...`}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ fontSize: '0.8rem', color: '#888' }}>
                              {rec.uploaded_at ? new Date(rec.uploaded_at).toLocaleDateString() : '-'}
                            </span>
                          </td>
                          
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  <i className="fas fa-inbox" style={{ fontSize: '2rem', marginBottom: '12px', opacity: 0.5 }}></i>
                  <p>No DTI price records yet.</p>
                  <p style={{ fontSize: '0.9rem' }}>Upload a DTI PDF or add prices manually to get started.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB: Upload PDF */}
          {activeTab === 'upload' && (
            <div className="profile-card">
              <h2><i className="fas fa-file-upload"></i> Upload DTI Price Bulletin PDF</h2>
              <p style={{ color: '#666', marginBottom: '20px' }}>
                Upload a DTI price monitoring bulletin in PDF format. The system will automatically extract product names and prices.
              </p>

              <form onSubmit={handlePdfUpload}>
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label htmlFor="dti-pdf-input" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                    Select PDF File
                  </label>
                  <input
                    type="file" id="dti-pdf-input" accept=".pdf"
                    onChange={(e) => { setPdfFile(e.target.files[0]); setUploadResult(null); }}
                    style={{ display: 'block', padding: '10px', border: '2px dashed #ccc', borderRadius: '8px', width: '100%', cursor: 'pointer' }}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading || !pdfFile}>
                  {loading ? <><i className="fas fa-spinner fa-spin"></i> Processing...</> : <><i className="fas fa-upload"></i> Upload & Parse PDF</>}
                </button>
              </form>

              {uploadResult && (
                <div style={{ marginTop: '24px', padding: '16px', background: uploadResult.error ? '#fff3cd' : '#d4edda', borderRadius: '8px' }}>
                  {uploadResult.error ? (
                    <>
                      <h4 style={{ color: '#856404' }}>Could not extract prices automatically</h4>
                      <p style={{ fontSize: '0.9rem' }}>The PDF text was extracted but the format wasn't recognized. You can add the prices manually instead.</p>
                      {uploadResult.raw_text_preview && (
                        <details style={{ marginTop: '12px' }}>
                          <summary style={{ cursor: 'pointer', color: '#856404' }}>View extracted text</summary>
                          <pre style={{ fontSize: '0.75rem', maxHeight: '300px', overflow: 'auto', background: '#fff', padding: '12px', borderRadius: '4px', marginTop: '8px' }}>
                            {uploadResult.raw_text_preview}
                          </pre>
                        </details>
                      )}
                    </>
                  ) : (
                    <>
                      <h4 style={{ color: '#155724' }}><i className="fas fa-check-circle"></i> {uploadResult.message}</h4>
                      {uploadResult.records && (
                        <div style={{ marginTop: '12px', maxHeight: '300px', overflow: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                              <tr style={{ background: 'rgba(0,0,0,0.05)' }}>
                                <th style={thStyle}>Product</th>
                                <th style={thStyle}>Low</th>
                                <th style={thStyle}>High</th>
                                <th style={thStyle}>Avg</th>
                                <th style={thStyle}>Unit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {uploadResult.records.map((rec, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                  <td style={tdStyle}>{rec.product_name}</td>
                                  <td style={tdStyle}>₱{rec.price_low?.toFixed(2)}</td>
                                  <td style={tdStyle}>₱{rec.price_high?.toFixed(2)}</td>
                                  <td style={tdStyle}>₱{rec.average_price?.toFixed(2)}</td>
                                  <td style={tdStyle}>{rec.unit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          
        </div>
      </section>

      <Footer />
    </div>
  );
};

const thStyle = { padding: '10px 12px', textAlign: 'left', fontWeight: '600', fontSize: '0.85rem', color: '#555' };
const tdStyle = { padding: '10px 12px', verticalAlign: 'middle' };

export default DTIPriceManagement;
