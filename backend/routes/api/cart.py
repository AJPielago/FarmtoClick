"""
Cart routes – view, add, update, remove, and clear cart items.
"""
from flask import request, jsonify

from bson import ObjectId

from db import get_mongodb_db
from middleware import token_required
from . import api_bp


# ------------------------------------------------------------------
# Get cart
# ------------------------------------------------------------------
@api_bp.route('/cart', methods=['GET'])
@token_required
def api_get_cart():
    try:
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


# ------------------------------------------------------------------
# Add to cart
# ------------------------------------------------------------------
@api_bp.route('/cart', methods=['POST'])
@token_required
def api_add_to_cart():
    try:
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

        # Validate stock availability
        available_stock = int(product.get('quantity', 0) or 0)
        cart_doc = db.carts.find_one({'user_id': request.user_id})
        existing_qty = 0
        if cart_doc:
            existing = next(
                (i for i in cart_doc.get('items', []) if i.get('product_id') == product_id),
                None,
            )
            if existing:
                existing_qty = int(existing.get('quantity', 0))

        if existing_qty + quantity > available_stock:
            return jsonify({
                'error': f'Insufficient stock. Available: {available_stock}, '
                         f'in cart: {existing_qty}, requested: {quantity}'
            }), 400

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


# ------------------------------------------------------------------
# Update cart item quantity
# ------------------------------------------------------------------
@api_bp.route('/cart/<product_id>', methods=['PUT'])
@token_required
def api_update_cart_item(product_id):
    try:
        data = request.get_json() or {}
        quantity = int(data.get('quantity', 0))

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if quantity < 1:
            # Quantity 0 or negative means remove the item
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


# ------------------------------------------------------------------
# Remove cart item
# ------------------------------------------------------------------
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


# ------------------------------------------------------------------
# Clear cart
# ------------------------------------------------------------------
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
