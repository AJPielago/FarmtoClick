"""
Farmer-related routes: farmer listing, profile, verification,
start selling, dashboard, manage products.
"""
import os
import uuid
from datetime import datetime

from flask import Blueprint, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
import cloudinary
import cloudinary.uploader

from db import get_mongodb_db, ensure_mongoengine_user
from helpers import allowed_file, MAX_FILE_SIZE
from middleware import token_required

farmers_bp = Blueprint('farmers', __name__)

# Upload folders (relative to this file's directory)
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_BASE_DIR)  # routes/ -> backend/
UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'profiles')
VERIFICATION_UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'verifications')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(VERIFICATION_UPLOAD_FOLDER, exist_ok=True)


# ------------------------------------------------------------------
# Farmer listing
# ------------------------------------------------------------------
@farmers_bp.route('/farmers')
def farmers():
    """List all verified farmers."""
    try:
        db, _ = get_mongodb_db(farmers_bp)
        if db is None:
            return jsonify([])

        farmers_list = list(db.users.find({'role': 'farmer'}))
        for f in farmers_list:
            f['_id'] = str(f['_id'])
            f['id'] = f.get('id') or f['_id']
            # Compute product count for this farmer across possible product fields
            try:
                or_filters = []
                # common id/email references used in products
                if f.get('id'):
                    or_filters.extend([
                        {'farmer': f['id']},
                        {'farmer_user_id': f['id']},
                        {'farmer_id': f['id']},
                        {'farmerId': f['id']},
                        {'seller_id': f['id']},
                        {'sellerId': f['id']},
                        {'farmer.id': f['id']},
                    ])
                if f.get('_id'):
                    or_filters.append({'farmer': f['_id']})
                if f.get('email'):
                    or_filters.extend([
                        {'farmer_email': f.get('email')},
                        {'farmer.email': f.get('email')},
                    ])
                # Try adding ObjectId forms if available
                try:
                    from bson import ObjectId
                    if f.get('_id') and ObjectId.is_valid(str(f.get('_id'))):
                        or_filters.append({'farmer': ObjectId(str(f.get('_id')))})
                        or_filters.append({'farmer._id': ObjectId(str(f.get('_id')))})
                except Exception:
                    pass

                if or_filters:
                    try:
                        # Use find + len(list(...)) to match how products are queried elsewhere
                        prods = list(db.products.find({'$and': [{'available': True}, {'$or': or_filters}]}))
                        f['product_count'] = len(prods)
                    except Exception:
                        f['product_count'] = 0
                else:
                    f['product_count'] = 0
            except Exception:
                f['product_count'] = 0
        return jsonify(farmers_list)
    except Exception as e:
        print(f"Farmers listing error: {e}")
        return jsonify([])


# ------------------------------------------------------------------
# Farmer public profile
# ------------------------------------------------------------------
@farmers_bp.route('/farmer/<farmer_id>')
def farmer_profile(farmer_id):
    try:
        db, _ = get_mongodb_db(farmers_bp)
        if db is None:
            return "Database connection failed", 503

        # Try lookup by UUID 'id' field first, then fall back to MongoDB _id
        farmer = db.users.find_one({'id': farmer_id, 'role': 'farmer'})
        if not farmer:
            try:
                from bson import ObjectId
                if ObjectId.is_valid(farmer_id):
                    farmer = db.users.find_one({'_id': ObjectId(farmer_id), 'role': 'farmer'})
            except Exception:
                pass
        if not farmer:
            return jsonify({'error': 'Farmer not found'}), 404

        farmer['_id'] = str(farmer['_id'])

        farmer_or_filters = [
            {'farmer': farmer_id},
            {'farmer_user_id': farmer_id},
            {'farmer_email': farmer.get('email')},
        ]
        try:
            from bson import ObjectId
            if ObjectId.is_valid(str(farmer_id)):
                farmer_or_filters.append({'farmer': ObjectId(str(farmer_id))})
        except Exception:
            pass

        farmer_products = list(
            db.products.find({'$or': farmer_or_filters, 'available': True}).sort('created_at', -1)
        )
        for prod in farmer_products:
            prod['_id'] = str(prod['_id'])
            prod['id'] = prod.get('id') or prod['_id']

        return jsonify({'farmer': farmer, 'products': farmer_products})
    except Exception as e:
        print(f"Farmer profile error: {e}")
        return jsonify({'error': 'Farmer not found'}), 404


