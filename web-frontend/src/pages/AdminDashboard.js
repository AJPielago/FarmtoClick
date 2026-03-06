import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';

const COLORS = ['#2c7a2c', '#4caf50', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9', '#388e3c', '#1b5e20'];
const STATUS_COLORS = {
  pending: '#ff9800',
  confirmed: '#2196f3',
  preparing: '#9c27b0',
  ready: '#00bcd4',
  completed: '#4caf50',
  delivered: '#2c7a2c',
  cancelled: '#f44336',
  unknown: '#9e9e9e',
};

const AdminDashboard = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({
    totalProducts: 0,
    totalFarmers: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingVerifications: 0,
    activeRiders: 0,
    totalRiders: 0,
  });
  const [reports, setReports] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reportDays, setReportDays] = useState(30);
  const [activeTab, setActiveTab] = useState('overview');
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.is_admin) {
      loadDashboardStats();
      loadReports(reportDays);
    } else {
      navigate('/');
    }
  }, [user, navigate, reportDays, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.is_admin) {
      loadReports(reportDays);
    }
  }, [reportDays, user, authLoading]);

  const loadDashboardStats = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('userToken');
      const headers = { 'Authorization': token ? `Bearer ${token}` : '' };

      const [productsRes, farmersRes, ordersRes, verificationsRes, ridersRes] = await Promise.all([
        fetch('http://localhost:5001/api/admin/products', { headers, credentials: 'include' }),
        fetch('http://localhost:5001/api/admin/farmers', { headers, credentials: 'include' }),
        fetch('http://localhost:5001/api/admin/orders', { headers, credentials: 'include' }),
        fetch('http://localhost:5001/api/admin/verifications', { headers, credentials: 'include' }),
        fetch('http://localhost:5001/api/admin/riders', { headers, credentials: 'include' }),
      ]);

      let totalProducts = 0, totalFarmers = 0, totalOrders = 0, totalRevenue = 0, pendingVerifications = 0, activeRiders = 0, totalRiders = 0;

      if (productsRes.ok) {
        const data = await productsRes.json();
        totalProducts = (data.products || []).length;
      }
      if (farmersRes.ok) {
        const data = await farmersRes.json();
        totalFarmers = (data.farmers || []).length;
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        const orders = data.orders || [];
        totalOrders = orders.length;
        totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total) || parseFloat(o.total_amount) || 0), 0);
        setRecentOrders(orders.slice(0, 6));
      }
      if (verificationsRes.ok) {
        const data = await verificationsRes.json();
        if (data.stats) {
          pendingVerifications = Math.max(0, (data.stats.total || 0) - (data.stats.verified || 0) - (data.stats.rejected || 0));
        }
      }
      if (ridersRes.ok) {
        const data = await ridersRes.json();
        activeRiders = data.active_count || 0;
        totalRiders = data.total_count || 0;
      }

      setStats({ totalProducts, totalFarmers, totalOrders, totalRevenue, pendingVerifications, activeRiders, totalRiders });
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReports = async (days) => {
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(`http://localhost:5001/api/admin/reports?days=${days}`, {
        headers: { 'Authorization': token ? `Bearer ${token}` : '' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data);
      }
    } catch (error) {
      console.error('Error loading reports:', error);
    }
  };

  const formatCurrency = (val) => `₱${Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatShortDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };

  if (!user || !user.is_admin) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <Link to="/" className="btn btn-primary">Go Home</Link>
      </div>
    );
  }

  const kpis = reports?.kpis || {};
  const assumedMarginPct = kpis.assumed_margin_pct ?? 15; // default 15% markup if not provided by backend
  const totalRevenueForCalc = (kpis.total_revenue !== undefined && kpis.total_revenue !== null) ? kpis.total_revenue : stats.totalRevenue;
  const estimatedProfit = Number(totalRevenueForCalc) * (Number(assumedMarginPct) / 100);
  const revenueTimeline = reports?.revenue_timeline || [];
  const orderStatusRows = reports?.order_status || [];
  const paymentRows = reports?.payment_breakdown || [];
  const monthlyRows = reports?.monthly_data || [];
  const topProductsRows = reports?.top_products || [];
  const topFarmersRows = reports?.top_farmers || [];

  const adminChartInterpretations = {
    revenueTimeline: (() => {
      const totalRevenue = revenueTimeline.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const totalOrders = revenueTimeline.reduce((sum, row) => sum + (row.orders || 0), 0);
      const first = revenueTimeline[0];
      const last = revenueTimeline[revenueTimeline.length - 1];
      return [
        `The revenue timeline captures ${totalOrders} orders and ${formatCurrency(totalRevenue)} in the selected period.`,
        `Revenue moved from ${formatCurrency(first?.revenue || 0)} at the start to ${formatCurrency(last?.revenue || 0)} at the end, indicating the direction of demand.`,
        `This trend helps plan inventory and promotions around stronger days while correcting weaker intervals earlier.`
      ];
    })(),
    orderVolume: (() => {
      const maxDay = [...revenueTimeline].sort((a, b) => (b.orders || 0) - (a.orders || 0))[0];
      const avgOrders = revenueTimeline.length > 0
        ? (revenueTimeline.reduce((sum, row) => sum + (row.orders || 0), 0) / revenueTimeline.length)
        : 0;
      return [
        `Daily volume averages ${avgOrders.toFixed(1)} orders across the selected window.`,
        `The busiest day reached ${(maxDay?.orders || 0)} orders, showing the practical peak load for operations.`,
        `Understanding this volume pattern supports staffing decisions and faster fulfillment during high-traffic periods.`
      ];
    })(),
    orderStatus: (() => {
      const total = orderStatusRows.reduce((sum, row) => sum + (row.count || 0), 0);
      const top = [...orderStatusRows].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      const share = total > 0 ? ((top?.count || 0) / total) * 100 : 0;
      return [
        `${total} orders are represented across ${orderStatusRows.length} active status categories.`,
        `${top?.status || 'Leading status'} contributes ${share.toFixed(1)}% of tracked orders and dominates the current flow.`,
        `The distribution highlights where to reduce bottlenecks and improve conversion from in-progress to completed.`
      ];
    })(),
    paymentMethods: (() => {
      const total = paymentRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const top = [...paymentRows].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `${paymentRows.length} payment channels generated ${formatCurrency(total)} in processed revenue.`,
        `${top?.method || 'Top method'} leads with ${share.toFixed(1)}% share of payment value.`,
        `This mix informs where to prioritize payment reliability work and targeted checkout incentives.`
      ];
    })(),
    monthly: (() => {
      const first = monthlyRows[0];
      const last = monthlyRows[monthlyRows.length - 1];
      return [
        `The monthly chart summarizes ${monthlyRows.length} months of order and revenue movement.`,
        `Revenue changed from ${formatCurrency(first?.revenue || 0)} in ${first?.month || 'the first month'} to ${formatCurrency(last?.revenue || 0)} in ${last?.month || 'the latest month'}.`,
        `This longer trend shows whether growth is sustained and where strategic adjustments are needed.`
      ];
    })(),
    topProductsRevenue: (() => {
      const total = topProductsRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const top = topProductsRows[0];
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `Top products account for ${formatCurrency(total)} combined revenue in this ranking.`,
        `${top?.name || 'Top product'} leads at ${formatCurrency(top?.revenue || 0)}, equivalent to ${share.toFixed(1)}% of top-product revenue.`,
        `The concentration shows which products should receive stronger stocking and campaign support.`
      ];
    })(),
    topProductsUnits: (() => {
      const totalUnits = topProductsRows.reduce((sum, row) => sum + (row.quantity_sold || 0), 0);
      const top = [...topProductsRows].sort((a, b) => (b.quantity_sold || 0) - (a.quantity_sold || 0))[0];
      const share = totalUnits > 0 ? ((top?.quantity_sold || 0) / totalUnits) * 100 : 0;
      return [
        `${totalUnits} total units were sold across the leading products in this view.`,
        `${top?.name || 'Top product'} contributes ${share.toFixed(1)}% of unit volume and sets current demand direction.`,
        `Volume leaders help forecast replenishment needs and reduce stock-out risk on high-turn items.`
      ];
    })(),
    topFarmers: (() => {
      const total = topFarmersRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const top = topFarmersRows[0];
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `${topFarmersRows.length} farmers contributed revenue in the current ranking period.`,
        `${top?.name || 'Top farmer'} generated ${formatCurrency(top?.revenue || 0)}, equal to ${share.toFixed(1)}% of farmer revenue.`,
        `This pattern identifies high performers and where enablement can improve overall seller balance.`
      ];
    })(),
  };

  return (
    <div className="admin-dashboard-page">
      <Navbar />

      <section className="admin-content">
        <div className="container">
          {isLoading ? (
            <div className="loading-spinner"><i className="fas fa-spinner fa-spin"></i> Loading statistics...</div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="admin-stats-grid">
                <div className="stat-card stat-revenue">
                  <div className="stat-icon" style={{ background: '#047857', color: '#ffffff' }}><i className="fas fa-peso-sign"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{formatCurrency(stats.totalRevenue)}</div>
                    <div className="stat-label">Total Revenue</div>
                    {kpis.revenue_growth_pct !== undefined && kpis.revenue_growth_pct !== 0 && (
                      <div className={`stat-trend ${kpis.revenue_growth_pct > 0 ? 'up' : 'down'}`}>
                        <i className={`fas fa-arrow-${kpis.revenue_growth_pct > 0 ? 'up' : 'down'}`}></i> {Math.abs(kpis.revenue_growth_pct)}% vs prev period
                      </div>
                    )}
                  </div>
                </div>

                <div className="stat-card stat-profit">
                  <div className="stat-icon" style={{ background: '#fbbf24', color: '#ffffff' }}><i className="fas fa-coins"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{formatCurrency(estimatedProfit)}</div>
                    <div className="stat-label">Estimated Profit</div>
                    <div className="stat-sub">Assumed margin: {assumedMarginPct}%</div>
                  </div>
                </div>

                <div className="stat-card stat-orders">
                  <div className="stat-icon" style={{ background: '#c2410c', color: '#ffffff' }}><i className="fas fa-shopping-bag"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{stats.totalOrders}</div>
                    <div className="stat-label">Total Orders</div>
                    <div className="stat-sub">Avg: {formatCurrency(kpis.avg_order_value)}/order</div>
                  </div>
                </div>

                <div className="stat-card stat-completed">
                  <div className="stat-icon" style={{ background: '#16a34a', color: '#ffffff' }}><i className="fas fa-check-circle"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{kpis.completed_orders || 0}</div>
                    <div className="stat-label">Completed Orders</div>
                    <div className="stat-sub">{kpis.cancelled_orders || 0} cancelled</div>
                  </div>
                </div>

                <div className="stat-card stat-conversion">
                  <div className="stat-icon" style={{ background: '#7c3aed', color: '#ffffff' }}><i className="fas fa-percentage"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{stats.totalOrders > 0 ? (((kpis.completed_orders || 0) / stats.totalOrders) * 100).toFixed(1) : '0.0'}%</div>
                    <div className="stat-label">Completion Rate</div>
                    <div className="stat-sub">{stats.totalOrders - (kpis.completed_orders || 0) - (kpis.cancelled_orders || 0)} in progress</div>
                  </div>
                </div>

                <div className="stat-card stat-farmers">
                  <div className="stat-icon" style={{ background: '#6d28d9', color: '#ffffff' }}><i className="fas fa-user-tie"></i></div>
                  <div className="stat-info">
                    <div className="stat-number">{stats.totalFarmers}</div>
                    <div className="stat-label">Active Farmers</div>
                    <div className="stat-sub">{stats.totalProducts} products &middot; {stats.activeRiders} riders</div>
                  </div>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="report-tabs">
                {[
                  { key: 'overview', label: 'Revenue & Orders', icon: 'chart-line' },
                  { key: 'products', label: 'Top Products', icon: 'box' },
                  { key: 'farmers', label: 'Farmer Performance', icon: 'user-tie' },
                  { key: 'manage', label: 'Management', icon: 'cogs' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    className={`report-tab ${activeTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <i className={`fas fa-${tab.icon}`}></i> {tab.label}
                  </button>
                ))}
              </div>

              {/* ====== OVERVIEW TAB ====== */}
              {activeTab === 'overview' && reports && (
                <div className="reports-section">
                  {/* Period selector */}
                  <div className="period-selector">
                    <span>Show data for:</span>
                    {[7, 14, 30, 60, 90].map(d => (
                      <button
                        key={d}
                        className={`period-btn ${reportDays === d ? 'active' : ''}`}
                        onClick={() => setReportDays(d)}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>

                  {recentOrders.length > 0 && (
                    <div className="chart-card recent-orders">
                      <h3><i className="fas fa-receipt"></i> Recent Orders</h3>
                      <div className="recent-orders-list">
                        {recentOrders.map((order) => (
                          <div key={order._id || order.id} className="recent-order-row">
                            <div>
                              <div className="recent-order-id">#{(order._id || order.id || '').toString().substring(0, 6).toUpperCase()}</div>
                              <div className="recent-order-date">{order.created_at ? new Date(order.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                            </div>
                            <div className="recent-order-meta">
                              <span className={`recent-order-status status-${(order.status || 'pending').toLowerCase()}`}>{order.status || 'pending'}</span>
                              {order.delivery_proof_url ? (
                                <a href={order.delivery_proof_url} target="_blank" rel="noreferrer">Delivery proof</a>
                              ) : (
                                <span className="recent-order-no-proof">No proof</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Revenue Timeline */}
                  <div className="chart-card">
                    <h3><i className="fas fa-chart-area"></i> Daily Revenue (Last {reportDays} Days)</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <AreaChart data={revenueTimeline} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2c7a2c" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#2c7a2c" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis tickFormatter={(v) => `₱${v.toLocaleString()}`} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(val) => formatCurrency(val)} labelFormatter={(l) => new Date(l).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} />
                        <Area type="monotone" dataKey="revenue" stroke="#2c7a2c" strokeWidth={2} fill="url(#colorRevenue)" name="Revenue" />
                      </AreaChart>
                    </ResponsiveContainer>
                    {revenueTimeline.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.revenueTimeline.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Daily Order Volume */}
                  <div className="chart-card">
                    <h3><i className="fas fa-chart-bar"></i> Daily Order Volume</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={revenueTimeline} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                        <Tooltip labelFormatter={(l) => new Date(l).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })} />
                        <Bar dataKey="orders" fill="#4caf50" radius={[4, 4, 0, 0]} name="Orders" />
                      </BarChart>
                    </ResponsiveContainer>
                    {revenueTimeline.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.orderVolume.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Row: Order Status + Payment Breakdown */}
                  <div className="chart-row">
                    <div className="chart-card half">
                      <h3><i className="fas fa-tasks"></i> Order Status Breakdown</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={orderStatusRows}
                            cx="50%" cy="50%"
                            innerRadius={55} outerRadius={100}
                            dataKey="count" nameKey="status"
                            paddingAngle={3}
                            label={({ status, count }) => `${status} (${count})`}
                          >
                            {orderStatusRows.map((entry, i) => (
                              <Cell key={i} fill={STATUS_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(val, name) => [val, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      {orderStatusRows.length > 0 && (
                        <div className="chart-interpretation">
                          {adminChartInterpretations.orderStatus.map((line, idx) => <p key={idx}>{line}</p>)}
                        </div>
                      )}
                    </div>

                    <div className="chart-card half">
                      <h3><i className="fas fa-credit-card"></i> Payment Methods</h3>
                      {reports.payment_breakdown && reports.payment_breakdown.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <PieChart>
                            <Pie
                              data={reports.payment_breakdown}
                              cx="50%" cy="50%"
                              innerRadius={55} outerRadius={100}
                              dataKey="revenue" nameKey="method"
                              paddingAngle={3}
                              label={({ method, count }) => `${method} (${count})`}
                            >
                              {reports.payment_breakdown.map((entry, i) => (
                                <Cell key={i} fill={COLORS[i % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(val) => formatCurrency(val)} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="no-data">No payment data available</div>
                      )}
                      {paymentRows.length > 0 && (
                        <div className="chart-interpretation">
                          {adminChartInterpretations.paymentMethods.map((line, idx) => <p key={idx}>{line}</p>)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Monthly Revenue Comparison */}
                  <div className="chart-card">
                    <h3><i className="fas fa-calendar-alt"></i> Monthly Revenue & Orders (Last 6 Months)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={monthlyRows} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="revenue" tickFormatter={(v) => `₱${v.toLocaleString()}`} tick={{ fontSize: 12 }} />
                        <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
                        <Tooltip formatter={(val, name) => name === 'Revenue' ? formatCurrency(val) : val} />
                        <Legend />
                        <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke="#2c7a2c" strokeWidth={3} dot={{ r: 5 }} name="Revenue" />
                        <Line yAxisId="orders" type="monotone" dataKey="orders" stroke="#ff9800" strokeWidth={2} dot={{ r: 4 }} name="Orders" />
                      </LineChart>
                    </ResponsiveContainer>
                    {monthlyRows.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.monthly.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ====== TOP PRODUCTS TAB ====== */}
              {activeTab === 'products' && reports && (
                <div className="reports-section">
                  <div className="chart-card">
                    <h3><i className="fas fa-trophy"></i> Top 10 Products by Revenue</h3>
                    <ResponsiveContainer width="100%" height={Math.max(300, (topProductsRows?.length || 0) * 45)}>
                      <BarChart data={topProductsRows} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tickFormatter={(v) => `₱${v.toLocaleString()}`} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(val) => formatCurrency(val)} />
                        <Bar dataKey="revenue" fill="#2c7a2c" radius={[0, 4, 4, 0]} name="Revenue" />
                      </BarChart>
                    </ResponsiveContainer>
                    {topProductsRows.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.topProductsRevenue.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>

                  <div className="chart-card">
                    <h3><i className="fas fa-boxes"></i> Top Products by Units Sold</h3>
                    <ResponsiveContainer width="100%" height={Math.max(300, (topProductsRows?.length || 0) * 45)}>
                      <BarChart data={topProductsRows} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="quantity_sold" fill="#ff9800" radius={[0, 4, 4, 0]} name="Units Sold" />
                      </BarChart>
                    </ResponsiveContainer>
                    {topProductsRows.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.topProductsUnits.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Product table for detail */}
                  <div className="chart-card">
                    <h3><i className="fas fa-table"></i> Product Performance Table</h3>
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Product</th>
                            <th>Revenue</th>
                            <th>Units Sold</th>
                            <th>Avg Price/Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(reports.top_products || []).map((p, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{p.name}</td>
                              <td>{formatCurrency(p.revenue)}</td>
                              <td>{p.quantity_sold}</td>
                              <td>{p.quantity_sold > 0 ? formatCurrency(p.revenue / p.quantity_sold) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ====== FARMER PERFORMANCE TAB ====== */}
              {activeTab === 'farmers' && reports && (
                <div className="reports-section">
                  <div className="chart-card">
                    <h3><i className="fas fa-chart-bar"></i> Top Farmers by Revenue</h3>
                    {topFarmersRows && topFarmersRows.length > 0 ? (
                      <ResponsiveContainer width="100%" height={Math.max(300, topFarmersRows.length * 50)}>
                        <BarChart data={topFarmersRows} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis type="number" tickFormatter={(v) => `₱${v.toLocaleString()}`} tick={{ fontSize: 12 }} />
                          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                          <Tooltip formatter={(val) => formatCurrency(val)} />
                          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue">
                            {topFarmersRows.map((entry, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="no-data">No farmer revenue data available yet</div>
                    )}
                    {topFarmersRows.length > 0 && (
                      <div className="chart-interpretation">
                        {adminChartInterpretations.topFarmers.map((line, idx) => <p key={idx}>{line}</p>)}
                      </div>
                    )}
                  </div>

                  {/* Farmer Revenue Table */}
                  <div className="chart-card">
                    <h3><i className="fas fa-list-ol"></i> Farmer Revenue Ranking</h3>
                    <div className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            <th>Rank</th>
                            <th>Farmer</th>
                            <th>Revenue Generated</th>
                            <th>% of Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(reports.top_farmers || []).map((f, i) => {
                            const totalFarmerRev = reports.top_farmers.reduce((s, x) => s + x.revenue, 0);
                            return (
                              <tr key={i}>
                                <td>
                                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                </td>
                                <td>{f.name}</td>
                                <td>{formatCurrency(f.revenue)}</td>
                                <td>{totalFarmerRev > 0 ? ((f.revenue / totalFarmerRev) * 100).toFixed(1) : 0}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ====== MANAGEMENT TAB ====== */}
              {activeTab === 'manage' && (
                <div className="admin-actions-section">
                  <h2><i className="fas fa-cogs"></i> Management Tools</h2>
                  <div className="admin-actions-grid">
                    <Link to="/permit-verification-dashboard" className="action-card">
                      <div className="action-icon"><i className="fas fa-check-circle"></i></div>
                      <div className="action-info">
                        <h3>Permit Verification</h3>
                        <p>Review and approve business permit verifications</p>
                        <span className="action-badge">{stats.pendingVerifications} pending</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/orders" className="action-card">
                      <div className="action-icon"><i className="fas fa-receipt"></i></div>
                      <div className="action-info">
                        <h3>View Orders</h3>
                        <p>Monitor and manage customer orders</p>
                        <span className="action-badge">{stats.totalOrders} orders</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/products" className="action-card">
                      <div className="action-icon"><i className="fas fa-list"></i></div>
                      <div className="action-info">
                        <h3>Browse Products</h3>
                        <p>Review all products in the system</p>
                        <span className="action-badge">{stats.totalProducts} products</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/farmers" className="action-card">
                      <div className="action-icon"><i className="fas fa-users"></i></div>
                      <div className="action-info">
                        <h3>Manage Farmers</h3>
                        <p>View registered farmers and their details</p>
                        <span className="action-badge">{stats.totalFarmers} farmers</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/dti-prices" className="action-card">
                      <div className="action-icon"><i className="fas fa-chart-line"></i></div>
                      <div className="action-info">
                        <h3>DTI Price Management</h3>
                        <p>Upload DTI SRP records and manage price suggestions for farmers</p>
                        <span className="action-badge">SRP Engine</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/price-trends" className="action-card">
                      <div className="action-icon"><i className="fas fa-chart-area"></i></div>
                      <div className="action-info">
                        <h3>Price Trends &amp; Forecast</h3>
                        <p>View historical price trends and predicted future prices</p>
                        <span className="action-badge">Prediction</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/admin-riders" className="action-card">
                      <div className="action-icon"><i className="fas fa-motorcycle"></i></div>
                      <div className="action-info">
                        <h3>Manage Riders</h3>
                        <p>Create and update rider profiles and their service areas</p>
                        <span className="action-badge">{stats.activeRiders} active</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/admin-users" className="action-card">
                      <div className="action-icon"><i className="fas fa-users-cog"></i></div>
                      <div className="action-info">
                        <h3>User Management</h3>
                        <p>View all users, activate/deactivate accounts, filter by role</p>
                        <span className="action-badge">Manage</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/admin-reports" className="action-card">
                      <div className="action-icon"><i className="fas fa-file-pdf"></i></div>
                      <div className="action-info">
                        <h3>Printable Reports</h3>
                        <p>Generate table-based reports for printing or saving as PDF</p>
                        <span className="action-badge">PDF Export</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>

                    <Link to="/admin-reviews" className="action-card">
                      <div className="action-icon"><i className="fas fa-star"></i></div>
                      <div className="action-info">
                        <h3>Customer Reviews</h3>
                        <p>View and moderate all product reviews and ratings</p>
                        <span className="action-badge">Reviews</span>
                      </div>
                      <div className="action-arrow"><i className="fas fa-chevron-right"></i></div>
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <style>{`
        .admin-dashboard-page {
          min-height: 100vh;
          background: #f4f6f9;
        }

        .admin-content {
          padding: 30px 20px;
          max-width: 1300px;
          margin: 0 auto;
        }

        /* ── KPI Cards ── */
        .admin-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
          gap: 18px;
          margin-bottom: 30px;
        }

        .stat-card {
          background: linear-gradient(180deg, #ffffff 0%, #f8fff8 100%);
          border-radius: 12px;
          padding: 18px 22px;
          box-shadow: 0 6px 18px rgba(16,24,40,0.06);
          display: flex;
          align-items: center;
          gap: 18px;
          transition: transform .2s, box-shadow .2s;
          border: 1px solid rgba(44,122,44,0.06);
        }
        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 28px rgba(16,24,40,0.10);
        }

        .stat-icon {
          font-size: 1.6rem;
          width: 56px; height: 56px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 8px 20px rgba(16,24,40,0.07);
          border: 1px solid rgba(16,24,40,0.04);
        }

        .stat-number {
          font-size: 1.6rem;
          font-weight: 800;
          color: #14532d;
        }

        .stat-label {
          font-size: .85rem;
          color: #444;
          margin-top: 2px;
          font-weight: 600;
        }

        .stat-sub {
          font-size: .78rem;
          color: #6b7280;
          margin-top: 2px;
        }

        .stat-trend {
          font-size: .78rem;
          margin-top: 3px;
          font-weight: 600;
        }
        .stat-trend.up { color: #2e7d32; }
        .stat-trend.down { color: #c62828; }

        /* ── Tabs ── */
        .report-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 24px;
          border-bottom: 2px solid #e0e0e0;
          padding-bottom: 0;
          flex-wrap: wrap;
        }

        .report-tab {
          padding: 12px 22px;
          border: none;
          background: transparent;
          font-size: .95rem;
          color: #666;
          cursor: pointer;
          border-bottom: 3px solid transparent;
          margin-bottom: -2px;
          transition: all .2s;
          border-radius: 8px 8px 0 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .report-tab:hover { color: #2c7a2c; background: #f0f7f0; }
        .report-tab.active {
          color: #2c7a2c;
          font-weight: 600;
          border-bottom-color: #2c7a2c;
          background: #f0f7f0;
        }

        /* ── Period Selector ── */
        .period-selector {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          font-size: .9rem;
          color: #666;
        }

        .period-btn {
          padding: 6px 16px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 20px;
          cursor: pointer;
          font-size: .85rem;
          transition: all .2s;
        }
        .period-btn:hover { border-color: #2c7a2c; color: #2c7a2c; }
        .period-btn.active {
          background: #2c7a2c;
          color: white;
          border-color: #2c7a2c;
        }

        /* ── Chart Cards ── */
        .chart-card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          margin-bottom: 20px;
        }

        .chart-card h3 {
          font-size: 1.05rem;
          color: #333;
          margin: 0 0 18px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .chart-card h3 i { color: #2c7a2c; }

        .chart-interpretation {
          margin-top: 12px;
          padding: 10px 12px;
          border-left: 4px solid #2c7a2c;
          background: #f0f7f0;
          border-radius: 6px;
          font-size: .86rem;
          color: #334155;
          line-height: 1.45;
        }

        .chart-interpretation p {
          margin: 0 0 6px;
        }

        .chart-interpretation p:last-child {
          margin-bottom: 0;
        }

        .chart-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .chart-card.half { margin-bottom: 0; }

        .no-data {
          text-align: center;
          padding: 60px 20px;
          color: #aaa;
          font-size: .95rem;
        }

        /* ── Report Table ── */
        .report-table-wrap {
          overflow-x: auto;
        }

        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: .9rem;
        }

        .report-table th {
          text-align: left;
          padding: 12px 14px;
          background: #f8f9fa;
          color: #555;
          font-weight: 600;
          border-bottom: 2px solid #e0e0e0;
          white-space: nowrap;
        }

        .report-table td {
          padding: 11px 14px;
          border-bottom: 1px solid #f0f0f0;
          color: #333;
        }

        .report-table tbody tr:hover { background: #f9fef9; }

        /* ── Recent Orders ── */
        .recent-orders-list {
          display: grid;
          gap: 10px;
        }

        .recent-order-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
        }

        .recent-order-id {
          font-weight: 700;
          color: #14532d;
        }

        .recent-order-date {
          font-size: 0.8rem;
          color: #6b7280;
          margin-top: 2px;
        }

        .recent-order-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 0.85rem;
        }

        .recent-order-meta a {
          color: #1b5e20;
          text-decoration: underline;
        }

        .recent-order-no-proof {
          color: #9ca3af;
          font-size: 0.8rem;
        }

        .recent-order-status {
          padding: 4px 10px;
          border-radius: 12px;
          background: #e8f5e9;
          color: #1b5e20;
          text-transform: capitalize;
          font-weight: 600;
          font-size: 0.75rem;
        }

        /* ── Actions ── */
        .admin-actions-section {
          margin-top: 10px;
        }

        .admin-actions-section h2 {
          font-size: 1.4rem;
          color: #333;
          margin-bottom: 22px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .admin-actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 18px;
        }

        .action-card {
          background: white;
          border-radius: 12px;
          padding: 22px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          display: flex;
          align-items: center;
          gap: 18px;
          text-decoration: none;
          color: inherit;
          transition: all .2s;
          border-left: 4px solid #2c7a2c;
        }
        .action-card:hover {
          transform: translateX(4px);
          box-shadow: 0 4px 14px rgba(0,0,0,0.1);
          background: #fafff9;
        }

        .action-icon {
          font-size: 1.6rem;
          color: #2c7a2c;
          width: 54px; height: 54px;
          background: #f0f7f0;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .action-info { flex: 1; min-width: 0; }
        .action-info h3 { font-size: 1.05rem; color: #333; margin-bottom: 4px; }
        .action-info p { font-size: .85rem; color: #666; margin: 0; }

        .action-badge {
          display: inline-block;
          background: #e8f5e9;
          color: #2c7a2c;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: .8rem;
          font-weight: 600;
          margin-top: 8px;
        }

        .action-arrow {
          color: #bbb;
          font-size: 1.1rem;
          flex-shrink: 0;
        }
        .action-card:hover .action-arrow { color: #2c7a2c; }

        .loading-spinner {
          text-align: center;
          padding: 60px 20px;
          font-size: 1.1rem;
          color: #666;
        }

        .reports-section { }

        @media (max-width: 768px) {
          .admin-stats-grid {
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }
          .stat-card { flex-direction: column; text-align: center; padding: 16px; }
          .stat-icon { width: 44px; height: 44px; font-size: 1.3rem; }
          .stat-number { font-size: 1.3rem; }
          .chart-row { grid-template-columns: 1fr; }
          .report-tabs { gap: 4px; }
          .report-tab { padding: 10px 14px; font-size: .85rem; }
          .action-card { flex-direction: column; text-align: center; }
          .action-arrow { display: none; }
        }
      `}</style>
    </div>
  );
};

export default AdminDashboard;
