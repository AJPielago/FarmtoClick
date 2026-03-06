import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';

const RiderPrintableReports = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const printRef = useRef();

  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [isSaving, setIsSaving] = useState(false);

  const [selectedSections, setSelectedSections] = useState({
    kpi: true,
    orderStatus: true,
    recentOrders: true,
  });

  const loadDashboard = useCallback(async (selectedPeriod) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await ordersAPI.getRiderDashboard(selectedPeriod);
      setDashboard(res.data);
    } catch (err) {
      console.error('[RiderPrintableReports] Load error:', err);
      setError(err?.response?.data?.error || 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role === 'rider') {
      loadDashboard(period);
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading, period, loadDashboard]);

  const formatCurrency = (val) => `₱${Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const handleSavePDF = () => {
    const element = printRef.current;
    if (!element) return;
    setIsSaving(true);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `FarmToClick_Rider_Report_${period}_${dateStamp}.pdf`;

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

  if (!user || user.role !== 'rider') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <Link to="/" className="btn btn-primary">Go Home</Link>
      </div>
    );
  }

  const periodStats = dashboard?.period_stats || {};
  const statusDist = dashboard?.status_distribution || [];
  const recentOrders = dashboard?.recent_orders || [];
  const periodLabel = dashboard?.period_label || 'Last 30 Days';

  const generatedDate = new Date().toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const sectionLabels = {
    kpi: 'Key Performance Indicators',
    orderStatus: 'Order Status Breakdown',
    recentOrders: 'Recent Orders',
  };

  const statusRows = statusDist.filter((item) => (item.count || 0) > 0);
  const hasOrderStatus = statusRows.length > 0;
  const hasRecentOrders = recentOrders.length > 0;
  const hasKpi = (periodStats.total_deliveries || 0) > 0
    || (periodStats.completed_deliveries || 0) > 0
    || (periodStats.total_earnings || 0) > 0;

  const riderInterpretations = {
    kpi: [
      `Total deliveries in this period reached ${periodStats.total_deliveries || 0}, with ${periodStats.completed_deliveries || 0} completed.`,
      `Total rider earnings are ${formatCurrency(periodStats.total_earnings || 0)}, which tracks the value impact of completed runs.`,
      `These KPIs indicate delivery efficiency and help forecast target volume needed to improve completion consistency.`
    ],
    orderStatus: (() => {
      const total = statusRows.reduce((sum, row) => sum + (row.count || 0), 0);
      const top = [...statusRows].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
      const share = total > 0 ? ((top?.count || 0) / total) * 100 : 0;
      return [
        `${total} orders are represented across ${statusRows.length} active delivery statuses.`,
        `${(top?.status || 'Top status').replace(/_/g, ' ')} is currently the largest segment at ${share.toFixed(1)}%.`,
        `The distribution helps identify whether workload is flowing to completion or piling up in transit stages.`
      ];
    })(),
    recentOrders: [
      `${Math.min(recentOrders.length, 15)} recent deliveries are included as a current execution snapshot.`,
      `This sample highlights customer-facing momentum through live status and amount values.`,
      `Reviewing these records regularly supports faster issue resolution and stronger on-time delivery outcomes.`
    ]
  };

  const buildExportRows = () => {
    const rows = [
      ['FarmToClick Rider Performance Report'],
      [`Period: ${periodLabel}`],
      [`Generated: ${generatedDate}`],
      [`Rider: ${user.first_name} ${user.last_name}`],
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

    if (selectedSections.kpi && hasKpi) {
      pushSection(
        'Key Performance Indicators',
        riderInterpretations.kpi,
        ['Metric', 'Value'],
        [
          ['Total Deliveries', periodStats.total_deliveries || 0],
          ['Completed Deliveries', periodStats.completed_deliveries || 0],
          ['Total Earnings', periodStats.total_earnings || 0],
          ['Completion Rate', periodStats.total_deliveries > 0 ? `${(((periodStats.completed_deliveries || 0) / periodStats.total_deliveries) * 100).toFixed(1)}%` : '0.0%']
        ]
      );
    }

    if (selectedSections.orderStatus && hasOrderStatus) {
      pushSection(
        'Order Status Breakdown',
        riderInterpretations.orderStatus,
        ['Status', 'Count'],
        statusRows.map((row) => [String(row.status || '').replace(/_/g, ' '), row.count || 0])
      );
    }

    if (selectedSections.recentOrders && hasRecentOrders) {
      pushSection(
        'Recent Orders',
        riderInterpretations.recentOrders,
        ['Order ID', 'Date', 'Customer', 'Status', 'Amount'],
        recentOrders.slice(0, 15).map((order) => [
          order.id?.substring(0, 6).toUpperCase() || 'N/A',
          formatDate(order.created_at),
          order.shipping_name || order.buyer_name || order.customer_name || 'Unknown',
          (order.status || 'pending').replace(/_/g, ' '),
          order.total_amount || 0
        ])
      );
    }

    return rows;
  };

  const handleExportExcel = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rider Report');
    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `FarmToClick_Rider_Report_${period}_${dateStamp}.xlsx`);
  };

  const handleExportCSV = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadBlob(csv, `FarmToClick_Rider_Report_${period}_${dateStamp}.csv`, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="printable-reports-page">
      <Navbar activePage="dashboard" />

      <div className="print-controls no-print">
        <div className="container">
          <div className="controls-header">
            <h2><i className="fas fa-print"></i> Rider Reports</h2>
            <div className="controls-actions">
              <Link to="/rider-dashboard" className="btn btn-outline">Back to Dashboard</Link>
              <button className="btn btn-primary" onClick={handleSavePDF} disabled={isSaving || isLoading}>
                {isSaving ? <><i className="fas fa-spinner fa-spin"></i> Generating PDF...</> : <><i className="fas fa-file-pdf"></i> Save as PDF</>}
              </button>
              <button className="btn btn-primary" onClick={handleExportExcel} disabled={isSaving || isLoading}>
                <i className="fas fa-file-excel"></i> Export Excel
              </button>
              <button className="btn btn-primary" onClick={handleExportCSV} disabled={isSaving || isLoading}>
                <i className="fas fa-file-csv"></i> Export CSV
              </button>
            </div>
          </div>

          <div className="controls-row">
            <div className="control-group">
              <label>Report Period</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="form-control">
                <option value="7d">Last 7 Days</option>
                <option value="14d">Last 14 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="3m">Last 3 Months</option>
                <option value="6m">Last 6 Months</option>
                <option value="1y">Last Year</option>
                <option value="all">All Time</option>
              </select>
            </div>

            <div className="control-group sections-group">
              <div className="sections-header">
                <label>Include Sections</label>
                <div className="section-toggles">
                  <button className="btn-text" onClick={() => toggleAll(true)}>Select All</button>
                  <button className="btn-text" onClick={() => toggleAll(false)}>Deselect All</button>
                </div>
              </div>
              <div className="section-checkboxes">
                {Object.entries(sectionLabels).map(([key, label]) => (
                  <label key={key} className="checkbox-label">
                    <input type="checkbox" checked={selectedSections[key]} onChange={() => toggleSection(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-spinner">Loading report data...</div>
      ) : error ? (
        <div className="error-message" style={{ textAlign: 'center', color: 'red', padding: '20px' }}>{error}</div>
      ) : (
        <div className="print-container">
          <div className="print-content" ref={printRef}>
            <div className="report-header">
              <div className="report-logo">
                <i className="fas fa-leaf"></i> FarmToClick
              </div>
              <h1 className="report-title">Rider Performance Report</h1>
              <div className="report-meta">
                <span>Period: {periodLabel}</span>
                <span className="report-meta-sep">|</span>
                <span>Generated: {generatedDate}</span>
                <span className="report-meta-sep">|</span>
                <span>Rider: {user.first_name} {user.last_name}</span>
              </div>
            </div>

            {selectedSections.kpi && hasKpi && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">1</span> Key Performance Indicators</h3>
                <table className="print-table kpi-table compact-table">
                  <tbody>
                    <tr>
                      <td>Total Deliveries</td>
                      <td className="text-right mono">{periodStats.total_deliveries || 0}</td>
                    </tr>
                    <tr>
                      <td>Completed Deliveries</td>
                      <td className="text-right mono">{periodStats.completed_deliveries || 0}</td>
                    </tr>
                    <tr>
                      <td>Total Earnings</td>
                      <td className="text-right mono">{formatCurrency(periodStats.total_earnings || 0)}</td>
                    </tr>
                    <tr className="totals-row">
                      <td>Completion Rate</td>
                      <td className="text-right mono">
                        {periodStats.total_deliveries > 0 
                          ? (((periodStats.completed_deliveries || 0) / periodStats.total_deliveries) * 100).toFixed(1) 
                          : '0.0'}%
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {riderInterpretations.kpi.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {selectedSections.orderStatus && hasOrderStatus && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">2</span> Order Status Breakdown</h3>
                <table className="print-table compact-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th className="text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ textTransform: 'capitalize' }}>{(item.status || '').replace(/_/g, ' ')}</td>
                        <td className="text-right mono">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {riderInterpretations.orderStatus.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {selectedSections.recentOrders && hasRecentOrders && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">3</span> Recent Orders</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.slice(0, 15).map((order, idx) => (
                      <tr key={idx}>
                        <td className="mono">{order.id?.substring(0, 6).toUpperCase() || 'N/A'}</td>
                        <td>{formatDate(order.created_at)}</td>
                        <td>{order.shipping_name || order.buyer_name || order.customer_name || 'Unknown'}</td>
                        <td style={{ textTransform: 'capitalize' }}>{(order.status || 'pending').replace(/_/g, ' ')}</td>
                        <td className="text-right mono">{formatCurrency(order.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {riderInterpretations.recentOrders.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            <div className="report-footer">
              <div className="footer-line"></div>
              <p>FarmToClick - Empowering Local Farmers</p>
              <p className="footer-sub">This is a computer-generated document. No signature is required.</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .printable-reports-page {
          background: #f4f7f6;
          min-height: 100vh;
          padding-bottom: 60px;
        }

        .print-controls {
          background: white;
          padding: 24px 0;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
          margin-bottom: 30px;
          border-bottom: 1px solid #e0e0e0;
        }

        .controls-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .controls-header h2 {
          margin: 0;
          color: #2c7a2c;
          font-size: 1.5rem;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .controls-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .controls-row {
          display: flex;
          gap: 30px;
          background: #f9fbf9;
          padding: 20px;
          border-radius: 8px;
          border: 1px solid #e8f0e8;
        }

        .control-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .control-group label {
          font-weight: 600;
          color: #444;
          font-size: .9rem;
        }

        .form-control {
          padding: 10px 14px;
          border: 1px solid #ccc;
          border-radius: 6px;
          font-size: 1rem;
          min-width: 200px;
        }

        .sections-group {
          flex: 1;
        }

        .sections-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .section-toggles {
          display: flex;
          gap: 12px;
        }

        .btn-text {
          background: none;
          border: none;
          color: #2c7a2c;
          font-size: .85rem;
          cursor: pointer;
          padding: 0;
          font-weight: 600;
        }
        .btn-text:hover { text-decoration: underline; }

        .section-checkboxes {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
          background: white;
          padding: 16px;
          border-radius: 6px;
          border: 1px solid #e0e0e0;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 400 !important;
          cursor: pointer;
          font-size: .9rem !important;
        }

        /* ═══════ PRINT CONTAINER ═══════ */
        .print-container {
          max-width: 900px;
          margin: 0 auto;
          background: white;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          border-radius: 8px;
          overflow: hidden;
        }

        .print-content {
          padding: 40px 50px;
          background: white;
          color: #333;
        }

        .report-header {
          border-bottom: 3px solid #2c7a2c;
          padding-bottom: 20px;
          margin-bottom: 30px;
          position: relative;
        }

        .report-logo {
          font-size: 1.6rem;
          font-weight: 800;
          color: #2c7a2c;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
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

export default RiderPrintableReports;
