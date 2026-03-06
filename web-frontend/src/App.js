import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import AuthLayout from './pages/AuthLayout';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Farmers from './pages/Farmers';
import Profile from './pages/Profile';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import FarmerDashboard from './pages/FarmerDashboard';
import FarmerOrders from './pages/FarmerOrders';
import ManageProducts from './pages/ManageProducts';
import StartSelling from './pages/StartSelling';
import FarmerProfile from './pages/FarmerProfile';
import FarmerVerify from './pages/FarmerVerify';
import CoVendorsMarketplace from './pages/CoVendorsMarketplace';
import AdminDashboard from './pages/AdminDashboard';
import PermitVerificationDashboard from './pages/PermitVerificationDashboard';
import DTIPriceManagement from './pages/DTIPriceManagement';
import PriceTrends from './pages/PriceTrends';
import AdminRiders from './pages/AdminRiders';
import AdminUsers from './pages/AdminUsers';
import AdminPrintableReports from './pages/AdminPrintableReports';
import FarmerPrintableReports from './pages/FarmerPrintableReports';
import RiderPrintableReports from './pages/RiderPrintableReports';
import AdminReviews from './pages/AdminReviews';
import RiderOrders from './pages/RiderOrders';
import RiderRouteMap from './pages/RiderRouteMap';
import RiderDashboard from './pages/RiderDashboard';
import AboutUs from './pages/AboutUs';
import ScrollToTop from './components/ScrollToTop';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
      <Router>
        <div className="App">
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Route>
            <Route path="/products" element={<Products />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/farmers" element={<Farmers />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/farmer-dashboard" element={<FarmerDashboard />} />
            <Route path="/farmer-orders" element={<FarmerOrders />} />
            <Route path="/manage-products" element={<ManageProducts />} />
            <Route path="/co-vendors" element={<CoVendorsMarketplace />} />
            <Route path="/start-selling" element={<StartSelling />} />
            <Route path="/farmer/:id" element={<FarmerProfile />} />
            <Route path="/farmer-verify" element={<FarmerVerify />} />
            <Route path="/admin-dashboard" element={<AdminDashboard />} />
            <Route path="/admin-riders" element={<AdminRiders />} />
            <Route path="/admin-users" element={<AdminUsers />} />
            <Route path="/admin-reports" element={<AdminPrintableReports />} />
            <Route path="/farmer-printable-reports" element={<FarmerPrintableReports />} />
            <Route path="/rider-printable-reports" element={<RiderPrintableReports />} />
            <Route path="/admin-reviews" element={<AdminReviews />} />
            <Route path="/rider-dashboard" element={<RiderDashboard />} />
            <Route path="/rider-orders" element={<RiderOrders />} />
            <Route path="/rider-route-map" element={<RiderRouteMap />} />
            <Route path="/permit-verification-dashboard" element={<PermitVerificationDashboard />} />
            <Route path="/dti-prices" element={<DTIPriceManagement />} />
            <Route path="/price-trends" element={<PriceTrends />} />
            <Route path="/about" element={<AboutUs />} />
          </Routes>
        </div>
      </Router>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
