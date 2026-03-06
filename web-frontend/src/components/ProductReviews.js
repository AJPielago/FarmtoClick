import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { reviewsAPI } from '../services/api';

const STAR_FULL = '★';
const STAR_EMPTY = '☆';

const StarRating = ({ rating, size = '1.1rem', interactive = false, onChange }) => {
  const [hover, setHover] = useState(0);
  return (
    <span style={{ display: 'inline-flex', gap: '2px', cursor: interactive ? 'pointer' : 'default' }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          style={{ fontSize: size, color: (interactive ? (hover || rating) : rating) >= star ? '#f59e0b' : '#d1d5db', transition: 'color .15s' }}
          onClick={() => interactive && onChange && onChange(star)}
          onMouseEnter={() => interactive && setHover(star)}
          onMouseLeave={() => interactive && setHover(0)}
        >
          {(interactive ? (hover || rating) : rating) >= star ? STAR_FULL : STAR_EMPTY}
        </span>
      ))}
    </span>
  );
};

const ProductReviews = ({ productId }) => {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingReview, setEditingReview] = useState(null);
  const [formRating, setFormRating] = useState(5);
  const [formComment, setFormComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadReviews = useCallback(async () => {
    try {
      const res = await reviewsAPI.getProductReviews(productId);
      const data = res.data || res;
      setReviews(data.reviews || []);
      setAverageRating(data.average_rating || 0);
      setTotalReviews(data.total || 0);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    }
  }, [productId]);

  const loadEligibility = useCallback(async () => {
    if (!user) return;
    try {
      const res = await reviewsAPI.checkEligibility(productId);
      setEligibility(res.data || res);
    } catch {
      setEligibility(null);
    }
  }, [productId, user]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadReviews();
      await loadEligibility();
      setLoading(false);
    };
    init();
  }, [loadReviews, loadEligibility]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    try {
      if (editingReview) {
        await reviewsAPI.updateReview(editingReview.id, { rating: formRating, comment: formComment });
        setSuccessMsg('Review updated successfully!');
      } else {
        await reviewsAPI.createReview(productId, { rating: formRating, comment: formComment });
        setSuccessMsg('Review submitted successfully!');
      }
      setShowForm(false);
      setEditingReview(null);
      setFormRating(5);
      setFormComment('');
      await loadReviews();
      await loadEligibility();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to submit review';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (review) => {
    setEditingReview(review);
    setFormRating(review.rating);
    setFormComment(review.comment || '');
    setShowForm(true);
    setError('');
    setSuccessMsg('');
  };

  const handleDelete = async (reviewId) => {
    if (!window.confirm('Are you sure you want to delete your review?')) return;
    try {
      await reviewsAPI.deleteReview(reviewId);
      setSuccessMsg('Review deleted successfully!');
      await loadReviews();
      await loadEligibility();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete review');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingReview(null);
    setFormRating(5);
    setFormComment('');
    setError('');
  };

  const ratingBreakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
    pct: totalReviews > 0 ? Math.round((reviews.filter((r) => r.rating === star).length / totalReviews) * 100) : 0,
  }));

  if (loading) {
    return (
      <section style={styles.section}>
        <div style={styles.container}>
          <h2 style={styles.heading}><i className="fas fa-star" style={{ color: '#f59e0b' }}></i> Customer Reviews</h2>
          <p style={{ textAlign: 'center', color: '#999' }}>Loading reviews...</p>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.section}>
      <div style={styles.container}>
        <h2 style={styles.heading}><i className="fas fa-star" style={{ color: '#f59e0b' }}></i> Customer Reviews</h2>

        {/* Summary */}
        <div style={styles.summary}>
          <div style={styles.summaryLeft}>
            <div style={styles.bigRating}>{averageRating.toFixed(1)}</div>
            <StarRating rating={Math.round(averageRating)} size="1.4rem" />
            <div style={styles.totalText}>{totalReviews} review{totalReviews !== 1 ? 's' : ''}</div>
          </div>
          <div style={styles.summaryRight}>
            {ratingBreakdown.map((b) => (
              <div key={b.star} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{b.star} <span style={{ color: '#f59e0b' }}>{STAR_FULL}</span></span>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${b.pct}%` }} />
                </div>
                <span style={styles.breakdownCount}>{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Messages */}
        {successMsg && <div style={styles.successAlert}>{successMsg}<button onClick={() => setSuccessMsg('')} style={styles.alertClose}><i className="fas fa-times"></i></button></div>}
        {error && <div style={styles.errorAlert}>{error}<button onClick={() => setError('')} style={styles.alertClose}><i className="fas fa-times"></i></button></div>}

        {/* Write Review Button / Eligibility */}
        {user && eligibility && (
          <div style={styles.ctaRow}>
            {eligibility.can_review && !showForm && (
              <button style={styles.writeBtn} onClick={() => { setShowForm(true); setEditingReview(null); setFormRating(5); setFormComment(''); setError(''); }}>
                <i className="fas fa-pen"></i> Write a Review
              </button>
            )}
            {eligibility.has_existing_review && !showForm && (
              <span style={styles.alreadyText}>
                <i className="fas fa-check-circle" style={{ color: '#2c7a2c' }}></i> You have already reviewed this product. You can edit or delete it below.
              </span>
            )}
            {!eligibility.has_delivered_order && (
              <span style={styles.alreadyText}>
                <i className="fas fa-info-circle" style={{ color: '#6b7280' }}></i> Only customers who have received this product can write a review.
              </span>
            )}
          </div>
        )}
        {!user && (
          <div style={styles.ctaRow}>
            <span style={styles.alreadyText}><i className="fas fa-sign-in-alt"></i> <a href="/login" style={{ color: '#2c7a2c' }}>Log in</a> to write a review.</span>
          </div>
        )}

        {/* Review Form */}
        {showForm && (
          <form onSubmit={handleSubmit} style={styles.form}>
            <h3 style={styles.formTitle}>{editingReview ? 'Edit Your Review' : 'Write a Review'}</h3>
            <div style={styles.formGroup}>
              <label style={styles.label}>Rating</label>
              <StarRating rating={formRating} size="1.8rem" interactive onChange={setFormRating} />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Comment (optional)</label>
              <textarea
                style={styles.textarea}
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
                placeholder="Share your experience with this product..."
                maxLength={1000}
                rows={4}
              />
              <small style={styles.charCount}>{formComment.length}/1000</small>
            </div>
            <div style={styles.formActions}>
              <button type="submit" style={styles.submitBtn} disabled={submitting}>
                {submitting ? <><i className="fas fa-spinner fa-spin"></i> Submitting...</> : editingReview ? 'Update Review' : 'Submit Review'}
              </button>
              <button type="button" style={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
            </div>
          </form>
        )}

        {/* Reviews List */}
        {reviews.length === 0 ? (
          <div style={styles.empty}>
            <i className="fas fa-comment-slash" style={{ fontSize: '2rem', color: '#d1d5db', marginBottom: '12px' }}></i>
            <p>No reviews yet. Be the first to review this product!</p>
          </div>
        ) : (
          <div style={styles.reviewsList}>
            {reviews.map((review) => (
              <div key={review.id} style={styles.reviewCard}>
                <div style={styles.reviewHeader}>
                  <div style={styles.reviewUser}>
                    {review.user_profile_picture ? (
                      <img src={review.user_profile_picture} alt="" style={styles.avatar} />
                    ) : (
                      <div style={styles.avatarPlaceholder}><i className="fas fa-user"></i></div>
                    )}
                    <div>
                      <div style={styles.userName}>{review.user_name}</div>
                      <div style={styles.reviewDate}>
                        {review.created_at ? new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                        {review.updated_at && <span style={styles.editedBadge}> (edited)</span>}
                      </div>
                    </div>
                  </div>
                  <StarRating rating={review.rating} />
                </div>
                {review.comment && <p style={styles.reviewComment}>{review.comment}</p>}
                {user && review.user_id === user.id && (
                  <div style={styles.reviewActions}>
                    <button style={styles.editBtn} onClick={() => handleEdit(review)}><i className="fas fa-edit"></i> Edit</button>
                    <button style={styles.deleteBtn} onClick={() => handleDelete(review.id)}><i className="fas fa-trash"></i> Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

// ── Styles ──
const styles = {
  section: { padding: '40px 0', background: '#fafafa' },
  container: { maxWidth: '900px', margin: '0 auto', padding: '0 20px' },
  heading: { fontSize: '1.5rem', fontWeight: 700, color: '#333', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '10px' },
  summary: { display: 'flex', gap: '40px', background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px', flexWrap: 'wrap' },
  summaryLeft: { textAlign: 'center', minWidth: '120px' },
  bigRating: { fontSize: '3rem', fontWeight: 800, color: '#14532d', lineHeight: 1 },
  totalText: { fontSize: '0.9rem', color: '#6b7280', marginTop: '6px' },
  summaryRight: { flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center', minWidth: '200px' },
  breakdownRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  breakdownLabel: { width: '40px', fontSize: '0.85rem', color: '#555', textAlign: 'right' },
  barTrack: { flex: 1, height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' },
  barFill: { height: '100%', background: '#f59e0b', borderRadius: '4px', transition: 'width .3s' },
  breakdownCount: { width: '28px', fontSize: '0.85rem', color: '#6b7280', textAlign: 'left' },
  ctaRow: { marginBottom: '20px' },
  writeBtn: { padding: '10px 24px', background: '#2c7a2c', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' },
  alreadyText: { fontSize: '0.9rem', color: '#555', display: 'inline-flex', alignItems: 'center', gap: '6px' },
  form: { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '24px', border: '2px solid #2c7a2c22' },
  formTitle: { fontSize: '1.15rem', fontWeight: 600, color: '#333', marginBottom: '16px' },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#333', marginBottom: '6px' },
  textarea: { width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  charCount: { display: 'block', textAlign: 'right', fontSize: '0.8rem', color: '#9ca3af', marginTop: '4px' },
  formActions: { display: 'flex', gap: '12px' },
  submitBtn: { padding: '10px 24px', background: '#2c7a2c', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' },
  cancelBtn: { padding: '10px 24px', background: '#f3f4f6', color: '#333', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.95rem', cursor: 'pointer' },
  successAlert: { padding: '12px 16px', background: '#dcfce7', color: '#14532d', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.9rem' },
  errorAlert: { padding: '12px 16px', background: '#fef2f2', color: '#991b1b', borderRadius: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.9rem' },
  alertClose: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: 'inherit' },
  empty: { textAlign: 'center', padding: '40px 20px', color: '#9ca3af' },
  reviewsList: { display: 'flex', flexDirection: 'column', gap: '16px' },
  reviewCard: { background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' },
  reviewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' },
  reviewUser: { display: 'flex', alignItems: 'center', gap: '12px' },
  avatar: { width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' },
  avatarPlaceholder: { width: '40px', height: '40px', borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '1rem' },
  userName: { fontWeight: 600, fontSize: '0.95rem', color: '#333' },
  reviewDate: { fontSize: '0.8rem', color: '#9ca3af' },
  editedBadge: { fontStyle: 'italic', color: '#6b7280' },
  reviewComment: { fontSize: '0.95rem', color: '#444', lineHeight: 1.6, margin: '8px 0 0' },
  reviewActions: { display: 'flex', gap: '10px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' },
  editBtn: { padding: '6px 14px', background: '#f0f7f0', color: '#2c7a2c', border: '1px solid #2c7a2c44', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' },
  deleteBtn: { padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262644', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' },
};

export default ProductReviews;
