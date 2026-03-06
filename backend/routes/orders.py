"""
Order & checkout routes (template-rendered).
"""
import os
import uuid
from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, current_app
from flask_login import login_required, current_user

from db import get_mongodb_db, ensure_mongoengine_user
from helpers import send_system_email, build_email_html, generate_receipt_pdf
from paymongo import create_checkout_session, PayMongoError

orders_bp = Blueprint('orders', __name__)


def _get_paymongo_redirect_urls():
    base_url = request.host_url.rstrip('/')
    success_url = (os.environ.get('PAYMONGO_SUCCESS_URL') or '').strip() or f'{base_url}/orders'
    cancel_url = (os.environ.get('PAYMONGO_CANCEL_URL') or '').strip() or f'{base_url}/cart'
    return success_url, cancel_url


@orders_bp.route('/orders')
@login_required
def orders():
    orders_list = []
    try:
        from models import Order, Product, User as MEUser
        from bson import ObjectId

        me_user = ensure_mongoengine_user(current_user)
        if me_user and isinstance(me_user, MEUser) and ObjectId.is_valid(str(me_user.id)):
            orders_list = list(Order.objects(user=me_user).order_by('-created_at'))
    except Exception as e:
        print(f"Orders load error: {e}")

    try:
        db, _ = get_mongodb_db(orders_bp)
        if db is not None:
            pymongo_orders = list(db.orders.find({'user_id': current_user.id}).sort('created_at', -1))
            orders_list = list(orders_list) + pymongo_orders
    except Exception as e:
        print(f"PyMongo orders load error: {e}")

    return render_template('orders.html', orders=orders_list)