# ------------------------------------------------------------------
# Farmer verification (permit upload)
# ------------------------------------------------------------------
@farmers_bp.route('/farmer/verify', methods=['GET'])
@login_required
def farmer_verify_form():
    return {"message": "Farmer verification form is handled by React frontend", "status": "api_only"}, 200


@farmers_bp.route('/farmer/verify', methods=['POST'])
@token_required
def farmer_verify():
    from flask import current_app
    from user_model import User
    
    permit_file = request.files.get('business_permit_photo')

    if not permit_file or not permit_file.filename:
        return jsonify({'error': 'Please upload a business permit image for verification.'}), 400

    if not allowed_file(permit_file.filename):
        return jsonify({'error': 'Invalid file type. Please upload JPG or PNG image.'}), 400

    permit_file.seek(0, os.SEEK_END)
    file_size = permit_file.tell()
    permit_file.seek(0)
    if file_size > MAX_FILE_SIZE:
        return jsonify({'error': 'Verification image must be less than 5MB.'}), 400

    permit_filename = secure_filename(permit_file.filename)
    permit_unique = f"permit_{uuid.uuid4().hex}_{permit_filename}"
    permit_path = os.path.join(VERIFICATION_UPLOAD_FOLDER, permit_unique)
    permit_file.save(permit_path)

    try:
        db, _ = get_mongodb_db(farmers_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed. Please try again.'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user:
            return jsonify({'error': 'User not found.'}), 404

        # Collect name fields for cross-verification against DTI
        permit_business_name = request.form.get('permit_business_name', '').strip()
        permit_owner_name = request.form.get('permit_owner_name', '').strip()
        
        if not (getattr(user, 'role', 'user') == 'farmer'):
            user.farm_name = permit_business_name
            user.farm_location = request.form.get('farm_location', '').strip()
            user.farm_description = request.form.get('farm_description', '').strip()
            user.farm_phone = request.form.get('farm_phone', '').strip()
            user.exact_address = request.form.get('exact_address', '').strip()
            user.farmer_application_status = 'pending'
            user.farmer_application_submitted_at = datetime.utcnow()

        user.permit_business_name = permit_business_name
        user.permit_owner_name = permit_owner_name

        # Fall back to user's full name if owner name field was left blank
        if not permit_owner_name:
            permit_owner_name = f"{user.first_name} {user.last_name}".strip()

        user.business_verification_status = 'pending'
        user.business_verification_image = permit_unique
        user.business_verification_submitted_at = datetime.utcnow()

        verifier = current_app.config.get('VERIFIER')
        if verifier:
            ml_result = verifier.verify_permit_image(
                permit_path,
                user_business_name=permit_business_name or user.farm_name,
                user_owner_name=permit_owner_name,
            )
            user.business_verification_ml = ml_result
            verifier.save_verification_record(
                str(user.id), 
                ml_result,
                db=db,
                user_obj=user,
                permit_business_name=permit_business_name,
                permit_owner_name=permit_owner_name,
                image_filename=permit_unique,
                image_path=permit_path
            )

            # Store QR data and business info if available
            user.permit_qr_data = ml_result.get('qr_data', '')
            user.permit_extracted_text = ml_result.get('extracted_text', '')
            if ml_result.get('business_info'):
                user.dti_business_info = ml_result['business_info']
            if ml_result.get('ml_prediction'):
                user.ml_prediction = ml_result['ml_prediction']
            if ml_result.get('name_verification'):
                user.name_verification = ml_result['name_verification']

            # Binary outcome: ACCEPT or REJECT
            # Only accept if ML validation explicitly passes (valid=True)
            # Don't accept based on confidence alone
            if ml_result.get('valid'):
                # ACCEPT: User becomes farmer
                user.business_verification_status = 'verified'
                user.role = 'farmer'
                
                accept_details = []
                if ml_result.get('valid'):
                    accept_details.append('DTI verification passed')
                    if ml_result.get('dti_validation', {}).get('business_name'):
                        accept_details.append(f"Business: {ml_result['dti_validation']['business_name']}")
                    if ml_result.get('dti_validation', {}).get('owner_name'):
                        accept_details.append(f"Owner: {ml_result['dti_validation']['owner_name']}")
                
                ml_pred = ml_result.get('ml_prediction', {})
                if ml_pred.get('available') and ml_pred.get('is_permit'):
                    accept_details.append(f"ML confidence: {ml_pred['confidence']:.0%}")
                
                nv = ml_result.get('name_verification', {})
                if nv and nv.get('overall_match') and nv.get('score', 0) > 0.5:
                    accept_details.append(f"Name match: {nv['score']:.0%}")
                
                user.save(db)
                details_str = ' | '.join(accept_details) if accept_details else ''
                return jsonify({
                    'status': 'verified',
                    'message': f'✅ Business permit accepted! {details_str} You are now a verified farmer.',
                    'confidence': ml_result.get('confidence', 0),
                    'confidence_percentage': f"{int(ml_result.get('confidence', 0) * 100)}%",
                    'user': {
                        'id': str(user.id),
                        'role': user.role,
                        'email': user.email,
                    }
                }), 200
            else:
                # REJECT: Clear reason provided to user
                pv = ml_result.get('permit_validation', {})
                reason = pv.get('message', 'Permit document not recognized')
                
                user.business_verification_status = 'rejected'
                user.save(db)
                
                return jsonify({
                    'status': 'rejected',
                    'message': f'❌ Permit verification failed: {reason}. Please verify you uploaded a clear image of a valid business permit and try again.',
                    'confidence': ml_result.get('confidence', 0),
                    'confidence_percentage': f"{int(ml_result.get('confidence', 0) * 100)}%",
                }), 400
        else:
            # No verifier available - REJECT since we can't verify
            user.business_verification_status = 'rejected'
            user.save(db)
            return jsonify({
                'status': 'error',
                'message': '❌ Unable to process permit verification at this time. Please try again later or contact support.',
            }), 503

    except Exception as e:
        print(f"Verification error: {e}")
        return jsonify({'error': f'Verification failed: {str(e)}'}), 500


# ------------------------------------------------------------------
# Start selling
# ------------------------------------------------------------------
@farmers_bp.route('/start-selling', methods=['GET', 'POST'])
@login_required
def start_selling():
    try:
        from user_model import User

        db, _ = get_mongodb_db(farmers_bp)
        if db is None:
            flash('Database connection failed. Please try again.', 'error')
            return redirect('/profile')

        user = User.get_by_email(db, current_user.email)
        if not user:
            flash('User not found. Please log in again.', 'error')
            return redirect('/auth/logout')

        if user.role == 'farmer':
            return redirect('/farmer-dashboard')

        if request.method == 'GET':
            return jsonify({'message': 'Start selling form is handled by React frontend', 'status': 'api_only'})

        user.role = 'farmer'
        if not getattr(user, 'farm_name', None):
            full_name = f"{user.first_name} {user.last_name}".strip()
            user.farm_name = f"{full_name} Farm" if full_name else "My Farm"

        user.save(db)
        flash('Seller account activated! You can now start selling.', 'success')
        return redirect('/farmer-dashboard')
    except Exception as e:
        print(f"Start selling error: {e}")
        flash('Unable to activate seller account right now. Please try again.', 'error')
        return redirect('/profile')


# ------------------------------------------------------------------
# Farmer dashboard
# ------------------------------------------------------------------
@farmers_bp.route('/farmer-dashboard', methods=['GET'])
@login_required
def farmer_dashboard():
    if not (getattr(current_user, 'role', 'user') == 'farmer'):
        flash('Activate your seller account to access My Shop.', 'info')
        return redirect('/profile')

    try:
        from models import Product
        me_farmer = ensure_mongoengine_user(current_user)

        # --- products for this farmer ---
        try:
            db, _ = get_mongodb_db(farmers_bp)
            if db is not None:
                farmer_id_candidates = {str(current_user.id), str(current_user.email)}
                farmer_object_ids = []
                if me_farmer and getattr(me_farmer, 'id', None):
                    farmer_id_candidates.add(str(me_farmer.id))
                    try:
                        from bson import ObjectId
                        if ObjectId.is_valid(str(me_farmer.id)):
                            farmer_object_ids.append(ObjectId(str(me_farmer.id)))
                    except Exception:
                        pass

                user_doc = db.users.find_one({'email': current_user.email})
                if user_doc and user_doc.get('_id'):
                    farmer_object_ids.append(user_doc['_id'])
                if user_doc and user_doc.get('id'):
                    farmer_id_candidates.add(str(user_doc['id']))

                or_filters = [
                    {'farmer': {'$in': list(farmer_id_candidates)}},
                    {'farmer_user_id': str(current_user.id)},
                    {'farmer_email': current_user.email},
                    {'farmer_id': str(current_user.id)},
                    {'farmerId': str(current_user.id)},
                    {'seller_id': str(current_user.id)},
                    {'sellerId': str(current_user.id)},
                    {'farmer.id': str(current_user.id)},
                    {'farmer.email': current_user.email},
                ]
                if user_doc and user_doc.get('_id'):
                    or_filters.append({'farmer._id': user_doc['_id']})
                if farmer_object_ids:
                    or_filters.append({'farmer': {'$in': farmer_object_ids}})

                products_cursor = db.products.find({'$or': or_filters}).sort('created_at', -1)
                my_products = list(products_cursor)

                if not my_products:
                    fallback_products = list(db.products.find().sort('created_at', -1))

                    def _matches(prod):
                        fv = prod.get('farmer')
                        if str(fv) in farmer_id_candidates:
                            return True
                        if fv in farmer_object_ids:
                            return True
                        if isinstance(fv, dict):
                            if str(fv.get('id')) in farmer_id_candidates:
                                return True
                            if fv.get('email') == current_user.email:
                                return True
                            if fv.get('_id') in farmer_object_ids:
                                return True
                        for key in ('farmer_user_id', 'farmer_id', 'farmerId', 'seller_id', 'sellerId'):
                            if prod.get(key) == str(current_user.id):
                                return True
                        if prod.get('farmer_email') == current_user.email:
                            return True
                        return False

                    my_products = [p for p in fallback_products if _matches(p)]

                for prod in my_products:
                    prod['_id'] = str(prod['_id'])
            else:
                my_products = []
        except Exception as prod_error:
            print(f"Product query failed: {prod_error}")
            my_products = []

        # --- seller orders ---
        seller_orders = []
        try:
            db, _ = get_mongodb_db(farmers_bp)
            if db is not None:
                farmer_id_str = str(current_user.id)
                product_cache = {}

                def _get_product(pid):
                    if pid in product_cache:
                        return product_cache[pid]
                    doc = None
                    try:
                        from bson import ObjectId
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
                        if pdoc.get('farmer') != farmer_id_str and pdoc.get('farmer_user_id') != farmer_id_str:
                            continue
                        order_items.append({
                            'name': item.get('name', pdoc.get('name', 'Product')),
                            'quantity': item.get('quantity', 1),
                            'price': item.get('price', pdoc.get('price', 0)),
                        })

                    if order_items:
                        buyer = db.users.find_one({'id': order_doc.get('user_id')})
                        seller_orders.append({
                            'id': str(order_doc['_id']),
                            'status': order_doc.get('status', 'pending'),
                            'created_at': order_doc.get('created_at'),
                            'buyer_name': (buyer.get('first_name') if buyer else 'Customer'),
                            'buyer_email': (buyer.get('email') if buyer else ''),
                            'payment_method': order_doc.get('payment_method'),
                            'delivery_proof_url': order_doc.get('delivery_proof_url'),
                            'shipping_name': order_doc.get('shipping_name'),
                            'shipping_phone': order_doc.get('shipping_phone'),
                            'shipping_address': order_doc.get('shipping_address'),
                            'delivery_address': order_doc.get('delivery_address'),
                            'delivery_notes': order_doc.get('delivery_notes'),
                            'assigned_rider_id': order_doc.get('assigned_rider_id'),
                            'assigned_rider_name': order_doc.get('assigned_rider_name'),
                            'assigned_rider_phone': order_doc.get('assigned_rider_phone'),
                            'assigned_rider_barangay': order_doc.get('assigned_rider_barangay'),
                            'assigned_rider_city': order_doc.get('assigned_rider_city'),
                            'assigned_rider_province': order_doc.get('assigned_rider_province'),
                            'items': order_items,
                        })
        except Exception as oe:
            print(f"Seller orders load error: {oe}")

        return jsonify({'products': my_products, 'seller_orders': seller_orders})
    except Exception as e:
        print(f"Farmer dashboard error: {e}")
        return jsonify({'products': [], 'seller_orders': [], 'error': str(e)})


# ------------------------------------------------------------------
# Manage products (add / edit / delete)
# ------------------------------------------------------------------
@farmers_bp.route('/manage-products', methods=['GET', 'POST'])
@login_required
def manage_products():
    if not (getattr(current_user, 'role', 'user') == 'farmer'):
        flash('Activate your seller account to manage products.', 'info')
        return redirect('/profile')

    if request.method == 'POST':
        try:
            name = request.form.get('name', '').strip()
            description = request.form.get('description', '').strip()
            category = request.form.get('category', '').strip()
            unit = request.form.get('unit', '').strip()
            price_raw = request.form.get('price', '').strip()
            quantity_raw = request.form.get('quantity', '').strip()
            available = request.form.get('available') in ('on', 'true', '1', 'yes')

            if not name or not description or not category or not unit:
                flash('Name, description, category, and unit are required.', 'error')
                return redirect('/manage-products')

            try:
                price = float(price_raw)
            except Exception:
                flash('Price must be a number.', 'error')
                return redirect('/manage-products')
            try:
                quantity = int(quantity_raw)
            except Exception:
                flash('Quantity must be a whole number.', 'error')
                return redirect('/manage-products')

            if price <= 0:
                flash('Price must be greater than 0.', 'error')
                return redirect('/manage-products')
            if quantity < 0:
                flash('Quantity cannot be negative.', 'error')
                return redirect('/manage-products')

            image_url = None
            image_file = request.files.get('image')
            if image_file and image_file.filename:
                if not allowed_file(image_file.filename):
                    flash('Invalid product image type. Please upload a JPG, PNG, or GIF.', 'error')
                    return redirect('/manage-products')
                image_file.seek(0, os.SEEK_END)
                fsize = image_file.tell()
                image_file.seek(0)
                if fsize > MAX_FILE_SIZE:
                    flash('Product image is too large (max 5 MB).', 'error')
                    return redirect('/manage-products')

                # Upload to Cloudinary
                try:
                    upload_res = cloudinary.uploader.upload(
                        image_file,
                        folder='farmtoclick/products',
                        resource_type='image'
                    )
                    image_url = upload_res.get('secure_url')
                except Exception as e:
                    print(f"Cloudinary upload failed: {e}")
                    flash('Failed to upload product image. Please try again.', 'error')
                    return redirect('/manage-products')

            me_farmer = ensure_mongoengine_user(current_user)
            if not me_farmer:
                flash('Unable to load your farmer profile. Please re-login.', 'error')
                return redirect('/manage-products')

            db, _ = get_mongodb_db(farmers_bp)
            if db is None:
                raise Exception("Database connection failed")

            db.products.insert_one({
                'name': name,
                'description': description,
                'price': price,
                'quantity': quantity,
                'unit': unit,
                'category': category,
                'available': available,
                'image_url': image_url,
                'farmer': str(me_farmer.id),
                'farmer_user_id': str(current_user.id),
                'farmer_email': current_user.email,
                'created_at': datetime.utcnow(),
            })

            flash('Product added successfully!', 'success')
            return redirect('/manage-products')
        except Exception as e:
            print(f"Add product error: {e}")
            flash('Failed to add product. Please try again.', 'error')
            return redirect('/manage-products')

    # GET – show existing products
    try:
        me_farmer = ensure_mongoengine_user(current_user)
        if not me_farmer:
            flash('Unable to load your farmer profile. Please re-login.', 'error')
            return redirect('/profile')

        db, _ = get_mongodb_db(farmers_bp)
        if db is not None:
            farmer_id_str = str(current_user.id)
            my_products = list(db.products.find({'farmer': farmer_id_str}).sort('created_at', -1))
            for prod in my_products:
                prod['_id'] = str(prod.get('_id'))
                prod['id'] = prod.get('id') or prod['_id']
        else:
            my_products = []

        return jsonify({'products': my_products})
    except Exception as e:
        print(f"Manage products error: {e}")
        return jsonify({'products': []})


@farmers_bp.route('/manage-products/<product_id>/edit', methods=['POST'])
@login_required
def edit_manage_product(product_id):
    if not (getattr(current_user, 'role', 'user') == 'farmer'):
        flash('Activate your seller account to manage products.', 'info')
        return redirect('/profile')

    try:
        name = request.form.get('name', '').strip()
        description = request.form.get('description', '').strip()
        category = request.form.get('category', '').strip()
        unit = request.form.get('unit', '').strip()
        price_raw = request.form.get('price', '').strip()
        quantity_raw = request.form.get('quantity', '').strip()
        available = request.form.get('available') in ('on', 'true', '1', 'yes')

        if not name or not description or not category or not unit:
            flash('Name, description, category, and unit are required.', 'error')
            return redirect('/manage-products')

        try:
            price = float(price_raw)
        except Exception:
            flash('Price must be a number.', 'error')
            return redirect('/manage-products')
        try:
            quantity = int(quantity_raw)
        except Exception:
            flash('Quantity must be a whole number.', 'error')
            return redirect('/manage-products')
        if price <= 0:
            flash('Price must be greater than 0.', 'error')
            return redirect('/manage-products')
        if quantity < 0:
            flash('Quantity cannot be negative.', 'error')
            return redirect('/manage-products')

        db, _ = get_mongodb_db(farmers_bp)
        if db is None:
            flash('Database connection failed.', 'error')
            return redirect('/manage-products')

        from bson import ObjectId
        farmer_id_str = str(current_user.id)
        query = {'farmer': farmer_id_str}
        if ObjectId.is_valid(product_id):
            query['_id'] = ObjectId(product_id)
        else:
            query['id'] = product_id

        product_doc = db.products.find_one(query)
        if not product_doc:
            flash('Product not found or not authorized.', 'error')
            return redirect('/manage-products')

        update_doc = {
            'name': name,
            'description': description,
            'category': category,
            'unit': unit,
            'price': price,
            'quantity': quantity,
            'available': available,
            'updated_at': datetime.utcnow(),
        }

        image_file = request.files.get('image')
        if image_file and image_file.filename:
            if not allowed_file(image_file.filename):
                flash('Invalid product image type.', 'error')
                return redirect('/manage-products')
            image_file.seek(0, os.SEEK_END)
            fsize = image_file.tell()
            image_file.seek(0)
            if fsize > MAX_FILE_SIZE:
                flash('Product image is too large (max 5 MB).', 'error')
                return redirect('/manage-products')

            # upload updated image to Cloudinary
            try:
                upload_res = cloudinary.uploader.upload(
                    image_file,
                    folder='farmtoclick/products',
                    resource_type='image'
                )
                update_doc['image_url'] = upload_res.get('secure_url')
            except Exception as e:
                print(f"Cloudinary upload failed: {e}")
                flash('Failed to upload product image. Please try again.', 'error')
                return redirect('/manage-products')

        db.products.update_one(query, {'$set': update_doc})
        flash('Product updated successfully!', 'success')
        return redirect('/manage-products')
    except Exception as e:
        print(f"Edit product error: {e}")
        flash('Failed to update product. Please try again.', 'error')
        return redirect('/manage-products')


@farmers_bp.route('/products/<product_id>', methods=['DELETE'])
@login_required
def delete_product(product_id):
    if not (getattr(current_user, 'role', 'user') == 'farmer'):
        return {'error': 'Unauthorized'}, 403

    try:
        from models import Product
        me_farmer = ensure_mongoengine_user(current_user)
        if not me_farmer:
            return {'error': 'Unable to load farmer profile'}, 500

        product = Product.objects(id=product_id, farmer=me_farmer).first()
        if not product:
            return {'error': 'Product not found or unauthorized'}, 404

        product.delete()
        return {'success': True}, 200
    except Exception as e:
        print(f"Delete product error: {e}")
        return {'error': 'Failed to delete product'}, 500
