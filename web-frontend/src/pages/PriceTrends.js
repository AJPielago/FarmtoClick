import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dtiAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Area, ComposedChart
} from 'recharts';

const PriceTrends = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Trendable product list
  const [trendableProducts, setTrendableProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Search / selection
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [forecastDays, setForecastDays] = useState(30);

  // Trend result
  const [trendData, setTrendData] = useState(null);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [error, setError] = useState('');

  // Accuracy report
  const [accuracyData, setAccuracyData] = useState(null);
  const [loadingAccuracy, setLoadingAccuracy] = useState(false);

  // Load products that have enough historical data
  const loadTrendableProducts = useCallback(async () => {
    try {
      setLoadingProducts(true);
      const res = await dtiAPI.getTrendableProducts(100);
      setTrendableProducts(res.data?.products || []);
    } catch (err) {
      console.error('Failed to load trendable products:', err);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadTrendableProducts();
  }, [user, loadTrendableProducts]);

  // Fetch trend data for the selected product
  const fetchTrend = useCallback(async (productName) => {
    if (!productName) return;
    try {
      setLoadingTrend(true);
      setError('');
      setAccuracyData(null);
      const res = await dtiAPI.getPriceTrends(productName, forecastDays);
      if (res.data?.found) {
        setTrendData(res.data);
        // Also load accuracy report in background (admin only)
        if (user?.role === 'admin') {
          setLoadingAccuracy(true);
          dtiAPI.getPredictionAccuracy(productName)
            .then(accRes => {
              // Only set data if we have actual comparison stats
              if (accRes.data?.found && accRes.data?.comparisons?.length > 0) {
                setAccuracyData(accRes.data);
              }
            })
            .catch(err => console.error('Accuracy report error:', err))
            .finally(() => setLoadingAccuracy(false));
        }
      } else {
        setTrendData(null);
        setError(res.data?.message || 'No trend data found for this product.');
      }
    } catch (err) {
      console.error('Trend fetch error:', err);
      setError('Failed to fetch price trends.');
      setTrendData(null);
    } finally {
      setLoadingTrend(false);
    }
  }, [forecastDays, user]);

  const handleProductSelect = (name) => {
    setSelectedProduct(name);
    fetchTrend(name);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSelectedProduct(searchQuery.trim());
      fetchTrend(searchQuery.trim());
    }
  };

  // Build combined chart data (history + forecast)
  const chartData = (() => {
    if (!trendData) return [];
    const data = [];

    // Historical data points
    (trendData.history || []).forEach((h) => {
      data.push({
        date: h.date,
        label: formatDate(h.date),
        price: h.average_price,
        low: h.price_low,
        high: h.price_high,
        type: 'history',
      });
    });

    // Bridge: last history point also appears as first forecast so line is connected
    if (trendData.history?.length && trendData.forecast?.length) {
      const last = trendData.history[trendData.history.length - 1];
      data[data.length - 1].predicted = last.average_price;
    }

    // Forecast data points
    (trendData.forecast || []).forEach((f) => {
      data.push({
        date: f.date,
        label: formatDate(f.date),
        predicted: f.predicted_price,
        type: 'forecast',
      });
    });

    return data;
  })();

  // Filtered product list for the sidebar
  const filteredProducts = trendableProducts.filter((p) =>
    !searchQuery || p.product_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!user) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h1>Login Required</h1>
        <p>Please log in to view price trends.</p>
        <Link to="/login" className="btn btn-primary">Login</Link>
      </div>
    );
  }

  return (
    <div className="manage-products-page">
      <Navbar />

      <div style={{ padding: '12px 20px' }}>
        <Link to="/admin-dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#2c7a2c', textDecoration: 'none', fontWeight: 600 }}>
          <i className="fas fa-arrow-left"></i> Admin Dashboard
        </Link>
      </div>

      <section className="products-page">
        <div className="container" style={{ maxWidth: 1200 }}>
          <h1 style={{ marginBottom: 4 }}>
            <i className="fas fa-chart-line" style={{ color: '#4CAF50', marginRight: 10 }}></i>
            Price Trends &amp; Forecast
          </h1>
          <p style={{ color: '#666', marginBottom: 24 }}>
            {isAdmin
              ? 'View historical DTI price data and predicted future prices based on trend analysis.'
              : 'Check current and expected prices for common goods based on official DTI records.'}
          </p>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* LEFT: Product picker */}
            <div style={{ flex: '0 0 300px', maxWidth: 300 }}>
              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 12px' }}>
                  <i className="fas fa-search"></i> Find a Product
                </h3>

                <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    type="text"
                    placeholder="Search product…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={inputStyle}
                  />
                  <button type="submit" className="btn btn-primary" style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}>
                    <i className="fas fa-arrow-right"></i>
                  </button>
                </form>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: '0.85rem', color: '#555', fontWeight: 600 }}>
                    Forecast range
                  </label>
                  <select
                    value={forecastDays}
                    onChange={(e) => setForecastDays(Number(e.target.value))}
                    style={{ ...inputStyle, marginTop: 4 }}
                  >
                    <option value={7}>Next 7 days</option>
                    <option value={14}>Next 14 days</option>
                    <option value={30}>Next 30 days</option>
                    <option value={60}>Next 60 days</option>
                    <option value={90}>Next 90 days</option>
                  </select>
                </div>

                <h4 style={{ margin: '16px 0 8px', fontSize: '0.9rem', color: '#555' }}>
                  Products with trend data {loadingProducts && <i className="fas fa-spinner fa-spin"></i>}
                </h4>

                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {filteredProducts.length === 0 && !loadingProducts && (
                    <p style={{ color: '#999', fontSize: '0.85rem' }}>
                      {trendableProducts.length === 0
                        ? 'No products have enough historical data yet. Upload DTI price records from multiple dates.'
                        : 'No products match your search.'}
                    </p>
                  )}
                  {filteredProducts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => handleProductSelect(p.product_name)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '10px 12px', marginBottom: 4, border: '1px solid #eee',
                        borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem',
                        background: selectedProduct === p.product_name ? '#e8f5e9' : '#fff',
                        borderColor: selectedProduct === p.product_name ? '#4CAF50' : '#eee',
                        transition: 'all 0.15s',
                      }}
                    >
                      <strong>{p.product_name}</strong>
                      <span style={{ float: 'right', color: '#888', fontSize: '0.8rem' }}>
                        ₱{p.latest_price?.toFixed(2)} · {p.data_points} dates
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT: Chart & stats */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {loadingTrend ? (
                <div style={{ ...cardStyle, textAlign: 'center', padding: 60 }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#4CAF50' }}></i>
                  <p>Loading trend data…</p>
                </div>
              ) : error ? (
                <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
                  <i className="fas fa-exclamation-circle" style={{ fontSize: '2rem', color: '#e67e22', marginBottom: 12 }}></i>
                  <p style={{ color: '#e67e22' }}>{error}</p>
                </div>
              ) : trendData ? (
                <>
                  {/* Next Day Prediction Card */}
                  {trendData.next_day_price != null && (() => {
                    const nd = trendData;
                    const ndTrend = nd.next_day_trend;
                    const ndColor = ndTrend === 'up' ? '#f44336' : ndTrend === 'down' ? '#4CAF50' : '#FF9800';
                    const ndBg = ndTrend === 'up' ? 'linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%)' : ndTrend === 'down' ? 'linear-gradient(135deg, #f0faf0 0%, #d4edda 100%)' : 'linear-gradient(135deg, #fffbf0 0%, #fff3cd 100%)';
                    const ndIcon = ndTrend === 'up' ? 'fa-arrow-trend-up' : ndTrend === 'down' ? 'fa-arrow-trend-down' : 'fa-equals';
                    const ndDate = nd.next_day_date ? new Date(nd.next_day_date) : null;
                    const ndDateStr = ndDate ? ndDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Tomorrow';
                    return (
                      <div style={{
                        background: ndBg, border: `2px solid ${ndColor}33`,
                        borderRadius: 14, padding: '24px 28px', marginBottom: 20,
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* decorative icon */}
                        <i className={`fas ${ndIcon}`} style={{
                          position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
                          fontSize: '4rem', color: ndColor, opacity: 0.08,
                        }}></i>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: ndColor, color: '#fff', fontSize: '1rem',
                          }}>
                            <i className={`fas ${ndIcon}`}></i>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.78rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Next Day Price Prediction</div>
                            <div style={{ fontSize: '0.82rem', color: '#666' }}>{ndDateStr}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#222' }}>
                            ₱{nd.next_day_price?.toFixed(2)}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: '#888' }}>per {nd.unit}</div>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '5px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.95rem',
                            background: '#fff', color: ndColor,
                            border: `1px solid ${ndColor}44`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                          }}>
                            <i className={`fas ${ndTrend === 'up' ? 'fa-caret-up' : ndTrend === 'down' ? 'fa-caret-down' : 'fa-minus'}`}
                               style={{ fontSize: '1.1rem' }}></i>
                            {nd.next_day_change >= 0 ? '+' : ''}₱{nd.next_day_change?.toFixed(2)} ({nd.next_day_change_pct >= 0 ? '+' : ''}{nd.next_day_change_pct}%)
                          </div>
                        </div>
                        <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#999' }}>
                          <i className="fas fa-info-circle" style={{ marginRight: 4 }}></i>
                          Compared to current price of <strong>₱{nd.current_price?.toFixed(2)}</strong>&nbsp;
                          {ndTrend === 'up' ? '— price is expected to increase' : ndTrend === 'down' ? '— price is expected to decrease' : '— price is expected to remain stable'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Stats cards — shown to all users */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                    <StatCard
                      icon="fas fa-tag" color="#2196F3"
                      label="Current Price"
                      value={`₱${trendData.current_price?.toFixed(2)}`}
                      sub={`per ${trendData.unit}`}
                    />
                    <StatCard
                      icon="fas fa-forward" color="#E91E63"
                      label="Next Day"
                      value={`₱${trendData.next_day_price?.toFixed(2)}`}
                      sub={trendData.next_day_date ? new Date(trendData.next_day_date).toLocaleDateString() : 'Tomorrow'}
                    />
                    <StatCard
                      icon="fas fa-crystal-ball" color="#9C27B0"
                      label={`Predicted (${forecastDays}d)`}
                      value={`₱${trendData.predicted_price?.toFixed(2)}`}
                      sub={`per ${trendData.unit}`}
                    />
                    <StatCard
                      icon={trendData.trend === 'up' ? 'fas fa-arrow-up' : trendData.trend === 'down' ? 'fas fa-arrow-down' : 'fas fa-minus'}
                      color={trendData.trend === 'up' ? '#f44336' : trendData.trend === 'down' ? '#4CAF50' : '#FF9800'}
                      label="Trend"
                      value={`${trendData.trend_pct > 0 ? '+' : ''}${trendData.trend_pct}%`}
                      sub={trendData.trend === 'up' ? 'Price increasing' : trendData.trend === 'down' ? 'Price decreasing' : 'Relatively stable'}
                    />
                    {isAdmin && (
                    <StatCard
                      icon="fas fa-database" color="#607D8B"
                      label="Data Points"
                      value={trendData.data_points}
                      sub={`R² = ${trendData.confidence} · ${trendData.model === 'random_forest' ? 'RF Model' : 'Linear'}`}
                    />
                    )}
                  </div>

                  {/* ─── Basic-user friendly summary (non-admin) ─── */}
                  {!isAdmin && (() => {
                    const trend = trendData.trend;
                    const trendMsg = trend === 'up'
                      ? 'Prices are going up — consider buying sooner to save.'
                      : trend === 'down'
                        ? 'Prices are going down — you may get a better deal soon!'
                        : 'Prices are stable — good time to buy at a fair price.';
                    const trendIcon = trend === 'up' ? 'fa-arrow-trend-up' : trend === 'down' ? 'fa-arrow-trend-down' : 'fa-equals';
                    const trendColor = trend === 'up' ? '#f44336' : trend === 'down' ? '#4CAF50' : '#FF9800';
                    return (
                      <div style={{
                        ...cardStyle, marginTop: 20,
                        background: 'linear-gradient(135deg, #f0faf0 0%, #e8f5e9 100%)',
                        border: '1px solid #c8e6c9',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div style={{
                            width: 44, height: 44, borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: trendColor, color: '#fff', fontSize: '1.2rem',
                          }}>
                            <i className={`fas ${trendIcon}`}></i>
                          </div>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#333' }}>
                              <i className="fas fa-lightbulb" style={{ color: '#FFC107', marginRight: 8 }}></i>
                              What This Means for You
                            </h3>
                            <p style={{ margin: '4px 0 0', color: '#555', fontSize: '0.92rem' }}>{trendMsg}</p>
                          </div>
                        </div>
                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: 12, marginTop: 16,
                        }}>
                          <div style={{
                            background: '#fff', borderRadius: 10, padding: '14px 16px',
                            border: '1px solid #e0e0e0', textAlign: 'center',
                          }}>
                            <i className="fas fa-shopping-basket" style={{ color: '#4CAF50', fontSize: '1.3rem', marginBottom: 6 }}></i>
                            <div style={{ fontSize: '0.78rem', color: '#888', fontWeight: 600, marginBottom: 4 }}>Current Market Price</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#333' }}>₱{trendData.current_price?.toFixed(2)}</div>
                            <div style={{ fontSize: '0.75rem', color: '#999' }}>per {trendData.unit}</div>
                          </div>
                          <div style={{
                            background: '#fff', borderRadius: 10, padding: '14px 16px',
                            border: '1px solid #e0e0e0', textAlign: 'center',
                          }}>
                            <i className="fas fa-calendar-day" style={{ color: '#E91E63', fontSize: '1.3rem', marginBottom: 6 }}></i>
                            <div style={{ fontSize: '0.78rem', color: '#888', fontWeight: 600, marginBottom: 4 }}>Expected Tomorrow</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#333' }}>₱{trendData.next_day_price?.toFixed(2)}</div>
                            <div style={{ fontSize: '0.75rem', color: '#999' }}>
                              {trendData.next_day_date ? new Date(trendData.next_day_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Tomorrow'}
                            </div>
                          </div>
                          <div style={{
                            background: '#fff', borderRadius: 10, padding: '14px 16px',
                            border: '1px solid #e0e0e0', textAlign: 'center',
                          }}>
                            <i className="fas fa-chart-line" style={{ color: '#9C27B0', fontSize: '1.3rem', marginBottom: 6 }}></i>
                            <div style={{ fontSize: '0.78rem', color: '#888', fontWeight: 600, marginBottom: 4 }}>Expected in {forecastDays} Days</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#333' }}>₱{trendData.predicted_price?.toFixed(2)}</div>
                            <div style={{ fontSize: '0.75rem', color: '#999' }}>per {trendData.unit}</div>
                          </div>
                        </div>
                        <div style={{
                          marginTop: 16, padding: '10px 14px', background: '#fffde7',
                          borderRadius: 8, fontSize: '0.82rem', color: '#666',
                          border: '1px solid #fff9c4',
                        }}>
                          <i className="fas fa-info-circle" style={{ marginRight: 6, color: '#FFC107' }}></i>
                          These prices are based on official DTI (Department of Trade and Industry) price records. Actual store prices may vary.
                        </div>
                      </div>
                    );
                  })()}

                  {/* ─── Admin-only: Chart, History, Accuracy ─── */}
                  {isAdmin && (
                  <>
                  {/* Chart */}
                  <div style={cardStyle}>
                    <h3 style={{ margin: '0 0 16px' }}>
                      <i className="fas fa-chart-area" style={{ color: '#4CAF50', marginRight: 8 }}></i>
                      {trendData.product_name} — Price History &amp; Forecast
                    </h3>
                    <ResponsiveContainer width="100%" height={380}>
                      <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                        <XAxis
                          dataKey="label" tick={{ fontSize: 11 }}
                          interval={Math.max(0, Math.floor(chartData.length / 10))}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => `₱${v}`}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip content={<CustomTooltip unit={trendData.unit} />} />
                        <Legend />

                        {/* Shaded area between low and high (history only) */}
                        <Area
                          type="monotone" dataKey="high" stroke="none"
                          fill="#c8e6c9" fillOpacity={0.4} name="Price High"
                          connectNulls={false}
                        />
                        <Area
                          type="monotone" dataKey="low" stroke="none"
                          fill="#fff" fillOpacity={1} name="Price Low"
                          connectNulls={false}
                        />

                        {/* Actual price line */}
                        <Line
                          type="monotone" dataKey="price" stroke="#4CAF50"
                          strokeWidth={2.5} dot={{ r: 4 }} name="Actual Price"
                          connectNulls={false}
                        />

                        {/* Predicted price line */}
                        <Line
                          type="monotone" dataKey="predicted" stroke="#9C27B0"
                          strokeWidth={2.5} strokeDasharray="6 3"
                          dot={{ r: 3, fill: '#9C27B0' }} name="Predicted Price"
                          connectNulls
                        />

                        {/* Reference line at current price */}
                        <ReferenceLine
                          y={trendData.current_price} stroke="#FF9800"
                          strokeDasharray="4 4" label={{ value: 'Current', fill: '#FF9800', fontSize: 11 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>

                    <div style={{ marginTop: 12, padding: '12px 16px', background: '#f8f9fa', borderRadius: 8, fontSize: '0.85rem', color: '#555' }}>
                      <i className="fas fa-info-circle" style={{ marginRight: 6, color: '#2196F3' }}></i>
                      <strong>How it works:</strong> The forecast is calculated using linear regression on historical DTI
                      Suggested Retail Price records. The <em>R²</em> value indicates how well the model fits the data
                      (closer to 1 = better fit). Predictions are estimates and actual prices may vary.
                    </div>
                  </div>

                  {/* History table */}
                  <div style={{ ...cardStyle, marginTop: 20 }}>
                    <h3 style={{ margin: '0 0 12px' }}>
                      <i className="fas fa-history" style={{ color: '#607D8B', marginRight: 8 }}></i>
                      Historical Price Records
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                        <thead>
                          <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                            <th style={thStyle}>Date</th>
                            <th style={thStyle}>Low</th>
                            <th style={thStyle}>High</th>
                            <th style={thStyle}>Average</th>
                            <th style={thStyle}>Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(trendData.history || []).map((h, i, arr) => {
                            const prev = i > 0 ? arr[i - 1].average_price : null;
                            const change = prev !== null ? h.average_price - prev : null;
                            const changePct = prev ? ((change / prev) * 100).toFixed(1) : null;
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={tdStyle}>{new Date(h.date).toLocaleDateString()}</td>
                                <td style={tdStyle}>₱{h.price_low?.toFixed(2)}</td>
                                <td style={tdStyle}>₱{h.price_high?.toFixed(2)}</td>
                                <td style={tdStyle}><strong>₱{h.average_price?.toFixed(2)}</strong></td>
                                <td style={tdStyle}>
                                  {change !== null ? (
                                    <span style={{ color: change > 0 ? '#f44336' : change < 0 ? '#4CAF50' : '#999' }}>
                                      {change > 0 ? '▲' : change < 0 ? '▼' : '—'}{' '}
                                      ₱{Math.abs(change).toFixed(2)} ({changePct}%)
                                    </span>
                                  ) : (
                                    <span style={{ color: '#999' }}>—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ─── Prediction Accuracy Report ─── */}
                  <div style={{ ...cardStyle, marginTop: 20 }}>
                    <h3 style={{ margin: '0 0 4px' }}>
                      <i className="fas fa-bullseye" style={{ color: '#e91e63', marginRight: 8 }}></i>
                      Prediction Accuracy Report
                    </h3>
                    <p style={{ color: '#888', fontSize: '0.82rem', margin: '0 0 16px' }}>
                      Backtest: what the model <em>would have predicted</em> for each historical date vs. the actual price recorded.
                    </p>

                    {loadingAccuracy ? (
                      <div style={{ textAlign: 'center', padding: 40 }}>
                        <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.5rem', color: '#e91e63' }}></i>
                        <p style={{ color: '#888', marginTop: 8 }}>Calculating accuracy…</p>
                      </div>
                    ) : accuracyData ? (
                      <>
                        {/* Summary stats */}
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                          <div style={{
                            flex: '1 1 130px', background: accuracyData.accuracy_pct >= 95 ? '#e8f5e9' : accuracyData.accuracy_pct >= 85 ? '#fff8e1' : '#fce4ec',
                            borderRadius: 10, padding: '14px 18px', textAlign: 'center',
                            border: `1px solid ${accuracyData.accuracy_pct >= 95 ? '#c8e6c9' : accuracyData.accuracy_pct >= 85 ? '#ffe082' : '#f8bbd0'}`,
                          }}>
                            <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Accuracy</div>
                            <div style={{
                              fontSize: '1.8rem', fontWeight: 800,
                              color: accuracyData.accuracy_pct >= 95 ? '#2e7d32' : accuracyData.accuracy_pct >= 85 ? '#f57f17' : '#c62828',
                            }}>
                              {accuracyData.accuracy_pct}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>{accuracyData.model === 'random_forest' ? 'RF Model' : 'Linear'}</div>
                          </div>
                          <div style={{ flex: '1 1 130px', background: '#f3e5f5', borderRadius: 10, padding: '14px 18px', textAlign: 'center', border: '1px solid #e1bee7' }}>
                            <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>MAE</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#6a1b9a' }}>₱{accuracyData.overall_mae}</div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>Mean Abs Error</div>
                          </div>
                          <div style={{ flex: '1 1 130px', background: '#e3f2fd', borderRadius: 10, padding: '14px 18px', textAlign: 'center', border: '1px solid #bbdefb' }}>
                            <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>RMSE</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1565c0' }}>₱{accuracyData.overall_rmse}</div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>Root Mean Sq Error</div>
                          </div>
                          <div style={{ flex: '1 1 130px', background: '#fff3e0', borderRadius: 10, padding: '14px 18px', textAlign: 'center', border: '1px solid #ffe0b2' }}>
                            <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>MAPE</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e65100' }}>{accuracyData.overall_mape}%</div>
                            <div style={{ fontSize: '0.72rem', color: '#999' }}>Mean Abs Pct Error</div>
                          </div>
                        </div>

                        {/* Accuracy visual bar */}
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#666', marginBottom: 4 }}>
                            <span>Model accuracy across {accuracyData.comparisons?.length || 0} backtest points</span>
                            <span style={{ fontWeight: 700 }}>{accuracyData.accuracy_pct}%</span>
                          </div>
                          <div style={{ height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, accuracyData.accuracy_pct)}%`, height: '100%', borderRadius: 6,
                              background: accuracyData.accuracy_pct >= 95
                                ? 'linear-gradient(90deg, #66bb6a, #43a047)'
                                : accuracyData.accuracy_pct >= 85
                                  ? 'linear-gradient(90deg, #ffca28, #f9a825)'
                                  : 'linear-gradient(90deg, #ef5350, #c62828)',
                              transition: 'width 0.6s ease',
                            }}></div>
                          </div>
                        </div>

                        {/* Comparison table */}
                        {(accuracyData.comparisons?.length || 0) > 0 && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                              <thead>
                                <tr style={{ background: '#fce4ec', borderBottom: '2px solid #f8bbd0' }}>
                                  <th style={thStyle}>Date</th>
                                  <th style={thStyle}>Actual</th>
                                  <th style={thStyle}>Predicted</th>
                                  <th style={thStyle}>Error</th>
                                  <th style={thStyle}>Error %</th>
                                  <th style={thStyle}>Result</th>
                                </tr>
                              </thead>
                              <tbody>
                                {accuracyData.comparisons.map((c, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                    <td style={tdStyle}>{new Date(c.date).toLocaleDateString()}</td>
                                    <td style={tdStyle}><strong>₱{c.actual?.toFixed(2)}</strong></td>
                                    <td style={tdStyle}>₱{c.predicted?.toFixed(2)}</td>
                                    <td style={tdStyle}>
                                      <span style={{ color: c.error <= 5 ? '#4CAF50' : c.error <= 15 ? '#FF9800' : '#f44336' }}>
                                        ₱{c.error?.toFixed(2)}
                                      </span>
                                    </td>
                                    <td style={tdStyle}>
                                      <span style={{ color: c.error_pct <= 2 ? '#4CAF50' : c.error_pct <= 5 ? '#FF9800' : '#f44336' }}>
                                        {c.error_pct}%
                                      </span>
                                    </td>
                                    <td style={tdStyle}>
                                      {c.error_pct <= 2 ? (
                                        <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '3px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 }}>
                                          <i className="fas fa-check" style={{ marginRight: 3 }}></i> Accurate
                                        </span>
                                      ) : c.error_pct <= 5 ? (
                                        <span style={{ background: '#fff3e0', color: '#e65100', padding: '3px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 }}>
                                          <i className="fas fa-exclamation" style={{ marginRight: 3 }}></i> Close
                                        </span>
                                      ) : (
                                        <span style={{ background: '#fce4ec', color: '#c62828', padding: '3px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600 }}>
                                          <i className="fas fa-times" style={{ marginRight: 3 }}></i> Off
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div style={{ marginTop: 14, padding: '12px 16px', background: '#f8f9fa', borderRadius: 8, fontSize: '0.82rem', color: '#555' }}>
                          <i className="fas fa-info-circle" style={{ marginRight: 6, color: '#e91e63' }}></i>
                          <strong>What is this?</strong> Each row shows what the model <em>would have predicted</em> for a date using
                          only prior data available at that time. <strong>Accuracy = 100% − MAPE</strong> (Mean Absolute Percentage Error).
                          Higher accuracy means the model's forecasts closely match real DTI price
                          records when they are uploaded.
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>
                        <i className="fas fa-info-circle" style={{ marginRight: 6 }}></i>
                        {accuracyData === null && !loadingAccuracy
                          ? 'Accuracy report loads when you select a product.'
                          : 'Not enough data points to compute accuracy.'}
                      </div>
                    )}
                  </div>
                  </>
                  )}
                </>
              ) : (
                <div style={{ ...cardStyle, textAlign: 'center', padding: 60 }}>
                  <i className="fas fa-chart-line" style={{ fontSize: '3rem', color: '#ccc', marginBottom: 16 }}></i>
                  <h3 style={{ color: '#888' }}>Select a product to view price trends</h3>
                  <p style={{ color: '#aaa', maxWidth: 400, margin: '0 auto' }}>
                    Choose a product from the list on the left, or search by name to see
                    historical prices and predicted future prices.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

/* ─── Helper components ──────────────────────────────────────── */

const StatCard = ({ icon, color, label, value, sub }) => (
  <div style={{
    flex: '1 1 140px', minWidth: 140, background: '#fff',
    border: '1px solid #eee', borderRadius: 10, padding: '16px 18px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <i className={icon} style={{ color, fontSize: '1rem' }}></i>
      <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#333' }}>{value}</div>
    {sub && <div style={{ fontSize: '0.78rem', color: '#999', marginTop: 2 }}>{sub}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, unit }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div style={{
      background: '#fff', border: '1px solid #ddd', borderRadius: 8,
      padding: '10px 14px', fontSize: '0.85rem', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{row?.date}</div>
      {row?.price != null && (
        <div style={{ color: '#4CAF50' }}>Actual: ₱{row.price.toFixed(2)} / {unit}</div>
      )}
      {row?.predicted != null && (
        <div style={{ color: '#9C27B0' }}>Predicted: ₱{row.predicted.toFixed(2)} / {unit}</div>
      )}
      {row?.low != null && row?.high != null && (
        <div style={{ color: '#888' }}>Range: ₱{row.low.toFixed(2)} – ₱{row.high.toFixed(2)}</div>
      )}
    </div>
  );
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ─── Styles ─────────────────────────────────────────────────── */

const cardStyle = {
  background: '#fff', border: '1px solid #eee', borderRadius: 12,
  padding: '20px 24px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
};

const inputStyle = {
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6,
  width: '100%', fontSize: '0.9rem',
};

const thStyle = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.85rem', color: '#555' };
const tdStyle = { padding: '10px 12px', verticalAlign: 'middle' };

export default PriceTrends;
