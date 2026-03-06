"""
Database connection helpers for MongoDB (PyMongo + MongoEngine).
"""
from flask import current_app
from pymongo import MongoClient

_mongo_client = None


def get_mongodb_db(_ignored=None):
    """Provide PyMongo database/client using the current Flask app config.
    
    The optional ``_ignored`` parameter exists solely for backward-compatibility
    so callers that still pass an app/blueprint reference won't break.
    """
    global _mongo_client
    try:
        if _mongo_client is None:
            _mongo_client = MongoClient(current_app.config['MONGODB_URI'])
            print("[OK] PyMongo client initialized!")
        db = _mongo_client.get_database()
        return db, _mongo_client
    except Exception as e:
        print(f"[ERROR] PyMongo connection failed: {e}")
        return None, None


def get_mongoengine_user(pymongo_user):
    """Ensure a corresponding MongoEngine User document exists for a PyMongo-backed user."""
    if not pymongo_user:
        return None
    try:
        from models import User as MEUser

        def _get(value, key, default=None):
            if hasattr(value, key):
                return getattr(value, key)
            if isinstance(value, dict):
                return value.get(key, default)
            return default

        email = _get(pymongo_user, 'email')
        if not email:
            return None

        fields = {
            'email': email,
            'password_hash': _get(pymongo_user, 'password_hash', ''),
            'first_name': _get(pymongo_user, 'first_name', ''),
            'last_name': _get(pymongo_user, 'last_name', ''),
            'phone': _get(pymongo_user, 'phone'),
            'role': _get(pymongo_user, 'role', 'user'),
            'farm_name': _get(pymongo_user, 'farm_name'),
            'farm_location': _get(pymongo_user, 'farm_location'),
            'farm_phone': _get(pymongo_user, 'farm_phone'),
            'profile_picture': _get(pymongo_user, 'profile_picture')
        }

        me_user = MEUser.objects(email=email).first()
        if me_user is not None:
            update_fields = {k: v for k, v in fields.items() if v is not None and k != 'email'}
            if update_fields:
                me_user.update(**update_fields)
                me_user.reload()
            return me_user

        create_fields = {k: v for k, v in fields.items() if v is not None}
        me_user = MEUser(**create_fields)
        me_user.save()
        return me_user
    except Exception as exc:
        print(f"[ERROR] Failed to sync MongoEngine user: {exc}")
        return None


def ensure_mongoengine_user(current_user_obj):
    """Get or create a MongoEngine user from the Flask-Login current_user."""
    if not current_user_obj or not getattr(current_user_obj, 'is_authenticated', False):
        return None

    try:
        from models import User as MEUser
        from user_model import User as PyMongoUser

        if isinstance(current_user_obj, MEUser):
            return current_user_obj

        email = getattr(current_user_obj, 'email', None)
        if not email:
            return None

        me_user = MEUser.objects(email=email).first()
        if me_user is not None:
            return me_user

        if isinstance(current_user_obj, PyMongoUser):
            fields = {
                'email': email,
                'password_hash': getattr(current_user_obj, 'password_hash', ''),
                'first_name': getattr(current_user_obj, 'first_name', '') or 'Farmer',
                'last_name': getattr(current_user_obj, 'last_name', '') or 'User',
                'phone': getattr(current_user_obj, 'phone', None),
                'role': getattr(current_user_obj, 'role', 'user'),
                'farm_name': getattr(current_user_obj, 'farm_name', None),
                'farm_location': getattr(current_user_obj, 'farm_location', None),
                'farm_phone': getattr(current_user_obj, 'farm_phone', None),
                'profile_picture': getattr(current_user_obj, 'profile_picture', None),
                'is_active': bool(getattr(current_user_obj, 'is_active', True)),
            }
            fields = {k: v for k, v in fields.items()
                      if k in ('email', 'password_hash', 'first_name', 'last_name', 'role', 'is_active') or v is not None}

            if not fields.get('password_hash') or len(fields['password_hash']) < 6:
                from werkzeug.security import generate_password_hash
                fields['password_hash'] = generate_password_hash('temporary_password')

            me_user = MEUser(**fields)
            me_user.save()
            return me_user

        return None
    except Exception as e:
        print(f"[ERROR] ensure_mongoengine_user error: {e}")
        return None
