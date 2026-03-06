"""
Authentication middleware / decorators.
"""
from functools import wraps
from flask import request, jsonify, current_app
import jwt


def token_required(f):
    """Decorator to require a valid JWT token on API endpoints."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': 'Token is missing'}), 401

        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(
                token,
                current_app.config['JWT_SECRET_KEY'],
                algorithms=['HS256']
            )
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        request.user_id = data['user_id']
        request.user_email = data['email']
        return f(*args, **kwargs)
    return decorated
