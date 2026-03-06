import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';

const Orders = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [trackingLoading, setTrackingLoading] = useState({});
  const [confirmLoading, setConfirmLoading] = useState({});

  useEffect(() => {
    if (user) {
      loadOrders();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const pendingOrderId = localStorage.getItem('paymongoPendingOrder');
    if (!pendingOrderId) return;
    ordersAPI.confirmPaymongo(pendingOrderId).then((res) => {
      if (res.data?.status === 'paid') {
        localStorage.removeItem('paymongoPendingOrder');
        loadOrders();
      }
    }).catch(() => {
    });
  }, [user]);

  const loadOrders = async () => {
    try {
      setIsLoading(true);
      const response = await ordersAPI.getOrders();
      setOrders(response.data || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleOrder = (orderId) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const getStatusClass = (status) => {
    const statusLower = (status || 'pending').toLowerCase().replace(/[_\s]+/g, '-');
    return `status-${statusLower}`;
  };

  const getStatusLabel = (status) => {
    const value = (status || 'pending').toString().replace(/_/g, ' ').toLowerCase();
    return value.replace(/\b\w/g, (m) => m.toUpperCase());
  };

  const formatTrackingDate = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const getPaymentLabel = (method) => {
    const map = { cash: 'Cash on Delivery', card: 'Card', mobile: 'Mobile Money', gcash: 'GCash' };
    const key = (method || '').toLowerCase();
    return map[key] || (method ? method.charAt(0).toUpperCase() + method.slice(1) : '');
  };

  const formatShortId = (value) => {
    if (!value) return '';
    const text = String(value);
    return text.slice(0, 6);
  };

  const refreshTracking = async (orderId) => {
    try {
      setTrackingLoading(prev => ({ ...prev, [orderId]: true }));
      const res = await ordersAPI.getOrderTracking(orderId);
      const tracking = res.data || {};
      setOrders(prev => prev.map(order => {
        const id = order._id || order.id;
        if (id !== orderId) return order;
        return {
          ...order,
          delivery_status: tracking.delivery_status,
          delivery_tracking_id: tracking.delivery_tracking_id,
          delivery_updates: tracking.delivery_updates || order.delivery_updates,
          logistics_provider: tracking.logistics_provider || order.logistics_provider,
        };
      }));
    } catch (error) {
      console.error('Error refreshing tracking:', error);
    } finally {
      setTrackingLoading(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const confirmPaymongoPayment = async (orderId) => {
    try {
      setConfirmLoading(prev => ({ ...prev, [orderId]: true }));
      const res = await ordersAPI.confirmPaymongo(orderId);
      if (res.data?.status === 'paid') {
        await loadOrders();
      }
    } catch (error) {
      console.error('Error confirming payment:', error);
    } finally {
      setConfirmLoading(prev => ({ ...prev, [orderId]: false }));
    }
  };

  if (!user) {
    return (
      <div className="orders-page">
        <Navbar />
        <div className="orders-hero">
          <div className="orders-hero-inner">
            <div>
              <h1><i className="fas fa-box-open"></i> My Orders</h1>
              <p>Track and manage your purchases</p>
            </div>
          </div>
        </div>
        <div className="orders-body">
          <div className="orders-empty">
            <i className="fas fa-user-lock"></i>
            <h3>Please Log In</h3>
            <p>You need to be logged in to view your orders.</p>
            <Link to="/login" className="ord-btn ord-btn--primary">Log In Now</Link>
          </div>
        </div>
      </div>
    );
  }

  const pendingCount  = orders.filter(o => (o.status || '').toLowerCase().includes('pending')).length;
  const deliveredCount = orders.filter(o => (o.status || '').toLowerCase() === 'delivered').length;

  return (
    <div className="orders-page">
      <Navbar />

      {/* Hero Banner */}
      <div className="orders-hero">
        <div className="orders-hero-inner">
          <div>
            <h1><i className="fas fa-box-open"></i> My Orders</h1>
            <p>Track and manage all your purchases</p>
          </div>
          {!isLoading && (
            <div className="orders-hero-stats">
              <div className="orders-stat">
                <span className="orders-stat-num">{orders.length}</span>
                <span className="orders-stat-label">Total</span>
              </div>
              <div className="orders-stat">
                <span className="orders-stat-num">{pendingCount}</span>
                <span className="orders-stat-label">Pending</span>
              </div>
              <div className="orders-stat">
                <span className="orders-stat-num">{deliveredCount}</span>
                <span className="orders-stat-label">Delivered</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Orders Body */}
      <div className="orders-body">
        {isLoading ? (
          <div className="orders-loading"><i className="fas fa-spinner fa-spin"></i> Loading your orders…</div>
        ) : orders.length > 0 ? (
          <div className="orders-list">
            {orders.map(order => {
              const orderId = order._id || order.id;
              const isExpanded = expandedOrders[orderId];
              const itemsPreview = (order.items || []).slice(0, 3).map(i => i.product_name || i.name).filter(Boolean).join(', ');
              const moreItems = (order.items || []).length > 3 ? ` +${order.items.length - 3} more` : '';

              return (
                <article key={orderId} className={`ord-card${isExpanded ? ' ord-card--open' : ''}`}>

                  {/* Always-visible summary bar */}
                  <div
                    className={`ord-summary ord-accent-${getStatusClass(order.status)}`}
                    onClick={() => toggleOrder(orderId)}
                  >
                    <div className="ord-left">
                      <span className="ord-num">#{order.order_number || formatShortId(orderId).toUpperCase()}</span>
                      <span className="ord-date">
                        {order.created_at
                          ? new Date(order.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Date unknown'}
                      </span>
                    </div>

                    <div className="ord-middle">
                      {itemsPreview && (
                        <span className="ord-items-preview">
                          <i className="fas fa-shopping-basket"></i> {itemsPreview}{moreItems}
                        </span>
                      )}
                    </div>

                    <div className="ord-right">
                      <span className={`ord-badge ${getStatusClass(order.status)}`}>{getStatusLabel(order.status)}</span>
                      <span className="ord-total">₱{(order.total_amount || 0).toFixed(2)}</span>
                    </div>

                    <div className="ord-chevron">
                      <i className={`fas fa-chevron-down${isExpanded ? ' rotated' : ''}`}></i>
                    </div>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="ord-details">
                      <div className="ord-details-cols">

                        {/* Column 1 — Delivery Info */}
                        <div className="ord-details-col">
                          <p className="ord-col-title"><i className="fas fa-map-marker-alt"></i> Delivery Info</p>
                          {order.shipping_name && <div className="ord-detail-row"><span className="od-label">Recipient</span><span>{order.shipping_name}</span></div>}
                          {order.shipping_phone && <div className="ord-detail-row"><span className="od-label">Phone</span><span>{order.shipping_phone}</span></div>}
                          {(order.shipping_address || order.delivery_address) && <div className="ord-detail-row"><span className="od-label">Address</span><span>{[order.shipping_address || order.delivery_address, order.overall_location].filter(Boolean).join(', ')}</span></div>}
                          {order.delivery_notes && <div className="ord-detail-row"><span className="od-label">Notes</span><span>{order.delivery_notes}</span></div>}
                          {order.payment_method && <div className="ord-detail-row"><span className="od-label">Payment</span><span>{getPaymentLabel(order.payment_method)}</span></div>}
                          {orderId && (
                            <div className="ord-detail-row">
                              <span className="od-label">Order ID</span>
                              <span style={{ fontSize: '.78rem', wordBreak: 'break-all' }} title={orderId}>
                                {formatShortId(orderId)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Column 2 — Tracking */}
                        <div className="ord-details-col">
                          <p className="ord-col-title"><i className="fas fa-truck"></i> Tracking</p>
                          <div className="ord-detail-row"><span className="od-label">Status</span><span>{getStatusLabel(order.delivery_status || order.status)}</span></div>
                          {order.delivery_tracking_id && (
                            <div className="ord-detail-row">
                              <span className="od-label">Tracking ID</span>
                              <span title={order.delivery_tracking_id}>
                                {formatShortId(order.delivery_tracking_id)}
                              </span>
                            </div>
                          )}
                          {order.assigned_rider_name && <div className="ord-detail-row"><span className="od-label">Courier</span><span>{order.assigned_rider_name}</span></div>}
                          {order.assigned_rider_phone && <div className="ord-detail-row"><span className="od-label">Rider Phone</span><span>{order.assigned_rider_phone}</span></div>}
                          {order.delivery_proof_url && (
                            <div className="ord-detail-row">
                              <span className="od-label">Proof</span>
                              <span><a href={order.delivery_proof_url} target="_blank" rel="noreferrer">View photo ↗</a></span>
                            </div>
                          )}
                          
                          {/* Live GPS Tracking Map */}
                          {(order.status === 'on_the_way' || order.delivery_status === 'on_the_way') && (
                            <div className="mt-4 mb-4">
                              <DeliveryTrackingMap 
                                orderId={orderId} 
                                destinationAddress={order.shipping_address || order.delivery_address || ''} 
                              />
                            </div>
                          )}

                          {order.delivery_updates && order.delivery_updates.length > 0 && (
                            <div className="ord-updates">
                              {order.delivery_updates.map((u, i) => (
                                <div key={i} className="ord-update-item">
                                  <span className="ord-update-dot"></span>
                                  <span>{getStatusLabel(u.status || order.delivery_status || order.status)}</span>
                                  <span className="ord-update-time">
                                    {formatTrackingDate(u.updated_at || u.timestamp || u.time)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Column 3 — Items */}
                        <div className="ord-details-col">
                          <p className="ord-col-title"><i className="fas fa-list-ul"></i> Order Items</p>
                          {(order.items || []).map((item, idx) => {
                            const qty   = item.quantity || 1;
                            const price = item.price || 0;
                            const isDelivered = (order.delivery_status || order.status || '').toLowerCase() === 'delivered';
                            const itemProductId = item.product_id || item.id;
                            return (
                              <div key={idx} className="ord-item-row">
                                <span className="ord-item-name">{item.product_name || item.name || 'Item'}</span>
                                <span className="ord-item-qty">×{qty}</span>
                                <span className="ord-item-price">₱{(price * qty).toFixed(2)}</span>
                                {isDelivered && itemProductId && (
                                  <Link
                                    to={`/product/${itemProductId}`}
                                    className="ord-btn ord-btn--outline"
                                    style={{ marginLeft: 8, padding: '4px 8px', fontSize: '.75rem' }}
                                    title="Review this product"
                                  >
                                    Review
                                  </Link>
                                )}
                              </div>
                            );
                          })}
                          
                          {order.subtotal && (
                            <div className="ord-items-subtotal" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6b7280', marginTop: '8px' }}>
                              <span>Subtotal</span>
                              <span>₱{(order.subtotal || 0).toFixed(2)}</span>
                            </div>
                          )}
                          
                          {order.discount_amount > 0 && (
                            <div className="ord-items-discount" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#16a34a' }}>
                              <span>Discount ({(order.discount_rate * 100).toFixed(0)}%)</span>
                              <span>-₱{(order.discount_amount || 0).toFixed(2)}</span>
                            </div>
                          )}
                          
                          {order.shipping_fee > 0 && (
                            <div className="ord-items-shipping" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6b7280' }}>
                              <span>Shipping Fee</span>
                              <span>₱{(order.shipping_fee || 0).toFixed(2)}</span>
                            </div>
                          )}
                          
                          <div className="ord-items-total">
                            <span>Total</span>
                            <span>₱{(order.total_amount || 0).toFixed(2)}</span>
                          </div>
                        </div>

                      </div>{/* /cols */}

                      {/* Actions */}
                      <div className="ord-actions">
                        <button
                          type="button"
                          className="ord-btn ord-btn--outline"
                          onClick={() => refreshTracking(orderId)}
                          disabled={trackingLoading[orderId]}
                        >
                          <i className="fas fa-sync-alt"></i>
                          {trackingLoading[orderId] ? 'Refreshing…' : 'Refresh Tracking'}
                        </button>
                        {order.payment_provider === 'paymongo' && order.payment_status !== 'paid' && (
                          <button
                            type="button"
                            className="ord-btn ord-btn--primary"
                            onClick={() => confirmPaymongoPayment(orderId)}
                            disabled={confirmLoading[orderId]}
                          >
                            <i className="fas fa-check-circle"></i>
                            {confirmLoading[orderId] ? 'Verifying…' : 'Verify Payment'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                </article>
              );
            })}
          </div>
        ) : (
          <div className="orders-empty">
            <i className="fas fa-box-open"></i>
            <h3>No orders yet</h3>
            <p>When you place an order, it'll show up here.</p>
            <Link to="/products" className="ord-btn ord-btn--primary">Browse Products</Link>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};

export default Orders;