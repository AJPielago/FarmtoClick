import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ridersAPI } from '../services/api';
import Navbar from '../components/Navbar';

const emptyForm = {
  name: '',
  email: '',
  password: '',
  phone: '',
  barangay: '',
  city: '',
  province: '',
  active: true,
};

const AdminRiders = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [riders, setRiders] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [stats, setStats] = useState({ active: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRiders = async () => {
    try {
      setIsLoading(true);
      const res = await ridersAPI.getAdminRiders();
      setRiders(res.data?.riders || []);
      setStats({
        active: res.data?.active_count || 0,
        total: res.data?.total_count || 0,
      });
    } catch (err) {
      setError('Failed to load riders.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (user && user.is_admin) {
      loadRiders();
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      if (editingId) {
        const payload = { ...form };
        if (!payload.password) {
          delete payload.password;
        }
        await ridersAPI.updateAdminRider(editingId, payload);
      } else {
        await ridersAPI.createAdminRider(form);
      }
      await loadRiders();
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save rider.');
    }
  };

  const handleEdit = (rider) => {
    setForm({
      name: rider.name || '',
      email: rider.email || '',
      password: '',
      phone: rider.phone || '',
      barangay: rider.barangay || '',
      city: rider.city || '',
      province: rider.province || '',
      active: rider.active !== false,
    });
    setEditingId(rider.id);
  };

  const handleDelete = async (riderId) => {
    if (!window.confirm('Delete this rider?')) return;
    try {
      await ridersAPI.deleteAdminRider(riderId);
      await loadRiders();
    } catch (err) {
      setError('Failed to delete rider.');
    }
  };

  return (
    <div className="admin-riders-page">
      <Navbar />
      <section className="admin-riders-content">
        <div className="container">
          <div className="admin-riders-header">
            <Link to="/admin-dashboard" className="back-link"><i className="fas fa-arrow-left"></i> Admin Dashboard</Link>
            <h2>Rider Management</h2>
            <p>Admin-only rider accounts with delivery coverage areas.</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="admin-riders-stats">
            <div className="rider-stat-card">
              <div className="stat-label">Active Riders</div>
              <div className="stat-value">{stats.active}</div>
            </div>
            <div className="rider-stat-card">
              <div className="stat-label">Total Riders</div>
              <div className="stat-value">{stats.total}</div>
            </div>
            <div className="rider-stat-card accent">
              <div className="stat-label">Coverage Areas</div>
              <div className="stat-value">{[...new Set(riders.map((r) => `${r.city}-${r.province}`))].length}</div>
            </div>
          </div>

          <div className="admin-riders-grid">
            <form className="rider-form" onSubmit={handleSubmit}>
              <h3>{editingId ? 'Edit Rider' : 'Add Rider'}</h3>
              <p className="form-subtitle">Create rider accounts managed by admins only.</p>
              <div className="form-row">
                <label>Name</label>
                <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Email</label>
                <input
                  value={form.email}
                  type="email"
                  onChange={(e) => handleChange('email', e.target.value)}
                  required
                  disabled={Boolean(editingId)}
                />
              </div>
              <div className="form-row">
                <label>{editingId ? 'Reset Password (optional)' : 'Password'}</label>
                <input
                  value={form.password}
                  type="password"
                  onChange={(e) => handleChange('password', e.target.value)}
                  required={!editingId}
                />
              </div>
              <div className="form-row">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Barangay</label>
                <input value={form.barangay} onChange={(e) => handleChange('barangay', e.target.value)} required />
              </div>
              <div className="form-row">
                <label>City / Municipality</label>
                <input value={form.city} onChange={(e) => handleChange('city', e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Province</label>
                <input value={form.province} onChange={(e) => handleChange('province', e.target.value)} required />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => handleChange('active', e.target.checked)}
                />
                Active Rider
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">{editingId ? 'Save Changes' : 'Add Rider'}</button>
                {editingId && (
                  <button type="button" className="btn btn-outline" onClick={resetForm}>Cancel</button>
                )}
              </div>
            </form>

            <div className="rider-list">
              <div className="rider-list-header">
                <div>
                  <h3>Rider Directory</h3>
                  <p>Manage rider profiles and activation status.</p>
                </div>
              </div>
              {isLoading ? (
                <div className="loading-spinner"><i className="fas fa-spinner fa-spin"></i> Loading riders...</div>
              ) : riders.length === 0 ? (
                <div className="empty-state">No riders added yet.</div>
              ) : (
                <div className="rider-cards">
                  {riders.map((rider) => (
                    <div key={rider.id} className={`rider-card ${rider.active ? '' : 'inactive'}`}>
                      <div>
                        <div className="rider-card-top">
                          <h4>{rider.name}</h4>
                          <span className={`status-pill ${rider.active ? 'active' : 'inactive'}`}>
                            {rider.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="rider-meta">{rider.email}</p>
                        <p className="rider-meta">{rider.phone}</p>
                        <div className="rider-area-chip">
                          {[rider.barangay, rider.city, rider.province].filter(Boolean).join(', ')}
                        </div>
                      </div>
                      <div className="rider-actions">
                        <button className="btn btn-outline" onClick={() => handleEdit(rider)}>Edit</button>
                        <button className="btn btn-danger" onClick={() => handleDelete(rider.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <style>{`
        .admin-riders-page {
          min-height: 100vh;
          background: radial-gradient(circle at top left, #e8f5e9 0%, #f4f6f9 45%, #fefcfb 100%);
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
        }
        .admin-riders-content {
          padding: 32px 20px 60px;
        }
        .admin-riders-header {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #2c7a2c;
          font-weight: 600;
          text-decoration: none;
          margin-bottom: 6px;
        }
        .back-link i { margin-right: 4px; }
        .admin-riders-header h2 {
          margin-bottom: 0;
          font-size: 1.8rem;
          color: #0f172a;
        }
        .admin-riders-header p {
          color: #475569;
          margin-bottom: 12px;
        }
        .admin-riders-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 22px;
        }
        .rider-stat-card {
          background: #ffffff;
          border-radius: 14px;
          padding: 16px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
        }
        .rider-stat-card.accent {
          background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%);
        }
        .stat-label {
          font-size: 0.85rem;
          color: #475569;
          margin-bottom: 6px;
        }
        .stat-value {
          font-size: 1.6rem;
          font-weight: 700;
          color: #14532d;
        }
        .admin-riders-grid {
          display: grid;
          grid-template-columns: minmax(280px, 360px) 1fr;
          gap: 22px;
          align-items: start;
        }
        .rider-form {
          background: #fff;
          padding: 22px;
          border-radius: 16px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
          border: 1px solid rgba(15, 23, 42, 0.08);
        }
        .rider-form h3 {
          margin-top: 0;
          margin-bottom: 6px;
          font-size: 1.2rem;
        }
        .form-subtitle {
          margin: 0 0 18px;
          color: #64748b;
          font-size: 0.85rem;
        }
        .form-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
          text-align: left;
        }
        .form-row input {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #d1d5db;
          font-size: 0.9rem;
          background: #f8fafc;
        }
        .form-row input:disabled {
          background: #f1f5f9;
          color: #94a3b8;
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 12px 0 18px;
          font-size: 0.9rem;
          color: #374151;
        }
        .form-actions {
          display: flex;
          gap: 10px;
        }
        .rider-list {
          background: #fff;
          padding: 22px;
          border-radius: 16px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
          border: 1px solid rgba(15, 23, 42, 0.08);
        }
        .rider-list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 18px;
        }
        .rider-list-header h3 {
          margin: 0 0 4px;
        }
        .rider-list-header p {
          margin: 0;
          color: #64748b;
          font-size: 0.85rem;
        }
        .rider-cards {
          display: grid;
          gap: 14px;
        }
        .rider-card {
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 16px;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          text-align: left;
          background: #f9fafb;
        }
        .rider-card.inactive {
          opacity: 0.65;
        }
        .rider-card-top {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .rider-card h4 {
          margin: 0;
          font-size: 1rem;
        }
        .rider-meta {
          margin: 0 0 4px;
          color: #475569;
          font-size: 0.85rem;
        }
        .rider-area-chip {
          display: inline-flex;
          padding: 4px 10px;
          border-radius: 999px;
          background: #e0f2fe;
          color: #0369a1;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .status-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 600;
        }
        .status-pill.active {
          background: #ecfdf3;
          color: #15803d;
        }
        .status-pill.inactive {
          background: #fee2e2;
          color: #b91c1c;
        }
        .rider-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .btn.btn-danger {
          background: #dc2626;
          color: #fff;
          border: none;
        }
        .empty-state {
          color: #6b7280;
          padding: 12px 0;
        }
        @media (max-width: 900px) {
          .admin-riders-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default AdminRiders;
