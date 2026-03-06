import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section">
            <h3><i className="fas fa-seedling"></i> FarmtoClick</h3>
            <p>Connecting communities with fresh, local produce since 2024.</p>
          </div>
          <div className="footer-section">
            <h4>Quick Links</h4>
            <ul>
              <li><Link to="/products">Products</Link></li>
              <li><Link to="/farmers">Farmers</Link></li>
              <li><Link to="/about">About Us</Link></li>
              <li><a href="/faq">FAQ</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>For Farmers</h4>
            <ul>
              <li><Link to="/start-selling">Join as Farmer</Link></li>
              <li><a href="/farmer-resources">Farmer Resources</a></li>
              <li><a href="/success-stories">Success Stories</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>Follow Us</h4>
            <div className="social-links">
              <a href="https://facebook.com/farmtoclick" target="_blank" rel="noopener noreferrer"><i className="fab fa-facebook"></i> Facebook</a>
              <a href="https://instagram.com/farmtoclick" target="_blank" rel="noopener noreferrer"><i className="fab fa-instagram"></i> Instagram</a>
              <a href="https://twitter.com/farmtoclick" target="_blank" rel="noopener noreferrer"><i className="fab fa-twitter"></i> Twitter</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2024 FarmtoClick. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
