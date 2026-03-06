import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useForm } from 'react-hook-form';

const Register = () => {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm();
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [flashMessages, setFlashMessages] = useState([]);
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (data) => {
    // Password match is handled by react-hook-form validate
    
    const result = await registerUser({
      email: data.email,
      password: data.password,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      is_farmer: false,
    });
    
    if (result.success) {
      setFlashMessages([{ category: 'success', text: 'Account created successfully! Welcome to FarmtoClick.' }]);
      setTimeout(() => navigate('/products'), 2000);
    } else {
      setFlashMessages([{ category: 'error', text: result.message }]);
    }
  };

  const password = watch("password", "");

  return (
    <>
      {/* Flash Messages */}
      {flashMessages.length > 0 && (
        <div className="flash-messages" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000 }}>
          {flashMessages.map((message, index) => (
            <div key={index} className={`flash-message flash-${message.category}`}>
              <i className={`fas fa-${message.category === 'success' ? 'check-circle' : message.category === 'error' ? 'exclamation-circle' : 'info-circle'}`}></i>
              {message.text}
              <button className="flash-close" onClick={() => {
                const newMessages = [...flashMessages];
                newMessages.splice(index, 1);
                setFlashMessages(newMessages);
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="auth-split-card">
          <div className="auth-header">
            <h2><i className="fas fa-user-plus"></i> Create Account</h2>
            <p>Join FarmtoClick to connect with local farmers</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="auth-form">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">First Name</label>
                  <input
                    type="text"
                    className={`form-control ${errors.first_name ? 'is-invalid' : ''}`}
                    {...register("first_name", { required: "First name is required" })}
                  />
                  {errors.first_name && <small className="text-danger" style={{ color: 'red', fontSize: '0.8rem' }}>{errors.first_name.message}</small>}
                </div>

                <div className="form-group">
                  <label className="form-label">Last Name</label>
                  <input
                    type="text"
                    className={`form-control ${errors.last_name ? 'is-invalid' : ''}`}
                    {...register("last_name", { required: "Last name is required" })}
                  />
                  {errors.last_name && <small className="text-danger" style={{ color: 'red', fontSize: '0.8rem' }}>{errors.last_name.message}</small>}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className={`form-control ${errors.email ? 'is-invalid' : ''}`}
                  {...register("email", { 
                    required: "Email is required",
                    pattern: {
                      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                      message: "Invalid email address"
                    }
                  })}
                />
                {errors.email && <small className="text-danger" style={{ color: 'red', fontSize: '0.8rem' }}>{errors.email.message}</small>}
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input
                  type="tel"
                  className={`form-control ${errors.phone ? 'is-invalid' : ''}`}
                  {...register("phone")}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div className="password-field">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                      {...register("password", { 
                        required: "Password is required",
                        minLength: {
                          value: 6,
                          message: "Password must be at least 6 characters"
                        }
                      })}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(s => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <i className={`fas fa-${showPassword ? 'eye-slash' : 'eye'}`}></i>
                    </button>
                  </div>
                  {errors.password && <small className="text-danger" style={{ color: 'red', fontSize: '0.8rem' }}>{errors.password.message}</small>}
                </div>

                <div className="form-group">
                  <label className="form-label">Confirm Password</label>
                  <div className="password-field">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      className={`form-control ${errors.confirmPassword ? 'is-invalid' : ''}`}
                      {...register("confirmPassword", { 
                        required: "Confirm Password is required",
                        validate: value => value === password || "Passwords do not match"
                      })}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirm(s => !s)}
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    >
                      <i className={`fas fa-${showConfirm ? 'eye-slash' : 'eye'}`}></i>
                    </button>
                  </div>
                  {errors.confirmPassword && <small className="text-danger" style={{ color: 'red', fontSize: '0.8rem' }}>{errors.confirmPassword.message}</small>}
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
                {isSubmitting ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div className="auth-footer">
              <p>Already have an account? <Link to="/login">Login here</Link></p>
            </div>
          </div>
    </>
  );
};

export default Register;