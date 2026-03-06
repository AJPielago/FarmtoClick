import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import NotificationsDropdown from './NotificationsDropdown';
import { notificationsAPI } from '../services/api';

const Navbar = ({ activePage }) => {
    const [hideHeader, setHideHeader] = useState(false);
    const [stickyNav, setStickyNav] = useState(false);

    // Hide main-header on scroll, show at top; stick navbar and logo
    useEffect(() => {
      const handleScroll = () => {
        if (window.scrollY > 30) {
          setHideHeader(true);
          setStickyNav(true);
        } else {
          setHideHeader(false);
          setStickyNav(false);
        }
      };
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Scroll to top handler for navbar links/buttons
    const handleNavClick = (e) => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  const { user, logout } = useAuth();
  const { cartCount } = useCart();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);
  const notifButtonRef = useRef(null);
  const notifPanelRef = useRef(null);

  const handleProfileDropdown = () => {
    setDropdownOpen(prev => !prev);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
        if (
          dropdownRef.current &&
          buttonRef.current &&
          !buttonRef.current.contains(event.target) &&
          !dropdownRef.current.contains(event.target)
        ) {
          setDropdownOpen(false);
        }
        if (
          notifPanelRef.current &&
          notifButtonRef.current &&
          !notifButtonRef.current.contains(event.target) &&
          !notifPanelRef.current.contains(event.target)
        ) {
          setShowNotifications(false);
        }
      };
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    notificationsAPI.getNotifications().then(res => {
      if (!mounted) return;
      const data = res.data || [];
      const unread = data.filter(d => !d.read).length;
      setNotifCount(unread);
    }).catch(()=>{});
    return () => { mounted = false; };
  }, [user]);

  return (
    <>
    <header className="site-header">
      {/* Sticky Logo always visible */}
      <div className={`logo-standalone${stickyNav ? ' sticky-logo' : ''}`}> 
        <Link to="/" className="logo-link">
          <div className="logo-icon-3d">
            <i className="fas fa-seedling"></i>
          </div>
        </Link>
      </div>
      {/* Main Header with Title and Actions, hide on scroll */}
      <div className={`main-header${hideHeader ? ' sticky-hide' : ''}`}>
        <div className="header-container">
          {/* Title and tagline */}
          <div className="logo-title-group">
            <Link to="/" className="logo-link">
              <div className="logo-text">
                <h1>FarmtoClick</h1>
                <span className="logo-tagline">Fresh From Farm to Your Table</span>
              </div>
            </Link>
          </div>
          <div className="header-actions">
            {user ? (
              <div className="header-actions-inner" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <button
                    className="notif-btn"
                    onClick={(e) => { e.stopPropagation(); setShowNotifications(prev => !prev); }}
                    aria-label="Notifications"
                    ref={notifButtonRef}
                  >
                    <i className="fas fa-bell"></i>
                    {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
                  </button>
                  <NotificationsDropdown
                    visible={showNotifications}
                    onClose={() => { setShowNotifications(false); notificationsAPI.getNotifications().then(res=>{ const d = res.data||[]; setNotifCount(d.filter(x=>!x.read).length); }).catch(()=>{}); }}
                    ref={notifPanelRef}
                  />
                </div>

                <div className="user-profile-dropdown">
                  <button className="user-profile-btn" onClick={handleProfileDropdown} ref={buttonRef}>
                    <span className="user-avatar">
                      {user.profile_picture ? (
                        <img src={typeof user.profile_picture === 'string' && user.profile_picture.startsWith('http') ? user.profile_picture : `/uploads/profiles/${user.profile_picture}`} alt={user.first_name} />
                      ) : (
                        <i className={`fas ${user.is_admin ? 'fa-user-shield' : 'fa-user'}`}></i>
                      )}
                    </span>
                    <span className="user-name">{user?.first_name || 'User'}</span>
                    <i className="fas fa-chevron-down"></i>
                  </button>

                  <div className={`profile-dropdown${dropdownOpen ? ' show' : ''}`} ref={dropdownRef}>
                    <div className="dropdown-content">
                      <Link to="/profile" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                        <i className="fas fa-user-edit"></i> Edit Profile
                      </Link>
                      <Link to="/cart" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                        <i className="fas fa-shopping-cart"></i> My Cart
                      </Link>
                      <Link to="/orders" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                        <i className="fas fa-shopping-bag"></i> My Orders
                      </Link>
                      {user.is_admin && (
                        <>
                          <div className="dropdown-divider"></div>
                          <Link to="/admin-dashboard" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                            <i className="fas fa-chart-bar"></i> Admin Dashboard
                          </Link>
                        </>
                      )}
                      {user.is_farmer && (
                        <>
                          <div className="dropdown-divider"></div>
                          <Link to="/farmer-dashboard" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                            <i className="fas fa-store"></i> Farmer Dashboard
                          </Link>
                        </>
                      )}
                      {user.role === 'rider' && (
                        <>
                          <div className="dropdown-divider"></div>
                          <Link to="/rider-dashboard" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                            <i className="fas fa-tachometer-alt"></i> Rider Dashboard
                          </Link>
                          <Link to="/rider-orders" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                            <i className="fas fa-motorcycle"></i> Assigned Orders
                          </Link>
                        </>
                      )}
                      <div className="dropdown-divider"></div>
                      <button onClick={() => { setDropdownOpen(false); logout(); }} className="dropdown-item logout">
                        <i className="fas fa-sign-out-alt"></i> Logout
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="auth-buttons">
                <Link to="/login" className="btn btn-outline">Login</Link>
                <Link to="/register" className="btn btn-primary">Sign Up</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Bar */}
      <nav className={`navbar${stickyNav ? ' sticky-navbar' : ''}`}>
        <div className="nav-container">
          <button className="mobile-menu-toggle" onClick={() => { handleNavClick(); setMobileMenuOpen(!mobileMenuOpen); }}>
            <i className={`fas ${mobileMenuOpen ? 'fa-times' : 'fa-bars'}`}></i>
          </button>
          <ul className={`nav-menu ${mobileMenuOpen ? 'active' : ''}`}> 
            <li><Link to="/" className={activePage === 'home' ? 'active' : ''} onClick={handleNavClick}>Home</Link></li>
            <li><Link to="/products" className={activePage === 'products' ? 'active' : ''} onClick={handleNavClick}>Products</Link></li>
            <li><Link to="/farmers" className={activePage === 'farmers' ? 'active' : ''} onClick={handleNavClick}>Farmers</Link></li>
            <li><Link to="/price-trends" className={activePage === 'price-trends' ? 'active' : ''} onClick={handleNavClick}>Price Trends</Link></li>
            <li><Link to="/about" className={activePage === 'about' ? 'active' : ''} onClick={handleNavClick}>About Us</Link></li>
            <li><a href="#contact" onClick={handleNavClick}>Contact</a></li>
            {user && user.is_farmer && (
              <li><Link to="/farmer-dashboard" className={activePage === 'myshop' ? 'active' : ''} onClick={handleNavClick}>My Shop</Link></li>
            )}
          </ul>
          <div className="nav-right">
            {user && (user.is_farmer || user.is_admin) && (
              <Link to="/co-vendors" className="btn btn-primary vendors-shop-btn" onClick={handleNavClick} style={{ marginRight: 12 }}>
                <i className="fas fa-store"></i> Vendors Marketplace
              </Link>
            )}
            <Link to="/cart" className="navbar-cart" onClick={handleNavClick} aria-label="View cart">
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <i className="fas fa-shopping-cart"></i>
                {cartCount > 0 && (
                  <span className="cart-badge">{cartCount > 99 ? '99+' : cartCount}</span>
                )}
              </span>
              <span className="cart-text">Cart</span>
            </Link>
          </div>
        </div>
      </nav>
    </header>
    </>
  );
};

export default Navbar;
