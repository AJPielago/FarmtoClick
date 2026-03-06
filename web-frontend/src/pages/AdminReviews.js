import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { reviewsAPI } from '../services/api';
import Navbar from '../components/Navbar';

const STAR_FULL = '★';
const STAR_EMPTY = '☆';

const StarDisplay = ({ rating }) => (
  <span style={{ display: 'inline-flex', gap: '1px' }}>
    {[1, 2, 3, 4, 5].map((s) => (
      <span key={s} style={{ color: rating >= s ? '#f59e0b' : '#d1d5db', fontSize: '1rem' }}>
        {rating >= s ? STAR_FULL : STAR_EMPTY}
      </span>
    ))}
  </span>
);

const AdminReviews = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [stats, setStats] = useState({ average_rating: 0, total_reviews: 0, rating_distribution: {} });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [flash, setFlash] = useState(null);
  const perPage = 15;

  useEffect(() => {
    if (user && !user.is_admin && user.role !== 'admin') {
      navigate('/');
    }
  }, [user, navigate]);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reviewsAPI.getAdminReviews({
        page,
        per_page: perPage,
        search,
        rating: ratingFilter || undefined,
        sort: sortBy,
        order: sortOrder,
      });
      const data = res.data || res;
      setReviews(data.reviews || []);
      setTotalPages(data.total_pages || 1);
      setTotal(data.total || 0);
      setStats({
        average_rating: data.average_rating || 0,
        total_reviews: data.total_reviews || 0,
        rating_distribution: data.rating_distribution || {},
      });
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, ratingFilter, sortBy, sortOrder]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handleDelete = async (reviewId) => {
    try {
      await reviewsAPI.adminDeleteReview(reviewId);
      setFlash({ type: 'success', text: 'Review deleted successfully.' });
      setDeleteConfirm(null);
      loadReviews();
    } catch (err) {
      setFlash({ type: 'error', text: err.response?.data?.error || 'Failed to delete review.' });
    }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <i className="fas fa-sort" style={{ color: '#ccc', marginLeft: 4 }}></i>;
    return sortOrder === 'asc'
      ? <i className="fas fa-sort-up" style={{ color: '#2c7a2c', marginLeft: 4 }}></i>
      : <i className="fas fa-sort-down" style={{ color: '#2c7a2c', marginLeft: 4 }}></i>;
  };

  return (
    <div className="admin-reviews-page" style={{ minHeight: '100vh', background: '#f4f6f9' }}>
      <Navbar activePage="admin" />

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '30px 20px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#333', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="fas fa-star" style={{ color: '#f59e0b' }}></i> Customer Reviews
        </h1>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>Manage and monitor all product reviews</p>

        {/* Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#14532d' }}>{stats.total_reviews}</div>
            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Total Reviews</div>
          </div>
          <div style={cardStyle}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#14532d' }}>{stats.average_rating.toFixed(1)}</div>
            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>Average Rating</div>
          </div>
          {[5, 4, 3, 2, 1].map((star) => (
            <div key={star} style={cardStyle}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#333' }}>{stats.rating_distribution[star] || 0}</div>
              <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                {star} {STAR_FULL} Reviews
              </div>
            </div>
          ))}
        </div>

        {/* Flash Message */}
        {flash && (
          <div style={{ padding: '12px 16px', background: flash.type === 'success' ? '#dcfce7' : '#fef2f2', color: flash.type === 'success' ? '#14532d' : '#991b1b', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {flash.text}
            <button onClick={() => setFlash(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><i className="fas fa-times"></i></button>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Search by user, product, or comment..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ flex: 1, padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.9rem' }}
            />
            <button type="submit" style={{ padding: '8px 16px', background: '#2c7a2c', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
              <i className="fas fa-search"></i>
            </button>
          </form>
          <select
            value={ratingFilter}
            onChange={(e) => { setRatingFilter(e.target.value); setPage(1); }}
            style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.9rem', background: '#fff' }}
          >
            <option value="">All Ratings</option>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>{r} {STAR_FULL}</option>
            ))}
          </select>
          {(search || ratingFilter) && (
            <button onClick={() => { setSearch(''); setSearchInput(''); setRatingFilter(''); setPage(1); }} style={{ padding: '8px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
              <i className="fas fa-times"></i> Clear
            </button>
          )}
        </div>

        {/* Data Table */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#999' }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.5rem' }}></i>
              <p>Loading reviews...</p>
            </div>
          ) : reviews.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#999' }}>
              <i className="fas fa-inbox" style={{ fontSize: '2rem', marginBottom: 12, display: 'block' }}></i>
              <p>No reviews found.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={thStyle} onClick={() => handleSort('created_at')}>
                      Date <SortIcon col="created_at" />
                    </th>
                    <th style={thStyle}>User</th>
                    <th style={thStyle}>Product</th>
                    <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleSort('rating')}>
                      Rating <SortIcon col="rating" />
                    </th>
                    <th style={thStyle}>Comment</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyle}>
                        <div style={{ whiteSpace: 'nowrap' }}>
                          {review.created_at ? new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                        </div>
                        {review.updated_at && <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic' }}>edited</div>}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {review.user_profile_picture ? (
                            <img src={review.user_profile_picture} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '0.8rem', flexShrink: 0 }}>
                              <i className="fas fa-user"></i>
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600, color: '#333' }}>{review.user_name}</div>
                            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{review.user_email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 500, color: '#14532d' }}>{review.product_name}</span>
                      </td>
                      <td style={tdStyle}>
                        <StarDisplay rating={review.rating} />
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 300 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                          {review.comment || <span style={{ color: '#ccc', fontStyle: 'italic' }}>No comment</span>}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {deleteConfirm === review.id ? (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button onClick={() => handleDelete(review.id)} style={{ padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>Confirm</button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setDeleteConfirm(review.id)} style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262633', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <i className="fas fa-trash"></i> Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderTop: '1px solid #f0f0f0', flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total} reviews
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={paginationBtnStyle(page <= 1)}>
                  <i className="fas fa-chevron-left"></i> Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let p;
                  if (totalPages <= 7) p = i + 1;
                  else if (page <= 4) p = i + 1;
                  else if (page >= totalPages - 3) p = totalPages - 6 + i;
                  else p = page - 3 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)} style={{ ...paginationBtnStyle(false), background: p === page ? '#2c7a2c' : '#fff', color: p === page ? '#fff' : '#333', fontWeight: p === page ? 700 : 400 }}>
                      {p}
                    </button>
                  );
                })}
                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={paginationBtnStyle(page >= totalPages)}>
                  Next <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Style helpers ──
const cardStyle = {
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fff8 100%)',
  borderRadius: 12,
  padding: '18px 22px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  textAlign: 'center',
  border: '1px solid rgba(44,122,44,0.06)',
};

const thStyle = {
  textAlign: 'left',
  padding: '12px 14px',
  color: '#555',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  userSelect: 'none',
};

const tdStyle = {
  padding: '11px 14px',
  color: '#333',
  verticalAlign: 'middle',
};

const paginationBtnStyle = (disabled) => ({
  padding: '6px 14px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  background: disabled ? '#f9fafb' : '#fff',
  color: disabled ? '#d1d5db' : '#333',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '0.85rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

export default AdminReviews;
