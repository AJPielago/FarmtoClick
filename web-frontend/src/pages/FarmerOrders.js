import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI, ridersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const FarmerOrders = () => {
  const { user } = useAuth();
  const [sellerOrders, setSellerOrders] = useState([]);
  const [riders, setRiders] = useState([]);
  const [flashMessages, setFlashMessages] = useState([]);
  const [rejectionOrderId, setRejectionOrderId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [assigningOrderId, setAssigningOrderId] = useState(null);
  const [assigningRiderId, setAssigningRiderId] = useState(null);
  // Rider assignment modal state
  const [riderModalOrderId, setRiderModalOrderId] = useState(null);
  const [riderSearchTerm, setRiderSearchTerm] = useState('');
  // Inline rider dropdown state
  const [inlineRiderOrderId, setInlineRiderOrderId] = useState(null);

  const loadOrdersData = useCallback(async () => {
    try {
      const ordersRes = await ordersAPI.getSellerOrders();
      setSellerOrders(ordersRes.data?.orders || []);

      const ridersRes = await ridersAPI.getActive();
      setRiders(ridersRes.data?.riders || []);
    } catch (error) {
      console.error('Failed to load orders data:', error);
    }
  }, []);

  useEffect(() => {
    if (user && user.is_farmer) {
      loadOrdersData();
    }
  }, [user, loadOrdersData]);

  const updateOrderStatus = async (orderId, status) => {
    if (status === 'rejected') {
      setRejectionOrderId(orderId);
      return;
    }

    try {
      const res = await ordersAPI.updateSellerOrderStatus(orderId, { status });
      const data = res.data || {};
      if (data.success) {
        loadOrdersData();
        setFlashMessages([{ category: 'success', text: `Order ${status} successfully!` }]);
      } else {
        setFlashMessages([{ category: 'error', text: data.message || 'Failed to update order status' }]);
      }
    } catch (error) {
      setFlashMessages([{ category: 'error', text: 'Failed to update order status' }]);
    }
  };

  const normalizeText = (value) => (value || '').toString().toLowerCase();
  const getOrderAddressText = (order) => `${order.shipping_address || ''} ${order.delivery_address || ''}`.trim();
  const riderMatchesOrder = (order, rider) => {
    const addressText = normalizeText(getOrderAddressText(order));
    if (!addressText) return false;
    const city = normalizeText(rider.city);
    const province = normalizeText(rider.province);
    const barangay = normalizeText(rider.barangay);
    if (city && addressText.includes(city)) return true;
    if (province && addressText.includes(province)) return true;
    if (barangay && addressText.includes(barangay)) return true;
    return false;
  };

  // --- Rider assignment modal helpers ---
  const openRiderModal = (orderId) => {
    setRiderModalOrderId(orderId);
    setRiderSearchTerm('');
  };
  const closeRiderModal = () => {
    setRiderModalOrderId(null);
    setRiderSearchTerm('');
  };

  // --- Inline rider dropdown toggle ---
  const toggleInlineRider = (orderId) => {
    setInlineRiderOrderId((prev) => (prev === orderId ? null : orderId));
  };

  // --- Assign rider (shared by modal & inline) ---
  const assignRiderToOrder = async (orderId, rider) => {
    const order = sellerOrders.find((o) => o.id === orderId);
    if (!order) return;

    // Removed strict area match check to allow assigning any rider
    // if (!riderMatchesOrder(order, rider)) {
    //   setFlashMessages([{ category: 'error', text: 'Rider area must match buyer address (barangay/city/province).' }]);
    //   return;
    // }

    try {
      setAssigningOrderId(orderId);
      setAssigningRiderId(rider.id);
      const res = await ordersAPI.assignRider(orderId, { rider_id: rider.id });
      if (res.data?.success) {
        setFlashMessages([{ category: 'success', text: `Assigned ${rider.name} to order #${orderId}` }]);
        loadOrdersData();
      } else {
        setFlashMessages([{ category: 'error', text: res.data?.message || 'Failed to assign rider.' }]);
      }
    } catch (error) {
      setFlashMessages([{ category: 'error', text: 'Failed to assign rider.' }]);
    } finally {
      setAssigningOrderId(null);
      setAssigningRiderId(null);
      closeRiderModal();
      setInlineRiderOrderId(null);
    }
  };

  // --- Riders filtered/sorted for an order (matching riders first) ---
  const getRidersForOrder = (order, search) => {
    let list = [...riders];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.city || '').toLowerCase().includes(q) ||
        (r.province || '').toLowerCase().includes(q) ||
        (r.barangay || '').toLowerCase().includes(q)
      );
    }
    // Sort: matching riders first
    list.sort((a, b) => {
      const aMatch = riderMatchesOrder(order, a) ? 0 : 1;
      const bMatch = riderMatchesOrder(order, b) ? 0 : 1;
      return aMatch - bMatch;
    });
    return list;
  };

  const submitRejection = async (orderId) => {
    if (!rejectionReason.trim()) {
      setFlashMessages([{ category: 'error', text: 'Cancellation reason is required.' }]);
      return;
    }

    try {
      const res = await ordersAPI.updateSellerOrderStatus(orderId, {
        status: 'rejected',
        reason: rejectionReason,
      });
      const data = res.data || {};
      if (data.success) {
        setRejectionOrderId(null);
        setRejectionReason('');
        loadOrdersData();
        setFlashMessages([{ category: 'success', text: 'Order rejected successfully!' }]);
      } else {
        setFlashMessages([{ category: 'error', text: data.message || 'Failed to reject order' }]);
      }
    } catch (error) {
      setFlashMessages([{ category: 'error', text: 'Failed to reject order' }]);
    }
  };

  const cancelRejection = () => {
    setRejectionOrderId(null);
    setRejectionReason('');
  };

  const sortedSellerOrders = [...sellerOrders].sort((a, b) => {
    const aDate = new Date(a.created_at || 0).getTime();
    const bDate = new Date(b.created_at || 0).getTime();
    return bDate - aDate;
  });

  const getStatusLabel = (status) => {
    const value = (status || 'pending').toString().replace(/_/g, ' ').toLowerCase();
    return value.replace(/\b\w/g, (m) => m.toUpperCase());
  };

  const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const getPaymentMethodLabel = (method) => {
    if (!method) {
      return 'Not specified';
    }

    const normalized = method.toString().trim().toLowerCase();
    const knownMethods = {
      gcash: 'GCash',
      qrph: 'QRPh',
      mobile: 'Mobile Money',
      card: 'Card',
      cash: 'Cash',
      cod: 'Cash on Delivery',
      bank: 'Bank Transfer',
    };

    return knownMethods[normalized] || getStatusLabel(method);
  };

  if (!user || !user.is_farmer) {
    return (
      <div className="farmer-dashboard-page">
        <Navbar />
        <section className="products-page">
          <div className="container">
            <div className="no-products">
              <h3>Become a Seller</h3>
              <p>Start selling on FarmtoClick to access your shop dashboard.</p>
              <Link to="/start-selling" className="btn btn-primary btn-large">
                <i className="fas fa-seedling"></i> Start Selling
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="farmer-dashboard-page">
      <Navbar activePage="myshop" />

      <section className="products-page">
        <div className="container">
          {/* Back to Dashboard */}
          <div style={{ marginBottom: '20px' }}>
            <Link to="/farmer-dashboard" className="btn btn-outline">
              <i className="fas fa-arrow-left"></i> Back to Dashboard
            </Link>
          </div>

          {/* Flash Messages */}
          {flashMessages.length > 0 && (
            <div className="flash-messages">
              {flashMessages.map((message, index) => (
                <div key={index} className={`alert alert-${message.category}`}>
                  {message.text}
                </div>
              ))}
            </div>
          )}

          {/* ORDERS SECTION */}
          <div className="farmer-dashboard-section farmer-orders-section">
            <div className="farmer-section-header">
              <h2 className="farmer-section-title"><i className="fas fa-receipt"></i> Orders for Your Products</h2>
            </div>

            {sortedSellerOrders.length > 0 ? (
              <div className="farmer-orders-layout">
                <div className="farmer-orders-column">
                  <div className="farmer-orders-grid">
                    {sortedSellerOrders.map(order => {
                      const statusValue = (order.status || 'pending').toLowerCase();
                      const statusLabel = getStatusLabel(statusValue);
                      const orderDate = order.created_at ? new Date(order.created_at) : null;
                      const deliveryStatus = order.delivery_status || statusValue;
                      const deliveryUpdatedAt = order.delivery_status_updated_at || order.updated_at || order.created_at;
                      const shippingAddress = order.shipping_address || order.delivery_address;
                      const shippingName = order.shipping_name || order.buyer_name;
                      const shippingPhone = order.shipping_phone || order.buyer_phone;
                      const canAssignRider = statusValue === 'ready_for_ship' && !order.assigned_rider_id;
                      const paymentPending = order.payment_provider === 'paymongo' && order.payment_status !== 'paid';
                      const paymentMethodLabel = getPaymentMethodLabel(order.payment_method);

                      return (
                      <article
                        key={order.id}
                        className={`farmer-order-card ${canAssignRider ? 'can-assign' : ''}`}
                      >
                        <div className="farmer-order-header">
                          <div>
                            <p className="farmer-order-id">Order #{order.id.substring(0, 6).toUpperCase()}</p>
                            {orderDate && (
                              <p className="farmer-order-date">
                                {orderDate.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                              </p>
                            )}
                            <p className="farmer-order-buyer">Buyer: {order.buyer_name} {order.buyer_email && `(${order.buyer_email})`}</p>
                          </div>
                          <div className="farmer-order-status">
                            <span className={`order-status status-${statusValue.replace(' ', '-')}`}>
                              {statusLabel}
                            </span>
                            {paymentPending && (
                              <span className="farmer-order-payment">Awaiting Payment</span>
                            )}
                            {canAssignRider && (
                              <span className="farmer-order-assign-hint">
                                <i className="fas fa-motorcycle"></i> Needs rider
                              </span>
                            )}
                            {assigningOrderId === order.id && (
                              <span className="farmer-order-assigning">Assigning...</span>
                            )}
                          </div>
                        </div>

                        <div className="farmer-order-items" style={{ marginTop: '8px' }}>
                          <p className="farmer-order-items-title">Delivery Status</p>
                          <p style={{ margin: 0 }}>{getStatusLabel(deliveryStatus)}</p>
                          <p style={{ margin: '6px 0 0' }}><strong>Last Update:</strong> {formatDateTime(deliveryUpdatedAt)}</p>
                          {order.delivery_tracking_id && (
                            <p style={{ margin: '6px 0 0' }}><strong>Tracking ID:</strong> {order.delivery_tracking_id.toString().substring(0, 6).toUpperCase()}</p>
                          )}
                        </div>

                        {(shippingName || shippingPhone || shippingAddress || order.delivery_notes) && (
                          <div className="farmer-order-items">
                            <p className="farmer-order-items-title">Shipping Information</p>
                            {shippingName && <p style={{ margin: 0 }}><strong>Recipient:</strong> {shippingName}</p>}
                            {shippingPhone && <p style={{ margin: '6px 0 0' }}><strong>Phone:</strong> {shippingPhone}</p>}
                            {shippingAddress && <p style={{ margin: '6px 0 0' }}><strong>Address:</strong> {[shippingAddress, order.overall_location].filter(Boolean).join(', ')}</p>}
                            {order.delivery_notes && <p style={{ margin: '6px 0 0' }}><strong>Notes:</strong> {order.delivery_notes}</p>}
                          </div>
                        )}

                        <div className="farmer-order-items">
                          <p className="farmer-order-items-title">Payment Method</p>
                          <p style={{ margin: 0 }}>{paymentMethodLabel}</p>
                        </div>

                        {order.assigned_rider_name && (
                          <div className="farmer-order-items">
                            <p className="farmer-order-items-title">Assigned Rider</p>
                            <p style={{ margin: 0 }}><strong>Name:</strong> {order.assigned_rider_name}</p>
                            {order.assigned_rider_phone && (
                              <p style={{ margin: '6px 0 0' }}><strong>Phone:</strong> {order.assigned_rider_phone}</p>
                            )}
                            {(order.assigned_rider_barangay || order.assigned_rider_city || order.assigned_rider_province) && (
                              <p style={{ margin: '6px 0 0' }}>
                                <strong>Area:</strong> {[order.assigned_rider_barangay, order.assigned_rider_city, order.assigned_rider_province].filter(Boolean).join(', ')}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="farmer-order-items">
                          <p className="farmer-order-items-title">Items</p>
                          <ul className="farmer-order-items-list">
                            {(order.items || []).map((item, idx) => (
                              <li key={idx}>{item.name || 'Item'} &times; {item.quantity || 1}</li>
                            ))}
                          </ul>
                        </div>

                        {order.delivery_proof_url && (
                          <div className="farmer-order-items">
                            <p className="farmer-order-items-title">Delivery Proof</p>
                            <a href={order.delivery_proof_url} target="_blank" rel="noreferrer">View photo</a>
                          </div>
                        )}

                        {statusValue === 'pending' && (
                          <div className="farmer-order-actions">
                            <button className="btn btn-primary" onClick={() => updateOrderStatus(order.id, 'approved')}>
                              Approve
                            </button>
                            <button className="btn btn-outline" onClick={() => updateOrderStatus(order.id, 'rejected')}>
                              Reject
                            </button>
                            
                            {rejectionOrderId === order.id && (
                              <div className="cancel-reason" style={{ display: 'block', marginTop: '12px' }}>
                                <label>Cancellation reason</label>
                                <textarea
                                  rows="3"
                                  placeholder="Enter reason for cancellation..."
                                  value={rejectionReason}
                                  onChange={(e) => setRejectionReason(e.target.value)}
                                />
                                <div className="cancel-reason-actions">
                                  <button className="btn btn-primary" onClick={() => submitRejection(order.id)}>Submit</button>
                                  <button className="btn btn-outline" onClick={cancelRejection}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {statusValue === 'approved' && (
                          <div className="farmer-order-actions">
                            <button className="btn btn-primary" onClick={() => updateOrderStatus(order.id, 'ready_for_ship')}>
                              Mark Ready for Ship
                            </button>
                          </div>
                        )}

                        {statusValue === 'ready_for_ship' && (
                          <div className="farmer-order-actions">
                            {canAssignRider && (
                              <>
                                {/* --- Inline Rider Dropdown --- */}
                                <div className="inline-rider-assign">
                                  <button
                                    className="btn btn-rider-inline"
                                    onClick={() => toggleInlineRider(order.id)}
                                  >
                                    <i className="fas fa-motorcycle"></i>{' '}
                                    {inlineRiderOrderId === order.id ? 'Close' : 'Quick Assign'}
                                  </button>

                                  {inlineRiderOrderId === order.id && (
                                    <div className="inline-rider-dropdown">
                                      {riders.length === 0 ? (
                                        <p className="inline-rider-empty">No active riders</p>
                                      ) : (
                                        getRidersForOrder(order, '').slice(0, 5).map((rider) => {
                                          const isMatch = riderMatchesOrder(order, rider);
                                          return (
                                            <button
                                              key={rider.id}
                                              className={`inline-rider-option ${isMatch ? 'is-match' : 'no-match'}`}
                                              onClick={() => assignRiderToOrder(order.id, rider)}
                                              disabled={assigningOrderId === order.id}
                                              title={isMatch ? 'Area match' : 'Area does not match buyer address'}
                                            >
                                              <span className="inline-rider-option-name">{rider.name}</span>
                                              <span className="inline-rider-option-area">
                                                {[rider.barangay, rider.city, rider.province].filter(Boolean).join(', ')}
                                              </span>
                                              {isMatch && <i className="fas fa-check-circle inline-rider-match-icon"></i>}
                                            </button>
                                          );
                                        })
                                      )}
                                      {riders.length > 5 && (
                                        <button
                                          className="inline-rider-see-all"
                                          onClick={() => { setInlineRiderOrderId(null); openRiderModal(order.id); }}
                                        >
                                          See all riders &rarr;
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* --- Full Modal Button --- */}
                                <button
                                  className="btn btn-outline btn-assign-modal"
                                  onClick={() => openRiderModal(order.id)}
                                >
                                  <i className="fas fa-list"></i> Browse Riders
                                </button>
                              </>
                            )}
                            <button className="btn btn-primary" onClick={() => updateOrderStatus(order.id, 'picked_up')}>
                              Mark Picked Up
                            </button>
                          </div>
                        )}

                        {statusValue === 'picked_up' && (
                          <div className="farmer-order-actions">
                            <button className="btn btn-primary" onClick={() => updateOrderStatus(order.id, 'on_the_way')}>
                              Mark On the Way
                            </button>
                          </div>
                        )}

                        {statusValue === 'on_the_way' && (
                          <div className="farmer-order-actions">
                            <button className="btn btn-primary" onClick={() => updateOrderStatus(order.id, 'delivered')}>
                              Mark Delivered
                            </button>
                          </div>
                        )}
                      </article>
                    );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="farmer-orders-empty">
                <i className="fas fa-inbox"></i>
                <h3>No orders yet</h3>
                <p>Orders for your products will appear here.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===============  RIDER ASSIGNMENT MODAL =============== */}
      {riderModalOrderId && (() => {
        const modalOrder = sellerOrders.find((o) => o.id === riderModalOrderId);
        if (!modalOrder) return null;
        const filteredRiders = getRidersForOrder(modalOrder, riderSearchTerm);
        const matchCount = filteredRiders.filter((r) => riderMatchesOrder(modalOrder, r)).length;

        return (
          <div className="rider-modal-overlay" onClick={closeRiderModal}>
            <div className="rider-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rider-modal-header">
                <div>
                  <h2><i className="fas fa-motorcycle"></i> Assign Rider</h2>
                  <p className="rider-modal-subtitle">
                    Order <strong>#{modalOrder.id}</strong> &mdash;{' '}
                    {modalOrder.shipping_address || modalOrder.delivery_address || 'No address'}
                  </p>
                </div>
                <button className="rider-modal-close" onClick={closeRiderModal}>
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {/* Search */}
              <div className="rider-modal-search">
                <i className="fas fa-search"></i>
                <input
                  type="text"
                  placeholder="Search riders by name or area..."
                  value={riderSearchTerm}
                  onChange={(e) => setRiderSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>

              <p className="rider-modal-count">
                {filteredRiders.length} rider{filteredRiders.length !== 1 ? 's' : ''} found
                {matchCount > 0 && (
                  <span className="rider-modal-match-badge">
                    <i className="fas fa-map-marker-alt"></i> {matchCount} area match{matchCount !== 1 ? 'es' : ''}
                  </span>
                )}
              </p>

              {/* Rider list */}
              <div className="rider-modal-list">
                {filteredRiders.length === 0 ? (
                  <div className="rider-modal-empty">
                    <i className="fas fa-user-slash"></i>
                    <p>No riders found{riderSearchTerm ? ` for "${riderSearchTerm}"` : ''}</p>
                  </div>
                ) : (
                  filteredRiders.map((rider) => {
                    const isMatch = riderMatchesOrder(modalOrder, rider);
                    const isAssigning = assigningOrderId === riderModalOrderId && assigningRiderId === rider.id;

                    return (
                      <div
                        key={rider.id}
                        className={`rider-modal-card ${isMatch ? 'is-match' : 'no-match'}`}
                      >
                        <div className="rider-modal-card-info">
                          <p className="rider-modal-card-name">
                            {rider.name}
                            {isMatch && <span className="rider-match-tag"><i className="fas fa-check-circle"></i> Area Match</span>}
                          </p>
                          {rider.phone && <p className="rider-modal-card-detail"><i className="fas fa-phone"></i> {rider.phone}</p>}
                          <p className="rider-modal-card-detail">
                            <i className="fas fa-map-marker-alt"></i>{' '}
                            {[rider.barangay, rider.city, rider.province].filter(Boolean).join(', ') || 'No area info'}
                          </p>
                        </div>
                        <button
                          className={`btn btn-primary btn-assign`}
                          onClick={() => assignRiderToOrder(riderModalOrderId, rider)}
                          disabled={isAssigning}
                          title={isMatch ? 'Area match' : 'Assign this rider'}
                        >
                          {isAssigning ? (
                            <><i className="fas fa-spinner fa-spin"></i> Assigning...</>
                          ) : (
                            <><i className="fas fa-user-plus"></i> Assign</>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <Footer />
    </div>
  );
};

export default FarmerOrders;
