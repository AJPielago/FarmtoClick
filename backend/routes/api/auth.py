"""
Auth routes – login, register, current user (``/auth/me``).
"""
from datetime import datetime

from flask import request, jsonify, current_app
import jwt

from db import get_mongodb_db
from user_model import User
from . import api_bp


# ------------------------------------------------------------------
# Login
# ------------------------------------------------------------------
@api_bp.route('/auth/login', methods=['POST'])
def api_login():
    try:
        data = request.get_json()
        if not data or not data.get('email') or not data.get('password'):
            return jsonify({'error': 'Email and password are required'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, data['email'])
        if user and user.check_password(data['password']):
            token = jwt.encode(
                {
                    'user_id': str(user.id),
                    'email': user.email,
                    'exp': datetime.utcnow() + current_app.config['JWT_ACCESS_TOKEN_EXPIRE'],
                },
                current_app.config['JWT_SECRET_KEY'],
                algorithm='HS256',
            )
            return jsonify({
                'token': token,
                'user': {
                    'id': str(user.id),
                    'email': user.email,
                    'first_name': user.first_name,
                    'last_name': user.last_name,
                    'phone': getattr(user, 'phone', ''),
                    'role': user.role,
                    'is_admin': user.role == 'admin',
                    'is_farmer': user.role == 'farmer',
                    'is_rider': user.role == 'rider',
                    'profile_picture': user.profile_picture,
                    'overall_location': getattr(user, 'overall_location', ''),
                    'shipping_address': getattr(user, 'shipping_address', ''),
                },
            })

        return jsonify({'error': 'Invalid credentials'}), 401
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Register
# ------------------------------------------------------------------
@api_bp.route('/auth/register', methods=['POST'])
def api_register():
    try:
        data = request.get_json()
        required = ['email', 'password', 'first_name', 'last_name']
        if not all(f in data for f in required):
            return jsonify({'error': 'Missing required fields'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if User.get_by_email(db, data['email']):
            return jsonify({'error': 'User already exists'}), 409

        user = User(
            email=data['email'],
            first_name=data['first_name'],
            last_name=data['last_name'],
            phone=data.get('phone', ''),
            role='user',  # Force user role - admin/farmer roles are assigned by admins only
        )
        user.set_password(data['password'])
        user.save(db)

        token = jwt.encode(
            {
                'user_id': str(user.id),
                'email': user.email,
                'exp': datetime.utcnow() + current_app.config['JWT_ACCESS_TOKEN_EXPIRE'],
            },
            current_app.config['JWT_SECRET_KEY'],
            algorithm='HS256',
        )
        return jsonify({
            'token': token,
            'user': {
                'id': str(user.id),
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'phone': getattr(user, 'phone', ''),
                'role': user.role,
                'is_admin': user.role == 'admin',
                'is_farmer': user.role == 'farmer',
                'is_rider': user.role == 'rider',
                'profile_picture': user.profile_picture,
                'overall_location': getattr(user, 'overall_location', ''),
                'shipping_address': getattr(user, 'shipping_address', ''),
            },
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Current user (``/auth/me``)
# ------------------------------------------------------------------
@api_bp.route('/auth/me', methods=['GET'])
def api_current_user():
    """Returns the current authenticated user's full data including role."""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'No token provided'}), 401

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        try:
            payload = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        user = User.get_by_id(db, payload['user_id'])
        if not user:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({
            'user': {
                'id': str(user.id),
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'role': user.role,
                'is_admin': user.role == 'admin',
                'is_farmer': user.role == 'farmer',
                'profile_picture': user.profile_picture,
                'phone': getattr(user, 'phone', ''),
                'overall_location': getattr(user, 'overall_location', ''),
                'shipping_address': getattr(user, 'shipping_address', ''),
            },
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
