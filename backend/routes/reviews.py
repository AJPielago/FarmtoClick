"""
Review routes – CRUD for product reviews.

Rules:
* Only users with at least one **delivered** order containing the product can review it.
* One review per user per product (enforced by unique index + API check).
* Users may edit or delete their own review.
* Admin can view all reviews in a paginated data-table endpoint.
* Comment text is sanitised with a regex whitelist.
"""
import re
import os
from datetime import datetime

from flask import Blueprint, request, jsonify
from bson import ObjectId

import cloudinary
import cloudinary.uploader

from db import get_mongodb_db
from middleware import token_required
from helpers import allowed_file, MAX_FILE_SIZE

reviews_bp = Blueprint('reviews', __name__, url_prefix='/api')

# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------
# Allow letters, digits, common punctuation, Filipino characters, emoji-safe
_COMMENT_RE = re.compile(
    r"^[\w\s.,!?;:'\"\-()@#&%₱/\n\r"
    r"\u00C0-\u024F"          # Latin extended (accented chars)
    r"\u1700-\u171F"          # Tagalog script
    r"\u0080-\u00FF"          # Latin supplement
    r"]*$",
    re.UNICODE,
)

_RATING_VALID = {1, 2, 3, 4, 5}


def _sanitise_comment(text: str) -> str | None:
    """Return stripped comment or None if invalid."""
    if not text or not text.strip():
        return None
    text = text.strip()
    if len(text) > 1000:
        return None
    if not _COMMENT_RE.match(text):
        return None
    return text


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _user_has_delivered_order_for_product(db, user_id: str, product_id: str) -> bool:
    """Check if the user has at least one delivered order containing *product_id*."""
    query = {
        'user_id': user_id,
        '$or': [
            {'status': 'delivered'},
            {'delivery_status': 'delivered'},
        ],
        'items.product_id': product_id,
    }
    return db.orders.find_one(query) is not None


