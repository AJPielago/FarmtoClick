"""
Shopping cart routes (template-rendered, PyMongo-backed).
"""
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user

from db import get_mongodb_db
from middleware import token_required

cart_bp = Blueprint('cart', __name__)


@cart_bp.route('/cart')
@login_required
def cart():
    """View cart page."""
    try:
        db, _ = get_mongodb_db(cart_bp)
        if db is None:
            return render_template('cart', items=[], total=0)

        cart_doc = db.carts.find_one({'user_id': current_user.id})
        if not cart_doc or not cart_doc.get('items'):
            return render_template('cart', items=[], total=0)

        items = []
        total = 0
        for item in cart_doc['items']:
            product_id = item.get('product_id')
            product = None
            try:
                from bson import ObjectId
                product = db.products.find_one({'_id': ObjectId(product_id)})
            except Exception:
                product = db.products.find_one({'id': product_id})

            if product:
                qty = int(item.get('quantity', 1))
                price = float(product.get('price', 0) or 0)
                items.append({
                    'product_id': str(product.get('_id', product_id)),
                    'name': product.get('name', 'Product'),
                    'price': price,
                    'quantity': qty,
                    'unit': product.get('unit', ''),
                    'image_url': product.get('image_url', ''),
                    'subtotal': price * qty,
                })
                total += price * qty

        # Load user's shipping info
        shipping = {}
        try:
            user_doc = db.users.find_one({'email': current_user.email})
            if user_doc:
                shipping = {
                    'shipping_name': f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip(),
                    'shipping_phone': user_doc.get('phone', ''),
                    'overall_location': user_doc.get('overall_location', ''),
                    'shipping_address': user_doc.get('shipping_address', ''),
                }
        except Exception:
            pass

        return render_template('cart', items=items, total=total, shipping=shipping)
    except Exception as e:
        print(f"Cart error: {e}")
        return render_template('cart', items=[], total=0)


@cart_bp.route('/cart/add/<product_id>', methods=['POST', 'OPTIONS'])
@token_required
def add_to_cart_json(product_id):
    """Add a product to cart (JSON API endpoint)."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    
    try:
        from bson import ObjectId
        
        data = request.get_json() or {}
        quantity = int(data.get('quantity', 1))
        product_id = str(product_id).strip()

        if not product_id or quantity < 1:
            return jsonify({'error': 'Invalid product or quantity'}), 400

        db, _ = get_mongodb_db(cart_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        # Verify product exists
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
        print(f"Add to cart error: {e}")
        return jsonify({'error': str(e)}), 500


@cart_bp.route('/cart/add', methods=['POST'])
@login_required
def add_to_cart():
    """Add a product to cart."""
    try:
        db, _ = get_mongodb_db(cart_bp)
        if db is None:
            flash('Database connection failed.', 'error')
            return redirect(url_for('products.products'))

        product_id = request.form.get('product_id')
        quantity = int(request.form.get('quantity', 1))

        if not product_id or quantity < 1:
            flash('Invalid product or quantity.', 'error')
            return redirect(url_for('products.products'))

        cart_doc = db.carts.find_one({'user_id': current_user.id})
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
                'user_id': current_user.id,
                'items': [{'product_id': product_id, 'quantity': quantity}],
            })

        flash('Product added to cart!', 'success')
        return redirect(url_for('products.products'))
    except Exception as e:
        print(f"Add to cart error: {e}")
        flash('Failed to add to cart.', 'error')
        return redirect(url_for('products.products'))


@cart_bp.route('/cart/update', methods=['POST'])
@login_required
def update_cart():
    """Update quantity of a cart item."""
    try:
        db, _ = get_mongodb_db(cart_bp)
        if db is None:
            flash('Database connection failed.', 'error')
            return redirect(url_for('cart.cart'))

        product_id = request.form.get('product_id')
        quantity = int(request.form.get('quantity', 1))

        if quantity < 1:
            # Remove the item
            db.carts.update_one(
                {'user_id': current_user.id},
                {'$pull': {'items': {'product_id': product_id}}},
            )
        else:
            db.carts.update_one(
                {'user_id': current_user.id, 'items.product_id': product_id},
                {'$set': {'items.$.quantity': quantity}},
            )

        flash('Cart updated.', 'success')
        return redirect(url_for('cart.cart'))
    except Exception as e:
        print(f"Update cart error: {e}")
        flash('Failed to update cart.', 'error')
        return redirect(url_for('cart.cart'))


@cart_bp.route('/cart/remove', methods=['POST'])
@login_required
def remove_from_cart():
    """Remove an item from cart."""
    try:
        db, _ = get_mongodb_db(cart_bp)
        if db is None:
            flash('Database connection failed.', 'error')
            return redirect(url_for('cart.cart'))

        product_id = request.form.get('product_id')
        db.carts.update_one(
            {'user_id': current_user.id},
            {'$pull': {'items': {'product_id': product_id}}},
        )

        flash('Item removed from cart.', 'success')
        return redirect(url_for('cart.cart'))
    except Exception as e:
        print(f"Remove from cart error: {e}")
        flash('Failed to remove from cart.', 'error')
        return redirect(url_for('cart.cart'))
