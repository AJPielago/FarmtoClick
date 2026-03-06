"""
Product routes – public product listing, detail, and co-vendors marketplace.
"""
from flask import request, jsonify

from bson import ObjectId

from db import get_mongodb_db
from middleware import token_required
from user_model import User
from . import api_bp


def _resolve_farmer_info(db, product_doc):
    """Try to resolve farmer display name and info from a product document."""
    farmer_name = product_doc.get('farmer_name', '')
    farmer_info = None
    if not farmer_name:
        possible_ids = [
            product_doc.get(k)
            for k in ('farmer', 'farmer_user_id', 'farmer_id', 'farmerId', 'seller_id', 'sellerId')
            if product_doc.get(k)
        ]
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
            farmer_name = (
                f"{found.get('first_name', '').strip()} {found.get('last_name', '').strip()}".strip()
                or found.get('farm_name')
                or found.get('name')
                or ''
            )
            farmer_info = {
                'id': str(found.get('_id') or found.get('id') or ''),
                'farm_name': found.get('farm_name', ''),
                'name': farmer_name,
                'location': found.get('farm_location') or found.get('overall_location') or found.get('location') or '',
            }
    return farmer_name, farmer_info


# ------------------------------------------------------------------
# Products list
# ------------------------------------------------------------------
@api_bp.route('/products', methods=['GET'])
def api_products():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        products_cursor = db.products.find({
            'available': True,
            '$or': [
                {'audience': {'$exists': False}},
                {'audience': 'customers'},
            ],
        }).sort('created_at', -1)
        product_docs = list(products_cursor)
        products = []

        # Batch-fetch review stats
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
                },
            ]
            for stat in db.reviews.aggregate(review_pipeline):
                pid = str(stat.get('_id'))
                review_stats_map[pid] = {
                    'average_rating': round(float(stat.get('average_rating') or 0), 1),
                    'review_count': int(stat.get('review_count') or 0),
                }

        for p in product_docs:
            product_id = str(p.get('_id', ''))
            review_stats = review_stats_map.get(product_id, {'average_rating': 0, 'review_count': 0})
            farmer_name, farmer_info = _resolve_farmer_info(db, p)

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


# ------------------------------------------------------------------
# Product detail
# ------------------------------------------------------------------
@api_bp.route('/products/<product_id>', methods=['GET'])
def api_product_detail(product_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product = db.products.find_one({'_id': ObjectId(product_id)})
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        farmer_name, farmer_info = _resolve_farmer_info(db, product)

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
# Co-vendors marketplace (farmer and admin)
# ------------------------------------------------------------------
@api_bp.route('/products/covendors', methods=['GET'])
@token_required
def api_products_covendors():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') not in ('farmer', 'admin'):
            return jsonify({'error': 'Not authorized'}), 403

        products = list(db.products.find({'audience': 'co-vendors', 'available': True}).sort('created_at', -1))
        out = []
        for p in products:
            p['_id'] = str(p.get('_id'))
            p['id'] = p.get('id') or p['_id']
            farmer_name, farmer_info = _resolve_farmer_info(db, p)

            # Determine display price for co-vendors: prefer DTI-suggested price with 15% markup
            stored_price = p.get('price', 0)
            display_price = stored_price
            try:
                from dti_price_engine import suggest_price
                dti_res = suggest_price(db, p.get('name', ''), unit=p.get('unit', 'kg'),
                                        category=p.get('category', ''), markup_override=0.15)
                if isinstance(dti_res, dict) and dti_res.get('found') and dti_res.get('auto_price'):
                    display_price = dti_res.get('auto_price')
            except Exception:
                display_price = stored_price

            out.append({
                **{k: (p.get(k) or '') for k in ('id', 'name', 'description', 'image', 'image_url', 'category', 'location')},
                'price': display_price,
                'farmer_name': farmer_name or '',
                'farmer': farmer_info,
                'quantity': p.get('quantity', 0),
                'unit': p.get('unit', ''),
            })
        return jsonify({'products': out})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