@orders_bp.route('/checkout', methods=['GET', 'POST'])
@login_required
def checkout():
    try:
        db, _ = get_mongodb_db(orders_bp)
        if db is None:
            flash('Database connection failed. Please try again.', 'error')
            return redirect(url_for('cart.cart'))

        cart_doc = db.carts.find_one({'user_id': current_user.id})
        if not cart_doc or not cart_doc.get('items'):
            flash('Your cart is empty.', 'warning')
            return redirect(url_for('cart.cart'))

        if request.method == 'GET':
            return redirect(url_for('cart.cart'))

        shipping_name = request.form.get('shipping_name', '').strip()
        shipping_phone = request.form.get('shipping_phone', '').strip()
        shipping_address = request.form.get('shipping_address', '').strip()
        payment_method = request.form.get('payment_method', '').strip()
        is_mobile_money = payment_method.lower() == 'mobile'

        if not shipping_name:
            user_doc = db.users.find_one({'email': current_user.email})
            if user_doc:
                shipping_name = f"{user_doc.get('first_name', '')} {user_doc.get('last_name', '')}".strip()

        if not shipping_phone:
            if 'user_doc' not in locals():
                user_doc = db.users.find_one({'email': current_user.email})
            if user_doc:
                shipping_phone = user_doc.get('phone', '')

        if not all([shipping_name, shipping_phone, shipping_address, payment_method]):
            flash('Please fill out all shipping details and payment method.', 'error')
            return redirect(url_for('cart.cart'))

        try:
            db.users.update_one(
                {'email': current_user.email},
                {'$set': {'shipping_address': shipping_address, 'updated_at': datetime.utcnow()}},
            )
        except Exception as e:
            print(f"Shipping info save error: {e}")

        order_items = []
        total_amount = 0
        
        selected_items = request.form.getlist('selected_items')

        for item in cart_doc['items']:
            product_id = item.get('product_id')
            
            if selected_items and product_id not in selected_items:
                continue
                
            qty = int(item.get('quantity', 1))

            product_data = None
            try:
                from bson import ObjectId
                product_data = db.products.find_one({'_id': ObjectId(product_id)})
            except Exception:
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
            flash('Unable to place order. Please try again.', 'error')
            return redirect(url_for('cart.cart'))

        from helpers import calculate_shipping_fee, calculate_bulk_discount
        
        total_items = sum(item['quantity'] for item in order_items)
        discount_rate, discount_amount = calculate_bulk_discount(total_items, total_amount)
        subtotal = total_amount - discount_amount
        
        shipping_fee = calculate_shipping_fee(shipping_address)
        final_total = subtotal + shipping_fee

        order_result = db.orders.insert_one({
            'user_id': current_user.id,
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
            'delivery_updates': [],
            'shipping_name': shipping_name,
            'shipping_phone': shipping_phone,
            'shipping_address': shipping_address,
            'payment_method': payment_method,
            'payment_status': 'pending' if is_mobile_money else 'unpaid',
            'payment_provider': 'paymongo' if is_mobile_money else None,
            'payment_channel': 'gcash' if is_mobile_money else None,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })

        if is_mobile_money:
            success_url, cancel_url = _get_paymongo_redirect_urls()
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
                    description=f'FarmtoClick Order {order_result.inserted_id}',
                    success_url=success_url,
                    cancel_url=cancel_url,
                    payment_method_types=['gcash', 'qrph'],
                    line_items=line_items,
                    metadata={'order_id': str(order_result.inserted_id), 'user_id': str(current_user.id)},
                    reference_number=str(order_result.inserted_id),
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
                return redirect(checkout['checkout_url'])
            except PayMongoError as exc:
                db.orders.update_one(
                    {'_id': order_result.inserted_id},
                    {'$set': {
                        'payment_status': 'failed',
                        'payment_error': str(exc),
                        'updated_at': datetime.utcnow(),
                    }},
                )
                flash('Unable to initialize mobile money payment.', 'error')
                return redirect(url_for('cart.cart'))

        try:
            oid = str(order_result.inserted_id)
            receipt_pdf = generate_receipt_pdf(oid, shipping_name, current_user.email, order_items, total_amount, discount_amount, shipping_fee, final_total)
            email_html = build_email_html(
                title="Order Confirmed",
                subtitle="Your order is pending seller approval",
                badge_text="PENDING APPROVAL",
                content_html=(
                    f"<p>Hi {shipping_name},</p>"
                    "<p>Your order has been confirmed and is pending seller approval.</p>"
                    f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                    f"<strong>Order ID:</strong> {oid}</div>"
                    "<p style='margin-top:12px;'>We will email you again once the seller approves your order.</p>"
                    "<p>Thank you for shopping with FarmtoClick.</p>"
                ),
            )
            send_system_email(
                current_app,
                current_user.email,
                "FarmtoClick Order Confirmed - Pending Approval",
                f"Order ID: {oid}\nTotal: {final_total}",
                html_body=email_html,
                attachments=[{
                    'filename': f"FarmtoClick-Receipt-{oid}.pdf",
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
            
        flash('Order placed successfully!', 'success')
        return redirect(url_for('orders.orders'))
    except Exception as e:
        print(f"Checkout error: {e}")
        flash('Checkout failed. Please try again.', 'error')
        return redirect(url_for('cart.cart'))


@orders_bp.route('/order/<order_id>/status', methods=['POST'])
@login_required
def update_order_status(order_id):
    if not (getattr(current_user, 'role', 'user') == 'farmer'):
        return jsonify({'success': False, 'message': 'Not authorized'}), 403

    new_status = request.form.get('status', '').strip().lower()
    status_reason = request.form.get('reason', '').strip()
    if new_status not in ('approved', 'rejected', 'confirmed', 'ready_for_ship', 'picked_up', 'on_the_way', 'delivered'):
        return jsonify({'success': False, 'message': 'Invalid status'}), 400
    if new_status == 'rejected' and not status_reason:
        return jsonify({'success': False, 'message': 'Rejection reason is required'}), 400

    try:
        db, _ = get_mongodb_db(orders_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        from bson import ObjectId
        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        if new_status == 'ready_for_ship' and order_doc.get('status') != 'approved':
            return jsonify({'success': False, 'message': 'Order must be approved before ready for ship'}), 400

        update_fields = {'status': new_status, 'updated_at': datetime.utcnow()}
        if new_status == 'rejected':
            update_fields['rejection_reason'] = status_reason

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
        })
        update_fields['delivery_updates'] = delivery_updates
        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

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

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        print(f"Order status update error: {e}")
        return jsonify({'success': False, 'message': 'Failed to update order'}), 500
