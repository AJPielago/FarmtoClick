"""
Payment routes – PayMongo confirm and webhook.
"""
from datetime import datetime

from flask import request, jsonify
from bson import ObjectId

from db import get_mongodb_db
from middleware import token_required
from paymongo import PayMongoError, verify_webhook_signature, get_checkout_session
from . import api_bp
from ._helpers import (
    paymongo_session_paid,
    finalize_paid_order,
)


# ------------------------------------------------------------------
# Confirm PayMongo payment
# ------------------------------------------------------------------
@api_bp.route('/paymongo/confirm', methods=['POST'])
@token_required
def api_paymongo_confirm():
    try:
        data = request.get_json() or {}
        order_id = (data.get('order_id') or '').strip()
        if not order_id:
            return jsonify({'error': 'Order id is required'}), 400

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        order_filter = {'_id': ObjectId(order_id)} if ObjectId.is_valid(order_id) else {'_id': order_id}
        order_doc = db.orders.find_one(order_filter)
        if not order_doc:
            return jsonify({'error': 'Order not found'}), 404

        if order_doc.get('user_id') != request.user_id:
            return jsonify({'error': 'Not authorized'}), 403

        if order_doc.get('payment_provider') != 'paymongo':
            return jsonify({'error': 'Order is not PayMongo'}), 400

        if order_doc.get('payment_status') == 'paid':
            return jsonify({'status': 'paid'}), 200

        checkout_id = order_doc.get('paymongo_checkout_id')
        if not checkout_id:
            return jsonify({'error': 'Checkout session not found'}), 400

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
            db.orders.update_one(order_filter, {'$set': update_fields})
            finalize_paid_order(db, order_doc)
            return jsonify({'status': 'paid'}), 200

        return jsonify({'status': 'pending'}), 200
    except PayMongoError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# PayMongo webhook
# ------------------------------------------------------------------
@api_bp.route('/paymongo/webhook', methods=['POST'])
def api_paymongo_webhook():
    try:
        payload_raw = request.get_data() or b''
        signature_header = (
            request.headers.get('Paymongo-Signature')
            or request.headers.get('PayMongo-Signature')
            or request.headers.get('paymongo-signature')
            or ''
        )
        try:
            if not verify_webhook_signature(payload_raw, signature_header):
                return jsonify({'error': 'Invalid signature'}), 401
        except PayMongoError:
            return jsonify({'error': 'Webhook secret not configured'}), 401

        payload = request.get_json(silent=True) or {}
        event = payload.get('data', {}).get('attributes', {})
        event_type = (event.get('type') or '').lower()

        data_payload = event.get('data', {})
        data_attrs = data_payload.get('attributes', {})

        metadata = {}
        if isinstance(data_attrs.get('metadata'), dict):
            metadata = data_attrs.get('metadata')
        elif isinstance(data_attrs.get('source', {}), dict):
            metadata = data_attrs.get('source', {}).get('metadata', {}) or {}

        order_id = metadata.get('order_id') or metadata.get('orderId')
        if not order_id:
            return jsonify({'received': True}), 200

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        order_filter = {'_id': ObjectId(order_id)} if ObjectId.is_valid(str(order_id)) else {'_id': order_id}
        order_doc = db.orders.find_one(order_filter)
        if not order_doc:
            return jsonify({'received': True}), 200

        update_fields = {'updated_at': datetime.utcnow()}
        if event_type in ('payment.paid', 'checkout_session.payment.paid'):
            if order_doc.get('payment_status') == 'paid':
                return jsonify({'received': True}), 200
            update_fields['payment_status'] = 'paid'
            update_fields['paymongo_payment_id'] = data_payload.get('id')
            update_fields['paid_at'] = datetime.utcnow()
            db.orders.update_one(order_filter, {'$set': update_fields})
            finalize_paid_order(db, order_doc)
        elif event_type in ('payment.failed', 'payment.expired', 'checkout_session.payment.failed'):
            update_fields['payment_status'] = 'failed'
            update_fields['payment_failed_at'] = datetime.utcnow()
            db.orders.update_one(order_filter, {'$set': update_fields})

        return jsonify({'received': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
