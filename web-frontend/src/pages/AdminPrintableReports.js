import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';

const AdminPrintableReports = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const printRef = useRef();

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
  const [recentOrders, setRecentOrders] = useState([]);
  const [selectedSections, setSelectedSections] = useState({
    kpi: true,
    revenueTimeline: true,
    orderStatus: true,
    paymentMethods: true,
    monthlyData: true,
    topProducts: true,
    farmerPerformance: true,
    recentOrders: true,
  });

  useEffect(() => {
    if (authLoading) return;
    if (user && user.is_admin) {
      loadDashboardStats();
      loadReports(reportDays);
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading]);

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

      const API = process.env.REACT_APP_API_URL || '';
      const [productsRes, farmersRes, ordersRes, verificationsRes, ridersRes] = await Promise.all([
        fetch(`${API}/api/admin/products`, { headers, credentials: 'include' }),
        fetch(`${API}/api/admin/farmers`, { headers, credentials: 'include' }),
        fetch(`${API}/api/admin/orders`, { headers, credentials: 'include' }),
        fetch(`${API}/api/admin/verifications`, { headers, credentials: 'include' }),
        fetch(`${API}/api/admin/riders`, { headers, credentials: 'include' }),
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
        setRecentOrders(orders.slice(0, 10));
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
      const res = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/admin/reports?days=${days}`, {
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

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSavePDF = () => {
    const element = printRef.current;
    if (!element) return;
    setIsSaving(true);
    const periodLabel = `${reportDays}d`;
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `FarmToClick_Report_${periodLabel}_${dateStamp}.pdf`;

    const opt = {
      margin: [10, 8, 10, 8],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    html2pdf().set(opt).from(element).save().then(() => {
      setIsSaving(false);
    }).catch(() => {
      setIsSaving(false);
    });
  };

  const downloadBlob = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleSection = (key) => {
    setSelectedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = (val) => {
    const updated = {};
    Object.keys(selectedSections).forEach(k => { updated[k] = val; });
    setSelectedSections(updated);
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
  const assumedMarginPct = kpis.assumed_margin_pct ?? 15;
  const totalRevenueForCalc = (kpis.total_revenue !== undefined && kpis.total_revenue !== null) ? kpis.total_revenue : stats.totalRevenue;
  const estimatedProfit = Number(totalRevenueForCalc) * (Number(assumedMarginPct) / 100);
  const completionRate = stats.totalOrders > 0 ? (((kpis.completed_orders || 0) / stats.totalOrders) * 100).toFixed(1) : '0.0';
  const inProgress = stats.totalOrders - (kpis.completed_orders || 0) - (kpis.cancelled_orders || 0);

  const generatedDate = new Date().toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const sectionLabels = {
    kpi: 'Key Performance Indicators',
    revenueTimeline: 'Daily Revenue & Orders',
    orderStatus: 'Order Status Breakdown',
    paymentMethods: 'Payment Methods',
    monthlyData: 'Monthly Revenue & Orders',
    topProducts: 'Top Products Performance',
    farmerPerformance: 'Farmer Performance',
    recentOrders: 'Recent Orders',
  };

  const revenueTimelineRows = (reports?.revenue_timeline || []).filter((d) => (d.orders || 0) > 0 || (d.revenue || 0) > 0);
  const orderStatusRows = (reports?.order_status || []).filter((s) => (s.count || 0) > 0);
  const paymentRows = (reports?.payment_breakdown || []).filter((p) => (p.count || 0) > 0 || (p.revenue || 0) > 0);
  const monthlyRows = (reports?.monthly_data || []).filter((m) => (m.orders || 0) > 0 || (m.revenue || 0) > 0);
  const topProductRows = (reports?.top_products || []).filter((p) => (p.quantity_sold || 0) > 0 || (p.revenue || 0) > 0);
  const topFarmerRows = (reports?.top_farmers || []).filter((f) => (f.revenue || 0) > 0);

  const hasRevenueTimeline = revenueTimelineRows.length > 0;
  const hasOrderStatus = orderStatusRows.length > 0;
  const hasPaymentMethods = paymentRows.length > 0;
  const hasMonthlyData = monthlyRows.length > 0;
  const hasTopProducts = topProductRows.length > 0;
  const hasFarmerPerformance = topFarmerRows.length > 0;

  const adminInterpretations = {
    kpi: [
      `Revenue reached ${formatCurrency(stats.totalRevenue)} from ${stats.totalOrders} total orders in this period.`,
      `Estimated profit is ${formatCurrency(estimatedProfit)} using the ${assumedMarginPct}% assumed margin baseline.`,
      `The ${completionRate}% completion rate indicates current operational consistency and highlights room to reduce in-progress bottlenecks.`
    ],
    revenueTimeline: (() => {
      const first = revenueTimelineRows[0];
      const last = revenueTimelineRows[revenueTimelineRows.length - 1];
      const totalOrders = revenueTimelineRows.reduce((sum, row) => sum + (row.orders || 0), 0);
      return [
        `Revenue activity appears across ${revenueTimelineRows.length} active days with ${totalOrders} total orders.`,
        `The period moved from ${formatCurrency(first?.revenue || 0)} at the start to ${formatCurrency(last?.revenue || 0)} at the end, showing the overall trend direction.`,
        `This pattern suggests where promotions, stock planning, and staffing should be aligned with higher-volume days.`
      ];
    })(),
    orderStatus: (() => {
      const sorted = [...orderStatusRows].sort((a, b) => (b.count || 0) - (a.count || 0));
      const lead = sorted[0];
      const total = orderStatusRows.reduce((sum, row) => sum + (row.count || 0), 0);
      const leadPct = total > 0 ? ((lead?.count || 0) / total) * 100 : 0;
      return [
        `${total} orders were distributed across ${orderStatusRows.length} active status categories.`,
        `${lead?.status || 'Leading'} is the dominant status at ${leadPct.toFixed(1)}% of tracked orders.`,
        `This distribution highlights where fulfillment flow is healthy and where interventions are needed to reduce stalled orders.`
      ];
    })(),
    paymentMethods: (() => {
      const sorted = [...paymentRows].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
      const top = sorted[0];
      const total = paymentRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `${paymentRows.length} payment methods generated ${formatCurrency(total)} in report revenue.`,
        `${top?.method || 'Top method'} contributed ${share.toFixed(1)}% of payment revenue and currently drives most transactions.`,
        `The mix indicates which payment channels should be prioritized for checkout reliability and promotional incentives.`
      ];
    })(),
    monthlyData: (() => {
      const first = monthlyRows[0];
      const last = monthlyRows[monthlyRows.length - 1];
      return [
        `Monthly performance captured ${monthlyRows.length} active months in the selected reporting window.`,
        `Revenue changed from ${formatCurrency(first?.revenue || 0)} in ${first?.month || 'start month'} to ${formatCurrency(last?.revenue || 0)} in ${last?.month || 'end month'}.`,
        `This month-over-month movement informs budgeting, procurement planning, and campaign timing for sustained growth.`
      ];
    })(),
    topProducts: (() => {
      const total = topProductRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const top = topProductRows[0];
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `${topProductRows.length} products contributed measurable revenue in the top-products analysis.`,
        `${top?.name || 'Top product'} leads with ${formatCurrency(top?.revenue || 0)}, representing ${share.toFixed(1)}% of top-product revenue.`,
        `This concentration helps identify hero products to keep in stock and support with targeted merchandising.`
      ];
    })(),
    farmerPerformance: (() => {
      const total = topFarmerRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      const top = topFarmerRows[0];
      const share = total > 0 ? ((top?.revenue || 0) / total) * 100 : 0;
      return [
        `${topFarmerRows.length} farmers generated trackable revenue in this reporting range.`,
        `${top?.name || 'Top farmer'} accounts for ${share.toFixed(1)}% of farmer revenue at ${formatCurrency(top?.revenue || 0)}.`,
        `These results can guide seller enablement, inventory support, and coaching priorities to balance marketplace performance.`
      ];
    })(),
    recentOrders: [
      `${recentOrders.length} recent orders are included as the latest operational sample for this report.`,
      `The latest orders provide near-real-time visibility into fulfillment pace and proof-of-delivery consistency.`,
      `Monitoring this rolling sample helps detect service issues early before they impact broader customer satisfaction.`
    ]
  };

  const buildExportRows = () => {
    const rows = [
      ['FarmToClick E-Commerce Analytics Report'],
      [`Period: Last ${reportDays} Days`],
      [`Generated: ${generatedDate}`],
      []
    ];

    const pushSection = (title, interpretation, headerRow, bodyRows) => {
      rows.push([title]);
      rows.push(['Interpretation']);
      interpretation.forEach((sentence) => rows.push([sentence]));
      rows.push([]);
      rows.push(headerRow);
      bodyRows.forEach((row) => rows.push(row));
      rows.push([]);
    };

    if (selectedSections.kpi) {
      pushSection(
        'Key Performance Indicators',
        adminInterpretations.kpi,
        ['Metric', 'Value', 'Details'],
        [
          ['Total Revenue', formatCurrency(stats.totalRevenue), ''],
          ['Estimated Profit', formatCurrency(estimatedProfit), `Assumed margin: ${assumedMarginPct}%`],
          ['Total Orders', stats.totalOrders, `Avg order value: ${formatCurrency(kpis.avg_order_value)}`],
          ['Completed Orders', kpis.completed_orders || 0, `${kpis.cancelled_orders || 0} cancelled`],
          ['Completion Rate', `${completionRate}%`, `${inProgress} orders in progress`],
          ['Active Farmers', stats.totalFarmers, `${stats.totalProducts} products listed`],
          ['Active Riders', stats.activeRiders, `${stats.totalRiders} total riders`],
          ['Pending Verifications', stats.pendingVerifications, 'Awaiting admin review']
        ]
      );
    }

    if (selectedSections.revenueTimeline && hasRevenueTimeline) {
      pushSection(
        `Daily Revenue & Orders (Last ${reportDays} Days)`,
        adminInterpretations.revenueTimeline,
        ['Date', 'Revenue', 'Orders', 'Avg Per Order'],
        revenueTimelineRows.map((d) => [formatDate(d.date), d.revenue || 0, d.orders || 0, d.orders > 0 ? (d.revenue / d.orders) : ''])
      );
    }

    if (selectedSections.orderStatus && hasOrderStatus) {
      const total = orderStatusRows.reduce((sum, row) => sum + (row.count || 0), 0);
      pushSection(
        'Order Status Breakdown',
        adminInterpretations.orderStatus,
        ['Status', 'Count', '% of Total'],
        orderStatusRows.map((row) => [row.status, row.count || 0, total > 0 ? `${(((row.count || 0) / total) * 100).toFixed(1)}%` : '0.0%'])
      );
    }

    if (selectedSections.paymentMethods && hasPaymentMethods) {
      const totalRev = paymentRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      pushSection(
        'Payment Methods Breakdown',
        adminInterpretations.paymentMethods,
        ['Payment Method', 'Revenue', 'Transactions', '% of Revenue'],
        paymentRows.map((row) => [row.method, row.revenue || 0, row.count || 0, totalRev > 0 ? `${(((row.revenue || 0) / totalRev) * 100).toFixed(1)}%` : '0.0%'])
      );
    }

    if (selectedSections.monthlyData && hasMonthlyData) {
      pushSection(
        'Monthly Revenue & Orders',
        adminInterpretations.monthlyData,
        ['Month', 'Revenue', 'Orders', 'Avg Per Order'],
        monthlyRows.map((row) => [row.month, row.revenue || 0, row.orders || 0, row.orders > 0 ? (row.revenue / row.orders) : ''])
      );
    }

    if (selectedSections.topProducts && hasTopProducts) {
      const totalRev = topProductRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      pushSection(
        'Top Products Performance',
        adminInterpretations.topProducts,
        ['Product Name', 'Revenue', 'Units Sold', 'Avg Price/Unit', '% of Revenue'],
        topProductRows.map((row) => [
          row.name,
          row.revenue || 0,
          row.quantity_sold || 0,
          row.quantity_sold > 0 ? (row.revenue / row.quantity_sold) : '',
          totalRev > 0 ? `${(((row.revenue || 0) / totalRev) * 100).toFixed(1)}%` : '0.0%'
        ])
      );
    }

    if (selectedSections.farmerPerformance && hasFarmerPerformance) {
      const totalRev = topFarmerRows.reduce((sum, row) => sum + (row.revenue || 0), 0);
      pushSection(
        'Farmer Revenue Performance',
        adminInterpretations.farmerPerformance,
        ['Farmer Name', 'Revenue Generated', '% of Total'],
        topFarmerRows.map((row) => [
          row.name,
          row.revenue || 0,
          totalRev > 0 ? `${(((row.revenue || 0) / totalRev) * 100).toFixed(1)}%` : '0.0%'
        ])
      );
    }

    if (selectedSections.recentOrders && recentOrders.length > 0) {
      pushSection(
        'Recent Orders',
        adminInterpretations.recentOrders,
        ['Order ID', 'Date', 'Status', 'Delivery Proof'],
        recentOrders.map((order) => [
          (order._id || order.id || '').toString().substring(0, 6).toUpperCase(),
          formatDateTime(order.created_at),
          order.status || 'pending',
          order.delivery_proof_url ? 'Yes' : 'No'
        ])
      );
    }

    return rows;
  };

  const handleExportExcel = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `FarmToClick_Report_${reportDays}d_${dateStamp}.xlsx`);
  };

  const handleExportCSV = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadBlob(csv, `FarmToClick_Report_${reportDays}d_${dateStamp}.csv`, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="printable-reports-page">
      <Navbar />

      {/* Controls - hidden when printing */}
      <div className="print-controls no-print">
        <div className="controls-container">
          <div className="controls-header">
            <Link to="/admin-dashboard" className="back-link">
              <i className="fas fa-arrow-left"></i> Back to Dashboard
            </Link>
            <h2><i className="fas fa-file-pdf"></i> Printable Reports</h2>
          </div>

          <div className="controls-row">
            <div className="control-group">
              <label>Report Period:</label>
              <div className="period-btns">
                {[7, 14, 30, 60, 90].map(d => (
                  <button
                    key={d}
                    className={`period-btn ${reportDays === d ? 'active' : ''}`}
                    onClick={() => setReportDays(d)}
                  >
                    {d} Days
                  </button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <label>Sections to Include:</label>
              <div className="section-toggles">
                <button className="toggle-all-btn" onClick={() => toggleAll(true)}>Select All</button>
                <button className="toggle-all-btn" onClick={() => toggleAll(false)}>Deselect All</button>
              </div>
              <div className="section-checkboxes">
                {Object.entries(sectionLabels).map(([key, label]) => (
                  <label key={key} className="section-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedSections[key]}
                      onChange={() => toggleSection(key)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="print-actions">
            <button className="print-btn" onClick={handleSavePDF} disabled={isLoading || isSaving}>
              {isSaving ? (
                <><i className="fas fa-spinner fa-spin"></i> Generating PDF...</>
              ) : (
                <><i className="fas fa-file-pdf"></i> Save as PDF</>
              )}
            </button>
            <button className="print-btn print-btn--secondary" onClick={handleExportExcel} disabled={isLoading || isSaving}>
              <i className="fas fa-file-excel"></i> Export Excel
            </button>
            <button className="print-btn print-btn--secondary" onClick={handleExportCSV} disabled={isLoading || isSaving}>
              <i className="fas fa-file-csv"></i> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Printable Content */}
      <div className="print-content" ref={printRef}>
        {isLoading ? (
          <div className="loading-spinner no-print">
            <i className="fas fa-spinner fa-spin"></i> Loading report data...
          </div>
        ) : (
          <>
            {/* Report Header */}
            <div className="report-header">
              <div className="report-logo">
                <i className="fas fa-leaf" style={{ fontSize: '2rem', color: '#2c7a2c' }}></i>
                <h1>FarmToClick</h1>
              </div>
              <h2 className="report-title">E-Commerce Analytics Report</h2>
              <div className="report-meta">
                <span>Period: Last {reportDays} Days</span>
                <span className="report-meta-sep">|</span>
                <span>Generated: {generatedDate}</span>
              </div>
            </div>

            {/* KPI Summary */}
            {selectedSections.kpi && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">1</span> Key Performance Indicators</h3>
                <table className="print-table kpi-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Total Revenue</strong></td>
                      <td className="text-right">{formatCurrency(stats.totalRevenue)}</td>
                      <td>{kpis.revenue_growth_pct !== undefined && kpis.revenue_growth_pct !== 0
                        ? `${kpis.revenue_growth_pct > 0 ? '+' : ''}${kpis.revenue_growth_pct}% vs previous period`
                        : 'No change vs previous period'}</td>
                    </tr>
                    <tr>
                      <td><strong>Estimated Profit</strong></td>
                      <td className="text-right">{formatCurrency(estimatedProfit)}</td>
                      <td>Assumed margin: {assumedMarginPct}%</td>
                    </tr>
                    <tr>
                      <td><strong>Total Orders</strong></td>
                      <td className="text-right">{stats.totalOrders}</td>
                      <td>Avg order value: {formatCurrency(kpis.avg_order_value)}</td>
                    </tr>
                    <tr>
                      <td><strong>Completed Orders</strong></td>
                      <td className="text-right">{kpis.completed_orders || 0}</td>
                      <td>{kpis.cancelled_orders || 0} cancelled</td>
                    </tr>
                    <tr>
                      <td><strong>Completion Rate</strong></td>
                      <td className="text-right">{completionRate}%</td>
                      <td>{inProgress} orders in progress</td>
                    </tr>
                    <tr>
                      <td><strong>Active Farmers</strong></td>
                      <td className="text-right">{stats.totalFarmers}</td>
                      <td>{stats.totalProducts} products listed</td>
                    </tr>
                    <tr>
                      <td><strong>Active Riders</strong></td>
                      <td className="text-right">{stats.activeRiders}</td>
                      <td>{stats.totalRiders} total riders</td>
                    </tr>
                    <tr>
                      <td><strong>Pending Verifications</strong></td>
                      <td className="text-right">{stats.pendingVerifications}</td>
                      <td>Awaiting admin review</td>
                    </tr>
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.kpi.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Daily Revenue & Orders Timeline */}
            {selectedSections.revenueTimeline && hasRevenueTimeline && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">2</span> Daily Revenue & Orders (Last {reportDays} Days)</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Avg Per Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueTimelineRows.map((d, i) => (
                      <tr key={i} className={d.revenue > 0 ? '' : 'zero-row'}>
                        <td>{formatDate(d.date)}</td>
                        <td className="text-right">{formatCurrency(d.revenue)}</td>
                        <td className="text-right">{d.orders}</td>
                        <td className="text-right">{d.orders > 0 ? formatCurrency(d.revenue / d.orders) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td><strong>Total</strong></td>
                      <td className="text-right"><strong>{formatCurrency(revenueTimelineRows.reduce((s, d) => s + (d.revenue || 0), 0))}</strong></td>
                      <td className="text-right"><strong>{revenueTimelineRows.reduce((s, d) => s + (d.orders || 0), 0)}</strong></td>
                      <td className="text-right"><strong>{
                        (() => {
                          const totalRev = revenueTimelineRows.reduce((s, d) => s + (d.revenue || 0), 0);
                          const totalOrd = revenueTimelineRows.reduce((s, d) => s + (d.orders || 0), 0);
                          return totalOrd > 0 ? formatCurrency(totalRev / totalOrd) : '—';
                        })()
                      }</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.revenueTimeline.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Order Status Breakdown */}
            {selectedSections.orderStatus && hasOrderStatus && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">3</span> Order Status Breakdown</h3>
                <table className="print-table compact-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th className="text-right">Count</th>
                      <th className="text-right">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderStatusRows.map((s, i) => {
                      const total = orderStatusRows.reduce((sum, x) => sum + x.count, 0);
                      return (
                        <tr key={i}>
                          <td style={{ textTransform: 'capitalize' }}>
                            <span className={`status-dot status-${s.status}`}></span>
                            {s.status}
                          </td>
                          <td className="text-right">{s.count}</td>
                          <td className="text-right">{total > 0 ? ((s.count / total) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td><strong>Total</strong></td>
                      <td className="text-right"><strong>{orderStatusRows.reduce((s, x) => s + x.count, 0)}</strong></td>
                      <td className="text-right"><strong>100%</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.orderStatus.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Payment Methods */}
            {selectedSections.paymentMethods && hasPaymentMethods && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">4</span> Payment Methods Breakdown</h3>
                <table className="print-table compact-table">
                  <thead>
                    <tr>
                      <th>Payment Method</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">Transactions</th>
                      <th className="text-right">% of Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentRows.map((p, i) => {
                      const totalRev = paymentRows.reduce((s, x) => s + (x.revenue || 0), 0);
                      return (
                        <tr key={i}>
                          <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                          <td className="text-right">{formatCurrency(p.revenue)}</td>
                          <td className="text-right">{p.count}</td>
                          <td className="text-right">{totalRev > 0 ? ((p.revenue / totalRev) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td><strong>Total</strong></td>
                      <td className="text-right"><strong>{formatCurrency(paymentRows.reduce((s, x) => s + (x.revenue || 0), 0))}</strong></td>
                      <td className="text-right"><strong>{paymentRows.reduce((s, x) => s + (x.count || 0), 0)}</strong></td>
                      <td className="text-right"><strong>100%</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.paymentMethods.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Monthly Revenue & Orders */}
            {selectedSections.monthlyData && hasMonthlyData && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">5</span> Monthly Revenue & Orders (Last 6 Months)</h3>
                <table className="print-table compact-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Avg Per Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyRows.map((m, i) => (
                      <tr key={i}>
                        <td>{m.month}</td>
                        <td className="text-right">{formatCurrency(m.revenue)}</td>
                        <td className="text-right">{m.orders}</td>
                        <td className="text-right">{m.orders > 0 ? formatCurrency(m.revenue / m.orders) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td><strong>Total</strong></td>
                      <td className="text-right"><strong>{formatCurrency(monthlyRows.reduce((s, m) => s + (m.revenue || 0), 0))}</strong></td>
                      <td className="text-right"><strong>{monthlyRows.reduce((s, m) => s + (m.orders || 0), 0)}</strong></td>
                      <td className="text-right"><strong>{
                        (() => {
                          const tr = monthlyRows.reduce((s, m) => s + (m.revenue || 0), 0);
                          const to = monthlyRows.reduce((s, m) => s + (m.orders || 0), 0);
                          return to > 0 ? formatCurrency(tr / to) : '—';
                        })()
                      }</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.monthlyData.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Top Products */}
            {selectedSections.topProducts && hasTopProducts && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">6</span> Top Products Performance</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product Name</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">Units Sold</th>
                      <th className="text-right">Avg Price/Unit</th>
                      <th className="text-right">% of Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductRows.map((p, i) => {
                      const totalProdRev = topProductRows.reduce((s, x) => s + (x.revenue || 0), 0);
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{p.name}</td>
                          <td className="text-right">{formatCurrency(p.revenue)}</td>
                          <td className="text-right">{p.quantity_sold}</td>
                          <td className="text-right">{p.quantity_sold > 0 ? formatCurrency(p.revenue / p.quantity_sold) : '—'}</td>
                          <td className="text-right">{totalProdRev > 0 ? ((p.revenue / totalProdRev) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td colSpan="2"><strong>Total (Top {topProductRows.length})</strong></td>
                      <td className="text-right"><strong>{formatCurrency(topProductRows.reduce((s, p) => s + (p.revenue || 0), 0))}</strong></td>
                      <td className="text-right"><strong>{topProductRows.reduce((s, p) => s + (p.quantity_sold || 0), 0)}</strong></td>
                      <td className="text-right">—</td>
                      <td className="text-right"><strong>100%</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.topProducts.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Farmer Performance */}
            {selectedSections.farmerPerformance && hasFarmerPerformance && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">7</span> Farmer Revenue Performance</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Farmer Name</th>
                      <th className="text-right">Revenue Generated</th>
                      <th className="text-right">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFarmerRows.map((f, i) => {
                      const totalFarmerRev = topFarmerRows.reduce((s, x) => s + (x.revenue || 0), 0);
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{f.name}</td>
                          <td className="text-right">{formatCurrency(f.revenue)}</td>
                          <td className="text-right">{totalFarmerRev > 0 ? ((f.revenue / totalFarmerRev) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td colSpan="2"><strong>Total</strong></td>
                      <td className="text-right"><strong>{formatCurrency(topFarmerRows.reduce((s, f) => s + (f.revenue || 0), 0))}</strong></td>
                      <td className="text-right"><strong>100%</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.farmerPerformance.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Recent Orders */}
            {selectedSections.recentOrders && recentOrders.length > 0 && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">8</span> Recent Orders</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Order ID</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Delivery Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="mono">#{(order._id || order.id || '').toString().substring(0, 6).toUpperCase()}</td>
                        <td>{formatDateTime(order.created_at)}</td>
                        <td style={{ textTransform: 'capitalize' }}>
                          <span className={`status-dot status-${(order.status || 'pending').toLowerCase()}`}></span>
                          {order.status || 'pending'}
                        </td>
                        <td>{order.delivery_proof_url ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {adminInterpretations.recentOrders.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="report-footer">
              <div className="footer-line"></div>
              <p>FarmToClick E-Commerce Analytics Report &mdash; Generated on {generatedDate}</p>
              <p className="footer-sub">This report is auto-generated from the admin dashboard. Data is accurate as of the generation time.</p>
            </div>
          </>
        )}
      </div>

      <style>{`
        /* ═══════ SCREEN STYLES ═══════ */
        .printable-reports-page {
          min-height: 100vh;
          background: #f4f6f9;
        }

        .print-controls {
          background: white;
          border-bottom: 2px solid #e0e0e0;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        .controls-container {
          max-width: 1100px;
          margin: 0 auto;
        }

        .controls-header {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 18px;
        }

        .controls-header h2 {
          font-size: 1.3rem;
          color: #14532d;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .back-link {
          color: #2c7a2c;
          text-decoration: none;
          font-size: .9rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 8px;
          background: #f0f7f0;
          transition: all .2s;
        }

        .print-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .print-btn--secondary {
          background: #4b5563;
        }

        .print-btn--secondary:hover {
          background: #374151;
        }

        .interpretation-block {
          margin-top: 10px;
          padding: 10px 12px;
          border-left: 4px solid #2c7a2c;
          background: #f0f7f0;
          border-radius: 6px;
          font-size: .85rem;
          color: #334155;
        }

        .interpretation-block p {
          margin: 0 0 6px;
          line-height: 1.45;
        }

        .interpretation-block p:last-child {
          margin-bottom: 0;
        }
        .back-link:hover {
          background: #dff0df;
        }

        .controls-row {
          display: flex;
          gap: 30px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .control-group {
          flex: 1;
          min-width: 250px;
        }

        .control-group label {
          font-weight: 600;
          color: #555;
          font-size: .85rem;
          display: block;
          margin-bottom: 8px;
        }

        .period-btns {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .period-btn {
          padding: 8px 18px;
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

        .section-toggles {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }

        .toggle-all-btn {
          padding: 4px 12px;
          border: 1px solid #ddd;
          background: #f8f9fa;
          border-radius: 6px;
          cursor: pointer;
          font-size: .8rem;
          color: #555;
          transition: all .2s;
        }
        .toggle-all-btn:hover { border-color: #2c7a2c; color: #2c7a2c; }

        .section-checkboxes {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 6px;
        }

        .section-checkbox {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: .85rem;
          color: #444;
          cursor: pointer;
        }
        .section-checkbox input { accent-color: #2c7a2c; }

        .print-btn {
          padding: 12px 32px;
          background: #2c7a2c;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: all .2s;
          box-shadow: 0 4px 12px rgba(44,122,44,0.2);
        }
        .print-btn:hover { background: #1b5e20; transform: translateY(-1px); }
        .print-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ═══════ PRINT CONTENT ═══════ */
        .print-content {
          max-width: 1100px;
          margin: 0 auto;
          padding: 30px 20px;
        }

        .report-header {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 3px solid #2c7a2c;
        }

        .report-logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .report-logo h1 {
          font-size: 1.8rem;
          color: #14532d;
          margin: 0;
          font-weight: 800;
        }

        .report-title {
          font-size: 1.3rem;
          color: #333;
          margin: 0 0 8px;
          font-weight: 600;
        }

        .report-meta {
          font-size: .9rem;
          color: #666;
        }
        .report-meta-sep { margin: 0 10px; }

        .report-section {
          margin-bottom: 28px;
          page-break-inside: avoid;
        }

        .section-title {
          font-size: 1.1rem;
          color: #14532d;
          margin: 0 0 12px;
          padding: 8px 14px;
          background: #f0f7f0;
          border-left: 4px solid #2c7a2c;
          border-radius: 0 6px 6px 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .section-num {
          background: #2c7a2c;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: .8rem;
          font-weight: 700;
          flex-shrink: 0;
        }

        /* ═══════ TABLE STYLES ═══════ */
        .print-table {
          width: 100%;
          border-collapse: collapse;
          font-size: .88rem;
          margin-bottom: 4px;
        }

        .print-table th {
          text-align: left;
          padding: 10px 12px;
          background: #f8f9fa;
          color: #333;
          font-weight: 700;
          border-bottom: 2px solid #2c7a2c;
          border-top: 2px solid #2c7a2c;
          font-size: .82rem;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .print-table td {
          padding: 8px 12px;
          border-bottom: 1px solid #e8e8e8;
          color: #333;
        }

        .print-table tbody tr:nth-child(even) {
          background: #fafbfc;
        }

        .print-table tbody tr:hover {
          background: #f0f7f0;
        }

        .text-right { text-align: right !important; }

        .totals-row {
          background: #f0f7f0 !important;
          border-top: 2px solid #2c7a2c;
        }
        .totals-row td {
          font-weight: 700;
          color: #14532d;
          border-bottom: 2px solid #2c7a2c;
        }

        .zero-row td { color: #aaa; }

        .mono { font-family: 'Courier New', monospace; font-weight: 600; }

        .kpi-table td:first-child { width: 200px; }

        .compact-table { max-width: 700px; }

        .status-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-right: 8px;
          vertical-align: middle;
        }
        .status-dot.status-pending { background: #ff9800; }
        .status-dot.status-confirmed { background: #2196f3; }
        .status-dot.status-preparing { background: #9c27b0; }
        .status-dot.status-ready { background: #00bcd4; }
        .status-dot.status-completed { background: #4caf50; }
        .status-dot.status-delivered { background: #2c7a2c; }
        .status-dot.status-cancelled { background: #f44336; }

        .report-footer {
          margin-top: 40px;
          text-align: center;
          color: #888;
          font-size: .85rem;
        }
        .footer-line {
          border-top: 2px solid #2c7a2c;
          margin-bottom: 14px;
        }
        .footer-sub {
          font-size: .78rem;
          color: #aaa;
          margin-top: 4px;
        }

        .loading-spinner {
          text-align: center;
          padding: 60px 20px;
          font-size: 1.1rem;
          color: #666;
        }

        /* ═══════ PRINT MEDIA STYLES ═══════ */
        @media print {
          .no-print,
          nav,
          .navbar,
          .print-controls {
            display: none !important;
          }

          .printable-reports-page {
            background: white !important;
          }

          .print-content {
            max-width: 100%;
            padding: 0;
            margin: 0;
          }

          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          @page {
            size: A4;
            margin: 15mm 12mm;
          }

          /* Logo/header only on first page */
          .report-header {
            margin-bottom: 20px;
            padding-bottom: 14px;
            position: static;
            display: block;
          }

          .report-logo i {
            color: #2c7a2c !important;
          }

          .report-section {
            page-break-inside: avoid;
            margin-bottom: 18px;
          }

          .section-title {
            background: #f0f7f0 !important;
            -webkit-print-color-adjust: exact;
          }

          .section-num {
            background: #2c7a2c !important;
            color: white !important;
            -webkit-print-color-adjust: exact;
          }

          .print-table {
            font-size: .82rem;
          }

          .print-table th {
            background: #f8f9fa !important;
            -webkit-print-color-adjust: exact;
          }

          .print-table tbody tr:nth-child(even) {
            background: #fafbfc !important;
            -webkit-print-color-adjust: exact;
          }

          .totals-row {
            background: #f0f7f0 !important;
            -webkit-print-color-adjust: exact;
          }

          .status-dot {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .zero-row td { color: #bbb; }

          .print-table tr {
            page-break-inside: avoid;
          }

          .report-footer {
            margin-top: 20px;
          }
        }

        /* ═══════ RESPONSIVE ═══════ */
        @media (max-width: 768px) {
          .controls-row {
            flex-direction: column;
            gap: 16px;
          }

          .controls-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }

          .section-checkboxes {
            grid-template-columns: 1fr;
          }

          .print-table {
            font-size: .8rem;
          }

          .print-table th,
          .print-table td {
            padding: 6px 8px;
          }
        }
      `}</style>
    </div>
  );
};

export default AdminPrintableReports;
