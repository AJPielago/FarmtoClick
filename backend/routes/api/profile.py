"""
User profile routes – view/update profile, addresses, and notifications.
"""
import os
import uuid

from flask import request, jsonify
from werkzeug.utils import secure_filename

from db import get_mongodb_db
from middleware import token_required
from user_model import User
from helpers import allowed_file, MAX_FILE_SIZE
from . import api_bp
from ._helpers import UPLOAD_FOLDER

import cloudinary
import cloudinary.uploader


# ------------------------------------------------------------------
# Get profile
# ------------------------------------------------------------------
@api_bp.route('/user/profile', methods=['GET'], endpoint='api_user_profile')
@token_required
def api_user_profile():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({
            'id': str(user.id),
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'phone': user.phone,
            'role': user.role,
            'is_admin': user.role == 'admin',
            'is_farmer': user.role == 'farmer',
            'is_rider': user.role == 'rider',
            'profile_picture': user.profile_picture,
            'farm_name': getattr(user, 'farm_name', ''),
            'farm_location': getattr(user, 'farm_location', ''),
            'overall_location': getattr(user, 'overall_location', ''),
            'shipping_address': getattr(user, 'shipping_address', ''),
            'overall_location_2': getattr(user, 'overall_location_2', ''),
            'shipping_address_2': getattr(user, 'shipping_address_2', ''),
            'addresses': getattr(user, 'addresses', []),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Update profile
# ------------------------------------------------------------------
@api_bp.route('/user/profile', methods=['PUT'], endpoint='api_update_profile')
@token_required
def api_update_profile():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form.to_dict()
        else:
            data = request.get_json() or {}

        for field in ('first_name', 'last_name', 'phone', 'overall_location', 'shipping_address', 'overall_location_2', 'shipping_address_2'):
            if field in data:
                setattr(user, field, data[field])

        if getattr(user, 'role', 'user') == 'farmer':
            for field in ('farm_name', 'farm_phone', 'farm_location', 'farm_description'):
                if field in data:
                    setattr(user, field, data[field])

        # Profile picture
        remove_picture = data.get('remove_profile_picture') == '1'
        profile_picture = request.files.get('profile_picture')

        if remove_picture:
            try:
                if hasattr(user, 'profile_picture') and user.profile_picture and user.profile_picture.startswith('http'):
                    import re
                    m = re.search(r"/upload/(?:v\d+/)?(.+?)\.(?:jpg|jpeg|png|gif|webp)$", user.profile_picture)
                    if m:
                        public_id = m.group(1)
                        try:
                            cloudinary.uploader.destroy(public_id)
                        except Exception:
                            pass
            except Exception:
                pass

            if hasattr(user, 'profile_picture') and user.profile_picture:
                old = os.path.join(UPLOAD_FOLDER, user.profile_picture)
                if os.path.exists(old):
                    try:
                        os.remove(old)
                    except Exception:
                        pass
            user.profile_picture = None
        elif profile_picture and profile_picture.filename:
            if allowed_file(profile_picture.filename):
                profile_picture.seek(0, os.SEEK_END)
                fsize = profile_picture.tell()
                profile_picture.seek(0)
                if fsize > MAX_FILE_SIZE:
                    return jsonify({'error': 'Profile picture must be less than 5MB'}), 400

                try:
                    upload_res = cloudinary.uploader.upload(
                        profile_picture,
                        folder='farmtoclick/profiles',
                        resource_type='image',
                    )
                    secure_url = upload_res.get('secure_url')
                    if secure_url:
                        if hasattr(user, 'profile_picture') and user.profile_picture and not user.profile_picture.startswith('http'):
                            old = os.path.join(UPLOAD_FOLDER, user.profile_picture)
                            if os.path.exists(old):
                                try:
                                    os.remove(old)
                                except Exception:
                                    pass
                        user.profile_picture = secure_url
                    else:
                        raise Exception('No secure_url returned')
                except Exception:
                    filename = secure_filename(profile_picture.filename)
                    unique = f"{uuid.uuid4().hex}_{filename}"
                    try:
                        profile_picture.save(os.path.join(UPLOAD_FOLDER, unique))
                        if hasattr(user, 'profile_picture') and user.profile_picture:
                            old = os.path.join(UPLOAD_FOLDER, user.profile_picture)
                            if os.path.exists(old):
                                try:
                                    os.remove(old)
                                except Exception:
                                    pass
                        user.profile_picture = unique
                    except Exception as e:
                        return jsonify({'error': f'Failed to save profile picture: {str(e)}'}), 500
            else:
                return jsonify({'error': 'Invalid file type. Use JPG, PNG, GIF, or WebP.'}), 400

        # Password change
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')
        if new_password:
            if not current_password:
                return jsonify({'error': 'Current password is required'}), 400
            if not user.check_password(current_password):
                return jsonify({'error': 'Current password is incorrect'}), 400
            if len(new_password) < 6:
                return jsonify({'error': 'Password must be at least 6 characters'}), 400
            user.set_password(new_password)

        user.save(db)

        return jsonify({
            'message': 'Profile updated successfully',
            'user': {
                'id': str(user._id) if hasattr(user, '_id') else user.email,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'phone': getattr(user, 'phone', ''),
                'role': getattr(user, 'role', 'user'),
                'is_admin': getattr(user, 'role', 'user') == 'admin',
                'is_farmer': getattr(user, 'role', 'user') == 'farmer',
                'profile_picture': getattr(user, 'profile_picture', None),
                'overall_location': getattr(user, 'overall_location', ''),
                'shipping_address': getattr(user, 'shipping_address', ''),
                'overall_location_2': getattr(user, 'overall_location_2', ''),
                'shipping_address_2': getattr(user, 'shipping_address_2', ''),
                'farm_name': getattr(user, 'farm_name', ''),
                'farm_phone': getattr(user, 'farm_phone', ''),
                'farm_location': getattr(user, 'farm_location', ''),
                'farm_description': getattr(user, 'farm_description', ''),
                'addresses': getattr(user, 'addresses', []),
            },
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Addresses CRUD
# ------------------------------------------------------------------
@api_bp.route('/user/addresses', methods=['POST'])
@token_required
def api_add_address():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        new_address = {
            'id': str(uuid.uuid4()),
            'label': data.get('label', 'Home'),
            'full_name': data.get('full_name', user.full_name),
            'phone': data.get('phone', user.phone),
            'street': data.get('street', ''),
            'city': data.get('city', ''),
            'province': data.get('province', ''),
            'postal_code': data.get('postal_code', ''),
            'is_default': data.get('is_default', False),
        }

        addresses = getattr(user, 'addresses', [])
        if not addresses:
            new_address['is_default'] = True
        elif new_address['is_default']:
            for addr in addresses:
                addr['is_default'] = False

        addresses.append(new_address)
        user.addresses = addresses
        user.save(db)

        return jsonify({'message': 'Address added successfully', 'addresses': user.addresses})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/user/addresses/<address_id>', methods=['PUT'])
@token_required
def api_update_address(address_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        addresses = getattr(user, 'addresses', [])
        address_found = False

        if data.get('is_default'):
            for addr in addresses:
                addr['is_default'] = False

        for addr in addresses:
            if addr.get('id') == address_id:
                addr['label'] = data.get('label', addr.get('label'))
                addr['full_name'] = data.get('full_name', addr.get('full_name'))
                addr['phone'] = data.get('phone', addr.get('phone'))
                addr['street'] = data.get('street', addr.get('street'))
                addr['city'] = data.get('city', addr.get('city'))
                addr['province'] = data.get('province', addr.get('province'))
                addr['postal_code'] = data.get('postal_code', addr.get('postal_code'))
                if 'is_default' in data:
                    addr['is_default'] = data['is_default']
                address_found = True
                break

        if not address_found:
            return jsonify({'error': 'Address not found'}), 404

        user.addresses = addresses
        user.save(db)

        return jsonify({'message': 'Address updated successfully', 'addresses': user.addresses})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/user/addresses/<address_id>', methods=['DELETE'])
@token_required
def api_delete_address(address_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        addresses = getattr(user, 'addresses', [])
        initial_len = len(addresses)

        was_default = False
        for addr in addresses:
            if addr.get('id') == address_id and addr.get('is_default'):
                was_default = True
                break

        addresses = [addr for addr in addresses if addr.get('id') != address_id]

        if len(addresses) == initial_len:
            return jsonify({'error': 'Address not found'}), 404

        if was_default and addresses:
            addresses[0]['is_default'] = True

        user.addresses = addresses
        user.save(db)

        return jsonify({'message': 'Address deleted successfully', 'addresses': user.addresses})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/user/addresses/<address_id>/default', methods=['PUT'])
@token_required
def api_set_default_address(address_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        addresses = getattr(user, 'addresses', [])
        address_found = False

        for addr in addresses:
            if addr.get('id') == address_id:
                addr['is_default'] = True
                address_found = True
            else:
                addr['is_default'] = False

        if not address_found:
            return jsonify({'error': 'Address not found'}), 404

        user.addresses = addresses
        user.save(db)

        return jsonify({'message': 'Default address updated', 'addresses': user.addresses})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Notifications
# ------------------------------------------------------------------
@api_bp.route('/user/notifications', methods=['GET'])
@token_required
def api_user_notifications():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        cursor = db.notifications.find({'user_email': request.user_email}).sort('created_at', -1).limit(50)
        notifs = []
        for n in cursor:
            created_at = n.get('created_at')
            created_at_iso = created_at.isoformat() if hasattr(created_at, 'isoformat') else (created_at if created_at else None)
            notifs.append({
                'id': str(n.get('_id')),
                'subject': n.get('subject', ''),
                'message': n.get('message', ''),
                'read': bool(n.get('read', False)),
                'created_at': created_at_iso,
            })
        return jsonify(notifs)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/user/notifications/<notif_id>/read', methods=['POST'])
@token_required
def api_mark_notification_read(notif_id):
    try:
        from bson.objectid import ObjectId

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        try:
            oid = ObjectId(notif_id)
        except Exception:
            return jsonify({'error': 'Invalid notification id'}), 400

        res = db.notifications.update_one({'_id': oid, 'user_email': request.user_email}, {'$set': {'read': True}})
        if res.matched_count == 0:
            return jsonify({'error': 'Notification not found'}), 404
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
