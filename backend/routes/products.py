"""
Product browsing & detail routes (template-rendered).
"""
from flask import Blueprint, render_template, request
from flask_login import current_user

from db import get_mongodb_db

products_bp = Blueprint('products', __name__)


@products_bp.route('/products')
def products():
    """Product listing page."""
    category_filter = request.args.get('category', '')
    search_query = request.args.get('search', '')

    try:
        db, _ = get_mongodb_db(products_bp)
        if db is None:
            return render_template('products.html', products=[], categories=[])

        query = {'available': True}
        if category_filter:
            query['category'] = category_filter
        if search_query:
            query['name'] = {'$regex': search_query, '$options': 'i'}

        products_cursor = db.products.find(query).sort('created_at', -1)
        products_list = list(products_cursor)

        for prod in products_list:
            prod['_id'] = str(prod['_id'])
            prod['id'] = prod.get('id') or prod['_id']

        categories = db.products.distinct('category')
        return render_template('products.html', products=products_list, categories=categories)
    except Exception as e:
        print(f"Products error: {e}")
        return render_template('products.html', products=[], categories=[])


@products_bp.route('/product/<product_id>')
def product_detail(product_id):
    """Single product detail page."""
    try:
        from bson import ObjectId
        db, _ = get_mongodb_db(products_bp)
        if db is None:
            return "Database connection failed", 503

        product = None
        if ObjectId.is_valid(product_id):
            product = db.products.find_one({'_id': ObjectId(product_id)})
        if not product:
            product = db.products.find_one({'id': product_id})
        if not product:
            return "Product not found", 404

        product['_id'] = str(product['_id'])
        product['id'] = product.get('id') or product['_id']

        # Load farmer info
        farmer = None
        farmer_ref = product.get('farmer') or product.get('farmer_user_id')
        if farmer_ref:
            farmer = db.users.find_one({'id': str(farmer_ref)})
            if not farmer:
                farmer = db.users.find_one({'email': product.get('farmer_email')})
            if farmer:
                farmer['_id'] = str(farmer['_id'])

        return render_template('product_detail.html', product=product, farmer=farmer)
    except Exception as e:
        print(f"Product detail error: {e}")
        return "Product not found", 404
