import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { productsAPI, ordersAPI } from '../services/api';
import Navbar from '../components/Navbar';
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';

const FarmerPrintableReports = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const printRef = useRef();

  const [products, setProducts] = useState([]);
  const [sellerOrders, setSellerOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reportDays, setReportDays] = useState(30);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedSections, setSelectedSections] = useState({
    kpi: true,
    topProducts: true,
    orderStatus: true,
    recentOrders: true,
  });

  const loadFarmerData = useCallback(async () => {
    try {
      setIsLoading(true);
      const productsRes = await productsAPI.getProducts();
      setProducts(productsRes.data?.products || []);
      
      const ordersRes = await ordersAPI.getSellerOrders();
      setSellerOrders(ordersRes.data?.orders || []);
    } catch (error) {
      console.error('Failed to load farmer data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.is_farmer) {
      loadFarmerData();
    } else {
      navigate('/');
    }
  }, [user, navigate, authLoading, loadFarmerData]);

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

  const handleSavePDF = () => {
    const element = printRef.current;
    if (!element) return;
    setIsSaving(true);
    const periodLabel = `${reportDays}d`;
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `FarmToClick_Farmer_Report_${periodLabel}_${dateStamp}.pdf`;

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

  if (!user || !user.is_farmer) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <Link to="/" className="btn btn-primary">Go Home</Link>
      </div>
    );
  }

  // Filter orders based on reportDays
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - reportDays);
  
  const filteredOrders = sellerOrders.filter(o => {
    if (!o.created_at) return false;
    return new Date(o.created_at) >= cutoffDate;
  });

  const totalRevenue = filteredOrders.reduce((sum, o) => {
    const t = o.items
      ? o.items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
      : (parseFloat(o.total_amount) || 0);
    return sum + t;
  }, 0);

  const totalOrders = filteredOrders.length;
  const deliveredOrders = filteredOrders.filter(o => (o.status || '').toLowerCase() === 'delivered').length;
  const pendingOrders = filteredOrders.filter(o => (o.status || '').toLowerCase() === 'pending').length;
  const cancelledOrders = filteredOrders.filter(o => (o.status || '').toLowerCase() === 'cancelled').length;

  const completionRate = totalOrders > 0 ? ((deliveredOrders / totalOrders) * 100).toFixed(1) : '0.0';

  // Top Products
  const productRevenue = {};
  const deliveredStatuses = ['delivered', 'completed'];
  filteredOrders
    .filter(o => deliveredStatuses.includes((o.status || '').toLowerCase()))
    .forEach(o => {
      (o.items || []).forEach(it => {
        const name = it.product_name || it.name || `Product #${it.product_id}`;
        productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(it.price) || 0) * (it.quantity || 1);
      });
      if (!o.items || o.items.length === 0) {
        const name = o.product_name || 'Unknown Product';
        productRevenue[name] = (productRevenue[name] || 0) + (parseFloat(o.total_amount) || 0);
      }
    });
  const topProducts = Object.entries(productRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const generatedDate = new Date().toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const sectionLabels = {
    kpi: 'Key Performance Indicators',
    topProducts: 'Top Products Performance',
    orderStatus: 'Order Status Breakdown',
    recentOrders: 'Recent Orders',
  };

  const hasKpi = totalOrders > 0 || totalRevenue > 0;
  const topProductRows = topProducts.filter(([, rev]) => Number(rev) > 0);
  const statusList = ['pending', 'approved', 'ready_for_ship', 'picked_up', 'on_the_way', 'delivered', 'cancelled', 'rejected'];
  const statusRows = statusList.map((status) => {
    const count = filteredOrders.filter(o => (o.status || '').toLowerCase() === status).length;
    return { status, count };
  }).filter((row) => row.count > 0);
  const hasOrderStatus = statusRows.length > 0;
  const hasTopProducts = topProductRows.length > 0;
  const hasRecentOrders = filteredOrders.length > 0;

  const farmerInterpretations = {
    kpi: [
      `Total revenue reached ${formatCurrency(totalRevenue)} across ${totalOrders} orders in the selected period.`,
      `Delivered orders are ${deliveredOrders}, producing a completion rate of ${completionRate}% and reflecting current fulfillment quality.`,
      `This KPI mix indicates whether sales growth is translating into completed deliveries and stable farmer cash flow.`
    ],
    topProducts: (() => {
      const total = topProductRows.reduce((sum, [, rev]) => sum + Number(rev || 0), 0);
      const top = topProductRows[0];
      const share = total > 0 ? (Number(top?.[1] || 0) / total) * 100 : 0;
      return [
        `${topProductRows.length} products generated measurable delivered revenue during this period.`,
        `${top?.[0] || 'Top product'} leads at ${formatCurrency(top?.[1] || 0)}, contributing ${share.toFixed(1)}% of top-product revenue.`,
        `The concentration pattern helps prioritize which products should be stocked, priced, and promoted more aggressively.`
      ];
    })(),
    orderStatus: (() => {
      const total = statusRows.reduce((sum, row) => sum + row.count, 0);
      const lead = [...statusRows].sort((a, b) => b.count - a.count)[0];
      const leadPct = total > 0 ? (lead.count / total) * 100 : 0;
      return [
        `${total} orders are spread across ${statusRows.length} active status categories.`,
        `${lead?.status?.replace(/_/g, ' ') || 'Top status'} is highest at ${leadPct.toFixed(1)}% of tracked orders.`,
        `This status distribution reveals where order flow is smooth and where intervention is needed to reduce delays or cancellations.`
      ];
    })(),
    recentOrders: [
      `${Math.min(filteredOrders.length, 15)} recent orders are shown as the latest operational sample.`,
      `The order list reflects current buyer activity, fulfillment pace, and value per transaction.`,
      `Reviewing this section helps quickly catch service gaps and prioritize customer follow-ups.`
    ]
  };

  const buildExportRows = () => {
    const rows = [
      ['FarmToClick Farmer Performance Report'],
      [`Period: Last ${reportDays} Days`],
      [`Generated: ${generatedDate}`],
      [`Farmer: ${user.first_name} ${user.last_name}`],
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
        farmerInterpretations.kpi,
        ['Metric', 'Value'],
        [
          ['Total Revenue', totalRevenue],
          ['Total Orders', totalOrders],
          ['Delivered Orders', deliveredOrders],
          ['Pending Orders', pendingOrders],
          ['Cancelled Orders', cancelledOrders],
          ['Completion Rate', `${completionRate}%`]
        ]
      );
    }

    if (selectedSections.topProducts && hasTopProducts) {
      pushSection(
        'Top Products Performance',
        farmerInterpretations.topProducts,
        ['Product Name', 'Revenue'],
        topProductRows.map(([name, rev]) => [name, Number(rev || 0)])
      );
    }

    if (selectedSections.orderStatus && hasOrderStatus) {
      pushSection(
        'Order Status Breakdown',
        farmerInterpretations.orderStatus,
        ['Status', 'Count', '% of Total'],
        statusRows.map((row) => [row.status.replace(/_/g, ' '), row.count, totalOrders > 0 ? `${((row.count / totalOrders) * 100).toFixed(1)}%` : '0.0%'])
      );
    }

    if (selectedSections.recentOrders && hasRecentOrders) {
      pushSection(
        'Recent Orders',
        farmerInterpretations.recentOrders,
        ['Order ID', 'Date', 'Customer', 'Status', 'Amount'],
        filteredOrders.slice(0, 15).map((order) => {
          const amount = order.items
            ? order.items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
            : (parseFloat(order.total_amount) || 0);
          return [
            order.id?.substring(0, 6).toUpperCase() || 'N/A',
            formatDate(order.created_at),
            order.shipping_name || order.buyer_name || order.customer_name || 'Unknown',
            (order.status || 'pending').replace(/_/g, ' '),
            amount
          ];
        })
      );
    }

    return rows;
  };

  const handleExportExcel = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Farmer Report');
    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `FarmToClick_Farmer_Report_${reportDays}d_${dateStamp}.xlsx`);
  };

  const handleExportCSV = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadBlob(csv, `FarmToClick_Farmer_Report_${reportDays}d_${dateStamp}.csv`, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="printable-reports-page">
      <Navbar activePage="myshop" />

      <div className="print-controls no-print">
        <div className="container">
          <div className="controls-header">
            <h2><i className="fas fa-print"></i> Farmer Reports</h2>
            <div className="controls-actions">
              <Link to="/farmer-dashboard" className="btn btn-outline">Back to Dashboard</Link>
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
              <select value={reportDays} onChange={(e) => setReportDays(Number(e.target.value))} className="form-control">
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
                <option value={365}>Last 365 Days</option>
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
      ) : (
        <div className="print-container">
          <div className="print-content" ref={printRef}>
            <div className="report-header">
              <div className="report-logo">
                <i className="fas fa-leaf"></i> FarmToClick
              </div>
              <h1 className="report-title">Farmer Performance Report</h1>
              <div className="report-meta">
                <span>Period: Last {reportDays} Days</span>
                <span className="report-meta-sep">|</span>
                <span>Generated: {generatedDate}</span>
                <span className="report-meta-sep">|</span>
                <span>Farmer: {user.first_name} {user.last_name}</span>
              </div>
            </div>

            {selectedSections.kpi && hasKpi && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">1</span> Key Performance Indicators</h3>
                <table className="print-table kpi-table compact-table">
                  <tbody>
                    <tr>
                      <td>Total Revenue</td>
                      <td className="text-right mono">{formatCurrency(totalRevenue)}</td>
                    </tr>
                    <tr>
                      <td>Total Orders</td>
                      <td className="text-right mono">{totalOrders}</td>
                    </tr>
                    <tr>
                      <td>Delivered Orders</td>
                      <td className="text-right mono">{deliveredOrders}</td>
                    </tr>
                    <tr>
                      <td>Pending Orders</td>
                      <td className="text-right mono">{pendingOrders}</td>
                    </tr>
                    <tr>
                      <td>Cancelled Orders</td>
                      <td className="text-right mono">{cancelledOrders}</td>
                    </tr>
                    <tr className="totals-row">
                      <td>Completion Rate</td>
                      <td className="text-right mono">{completionRate}%</td>
                    </tr>
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {farmerInterpretations.kpi.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {selectedSections.topProducts && hasTopProducts && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">2</span> Top Products Performance</h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th className="text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductRows.map(([name, rev], idx) => (
                      <tr key={idx}>
                        <td>{name}</td>
                        <td className="text-right mono">{formatCurrency(rev)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {farmerInterpretations.topProducts.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

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
                    {statusRows.map((row) => {
                      const pct = totalOrders > 0 ? ((row.count / totalOrders) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={row.status}>
                          <td style={{ textTransform: 'capitalize' }}>{row.status.replace(/_/g, ' ')}</td>
                          <td className="text-right mono">{row.count}</td>
                          <td className="text-right mono">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {farmerInterpretations.orderStatus.map((line, idx) => <p key={idx}>{line}</p>)}
                </div>
              </div>
            )}

            {selectedSections.recentOrders && hasRecentOrders && (
              <div className="report-section">
                <h3 className="section-title"><span className="section-num">4</span> Recent Orders</h3>
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
                    {filteredOrders.slice(0, 15).map((order, idx) => {
                      const amount = order.items
                        ? order.items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.quantity || 1), 0)
                        : (parseFloat(order.total_amount) || 0);
                      return (
                        <tr key={idx}>
                          <td className="mono">{order.id?.substring(0, 6).toUpperCase() || 'N/A'}</td>
                          <td>{formatDate(order.created_at)}</td>
                          <td>{order.shipping_name || order.buyer_name || order.customer_name || 'Unknown'}</td>
                          <td style={{ textTransform: 'capitalize' }}>{(order.status || 'pending').replace(/_/g, ' ')}</td>
                          <td className="text-right mono">{formatCurrency(amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="interpretation-block">
                  {farmerInterpretations.recentOrders.map((line, idx) => <p key={idx}>{line}</p>)}
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

export default FarmerPrintableReports;
