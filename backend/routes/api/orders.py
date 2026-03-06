"""
Order routes – list, create, tracking, status updates, rider assignment,
confirm-received, and GPS location endpoints.
"""
import os
import uuid
from datetime import datetime

from flask import request, jsonify, current_app, url_for
from werkzeug.utils import secure_filename
from bson import ObjectId

from db import get_mongodb_db
from middleware import token_required
from user_model import User
from helpers import (
    allowed_file, MAX_FILE_SIZE,
    send_system_email, build_email_html, generate_receipt_pdf,
    calculate_shipping_fee, calculate_bulk_discount,
)
from paymongo import create_checkout_session, PayMongoError, get_checkout_session
from . import api_bp
from ._helpers import (
    get_paymongo_redirect_urls,
    finalize_paid_order,
    paymongo_session_paid,
    normalize_status_value,
    normalize_delivery_updates,
    latest_delivery_update_at,
    DELIVERY_PROOF_UPLOAD_FOLDER,
)


# ------------------------------------------------------------------
# Get orders (buyer)
# ------------------------------------------------------------------
@api_bp.route('/orders', methods=['GET'])
@token_required
def api_get_orders():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        orders = list(db.orders.find({'user_id': request.user_id}).sort('created_at', -1))
        for order in orders:
            order['_id'] = str(order.get('_id'))
            order_status = normalize_status_value(order.get('delivery_status') or order.get('status'))
            order['delivery_status'] = order_status
            order.setdefault('delivery_tracking_id', None)
            order['delivery_updates'] = normalize_delivery_updates(order.get('delivery_updates', []), order_status)
            order['delivery_status_updated_at'] = (
                latest_delivery_update_at(order['delivery_updates'])
                or order.get('updated_at')
                or order.get('created_at')
            )
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
                        is_paid, payment_id = paymongo_session_paid(session)
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
                            finalize_paid_order(db, order)
                    except Exception:
                        pass
        return jsonify(orders)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Create order
# ------------------------------------------------------------------
@api_bp.route('/orders', methods=['POST'])
@token_required
def api_create_order():
    try:
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
                # Atomically deduct stock only if sufficient quantity exists
                result = db.products.update_one(
                    {'_id': product_data.get('_id'), 'quantity': {'$gte': qty}},
                    {'$inc': {'quantity': -qty}}
                )
                if result.matched_count == 0:
                    available = int(product_data.get('quantity', 0))
                    return jsonify({
                        'error': f'Insufficient stock for "{name}". '
                                 f'Available: {available}, requested: {qty}'
                    }), 400

        if not order_items:
            return jsonify({'error': 'Unable to place order. Please try again.'}), 400

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
                receipt_pdf = generate_receipt_pdf(
                    order_id, shipping_name, request.user_email,
                    order_items, total_amount, discount_amount, shipping_fee, final_total,
                )
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
                    {'$pull': {'items': {'product_id': {'$in': selected_items}}}},
                )
            else:
                db.carts.delete_one({'_id': cart_doc['_id']})

        if is_mobile_money:
            success_url, cancel_url = get_paymongo_redirect_urls()
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


# ------------------------------------------------------------------
# Customer confirms order received
# ------------------------------------------------------------------
@api_bp.route('/orders/<order_id>/confirm-received', methods=['POST'])
@token_required
def api_confirm_order_received(order_id):
    """Customer confirms they received the delivery."""
    try:
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


# ------------------------------------------------------------------
# Order tracking
# ------------------------------------------------------------------
@api_bp.route('/orders/<order_id>/tracking', methods=['GET'])
@token_required
def api_order_tracking(order_id):
    try:
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
        delivery_status = normalize_status_value(order_doc.get('delivery_status', order_doc.get('status', 'pending')))
        normalized_updates = normalize_delivery_updates(order_doc.get('delivery_updates', []), delivery_status)

        return jsonify({
            'order_id': str(order_doc.get('_id')),
            'delivery_status': delivery_status,
            'delivery_tracking_id': tracking_id,
            'delivery_proof_url': order_doc.get('delivery_proof_url'),
            'delivery_updates': normalized_updates,
            'delivery_status_updated_at': (
                latest_delivery_update_at(normalized_updates)
                or order_doc.get('updated_at')
                or order_doc.get('created_at')
            ),
            'logistics_provider': order_doc.get('logistics_provider', 'lalamove'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Farmer updates order status
# ------------------------------------------------------------------
@api_bp.route('/order/<order_id>/status', methods=['POST'])
@token_required
def api_update_order_status(order_id):
    try:
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
        update_fields['delivery_updates'] = normalize_delivery_updates(
            delivery_updates, update_fields.get('delivery_status', new_status)
        )

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


# ------------------------------------------------------------------
# Get active riders
# ------------------------------------------------------------------
@api_bp.route('/riders', methods=['GET'])
@token_required
def api_get_active_riders():
    try:
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


# ------------------------------------------------------------------
# Assign rider to order
# ------------------------------------------------------------------
@api_bp.route('/orders/<order_id>/assign-rider', methods=['POST'])
@token_required
def api_assign_order_rider(order_id):
    try:
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
        print(
            f"[AssignRider] Order {order_id} → Rider {rider_doc.get('name')} "
            f"(rider_id={str(rider_doc.get('_id'))}, rider_user_id={rider_doc.get('user_id', '')}, "
            f"rider_email={rider_doc.get('email', '')}) "
            f"matched={result.matched_count} modified={result.modified_count}"
        )

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
# Driver GPS location
# ------------------------------------------------------------------
@api_bp.route('/orders/<order_id>/location', methods=['POST'])
@token_required
def update_order_location(order_id):
    """Update the GPS location of the driver for a specific order."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        data = request.get_json()
        if not data or 'lat' not in data or 'lng' not in data:
            return jsonify({'error': 'Missing lat or lng'}), 400

        if not ObjectId.is_valid(order_id):
            return jsonify({'error': 'Invalid order ID'}), 400

        order = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order:
            return jsonify({'error': 'Order not found'}), 404

        # Only the assigned rider can update location
        assigned_rider_user_id = order.get('assigned_rider_user_id', '')
        if str(assigned_rider_user_id) != str(request.user_id):
            return jsonify({'error': 'Only the assigned rider can update location'}), 403

        location_data = {
            'lat': float(data['lat']),
            'lng': float(data['lng']),
            'updated_at': datetime.utcnow(),
        }

        db.orders.update_one(
            {'_id': ObjectId(order_id)},
            {'$set': {'driver_location': location_data}},
        )

        location_data['updated_at'] = location_data['updated_at'].isoformat() + 'Z'

        return jsonify({'message': 'Location updated successfully', 'location': location_data})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/orders/<order_id>/location', methods=['GET'])
@token_required
def get_order_location(order_id):
    """Get the latest GPS location of the driver for a specific order."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        if not ObjectId.is_valid(order_id):
            return jsonify({'error': 'Invalid order ID'}), 400

        order = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order:
            return jsonify({'error': 'Order not found'}), 404

        # Only the buyer or assigned rider can view location
        is_buyer = str(order.get('user_id', '')) == str(request.user_id)
        is_rider = str(order.get('assigned_rider_user_id', '')) == str(request.user_id)
        if not is_buyer and not is_rider:
            return jsonify({'error': 'Not authorized to view this order location'}), 403

        location = order.get('driver_location')
        if not location:
            return jsonify({'message': 'Location not available yet', 'location': None}), 404

        if 'updated_at' in location and isinstance(location['updated_at'], datetime):
            location['updated_at'] = location['updated_at'].isoformat() + 'Z'

        return jsonify({'location': location})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
