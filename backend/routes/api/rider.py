"""
Rider routes – dashboard, orders, accept, status, route-map.
"""
import math
import os
import uuid
from datetime import datetime, timedelta

from flask import request, jsonify, current_app, url_for
from bson import ObjectId
from werkzeug.utils import secure_filename

from db import get_mongodb_db
from middleware import token_required
from user_model import User
from helpers import allowed_file, MAX_FILE_SIZE, build_email_html, send_system_email
from . import api_bp
from ._helpers import (
    normalize_status_value,
    normalize_delivery_updates,
    latest_delivery_update_at,
    DELIVERY_PROOF_UPLOAD_FOLDER,
)


# ===================================================================
# Geo / TSP helpers (private to this module)
# ===================================================================

def _geocode_address(address, db=None):
    """Geocode an address string to (lat, lng) using the Nominatim API.
    Caches results in MongoDB collection ``geocode_cache`` to respect rate limits."""
    import requests as _requests
    import time

    if not address or not address.strip():
        return None

    address = address.strip()

    # Try cache first
    if db is not None:
        cached = db.geocode_cache.find_one({'address': address})
        if cached:
            return (cached['lat'], cached['lng'])

    try:
        resp = _requests.get(
            'https://nominatim.openstreetmap.org/search',
            params={'q': address, 'format': 'json', 'limit': 1},
            headers={'User-Agent': 'FarmtoClick/1.0'},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
        if results:
            lat = float(results[0]['lat'])
            lng = float(results[0]['lon'])
            if db is not None:
                db.geocode_cache.update_one(
                    {'address': address},
                    {'$set': {'address': address, 'lat': lat, 'lng': lng, 'cached_at': datetime.utcnow()}},
                    upsert=True,
                )
            return (lat, lng)
    except Exception as e:
        print(f"[Geocode] Failed for '{address}': {e}")

    # Retry with less specific address (remove first part before comma)
    parts = [p.strip() for p in address.split(',') if p.strip()]
    if len(parts) > 1:
        shorter = ', '.join(parts[1:])
        try:
            time.sleep(1)  # Nominatim rate limit
            resp = _requests.get(
                'https://nominatim.openstreetmap.org/search',
                params={'q': shorter, 'format': 'json', 'limit': 1},
                headers={'User-Agent': 'FarmtoClick/1.0'},
                timeout=10,
            )
            resp.raise_for_status()
            results = resp.json()
            if results:
                lat = float(results[0]['lat'])
                lng = float(results[0]['lon'])
                if db is not None:
                    db.geocode_cache.update_one(
                        {'address': address},
                        {'$set': {'address': address, 'lat': lat, 'lng': lng, 'cached_at': datetime.utcnow()}},
                        upsert=True,
                    )
                return (lat, lng)
        except Exception:
            pass

    return None


def _haversine(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance (km) between two points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _solve_tsp_nearest_neighbour(points, start_idx=0):
    """Solve TSP with nearest-neighbour heuristic.
    ``points`` is a list of (lat, lng).
    Returns an ordered list of indices."""
    n = len(points)
    if n <= 1:
        return list(range(n))
    if n == 2:
        return [0, 1] if start_idx == 0 else [1, 0]

    visited = [False] * n
    route = [start_idx]
    visited[start_idx] = True

    for _ in range(n - 1):
        current = route[-1]
        best_dist = float('inf')
        best_next = -1
        for j in range(n):
            if visited[j]:
                continue
            d = _haversine(points[current][0], points[current][1],
                           points[j][0], points[j][1])
            if d < best_dist:
                best_dist = d
                best_next = j
        if best_next == -1:
            break
        visited[best_next] = True
        route.append(best_next)
    return route


def _solve_tsp_2opt(points, start_idx=0):
    """Improve a nearest-neighbour tour with 2-opt local search."""
    route = _solve_tsp_nearest_neighbour(points, start_idx)
    n = len(route)
    if n <= 3:
        return route

    def total_distance(r):
        return sum(
            _haversine(points[r[i]][0], points[r[i]][1],
                       points[r[i + 1]][0], points[r[i + 1]][1])
            for i in range(len(r) - 1)
        )

    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                new_route = route[:i] + route[i:j + 1][::-1] + route[j + 1:]
                if total_distance(new_route) < total_distance(route):
                    route = new_route
                    improved = True
    return route


# ===================================================================
# Rider Dashboard
# ===================================================================

@api_bp.route('/rider/dashboard', methods=['GET'])
@token_required
def api_rider_dashboard():
    """Return comprehensive stats for the logged-in rider."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'error': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email

        # ── Parse period query param ──
        period = request.args.get('period', '7d')
        period_map = {
            '7d': 7, '14d': 14, '30d': 30,
            '3m': 90, '6m': 180, '1y': 365, 'all': None,
        }
        period_days = period_map.get(period, 7)
        period_label_map = {
            '7d': 'Last 7 Days', '14d': 'Last 14 Days', '30d': 'Last 30 Days',
            '3m': 'Last 3 Months', '6m': 'Last 6 Months', '1y': 'Last Year', 'all': 'All Time',
        }
        period_label = period_label_map.get(period, 'Last 7 Days')

        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        all_orders = list(db.orders.find({'$or': match_conditions}).sort('created_at', -1))

        def _parse_dt(o):
            ca = o.get('created_at')
            if ca is None:
                return None
            if isinstance(ca, datetime):
                return ca
            if isinstance(ca, str):
                try:
                    return datetime.fromisoformat(ca.replace('Z', '+00:00')).replace(tzinfo=None)
                except Exception:
                    return None
            return None

        # ── Counts by status ──
        total = len(all_orders)
        status_counts = {}
        for o in all_orders:
            s = (o.get('delivery_status') or o.get('status') or 'pending').lower()
            status_counts[s] = status_counts.get(s, 0) + 1

        delivered  = status_counts.get('delivered', 0)
        picked_up  = status_counts.get('picked_up', 0)
        on_the_way = status_counts.get('on_the_way', 0)
        ready_ship = status_counts.get('ready_for_ship', 0)
        cancelled  = status_counts.get('cancelled', 0)
        active     = picked_up + on_the_way + ready_ship

        # ── Revenue / earnings ──
        total_value = sum(float(o.get('total_amount', 0)) for o in all_orders)
        delivered_value = sum(
            float(o.get('total_amount', 0)) for o in all_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )

        completion_rate = round((delivered / total * 100), 1) if total > 0 else 0.0

        # ── Today's stats ──
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_orders = [o for o in all_orders if _parse_dt(o) is not None and _parse_dt(o) >= today_start]
        today_total = len(today_orders)
        today_delivered = sum(
            1 for o in today_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )
        today_value = sum(float(o.get('total_amount', 0)) for o in today_orders)

        # ── Period stats ──
        if period_days is not None:
            period_start = datetime.utcnow() - timedelta(days=period_days)
            period_orders = [o for o in all_orders if _parse_dt(o) is not None and _parse_dt(o) >= period_start]
        else:
            period_orders = all_orders

        period_total = len(period_orders)
        period_delivered = sum(
            1 for o in period_orders
            if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
        )
        period_value = sum(float(o.get('total_amount', 0)) for o in period_orders)

        # ── Chart breakdown ──
        chart_data = []
        if period_days is not None and period_days <= 90:
            num_days = period_days
            for i in range(num_days - 1, -1, -1):
                day = datetime.utcnow() - timedelta(days=i)
                day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
                day_end = day_start + timedelta(days=1)
                day_orders = [o for o in all_orders if _parse_dt(o) is not None and day_start <= _parse_dt(o) < day_end]
                day_delivered = sum(
                    1 for o in day_orders
                    if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                )
                day_value = sum(float(o.get('total_amount', 0)) for o in day_orders)
                date_label = day_start.strftime('%b %d') if num_days <= 14 else day_start.strftime('%m/%d')
                chart_data.append({
                    'date': date_label,
                    'orders': len(day_orders),
                    'delivered': day_delivered,
                    'value': round(day_value, 2),
                })
        elif period_days is not None:
            num_weeks = period_days // 7
            for i in range(num_weeks - 1, -1, -1):
                wk_end = datetime.utcnow() - timedelta(days=i * 7)
                wk_start = wk_end - timedelta(days=7)
                wk_start = wk_start.replace(hour=0, minute=0, second=0, microsecond=0)
                wk_end = wk_end.replace(hour=0, minute=0, second=0, microsecond=0)
                wk_orders = [o for o in all_orders if _parse_dt(o) is not None and wk_start <= _parse_dt(o) < wk_end]
                wk_delivered = sum(
                    1 for o in wk_orders
                    if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                )
                wk_value = sum(float(o.get('total_amount', 0)) for o in wk_orders)
                chart_data.append({
                    'date': wk_start.strftime('%b %d'),
                    'orders': len(wk_orders),
                    'delivered': wk_delivered,
                    'value': round(wk_value, 2),
                })
        else:
            if all_orders:
                earliest_dt = None
                for o in all_orders:
                    dt = _parse_dt(o)
                    if dt and (earliest_dt is None or dt < earliest_dt):
                        earliest_dt = dt
                if earliest_dt is None:
                    earliest_dt = datetime.utcnow() - timedelta(days=365)
                now = datetime.utcnow()
                current = earliest_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                while current <= now:
                    month_end = current.replace(year=current.year + 1, month=1) if current.month == 12 else current.replace(month=current.month + 1)
                    mo_orders = [o for o in all_orders if _parse_dt(o) is not None and current <= _parse_dt(o) < month_end]
                    mo_delivered = sum(
                        1 for o in mo_orders
                        if (o.get('delivery_status') or o.get('status') or '').lower() == 'delivered'
                    )
                    mo_value = sum(float(o.get('total_amount', 0)) for o in mo_orders)
                    chart_data.append({
                        'date': current.strftime('%b %Y'),
                        'orders': len(mo_orders),
                        'delivered': mo_delivered,
                        'value': round(mo_value, 2),
                    })
                    current = month_end

        # ── Recent 5 orders ──
        recent = []
        for o in all_orders[:5]:
            buyer = db.users.find_one({'id': o.get('user_id')})
            recent.append({
                'id': str(o.get('_id')),
                'status': (o.get('delivery_status') or o.get('status') or 'pending').lower(),
                'buyer_name': buyer.get('first_name') if buyer else 'Customer',
                'total_amount': float(o.get('total_amount', 0)),
                'created_at': o.get('created_at').isoformat() if isinstance(o.get('created_at'), datetime) else o.get('created_at'),
                'items_count': len(o.get('items', [])),
                'shipping_address': o.get('shipping_address') or o.get('delivery_address') or '',
            })

        # ── Status distribution for pie chart ──
        status_distribution = [
            {'name': k.replace('_', ' ').title(), 'value': v, 'key': k}
            for k, v in status_counts.items() if v > 0
        ]

        return jsonify({
            'rider_name': rider_doc.get('name', ''),
            'rider_phone': rider_doc.get('phone', ''),
            'period': period,
            'period_label': period_label,
            'stats': {
                'total_orders': total,
                'delivered': delivered,
                'active': active,
                'picked_up': picked_up,
                'on_the_way': on_the_way,
                'ready_for_ship': ready_ship,
                'cancelled': cancelled,
                'completion_rate': completion_rate,
                'total_value': round(total_value, 2),
                'delivered_value': round(delivered_value, 2),
            },
            'today': {
                'orders': today_total,
                'delivered': today_delivered,
                'value': round(today_value, 2),
            },
            'period_stats': {
                'orders': period_total,
                'delivered': period_delivered,
                'value': round(period_value, 2),
                'label': period_label,
            },
            'daily_chart': chart_data,
            'status_distribution': status_distribution,
            'recent_orders': recent,
        })
    except Exception as e:
        print(f"[RiderDashboard] Error: {e}")
        return jsonify({'error': str(e)}), 500


# ===================================================================
# Rider Orders
# ===================================================================

@api_bp.route('/rider/orders', methods=['GET'])
@token_required
def api_get_rider_orders():
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            print(f"[RiderOrders] No rider profile for user {user.email} (id={user.id})")
            return jsonify({'error': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email
        print(f"[RiderOrders] Rider {rider_doc.get('name')} (assigned_id={assigned_id}, "
              f"user_id={rider_user_id}, email={rider_email}) querying orders...")

        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        # Auto-stamp rider on unassigned delivery orders
        unassigned_delivery = list(db.orders.find({
            'status': {'$in': ['picked_up', 'on_the_way', 'ready_for_ship']},
            '$or': [
                {'assigned_rider_id': {'$exists': False}},
                {'assigned_rider_id': None},
                {'assigned_rider_id': ''},
            ],
        }))
        if unassigned_delivery:
            unassigned_ids = [o['_id'] for o in unassigned_delivery]
            stamp = {
                'assigned_rider_id': assigned_id,
                'assigned_rider_user_id': rider_user_id,
                'assigned_rider_email': rider_email or '',
                'assigned_rider_name': rider_doc.get('name', ''),
                'assigned_rider_phone': rider_doc.get('phone', ''),
                'assigned_rider_barangay': rider_doc.get('barangay', ''),
                'assigned_rider_city': rider_doc.get('city', ''),
                'assigned_rider_province': rider_doc.get('province', ''),
                'assigned_at': datetime.utcnow(),
            }
            db.orders.update_many({'_id': {'$in': unassigned_ids}}, {'$set': stamp})
            print(f"[RiderOrders] Auto-stamped rider on {len(unassigned_ids)} unassigned delivery orders")

        orders = list(db.orders.find({'$or': match_conditions}).sort('created_at', -1))
        print(f"[RiderOrders] Found {len(orders)} assigned orders")

        results = []
        for order in orders:
            buyer = db.users.find_one({'id': order.get('user_id')})
            delivery_status = normalize_status_value(order.get('delivery_status') or order.get('status'))
            delivery_updates = normalize_delivery_updates(order.get('delivery_updates', []), delivery_status)
            results.append({
                'id': str(order.get('_id')),
                'status': normalize_status_value(order.get('status')),
                'delivery_status': delivery_status,
                'delivery_tracking_id': order.get('delivery_tracking_id'),
                'delivery_proof_url': order.get('delivery_proof_url'),
                'created_at': order.get('created_at'),
                'updated_at': order.get('updated_at'),
                'delivery_updates': delivery_updates,
                'delivery_status_updated_at': latest_delivery_update_at(delivery_updates) or order.get('updated_at') or order.get('created_at'),
                'buyer_name': buyer.get('first_name') if buyer else 'Customer',
                'buyer_phone': buyer.get('phone') if buyer else '',
                'shipping_name': order.get('shipping_name'),
                'shipping_phone': order.get('shipping_phone'),
                'shipping_address': order.get('shipping_address'),
                'overall_location': order.get('overall_location', ''),
                'delivery_address': order.get('delivery_address'),
                'delivery_notes': order.get('delivery_notes'),
                'items': order.get('items', []),
                'total_amount': order.get('total_amount', 0),
            })

        return jsonify({'orders': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ===================================================================
# Rider Accept Order
# ===================================================================

@api_bp.route('/rider/orders/<order_id>/accept', methods=['POST'])
@token_required
def api_rider_accept_order(order_id):
    """Rider accepts a picked_up order -> status becomes on_the_way."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        current_status = (order_doc.get('delivery_status') or order_doc.get('status') or 'pending').lower()
        if current_status != 'picked_up':
            return jsonify({'success': False, 'message': 'Order must be in picked_up status to accept'}), 400

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'success': False, 'message': 'Rider profile not found'}), 404

        new_status = 'on_the_way'
        delivery_updates = list(order_doc.get('delivery_updates', []))
        delivery_updates.append({
            'status': new_status,
            'updated_at': datetime.utcnow(),
            'timestamp': datetime.utcnow(),
            'description': 'Rider accepted the delivery',
        })

        update_fields = {
            'status': new_status,
            'delivery_status': new_status,
            'updated_at': datetime.utcnow(),
            'delivery_updates': delivery_updates,
            'assigned_rider_id': str(rider_doc['_id']),
            'assigned_rider_user_id': str(user.id),
            'assigned_rider_email': user.email or '',
            'assigned_rider_name': rider_doc.get('name', ''),
            'assigned_rider_phone': rider_doc.get('phone', ''),
            'assigned_rider_barangay': rider_doc.get('barangay', ''),
            'assigned_rider_city': rider_doc.get('city', ''),
            'assigned_rider_province': rider_doc.get('province', ''),
            'accepted_at': datetime.utcnow(),
        }

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        # Notify buyer
        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'
            if buyer_email:
                email_html = build_email_html(
                    title="Delivery Update",
                    subtitle="Your order is on its way!",
                    badge_text="ON THE WAY",
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        f"<p>A rider has accepted your delivery and your order is now <strong>ON THE WAY</strong>.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick – Your order is on its way!",
                    f"Order {order_id} is now on the way.",
                    html_body=email_html,
                )
        except Exception as e:
            print(f"Rider accept email error: {e}")

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        print(f"Rider accept error: {e}")
        return jsonify({'success': False, 'message': 'Failed to accept order'}), 500


