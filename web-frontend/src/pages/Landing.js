import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { dtiAPI } from '../services/api';
import {
  LineChart, Line, ResponsiveContainer, YAxis, Tooltip
} from 'recharts';

const Landing = () => {
  const { user } = useAuth();
  const [activeFaq, setActiveFaq] = useState(null);
  const [pricePredictions, setPricePredictions] = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(true);
  const [showForecastPopup, setShowForecastPopup] = useState(false);

  const toggleFaq = (index) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const faqs = [
    {
      question: "What is FarmtoClick?",
      answer: "FarmtoClick is a capstone research project that explores how web and mobile technology can bridge the gap between local farmers and consumers. It provides a platform for direct farm-to-consumer transactions, real-time product listings, and integrated delivery logistics."
    },
    {
      question: "What technologies were used?",
      answer: "The system was built using React.js for the web frontend, React Native (Expo) for the mobile app, Flask (Python) for the backend API, and SQLite/PostgreSQL for the database. Additional integrations include PayMongo for payments, Lalamove for delivery, and machine learning for permit verification."
    },
    {
      question: "Can I use the platform?",
      answer: "Yes! The platform is live for demonstration and testing. You can register as a consumer to browse products, or apply as a farmer to list your own produce. The system demonstrates the full lifecycle of a farm-to-consumer marketplace."
    },
    {
      question: "How does the AI permit verification work?",
      answer: "The system uses a trained machine learning model to analyze uploaded farmer permits. It extracts key features from permit images and classifies them as authentic or non-authentic, streamlining the farmer verification process for administrators."
    },
    {
      question: "What is the DTI Price Engine?",
      answer: "The DTI Price Engine integrates suggested retail prices from the Department of Trade and Industry. It helps ensure fair pricing for consumers by providing reference price ranges for common agricultural products."
    },
    {
      question: "Is this project open source?",
      answer: "This project was developed as an academic capstone. The source code and documentation are available to the research panel and academic institution. Please contact the development team for collaboration inquiries."
    }
  ];

  // Load predicted prices (public, no auth required)
  useEffect(() => {
    let mounted = true;
    const loadPredictions = async () => {
      try {
        setLoadingPredictions(true);
        const res = await dtiAPI.getPublicPricePredictions(6, 1);
        if (mounted) {
          const predictions = res.data?.predictions || [];
          setPricePredictions(predictions);
          if (predictions.length > 0) setShowForecastPopup(true);
        }
      } catch (e) {
        console.warn('Failed loading price predictions', e);
      } finally {
        if (mounted) setLoadingPredictions(false);
      }
    };
    loadPredictions();
    return () => { mounted = false; };
  }, []);

  const teamMembers = [
    { name: 'Member 1', role: 'Full-Stack Developer', icon: 'fa-user-graduate' },
    { name: 'Member 2', role: 'Frontend Developer', icon: 'fa-user-graduate' },
    { name: 'Member 3', role: 'Backend Developer', icon: 'fa-user-graduate' },
    { name: 'Member 4', role: 'UI/UX & QA', icon: 'fa-user-graduate' },
  ];

  const publications = [
    {
      title: 'Digital Marketplaces and Agricultural Supply Chains',
      authors: 'Smith, J. & Lee, K.',
      venue: 'Journal of Rural Studies',
      year: '2022',
      type: 'Related Literature',
      abstract: 'This paper explores how digital platforms transform agricultural supply chains by reducing intermediaries, improving price transparency, and increasing farmer income.',
      icon: 'fa-globe'
    },
    {
      title: 'Mobile Applications for Smallholder Farmers',
      authors: 'Garcia, M. et al.',
      venue: 'Computers and Electronics in Agriculture',
      year: '2021',
      type: 'Related Literature',
      abstract: 'A review of mobile app solutions that empower smallholder farmers with market access, weather information, and digital payments, highlighting adoption challenges in developing countries.',
      icon: 'fa-mobile-alt'
    },
    {
      title: 'AI in Document Verification: A Survey',
      authors: 'Patel, R. & Singh, A.',
      venue: 'IEEE Access',
      year: '2023',
      type: 'Related Literature',
      abstract: 'A comprehensive survey of artificial intelligence techniques for document image verification, with applications in e-government, banking, and agricultural vendor authentication.',
      icon: 'fa-robot'
    }
  ];

  const techStack = [
    { name: 'React.js', category: 'Web Frontend', icon: 'fa-brands fa-react', color: '#61DAFB' },
    { name: 'React Native', category: 'Mobile App', icon: 'fa-mobile-alt', color: '#61DAFB' },
    { name: 'Flask (Python)', category: 'Backend API', icon: 'fa-brands fa-python', color: '#306998' },
    { name: 'SQLite / PostgreSQL', category: 'Database', icon: 'fa-database', color: '#336791' },
    { name: 'PayMongo', category: 'Payments', icon: 'fa-credit-card', color: '#5B21B6' },
    { name: 'Lalamove', category: 'Delivery', icon: 'fa-truck-fast', color: '#F97316' },
    { name: 'Scikit-learn', category: 'ML / AI', icon: 'fa-brain', color: '#F7931E' },
    { name: 'Expo', category: 'Mobile Framework', icon: 'fa-mobile-screen', color: '#000020' },
  ];

  return (
    <div className="landing">
      <Navbar activePage="home" />

      {/* Hero - Project Showcase */}
      <section id="home" className="hero">
        <div className="hero-background">
          <img src="/images/farm.jpg" alt="FarmtoClick - Capstone Research Project" className="hero-bg-img" />
          <div className="hero-overlay"></div>
        </div>
        <div className="hero-container">
          <div className="hero-content">
            <div className="hero-text">

              <h1>FarmtoClick</h1>
              <p>A full-stack web and mobile platform that connects local farmers directly with consumers, featuring AI-powered permit verification, integrated logistics, and real-time marketplace capabilities.</p>
              <div className="hero-buttons">
                <a href="#about" className="btn btn-primary btn-large">Explore the Project</a>
                <a href="#publications" className="btn btn-outline btn-large">View Publications</a>
              </div>
            </div>
          </div>
        </div>
      </section>

       {/* ── Platform Overview ── */}
      <section id="about" className="platform-overview">
        <div className="container">

          {/* Row 1: About — 3 highlight cards */}
          <div className="overview-block">
            <div className="overview-label">
              <span className="section-badge">About</span>
              <h2>About the Project</h2>
            </div>
            <div className="overview-about-row">
              <div className="oa-card">
                <div>
                  <strong>The Problem</strong>
                  <p>Multiple intermediaries cut into farmer income and raise prices for consumers, with no direct market access.</p>
                </div>
              </div>
              <div className="oa-card">
                <div>
                  <strong>The Solution</strong>
                  <p>A unified web &amp; mobile marketplace connecting farmers directly with consumers, cutting out the middlemen.</p>
                </div>
              </div>
              <div className="oa-card">
                <div>
                  <strong>The Impact</strong>
                  <p>Higher farmer earnings, fresher produce, AI-assisted verification, and fair DTI-backed pricing for all.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="overview-divider"></div>

          {/* Row 2: Features (left) + Objectives (right) */}
          <div className="overview-two-col">

            {/* Features */}
            <div className="overview-block">
              <div className="overview-label">
                <span className="section-badge">Features</span>
                <h2>Key Features</h2>
              </div>
              <div className="ov-features-grid">
                {[
                  { icon: 'fa-store',          name: 'Farmer Dashboard' },
                  { icon: 'fa-robot',          name: 'AI Permit Verify' },
                  { icon: 'fa-money-bill-wave',name: 'Digital Payments' },
                  { icon: 'fa-truck-fast',     name: 'Delivery (Lalamove)' },
                  { icon: 'fa-tags',           name: 'DTI Price Engine' },
                  { icon: 'fa-shield-alt',     name: 'Role-Based Access' },
                ].map((f, i) => (
                  <div key={i} className="ov-feature-chip">
                    <i className={`fas ${f.icon}`}></i>
                    <span>{f.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Objectives */}
            <div className="overview-block">
              <div className="overview-label">
                <span className="section-badge">Goals</span>
                <h2>Objectives</h2>
              </div>
              <ol className="ov-objectives">
                <li>Develop a multi-platform marketplace (web &amp; mobile)</li>
                <li>Integrate AI-powered farmer permit verification</li>
                <li>Implement fair pricing via DTI integration</li>
                <li>Enable end-to-end order fulfillment (PayMongo + Lalamove)</li>
                <li>Evaluate usability and platform effectiveness</li>
              </ol>
            </div>

          </div>

          <div className="overview-divider"></div>

          {/* Row 3: RRL as compact citation cards */}
          <div className="overview-block">
            <div className="overview-label">
              <span className="section-badge">Related Literature</span>
              <h2>Related Works</h2>
            </div>
            <div className="ov-rrl-row">
              {publications.map((pub, i) => (
                <div key={i} className="ov-rrl-card">
                  <i className={`fas ${pub.icon} ov-rrl-icon`}></i>
                  <div>
                    <p className="ov-rrl-title">{pub.title}</p>
                    <p className="ov-rrl-meta">{pub.authors} &middot; <em>{pub.venue}</em> ({pub.year})</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* AI Forecast Announcement Pop-up */}
      {showForecastPopup && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
          animation: 'fadeIn 0.25s ease',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForecastPopup(false); }}
        >
          <div style={{
            background: '#fff', borderRadius: 20, maxWidth: 860, width: '100%',
            maxHeight: '88vh', overflowY: 'auto',
            boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
            position: 'relative',
            animation: 'slideUp 0.3s ease',
          }}>
            {/* Pop-up Header */}
            <div style={{
              background: 'linear-gradient(135deg, #2e7d32, #66BB6A)',
              borderRadius: '20px 20px 0 0',
              padding: '24px 28px 20px',
              color: '#fff',
              position: 'sticky', top: 0, zIndex: 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{
                      background: 'rgba(255,255,255,0.22)', borderRadius: 20,
                      padding: '3px 12px', fontSize: '0.78rem', fontWeight: 600, letterSpacing: 0.5,
                    }}>
                      <i className="fas fa-robot" style={{ marginRight: 5 }}></i>AI ANNOUNCEMENT
                    </span>
                  </div>
                  <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 700 }}>
                    <i className="fas fa-chart-line" style={{ marginRight: 10, opacity: 0.85 }}></i>
                    Tomorrow's Predicted Prices
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.88rem', opacity: 0.88 }}>
                    AI forecast powered by DTI historical data — most popular products
                  </p>
                </div>
                <button
                  onClick={() => setShowForecastPopup(false)}
                  style={{
                    background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: '50%',
                    width: 36, height: 36, cursor: 'pointer', color: '#fff',
                    fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginLeft: 12,
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.32)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
                  aria-label="Close"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            </div>

            {/* Pop-up Body */}
            <div style={{ padding: '24px 28px 28px' }}>
              {loadingPredictions ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#4CAF50' }}></i>
                  <p style={{ color: '#888', marginTop: 10 }}>Loading price predictions…</p>
                </div>
              ) : pricePredictions.length > 0 ? (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                    gap: '16px',
                    marginBottom: '24px',
                  }}>
                    {pricePredictions.map((pred, i) => {
                      const sparkData = [
                        ...(pred.history || []).map(h => ({ price: h.average_price })),
                        ...(pred.forecast || []).map(f => ({ price: f.predicted_price })),
                      ];
                      const trendColor = pred.trend === 'up' ? '#f44336' : pred.trend === 'down' ? '#4CAF50' : '#FF9800';
                      const trendIcon = pred.trend === 'up' ? 'fa-arrow-up' : pred.trend === 'down' ? 'fa-arrow-down' : 'fa-minus';
                      const priceDiff = (pred.price_change !== undefined ? pred.price_change : pred.predicted_price - pred.current_price).toFixed(2);

                      return (
                        <div key={i} style={{
                          background: '#fafafa', borderRadius: 14, padding: '18px',
                          border: '1px solid #ececec', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                          transition: 'transform 0.2s, box-shadow 0.2s',
                        }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                            <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: '#222', flex: 1 }}>{pred.product_name}</h4>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '3px 9px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
                              background: pred.trend === 'up' ? '#fce4ec' : pred.trend === 'down' ? '#e8f5e9' : '#fff3e0',
                              color: trendColor, flexShrink: 0, marginLeft: 8,
                            }}>
                              <i className={`fas ${trendIcon}`} style={{ fontSize: '0.65rem' }}></i>
                              {pred.trend_pct > 0 ? '+' : ''}{pred.trend_pct}%
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>Current</div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#333' }}>₱{pred.current_price?.toFixed(2)}</div>
                            </div>
                            <div style={{ borderLeft: '1px solid #eee', paddingLeft: 14 }}>
                              <div style={{ fontSize: '0.68rem', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tomorrow</div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#388E3C' }}>₱{pred.predicted_price?.toFixed(2)}</div>
                            </div>
                            <div style={{ borderLeft: '1px solid #eee', paddingLeft: 14 }}>
                              <div style={{ fontSize: '0.68rem', color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>Change</div>
                              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: trendColor }}>
                                {Number(priceDiff) >= 0 ? '+' : ''}₱{priceDiff}
                              </div>
                            </div>
                          </div>

                          {sparkData.length > 1 && (
                            <div style={{ width: '100%', height: 46, marginTop: 4 }}>
                              <ResponsiveContainer width="100%" height={46}>
                                <LineChart data={sparkData}>
                                  <YAxis domain={['auto', 'auto']} hide />
                                  <Tooltip
                                    formatter={(val) => [`₱${Number(val).toFixed(2)}`, 'Price']}
                                    contentStyle={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6 }}
                                  />
                                  <Line
                                    type="monotone" dataKey="price" dot={false}
                                    stroke={pred.trend === 'down' ? '#4CAF50' : pred.trend === 'up' ? '#f44336' : '#FF9800'}
                                    strokeWidth={2}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#bbb', marginTop: -2 }}>
                                <span>Historical</span>
                                <span>→ Forecast</span>
                              </div>
                            </div>
                          )}

                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#aaa', marginBottom: 3 }}>
                              <span>Confidence (R²)</span>
                              <span>{(pred.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div style={{ background: '#f0f0f0', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                              <div style={{
                                width: `${Math.min(pred.confidence * 100, 100)}%`,
                                height: '100%', borderRadius: 4,
                                background: pred.confidence > 0.7 ? '#4CAF50' : pred.confidence > 0.4 ? '#FF9800' : '#f44336',
                              }}></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                    <Link
                      to="/price-trends"
                      className="btn btn-primary"
                      style={{ padding: '11px 28px', fontSize: '0.95rem' }}
                      onClick={() => setShowForecastPopup(false)}
                    >
                      <i className="fas fa-chart-line" style={{ marginRight: 8 }}></i>
                      View Full Analysis
                    </Link>
                    <button
                      onClick={() => setShowForecastPopup(false)}
                      style={{
                        padding: '11px 24px', fontSize: '0.95rem', borderRadius: 8,
                        border: '1px solid #ddd', background: '#fff', cursor: 'pointer',
                        color: '#555', fontWeight: 500,
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      Dismiss
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#999' }}>
                  <i className="fas fa-chart-bar" style={{ fontSize: '2rem', opacity: 0.4, marginBottom: 10 }}></i>
                  <p>No price prediction data available yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating "AI Forecast" trigger button */}
      {!loadingPredictions && pricePredictions.length > 0 && !showForecastPopup && (
        <button
          onClick={() => setShowForecastPopup(true)}
          title="View AI Price Forecast"
          style={{
            position: 'fixed', bottom: 28, right: 28, zIndex: 999,
            background: 'linear-gradient(135deg, #2e7d32, #66BB6A)',
            color: '#fff', border: 'none', borderRadius: 50,
            padding: '13px 22px', cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(46,125,50,0.4)',
            display: 'flex', alignItems: 'center', gap: 9,
            fontSize: '0.92rem', fontWeight: 600,
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(46,125,50,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 6px 20px rgba(46,125,50,0.4)'; }}
        >
          <i className="fas fa-chart-line"></i>
          AI Forecast
        </button>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Team */}
      <section className="team-section">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">Team</span>
            <h2>The Development Team</h2>
            <p>The people behind FarmtoClick</p>
          </div>
          <div className="team-grid">
            {teamMembers.map((member, index) => (
              <div key={index} className="team-card">
                <div className="team-avatar">
                  <i className={`fas ${member.icon}`}></i>
                </div>
                <h3>{member.name}</h3>
                <p className="team-role">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Educational Resources */}
      <section className="educational-resources">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">Learn</span>
            <h2>Related Resources</h2>
            <p>Videos and materials related to our research domain</p>
          </div>

          <div className="resources-grid">
            <div className="resource-card">
              <div className="resource-video">
                <div className="video-container">
                  <iframe
                    src="https://www.youtube.com/embed/dBnniua6-oM"
                    title="How to grow food in the desert"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen>
                  </iframe>
                </div>
              </div>
              <div className="resource-content">
                <h3>Sustainable Farming Practices</h3>
                <p>Discover how to grow food sustainably and efficiently, even in challenging environments.</p>
              </div>
            </div>

            <div className="resource-card">
              <div className="resource-video">
                <div className="video-container">
                  <iframe
                    src="https://www.youtube.com/embed/B2lspKVrHmY"
                    title="The future of food"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen>
                  </iframe>
                </div>
              </div>
              <div className="resource-content">
                <h3>The Future of Food Technology</h3>
                <p>Explore how technology is transforming agriculture and food distribution systems.</p>
              </div>
            </div>

            <div className="resource-card">
              <div className="resource-video">
                <div className="video-container">
                  <iframe
                    src="https://www.youtube.com/embed/DkZ7BJlFWY8"
                    title="Local food systems"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen>
                  </iframe>
                </div>
              </div>
              <div className="resource-content">
                <h3>Local Food Systems &amp; Direct Commerce</h3>
                <p>Understand how local food systems connect farmers directly with consumers.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-section">
        <div className="container">
          <div className="section-header">
            <span className="section-badge">FAQ</span>
            <h2>Frequently Asked Questions</h2>
            <p>Common questions about the FarmtoClick project</p>
          </div>

          <div className="faq-container">
            {faqs.map((faq, index) => (
              <div key={index} className={`faq-item ${activeFaq === index ? 'active' : ''}`}>
                <div className="faq-question" onClick={() => toggleFaq(index)}>
                  <h3>{faq.question}</h3>
                  <i className={`fas fa-chevron-down ${activeFaq === index ? 'active' : ''}`}></i>
                </div>
                <div className={`faq-answer ${activeFaq === index ? 'active' : ''}`}>
                  <p>{faq.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="cta-banner">
        <div className="container">
          <div className="cta-content">
            <h2>Try the Platform</h2>
            <p>Experience the FarmtoClick system firsthand. Register as a consumer or farmer to explore the full feature set.</p>
            <div className="cta-buttons">
              <Link to="/products" className="btn btn-primary btn-large">Browse Products</Link>
              <Link to="/register" className="btn btn-outline-light btn-large">Create Account</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="contact">
        <div className="container">
          <div className="section-header section-header-light">
            <span className="section-badge section-badge-light">Contact</span>
            <h2>Get in Touch</h2>
            <p>Questions about the project or interested in collaboration? Reach out to the team.</p>
          </div>
          <div className="contact-content">
            <div className="contact-info">
              <div className="contact-info-card">
                <div className="contact-icon"><i className="fas fa-envelope"></i></div>
                <div>
                  <h4>Email</h4>
                  <p>farmtoclick.capstone@gmail.com</p>
                </div>
              </div>
              <div className="contact-info-card">
                <div className="contact-icon"><i className="fas fa-university"></i></div>
                <div>
                  <h4>Institution</h4>
                  <p>BSIT Department</p>
                </div>
              </div>
              <div className="contact-info-card">
                <div className="contact-icon"><i className="fas fa-code-branch"></i></div>
                <div>
                  <h4>Repository</h4>
                  <p>github.com/farmtoclick</p>
                </div>
              </div>
            </div>
            <div className="contact-form">
              <form>
                <div className="form-row">
                  <input type="text" placeholder="Your Name" required />
                  <input type="email" placeholder="Your Email" required />
                </div>
                <textarea placeholder="Your Message or Feedback" rows="5" required></textarea>
                <button type="submit" className="btn btn-primary btn-large">Send Message <i className="fas fa-paper-plane"></i></button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Landing;