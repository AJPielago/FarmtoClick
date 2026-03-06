import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { cartAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const ProfileField = ({ id, label, value, type = 'text', profilePath }) => (
  <div className="ct-field">
    <label className="ct-field-label" htmlFor={id}>{label}</label>
    {value ? (
      <input id={id} type={type} readOnly value={value} className="ct-input ct-input--readonly" />
    ) : (
      <div className="ct-missing-field">
        <i className="fas fa-exclamation-triangle"></i>
        Please add your {label.toLowerCase()} in your{' '}
        <Link to={profilePath || '/profile'} className="ct-missing-link">profile page</Link>
      </div>
    )}
  </div>
);

const Cart = () => {
  const { user } = useAuth();
  const { refreshCartCount, setCartCount } = useCart();
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('primary');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);

  useEffect(() => {
    if (user) {
      loadCart(true);
    } else {
      setIsLoading(false);
    }
  }, [user]);

  // Clear the badge whenever the cart page is opened
  useEffect(() => {
    setCartCount(0);
  }, [setCartCount]);

  const loadCart = async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      const response = await cartAPI.getCart();
      const items = response.data.items || [];
      setCartItems(items);
      
      // Select all items by default if none are selected and it's the initial load
      if (showLoading && items.length > 0) {
        setSelectedItems(items.map(item => item.product?.id));
      }
    } catch (error) {
      console.error('Error loading cart:', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  const updateQuantity = async (productId, newQuantity) => {
    if (newQuantity < 1) return;
    
    // Optimistic update
    setCartItems(prevItems => 
      prevItems.map(item => 
        item.product?.id === productId ? { ...item, quantity: newQuantity } : item
      )
    );

    try {
      await cartAPI.updateQuantity(productId, newQuantity);
      loadCart(false);
      refreshCartCount();
    } catch (error) {
      loadCart(false);
      setFlashMessages([{ category: 'error', text: error.response?.data?.message || 'Error updating cart' }]);
    }
  };

  const removeItem = async (productId) => {
    if (!window.confirm('Remove this item from cart?')) return;
    
    // Optimistic update
    setCartItems(prevItems => prevItems.filter(item => item.product?.id !== productId));
    setSelectedItems(prev => prev.filter(id => id !== productId));

    try {
      await cartAPI.removeItem(productId);
      loadCart(false);
      refreshCartCount();
    } catch (error) {
      loadCart(false);
      setFlashMessages([{ category: 'error', text: 'Error removing item. Please try again.' }]);
    }
  };

  const handleSelectItem = (productId) => {
    setSelectedItems(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const handleSelectAll = () => {
    if (selectedItems.length === cartItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(cartItems.map(item => item.product?.id));
    }
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (selectedItems.length === 0) {
      setFlashMessages([{ category: 'error', text: 'Please select at least one item to checkout' }]);
      return;
    }
    if (!paymentMethod) {
      setFlashMessages([{ category: 'error', text: 'Please select a payment method' }]);
      return;
    }
    if (!user?.shipping_address && !user?.shipping_address_2) {
      setFlashMessages([{ category: 'error', text: 'Please add your shipping address in your profile' }]);
      return;
    }
    const useAddress = selectedAddress === 'secondary' ? user.shipping_address_2 : user.shipping_address;
    const useLocation = selectedAddress === 'secondary' ? (user.overall_location_2 || '') : (user.overall_location || '');
    if (!useAddress) {
      setFlashMessages([{ category: 'error', text: 'Please select a valid shipping address' }]);
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await cartAPI.checkout({
        shipping_name: `${user.first_name} ${user.last_name}`,
        shipping_phone: user.phone,
        shipping_address: useAddress,
        overall_location: useLocation,
        payment_method: paymentMethod,
        selected_items: selectedItems,
      });
      const checkoutUrl = response?.data?.checkout_url;
      if (checkoutUrl) {
        const orderId = response?.data?.order?._id || response?.data?.order?.id;
        if (orderId) {
          localStorage.setItem('paymongoPendingOrder', orderId);
        }
        window.location.href = checkoutUrl;
        return;
      }
      setFlashMessages([{ category: 'success', text: 'Order placed successfully! Redirecting...' }]);
      setTimeout(() => navigate('/orders'), 2000);
    } catch (error) {
      setFlashMessages([{ category: 'error', text: error.response?.data?.message || 'Checkout failed. Please try again.' }]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCartItems = cartItems.filter(item => selectedItems.includes(item.product?.id));
  const total = selectedCartItems.reduce((sum, item) => sum + (item.product?.price || 0) * (item.quantity || 0), 0);
  const itemCount = selectedCartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

  let discountRate = 0;
  if (itemCount >= 20) discountRate = 0.15;
  else if (itemCount >= 10) discountRate = 0.10;
  else if (itemCount >= 5) discountRate = 0.05;

  const discountAmount = total * discountRate;
  const subtotal = total - discountAmount;

  const calculateShippingFee = (address) => {
    if (!address) return 39.0;
    let h = 0;
    for (let i = 0; i < address.length; i++) {
      h = ((h << 5) - h) + address.charCodeAt(i);
      h |= 0;
    }
    const hashVal = Math.abs(h);
    const distance = 1.0 + (hashVal % 50);
    let fee = 39.0 + Math.max(0, distance - 5) * 1.0;
    if (fee > 80.0) fee = 80.0;
    return fee;
  };

  const shippingAddress = selectedAddress === 'secondary'
    ? [user?.shipping_address_2, user?.overall_location_2].filter(Boolean).join(', ')
    : [user?.shipping_address, user?.overall_location].filter(Boolean).join(', ');
  const shippingFee = calculateShippingFee(shippingAddress);
  const finalTotal = subtotal + shippingFee;

  const dismissFlash = (i) => setFlashMessages(prev => prev.filter((_, idx) => idx !== i));

  if (!user) {
    return (
      <div className="ct-page">
        <Navbar />
        <div className="ct-hero">
          <div className="ct-hero-inner">
            <div className="ct-hero-text">
              <h1><i className="fas fa-shopping-basket"></i> My Cart</h1>
              <p>Review your items and proceed to checkout.</p>
            </div>
          </div>
        </div>
        <div className="ct-body">
          <div className="ct-empty">
            <i className="fas fa-lock"></i>
            <h3>Please Login</h3>
            <p>You need to be logged in to view your cart.</p>
            <Link to="/login" className="ct-btn ct-btn--primary"><i className="fas fa-sign-in-alt"></i> Login Now</Link>
          </div>
        </div>
        <CartStyles />
      </div>
    );
  }

  return (
    <div className="ct-page">
      <Navbar />

      {/* Hero */}
      <div className="ct-hero">
        <div className="ct-hero-inner">
          <div className="ct-hero-text">
            <h1><i className="fas fa-shopping-basket"></i> My Cart</h1>
            <p>Review your items and proceed to checkout.</p>
          </div>
          <div className="ct-hero-stats">
            <div className="ct-stat">
              <div className="ct-stat-val">{cartItems.length}</div>
              <div className="ct-stat-lbl">Products</div>
            </div>
            <div className="ct-stat">
              <div className="ct-stat-val">{itemCount}</div>
              <div className="ct-stat-lbl">Items</div>
            </div>
            <div className="ct-stat">
              <div className="ct-stat-val">₱{total.toFixed(0)}</div>
              <div className="ct-stat-lbl">Subtotal</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ct-body">
        {/* Flash messages */}
        {flashMessages.length > 0 && (
          <div className="ct-flashes">
            {flashMessages.map((msg, i) => (
              <div key={i} className={`ct-flash ct-flash--${msg.category}`}>
                <i className={`fas ${msg.category === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`}></i>
                <span>{msg.text}</span>
                <button className="ct-flash-close" onClick={() => dismissFlash(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="ct-loading"><i className="fas fa-spinner fa-spin"></i> Loading cart…</div>
        ) : cartItems.length === 0 ? (
          <div className="ct-empty">
            <i className="fas fa-shopping-cart"></i>
            <h3>Your cart is empty</h3>
            <p>Browse our fresh produce and add items to get started.</p>
            <Link to="/products" className="ct-btn ct-btn--primary"><i className="fas fa-store"></i> Browse Products</Link>
          </div>
        ) : (
          <div className="ct-layout">
            {/* Cart items */}
            <div className="ct-items-col">
              <div className="ct-select-all">
                <label className="ct-checkbox-label">
                  <input 
                    type="checkbox" 
                    checked={selectedItems.length === cartItems.length && cartItems.length > 0}
                    onChange={handleSelectAll}
                  />
                  <span>Select All ({cartItems.length} items)</span>
                </label>
              </div>
              {cartItems.map(item => (
                <div key={item.product?.id} className="ct-item">
                  <div className="ct-item-checkbox">
                    <input 
                      type="checkbox" 
                      checked={selectedItems.includes(item.product?.id)}
                      onChange={() => handleSelectItem(item.product?.id)}
                    />
                  </div>
                  <div className="ct-item-img">
                    {item.product?.image_url
                      ? <img src={item.product.image_url} alt={item.product?.name} />
                      : <div className="ct-item-placeholder"><i className="fas fa-leaf"></i></div>
                    }
                  </div>
                  <div className="ct-item-info">
                    <Link to={`/product/${item.product?.id}`} className="ct-item-name">{item.product?.name}</Link>
                    {item.product?.farmer && (
                      <p className="ct-item-farmer">
                        <i className="fas fa-store"></i>{' '}
                        {item.product.farmer.farm_name || item.product.farmer.full_name}
                      </p>
                    )}
                    <p className="ct-item-unit-price">₱{(item.product?.price || 0).toFixed(2)} / {item.product?.unit}</p>
                  </div>
                  <div className="ct-item-qty">
                    <button className="ct-qty-btn" onClick={() => updateQuantity(item.product?.id, item.quantity - 1)}>−</button>
                    <span className="ct-qty-val">{item.quantity}</span>
                    <button className="ct-qty-btn" onClick={() => updateQuantity(item.product?.id, item.quantity + 1)}>+</button>
                  </div>
                  <div className="ct-item-subtotal">
                    <span className="ct-item-subtotal-lbl">Subtotal</span>
                    <span className="ct-item-subtotal-val">₱{((item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                  </div>
                  <button className="ct-remove-btn" title="Remove item" onClick={() => removeItem(item.product?.id)}>
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              ))}

              <Link to="/products" className="ct-continue-link">
                <i className="fas fa-arrow-left"></i> Continue Shopping
              </Link>
            </div>

            {/* Order summary + checkout */}
            <aside className="ct-summary">
              <div className="ct-summary-head">
                <h3><i className="fas fa-receipt"></i> Order Summary</h3>
              </div>
              <div className="ct-summary-body">
                <div className="ct-summary-line">
                  <span>Subtotal ({itemCount} item{itemCount !== 1 ? 's' : ''})</span>
                  <span>₱{total.toFixed(2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="ct-summary-line ct-discount">
                    <span>Bulk Discount ({(discountRate * 100).toFixed(0)}%)</span>
                    <span>-₱{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="ct-summary-line">
                  <span>Delivery Fee</span>
                  <span>₱{shippingFee.toFixed(2)}</span>
                </div>
                <div className="ct-summary-divider"></div>
                <div className="ct-summary-line ct-summary-total">
                  <span>Estimated Total</span>
                  <span>₱{finalTotal.toFixed(2)}</span>
                </div>
              </div>

              <form onSubmit={handleCheckout} className="ct-checkout-form">
                <div className="ct-form-section-label">Shipping Details</div>

                <ProfileField
                  id="ct_name"
                  label="Full Name"
                  value={user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : ''}
                />
                <ProfileField
                  id="ct_phone"
                  label="Phone"
                  type="tel"
                  value={user.phone}
                />

                {/* Address Selection */}
                {user.shipping_address && user.shipping_address_2 ? (
                  <div className="ct-field">
                    <label className="ct-field-label">Shipping Address</label>
                    <div
                      className={`ct-address-option${selectedAddress === 'primary' ? ' ct-address-option--selected' : ''}`}
                      onClick={() => setSelectedAddress('primary')}
                      style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: '10px', border: selectedAddress === 'primary' ? '2px solid #2c7a2c' : '1px solid #e2e8f0', background: selectedAddress === 'primary' ? '#f0fdf4' : '#fff', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}
                    >
                      <input type="radio" name="address" checked={selectedAddress === 'primary'} onChange={() => setSelectedAddress('primary')} style={{ accentColor: '#2c7a2c' }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#2c7a2c', marginBottom: '2px' }}>Primary Address</div>
                        <div style={{ fontSize: '0.85rem', color: '#374151' }}>{[user.shipping_address, user.overall_location].filter(Boolean).join(', ')}</div>
                      </div>
                    </div>
                    <div
                      className={`ct-address-option${selectedAddress === 'secondary' ? ' ct-address-option--selected' : ''}`}
                      onClick={() => setSelectedAddress('secondary')}
                      style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: '10px', border: selectedAddress === 'secondary' ? '2px solid #2c7a2c' : '1px solid #e2e8f0', background: selectedAddress === 'secondary' ? '#f0fdf4' : '#fff', display: 'flex', alignItems: 'center', gap: '10px' }}
                    >
                      <input type="radio" name="address" checked={selectedAddress === 'secondary'} onChange={() => setSelectedAddress('secondary')} style={{ accentColor: '#2c7a2c' }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#2c7a2c', marginBottom: '2px' }}>Secondary Address</div>
                        <div style={{ fontSize: '0.85rem', color: '#374151' }}>{[user.shipping_address_2, user.overall_location_2].filter(Boolean).join(', ')}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ProfileField
                    id="ct_address"
                    label="Exact Location"
                    value={[user.shipping_address || user.shipping_address_2, user.overall_location || user.overall_location_2].filter(Boolean).join(', ')}
                  />
                )}

                <div className="ct-form-section-label" style={{ marginTop: '18px' }}>Payment</div>
                <div className="ct-field">
                  <label className="ct-field-label" htmlFor="ct_payment">Payment Method</label>
                  <select
                    id="ct_payment"
                    className="ct-select"
                    required
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="" disabled>Select payment method</option>
                    <option value="cash">Cash on Delivery</option>
                    <option value="card">Card</option>
                    <option value="mobile">Mobile Money</option>
                  </select>
                </div>

                <button type="submit" className="ct-btn ct-btn--checkout" disabled={isSubmitting}>
                  {isSubmitting
                    ? <><i className="fas fa-spinner fa-spin"></i> Processing…</>
                    : <><i className="fas fa-lock"></i> Proceed to Checkout</>
                  }
                </button>
              </form>
            </aside>
          </div>
        )}
      </div>

      <Footer />

      <CartStyles />
    </div>
  );
};

const CartStyles = () => (
  <style>{`
    .ct-page {
      min-height: 100vh;
      background: radial-gradient(circle at top left, #e8f5e9 0%, #f4f6f9 45%, #fefcfb 100%);
      font-family: "Space Grotesk", "Segoe UI", sans-serif;
      display: flex;
      flex-direction: column;
    }

    /* ── Hero ── */
    .ct-hero {
      background: linear-gradient(135deg, #1a5f1a 0%, #2c7a2c 60%, #38a03a 100%);
      padding: 32px 0 28px;
      color: #fff;
    }
    .ct-hero-inner {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .ct-hero-text h1 {
      margin: 0 0 6px;
      font-size: 1.75rem;
      font-weight: 800;
      color: #fff;
    }
    .ct-hero-text h1 i { margin-right: 10px; }
    .ct-hero-text p {
      margin: 0;
      font-size: 0.95rem;
      color: rgba(255,255,255,0.82);
    }
    .ct-hero-stats { display: flex; gap: 14px; flex-wrap: wrap; }
    .ct-stat {
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 12px;
      padding: 12px 20px;
      text-align: center;
      min-width: 72px;
    }
    .ct-stat-val { font-size: 1.5rem; font-weight: 800; color: #fff; line-height: 1; }
    .ct-stat-lbl { font-size: 0.7rem; color: rgba(255,255,255,0.75); margin-top: 4px; text-transform: uppercase; letter-spacing: .06em; }

    /* ── Body ── */
    .ct-body {
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 24px 60px;
      width: 100%;
      box-sizing: border-box;
      flex: 1;
    }

    /* ── Flash ── */
    .ct-flashes { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .ct-flash {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 500;
    }
    .ct-flash--success { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
    .ct-flash--error   { background: #fee2e2; color: #7f1d1d; border: 1px solid #fca5a5; }
    .ct-flash--info    { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }
    .ct-flash span { flex: 1; }
    .ct-flash-close { background: transparent; border: none; font-size: 1.1rem; cursor: pointer; color: inherit; opacity: 0.6; line-height: 1; margin-left: auto; }
    .ct-flash-close:hover { opacity: 1; }

    /* ── Loading / Empty ── */
    .ct-loading { text-align: center; padding: 60px 20px; color: #64748b; font-size: 1rem; }
    .ct-loading i { margin-right: 8px; color: #2c7a2c; }
    .ct-empty { text-align: center; padding: 80px 20px; color: #94a3b8; }
    .ct-empty i { font-size: 3.5rem; margin-bottom: 16px; display: block; }
    .ct-empty h3 { font-size: 1.3rem; color: #475569; margin: 0 0 8px; }
    .ct-empty p  { margin: 0 0 20px; font-size: 0.9rem; }

    /* ── Layout ── */
    .ct-layout {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 22px;
      align-items: start;
    }

    /* ── Cart item ── */
    .ct-items-col { display: flex; flex-direction: column; gap: 12px; }
    .ct-item {
      background: #fff;
      border-radius: 14px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 4px 16px rgba(15,23,42,0.06);
      border: 1px solid rgba(15,23,42,0.06);
      transition: box-shadow 0.2s, transform 0.15s;
    }
    .ct-item:hover { box-shadow: 0 6px 24px rgba(15,23,42,0.09); transform: translateY(-1px); }
    .ct-item-checkbox {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ct-item-checkbox input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #2c7a2c;
    }
    .ct-select-all {
      padding: 0 10px 12px;
      display: flex;
      align-items: center;
    }
    .ct-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-weight: 600;
      color: #374151;
      font-size: 0.9rem;
    }
    .ct-checkbox-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: #2c7a2c;
    }
    .ct-item-img {
      width: 72px;
      height: 72px;
      border-radius: 10px;
      overflow: hidden;
      flex-shrink: 0;
      background: #f0fdf4;
      border: 1px solid #d1fae5;
    }
    .ct-item-img img { width: 100%; height: 100%; object-fit: cover; }
    .ct-item-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #86efac; font-size: 1.6rem; }
    .ct-item-info { flex: 1; min-width: 0; }
    .ct-item-name {
      font-weight: 700;
      font-size: 0.95rem;
      color: #111827;
      text-decoration: none;
      display: block;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ct-item-name:hover { color: #2c7a2c; }
    .ct-item-farmer { margin: 0 0 3px; font-size: 0.78rem; color: #64748b; }
    .ct-item-farmer i { margin-right: 4px; color: #86efac; }
    .ct-item-unit-price { margin: 0; font-size: 0.82rem; color: #94a3b8; }

    /* Quantity controls */
    .ct-item-qty {
      display: flex;
      align-items: center;
      gap: 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    .ct-qty-btn {
      width: 32px;
      height: 32px;
      background: #f8fafc;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: #374151;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .ct-qty-btn:hover { background: #e8f5e9; color: #2c7a2c; }
    .ct-qty-val {
      min-width: 36px;
      text-align: center;
      font-weight: 700;
      font-size: 0.9rem;
      color: #111827;
      padding: 0 4px;
    }

    /* Subtotal */
    .ct-item-subtotal { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 80px; }
    .ct-item-subtotal-lbl { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
    .ct-item-subtotal-val { font-weight: 800; font-size: 0.95rem; color: #111827; }

    /* Remove */
    .ct-remove-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #f87171;
      font-size: 0.9rem;
      padding: 8px;
      border-radius: 8px;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    .ct-remove-btn:hover { background: #fee2e2; color: #dc2626; }

    /* Continue link */
    .ct-continue-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #2c7a2c;
      text-decoration: none;
      padding: 10px 0 2px;
    }
    .ct-continue-link:hover { text-decoration: underline; }

    /* ── Summary panel ── */
    .ct-summary {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 28px rgba(15,23,42,0.08);
      border: 1px solid rgba(15,23,42,0.07);
      overflow: hidden;
      position: sticky;
      top: 20px;
    }
    .ct-summary-head {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      padding: 16px 20px;
      border-bottom: 1px solid #d1fae5;
    }
    .ct-summary-head h3 { margin: 0; font-size: 1.05rem; color: #14532d; font-weight: 800; }
    .ct-summary-head h3 i { margin-right: 8px; }
    .ct-summary-body { padding: 16px 20px; }
    .ct-summary-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.88rem;
      color: #374151;
      padding: 6px 0;
    }
    .ct-discount { color: #16a34a; font-weight: 600; }
    .ct-muted { color: #94a3b8; font-style: italic; font-size: 0.8rem; }
    .ct-summary-divider { height: 1px; background: #f1f5f9; margin: 10px 0; }
    .ct-summary-total { font-weight: 800; font-size: 1rem; color: #111827; padding-top: 8px; }

    /* ── Checkout form ── */
    .ct-checkout-form { padding: 0 20px 20px; display: flex; flex-direction: column; gap: 10px; }
    .ct-form-section-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #2c7a2c;
      margin-top: 6px;
      margin-bottom: 2px;
    }
    .ct-field { display: flex; flex-direction: column; gap: 5px; }
    .ct-field-label { font-size: 0.82rem; font-weight: 600; color: #374151; }
    .ct-input {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      font-size: 0.88rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .ct-input:focus { border-color: #2c7a2c; box-shadow: 0 0 0 3px rgba(44,122,44,0.08); }
    .ct-input--readonly { background: #f8fafc; color: #374151; }
    .ct-select {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      font-size: 0.88rem;
      font-family: inherit;
      background: #fff;
      cursor: pointer;
      outline: none;
    }
    .ct-select:focus { border-color: #2c7a2c; }
    .ct-missing-field {
      padding: 10px 12px;
      border-radius: 10px;
      border: 2px solid #fca5a5;
      background: #fff1f2;
      color: #dc2626;
      font-size: 0.83rem;
      font-weight: 500;
    }
    .ct-missing-field i { margin-right: 6px; }
    .ct-missing-link { color: #dc2626; font-weight: 700; }

    /* Buttons */
    .ct-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      border: none;
      text-decoration: none;
      font-family: inherit;
      transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    }
    .ct-btn--primary { background: #2c7a2c; color: #fff; }
    .ct-btn--primary:hover { background: #1a5c1a; transform: translateY(-1px); }
    .ct-btn--checkout {
      background: linear-gradient(135deg, #1a5f1a 0%, #2c7a2c 100%);
      color: #fff;
      padding: 13px 20px;
      font-size: 0.95rem;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(44,122,44,0.25);
      margin-top: 6px;
    }
    .ct-btn--checkout:hover:not(:disabled) { box-shadow: 0 6px 20px rgba(44,122,44,0.35); transform: translateY(-1px); }
    .ct-btn--checkout:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

    @media (max-width: 900px) {
      .ct-layout { grid-template-columns: 1fr; }
      .ct-summary { position: static; }
    }
    @media (max-width: 640px) {
      .ct-hero-inner { flex-direction: column; align-items: flex-start; }
      .ct-hero-stats { width: 100%; }
      .ct-stat { flex: 1; }
      .ct-item { flex-wrap: wrap; }
      .ct-item-subtotal { align-items: flex-start; }
    }
  `}</style>
);

export default Cart;