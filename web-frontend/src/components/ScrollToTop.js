import React, { useState, useEffect } from 'react';

const ScrollToTop = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <>
      {visible && (
        <button onClick={scrollToTop} aria-label="Scroll to top" style={styles.button}>
          <i className="fas fa-arrow-up" style={styles.icon}></i>
        </button>
      )}
    </>
  );
};

const styles = {
  button: {
    position: 'fixed',
    bottom: '32px',
    right: '32px',
    zIndex: 9999,
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, #1a5f1a 0%, #2c7a2c 100%)',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(44,122,44,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.25s, transform 0.2s',
    opacity: 1,
  },
  icon: {
    fontSize: '1.15rem',
  },
};

export default ScrollToTop;