# ===================================================================
# Rider Update Order Status
# ===================================================================

@api_bp.route('/rider/orders/<order_id>/status', methods=['POST'])
@token_required
def api_update_rider_order_status(order_id):
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'success': False, 'message': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        data = request.get_json(silent=True) or {}
        if not data and request.form:
            data = request.form.to_dict()
        new_status = (data.get('status') or '').strip().lower()
        if new_status not in ('picked_up', 'on_the_way', 'delivered'):
            return jsonify({'success': False, 'message': 'Invalid status'}), 400

        order_doc = None
        if ObjectId.is_valid(order_id):
            order_doc = db.orders.find_one({'_id': ObjectId(order_id)})
        if not order_doc:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'success': False, 'message': 'Rider profile not found'}), 404

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email
        order_rider_id = order_doc.get('assigned_rider_id')
        order_rider_uid = order_doc.get('assigned_rider_user_id')
        order_rider_email = order_doc.get('assigned_rider_email', '')

        no_rider_assigned = not order_rider_id and not order_rider_uid
        is_owner = (
            no_rider_assigned
            or order_rider_id == assigned_id
            or order_rider_uid == rider_user_id
            or (rider_email and order_rider_email == rider_email)
        )
        if not is_owner:
            return jsonify({'success': False, 'message': 'Not authorized'}), 403

        current_status = (order_doc.get('delivery_status') or order_doc.get('status') or 'pending').lower()
        if new_status == 'picked_up' and current_status not in ('ready_for_ship', 'picked_up'):
            return jsonify({'success': False, 'message': 'Order must be ready for ship'}), 400
        if new_status == 'on_the_way' and current_status not in ('picked_up', 'on_the_way'):
            return jsonify({'success': False, 'message': 'Order must be picked up'}), 400
        if new_status == 'delivered' and current_status not in ('on_the_way', 'delivered'):
            return jsonify({'success': False, 'message': 'Order must be on the way'}), 400

        update_fields = {
            'status': new_status,
            'delivery_status': new_status,
            'updated_at': datetime.utcnow(),
        }

        # Stamp rider info if not yet assigned
        if no_rider_assigned:
            update_fields.update({
                'assigned_rider_id': assigned_id,
                'assigned_rider_user_id': rider_user_id,
                'assigned_rider_email': rider_email or '',
                'assigned_rider_name': rider_doc.get('name', ''),
                'assigned_rider_phone': rider_doc.get('phone', ''),
                'assigned_rider_barangay': rider_doc.get('barangay', ''),
                'assigned_rider_city': rider_doc.get('city', ''),
                'assigned_rider_province': rider_doc.get('province', ''),
                'assigned_at': datetime.utcnow(),
            })
            print(f"[RiderStatus] Auto-stamped rider {rider_doc.get('name')} on order {order_id}")

        if new_status == 'delivered':
            proof_file = request.files.get('delivery_proof')
            if not proof_file or not proof_file.filename:
                return jsonify({'success': False, 'message': 'Delivery proof photo is required'}), 400
            if not allowed_file(proof_file.filename):
                return jsonify({'success': False, 'message': 'Invalid file type. Please upload a JPG or PNG image.'}), 400

            proof_file.seek(0, os.SEEK_END)
            file_size = proof_file.tell()
            proof_file.seek(0)
            if file_size > MAX_FILE_SIZE:
                return jsonify({'success': False, 'message': 'Image must be less than 5MB'}), 400

            original = secure_filename(proof_file.filename)
            unique_name = f"delivery_{uuid.uuid4().hex}_{original}"
            proof_path = os.path.join(DELIVERY_PROOF_UPLOAD_FOLDER, unique_name)
            proof_file.save(proof_path)

            proof_url = url_for('static', filename=f'uploads/delivery_proofs/{unique_name}', _external=True)
            update_fields['delivery_proof_filename'] = unique_name
            update_fields['delivery_proof_url'] = proof_url
            update_fields['delivery_proof_uploaded_at'] = datetime.utcnow()

            update_fields['rider_confirmed'] = True
            update_fields['rider_confirmed_at'] = datetime.utcnow()

            # Auto-complete if customer already confirmed receipt
            if order_doc.get('customer_confirmed'):
                update_fields['status'] = 'completed'
                update_fields['delivery_status'] = 'completed'
                new_status = 'completed'

        delivery_updates = list(order_doc.get('delivery_updates', []))
        delivery_updates.append({
            'status': new_status,
            'updated_at': datetime.utcnow(),
            'timestamp': datetime.utcnow(),
        })
        update_fields['delivery_updates'] = normalize_delivery_updates(delivery_updates, new_status)

        db.orders.update_one({'_id': order_doc['_id']}, {'$set': update_fields})

        try:
            buyer = db.users.find_one({'id': order_doc.get('user_id')})
            buyer_email = buyer.get('email') if buyer else None
            buyer_name = buyer.get('first_name') if buyer else 'Customer'
            if buyer_email:
                status_label = new_status.replace('_', ' ').upper()
                email_html = build_email_html(
                    title="Delivery Update",
                    subtitle="Your order delivery status changed",
                    badge_text=status_label,
                    content_html=(
                        f"<p>Hi {buyer_name},</p>"
                        f"<p>Your order status is now <strong>{status_label}</strong>.</p>"
                        f'<div style="background:#f3f4f6;padding:12px 14px;border-radius:10px;">'
                        f"<strong>Order ID:</strong> {order_id}</div>"
                        "<p style='margin-top:12px;'>Thank you for shopping with FarmtoClick.</p>"
                    ),
                )
                send_system_email(
                    current_app,
                    buyer_email,
                    "FarmtoClick Delivery Update",
                    f"Order {order_id} status updated to {status_label}.",
                    html_body=email_html,
                )
        except Exception as e:
            print(f"Rider status email error: {e}")

        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'success': False, 'message': 'Failed to update order'}), 500