# ---------------------------------------------------------------------------
# GET  /api/products/<product_id>/reviews  – public
# ---------------------------------------------------------------------------
@reviews_bp.route('/products/<product_id>/reviews', methods=['GET'])
def get_product_reviews(product_id):
    """Return all reviews for a product (public, no auth required)."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        reviews_cursor = db.reviews.find({'product_id': product_id}).sort('created_at', -1)
        reviews = []
        for r in reviews_cursor:
            user_doc = None
            uid = r.get('user_id') or r.get('user')
            if uid:
                try:
                    user_doc = db.users.find_one({'_id': ObjectId(uid)}) if ObjectId.is_valid(str(uid)) else None
                except Exception:
                    user_doc = db.users.find_one({'id': str(uid)})
            if not user_doc:
                user_doc = db.users.find_one({'id': str(uid)}) if uid else None

            reviews.append({
                'id': str(r['_id']),
                'user_id': str(uid) if uid else None,
                'user_name': f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip() if user_doc else 'Unknown',
                'user_profile_picture': user_doc.get('profile_picture') if user_doc else None,
                'product_id': product_id,
                'rating': r.get('rating', 0),
                'comment': r.get('comment', ''),
                'images': r.get('images', []),
                'updated_at': r.get('updated_at').isoformat() if r.get('updated_at') else None,
                'created_at': r.get('created_at').isoformat() if r.get('created_at') else None,
            })

        # Compute average rating
        if reviews:
            avg = sum(r['rating'] for r in reviews) / len(reviews)
        else:
            avg = 0

        return jsonify({
            'reviews': reviews,
            'total': len(reviews),
            'average_rating': round(avg, 1),
        }), 200
    except Exception as e:
        print(f"Get reviews error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GET  /api/products/<product_id>/reviews/eligibility – check if user can review
# ---------------------------------------------------------------------------
@reviews_bp.route('/products/<product_id>/reviews/eligibility', methods=['GET'])
@token_required
def check_review_eligibility(product_id):
    """Return whether the authenticated user can review (or has already reviewed)."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user_id = request.user_id
        has_order = _user_has_delivered_order_for_product(db, user_id, product_id)
        existing = db.reviews.find_one({'user_id': user_id, 'product_id': product_id})

        return jsonify({
            'can_review': has_order and existing is None,
            'has_delivered_order': has_order,
            'has_existing_review': existing is not None,
            'existing_review_id': str(existing['_id']) if existing else None,
        }), 200
    except Exception as e:
        print(f"Eligibility check error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# POST /api/products/<product_id>/reviews  – create
# ---------------------------------------------------------------------------
@reviews_bp.route('/products/<product_id>/reviews', methods=['POST'])
@token_required
def create_review(product_id):
    """Create a review. User must have a delivered order for this product."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user_id = request.user_id

        # 1) verify product exists
        product = None
        if ObjectId.is_valid(product_id):
            product = db.products.find_one({'_id': ObjectId(product_id)})
        if not product:
            return jsonify({'error': 'Product not found'}), 404

        # 2) verify delivered order
        if not _user_has_delivered_order_for_product(db, user_id, product_id):
            return jsonify({'error': 'You can only review products from completed (delivered) orders'}), 403

        # 3) check duplicate
        if db.reviews.find_one({'user_id': user_id, 'product_id': product_id}):
            return jsonify({'error': 'You have already reviewed this product. You can edit your existing review instead.'}), 409

        # Support both JSON and FormData
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form.to_dict()
        else:
            data = request.get_json() or {}
        rating = data.get('rating')
        if isinstance(rating, str):
            try:
                rating = int(rating)
            except ValueError:
                pass
        comment_raw = data.get('comment', '')

        # 4) validate rating
        if rating not in _RATING_VALID:
            return jsonify({'error': 'Rating must be an integer from 1 to 5'}), 400

        # 5) validate comment with regex
        comment = None
        if comment_raw:
            comment = _sanitise_comment(str(comment_raw))
            if comment is None:
                return jsonify({'error': 'Comment contains invalid characters or exceeds 1000 characters. Only letters, numbers, and common punctuation are allowed.'}), 400

        # Upload review images
        image_urls = []
        image_files = request.files.getlist('images')
        for img in image_files:
            if not img or not img.filename:
                continue
            if not allowed_file(img.filename):
                return jsonify({'error': 'Invalid image type. Allowed: JPG, PNG, GIF'}), 400
            img.seek(0, os.SEEK_END)
            fsize = img.tell()
            img.seek(0)
            if fsize > MAX_FILE_SIZE:
                return jsonify({'error': 'Image is too large (max 5 MB each)'}), 400
            try:
                upload_res = cloudinary.uploader.upload(
                    img,
                    folder='farmtoclick/reviews',
                    resource_type='image'
                )
                url = upload_res.get('secure_url')
                if url:
                    image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

        now = datetime.utcnow()
        review_doc = {
            'user_id': user_id,
            'product_id': product_id,
            'rating': rating,
            'comment': comment or '',
            'images': image_urls,
            'created_at': now,
            'updated_at': None,
        }
        result = db.reviews.insert_one(review_doc)

        review_doc['id'] = str(result.inserted_id)
        review_doc['_id'] = str(result.inserted_id)

        # Attach user name for response
        user_doc = db.users.find_one({'id': user_id})
        if not user_doc and ObjectId.is_valid(user_id):
            user_doc = db.users.find_one({'_id': ObjectId(user_id)})
        review_doc['user_name'] = f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip() if user_doc else 'Unknown'
        review_doc['user_profile_picture'] = user_doc.get('profile_picture') if user_doc else None
        review_doc['created_at'] = now.isoformat()
        review_doc['updated_at'] = None

        return jsonify({'message': 'Review created successfully', 'review': review_doc}), 201
    except Exception as e:
        print(f"Create review error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# PUT  /api/reviews/<review_id>  – edit own review
# ---------------------------------------------------------------------------
@reviews_bp.route('/reviews/<review_id>', methods=['PUT'])
@token_required
def update_review(review_id):
    """Edit an existing review (owner only)."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if not ObjectId.is_valid(review_id):
            return jsonify({'error': 'Invalid review id'}), 400

        review = db.reviews.find_one({'_id': ObjectId(review_id)})
        if not review:
            return jsonify({'error': 'Review not found'}), 404

        if review.get('user_id') != request.user_id:
            return jsonify({'error': 'You can only edit your own review'}), 403

        # Support both JSON and FormData
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form.to_dict()
        else:
            data = request.get_json() or {}
        update_fields = {'updated_at': datetime.utcnow()}

        if 'rating' in data:
            rating = data['rating']
            if isinstance(rating, str):
                try:
                    rating = int(rating)
                except ValueError:
                    pass
            if rating not in _RATING_VALID:
                return jsonify({'error': 'Rating must be an integer from 1 to 5'}), 400
            update_fields['rating'] = rating

        if 'comment' in data:
            comment_raw = data['comment']
            if comment_raw:
                comment = _sanitise_comment(str(comment_raw))
                if comment is None:
                    return jsonify({'error': 'Comment contains invalid characters or exceeds 1000 characters. Only letters, numbers, and common punctuation are allowed.'}), 400
                update_fields['comment'] = comment
            else:
                update_fields['comment'] = ''

        # Handle review images
        image_files = request.files.getlist('images')
        new_image_urls = []
        for img in image_files:
            if not img or not img.filename:
                continue
            if not allowed_file(img.filename):
                return jsonify({'error': 'Invalid image type'}), 400
            img.seek(0, os.SEEK_END)
            fsize = img.tell()
            img.seek(0)
            if fsize > MAX_FILE_SIZE:
                return jsonify({'error': 'Image is too large (max 5 MB each)'}), 400
            try:
                upload_res = cloudinary.uploader.upload(
                    img,
                    folder='farmtoclick/reviews',
                    resource_type='image'
                )
                url = upload_res.get('secure_url')
                if url:
                    new_image_urls.append(url)
            except Exception as e:
                return jsonify({'error': f'Failed to upload image: {e}'}), 500

        # Merge kept URLs with newly uploaded
        kept_urls_raw = data.get('existing_images', '')
        kept_urls = [u.strip() for u in kept_urls_raw.split(',') if u.strip()] if kept_urls_raw else []
        final_urls = kept_urls + new_image_urls
        if final_urls or image_files:
            update_fields['images'] = final_urls

        db.reviews.update_one({'_id': ObjectId(review_id)}, {'$set': update_fields})

        updated = db.reviews.find_one({'_id': ObjectId(review_id)})

        user_doc = db.users.find_one({'id': request.user_id})
        if not user_doc and ObjectId.is_valid(request.user_id):
            user_doc = db.users.find_one({'_id': ObjectId(request.user_id)})

        return jsonify({
            'message': 'Review updated successfully',
            'review': {
                'id': str(updated['_id']),
                'user_id': updated.get('user_id'),
                'user_name': f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip() if user_doc else 'Unknown',
                'user_profile_picture': user_doc.get('profile_picture') if user_doc else None,
                'product_id': updated.get('product_id'),
                'rating': updated.get('rating'),
                'comment': updated.get('comment', ''),
                'images': updated.get('images', []),
                'updated_at': updated['updated_at'].isoformat() if updated.get('updated_at') else None,
                'created_at': updated['created_at'].isoformat() if updated.get('created_at') else None,
            }
        }), 200
    except Exception as e:
        print(f"Update review error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# DELETE /api/reviews/<review_id>  – delete own review
# ---------------------------------------------------------------------------
@reviews_bp.route('/reviews/<review_id>', methods=['DELETE'])
@token_required
def delete_review(review_id):
    """Delete a review (owner only)."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if not ObjectId.is_valid(review_id):
            return jsonify({'error': 'Invalid review id'}), 400

        review = db.reviews.find_one({'_id': ObjectId(review_id)})
        if not review:
            return jsonify({'error': 'Review not found'}), 404

        if review.get('user_id') != request.user_id:
            return jsonify({'error': 'You can only delete your own review'}), 403

        db.reviews.delete_one({'_id': ObjectId(review_id)})
        return jsonify({'message': 'Review deleted successfully'}), 200
    except Exception as e:
        print(f"Delete review error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# GET /api/admin/reviews  – admin data-table view
# ---------------------------------------------------------------------------
@reviews_bp.route('/admin/reviews', methods=['GET'])
@token_required
def admin_get_reviews():
    """Paginated list of all reviews for admin dashboard."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        # Verify admin
        admin_user = db.users.find_one({'email': request.user_email, 'role': 'admin'})
        if not admin_user:
            return jsonify({'error': 'Admin access required'}), 403

        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
        search = (request.args.get('search', '') or '').strip()
        rating_filter = request.args.get('rating')
        sort_by = request.args.get('sort', 'created_at')
        sort_dir = -1 if request.args.get('order', 'desc') == 'desc' else 1

        query = {}
        if rating_filter and rating_filter.isdigit():
            query['rating'] = int(rating_filter)

        total = db.reviews.count_documents(query)
        reviews_cursor = (
            db.reviews.find(query)
            .sort(sort_by, sort_dir)
            .skip((page - 1) * per_page)
            .limit(per_page)
        )

        reviews = []
        for r in reviews_cursor:
            uid = r.get('user_id') or r.get('user')
            pid = r.get('product_id') or r.get('product')
            user_doc = None
            product_doc = None

            if uid:
                try:
                    user_doc = db.users.find_one({'_id': ObjectId(uid)}) if ObjectId.is_valid(str(uid)) else None
                except Exception:
                    pass
                if not user_doc:
                    user_doc = db.users.find_one({'id': str(uid)})

            if pid:
                try:
                    product_doc = db.products.find_one({'_id': ObjectId(pid)}) if ObjectId.is_valid(str(pid)) else None
                except Exception:
                    pass

            user_name = f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip() if user_doc else 'Unknown'
            user_email_val = user_doc.get('email', '') if user_doc else ''
            product_name = product_doc.get('name', 'Unknown') if product_doc else 'Unknown'

            # Apply text search filter (match user name, email, product name, or comment)
            if search:
                search_lower = search.lower()
                match = (
                    search_lower in user_name.lower()
                    or search_lower in user_email_val.lower()
                    or search_lower in product_name.lower()
                    or search_lower in (r.get('comment', '') or '').lower()
                )
                if not match:
                    total -= 1
                    continue

            reviews.append({
                'id': str(r['_id']),
                'user_id': str(uid) if uid else None,
                'user_name': user_name,
                'user_email': user_email_val,
                'user_profile_picture': user_doc.get('profile_picture') if user_doc else None,
                'product_id': str(pid) if pid else None,
                'product_name': product_name,
                'rating': r.get('rating', 0),
                'comment': r.get('comment', ''),
                'updated_at': r['updated_at'].isoformat() if r.get('updated_at') else None,
                'created_at': r['created_at'].isoformat() if r.get('created_at') else None,
            })

        # Compute overall stats
        all_ratings = [r.get('rating', 0) for r in db.reviews.find({}, {'rating': 1})]
        avg_rating = round(sum(all_ratings) / len(all_ratings), 1) if all_ratings else 0
        rating_dist = {i: all_ratings.count(i) for i in range(1, 6)}

        return jsonify({
            'reviews': reviews,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': max(1, -(-total // per_page)),
            'average_rating': avg_rating,
            'total_reviews': len(all_ratings),
            'rating_distribution': rating_dist,
        }), 200
    except Exception as e:
        print(f"Admin reviews error: {e}")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# DELETE /api/admin/reviews/<review_id>  – admin delete any review
# ---------------------------------------------------------------------------
@reviews_bp.route('/admin/reviews/<review_id>', methods=['DELETE'])
@token_required
def admin_delete_review(review_id):
    """Admin can delete any review."""
    try:
        db, _ = get_mongodb_db(reviews_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        admin_user = db.users.find_one({'email': request.user_email, 'role': 'admin'})
        if not admin_user:
            return jsonify({'error': 'Admin access required'}), 403

        if not ObjectId.is_valid(review_id):
            return jsonify({'error': 'Invalid review id'}), 400

        result = db.reviews.delete_one({'_id': ObjectId(review_id)})
        if result.deleted_count == 0:
            return jsonify({'error': 'Review not found'}), 404

        return jsonify({'message': 'Review deleted successfully'}), 200
    except Exception as e:
        print(f"Admin delete review error: {e}")
        return jsonify({'error': str(e)}), 500
