"""
Farmer routes – orders, product CRUD, public farmer listing & profile.
"""
import os
from datetime import datetime

import cloudinary
import cloudinary.uploader
from flask import request, jsonify
from bson import ObjectId
from werkzeug.utils import secure_filename

from db import get_mongodb_db
from middleware import token_required
from user_model import User
from helpers import allowed_file, MAX_FILE_SIZE
from . import api_bp
from ._helpers import (
    normalize_status_value,
    normalize_delivery_updates,
    latest_delivery_update_at,
)


# ===================================================================
# Farmer Orders
# ===================================================================

@api_bp.route('/farmer/orders', methods=['GET'])
@token_required
def api_farmer_orders():
    try:
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
                delivery_status = normalize_status_value(order_doc.get('delivery_status', order_doc.get('status', 'pending')))
                delivery_updates_list = normalize_delivery_updates(order_doc.get('delivery_updates', []), delivery_status)
                seller_orders.append({
                    'id': str(order_doc.get('_id')),
                    'status': normalize_status_value(order_doc.get('status', 'pending')),
                    'delivery_status': delivery_status,
                    'delivery_tracking_id': order_doc.get('delivery_tracking_id'),
                    'delivery_proof_url': order_doc.get('delivery_proof_url'),
                    'delivery_updates': delivery_updates_list,
                    'delivery_status_updated_at': latest_delivery_update_at(delivery_updates_list) or order_doc.get('updated_at') or order_doc.get('created_at'),
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


# ===================================================================
# Farmer Products CRUD
# ===================================================================

@api_bp.route('/farmer/products', methods=['GET'])
@token_required
def api_farmer_products():
    try:
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

            try:
                upload_res = cloudinary.uploader.upload(
                    image_file,
                    folder='farmtoclick/products',
                    resource_type='image',
                )
                url = upload_res.get('secure_url')
                if url:
                    image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

        if image_urls:
            image_url = image_urls[0]

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
        if 'audience' in request.form:
            audience_list = request.form.getlist('audience') or []
            update_doc['audience'] = audience_list

        image_file = request.files.get('image')
        image_files = request.files.getlist('images')
        new_image_urls = []

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
                        resource_type='image',
                    )
                    url = upload_res.get('secure_url')
                    if url:
                        new_image_urls.append(url)
                except Exception as e:
                    return jsonify({'error': f'Failed to upload image: {e}'}), 500

        if not new_image_urls and image_file and image_file.filename:
            if not allowed_file(image_file.filename):
                return jsonify({'error': 'Invalid product image type'}), 400
            image_file.seek(0, os.SEEK_END)
            fsize = image_file.tell()
            image_file.seek(0)
            if fsize > MAX_FILE_SIZE:
                return jsonify({'error': 'Product image is too large (max 5 MB)'}), 400

            try:
                upload_res = cloudinary.uploader.upload(
                    image_file,
                    folder='farmtoclick/products',
                    resource_type='image',
                )
                url = upload_res.get('secure_url')
                if url:
                    new_image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

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


# ===================================================================
# Public Farmers Listing & Profile
# ===================================================================

@api_bp.route('/farmers', methods=['GET'])
def api_farmers():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500
        farmers = list(db.users.find({'role': 'farmer'}))

        response = []
        for f in farmers:
            try:
                f_id = f.get('id') or str(f.get('_id'))
                _id_str = str(f.get('_id'))

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
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        farmer = db.users.find_one({'id': farmer_id, 'role': 'farmer'})
        if not farmer and ObjectId.is_valid(farmer_id):
            farmer = db.users.find_one({'_id': ObjectId(farmer_id), 'role': 'farmer'})
        if not farmer:
            return jsonify({'error': 'Farmer not found'}), 404

        # Convert all ObjectId values to strings so jsonify() works
        def _stringify_oids(doc):
            for k, v in doc.items():
                if isinstance(v, ObjectId):
                    doc[k] = str(v)
                elif isinstance(v, dict):
                    _stringify_oids(v)
                elif isinstance(v, list):
                    doc[k] = [str(i) if isinstance(i, ObjectId) else i for i in v]

        _stringify_oids(farmer)
        farmer_uuid = farmer.get('id') or farmer['_id']

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
            _stringify_oids(p)
            p['id'] = p.get('id') or p['_id']

        return jsonify({'farmer': farmer, 'products': products})
    except Exception as e:
        print(f"Farmer profile API error: {e}")
        return jsonify({'error': 'Farmer not found'}), 404
