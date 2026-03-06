import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';

const AuthLayout = () => {
  const location = useLocation();
  const isRegister = location.pathname === '/register';

  return (
    <div className="auth-split-container">
      <div className="auth-split-form-side">
        <div className="auth-form-transition-wrapper" key={location.pathname}>
          <Outlet />
        </div>
      </div>

      <div
        className="auth-split-image-side"
        style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/images/farm.jpg)` }}
      >
        <div className="auth-split-image-overlay">
          <h1>{isRegister ? 'Join Our Community' : 'FarmtoClick'}</h1>
          <p>
            {isRegister
              ? 'Support local agriculture and get access to the freshest produce directly from the source.'
              : 'Connecting local farmers directly with consumers for fresh, sustainable produce.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