# ===================================================================
# Rider Route Map (TSP-optimised delivery route)
# ===================================================================

@api_bp.route('/rider/route-map', methods=['GET'])
@token_required
def api_rider_route_map():
    """Return today's delivery stops for the logged-in rider ordered by TSP."""
    import time as _time

    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'rider':
            return jsonify({'error': 'Not authorized'}), 403

        rider_doc = db.riders.find_one({'user_id': str(user.id)})
        if not rider_doc:
            rider_doc = db.riders.find_one({'email': user.email})
        if not rider_doc:
            return jsonify({'error': 'Rider profile not found'}), 404

        # Date filter
        target_date_str = request.args.get('date')
        if target_date_str:
            try:
                target_date = datetime.strptime(target_date_str, '%Y-%m-%d')
            except ValueError:
                target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        next_date = target_date + timedelta(days=1)

        assigned_id = str(rider_doc.get('_id'))
        rider_user_id = str(user.id)
        rider_email = user.email

        match_conditions = [
            {'assigned_rider_id': assigned_id},
            {'assigned_rider_user_id': rider_user_id},
        ]
        if rider_email:
            match_conditions.append({'assigned_rider_email': rider_email})

        orders = list(db.orders.find({
            '$or': match_conditions,
            'status': {'$nin': ['cancelled', 'delivered']},
            'created_at': {'$gte': target_date, '$lt': next_date},
        }).sort('created_at', -1))

        # Also include active non-delivered orders from previous days
        prev_active = list(db.orders.find({
            '$or': match_conditions,
            'status': {'$in': ['ready_for_ship', 'picked_up', 'on_the_way']},
            'created_at': {'$lt': target_date},
        }).sort('created_at', -1))

        orders = orders + prev_active

        # De-duplicate by _id
        seen_ids = set()
        unique_orders = []
        for o in orders:
            oid = str(o['_id'])
            if oid not in seen_ids:
                seen_ids.add(oid)
                unique_orders.append(o)
        orders = unique_orders

        if not orders:
            return jsonify({
                'stops': [],
                'route_order': [],
                'total_distance_km': 0,
                'start': None,
                'message': 'No active deliveries found for today.',
            })

        # Collect addresses & geocode
        stops = []
        for order in orders:
            addr = order.get('shipping_address') or order.get('delivery_address') or ''
            buyer = db.users.find_one({'id': order.get('user_id')})
            coords = _geocode_address(addr, db)
            _time.sleep(0.3)  # Nominatim courtesy delay

            stops.append({
                'order_id': str(order['_id']),
                'address': addr,
                'lat': coords[0] if coords else None,
                'lng': coords[1] if coords else None,
                'buyer_name': (order.get('shipping_name')
                               or (buyer.get('first_name', '') + ' ' + buyer.get('last_name', '') if buyer else 'Customer')),
                'buyer_phone': order.get('shipping_phone') or (buyer.get('phone', '') if buyer else ''),
                'status': order.get('status', 'pending'),
                'delivery_status': order.get('delivery_status', order.get('status', 'pending')),
                'total_amount': order.get('total_amount', 0),
                'items': order.get('items', []),
                'created_at': order.get('created_at'),
            })

        geo_stops = [s for s in stops if s['lat'] is not None and s['lng'] is not None]
        no_geo = [s for s in stops if s['lat'] is None or s['lng'] is None]

        # Determine start point
        start_lat = request.args.get('start_lat', type=float)
        start_lng = request.args.get('start_lng', type=float)

        if start_lat is not None and start_lng is not None:
            all_points = [(start_lat, start_lng)] + [(s['lat'], s['lng']) for s in geo_stops]
            route_indices = _solve_tsp_2opt(all_points, start_idx=0)
            ordered_stops = [geo_stops[i - 1] for i in route_indices if i > 0]
            start_point = {'lat': start_lat, 'lng': start_lng, 'label': 'Your Location'}
        elif geo_stops:
            all_points = [(s['lat'], s['lng']) for s in geo_stops]
            route_indices = _solve_tsp_2opt(all_points, start_idx=0)
            ordered_stops = [geo_stops[i] for i in route_indices]
            start_point = {'lat': geo_stops[route_indices[0]]['lat'],
                           'lng': geo_stops[route_indices[0]]['lng'],
                           'label': 'First Stop'}
        else:
            ordered_stops = []
            start_point = None

        # Calculate total route distance using OSRM for road distance
        total_km = 0
        estimated_duration_min = 0
        road_distance_used = False

        route_coords = []
        if start_lat is not None and start_lng is not None:
            route_coords.append((start_lat, start_lng))
        for s in ordered_stops:
            if s['lat'] and s['lng']:
                route_coords.append((s['lat'], s['lng']))

        if len(route_coords) >= 2:
            try:
                import requests as _requests
                coords_str = ';'.join(f"{lng},{lat}" for lat, lng in route_coords)
                osrm_url = f'https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=false'
                osrm_resp = _requests.get(osrm_url, timeout=15)
                osrm_data = osrm_resp.json()
                if osrm_data.get('code') == 'Ok' and osrm_data.get('routes'):
                    total_km = round(osrm_data['routes'][0]['distance'] / 1000, 2)
                    estimated_duration_min = round(osrm_data['routes'][0]['duration'] / 60)
                    road_distance_used = True
            except Exception as osrm_err:
                print(f"[RiderRouteMap] OSRM distance error, falling back to haversine: {osrm_err}")

        if not road_distance_used:
            if start_lat is not None and start_lng is not None and ordered_stops:
                total_km += _haversine(start_lat, start_lng,
                                       ordered_stops[0]['lat'], ordered_stops[0]['lng'])
            for i in range(len(ordered_stops) - 1):
                total_km += _haversine(ordered_stops[i]['lat'], ordered_stops[i]['lng'],
                                       ordered_stops[i + 1]['lat'], ordered_stops[i + 1]['lng'])
            total_km = round(total_km, 2)

        # Number the stops
        for idx, stop in enumerate(ordered_stops):
            stop['stop_number'] = idx + 1

        return jsonify({
            'stops': ordered_stops,
            'unresolved_stops': no_geo,
            'total_distance_km': total_km,
            'estimated_duration_min': estimated_duration_min,
            'road_distance': road_distance_used,
            'start': start_point,
            'total_orders': len(orders),
            'geocoded_orders': len(geo_stops),
        })
    except Exception as e:
        print(f"[RiderRouteMap] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
