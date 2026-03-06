"""
Shared helpers, constants, and utility functions used across API route modules.
"""
import os
from datetime import datetime

from flask import request, jsonify, current_app

from db import get_mongodb_db
from helpers import generate_receipt_pdf, build_email_html, send_system_email

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # routes/api/ -> routes/ -> backend/
UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'profiles')
DELIVERY_PROOF_UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'delivery_proofs')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(DELIVERY_PROOF_UPLOAD_FOLDER, exist_ok=True)


# ---------------------------------------------------------------------------
# PayMongo helpers
# ---------------------------------------------------------------------------
def get_paymongo_redirect_urls():
    """Return (success_url, cancel_url) for PayMongo checkout sessions."""
    origin = (request.headers.get('Origin') or '').rstrip('/')
    success_url = (os.environ.get('PAYMONGO_SUCCESS_URL') or '').strip()
    cancel_url = (os.environ.get('PAYMONGO_CANCEL_URL') or '').strip()

    if not success_url and origin:
        success_url = f'{origin}/orders'
    if not cancel_url and origin:
        cancel_url = f'{origin}/cart'

    return success_url, cancel_url


def finalize_paid_order(db, order_doc):
    """Deduct stock, clear cart items, and send payment-confirmation email.
    
    Uses an atomic flag (`stock_deducted`) to ensure this only runs once per order,
    preventing double stock deduction from concurrent webhook/polling/confirm calls.
    """
    from bson import ObjectId

    order_id = order_doc.get('_id')
    if isinstance(order_id, str) and ObjectId.is_valid(order_id):
        order_id = ObjectId(order_id)

    # Atomically set the flag — only proceeds if not already finalized
    guard = db.orders.update_one(
        {'_id': order_id, 'stock_deducted': {'$ne': True}},
        {'$set': {'stock_deducted': True}}
    )
    if guard.matched_count == 0:
        # Already finalized by another code path — skip
        return

    items = order_doc.get('items', [])
    for item in items:
        product_id = item.get('product_id')
        qty = int(item.get('quantity', 1))
        if not product_id:
            continue
        try:
            if ObjectId.is_valid(str(product_id)):
                db.products.update_one(
                    {'_id': ObjectId(str(product_id)), 'quantity': {'$gte': qty}},
                    {'$inc': {'quantity': -qty}}
                )
            else:
                db.products.update_one(
                    {'id': str(product_id), 'quantity': {'$gte': qty}},
                    {'$inc': {'quantity': -qty}}
                )
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


def paymongo_session_paid(session):
    """Check if a PayMongo checkout session has been paid.
    Returns (is_paid: bool, payment_id: str | None)."""
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


# ---------------------------------------------------------------------------
# Delivery status helpers
# ---------------------------------------------------------------------------
def normalize_status_value(status):
    """Normalise an order / delivery status string to lowercase."""
    return str(status or 'pending').strip().lower()


def normalize_delivery_updates(updates, fallback_status='pending'):
    """Return a consistently-shaped list of delivery update dicts."""
    normalized = []
    for entry in (updates or []):
        if isinstance(entry, dict):
            status = normalize_status_value(entry.get('status') or fallback_status)
            updated_at = entry.get('updated_at') or entry.get('timestamp') or entry.get('time')
            normalized.append({
                'status': status,
                'updated_at': updated_at,
                'timestamp': updated_at,
                'description': entry.get('description'),
            })
            continue

        normalized.append({
            'status': normalize_status_value(entry or fallback_status),
            'updated_at': None,
            'timestamp': None,
            'description': None,
        })

    return normalized


def latest_delivery_update_at(delivery_updates):
    """Return the timestamp of the most recent delivery update, or None."""
    if not delivery_updates:
        return None
    latest = delivery_updates[-1]
    if isinstance(latest, dict):
        return latest.get('updated_at') or latest.get('timestamp') or latest.get('time')
    return None
