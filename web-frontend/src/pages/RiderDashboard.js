import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const STATUS_COLORS = {
  delivered:      '#10b981',
  picked_up:      '#8b5cf6',
  on_the_way:     '#06b6d4',
  ready_for_ship: '#3b82f6',
  cancelled:      '#ef4444',
  pending:        '#f59e0b',
};

const PIE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#6366f1', '#ec4899'];

const PERIOD_OPTIONS = [
  { value: '7d',  label: 'Last 7 Days' },
  { value: '14d', label: 'Last 14 Days' },
  { value: '30d', label: 'Last Month' },
  { value: '3m',  label: 'Last 3 Months' },
  { value: '6m',  label: 'Last 6 Months' },
  { value: '1y',  label: 'Last Year' },
  { value: 'all', label: 'All Time' },
];

const RiderDashboard = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('7d');

  const loadDashboard = useCallback(async (selectedPeriod) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await ordersAPI.getRiderDashboard(selectedPeriod || period);
      setDashboard(res.data);
    } catch (err) {
      console.error('[RiderDashboard] Load error:', err);
      setError(err?.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role === 'rider') {
      loadDashboard(period);
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading, period]);

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
  };

  const formatCurrency = (val) =>
    `₱${Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const getStatusLabel = (key) => {
    const map = {
      delivered: 'Delivered',
      picked_up: 'Picked Up',
      on_the_way: 'On the Way',
      ready_for_ship: 'Ready for Pickup',
      cancelled: 'Cancelled',
      pending: 'Pending',
    };
    return map[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  if (!user || user.role !== 'rider') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>This page is only available for riders.</p>
        <Link to="/" style={{ color: '#2c7a2c', fontWeight: 600 }}>Go Home</Link>
      </div>
    );
  }

  const stats = dashboard?.stats || {};
  const today = dashboard?.today || {};
  const periodStats = dashboard?.period_stats || {};
  const periodLabel = dashboard?.period_label || 'Last 7 Days';
  const dailyChart = dashboard?.daily_chart || [];
  const statusDist = dashboard?.status_distribution || [];
  const recentOrders = dashboard?.recent_orders || [];

  const riderChartInterpretations = {
    deliveries: (() => {
      const totalAssigned = dailyChart.reduce((sum, row) => sum + (row.orders || 0), 0);
      const totalDelivered = dailyChart.reduce((sum, row) => sum + (row.delivered || 0), 0);
      const completion = totalAssigned > 0 ? (totalDelivered / totalAssigned) * 100 : 0;
      return [
        `${periodLabel} shows ${totalAssigned} assigned deliveries with ${totalDelivered} completed.`,
        `Current chart completion is ${completion.toFixed(1)}%, indicating how closely execution tracks demand.`,
        `This trend helps decide when to rebalance workloads to protect on-time delivery performance.`
      ];
    })(),
    status: (() => {
      const total = statusDist.reduce((sum, row) => sum + (row.value || 0), 0);
      const top = [...statusDist].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
      const share = total > 0 ? ((top?.value || 0) / total) * 100 : 0;
      return [
        `${total} active records are split across ${statusDist.length} delivery status categories.`,
        `${top?.name || 'Top status'} leads at ${share.toFixed(1)}% of the current status mix.`,
        `The distribution points to where operational follow-up can move more orders toward completion.`
      ];
    })(),
    value: (() => {
      const total = dailyChart.reduce((sum, row) => sum + (row.value || 0), 0);
      const average = dailyChart.length > 0 ? total / dailyChart.length : 0;
      const peak = Math.max(...dailyChart.map((row) => row.value || 0), 0);
      return [
        `${periodLabel} delivery value totals ${formatCurrency(total)} across the charted days.`,
        `Average daily value is ${formatCurrency(average)} with a peak of ${formatCurrency(peak)}.`,
        `This value trend supports daily target setting and helps identify high-impact delivery windows.`
      ];
    })(),
  };

  return (
    <div className="rd-page">
      <Navbar activePage="rider-dashboard" />

      {/* Hero */}
      <section className="rd-hero">
        <div className="rd-hero-inner">
          <div className="rd-hero-left">
            <h1>Rider Dashboard</h1>
            <p>Welcome back, <strong>{dashboard?.rider_name || user?.first_name || 'Rider'}</strong>! Here's your delivery overview.</p>
          </div>
          <div className="rd-hero-actions" style={{ display: 'flex', gap: '10px' }}>
            <Link to="/rider-printable-reports" className="rd-hero-btn" style={{ background: 'transparent', border: '1px solid white', color: 'white' }}>
              Printable Reports
            </Link>
            <Link to="/rider-route-map" className="rd-hero-btn" style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid white', color: 'white' }}>
              🗺️ Route Map
            </Link>
            <Link to="/rider-orders" className="rd-hero-btn">
              View All Orders
            </Link>
          </div>
        </div>
      </section>

      <div className="rd-body">
        {isLoading ? (
          <div className="rd-loading">
            Loading dashboard…
          </div>
        ) : error ? (
          <div className="rd-error">
            <h3>Could not load dashboard</h3>
            <p>{error}</p>
            <button className="rd-btn rd-btn--primary" onClick={loadDashboard}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* ─── Today highlight strip ─── */}
            <div className="rd-today-strip">
              <div className="rd-today-label">Today</div>
              <div className="rd-today-stats">
                <div className="rd-today-item">
                  <span className="rd-today-val">{today.orders}</span>
                  <span className="rd-today-lbl">Orders</span>
                </div>
                <div className="rd-today-divider" />
                <div className="rd-today-item">
                  <span className="rd-today-val">{today.delivered}</span>
                  <span className="rd-today-lbl">Delivered</span>
                </div>
                <div className="rd-today-divider" />
                <div className="rd-today-item">
                  <span className="rd-today-val">{formatCurrency(today.value)}</span>
                  <span className="rd-today-lbl">Value</span>
                </div>
              </div>
            </div>

            {/* ─── KPI Cards ─── */}
            <div className="rd-kpi-grid">
              <div className="rd-kpi rd-kpi--total">
                <div className="rd-kpi-icon" style={{ background: '#2563eb' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{stats.total_orders}</div>
                  <div className="rd-kpi-label">Total Deliveries</div>
                  <div className="rd-kpi-sub">{stats.active} active now</div>
                </div>
              </div>

              <div className="rd-kpi rd-kpi--delivered">
                <div className="rd-kpi-icon" style={{ background: '#059669' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{stats.delivered}</div>
                  <div className="rd-kpi-label">Completed</div>
                  <div className="rd-kpi-sub">{stats.cancelled} cancelled</div>
                </div>
              </div>

              <div className="rd-kpi rd-kpi--rate">
                <div className="rd-kpi-icon" style={{ background: '#7c3aed' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{stats.completion_rate}%</div>
                  <div className="rd-kpi-label">Completion Rate</div>
                  <div className="rd-kpi-sub">{stats.total_orders - stats.delivered - stats.cancelled} in progress</div>
                </div>
              </div>

              <div className="rd-kpi rd-kpi--value">
                <div className="rd-kpi-icon" style={{ background: '#d97706' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{formatCurrency(stats.delivered_value)}</div>
                  <div className="rd-kpi-label">Delivered Value</div>
                  <div className="rd-kpi-sub">Total: {formatCurrency(stats.total_value)}</div>
                </div>
              </div>

              <div className="rd-kpi rd-kpi--active">
                <div className="rd-kpi-icon" style={{ background: '#0891b2' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{stats.active}</div>
                  <div className="rd-kpi-label">Active Deliveries</div>
                  <div className="rd-kpi-sub">
                    {stats.ready_for_ship} pickup · {stats.picked_up} picked · {stats.on_the_way} en route
                  </div>
                </div>
              </div>

              <div className="rd-kpi rd-kpi--week">
                <div className="rd-kpi-icon" style={{ background: '#be185d' }}>
                </div>
                <div className="rd-kpi-info">
                  <div className="rd-kpi-val">{periodStats.delivered}/{periodStats.orders}</div>
                  <div className="rd-kpi-label">{periodLabel}</div>
                  <div className="rd-kpi-sub">{formatCurrency(periodStats.value)} delivered</div>
                </div>
              </div>
            </div>

            {/* ─── Time Range Selector ─── */}
            <div className="rd-period-selector">
              <span className="rd-period-label">Timeline:</span>
              <div className="rd-period-options">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`rd-period-btn${period === opt.value ? ' rd-period-btn--active' : ''}`}
                    onClick={() => handlePeriodChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ─── Charts Row ─── */}
            <div className="rd-charts-row">
              {/* Daily deliveries area chart */}
              <div className="rd-chart-card rd-chart-card--wide">
                <h3 className="rd-chart-title">{periodLabel} — Deliveries</h3>
                {dailyChart.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={dailyChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" fontSize={12} tick={{ fill: '#64748b' }} />
                        <YAxis allowDecimals={false} fontSize={12} tick={{ fill: '#64748b' }} />
                        <Tooltip
                          contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
                          formatter={(val, name) => [val, name === 'orders' ? 'Assigned' : 'Delivered']}
                        />
                        <Area type="monotone" dataKey="orders" stroke="#3b82f6" fillOpacity={1} fill="url(#gradOrders)" strokeWidth={2} name="orders" />
                        <Area type="monotone" dataKey="delivered" stroke="#10b981" fillOpacity={1} fill="url(#gradDelivered)" strokeWidth={2} name="delivered" />
                      </AreaChart>
                    </ResponsiveContainer>
                    <div className="rd-chart-interpretation">
                      {riderChartInterpretations.deliveries.map((line, idx) => <p key={idx}>{line}</p>)}
                    </div>
                  </>
                ) : (
                  <div className="rd-chart-empty">No data yet</div>
                )}
              </div>

              {/* Status distribution pie */}
              <div className="rd-chart-card">
                <h3 className="rd-chart-title">Status Breakdown</h3>
                {statusDist.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={statusDist}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {statusDist.map((entry, idx) => (
                            <Cell
                              key={`cell-${idx}`}
                              fill={STATUS_COLORS[entry.key] || PIE_COLORS[idx % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val, name) => [val, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="rd-legend">
                      {statusDist.map((entry, idx) => (
                        <div key={entry.key} className="rd-legend-item">
                          <span
                            className="rd-legend-dot"
                            style={{ background: STATUS_COLORS[entry.key] || PIE_COLORS[idx % PIE_COLORS.length] }}
                          />
                          <span className="rd-legend-label">{entry.name}</span>
                          <span className="rd-legend-val">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="rd-chart-interpretation">
                      {riderChartInterpretations.status.map((line, idx) => <p key={idx}>{line}</p>)}
                    </div>
                  </>
                ) : (
                  <div className="rd-chart-empty">No orders yet</div>
                )}
              </div>
            </div>

            {/* ─── Daily value bar chart ─── */}
            <div className="rd-chart-card rd-chart-card--full">
              <h3 className="rd-chart-title">{periodLabel} — Delivery Value (₱)</h3>
              {dailyChart.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dailyChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" fontSize={12} tick={{ fill: '#64748b' }} />
                      <YAxis fontSize={12} tick={{ fill: '#64748b' }} tickFormatter={(v) => `₱${v}`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
                        formatter={(val) => [formatCurrency(val), 'Value']}
                      />
                      <Bar dataKey="value" fill="#2c7a2c" radius={[6, 6, 0, 0]} barSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="rd-chart-interpretation">
                    {riderChartInterpretations.value.map((line, idx) => <p key={idx}>{line}</p>)}
                  </div>
                </>
              ) : (
                <div className="rd-chart-empty">No data yet</div>
              )}
            </div>

            {/* ─── Recent Orders Table ─── */}
            <div className="rd-recent-card">
              <div className="rd-recent-header">
                <h3 className="rd-chart-title">Recent Deliveries</h3>
                <Link to="/rider-orders" className="rd-view-all">View All →</Link>
              </div>
              {recentOrders.length > 0 ? (
                <div className="rd-table-wrap">
                  <table className="rd-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Buyer</th>
                        <th>Items</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => {
                        const statusKey = order.status || 'pending';
                        return (
                          <tr key={order.id}>
                            <td className="rd-cell-id">#{order.id.substring(0, 6).toUpperCase()}</td>
                            <td>{order.buyer_name}</td>
                            <td style={{ textAlign: 'center' }}>{order.items_count}</td>
                            <td className="rd-cell-amount">{formatCurrency(order.total_amount)}</td>
                            <td>
                              <span
                                className="rd-status-badge"
                                style={{
                                  background: (STATUS_COLORS[statusKey] || '#9ca3af') + '18',
                                  color: STATUS_COLORS[statusKey] || '#6b7280',
                                  borderColor: (STATUS_COLORS[statusKey] || '#9ca3af') + '40',
                                }}
                              >
                                {getStatusLabel(statusKey)}
                              </span>
                            </td>
                            <td className="rd-cell-date">
                              {order.created_at
                                ? new Date(order.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rd-chart-empty" style={{ padding: '40px 20px' }}>No deliveries yet</div>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        .rd-page {
          min-height: 100vh;
          background: radial-gradient(circle at top left, #e8f5e9 0%, #f4f6f9 45%, #fefcfb 100%);
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
          display: flex;
          flex-direction: column;
        }

        /* ─── Hero ─── */
        .rd-hero {
          background: linear-gradient(135deg, #1a5f1a 0%, #2c7a2c 60%, #38a03a 100%);
          padding: 32px 0 28px;
          color: #fff;
        }
        .rd-hero-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
        }
        .rd-hero-left h1 {
          margin: 0 0 6px;
          font-size: 1.75rem;
          font-weight: 800;
          color: #fff;
        }
        .rd-hero-left p {
          margin: 0;
          font-size: 0.95rem;
          color: rgba(255,255,255,0.82);
        }
        .rd-hero-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 22px;
          background: rgba(255,255,255,0.15);
          border: 1.5px solid rgba(255,255,255,0.3);
          border-radius: 10px;
          color: #fff;
          font-weight: 700;
          font-size: 0.9rem;
          text-decoration: none;
          transition: background 0.15s, border-color 0.15s;
        }
        .rd-hero-btn:hover { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.5); }

        /* ─── Body ─── */
        .rd-body {
          max-width: 1200px;
          margin: 0 auto;
          padding: 28px 24px 60px;
          width: 100%;
          box-sizing: border-box;
        }

        /* ─── Loading / Error ─── */
        .rd-loading {
          text-align: center;
          padding: 80px 20px;
          color: #64748b;
          font-size: 1.05rem;
        }
        .rd-error {
          text-align: center;
          padding: 80px 20px;
          color: #94a3b8;
        }
        .rd-error h3 { color: #475569; margin: 0 0 8px; }
        .rd-error p { margin: 0 0 16px; }

        /* ─── Today Strip ─── */
        .rd-today-strip {
          display: flex;
          align-items: center;
          gap: 24px;
          background: linear-gradient(135deg, #fffbeb, #fef3c7);
          border: 1px solid #fcd34d;
          border-radius: 14px;
          padding: 16px 24px;
          margin-bottom: 24px;
        }
        .rd-today-label {
          font-size: 0.85rem;
          font-weight: 800;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .rd-today-stats {
          display: flex;
          align-items: center;
          gap: 20px;
          flex: 1;
          justify-content: center;
        }
        .rd-today-item { display: flex; flex-direction: column; align-items: center; }
        .rd-today-val { font-size: 1.4rem; font-weight: 800; color: #78350f; line-height: 1.1; }
        .rd-today-lbl { font-size: 0.72rem; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
        .rd-today-divider { width: 1px; height: 32px; background: #fbbf24; opacity: 0.5; }

        /* ─── KPI Grid ─── */
        .rd-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
          margin-bottom: 28px;
        }
        .rd-kpi {
          background: #fff;
          border-radius: 16px;
          padding: 20px;
          display: flex;
          align-items: flex-start;
          gap: 16px;
          box-shadow: 0 2px 12px rgba(15,23,42,0.06);
          border: 1px solid #f1f5f9;
          transition: box-shadow 0.2s, transform 0.15s;
        }
        .rd-kpi:hover {
          box-shadow: 0 6px 24px rgba(15,23,42,0.10);
          transform: translateY(-2px);
        }
        .rd-kpi-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 1.1rem;
          flex-shrink: 0;
        }
        .rd-kpi-info { min-width: 0; }
        .rd-kpi-val {
          font-size: 1.5rem;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.15;
        }
        .rd-kpi-label {
          font-size: 0.82rem;
          color: #64748b;
          font-weight: 600;
          margin-top: 2px;
        }
        .rd-kpi-sub {
          font-size: 0.73rem;
          color: #94a3b8;
          margin-top: 3px;
        }

        /* ─── Period Selector ─── */
        .rd-period-selector {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
          background: #fff;
          border-radius: 14px;
          padding: 14px 20px;
          box-shadow: 0 2px 12px rgba(15,23,42,0.06);
          border: 1px solid #f1f5f9;
          flex-wrap: wrap;
        }
        .rd-period-label {
          font-size: 0.82rem;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .rd-period-options {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .rd-period-btn {
          padding: 7px 14px;
          border-radius: 8px;
          border: 1.5px solid #e2e8f0;
          background: #f8fafc;
          color: #475569;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: inherit;
          white-space: nowrap;
        }
        .rd-period-btn:hover {
          border-color: #2c7a2c;
          color: #2c7a2c;
          background: #f0fdf4;
        }
        .rd-period-btn--active {
          background: #2c7a2c;
          color: #fff;
          border-color: #2c7a2c;
        }
        .rd-period-btn--active:hover {
          background: #1a5c1a;
          border-color: #1a5c1a;
          color: #fff;
        }

        /* ─── Charts ─── */
        .rd-charts-row {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 18px;
          margin-bottom: 18px;
        }
        .rd-chart-card {
          background: #fff;
          border-radius: 16px;
          padding: 22px;
          box-shadow: 0 2px 12px rgba(15,23,42,0.06);
          border: 1px solid #f1f5f9;
        }
        .rd-chart-card--wide { }
        .rd-chart-card--full {
          margin-bottom: 18px;
        }
        .rd-chart-title {
          font-size: 0.92rem;
          font-weight: 700;
          color: #1e293b;
          margin: 0 0 16px;
        }
        .rd-chart-empty {
          text-align: center;
          padding: 50px 20px;
          color: #94a3b8;
          font-size: 0.9rem;
        }

        .rd-chart-interpretation {
          margin-top: 10px;
          padding: 10px 12px;
          border-left: 4px solid #2c7a2c;
          background: #f0f7f0;
          border-radius: 6px;
          font-size: .85rem;
          color: #334155;
          line-height: 1.45;
        }

        .rd-chart-interpretation p {
          margin: 0 0 6px;
        }

        .rd-chart-interpretation p:last-child {
          margin-bottom: 0;
        }

        /* Pie legend */
        .rd-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          margin-top: 8px;
          justify-content: center;
        }
        .rd-legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78rem;
          color: #475569;
        }
        .rd-legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .rd-legend-val { font-weight: 700; color: #1e293b; }

        /* ─── Recent Orders ─── */
        .rd-recent-card {
          background: #fff;
          border-radius: 16px;
          padding: 22px;
          box-shadow: 0 2px 12px rgba(15,23,42,0.06);
          border: 1px solid #f1f5f9;
        }
        .rd-recent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .rd-view-all {
          font-size: 0.82rem;
          color: #2c7a2c;
          font-weight: 700;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .rd-view-all:hover { text-decoration: underline; }
        .rd-table-wrap { overflow-x: auto; }
        .rd-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.88rem;
        }
        .rd-table th {
          text-align: left;
          font-size: 0.72rem;
          font-weight: 700;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 8px 12px;
          border-bottom: 2px solid #f1f5f9;
        }
        .rd-table td {
          padding: 12px;
          border-bottom: 1px solid #f8fafc;
          color: #334155;
          vertical-align: middle;
        }
        .rd-table tbody tr:hover { background: #f8fafc; }
        .rd-cell-id {
          font-family: monospace;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: .03em;
        }
        .rd-cell-amount { font-weight: 700; color: #0f172a; }
        .rd-cell-date { font-size: 0.82rem; color: #94a3b8; white-space: nowrap; }
        .rd-status-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          white-space: nowrap;
          border: 1px solid;
        }

        /* ─── Buttons ─── */
        .rd-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 9px 18px;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: background 0.15s, transform 0.1s;
          font-family: inherit;
        }
        .rd-btn--primary { background: #2c7a2c; color: #fff; }
        .rd-btn--primary:hover { background: #1a5c1a; transform: translateY(-1px); }

        /* ─── Responsive ─── */
        @media (max-width: 900px) {
          .rd-charts-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .rd-hero-inner { flex-direction: column; align-items: flex-start; }
          .rd-kpi-grid { grid-template-columns: 1fr; }
          .rd-today-strip { flex-direction: column; gap: 12px; }
          .rd-today-stats { flex-wrap: wrap; }
          .rd-table { font-size: 0.8rem; }
          .rd-table th, .rd-table td { padding: 8px 6px; }
          .rd-period-selector { flex-direction: column; align-items: flex-start; gap: 10px; padding: 12px 14px; }
          .rd-period-options { gap: 5px; }
          .rd-period-btn { padding: 6px 10px; font-size: 0.74rem; }
        }
      `}</style>
    </div>
  );
};

export default RiderDashboard;
