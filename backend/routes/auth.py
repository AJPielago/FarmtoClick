"""
Authentication routes (template-rendered login / register / logout).
"""
from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, login_user, logout_user, current_user
from datetime import datetime

from db import get_mongodb_db

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')


@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        try:
            from user_model import User

            db, _ = get_mongodb_db(auth_bp)
            if db is None:
                flash('Database connection failed. Please try again.', 'error')
                return render_template('auth/register.html')

            first_name = request.form.get('first_name', '').strip()
            last_name = request.form.get('last_name', '').strip()
            email = request.form.get('email', '').strip()
            phone = request.form.get('phone', '').strip()
            password = request.form.get('password', '')
            confirm_password = request.form.get('confirm_password', '')
            role = 'user'

            if not first_name or not last_name or not email or not password:
                flash('All required fields must be filled.', 'error')
                return render_template('auth/register.html')

            if len(password) < 6:
                flash('Password must be at least 6 characters long.', 'error')
                return render_template('auth/register.html')

            if password != confirm_password:
                flash('Passwords do not match.', 'error')
                return render_template('auth/register.html')

            existing_user = User.get_by_email(db, email)
            if existing_user:
                flash('Email already registered. Please login.', 'error')
                return redirect('/auth/login')

            user = User(
                email=email,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                role=role,
            )
            user.set_password(password)
            user.save(db)

            login_user(user)
            flash('Registration successful! Welcome to FarmtoClick!', 'success')
            return redirect('/products')

        except Exception as e:
            print(f"❌ Registration failed: {e}")
            flash(f'Registration failed: {str(e)}', 'error')

    return render_template('auth/register.html')


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        try:
            from user_model import User
            from flask import session

            db, _ = get_mongodb_db(auth_bp)
            if db is None:
                flash('Database connection failed. Please try again.', 'error')
                return render_template('auth/login.html')

            email = request.form.get('email', '').strip()
            password = request.form.get('password', '')

            if not email or not password:
                flash('Email and password are required.', 'error')
                return render_template('auth/login.html')

            user = User.get_by_email(db, email)
            if user and user.check_password(password):
                session.permanent = True
                login_user(user)
                flash(f'Welcome back, {user.first_name}! Redirecting to marketplace...', 'success')
                return redirect('/products')

            flash('Invalid email or password.', 'error')

        except Exception as e:
            print(f"❌ Login failed: {e}")
            flash(f'Login failed: {str(e)}', 'error')

    return render_template('auth/login.html')


@auth_bp.route('/logout')
@login_required
def logout():
    user_name = current_user.first_name
    logout_user()
    flash(f'Goodbye, {user_name}!', 'info')
    return redirect('/')
