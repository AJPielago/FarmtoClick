import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { productsAPI, ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';


const FarmerDashboard = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [sellerOrders, setSellerOrders] = useState([]);
  
  const topProductsChartRef = useRef(null);
  const orderStatusChartRef = useRef(null);
  const revenueChartRef = useRef(null);

  // Track Chart.js instances so we can destroy before re-creating
  const topProductsChartInstance = useRef(null);
  const orderStatusChartInstance = useRef(null);
  const revenueChartInstance = useRef(null);

  const loadFarmerData = useCallback(async () => {
    try {
      // Load farmer's products
      const productsRes = await productsAPI.getProducts();
      setProducts(productsRes.data?.products || []);
      
      // Load seller orders (for stats/charts only)
      const ordersRes = await ordersAPI.getSellerOrders();
      setSellerOrders(ordersRes.data?.orders || []);
    } catch (error) {
      console.error('Failed to load farmer data:', error);
    }
  }, []);

  const initCharts = useCallback(() => {
    const Chart = window.Chart;
    if (!Chart) return;

    const statusColors = {
      pending: '#ff9800',
      approved: '#2196f3',
      ready_for_ship: '#00bcd4',
      picked_up: '#9c27b0',
      on_the_way: '#ff5722',
      delivered: '#4caf50',
      rejected: '#f44336',
      cancelled: '#9e9e9e',
    };

    // Top Products by Revenue (horizontal bar)
    if (topProductsChartRef.current) {
      if (topProductsChartInstance.current) { topProductsChartInstance.current.destroy(); }
      const ctx = topProductsChartRef.current.getContext('2d');
      const deliveredStatuses = ['delivered', 'completed'];
      const productRevenue = {};
      sellerOrders
        .filter(o => deliveredStatuses.includes((o.status || '').toLowerCase()))
        .forEach(o => {
          (o.items || []).forEach(it => {
            const name = it.product_name || it.name || `Product #${it.product_id}`;
            productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(it.price) || 0) * (it.quantity || 1);
          });
          // Fallback: order has no items array
          if (!o.items || o.items.length === 0) {
            const name = o.product_name || 'Unknown Product';
            productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(o.total_amount) || 0);
          }
        });
      const sorted = Object.entries(productRevenue)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7);
      const productColors = ['#047857','#0284c7','#7c3aed','#c2410c','#0891b2','#b45309','#be185d'];
      topProductsChartInstance.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sorted.map(([name]) => name.length > 20 ? name.slice(0, 18) + '…' : name),
          datasets: [{
            label: 'Revenue (₱)',
            data: sorted.map(([, rev]) => rev),
            backgroundColor: sorted.map((_, i) => productColors[i % productColors.length]),
            borderRadius: 6,
            borderWidth: 0
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => '₱' + ctx.parsed.x.toLocaleString('en-PH', { minimumFractionDigits: 2 }) } }
          },
          scales: {
            x: { beginAtZero: true, ticks: { callback: v => '₱' + v.toLocaleString() } },
            y: { ticks: { font: { size: 11 } } }
          }
        }
      });
    }

    // Order Status Doughnut Chart
    if (orderStatusChartRef.current) {
      if (orderStatusChartInstance.current) { orderStatusChartInstance.current.destroy(); }
      const ctx = orderStatusChartRef.current.getContext('2d');
      const orderStatusCount = {};
      sellerOrders.forEach(o => {
        const s = (o.status || 'pending').toLowerCase();
        orderStatusCount[s] = (orderStatusCount[s] || 0) + 1;
      });
      const statusLabels = Object.keys(orderStatusCount);
      const statusData = Object.values(orderStatusCount);
      const statusBgColors = statusLabels.map(s => statusColors[s] || '#9e9e9e');

      orderStatusChartInstance.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: statusLabels.map(s => s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())),
          datasets: [{
            data: statusData,
            backgroundColor: statusBgColors,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } }
          }
        }
      });
    }

    // Earnings by Day Line Chart (last 30 days, delivered/completed only)
    if (revenueChartRef.current) {
      if (revenueChartInstance.current) { revenueChartInstance.current.destroy(); }
      const ctx = revenueChartRef.current.getContext('2d');
      const revenueByDay = {};
      const today = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        revenueByDay[key] = 0;
      }
      const deliveredStatuses = ['delivered', 'completed'];
      sellerOrders
        .filter(o => deliveredStatuses.includes((o.status || '').toLowerCase()))
        .forEach(o => {
          if (!o.created_at) return;
          const day = new Date(o.created_at).toISOString().slice(0, 10);
          if (revenueByDay.hasOwnProperty(day)) {
            const orderTotal = o.items
              ? o.items.reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
              : (parseFloat(o.total_amount) || 0);
            revenueByDay[day] += orderTotal;
          }
        });
      const dayLabels = Object.keys(revenueByDay).map(d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      });

      revenueChartInstance.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dayLabels,
          datasets: [{
            label: 'Earnings (₱)',
            data: Object.values(revenueByDay),
            backgroundColor: 'rgba(4, 120, 87, 0.12)',
            borderColor: '#047857',
            borderWidth: 2,
            pointBackgroundColor: '#047857',
            pointRadius: 3,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => '₱' + ctx.parsed.y.toLocaleString('en-PH', { minimumFractionDigits: 2 }) } }
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: v => '₱' + v.toLocaleString() } },
            x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 10 }, maxTicksLimit: 15 } }
          }
        }
      });
    }
  }, [products, sellerOrders]);

  useEffect(() => {
    if (user && user.is_farmer) {
      loadFarmerData();
    }
  }, [user, loadFarmerData]);

  useEffect(() => {
    if (products.length > 0 || sellerOrders.length > 0) {
      if (window.Chart) {
        initCharts();
      } else {
        // CDN not yet ready — retry once after a short delay
        const t = setTimeout(() => { if (window.Chart) initCharts(); }, 500);
        return () => clearTimeout(t);
      }
    }
  }, [products, sellerOrders, initCharts]);

  // Calculate statistics
  const availableCount = products.filter(p => p.available !== false && p.quantity > 0).length;
  const unavailableCount = products.length - availableCount;
  const formatCurrency = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const deliveredStatuses = ['delivered', 'completed'];
  const deliveredOrdersForCharts = sellerOrders.filter(o => deliveredStatuses.includes((o.status || '').toLowerCase()));

  const productRevenue = {};
  deliveredOrdersForCharts.forEach((o) => {
    (o.items || []).forEach((it) => {
      const name = it.product_name || it.name || `Product #${it.product_id}`;
      productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(it.price) || 0) * (it.quantity || 1);
    });
    if (!o.items || o.items.length === 0) {
      const name = o.product_name || 'Unknown Product';
      productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(o.total_amount) || 0);
    }
  });
  const topProductsData = Object.entries(productRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);

  const orderStatusCount = {};
  sellerOrders.forEach((o) => {
    const status = (o.status || 'pending').toLowerCase();
    orderStatusCount[status] = (orderStatusCount[status] || 0) + 1;
  });
  const orderStatusData = Object.entries(orderStatusCount).map(([status, count]) => ({ status, count }));

  const revenueByDay = {};
  const today = new Date();
  for (let index = 29; index >= 0; index--) {
    const date = new Date(today);
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    revenueByDay[key] = 0;
  }
  deliveredOrdersForCharts.forEach((o) => {
    if (!o.created_at) return;
    const day = new Date(o.created_at).toISOString().slice(0, 10);
    if (!Object.prototype.hasOwnProperty.call(revenueByDay, day)) return;
    const orderTotal = o.items
      ? o.items.reduce((sum, it) => sum + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
      : (parseFloat(o.total_amount) || 0);
    revenueByDay[day] += orderTotal;
  });
  const revenueSeries = Object.values(revenueByDay);

  const farmerChartInterpretations = {
    orderStatus: (() => {
      const total = orderStatusData.reduce((sum, row) => sum + row.count, 0);
      const lead = [...orderStatusData].sort((a, b) => b.count - a.count)[0];
      const leadPct = total > 0 ? (lead.count / total) * 100 : 0;
      return [
        `${total} orders are distributed across ${orderStatusData.length} active status categories.`,
        `${(lead?.status || 'Top status').replace(/_/g, ' ')} is highest at ${leadPct.toFixed(1)}% of tracked orders.`,
        `This trend highlights where fulfillment is strong and where process changes are needed to reduce delays.`
      ];
    })(),
    topProducts: (() => {
      const total = topProductsData.reduce((sum, [, revenue]) => sum + Number(revenue || 0), 0);
      const top = topProductsData[0];
      const share = total > 0 ? (Number(top?.[1] || 0) / total) * 100 : 0;
      return [
        `${topProductsData.length} products generated delivered revenue in this ranking window.`,
        `${top?.[0] || 'Top product'} leads at ${formatCurrency(top?.[1] || 0)}, representing ${share.toFixed(1)}% of top-product revenue.`,
        `This concentration helps prioritize stock replenishment and promotions on high-performing items.`
      ];
    })(),
    dailyEarnings: (() => {
      const total = revenueSeries.reduce((sum, value) => sum + Number(value || 0), 0);
      const avg = revenueSeries.length > 0 ? total / revenueSeries.length : 0;
      const peak = Math.max(...revenueSeries, 0);
      return [
        `Delivered orders generated ${formatCurrency(total)} over the last 30 days.`,
        `Average daily earnings are ${formatCurrency(avg)} with a peak day of ${formatCurrency(peak)}.`,
        `This earning pattern helps forecast cash flow and schedule campaigns around high-value periods.`
      ];
    })(),
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
      {/* Navigation */}
      <Navbar activePage="myshop" />

      <section className="products-page">
        <div className="container">
          {/* YOUR PRODUCTS SECTION */}
          <div className="farmer-dashboard-section">
            <div className="farmer-section-header">
              <h2 className="farmer-section-title">
                <i className="fas fa-store"></i> Your Products
              </h2>
              <Link to="/manage-products" className="btn btn-primary">
                <i className="fas fa-cog"></i> Manage Products
              </Link>
            </div>

            {products.length > 0 ? (
              <div className="farmer-products-grid">
                {products.map(product => {
                  const isOut = !product.available || product.quantity <= 0;
                  const isLow = !isOut && product.quantity <= 10;

                  return (
                    <article key={product.id} className="farmer-product-card">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="farmer-product-image" />
                      ) : (
                        <div className="farmer-product-placeholder"><i className="fas fa-seedling"></i></div>
                      )}
                      <div className="stock-badges">
                        {isOut ? (
                          <span className="stock-badge stock-badge-out">Out of Stock</span>
                        ) : isLow ? (
                          <span className="stock-badge stock-badge-low">Low Stock</span>
                        ) : (
                          <span className="stock-badge stock-badge-ok">In Stock</span>
                        )}
                      </div>
                      <div className="farmer-product-header">
                        <h3 className="farmer-product-title">{product.name}</h3>
                        <span className={`manage-product-status ${isOut ? 'status-out' : 'status-available'}`}>
                          {isOut ? 'Unavailable' : 'Available'}
                        </span>
                      </div>
                      <p className="farmer-product-meta">{product.category} • {product.unit}</p>
                      <p className="farmer-product-price">₱{product.price?.toFixed(2)} • Stock: {product.quantity}</p>
                      <p className="farmer-product-description">
                        {product.description?.substring(0, 120)}{product.description?.length > 120 ? '…' : ''}
                      </p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="farmer-products-empty">
                <i className="fas fa-inbox"></i>
                <h3>No products yet</h3>
                <p>You haven't added any products to your shop yet.</p>
                <div className="farmer-empty-actions">
                  <Link to="/manage-products" className="btn btn-primary">
                    <i className="fas fa-plus"></i> Add Your First Product
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ORDERS BUTTON */}
          <div className="farmer-dashboard-section">
            <div className="farmer-section-header">
              <h2 className="farmer-section-title"><i className="fas fa-receipt"></i> Orders</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <Link to="/farmer-printable-reports" className="btn btn-outline">
                  <i className="fas fa-print"></i> Printable Reports
                </Link>
                <Link to="/farmer-orders" className="btn btn-primary btn-large">
                  <i className="fas fa-receipt"></i> View Orders for Your Products
                  {sellerOrders.filter(o => (o.status || '').toLowerCase() === 'pending').length > 0 && (
                    <span style={{
                      background: '#dc2626',
                      color: '#fff',
                      borderRadius: '50%',
                      padding: '2px 8px',
                      fontSize: '0.8rem',
                      marginLeft: '8px',
                      fontWeight: 'bold'
                    }}>
                      {sellerOrders.filter(o => (o.status || '').toLowerCase() === 'pending').length}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </div>

          {/* STATISTICS SECTION */}
          <div className="farmer-stats-grid">
            <div className="farmer-stat-card revenue">
              <div className="farmer-stat-icon" style={{ background: '#047857', color: '#fff' }}><i className="fas fa-peso-sign"></i></div>
              <p className="farmer-stat-label">Total Revenue</p>
              <p className="farmer-stat-value">₱{sellerOrders.reduce((sum, o) => {
                const t = o.items
                  ? o.items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
                  : (parseFloat(o.total_amount) || 0);
                return sum + t;
              }, 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="farmer-stat-card">
              <div className="farmer-stat-icon" style={{ background: '#c2410c', color: '#fff' }}><i className="fas fa-shopping-bag"></i></div>
              <p className="farmer-stat-label">Total Orders</p>
              <p className="farmer-stat-value">{sellerOrders.length}</p>
            </div>

            <div className="farmer-stat-card">
              <div className="farmer-stat-icon" style={{ background: '#ff9800', color: '#fff' }}><i className="fas fa-clock"></i></div>
              <p className="farmer-stat-label">Pending Orders</p>
              <p className="farmer-stat-value">{sellerOrders.filter(o => (o.status || '').toLowerCase() === 'pending').length}</p>
            </div>

            <div className="farmer-stat-card">
              <div className="farmer-stat-icon" style={{ background: '#16a34a', color: '#fff' }}><i className="fas fa-check-circle"></i></div>
              <p className="farmer-stat-label">Delivered</p>
              <p className="farmer-stat-value">{sellerOrders.filter(o => (o.status || '').toLowerCase() === 'delivered').length}</p>
            </div>

            <div className="farmer-stat-card">
              <div className="farmer-stat-icon" style={{ background: '#6d28d9', color: '#fff' }}><i className="fas fa-calculator"></i></div>
              <p className="farmer-stat-label">Avg Order Value</p>
              <p className="farmer-stat-value">₱{sellerOrders.length > 0
                ? (sellerOrders.reduce((sum, o) => {
                    const t = o.items
                      ? o.items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
                      : (parseFloat(o.total_amount) || 0);
                    return sum + t;
                  }, 0) / sellerOrders.length).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '0.00'}</p>
            </div>

            <div className="farmer-stat-card">
              <div className="farmer-stat-icon" style={{ background: '#0ea5e9', color: '#fff' }}><i className="fas fa-box"></i></div>
              <p className="farmer-stat-label">Products Listed</p>
              <p className="farmer-stat-value">{products.length}</p>
              <p className="farmer-stat-sub">{availableCount} available · {unavailableCount} out of stock</p>
            </div>
          </div>

          {/* CHARTS SECTION */}
          {(products.length > 0 || sellerOrders.length > 0) && (
            <>
              <div className="farmer-charts-grid">
                <div className="farmer-chart-card">
                  <h3><i className="fas fa-chart-pie"></i> Order Status Breakdown</h3>
                  <canvas ref={orderStatusChartRef} style={{ maxHeight: '250px' }}></canvas>
                  {orderStatusData.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '10px 12px', borderLeft: '4px solid #2c7a2c', background: '#f0f7f0', borderRadius: '6px', fontSize: '.85rem', color: '#334155', lineHeight: '1.45' }}>
                      {farmerChartInterpretations.orderStatus.map((line, idx) => <p key={idx} style={{ margin: idx === 2 ? 0 : '0 0 6px' }}>{line}</p>)}
                    </div>
                  )}
                </div>

                <div className="farmer-chart-card">
                  <h3><i className="fas fa-trophy"></i> Top Products by Earnings</h3>
                  <canvas ref={topProductsChartRef} style={{ maxHeight: '250px' }}></canvas>
                  {topProductsData.length > 0 && (
                    <div style={{ marginTop: '10px', padding: '10px 12px', borderLeft: '4px solid #2c7a2c', background: '#f0f7f0', borderRadius: '6px', fontSize: '.85rem', color: '#334155', lineHeight: '1.45' }}>
                      {farmerChartInterpretations.topProducts.map((line, idx) => <p key={idx} style={{ margin: idx === 2 ? 0 : '0 0 6px' }}>{line}</p>)}
                    </div>
                  )}
                </div>
              </div>

              <div className="farmer-chart-card standalone">
                <h3><i className="fas fa-chart-line"></i> Daily Earnings (Last 30 Days — Delivered Orders Only)</h3>
                <canvas ref={revenueChartRef} style={{ maxHeight: '300px' }}></canvas>
                <div style={{ marginTop: '10px', padding: '10px 12px', borderLeft: '4px solid #2c7a2c', background: '#f0f7f0', borderRadius: '6px', fontSize: '.85rem', color: '#334155', lineHeight: '1.45' }}>
                  {farmerChartInterpretations.dailyEarnings.map((line, idx) => <p key={idx} style={{ margin: idx === 2 ? 0 : '0 0 6px' }}>{line}</p>)}
                </div>
              </div>
            </>
          )}

          {/* QUICK ACTIONS */}
          <div className="farmer-dashboard-section">
            <h2 className="farmer-section-title"><i className="fas fa-bolt"></i> Quick Actions</h2>
            <div className="farmer-quick-actions">
              <Link to="/manage-products" className="btn btn-primary">
                <i className="fas fa-plus"></i> Add Product
              </Link>
              <Link to="/profile" className="btn btn-outline">
                <i className="fas fa-user-edit"></i> Edit Farm Profile
              </Link>
              <Link to="/products" className="btn btn-outline">
                <i className="fas fa-eye"></i> View Marketplace
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default FarmerDashboard;