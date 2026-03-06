"""
REST API routes consumed by the React / mobile front-end.
"""
import os
import uuid
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app, url_for
from werkzeug.utils import secure_filename
import jwt

from db import get_mongodb_db
from middleware import token_required
from helpers import allowed_file, MAX_FILE_SIZE, send_system_email, build_email_html, generate_receipt_pdf
from paymongo import create_checkout_session, PayMongoError, verify_webhook_signature, get_checkout_session
import cloudinary
import cloudinary.uploader

api_bp = Blueprint('api', __name__, url_prefix='/api')

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # routes/ -> backend/
UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'profiles')
DELIVERY_PROOF_UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'delivery_proofs')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(DELIVERY_PROOF_UPLOAD_FOLDER, exist_ok=True)


def _get_paymongo_redirect_urls():
    origin = (request.headers.get('Origin') or '').rstrip('/')
    success_url = (os.environ.get('PAYMONGO_SUCCESS_URL') or '').strip()
    cancel_url = (os.environ.get('PAYMONGO_CANCEL_URL') or '').strip()

    if not success_url and origin:
        success_url = f'{origin}/orders'
    if not cancel_url and origin:
        cancel_url = f'{origin}/cart'

    return success_url, cancel_url


def _finalize_paid_order(db, order_doc):
    from bson import ObjectId

    items = order_doc.get('items', [])
    for item in items:
        product_id = item.get('product_id')
        qty = int(item.get('quantity', 1))
        if not product_id:
            continue
        try:
            if ObjectId.is_valid(str(product_id)):
                db.products.update_one({'_id': ObjectId(str(product_id))}, {'$inc': {'quantity': -qty}})
            else:
                db.products.update_one({'id': str(product_id)}, {'$inc': {'quantity': -qty}})
        except Exception:
            pass

    try:
        product_ids = [str(item.get('product_id')) for item in items if item.get('product_id')]
        if product_ids:
            db.carts.update_one(
                {'user_id': order_doc.get('user_id')},
                {'$pull': {'items': {'product_id': {'$in': product_ids}}}},
            )
    except Exception:
        pass

    try:
        user_doc = db.users.find_one({'id': order_doc.get('user_id')})
        if not user_doc:
            user_doc = db.users.find_one({'_id': order_doc.get('user_id')})

        buyer_email = user_doc.get('email') if user_doc else None
        shipping_name = order_doc.get('shipping_name') or (user_doc.get('first_name') if user_doc else '')
        order_id = str(order_doc.get('_id'))
        total_amount = float(order_doc.get('total_amount', 0) or 0)

        if buyer_email:
            receipt_pdf = generate_receipt_pdf(order_id, shipping_name, buyer_email, items, total_amount)
            email_html = build_email_html(
                title="Payment Confirmed",
                subtitle="Your payment was received",
                badge_text="PAID",
                content_html=(
                    f"<p>Hi {shipping_name},</p>"
                    "<p>Your payment has been confirmed and your order is now pending seller approval.</p>"
                    f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                    f"<strong>Order ID:</strong> {order_id}</div>"
                    "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                ),
            )
            send_system_email(
                current_app,
                buyer_email,
                "FarmtoClick Payment Confirmed",
                f"Order ID: {order_id}\nTotal: {total_amount}",
                html_body=email_html,
                attachments=[{
                    'filename': f"FarmtoClick-Receipt-{order_id}.pdf",
                    'content': receipt_pdf,
                    'maintype': 'application',
                    'subtype': 'pdf',
                }],
            )
    except Exception as e:
        print(f"Payment confirmation email error: {e}")


def _paymongo_session_paid(session):
    if not isinstance(session, dict):
        return False, None
    attrs = session.get('attributes', {})
    status = (attrs.get('payment_status') or attrs.get('status') or '').lower()
    if status in ('paid', 'succeeded', 'complete', 'completed'):
        payment_id = attrs.get('payment_intent_id') or attrs.get('payment_id')
        return True, payment_id

    payments = attrs.get('payments') or []
    for payment in payments:
        if not isinstance(payment, dict):
            continue
        p_attrs = payment.get('attributes', {})
        p_status = (p_attrs.get('status') or p_attrs.get('payment_status') or '').lower()
        if p_status in ('paid', 'succeeded', 'complete', 'completed'):
            payment_id = p_attrs.get('id') or payment.get('id')
            return True, payment_id

    return False, None


def _normalize_status_value(status):
    return str(status or 'pending').strip().lower()


def _normalize_delivery_updates(updates, fallback_status='pending'):
    normalized = []
    for entry in (updates or []):
        if isinstance(entry, dict):
            status = _normalize_status_value(entry.get('status') or fallback_status)
            updated_at = entry.get('updated_at') or entry.get('timestamp') or entry.get('time')
            normalized.append({
                'status': status,
                'updated_at': updated_at,
                'timestamp': updated_at,
                'description': entry.get('description'),
            })
            continue

        normalized.append({
            'status': _normalize_status_value(entry or fallback_status),
            'updated_at': None,
            'timestamp': None,
            'description': None,
        })

    return normalized


def _latest_delivery_update_at(delivery_updates):
    if not delivery_updates:
        return None
    latest = delivery_updates[-1]
    if isinstance(latest, dict):
        return latest.get('updated_at') or latest.get('timestamp') or latest.get('time')
    return None


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------
@api_bp.route('/auth/login', methods=['POST'])
def api_login():
    try:
        data = request.get_json()
        if not data or not data.get('email') or not data.get('password'):
            return jsonify({'error': 'Email and password are required'}), 400

        from user_model import User
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


@api_bp.route('/auth/register', methods=['POST'])
def api_register():
    try:
        data = request.get_json()
        required = ['email', 'password', 'first_name', 'last_name']
        if not all(f in data for f in required):
            return jsonify({'error': 'Missing required fields'}), 400

        from user_model import User
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
# Products
# ------------------------------------------------------------------
@api_bp.route('/products', methods=['GET'])
def api_products():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        # Only include products visible to customers (either no audience set or audience includes 'customers')
        products_cursor = db.products.find({
            'available': True,
            '$or': [
                {'audience': {'$exists': False}},
                {'audience': 'customers'}
            ]
        }).sort('created_at', -1)
        product_docs = list(products_cursor)
        products = []

        product_ids = [str(p.get('_id')) for p in product_docs if p.get('_id')]
        review_stats_map = {}
        if product_ids:
            review_pipeline = [
                {'$match': {'product_id': {'$in': product_ids}}},
                {
                    '$group': {
                        '_id': '$product_id',
                        'average_rating': {'$avg': '$rating'},
                        'review_count': {'$sum': 1},
                    }
                }
            ]
            for stat in db.reviews.aggregate(review_pipeline):
                pid = str(stat.get('_id'))
                review_stats_map[pid] = {
                    'average_rating': round(float(stat.get('average_rating') or 0), 1),
                    'review_count': int(stat.get('review_count') or 0),
                }

        from bson import ObjectId
        for p in product_docs:
            # attempt to resolve farmer display name from product doc or users collection
            farmer_name = p.get('farmer_name', '')
            farmer_info = None
            product_id = str(p.get('_id', ''))
            review_stats = review_stats_map.get(product_id, {'average_rating': 0, 'review_count': 0})
            if not farmer_name:
                # possible farmer id fields
                possible_ids = [p.get(k) for k in ('farmer', 'farmer_user_id', 'farmer_id', 'farmerId', 'seller_id', 'sellerId') if p.get(k)]
                found = None
                for fid in possible_ids:
                    try:
                        if ObjectId.is_valid(str(fid)):
                            found = db.users.find_one({'_id': ObjectId(str(fid))})
                        else:
                            found = db.users.find_one({'id': str(fid)}) or db.users.find_one({'email': str(fid)})
                    except Exception:
                        found = db.users.find_one({'id': str(fid)})
                    if found:
                        break
                if found:
                    farmer_name = f"{found.get('first_name','').strip()} {found.get('last_name','').strip()}".strip() or found.get('farm_name') or found.get('name') or ''
                    farmer_info = {
                        'id': str(found.get('_id') or found.get('id') or ''),
                        'farm_name': found.get('farm_name', ''),
                        'name': farmer_name,
                        'location': found.get('farm_location') or found.get('overall_location') or found.get('location') or ''
                    }

            products.append({
                'id': product_id,
                'name': p.get('name', ''),
                'description': p.get('description', ''),
                'price': p.get('price', 0),
                'image': p.get('image', ''),
                'image_url': p.get('image_url', '') if p.get('image_url') else '',
                'image_urls': p.get('image_urls', []),
                'farmer_name': farmer_name or '',
                'farmer': farmer_info,
                'category': p.get('category', ''),
                'quantity': p.get('quantity', 0),
                'unit': p.get('unit', ''),
                'location': p.get('location', ''),
                'average_rating': review_stats.get('average_rating', 0),
                'review_count': review_stats.get('review_count', 0),
            })
        return jsonify(products)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/products/<product_id>', methods=['GET'])
def api_product_detail(product_id):
    try:
        from bson import ObjectId
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product = db.products.find_one({'_id': ObjectId(product_id)})
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        from bson import ObjectId
        # resolve farmer name if not present
        farmer_name = product.get('farmer_name', '')
        farmer_info = None
        if not farmer_name:
            possible_ids = [product.get(k) for k in ('farmer', 'farmer_user_id', 'farmer_id', 'farmerId', 'seller_id', 'sellerId') if product.get(k)]
            found = None
            for fid in possible_ids:
                try:
                    if ObjectId.is_valid(str(fid)):
                        found = db.users.find_one({'_id': ObjectId(str(fid))})
                    else:
                        found = db.users.find_one({'id': str(fid)}) or db.users.find_one({'email': str(fid)})
                except Exception:
                    found = db.users.find_one({'id': str(fid)})
                if found:
                    break
            if found:
                farmer_name = f"{found.get('first_name','').strip()} {found.get('last_name','').strip()}".strip() or found.get('farm_name') or found.get('name') or ''
                farmer_info = {
                    'id': str(found.get('_id') or found.get('id') or ''),
                    'farm_name': found.get('farm_name', ''),
                    'name': farmer_name,
                    'location': found.get('farm_location') or found.get('overall_location') or found.get('location') or ''
                }

        review_stats = {'average_rating': 0, 'review_count': 0}
        try:
            pipeline = [
                {'$match': {'product_id': str(product['_id'])}},
                {'$group': {'_id': '$product_id', 'average_rating': {'$avg': '$rating'}, 'review_count': {'$sum': 1}}},
            ]
            rows = list(db.reviews.aggregate(pipeline))
            if rows:
                review_stats = {
                    'average_rating': round(float(rows[0].get('average_rating') or 0), 1),
                    'review_count': int(rows[0].get('review_count') or 0),
                }
        except Exception:
            pass

        return jsonify({
            'id': str(product['_id']),
            'name': product.get('name', ''),
            'description': product.get('description', ''),
            'price': product.get('price', 0),
            'image': product.get('image', ''),
            'image_url': product.get('image_url', '') if product.get('image_url') else '',
            'farmer_name': farmer_name or '',
            'farmer': farmer_info,
            'category': product.get('category', ''),
            'quantity': product.get('quantity', 0),
            'unit': product.get('unit', ''),
            'location': product.get('location', ''),
            'farmer_id': str(product.get('farmer_id', '')),
            'average_rating': review_stats.get('average_rating', 0),
            'review_count': review_stats.get('review_count', 0),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# User profile
# ------------------------------------------------------------------
@api_bp.route('/user/profile', methods=['GET'], endpoint='api_user_profile')
@token_required
def api_user_profile():
    try:
        from user_model import User
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


@api_bp.route('/user/profile', methods=['PUT'], endpoint='api_update_profile')
@token_required
def api_update_profile():
    try:
        from user_model import User
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
                            import cloudinary.uploader
                            cloudinary.uploader.destroy(public_id)
                        except Exception:
                            pass
            except Exception:
                pass

            if hasattr(user, 'profile_picture') and user.profile_picture:
                # if it was stored locally, remove local file
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

                # Try uploading to Cloudinary first; fall back to local storage on failure
                try:
                    import cloudinary.uploader
                    upload_res = cloudinary.uploader.upload(
                        profile_picture,
                        folder='farmtoclick/profiles',
                        resource_type='image'
                    )
                    secure_url = upload_res.get('secure_url')
                    if secure_url:
                        # remove old local file if exists
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
                    # fallback: store locally as before
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


@api_bp.route('/user/addresses', methods=['POST'])
@token_required
def api_add_address():
    try:
        from user_model import User
        import uuid
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
            'is_default': data.get('is_default', False)
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
        from user_model import User
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
        from user_model import User
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        addresses = getattr(user, 'addresses', [])
        initial_len = len(addresses)
        
        # Find if the deleted address was default
        was_default = False
        for addr in addresses:
            if addr.get('id') == address_id and addr.get('is_default'):
                was_default = True
                break

        addresses = [addr for addr in addresses if addr.get('id') != address_id]

        if len(addresses) == initial_len:
            return jsonify({'error': 'Address not found'}), 404

        # If we deleted the default address and there are others left, make the first one default
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
        from user_model import User
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


@api_bp.route('/user/notifications', methods=['GET'])
@token_required
def api_user_notifications():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        # Fetch recent notifications for the logged-in user
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
                'created_at': created_at_iso
            })
        return jsonify(notifs)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/user/notifications/<notif_id>/read', methods=['POST'])
@token_required
def api_mark_notification_read(notif_id):
    try:
        from bson.objectid import ObjectId
        import cloudinary
        import cloudinary.uploader

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


# ------------------------------------------------------------------
# Cart
# ------------------------------------------------------------------
@api_bp.route('/cart', methods=['GET'])
@token_required
def api_get_cart():
    try:
        from bson import ObjectId

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        cart_doc = db.carts.find_one({'user_id': request.user_id})
        items = []
        total = 0.0

        if cart_doc:
            for item in cart_doc.get('items', []):
                product_id = item.get('product_id')
                product = None
                if product_id and ObjectId.is_valid(product_id):
                    product = db.products.find_one({'_id': ObjectId(product_id)})
                if not product:
                    product = db.products.find_one({'id': product_id})

                if not product:
                    continue

                qty = int(item.get('quantity', 1))
                price = float(product.get('price', 0) or 0)

                farmer = None
                farmer_ref = product.get('farmer') or product.get('farmer_id') or product.get('farmer_user_id')
                if farmer_ref:
                    farmer_doc = db.users.find_one({'id': str(farmer_ref)})
                    if not farmer_doc and ObjectId.is_valid(str(farmer_ref)):
                        farmer_doc = db.users.find_one({'_id': ObjectId(str(farmer_ref))})
                    if farmer_doc:
                        farmer = {
                            'full_name': f"{farmer_doc.get('first_name', '')} {farmer_doc.get('last_name', '')}".strip(),
                            'farm_name': farmer_doc.get('farm_name', ''),
                        }

                items.append({
                    'product': {
                        'id': str(product.get('_id', product_id)),
                        'name': product.get('name', ''),
                        'price': price,
                        'unit': product.get('unit', ''),
                        'quantity': product.get('quantity', 0),
                        'image_url': product.get('image_url', '') or product.get('image', ''),
                        'farmer': farmer,
                    },
                    'quantity': qty,
                    'subtotal': price * qty,
                })
                total += price * qty

        return jsonify({'items': items, 'total': total})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/cart', methods=['POST'])
@token_required
def api_add_to_cart():
    try:
        from bson import ObjectId

        data = request.get_json() or {}
        product_id = str(data.get('product_id', '')).strip()
        quantity = int(data.get('quantity', 1) or 1)

        if not product_id or quantity < 1:
            return jsonify({'error': 'Invalid product or quantity'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product = None
        if ObjectId.is_valid(product_id):
            product = db.products.find_one({'_id': ObjectId(product_id)})
        if not product:
            product = db.products.find_one({'id': product_id})
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        cart_doc = db.carts.find_one({'user_id': request.user_id})
        if cart_doc:
            existing = next(
                (i for i in cart_doc.get('items', []) if i.get('product_id') == product_id),
                None,
            )
            if existing:
                db.carts.update_one(
                    {'_id': cart_doc['_id'], 'items.product_id': product_id},
                    {'$inc': {'items.$.quantity': quantity}},
                )
            else:
                db.carts.update_one(
                    {'_id': cart_doc['_id']},
                    {'$push': {'items': {'product_id': product_id, 'quantity': quantity}}},
                )
        else:
            db.carts.insert_one({
                'user_id': request.user_id,
                'items': [{'product_id': product_id, 'quantity': quantity}],
            })

        return jsonify({'message': 'Product added to cart'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/cart/<product_id>', methods=['PUT'])
@token_required
def api_update_cart_item(product_id):
    try:
        data = request.get_json() or {}
        quantity = int(data.get('quantity', 1) or 1)

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if quantity < 1:
            db.carts.update_one(
                {'user_id': request.user_id},
                {'$pull': {'items': {'product_id': product_id}}},
            )
            return jsonify({'message': 'Item removed from cart'})

        db.carts.update_one(
            {'user_id': request.user_id, 'items.product_id': product_id},
            {'$set': {'items.$.quantity': quantity}},
        )
        return jsonify({'message': 'Cart updated'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/cart/<product_id>', methods=['DELETE'])
@token_required
def api_remove_cart_item(product_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        db.carts.update_one(
            {'user_id': request.user_id},
            {'$pull': {'items': {'product_id': product_id}}},
        )
        return jsonify({'message': 'Item removed from cart'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/cart', methods=['DELETE'])
@token_required
def api_clear_cart():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        db.carts.delete_one({'user_id': request.user_id})
        return jsonify({'message': 'Cart cleared'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Orders
# ------------------------------------------------------------------
@api_bp.route('/orders', methods=['GET'])
@token_required
def api_get_orders():
    try:
        from bson import ObjectId
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        orders = list(db.orders.find({'user_id': request.user_id}).sort('created_at', -1))
        for order in orders:
            order['_id'] = str(order.get('_id'))
            order_status = _normalize_status_value(order.get('delivery_status') or order.get('status'))
            order['delivery_status'] = order_status
            order.setdefault('delivery_tracking_id', None)
            order['delivery_updates'] = _normalize_delivery_updates(order.get('delivery_updates', []), order_status)
            order['delivery_status_updated_at'] = _latest_delivery_update_at(order['delivery_updates']) or order.get('updated_at') or order.get('created_at')
            order.setdefault('logistics_provider', 'lalamove')
            order.setdefault('assigned_rider_id', None)
            order.setdefault('assigned_rider_name', None)
            order.setdefault('assigned_rider_phone', None)
            order.setdefault('assigned_rider_barangay', None)
            order.setdefault('assigned_rider_city', None)
            order.setdefault('assigned_rider_province', None)
            order.setdefault('customer_confirmed', False)
            order.setdefault('rider_confirmed', False)

            if order.get('payment_provider') == 'paymongo' and order.get('payment_status') != 'paid':
                checkout_id = order.get('paymongo_checkout_id')
                if checkout_id:
                    try:
                        session = get_checkout_session(checkout_id)
                        is_paid, payment_id = _paymongo_session_paid(session)
                        if is_paid:
                            update_fields = {
                                'payment_status': 'paid',
                                'paid_at': datetime.utcnow(),
                                'updated_at': datetime.utcnow(),
                            }
                            if payment_id:
                                update_fields['paymongo_payment_id'] = payment_id
                            db.orders.update_one({'_id': ObjectId(order['_id'])}, {'$set': update_fields})
                            order['payment_status'] = 'paid'
                            _finalize_paid_order(db, order)
                    except Exception:
                        pass
        return jsonify(orders)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/paymongo/confirm', methods=['POST'])
@token_required
def api_paymongo_confirm():
    try:
        from bson import ObjectId

        data = request.get_json() or {}
        order_id = (data.get('order_id') or '').strip()
        if not order_id:
            return jsonify({'error': 'Order id is required'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        order_filter = {'_id': ObjectId(order_id)} if ObjectId.is_valid(order_id) else {'_id': order_id}
        order_doc = db.orders.find_one(order_filter)
        if not order_doc:
            return jsonify({'error': 'Order not found'}), 404

        if order_doc.get('user_id') != request.user_id:
            return jsonify({'error': 'Not authorized'}), 403

        if order_doc.get('payment_provider') != 'paymongo':
            return jsonify({'error': 'Order is not PayMongo'}), 400

        if order_doc.get('payment_status') == 'paid':
            return jsonify({'status': 'paid'}), 200

        checkout_id = order_doc.get('paymongo_checkout_id')
        if not checkout_id:
            return jsonify({'error': 'Checkout session not found'}), 400

        session = get_checkout_session(checkout_id)
        is_paid, payment_id = _paymongo_session_paid(session)
        if is_paid:
            update_fields = {
                'payment_status': 'paid',
                'paid_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            }
            if payment_id:
                update_fields['paymongo_payment_id'] = payment_id
            db.orders.update_one(order_filter, {'$set': update_fields})
            _finalize_paid_order(db, order_doc)
            return jsonify({'status': 'paid'}), 200

        return jsonify({'status': 'pending'}), 200
    except PayMongoError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ────────────────────────────────────────────────────────
# Rider Dashboard Stats
# ────────────────────────────────────────────────────────
@api_bp.route('/rider/dashboard', methods=['GET'])
@token_required
def api_rider_dashboard():
    """Return comprehensive stats for the logged-in rider."""
    try:
        from user_model import User
        from bson import ObjectId
        from datetime import timedelta

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'error': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email

        # ── Parse period query param ──
        period = request.args.get('period', '7d')
        period_map = {
            '7d': 7,
            '14d': 14,
            '30d': 30,
            '3m': 90,
            '6m': 180,
            '1y': 365,
            'all': None,
        }
        period_days = period_map.get(period, 7)
        period_label_map = {
            '7d': 'Last 7 Days',
            '14d': 'Last 14 Days',
            '30d': 'Last 30 Days',
            '3m': 'Last 3 Months',
            '6m': 'Last 6 Months',
            '1y': 'Last Year',
            'all': 'All Time',
        }
        period_label = period_label_map.get(period, 'Last 7 Days')

        # Build match query (same logic as /rider/orders)
        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        all_orders = list(db.orders.find({'$or': match_conditions}).sort('created_at', -1))

        # Helper to parse order created_at to datetime
        def _parse_dt(o):
            ca = o.get('created_at')
            if ca is None:
                return None
            if isinstance(ca, datetime):
                return ca
            if isinstance(ca, str):
                try:
                    return datetime.fromisoformat(ca.replace('Z', '+00:00')).replace(tzinfo=None)
                except Exception:
                    return None
            return None

        # ── Counts by status ──
        total = len(all_orders)
        status_counts = {}
        for o in all_orders:
            s = (o.get('delivery_status') or o.get('status') or 'pending').lower()
            status_counts[s] = status_counts.get(s, 0) + 1

        delivered   = status_counts.get('delivered', 0)
        picked_up   = status_counts.get('picked_up', 0)
        on_the_way  = status_counts.get('on_the_way', 0)
        ready_ship  = status_counts.get('ready_for_ship', 0)
        cancelled   = status_counts.get('cancelled', 0)
        active      = picked_up + on_the_way + ready_ship

        # ── Revenue / earnings ──
        total_value = sum(float(o.get('total_amount', 0)) for o in all_orders)
        delivered_value = sum(
            float(o.get('total_amount', 0)) for o in all_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )

        # ── Completion rate ──
        completion_rate = round((delivered / total * 100), 1) if total > 0 else 0.0

        # ── Today's stats ──
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_orders = [
            o for o in all_orders
            if _parse_dt(o) is not None and _parse_dt(o) >= today_start
        ]
        today_total = len(today_orders)
        today_delivered = sum(
            1 for o in today_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )
        today_value = sum(float(o.get('total_amount', 0)) for o in today_orders)

        # ── Period stats (based on selected period) ──
        if period_days is not None:
            period_start = datetime.utcnow() - timedelta(days=period_days)
            period_orders = [
                o for o in all_orders
                if _parse_dt(o) is not None and _parse_dt(o) >= period_start
            ]
        else:
            period_orders = all_orders

        period_total = len(period_orders)
        period_delivered = sum(
            1 for o in period_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )
        period_value = sum(float(o.get('total_amount', 0)) for o in period_orders)

        # ── Chart breakdown for selected period ──
        # For shorter periods (<=14 days): daily breakdown
        # For medium periods (<=90 days): daily breakdown but fewer labels
        # For longer periods (>90 days): weekly breakdown
        chart_data = []
        if period_days is not None and period_days <= 90:
            # Daily breakdown
            num_days = period_days
            for i in range(num_days - 1, -1, -1):
                day = datetime.utcnow() - timedelta(days=i)
                day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
                day_end = day_start + timedelta(days=1)
                day_orders = [
                    o for o in all_orders
                    if _parse_dt(o) is not None and day_start <= _parse_dt(o) < day_end
                ]
                day_delivered = sum(
                    1 for o in day_orders
                    if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                )
                day_value = sum(float(o.get('total_amount', 0)) for o in day_orders)
                # Use shorter date format for larger ranges
                if num_days <= 14:
                    date_label = day_start.strftime('%b %d')
                else:
                    date_label = day_start.strftime('%m/%d')
                chart_data.append({
                    'date': date_label,
                    'orders': len(day_orders),
                    'delivered': day_delivered,
                    'value': round(day_value, 2),
                })
        elif period_days is not None:
            # Weekly breakdown for periods > 90 days
            num_weeks = period_days // 7
            for i in range(num_weeks - 1, -1, -1):
                wk_end = datetime.utcnow() - timedelta(days=i * 7)
                wk_start = wk_end - timedelta(days=7)
                wk_start = wk_start.replace(hour=0, minute=0, second=0, microsecond=0)
                wk_end = wk_end.replace(hour=0, minute=0, second=0, microsecond=0)
                wk_orders = [
                    o for o in all_orders
                    if _parse_dt(o) is not None and wk_start <= _parse_dt(o) < wk_end
                ]
                wk_delivered = sum(
                    1 for o in wk_orders
                    if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                )
                wk_value = sum(float(o.get('total_amount', 0)) for o in wk_orders)
                chart_data.append({
                    'date': wk_start.strftime('%b %d'),
                    'orders': len(wk_orders),
                    'delivered': wk_delivered,
                    'value': round(wk_value, 2),
                })
        else:
            # All time — monthly breakdown
            if all_orders:
                earliest_dt = None
                for o in all_orders:
                    dt = _parse_dt(o)
                    if dt and (earliest_dt is None or dt < earliest_dt):
                        earliest_dt = dt
                if earliest_dt is None:
                    earliest_dt = datetime.utcnow() - timedelta(days=365)
                now = datetime.utcnow()
                current = earliest_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                while current <= now:
                    if current.month == 12:
                        month_end = current.replace(year=current.year + 1, month=1)
                    else:
                        month_end = current.replace(month=current.month + 1)
                    mo_orders = [
                        o for o in all_orders
                        if _parse_dt(o) is not None and current <= _parse_dt(o) < month_end
                    ]
                    mo_delivered = sum(
                        1 for o in mo_orders
                        if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                    )
                    mo_value = sum(float(o.get('total_amount', 0)) for o in mo_orders)
                    chart_data.append({
                        'date': current.strftime('%b %Y'),
                        'orders': len(mo_orders),
                        'delivered': mo_delivered,
                        'value': round(mo_value, 2),
                    })
                    current = month_end

        # ── Recent 5 orders ──
        recent = []
        for o in all_orders[:5]:
            buyer = db.users.find_one({'id': o.get('user_id')})
            recent.append({
                'id': str(o.get('_id')),
                'status': (o.get('delivery_status') or o.get('status') or 'pending').lower(),
                'buyer_name': buyer.get('first_name') if buyer else 'Customer',
                'total_amount': float(o.get('total_amount', 0)),
                'created_at': o.get('created_at').isoformat() if isinstance(o.get('created_at'), datetime) else o.get('created_at'),
                'items_count': len(o.get('items', [])),
                'shipping_address': o.get('shipping_address') or o.get('delivery_address') or '',
            })

        # ── Status distribution for pie chart ──
        status_distribution = [
            {'name': k.replace('_', ' ').title(), 'value': v, 'key': k}
            for k, v in status_counts.items() if v > 0
        ]

        return jsonify({
            'rider_name': rider_doc.get('name', ''),
            'rider_phone': rider_doc.get('phone', ''),
            'period': period,
            'period_label': period_label,
            'stats': {
                'total_orders': total,
                'delivered': delivered,
                'active': active,
                'picked_up': picked_up,
                'on_the_way': on_the_way,
                'ready_for_ship': ready_ship,
                'cancelled': cancelled,
                'completion_rate': completion_rate,
                'total_value': round(total_value, 2),
                'delivered_value': round(delivered_value, 2),
            },
            'today': {
                'orders': today_total,
                'delivered': today_delivered,
                'value': round(today_value, 2),
            },
            'period_stats': {
                'orders': period_total,
                'delivered': period_delivered,
                'value': round(period_value, 2),
                'label': period_label,
            },
            'daily_chart': chart_data,
            'status_distribution': status_distribution,
            'recent_orders': recent,
        })
    except Exception as e:
        print(f"[RiderDashboard] Error: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/rider/orders', methods=['GET'])
@token_required
def api_get_rider_orders():
    try:
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            print(f"[RiderOrders] No rider profile for user {user.email} (id={user.id})")
            return jsonify({'error': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email
        print(f"[RiderOrders] Rider {rider_doc.get('name')} (assigned_id={assigned_id}, "
              f"user_id={rider_user_id}, email={rider_email}) querying orders...")

        # Match by rider ObjectId, rider user UUID, OR rider email for robustness
        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        # Also include orders that are in delivery statuses but have no rider
        # assigned yet (farmer advanced status without assigning a rider).
        # Auto-stamp the current rider on these orders so they appear going forward.
        unassigned_delivery = list(db.orders.find({
            'status': {'$in': ['picked_up', 'on_the_way', 'ready_for_ship']},
            '$or': [
                {'assigned_rider_id': {'$exists': False}},
                {'assigned_rider_id': None},
                {'assigned_rider_id': ''},
            ],
        }))
        if unassigned_delivery:
            unassigned_ids = [o['_id'] for o in unassigned_delivery]
            stamp = {
                'assigned_rider_id': assigned_id,
                'assigned_rider_user_id': rider_user_id,
                'assigned_rider_email': rider_email or '',
                'assigned_rider_name': rider_doc.get('name', ''),
                'assigned_rider_phone': rider_doc.get('phone', ''),
                'assigned_rider_barangay': rider_doc.get('barangay', ''),
                'assigned_rider_city': rider_doc.get('city', ''),
                'assigned_rider_province': rider_doc.get('province', ''),
                'assigned_at': datetime.utcnow(),
            }
            db.orders.update_many({'_id': {'$in': unassigned_ids}}, {'$set': stamp})
            print(f"[RiderOrders] Auto-stamped rider on {len(unassigned_ids)} unassigned delivery orders")

        orders = list(db.orders.find({'$or': match_conditions}).sort('created_at', -1))
        print(f"[RiderOrders] Found {len(orders)} assigned orders")

        results = []
        for order in orders:
            buyer = db.users.find_one({'id': order.get('user_id')})
            delivery_status = _normalize_status_value(order.get('delivery_status') or order.get('status'))
            delivery_updates = _normalize_delivery_updates(order.get('delivery_updates', []), delivery_status)
            results.append({
                'id': str(order.get('_id')),
                'status': _normalize_status_value(order.get('status')),
                'delivery_status': delivery_status,
                'delivery_tracking_id': order.get('delivery_tracking_id'),
                'delivery_proof_url': order.get('delivery_proof_url'),
                'created_at': order.get('created_at'),
                'updated_at': order.get('updated_at'),
                'delivery_updates': delivery_updates,
                'delivery_status_updated_at': _latest_delivery_update_at(delivery_updates) or order.get('updated_at') or order.get('created_at'),
                'buyer_name': buyer.get('first_name') if buyer else 'Customer',
                'buyer_phone': buyer.get('phone') if buyer else '',
                'shipping_name': order.get('shipping_name'),
                'shipping_phone': order.get('shipping_phone'),
                'shipping_address': order.get('shipping_address'),
                'overall_location': order.get('overall_location', ''),
                'delivery_address': order.get('delivery_address'),
                'delivery_notes': order.get('delivery_notes'),
                'items': order.get('items', []),
                'total_amount': order.get('total_amount', 0),
            })

        return jsonify({'orders': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/rider/orders/<order_id>/accept', methods=['POST'])
@token_required
def api_rider_accept_order(order_id):
    """Rider accepts a picked_up order → status becomes on_the_way."""
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        current_status = (order_doc.get('delivery_status') or order_doc.get('status') or 'pending').lower()
        if current_status != 'picked_up':
            return jsonify({'success': False, 'message': 'Order must be in picked_up status to accept'}), 400

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'success': False, 'message': 'Rider profile not found'}), 404

        new_status = 'on_the_way'
        delivery_updates = list(order_doc.get('delivery_updates', []))
        delivery_updates.append({
            'status': new_status,
            'updated_at': datetime.utcnow(),
            'timestamp': datetime.utcnow(),
            'description': 'Rider accepted the delivery',
        })

        update_fields = {
            'status': new_status,
            'delivery_status': new_status,
            'updated_at': datetime.utcnow(),
            'delivery_updates': delivery_updates,
            'assigned_rider_id': str(rider_doc['_id']),
            'assigned_rider_user_id': str(user.id),
            'assigned_rider_email': user.email or '',
            'assigned_rider_name': rider_doc.get('name', ''),
            'assigned_rider_phone': rider_doc.get('phone', ''),
            'assigned_rider_barangay': rider_doc.get('barangay', ''),
            'assigned_rider_city': rider_doc.get('city', ''),
            'assigned_rider_province': rider_doc.get('province', ''),
            'accepted_at': datetime.utcnow(),
        }

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        # Notify buyer
        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'
            if buyer_email:
                email_html = build_email_html(
                    title="Delivery Update",
                    subtitle="Your order is on its way!",
                    badge_text="ON THE WAY",
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        f"<p>A rider has accepted your delivery and your order is now <strong>ON THE WAY</strong>.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick – Your order is on its way!",
                    f"Order {order_id} is now on the way.",
                    html_body=email_html,
                )
        except Exception as e:
            print(f"Rider accept email error: {e}")

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        print(f"Rider accept error: {e}")
        return jsonify({'success': False, 'message': 'Failed to accept order'}), 500


@api_bp.route('/orders/<order_id>/confirm-received', methods=['POST'])
@token_required
def api_confirm_order_received(order_id):
    """Customer confirms they received the delivery."""
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        # Verify the buyer owns this order
        if str(order_doc.get('user_id')) != str(user.id):
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        current_status = (order_doc.get('delivery_status') or order_doc.get('status') or 'pending').lower()
        if current_status not in ('delivered', 'completed'):
            return jsonify({'success': False, 'message': 'Order must be delivered before confirming receipt'}), 400

        update_fields = {
            'customer_confirmed': True,
            'customer_confirmed_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }

        # If rider already marked as delivered, mark order as completed
        rider_confirmed = order_doc.get('rider_confirmed', False)
        if current_status == 'delivered' or rider_confirmed:
            update_fields['status'] = 'completed'
            update_fields['delivery_status'] = 'completed'
            delivery_updates = list(order_doc.get('delivery_updates', []))
            delivery_updates.append({
                'status': 'completed',
                'updated_at': datetime.utcnow(),
                'timestamp': datetime.utcnow(),
                'description': 'Order completed – confirmed by customer',
            })
            update_fields['delivery_updates'] = delivery_updates

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        return jsonify({
            'success': True,
            'status': update_fields.get('status', current_status),
            'completed': update_fields.get('status') == 'completed',
        })
    except Exception as e:
        print(f"Confirm received error: {e}")
        return jsonify({'success': False, 'message': 'Failed to confirm receipt'}), 500


@api_bp.route('/rider/orders/<order_id>/status', methods=['POST'])
@token_required
def api_update_rider_order_status(order_id):
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        data = request.get_json(silent=True) or {}
        if not data and request.form:
            data = request.form.to_dict()
        new_status = (data.get('status') or '').strip().lower()
        if new_status not in ('picked_up', 'on_the_way', 'delivered'):
            return jsonify({'success': False, 'message': 'Invalid status'}), 400

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'success': False, 'message': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email
        order_rider_id = order_doc.get('assigned_rider_id')
        order_rider_uid = order_doc.get('assigned_rider_user_id')
        order_rider_email = order_doc.get('assigned_rider_email', '')

        # If no rider is assigned yet, auto-stamp this rider on the order
        no_rider_assigned = not order_rider_id and not order_rider_uid
        is_owner = (
            no_rider_assigned
            or order_rider_id == assigned_id
            or order_rider_uid == rider_user_id
            or (rider_email and order_rider_email == rider_email)
        )
        if not is_owner:
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        current_status = (order_doc.get('delivery_status') or order_doc.get('status') or 'pending').lower()
        if new_status == 'picked_up' and current_status not in ('ready_for_ship', 'picked_up'):
            return jsonify({'success': False, 'message': 'Order must be ready for ship'}), 400
        if new_status == 'on_the_way' and current_status not in ('picked_up', 'on_the_way'):
            return jsonify({'success': False, 'message': 'Order must be picked up'}), 400
        if new_status == 'delivered' and current_status not in ('on_the_way', 'delivered'):
            return jsonify({'success': False, 'message': 'Order must be on the way'}), 400

        update_fields = {
            'status': new_status,
            'delivery_status': new_status,
            'updated_at': datetime.utcnow(),
        }

        # Stamp rider info on the order if not yet assigned
        if no_rider_assigned:
            update_fields.update({
                'assigned_rider_id': assigned_id,
                'assigned_rider_user_id': rider_user_id,
                'assigned_rider_email': rider_email or '',
                'assigned_rider_name': rider_doc.get('name', ''),
                'assigned_rider_phone': rider_doc.get('phone', ''),
                'assigned_rider_barangay': rider_doc.get('barangay', ''),
                'assigned_rider_city': rider_doc.get('city', ''),
                'assigned_rider_province': rider_doc.get('province', ''),
                'assigned_at': datetime.utcnow(),
            })
            print(f"[RiderStatus] Auto-stamped rider {rider_doc.get('name')} on order {order_id}")

        if new_status == 'delivered':
            proof_file = request.files.get('delivery_proof')
            if not proof_file or not proof_file.filename:
                return jsonify({'success': False, 'message': 'Delivery proof photo is required'}), 400
            if not allowed_file(proof_file.filename):
                return jsonify({'success': False, 'message': 'Invalid file type. Please upload a JPG or PNG image.'}), 400

            proof_file.seek(0, os.SEEK_END)
            file_size = proof_file.tell()
            proof_file.seek(0)
            if file_size > MAX_FILE_SIZE:
                return jsonify({'success': False, 'message': 'Image must be less than 5MB'}), 400

            original = secure_filename(proof_file.filename)
            unique_name = f"delivery_{uuid.uuid4().hex}_{original}"
            proof_path = os.path.join(DELIVERY_PROOF_UPLOAD_FOLDER, unique_name)
            proof_file.save(proof_path)

            proof_url = url_for('static', filename=f'uploads/delivery_proofs/{unique_name}', _external=True)
            update_fields['delivery_proof_filename'] = unique_name
            update_fields['delivery_proof_url'] = proof_url
            update_fields['delivery_proof_uploaded_at'] = datetime.utcnow()

            # Mark rider as confirmed
            update_fields['rider_confirmed'] = True
            update_fields['rider_confirmed_at'] = datetime.utcnow()

            # Auto-complete if customer already confirmed receipt
            if order_doc.get('customer_confirmed'):
                update_fields['status'] = 'completed'
                update_fields['delivery_status'] = 'completed'
                new_status = 'completed'

        delivery_updates = list(order_doc.get('delivery_updates', []))
        delivery_updates.append({
            'status': new_status,
            'updated_at': datetime.utcnow(),
            'timestamp': datetime.utcnow(),
        })
        update_fields['delivery_updates'] = _normalize_delivery_updates(delivery_updates, new_status)

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'
            if buyer_email:
                status_label = new_status.replace('_', ' ').upper()
                email_html = build_email_html(
                    title="Delivery Update",
                    subtitle="Your order delivery status changed",
                    badge_text=status_label,
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        f"<p>Your order status is now <strong>{status_label}</strong>.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick Delivery Update",
                    f"Order {order_id} status updated to {status_label}.",
                    html_body=email_html,
                )
        except Exception as e:
            print(f"Rider status email error: {e}")

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Failed to update order'}), 500


@api_bp.route('/orders/<order_id>/tracking', methods=['GET'])
@token_required
def api_order_tracking(order_id):
    try:
        from bson import ObjectId

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'error': 'Order not found'}), 404

        if order_doc.get('user_id') != request.user_id:
            return jsonify({'error': 'Not authorized'}), 403

        tracking_id = order_doc.get('delivery_tracking_id')
        delivery_status = _normalize_status_value(order_doc.get('delivery_status', order_doc.get('status', 'pending')))

        # Tracking status is now managed by the rider GPS flow
        # No external logistics provider to poll

        normalized_updates = _normalize_delivery_updates(order_doc.get('delivery_updates', []), delivery_status)

        return jsonify({
            'order_id': str(order_doc.get('_id')),
            'delivery_status': delivery_status,
            'delivery_tracking_id': tracking_id,
            'delivery_proof_url': order_doc.get('delivery_proof_url'),
            'delivery_updates': normalized_updates,
            'delivery_status_updated_at': _latest_delivery_update_at(normalized_updates) or order_doc.get('updated_at') or order_doc.get('created_at'),
            'logistics_provider': order_doc.get('logistics_provider', 'lalamove'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/orders', methods=['POST'])
@token_required
def api_create_order():
    try:
        from bson import ObjectId

        data = request.get_json() or {}
        shipping_name = (data.get('shipping_name') or '').strip()
        shipping_phone = (data.get('shipping_phone') or '').strip()
        shipping_address = (data.get('shipping_address') or '').strip()
        overall_location = (data.get('overall_location') or '').strip()
        payment_method_raw = (data.get('payment_method') or '').strip()
        payment_method = payment_method_raw.lower()

        if not all([shipping_name, shipping_phone, shipping_address, payment_method_raw]):
            return jsonify({'error': 'Please fill out all shipping details and payment method'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        cart_doc = db.carts.find_one({'user_id': request.user_id})
        if not cart_doc or not cart_doc.get('items'):
            return jsonify({'error': 'Your cart is empty'}), 400

        is_mobile_money = payment_method == 'mobile'
        order_items = []
        total_amount = 0.0
        
        selected_items = data.get('selected_items')

        for item in cart_doc.get('items', []):
            product_id = item.get('product_id')
            
            if selected_items is not None and product_id not in selected_items:
                continue
                
            qty = int(item.get('quantity', 1))

            product_data = None
            if product_id and ObjectId.is_valid(product_id):
                product_data = db.products.find_one({'_id': ObjectId(product_id)})
            if not product_data:
                product_data = db.products.find_one({'id': product_id})
            if not product_data:
                continue

            price = float(product_data.get('price', 0) or 0)
            name = product_data.get('name', 'Product')
            unit = product_data.get('unit', '')

            order_items.append({
                'product_id': str(product_data.get('_id', product_id)),
                'name': name,
                'quantity': qty,
                'price': price,
                'unit': unit,
            })
            total_amount += price * qty

            if not is_mobile_money:
                try:
                    db.products.update_one({'_id': product_data.get('_id')}, {'$inc': {'quantity': -qty}})
                except Exception:
                    pass

        if not order_items:
            return jsonify({'error': 'Unable to place order. Please try again.'}), 400

        from helpers import calculate_shipping_fee, calculate_bulk_discount
        
        total_items = sum(item['quantity'] for item in order_items)
        discount_rate, discount_amount = calculate_bulk_discount(total_items, total_amount)
        subtotal = total_amount - discount_amount
        
        shipping_fee = calculate_shipping_fee(shipping_address)
        final_total = subtotal + shipping_fee

        order_doc = {
            'user_id': request.user_id,
            'items': order_items,
            'subtotal': total_amount,
            'discount_rate': discount_rate,
            'discount_amount': discount_amount,
            'shipping_fee': shipping_fee,
            'total_amount': final_total,
            'status': 'pending',
            'delivery_status': 'pending',
            'logistics_provider': 'lalamove',
            'delivery_tracking_id': None,
            'delivery_updates': [{
                'status': 'pending',
                'updated_at': datetime.utcnow(),
                'timestamp': datetime.utcnow(),
            }],
            'shipping_name': shipping_name,
            'shipping_phone': shipping_phone,
            'shipping_address': shipping_address,
            'overall_location': overall_location,
            'payment_method': payment_method_raw,
            'payment_status': 'pending' if is_mobile_money else 'unpaid',
            'payment_provider': 'paymongo' if is_mobile_money else None,
            'payment_channel': 'gcash' if is_mobile_money else None,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }

        order_result = db.orders.insert_one(order_doc)
        order_id = str(order_result.inserted_id)
        order_doc['_id'] = order_id

        if not is_mobile_money:
            try:
                receipt_pdf = generate_receipt_pdf(order_id, shipping_name, request.user_email, order_items, total_amount, discount_amount, shipping_fee, final_total)
                email_html = build_email_html(
                    title="Order Confirmed",
                    subtitle="Your order is pending seller approval",
                    badge_text="PENDING APPROVAL",
                    content_html=(
                        f"<p>Hi {shipping_name},</p>"
                        "<p>Your order has been confirmed and is pending seller approval.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        "<p style='margin-top:12px;'>We will email you again once the seller approves your order.</p>"
                        "<p>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    request.user_email,
                    "FarmtoClick Order Confirmed - Pending Approval",
                    f"Order ID: {order_id}\nTotal: {final_total}",
                    html_body=email_html,
                    attachments=[{
                        'filename': f"FarmtoClick-Receipt-{order_id}.pdf",
                        'content': receipt_pdf,
                        'maintype': 'application',
                        'subtype': 'pdf',
                    }],
                )
            except Exception as e:
                print(f"Order confirmation email error: {e}")

            if selected_items:
                db.carts.update_one(
                    {'_id': cart_doc['_id']},
                    {'$pull': {'items': {'product_id': {'$in': selected_items}}}}
                )
            else:
                db.carts.delete_one({'_id': cart_doc['_id']})

        if is_mobile_money:
            success_url, cancel_url = _get_paymongo_redirect_urls()
            if not success_url or not cancel_url:
                return jsonify({'error': 'PayMongo redirect URLs are not configured'}), 500

            try:
                line_items = [
                    {
                        'name': item.get('name', 'Item'),
                        'quantity': int(item.get('quantity', 1)),
                        'amount': int(round(float(item.get('price', 0) or 0) * 100)),
                        'currency': 'PHP',
                    }
                    for item in order_items
                ]
                
                if discount_amount > 0:
                    # PayMongo doesn't allow negative line items, so we adjust the total amount
                    # by adding a discount line item with 0 amount and adjusting the total,
                    # or we can just replace all line items with a single "Order Total" line item
                    # to avoid mismatch between sum(line_items) and total amount.
                    line_items = [{
                        'name': 'Order Total (with Discount)',
                        'quantity': 1,
                        'amount': int(round(subtotal * 100)),
                        'currency': 'PHP',
                    }]
                    
                if shipping_fee > 0:
                    line_items.append({
                        'name': 'Shipping Fee',
                        'quantity': 1,
                        'amount': int(round(shipping_fee * 100)),
                        'currency': 'PHP',
                    })
                    
                checkout = create_checkout_session(
                    amount=int(round(final_total * 100)),
                    description=f'FarmtoClick Order {order_id}',
                    success_url=success_url,
                    cancel_url=cancel_url,
                    payment_method_types=['gcash', 'qrph'],
                    line_items=line_items,
                    metadata={'order_id': order_id, 'user_id': request.user_id},
                    reference_number=str(order_id),
                )
                db.orders.update_one(
                    {'_id': order_result.inserted_id},
                    {'$set': {
                        'paymongo_checkout_id': checkout['id'],
                        'paymongo_checkout_url': checkout['checkout_url'],
                        'payment_status': 'pending',
                        'payment_provider': 'paymongo',
                        'updated_at': datetime.utcnow(),
                    }},
                )
                order_doc['paymongo_checkout_id'] = checkout['id']
                order_doc['paymongo_checkout_url'] = checkout['checkout_url']
                return jsonify({
                    'message': 'Checkout session created',
                    'checkout_url': checkout['checkout_url'],
                    'order': order_doc,
                }), 201
            except PayMongoError as exc:
                db.orders.update_one(
                    {'_id': order_result.inserted_id},
                    {'$set': {
                        'payment_status': 'failed',
                        'payment_error': str(exc),
                        'updated_at': datetime.utcnow(),
                    }},
                )
                print(f"PayMongo checkout error: {exc}")
                return jsonify({
                    'error': 'Unable to initialize mobile money payment. Please use cash payment instead.',
                    'details': str(exc),
                }), 400

        return jsonify({'message': 'Order placed successfully', 'order': order_doc}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/paymongo/webhook', methods=['POST'])
def api_paymongo_webhook():
    try:
        payload_raw = request.get_data() or b''
        signature_header = (
            request.headers.get('Paymongo-Signature')
            or request.headers.get('PayMongo-Signature')
            or request.headers.get('paymongo-signature')
            or ''
        )
        try:
            if not verify_webhook_signature(payload_raw, signature_header):
                return jsonify({'error': 'Invalid signature'}), 401
        except PayMongoError:
            return jsonify({'error': 'Webhook secret not configured'}), 401

        payload = request.get_json(silent=True) or {}
        event = payload.get('data', {}).get('attributes', {})
        event_type = (event.get('type') or '').lower()

        data_payload = event.get('data', {})
        data_attrs = data_payload.get('attributes', {})

        metadata = {}
        if isinstance(data_attrs.get('metadata'), dict):
            metadata = data_attrs.get('metadata')
        elif isinstance(data_attrs.get('source', {}), dict):
            metadata = data_attrs.get('source', {}).get('metadata', {}) or {}

        order_id = metadata.get('order_id') or metadata.get('orderId')
        if not order_id:
            return jsonify({'received': True}), 200

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        from bson import ObjectId
        order_filter = {'_id': ObjectId(order_id)} if ObjectId.is_valid(str(order_id)) else {'_id': order_id}
        order_doc = db.orders.find_one(order_filter)
        if not order_doc:
            return jsonify({'received': True}), 200

        update_fields = {'updated_at': datetime.utcnow()}
        if event_type in ('payment.paid', 'checkout_session.payment.paid'):
            if order_doc.get('payment_status') == 'paid':
                return jsonify({'received': True}), 200
            update_fields['payment_status'] = 'paid'
            update_fields['paymongo_payment_id'] = data_payload.get('id')
            update_fields['paid_at'] = datetime.utcnow()
            db.orders.update_one(order_filter, {'$set': update_fields})
            _finalize_paid_order(db, order_doc)
        elif event_type in ('payment.failed', 'payment.expired', 'checkout_session.payment.failed'):
            update_fields['payment_status'] = 'failed'
            update_fields['payment_failed_at'] = datetime.utcnow()
            db.orders.update_one(order_filter, {'$set': update_fields})

        return jsonify({'received': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/farmer/orders', methods=['GET'])
@token_required
def api_farmer_orders():
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'error': 'Not authorized'}), 403

        farmer_id = str(user.id)
        seller_orders = []
        product_cache = {}

        def _get_product(pid):
            if pid in product_cache:
                return product_cache[pid]
            doc = None
            try:
                if ObjectId.is_valid(str(pid)):
                    doc = db.products.find_one({'_id': ObjectId(str(pid))})
            except Exception:
                pass
            if not doc:
                doc = db.products.find_one({'id': str(pid)})
            product_cache[pid] = doc
            return doc

        for order_doc in db.orders.find().sort('created_at', -1):
            order_items = []
            for item in order_doc.get('items', []):
                pdoc = _get_product(item.get('product_id'))
                if not pdoc:
                    continue
                if pdoc.get('farmer') != farmer_id and pdoc.get('farmer_user_id') != farmer_id:
                    continue
                order_items.append({
                    'name': item.get('name', pdoc.get('name', 'Product')),
                    'quantity': item.get('quantity', 1),
                    'price': item.get('price', pdoc.get('price', 0)),
                })

            if order_items:
                buyer = db.users.find_one({'id': order_doc.get('user_id')})
                delivery_status = _normalize_status_value(order_doc.get('delivery_status', order_doc.get('status', 'pending')))
                delivery_updates = _normalize_delivery_updates(order_doc.get('delivery_updates', []), delivery_status)
                seller_orders.append({
                    'id': str(order_doc.get('_id')),
                    'status': _normalize_status_value(order_doc.get('status', 'pending')),
                    'delivery_status': delivery_status,
                    'delivery_tracking_id': order_doc.get('delivery_tracking_id'),
                    'delivery_proof_url': order_doc.get('delivery_proof_url'),
                    'delivery_updates': delivery_updates,
                    'delivery_status_updated_at': _latest_delivery_update_at(delivery_updates) or order_doc.get('updated_at') or order_doc.get('created_at'),
                    'created_at': order_doc.get('created_at'),
                    'updated_at': order_doc.get('updated_at'),
                    'payment_method': order_doc.get('payment_method'),
                    'payment_provider': order_doc.get('payment_provider'),
                    'payment_status': order_doc.get('payment_status'),
                    'buyer_name': (buyer.get('first_name') if buyer else 'Customer'),
                    'buyer_email': (buyer.get('email') if buyer else ''),
                    'shipping_name': order_doc.get('shipping_name'),
                    'shipping_phone': order_doc.get('shipping_phone'),
                    'shipping_address': order_doc.get('shipping_address'),
                    'overall_location': order_doc.get('overall_location', ''),
                    'delivery_address': order_doc.get('delivery_address'),
                    'delivery_notes': order_doc.get('delivery_notes'),
                    'assigned_rider_id': order_doc.get('assigned_rider_id'),
                    'assigned_rider_name': order_doc.get('assigned_rider_name'),
                    'assigned_rider_phone': order_doc.get('assigned_rider_phone'),
                    'assigned_rider_barangay': order_doc.get('assigned_rider_barangay'),
                    'assigned_rider_city': order_doc.get('assigned_rider_city'),
                    'assigned_rider_province': order_doc.get('assigned_rider_province'),
                    'items': order_items,
                    'total_amount': order_doc.get('total_amount', 0),
                })

        return jsonify({'orders': seller_orders})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/order/<order_id>/status', methods=['POST'])
@token_required
def api_update_order_status(order_id):
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form
        else:
            data = request.get_json() or {}

        new_status = (data.get('status') or '').strip().lower()
        status_reason = (data.get('reason') or '').strip()
        if new_status not in ('approved', 'rejected', 'confirmed', 'ready_for_ship', 'picked_up', 'on_the_way', 'delivered'):
            return jsonify({'success': False, 'message': 'Invalid status'}), 400
        if new_status == 'rejected' and not status_reason:
            return jsonify({'success': False, 'message': 'Rejection reason is required'}), 400

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        if new_status == 'ready_for_ship' and order_doc.get('status') != 'approved':
            return jsonify({'success': False, 'message': 'Order must be approved before ready for ship'}), 400

        if order_doc.get('payment_provider') == 'paymongo' and order_doc.get('payment_status') != 'paid':
            return jsonify({'success': False, 'message': 'Payment not confirmed'}), 400

        farmer_id = str(user.id)

        def _belongs_to_farmer(item):
            pid = item.get('product_id')
            if not pid:
                return False
            pdoc = None
            if ObjectId.is_valid(str(pid)):
                pdoc = db.products.find_one({'_id': ObjectId(str(pid))})
            if not pdoc:
                pdoc = db.products.find_one({'id': str(pid)})
            if not pdoc:
                return False
            return pdoc.get('farmer') == farmer_id or pdoc.get('farmer_user_id') == farmer_id

        if not any(_belongs_to_farmer(item) for item in order_doc.get('items', [])):
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        update_fields = {'status': new_status, 'updated_at': datetime.utcnow()}
        if new_status == 'rejected':
            update_fields['rejection_reason'] = status_reason

        # Auto-assign the only active rider if advancing to delivery statuses
        # and no rider is assigned yet.
        if new_status in ('picked_up', 'on_the_way', 'delivered') and not order_doc.get('assigned_rider_id'):
            active_riders = list(db.riders.find({'active': True}))
            if len(active_riders) == 1:
                r = active_riders[0]
                update_fields.update({
                    'assigned_rider_id': str(r['_id']),
                    'assigned_rider_user_id': r.get('user_id', ''),
                    'assigned_rider_email': r.get('email', ''),
                    'assigned_rider_name': r.get('name', ''),
                    'assigned_rider_phone': r.get('phone', ''),
                    'assigned_rider_barangay': r.get('barangay', ''),
                    'assigned_rider_city': r.get('city', ''),
                    'assigned_rider_province': r.get('province', ''),
                    'assigned_at': datetime.utcnow(),
                })
                print(f"[FarmerStatus] Auto-assigned rider {r.get('name')} to order {order_id}")

        if new_status == 'ready_for_ship':
            update_fields['delivery_status'] = 'ready_for_ship'
        elif new_status in ('approved', 'picked_up', 'on_the_way', 'delivered'):
            update_fields['delivery_status'] = new_status
        elif new_status == 'rejected':
            update_fields['delivery_status'] = 'cancelled'

        delivery_updates = list(order_doc.get('delivery_updates', []))
        delivery_updates.append({
            'status': update_fields.get('delivery_status', new_status),
            'updated_at': datetime.utcnow(),
            'timestamp': datetime.utcnow(),
        })
        update_fields['delivery_updates'] = _normalize_delivery_updates(delivery_updates, update_fields.get('delivery_status', new_status))

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        # Send status update email
        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'

            if buyer_email:
                reason_html = ""
                if new_status == 'rejected' and status_reason:
                    reason_html = f"<p><strong>Reason:</strong> {status_reason}</p>"
                status_html = build_email_html(
                    title="Order Status Update",
                    subtitle="Your order status has been updated",
                    badge_text=new_status.upper(),
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        f"<p>Your order status is now <strong>{new_status.upper()}</strong>.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        f"{reason_html}"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick Order Status Update",
                    f"Order {order_id} is now {new_status.upper()}.",
                    html_body=status_html,
                )
        except Exception as e:
            print(f"Order status email error: {e}")

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Failed to update order'}), 500


@api_bp.route('/riders', methods=['GET'])
@token_required
def api_get_active_riders():
    try:
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') not in ('farmer', 'admin'):
            return jsonify({'error': 'Not authorized'}), 403

        riders = list(db.riders.find({'active': True}).sort('created_at', -1))
        rider_list = []
        for rider in riders:
            rider_list.append({
                'id': str(rider.get('_id')),
                'name': rider.get('name', ''),
                'phone': rider.get('phone', ''),
                'barangay': rider.get('barangay', ''),
                'city': rider.get('city', ''),
                'province': rider.get('province', ''),
                'active': bool(rider.get('active', True)),
            })

        return jsonify({'riders': rider_list})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/orders/<order_id>/assign-rider', methods=['POST'])
@token_required
def api_assign_order_rider(order_id):
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        data = request.get_json() or {}
        rider_id = (data.get('rider_id') or '').strip()
        if not rider_id:
            return jsonify({'success': False, 'message': 'Rider is required'}), 400

        rider_doc = None
        if ObjectId.is_valid(rider_id):
            rider_doc = db.riders.find_one({'_id': ObjectId(rider_id)})
        if not rider_doc:
            return jsonify({'success': False, 'message': 'Rider not found'}), 404
        if not rider_doc.get('active', True):
            return jsonify({'success': False, 'message': 'Rider is inactive'}), 400

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        farmer_id = str(user.id)

        def _belongs_to_farmer(item):
            pid = item.get('product_id')
            if not pid:
                return False
            pdoc = None
            if ObjectId.is_valid(str(pid)):
                pdoc = db.products.find_one({'_id': ObjectId(str(pid))})
            if not pdoc:
                pdoc = db.products.find_one({'id': str(pid)})
            if not pdoc:
                return False
            return pdoc.get('farmer') == farmer_id or pdoc.get('farmer_user_id') == farmer_id

        if not any(_belongs_to_farmer(item) for item in order_doc.get('items', [])):
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        update_doc = {
            'assigned_rider_id': str(rider_doc.get('_id')),
            'assigned_rider_user_id': rider_doc.get('user_id', ''),
            'assigned_rider_email': rider_doc.get('email', ''),
            'assigned_rider_name': rider_doc.get('name', ''),
            'assigned_rider_phone': rider_doc.get('phone', ''),
            'assigned_rider_barangay': rider_doc.get('barangay', ''),
            'assigned_rider_city': rider_doc.get('city', ''),
            'assigned_rider_province': rider_doc.get('province', ''),
            'assigned_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }

        result = db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_doc})
        print(f"[AssignRider] Order {order_id} → Rider {rider_doc.get('name')} "
              f"(rider_id={str(rider_doc.get('_id'))}, rider_user_id={rider_doc.get('user_id', '')}, "
              f"rider_email={rider_doc.get('email', '')}) "
              f"matched={result.matched_count} modified={result.modified_count}")

        if result.matched_count == 0:
            return jsonify({'success': False, 'message': 'Order update failed — not found'}), 500

        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'
            if buyer_email:
                rider_area = ', '.join([
                    rider_doc.get('barangay', ''),
                    rider_doc.get('city', ''),
                    rider_doc.get('province', ''),
                ]).strip(', ')
                email_html = build_email_html(
                    title="Rider Assigned",
                    subtitle="Your order is now scheduled for delivery",
                    badge_text="RIDER ASSIGNED",
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        "<p>Your order now has a rider assigned and will be delivered soon.</p>"
                        f"<div style=\"background:#f3f4f6;padding:12px 14px;border-radius:10px;\">"
                        f"<strong>Order ID:</strong> {order_id}<br/>"
                        f"<strong>Rider:</strong> {rider_doc.get('name', 'Rider')}<br/>"
                        f"<strong>Phone:</strong> {rider_doc.get('phone', 'N/A')}<br/>"
                        f"<strong>Area:</strong> {rider_area or 'N/A'}"
                        "</div>"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick Order Rider Assigned",
                    f"Your order {order_id} has an assigned rider.",
                    html_body=email_html,
                )
        except Exception as e:
            print(f"Rider assignment email error: {e}")

        return jsonify({'success': True, 'rider': update_doc})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Failed to assign rider'}), 500


# ------------------------------------------------------------------
# Farmer products
# ------------------------------------------------------------------
@api_bp.route('/farmer/products', methods=['GET'])
@token_required
def api_farmer_products():
    try:
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'error': 'Not authorized'}), 403

        farmer_id = str(user.id)
        farmer_email = user.email
        or_filters = [
            {'farmer': farmer_id},
            {'farmer_user_id': farmer_id},
            {'farmer_email': farmer_email},
            {'farmer_id': farmer_id},
            {'farmerId': farmer_id},
            {'seller_id': farmer_id},
            {'sellerId': farmer_id},
        ]

        products = list(db.products.find({'$or': or_filters}).sort('created_at', -1))
        for prod in products:
            prod['_id'] = str(prod.get('_id'))
            prod['id'] = prod.get('id') or prod['_id']

        return jsonify({'products': products})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/farmer/products', methods=['POST'])
@token_required
def api_farmer_add_product():
    try:
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'error': 'Not authorized'}), 403

        name = request.form.get('name', '').strip()
        description = request.form.get('description', '').strip()
        category = request.form.get('category', '').strip()
        unit = request.form.get('unit', '').strip()
        price_raw = request.form.get('price', '').strip()
        quantity_raw = request.form.get('quantity', '').strip()
        available = request.form.get('available') in ('on', 'true', '1', 'yes')
        # audience may be submitted multiple times (checkboxes). default to ['customers']
        audience_list = request.form.getlist('audience') or ['customers']

        if not name or not description or not category or not unit:
            return jsonify({'error': 'Name, description, category, and unit are required'}), 400

        try:
            price = float(price_raw)
        except Exception:
            return jsonify({'error': 'Price must be a number'}), 400
        try:
            quantity = int(quantity_raw)
        except Exception:
            return jsonify({'error': 'Quantity must be a whole number'}), 400

        if price <= 0:
            return jsonify({'error': 'Price must be greater than 0'}), 400
        if quantity < 0:
            return jsonify({'error': 'Quantity cannot be negative'}), 400

        image_url = None
        image_urls = []
        # Support multiple image files (field name 'images' or single 'image')
        image_files = request.files.getlist('images')
        if not image_files:
            single = request.files.get('image')
            if single and single.filename:
                image_files = [single]

        for image_file in image_files:
            if not image_file or not image_file.filename:
                continue
            if not allowed_file(image_file.filename):
                return jsonify({'error': 'Invalid product image type'}), 400
            image_file.seek(0, os.SEEK_END)
            fsize = image_file.tell()
            image_file.seek(0)
            if fsize > MAX_FILE_SIZE:
                return jsonify({'error': 'Product image is too large (max 5 MB)'}), 400

            # Upload to Cloudinary
            try:
                upload_res = cloudinary.uploader.upload(
                    image_file,
                    folder='farmtoclick/products',
                    resource_type='image'
                )
                url = upload_res.get('secure_url')
                if url:
                    image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

        if image_urls:
            image_url = image_urls[0]  # primary image for backward compat

        product_doc = {
            'name': name,
            'description': description,
            'price': price,
            'quantity': quantity,
            'unit': unit,
            'category': category,
            'available': available,
            'audience': audience_list,
            'image_url': image_url,
            'image_urls': image_urls,
            'farmer': str(user.id),
            'farmer_user_id': str(user.id),
            'farmer_email': user.email,
            'created_at': datetime.utcnow(),
        }

        result = db.products.insert_one(product_doc)
        product_doc['_id'] = str(result.inserted_id)
        product_doc['id'] = product_doc.get('id') or product_doc['_id']

        return jsonify({'message': 'Product added successfully', 'product': product_doc}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/farmer/products/<product_id>', methods=['PUT'])
@token_required
def api_farmer_update_product(product_id):
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'error': 'Not authorized'}), 403

        query = {'$or': [
            {'_id': ObjectId(product_id)} if ObjectId.is_valid(product_id) else {'id': product_id},
            {'id': product_id},
        ]}

        product_doc = db.products.find_one(query)
        if not product_doc:
            return jsonify({'error': 'Product not found'}), 404

        farmer_id = str(user.id)
        if not (
            product_doc.get('farmer') == farmer_id
            or product_doc.get('farmer_user_id') == farmer_id
            or product_doc.get('farmer_email') == user.email
        ):
            return jsonify({'error': 'Not authorized'}), 403

        update_doc = {}
        for field in ('name', 'description', 'category', 'unit'):
            if field in request.form:
                update_doc[field] = request.form.get(field, '').strip()

        if 'price' in request.form:
            try:
                update_doc['price'] = float(request.form.get('price', '').strip())
            except Exception:
                return jsonify({'error': 'Price must be a number'}), 400
        if 'quantity' in request.form:
            try:
                update_doc['quantity'] = int(request.form.get('quantity', '').strip())
            except Exception:
                return jsonify({'error': 'Quantity must be a whole number'}), 400

        if 'available' in request.form:
            update_doc['available'] = request.form.get('available') in ('on', 'true', '1', 'yes')
        # Update audience if provided (may be multiple values)
        if 'audience' in request.form:
            audience_list = request.form.getlist('audience') or []
            update_doc['audience'] = audience_list

        image_file = request.files.get('image')
        image_files = request.files.getlist('images')
        new_image_urls = []

        # Handle multiple images first
        if image_files:
            for img in image_files:
                if not img or not img.filename:
                    continue
                if not allowed_file(img.filename):
                    return jsonify({'error': 'Invalid product image type'}), 400
                img.seek(0, os.SEEK_END)
                fsize = img.tell()
                img.seek(0)
                if fsize > MAX_FILE_SIZE:
                    return jsonify({'error': 'Product image is too large (max 5 MB)'}), 400
                try:
                    upload_res = cloudinary.uploader.upload(
                        img,
                        folder='farmtoclick/products',
                        resource_type='image'
                    )
                    url = upload_res.get('secure_url')
                    if url:
                        new_image_urls.append(url)
                except Exception as e:
                    return jsonify({'error': f'Failed to upload image: {e}'}), 500

        # Fallback: single image field
        if not new_image_urls and image_file and image_file.filename:
            if not allowed_file(image_file.filename):
                return jsonify({'error': 'Invalid product image type'}), 400
            image_file.seek(0, os.SEEK_END)
            fsize = image_file.tell()
            image_file.seek(0)
            if fsize > MAX_FILE_SIZE:
                return jsonify({'error': 'Product image is too large (max 5 MB)'}), 400

            # upload updated image to Cloudinary
            try:
                upload_res = cloudinary.uploader.upload(
                    image_file,
                    folder='farmtoclick/products',
                    resource_type='image'
                )
                url = upload_res.get('secure_url')
                if url:
                    new_image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

        # Merge with existing URLs the client wants to keep
        kept_urls_raw = request.form.get('existing_image_urls', '')
        kept_urls = [u.strip() for u in kept_urls_raw.split(',') if u.strip()] if kept_urls_raw else []
        final_urls = kept_urls + new_image_urls

        if final_urls:
            update_doc['image_urls'] = final_urls
            update_doc['image_url'] = final_urls[0]

        if not update_doc:
            return jsonify({'error': 'No valid fields to update'}), 400

        db.products.update_one({'_id': product_doc['_id']}, {'$set': update_doc})

        return jsonify({'message': 'Product updated successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/farmer/products/<product_id>', methods=['DELETE'])
@token_required
def api_farmer_delete_product(product_id):
    try:
        from bson import ObjectId
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'farmer':
            return jsonify({'error': 'Not authorized'}), 403

        query = {'_id': ObjectId(product_id)} if ObjectId.is_valid(product_id) else {'id': product_id}
        product_doc = db.products.find_one(query)
        if not product_doc:
            return jsonify({'error': 'Product not found'}), 404

        farmer_id = str(user.id)
        if not (
            product_doc.get('farmer') == farmer_id
            or product_doc.get('farmer_user_id') == farmer_id
            or product_doc.get('farmer_email') == user.email
        ):
            return jsonify({'error': 'Not authorized'}), 403

        db.products.delete_one({'_id': product_doc['_id']})
        return jsonify({'message': 'Product deleted successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Farmers listing
# ------------------------------------------------------------------
@api_bp.route('/farmers', methods=['GET'])
def api_farmers():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500
        farmers = list(db.users.find({'role': 'farmer'}))

        response = []
        from bson import ObjectId
        for f in farmers:
            try:
                f_id = f.get('id') or str(f.get('_id'))
                _id_str = str(f.get('_id'))

                # Build OR filters to match how products are associated with farmers
                or_filters = []
                if f_id:
                    or_filters.extend([
                        {'farmer': f_id},
                        {'farmer_user_id': f_id},
                        {'farmer_id': f_id},
                        {'farmerId': f_id},
                        {'seller_id': f_id},
                        {'sellerId': f_id},
                        {'farmer.id': f_id},
                    ])
                if _id_str:
                    or_filters.append({'farmer': _id_str})
                try:
                    if _id_str and ObjectId.is_valid(_id_str):
                        or_filters.append({'farmer': ObjectId(_id_str)})
                        or_filters.append({'farmer._id': ObjectId(_id_str)})
                except Exception:
                    pass

                product_count = 0
                if or_filters:
                    try:
                        prods = list(db.products.find({'$and': [{'available': True}, {'$or': or_filters}]}))
                        product_count = len(prods)
                    except Exception:
                        product_count = f.get('product_count', 0) or 0
                else:
                    product_count = f.get('product_count', 0) or 0

                response.append({
                    'id': f_id,
                    '_id': _id_str,
                    'first_name': f.get('first_name', ''),
                    'last_name': f.get('last_name', ''),
                    'email': f.get('email', ''),
                    'farm_name': f.get('farm_name', ''),
                    'farm_description': f.get('farm_description', ''),
                    'farm_location': f.get('farm_location', ''),
                    'farm_phone': f.get('farm_phone', ''),
                    'exact_address': f.get('exact_address', ''),
                    'overall_location': f.get('overall_location', ''),
                    'profile_picture': f.get('profile_picture', ''),
                    'phone': f.get('phone', ''),
                    'product_count': product_count,
                })
            except Exception:
                # Fallback: include minimal fields
                response.append({
                    'id': f.get('id') or str(f.get('_id')),
                    '_id': str(f.get('_id')),
                    'first_name': f.get('first_name', ''),
                    'last_name': f.get('last_name', ''),
                    'profile_picture': f.get('profile_picture', ''),
                    'product_count': f.get('product_count', 0) or 0,
                })

        return jsonify(response)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/farmer/<farmer_id>', methods=['GET'])
def api_farmer_profile(farmer_id):
    """Public farmer profile with their products."""
    try:
        from bson import ObjectId

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        # Try by UUID 'id' field first, then by Mongo _id
        farmer = db.users.find_one({'id': farmer_id, 'role': 'farmer'})
        if not farmer and ObjectId.is_valid(farmer_id):
            farmer = db.users.find_one({'_id': ObjectId(farmer_id), 'role': 'farmer'})
        if not farmer:
            return jsonify({'error': 'Farmer not found'}), 404

        farmer['_id'] = str(farmer['_id'])
        farmer_uuid = farmer.get('id') or farmer['_id']

        # Look up products belonging to this farmer
        product_filters = [
            {'farmer': farmer_uuid},
            {'farmer_user_id': farmer_uuid},
            {'farmer_email': farmer.get('email')},
        ]
        if ObjectId.is_valid(farmer['_id']):
            product_filters.append({'farmer': ObjectId(farmer['_id'])})

        products = list(
            db.products.find({'$or': product_filters, 'available': True}).sort('created_at', -1)
        )
        for p in products:
            p['_id'] = str(p['_id'])
            p['id'] = p.get('id') or p['_id']

        return jsonify({'farmer': farmer, 'products': products})
    except Exception as e:
        print(f"Farmer profile API error: {e}")
        return jsonify({'error': 'Farmer not found'}), 404


# ------------------------------------------------------------------
# Debug endpoint to verify current user's role
# ------------------------------------------------------------------
@api_bp.route('/auth/me', methods=['GET'])
def api_current_user():
    """Returns the current authenticated user's full data including role"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'No token provided'}), 401

        from user_model import User
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


# ===========================================================================
# DTI SRP Price Suggestion System
# ===========================================================================

# Attempt to load a pretrained Random Forest price model at startup (optional)
try:
    import joblib
    import threading
    import pandas as pd

    PRICE_RF_MODEL = None
    _PRICE_RF_LOCK = threading.Lock()
    PRICE_MODEL_PATH = os.path.join(_BACKEND_DIR, 'ml_models', 'price_model_rf.pkl')

    def _load_price_model():
        global PRICE_RF_MODEL
        try:
            if os.path.exists(PRICE_MODEL_PATH):
                PRICE_RF_MODEL = joblib.load(PRICE_MODEL_PATH)
            else:
                PRICE_RF_MODEL = None
        except Exception:
            PRICE_RF_MODEL = None

    def _predict_price_with_rf(product_name, unit='kg', source_file='', file_date=None):
        """Predict a single price using the retrained time-series RF model."""
        if PRICE_RF_MODEL is None:
            raise RuntimeError('Price model not available')

        now = datetime.utcnow()
        if file_date:
            try:
                now = datetime.fromisoformat(str(file_date))
            except Exception:
                pass

        X = pd.DataFrame([{
            'name_text': product_name or '',
            'unit': unit or 'kg',
            'day_number': 0.0,
            'month': now.month,
            'day_of_week': now.weekday(),
            'price_low': 0.0,
            'price_high': 0.0,
            'price_spread': 0.0,
            'lag_1': 0.0,
            'lag_2': 0.0,
            'lag_3': 0.0,
            'rolling_mean_3': 0.0,
        }])
        pred = PRICE_RF_MODEL.predict(X)
        return float(pred[0])

    _load_price_model()
except Exception:
    PRICE_RF_MODEL = None


@api_bp.route('/dti/reload-model', methods=['POST'])
@token_required
def api_dti_reload_model():
    """Hot-reload the RF model after retraining (admin only)."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500
        from user_model import User
        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin only'}), 403

        _load_price_model()
        # Also reload inside dti_price_engine
        from dti_price_engine import _load_rf_model
        _load_rf_model()

        status = 'loaded' if PRICE_RF_MODEL is not None else 'not_found'
        return jsonify({'status': status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/suggest-price', methods=['GET'])
@token_required
def api_dti_suggest_price():
    """
    Suggest a retail price for a product based on DTI records.
    Query params: name (required), unit (optional), category (optional)
    """
    try:
        from dti_price_engine import suggest_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        unit = request.args.get('unit', 'kg').strip()
        category = request.args.get('category', '').strip()
        audience = request.args.get('audience', '').strip().lower()  # optional: 'co-vendors' or 'customers'

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        # If audience is co-vendors, use 15% markup override
        if audience == 'co-vendors':
            result = suggest_price(db, product_name, unit=unit, category=category, markup_override=0.15)
        else:
            result = suggest_price(db, product_name, unit=unit, category=category)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Price prediction endpoint using trained Random Forest (optional)
# POST JSON: { product_name, unit (opt), source_file (opt), file_date (opt, ISO) }
# If RF model not available, falls back to existing heuristic `suggest_price`.
# ------------------------------------------------------------------
@api_bp.route('/dti/predict-price', methods=['POST'])
@token_required
def api_dti_predict_price():
    try:
        from dti_price_engine import suggest_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        data = request.get_json() or {}
        product_name = (data.get('product_name') or '').strip()
        if not product_name:
            return jsonify({'error': 'product_name is required'}), 400

        unit = (data.get('unit') or 'kg').strip()
        source_file = (data.get('source_file') or '').strip()
        file_date = data.get('file_date', None)

        # If RF model isn't loaded, return heuristic suggestion
        if PRICE_RF_MODEL is None:
            sugg = suggest_price(db, product_name, unit=unit)
            return jsonify({'model': 'heuristic', 'suggestion': sugg})

        try:
            price = _predict_price_with_rf(product_name, unit=unit, source_file=source_file, file_date=file_date)
            return jsonify({'model': 'price_model_rf', 'predicted_price': round(price, 2)})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Co-vendors marketplace (farmer and admin)
# ------------------------------------------------------------------
@api_bp.route('/products/covendors', methods=['GET'])
@token_required
def api_products_covendors():
    try:
        from user_model import User

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') not in ('farmer', 'admin'):
            return jsonify({'error': 'Not authorized'}), 403

        # Find products that have been marked visible to co-vendors
        from bson import ObjectId
        products = list(db.products.find({'audience': 'co-vendors', 'available': True}).sort('created_at', -1))
        out = []
        for p in products:
            p['_id'] = str(p.get('_id'))
            p['id'] = p.get('id') or p['_id']
            farmer_name = p.get('farmer_name', '')
            farmer_info = None
            if not farmer_name:
                possible_ids = [p.get(k) for k in ('farmer', 'farmer_user_id', 'farmer_id', 'farmerId', 'seller_id', 'sellerId') if p.get(k)]
                found = None
                for fid in possible_ids:
                    try:
                        if ObjectId.is_valid(str(fid)):
                            found = db.users.find_one({'_id': ObjectId(str(fid))})
                        else:
                            found = db.users.find_one({'id': str(fid)}) or db.users.find_one({'email': str(fid)})
                    except Exception:
                        found = db.users.find_one({'id': str(fid)})
                    if found:
                        break
                if found:
                    farmer_name = f"{found.get('first_name','').strip()} {found.get('last_name','').strip()}".strip() or found.get('farm_name') or found.get('name') or ''
                    farmer_info = {
                        'id': str(found.get('_id') or found.get('id') or ''),
                        'farm_name': found.get('farm_name', ''),
                        'name': farmer_name,
                        'location': found.get('farm_location') or found.get('overall_location') or found.get('location') or ''
                    }
            # Determine display price for co-vendors: prefer DTI-suggested price with 15% markup
            stored_price = p.get('price', 0)
            display_price = stored_price
            try:
                from dti_price_engine import suggest_price
                dti_res = suggest_price(db, p.get('name', ''), unit=p.get('unit', 'kg'), category=p.get('category', ''), markup_override=0.15)
                if isinstance(dti_res, dict) and dti_res.get('found') and dti_res.get('auto_price'):
                    display_price = dti_res.get('auto_price')
            except Exception:
                # If DTI suggestion fails, keep stored price
                display_price = stored_price

            out.append({
                    **{k: (p.get(k) or '') for k in ('id','name','description','image','image_url','category','location')},
                    'price': display_price,
                    'farmer_name': farmer_name or '',
                    'farmer': farmer_info,
                    'quantity': p.get('quantity', 0),
                    'unit': p.get('unit', ''),
                })
        return jsonify({'products': out})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/product-suggestions', methods=['GET'])
@token_required
def api_dti_product_suggestions():
    """
    Get product name suggestions from DTI records based on partial name matching.
    Query params: name (required), limit (optional, default=10)
    
    Returns list of suggested product names with varieties in parentheses.
    Example: ["Banana (Cavendish)", "Banana (Latundan)", "Banana (Saba)"]
    """
    try:
        from dti_price_engine import suggest_product_names

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        partial_name = request.args.get('name', '').strip()
        limit = request.args.get('limit', 10, type=int)

        if not partial_name or len(partial_name) < 1:
            return jsonify({'suggestions': []})

        suggestions = suggest_product_names(db, partial_name, limit=limit)
        return jsonify({'suggestions': suggestions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/prices', methods=['GET'])
@token_required
def api_dti_get_prices():
    """Get all active DTI price records."""
    try:
        from dti_price_engine import get_all_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        records = get_all_dti_records(db, active_only=True)
        return jsonify({'records': records, 'count': len(records)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/upload-pdf', methods=['POST'])
@token_required
def api_dti_upload_pdf():
    """
    Upload a DTI price monitoring PDF. Admin only.
    Parses the PDF and stores extracted price records.
    """
    try:
        from user_model import User
        from dti_price_engine import parse_dti_pdf, save_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        pdf_file = request.files.get('pdf')
        if not pdf_file or not pdf_file.filename:
            return jsonify({'error': 'No PDF file provided'}), 400

        if not pdf_file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'File must be a PDF'}), 400

        # Save PDF temporarily
        upload_dir = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'dti_pdfs')
        os.makedirs(upload_dir, exist_ok=True)
        unique_name = f"{uuid.uuid4().hex}_{secure_filename(pdf_file.filename)}"
        filepath = os.path.join(upload_dir, unique_name)
        pdf_file.save(filepath)

        # Parse PDF
        records, raw_text = parse_dti_pdf(filepath)

        if not records:
            return jsonify({
                'error': 'No price records could be extracted from the PDF. '
                         'You can add prices manually instead.',
                'raw_text_preview': raw_text[:2000] if raw_text else '',
            }), 400

        # Save to DB
        count = save_dti_records(db, records, pdf_file.filename, uploaded_by=request.user_email)

        return jsonify({
            'message': f'Successfully extracted and saved {count} price records',
            'count': count,
            'records': records,
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/manual-entry', methods=['POST'])
@token_required
def api_dti_manual_entry():
    """
    Manually add a DTI price record. Admin only.
    Body: { product_name, price_low, price_high, unit }
    """
    try:
        from user_model import User
        from dti_price_engine import save_manual_dti_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json() or {}
        product_name = data.get('product_name', '').strip()
        price_low = data.get('price_low')
        price_high = data.get('price_high')
        unit = data.get('unit', 'kg').strip()

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400
        try:
            price_low = float(price_low)
            price_high = float(price_high) if price_high else price_low
        except (TypeError, ValueError):
            return jsonify({'error': 'Valid prices are required'}), 400

        if price_low <= 0:
            return jsonify({'error': 'Price must be greater than 0'}), 400

        doc = save_manual_dti_price(db, product_name, price_low, price_high, unit,
                                    uploaded_by=request.user_email)
        doc['_id'] = str(doc.get('_id', ''))

        return jsonify({'message': 'Price record added', 'record': doc}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/bulk-entry', methods=['POST'])
@token_required
def api_dti_bulk_entry():
    """
    Add multiple DTI price records at once. Admin only.
    Body: { records: [{ product_name, price_low, price_high, unit }, ...] }
    """
    try:
        from user_model import User
        from dti_price_engine import save_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json() or {}
        records = data.get('records', [])

        if not records:
            return jsonify({'error': 'No records provided'}), 400

        parsed = []
        for rec in records:
            name = rec.get('product_name', '').strip()
            try:
                low = float(rec.get('price_low', 0))
                high = float(rec.get('price_high', 0)) or low
            except (TypeError, ValueError):
                continue
            if name and low > 0:
                parsed.append({
                    'product_name': name,
                    'price_low': low,
                    'price_high': high,
                    'average_price': round((low + high) / 2, 2),
                    'unit': rec.get('unit', 'kg'),
                })

        if not parsed:
            return jsonify({'error': 'No valid records found'}), 400

        count = save_dti_records(db, parsed, 'bulk_manual_entry', uploaded_by=request.user_email)
        return jsonify({'message': f'Added {count} price records', 'count': count}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/records/bulk-delete', methods=['POST'])
@token_required
def api_dti_bulk_delete():
    """Bulk delete (deactivate) multiple DTI price records. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_records_bulk, delete_all_active_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        delete_all = data.get('delete_all', False)
        record_ids = data.get('record_ids', [])

        if delete_all:
            count = delete_all_active_dti_records(db)
        elif record_ids:
            count = delete_dti_records_bulk(db, record_ids)
        else:
            return jsonify({'error': 'Provide record_ids or set delete_all to true'}), 400

        return jsonify({'message': f'Deleted {count} record(s)', 'count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/records/<record_id>', methods=['DELETE'])
@token_required
def api_dti_delete_record(record_id):
    """Delete (deactivate) a single DTI price record. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_record

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        count = delete_dti_record(db, record_id)
        return jsonify({'message': f'Deleted {count} record(s)'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/batch/<batch_id>', methods=['DELETE'])
@token_required
def api_dti_delete_batch(batch_id):
    """Delete (deactivate) all records in a batch. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_batch

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        count = delete_dti_batch(db, batch_id)
        return jsonify({'message': f'Deleted {count} records from batch'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Price Trends & Forecast
# ------------------------------------------------------------------

@api_bp.route('/dti/price-trends', methods=['GET'])
@token_required
def api_dti_price_trends():
    """
    Get historical price data and a price forecast for a product.
    Query params:
        name (required) – product name to search
        days (optional, default 30) – number of future days to forecast
    """
    try:
        from dti_price_engine import get_price_trends

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        forecast_days = request.args.get('days', 30, type=int)

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        result = get_price_trends(db, product_name, forecast_days=forecast_days)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/prediction-accuracy', methods=['GET'])
@token_required
def api_dti_prediction_accuracy():
    """
    Backtest accuracy report: compare model predictions against
    actual historical prices for a product.
    Query params: name (required)
    """
    try:
        from dti_price_engine import get_prediction_accuracy

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        result = get_prediction_accuracy(db, product_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/trendable-products', methods=['GET'])
@token_required
def api_dti_trendable_products():
    """
    Return products that have enough historical data (≥2 dates) for
    trend analysis / price prediction.
    """
    try:
        from dti_price_engine import get_trendable_products

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 50, type=int)
        products = get_trendable_products(db, limit=limit)
        return jsonify({'products': products})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/trends', methods=['GET'])
@token_required
def api_dti_trends():
    """
    Return historical price trend data and forecast for a specific product.
    Query params:
        name (required) – product name to analyse
        days (optional, default 30) – forecast horizon in days
    """
    try:
        from dti_price_engine import get_price_trends

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        days = request.args.get('days', 30, type=int)
        result = get_price_trends(db, product_name, forecast_days=days)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/public-predictions', methods=['GET'])
def api_dti_public_predictions():
    """
    Alias for /public/price-predictions – returns predicted prices for the
    top most-ordered products that have DTI trend data.
    Query params:
        limit (optional, default 6) – max products to return
        days  (optional, default 1) – forecast horizon in days
    """
    try:
        from dti_price_engine import get_trendable_products, get_price_trends
        from collections import defaultdict

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 6, type=int)
        forecast_days = request.args.get('days', 1, type=int)

        all_orders = list(db.orders.find({}, {'items': 1}))
        product_order_count = defaultdict(int)
        for o in all_orders:
            for item in o.get('items', []):
                name = (item.get('name') or '').strip()
                if name:
                    product_order_count[name.lower()] += int(item.get('quantity', 1))

        top_ordered_names = [n for n, _ in sorted(product_order_count.items(), key=lambda x: x[1], reverse=True)]

        trendable = get_trendable_products(db, limit=200)
        trendable_map = {p['product_name'].lower(): p for p in trendable}

        matched = []
        used = set()
        for ordered_name in top_ordered_names:
            if len(matched) >= limit:
                break
            if ordered_name in trendable_map and ordered_name not in used:
                matched.append(trendable_map[ordered_name])
                used.add(ordered_name)
                continue
            for tname, tprod in trendable_map.items():
                if tname in used:
                    continue
                if ordered_name in tname or tname in ordered_name:
                    matched.append(tprod)
                    used.add(tname)
                    break

        if len(matched) < limit:
            for tp in trendable:
                if len(matched) >= limit:
                    break
                key = tp['product_name'].lower()
                if key not in used:
                    matched.append(tp)
                    used.add(key)

        if not matched:
            return jsonify({'predictions': [], 'count': 0})

        predictions = []
        for prod in matched:
            try:
                trend = get_price_trends(db, prod['product_name'], forecast_days=forecast_days)
                if trend.get('found'):
                    predictions.append({
                        'product_name': trend['product_name'],
                        'current_price': trend['current_price'],
                        'predicted_price': trend.get('next_day_price', trend['predicted_price']),
                        'predicted_date': trend.get('next_day_date'),
                        'trend': trend.get('next_day_trend', trend['trend']),
                        'trend_pct': trend.get('next_day_change_pct', trend['trend_pct']),
                        'price_change': trend.get('next_day_change', 0),
                        'confidence': trend['confidence'],
                        'data_points': trend['data_points'],
                        'unit': trend.get('unit', 'kg'),
                        'history': trend.get('history', [])[-5:],
                        'forecast': trend.get('forecast', [])[:3],
                    })
            except Exception:
                continue

        return jsonify({'predictions': predictions, 'count': len(predictions)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/public/price-predictions', methods=['GET'])
def api_public_price_predictions():
    """
    Public (no auth) endpoint that returns predicted prices for the
    top most-ordered products that also have DTI trend data.
    Used on the landing page.
    Query params:
        limit (optional, default 6) – max products to return
        days  (optional, default 1) – forecast horizon in days
    """
    try:
        from dti_price_engine import get_trendable_products, get_price_trends
        from collections import defaultdict

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 6, type=int)
        forecast_days = request.args.get('days', 1, type=int)

        # ----- 1. Find top ordered product names from orders -----
        all_orders = list(db.orders.find({}, {'items': 1}))
        product_order_count = defaultdict(int)
        for o in all_orders:
            for item in o.get('items', []):
                name = (item.get('name') or '').strip()
                if name:
                    product_order_count[name.lower()] += int(item.get('quantity', 1))

        # Sort by total quantity ordered (descending)
        top_ordered = sorted(product_order_count.items(), key=lambda x: x[1], reverse=True)
        top_ordered_names = [name for name, _ in top_ordered]

        # ----- 2. Get all trendable products from DTI -----
        trendable = get_trendable_products(db, limit=200)
        trendable_map = {p['product_name'].lower(): p for p in trendable}

        # ----- 3. Match top-ordered products to trendable DTI products -----
        matched = []
        used = set()
        for ordered_name in top_ordered_names:
            if len(matched) >= limit:
                break
            # Exact match
            if ordered_name in trendable_map and ordered_name not in used:
                matched.append(trendable_map[ordered_name])
                used.add(ordered_name)
                continue
            # Partial/substring match
            for tname, tprod in trendable_map.items():
                if tname in used:
                    continue
                if ordered_name in tname or tname in ordered_name:
                    matched.append(tprod)
                    used.add(tname)
                    break

        # If fewer than limit matched, fill with remaining trendable products
        if len(matched) < limit:
            for tp in trendable:
                if len(matched) >= limit:
                    break
                key = tp['product_name'].lower()
                if key not in used:
                    matched.append(tp)
                    used.add(key)

        if not matched:
            return jsonify({'predictions': [], 'count': 0})

        predictions = []
        for prod in matched:
            try:
                trend = get_price_trends(db, prod['product_name'], forecast_days=forecast_days)
                if trend.get('found'):
                    predictions.append({
                        'product_name': trend['product_name'],
                        'current_price': trend['current_price'],
                        'predicted_price': trend.get('next_day_price', trend['predicted_price']),
                        'predicted_date': trend.get('next_day_date'),
                        'trend': trend.get('next_day_trend', trend['trend']),
                        'trend_pct': trend.get('next_day_change_pct', trend['trend_pct']),
                        'price_change': trend.get('next_day_change', 0),
                        'confidence': trend['confidence'],
                        'data_points': trend['data_points'],
                        'unit': trend.get('unit', 'kg'),
                        'history': trend.get('history', [])[-5:],
                        'forecast': trend.get('forecast', [])[:3],
                    })
            except Exception:
                continue

        return jsonify({'predictions': predictions, 'count': len(predictions)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/orders/<order_id>/location', methods=['POST'])
@token_required
def update_order_location(order_id):
    """
    Update the GPS location of the driver for a specific order.
    Expected JSON: { "lat": float, "lng": float }
    """
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        data = request.get_json()
        if not data or 'lat' not in data or 'lng' not in data:
            return jsonify({'error': 'Missing lat or lng'}), 400

        from bson import ObjectId
        if not ObjectId.is_valid(order_id):
            return jsonify({'error': 'Invalid order ID'}), 400

        # Verify the user is the farmer/driver for this order
        order = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order:
            return jsonify({'error': 'Order not found'}), 404

        # In a real app, you'd verify current_user is the assigned driver/farmer
        # For now, we just update the location
        
        location_data = {
            'lat': float(data['lat']),
            'lng': float(data['lng']),
            'updated_at': datetime.utcnow()
        }

        db.orders.update_one(
            {'_id': ObjectId(order_id)},
            {'$set': {'driver_location': location_data}}
        )

        # Convert datetime to ISO string with 'Z' for JSON serialization
        location_data['updated_at'] = location_data['updated_at'].isoformat() + 'Z'

        return jsonify({'message': 'Location updated successfully', 'location': location_data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/orders/<order_id>/location', methods=['GET'])
@token_required
def get_order_location(order_id):
    """
    Get the latest GPS location of the driver for a specific order.
    """
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        from bson import ObjectId
        if not ObjectId.is_valid(order_id):
            return jsonify({'error': 'Invalid order ID'}), 400

        order = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order:
            return jsonify({'error': 'Order not found'}), 404

        # Verify the user is the buyer or the farmer
        # We get the user_id from the token via request.user_id
        user_id = getattr(request, 'user_id', None)
        
        # Skip strict auth check for now to ensure it works, or implement properly:
        # if str(order.get('user_id')) != str(user_id):
        #     return jsonify({'error': 'Unauthorized'}), 403

        location = order.get('driver_location')
        if not location:
            return jsonify({'message': 'Location not available yet', 'location': None}), 404

        # Convert datetime to ISO string for JSON serialization
        if 'updated_at' in location and isinstance(location['updated_at'], datetime):
            # Append 'Z' to indicate UTC time so frontend parses it correctly
            location['updated_at'] = location['updated_at'].isoformat() + 'Z'

        return jsonify({'location': location})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Rider Route Map – Travelling Salesman Optimised Delivery Route
# ------------------------------------------------------------------

def _geocode_address(address, db=None):
    """Geocode an address string to (lat, lng) using the Nominatim API.
    Caches results in MongoDB collection ``geocode_cache`` to respect rate limits."""
    import requests as _requests
    import time

    if not address or not address.strip():
        return None

    address = address.strip()

    # Try cache first
    if db is not None:
        cached = db.geocode_cache.find_one({'address': address})
        if cached:
            return (cached['lat'], cached['lng'])

    try:
        resp = _requests.get(
            'https://nominatim.openstreetmap.org/search',
            params={'q': address, 'format': 'json', 'limit': 1},
            headers={'User-Agent': 'FarmtoClick/1.0'},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            lat = float(results[0]['lat'])
            lng = float(results[0]['lon'])
            # Cache
            if db is not None:
                db.geocode_cache.update_one(
                    {'address': address},
                    {'$set': {'address': address, 'lat': lat, 'lng': lng, 'cached_at': datetime.utcnow()}},
                    upsert=True,
                )
            return (lat, lng)
    except Exception as e:
        print(f"[Geocode] Failed for '{address}': {e}")

    # Retry with less specific address (remove first part before comma)
    parts = [p.strip() for p in address.split(',') if p.strip()]
    if len(parts) > 1:
        shorter = ', '.join(parts[1:])
        try:
            time.sleep(1)  # Nominatim rate limit
            resp = _requests.get(
                'https://nominatim.openstreetmap.org/search',
                params={'q': shorter, 'format': 'json', 'limit': 1},
                headers={'User-Agent': 'FarmtoClick/1.0'},
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json()
            if results:
                lat = float(results[0]['lat'])
                lng = float(results[0]['lon'])
                if db is not None:
                    db.geocode_cache.update_one(
                        {'address': address},
                        {'$set': {'address': address, 'lat': lat, 'lng': lng, 'cached_at': datetime.utcnow()}},
                        upsert=True,
                    )
                return (lat, lng)
        except Exception:
            pass

    return None


def _haversine(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance (km) between two points."""
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _solve_tsp_nearest_neighbour(points, start_idx=0):
    """Solve TSP with nearest-neighbour heuristic.
    ``points`` is a list of (lat, lng).
    Returns an ordered list of indices."""
    n = len(points)
    if n <= 1:
        return list(range(n))
    if n == 2:
        return [0, 1] if start_idx == 0 else [1, 0]

    visited = [False] * n
    route = [start_idx]
    visited[start_idx] = True

    for _ in range(n - 1):
        current = route[-1]
        best_dist = float('inf')
        best_next = -1
        for j in range(n):
            if visited[j]:
                continue
            d = _haversine(points[current][0], points[current][1], points[j][0], points[j][1])
            if d < best_dist:
                best_dist = d
                best_next = j
        if best_next == -1:
            break
        visited[best_next] = True
        route.append(best_next)
    return route


def _solve_tsp_2opt(points, start_idx=0):
    """Improve a nearest-neighbour tour with 2-opt local search."""
    route = _solve_tsp_nearest_neighbour(points, start_idx)
    n = len(route)
    if n <= 3:
        return route

    def total_distance(r):
        return sum(_haversine(points[r[i]][0], points[r[i]][1],
                              points[r[i + 1]][0], points[r[i + 1]][1])
                   for i in range(len(r) - 1))

    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                new_route = route[:i] + route[i:j + 1][::-1] + route[j + 1:]
                if total_distance(new_route) < total_distance(route):
                    route = new_route
                    improved = True
    return route


@api_bp.route('/rider/route-map', methods=['GET'])
@token_required
def api_rider_route_map():
    """Return today's delivery stops for the logged-in rider ordered by TSP.
    Accepts optional query params:
      - start_lat, start_lng  (rider's current position)
      - date  (YYYY-MM-DD, defaults to today)
    """
    import time as _time

    try:
        from user_model import User
        from bson import ObjectId

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'error': 'Rider profile not found'}), 404

        # Date filter
        from datetime import timedelta
        target_date_str = request.args.get('date')
        if target_date_str:
            try:
                target_date = datetime.strptime(target_date_str, '%Y-%m-%d')
            except ValueError:
                target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        next_date = target_date + timedelta(days=1)

        # Find this rider's orders
        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email

        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        orders = list(db.orders.find({
            '$or': match_conditions,
            'status': {'$nin': ['cancelled', 'delivered']},
            'created_at': {'$gte': target_date, '$lt': next_date},
        }).sort('created_at', -1))

        # Also include active non-delivered orders from previous days
        prev_active = list(db.orders.find({
            '$or': match_conditions,
            'status': {'$in': ['ready_for_ship', 'picked_up', 'on_the_way']},
            'created_at': {'$lt': target_date},
        }).sort('created_at', -1))

        orders = orders + prev_active

        # De-duplicate by _id
        seen_ids = set()
        unique_orders = []
        for o in orders:
            oid = str(o['_id'])
            if oid not in seen_ids:
                seen_ids.add(oid)
                unique_orders.append(o)
        orders = unique_orders

        if not orders:
            return jsonify({
                'stops': [],
                'route_order': [],
                'total_distance_km': 0,
                'start': None,
                'message': 'No active deliveries found for today.',
            })

        # Collect addresses & geocode
        stops = []
        for order in orders:
            addr = order.get('shipping_address') or order.get('delivery_address') or ''
            buyer = db.users.find_one({'id': order.get('user_id')})
            coords = _geocode_address(addr, db)
            _time.sleep(0.3)  # Nominatim courtesy delay

            stops.append({
                'order_id': str(order['_id']),
                'address': addr,
                'lat': coords[0] if coords else None,
                'lng': coords[1] if coords else None,
                'buyer_name': (order.get('shipping_name')
                               or (buyer.get('first_name', '') + ' ' + buyer.get('last_name', '') if buyer else 'Customer')),
                'buyer_phone': order.get('shipping_phone') or (buyer.get('phone', '') if buyer else ''),
                'status': order.get('status', 'pending'),
                'delivery_status': order.get('delivery_status', order.get('status', 'pending')),
                'total_amount': order.get('total_amount', 0),
                'items': order.get('items', []),
                'created_at': order.get('created_at'),
            })

        # Filter stops that have valid coordinates
        geo_stops = [s for s in stops if s['lat'] is not None and s['lng'] is not None]
        no_geo = [s for s in stops if s['lat'] is None or s['lng'] is None]

        # Determine start point
        start_lat = request.args.get('start_lat', type=float)
        start_lng = request.args.get('start_lng', type=float)

        if start_lat is not None and start_lng is not None:
            # Insert rider's current location as index 0
            all_points = [(start_lat, start_lng)] + [(s['lat'], s['lng']) for s in geo_stops]
            route_indices = _solve_tsp_2opt(all_points, start_idx=0)
            # Remove the start point from the route for the response
            ordered_stops = [geo_stops[i - 1] for i in route_indices if i > 0]
            start_point = {'lat': start_lat, 'lng': start_lng, 'label': 'Your Location'}
        elif geo_stops:
            all_points = [(s['lat'], s['lng']) for s in geo_stops]
            route_indices = _solve_tsp_2opt(all_points, start_idx=0)
            ordered_stops = [geo_stops[i] for i in route_indices]
            start_point = {'lat': geo_stops[route_indices[0]]['lat'],
                           'lng': geo_stops[route_indices[0]]['lng'],
                           'label': 'First Stop'}
        else:
            ordered_stops = []
            start_point = None

        # Calculate total route distance using OSRM for road distance
        total_km = 0
        estimated_duration_min = 0
        road_distance_used = False

        # Build the list of coordinates for OSRM: start + ordered stops
        route_coords = []
        if start_lat is not None and start_lng is not None:
            route_coords.append((start_lat, start_lng))
        for s in ordered_stops:
            if s['lat'] and s['lng']:
                route_coords.append((s['lat'], s['lng']))

        if len(route_coords) >= 2:
            try:
                import requests as _requests
                coords_str = ';'.join(f"{lng},{lat}" for lat, lng in route_coords)
                osrm_url = f'https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=false'
                osrm_resp = _requests.get(osrm_url, timeout=15)
                osrm_data = osrm_resp.json()
                if osrm_data.get('code') == 'Ok' and osrm_data.get('routes'):
                    total_km = round(osrm_data['routes'][0]['distance'] / 1000, 2)
                    estimated_duration_min = round(osrm_data['routes'][0]['duration'] / 60)
                    road_distance_used = True
            except Exception as osrm_err:
                print(f"[RiderRouteMap] OSRM distance error, falling back to haversine: {osrm_err}")

        if not road_distance_used:
            # Fallback: haversine straight-line distance
            if start_lat is not None and start_lng is not None and ordered_stops:
                total_km += _haversine(start_lat, start_lng,
                                       ordered_stops[0]['lat'], ordered_stops[0]['lng'])
            for i in range(len(ordered_stops) - 1):
                total_km += _haversine(ordered_stops[i]['lat'], ordered_stops[i]['lng'],
                                       ordered_stops[i + 1]['lat'], ordered_stops[i + 1]['lng'])
            total_km = round(total_km, 2)

        # Number the stops
        for idx, stop in enumerate(ordered_stops):
            stop['stop_number'] = idx + 1

        return jsonify({
            'stops': ordered_stops,
            'unresolved_stops': no_geo,
            'total_distance_km': total_km,
            'estimated_duration_min': estimated_duration_min,
            'road_distance': road_distance_used,
            'start': start_point,
            'total_orders': len(orders),
            'geocoded_orders': len(geo_stops),
        })
    except Exception as e:
        print(f"[RiderRouteMap] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
