"""
DTI SRP Price Suggestion System routes and ML model helpers.
"""
import os
import uuid
from datetime import datetime

from flask import request, jsonify
from werkzeug.utils import secure_filename

from db import get_mongodb_db
from middleware import token_required
from . import api_bp
from ._helpers import _BACKEND_DIR


# ===================================================================
# ML Price Model (Random Forest) – loaded once at import time
# ===================================================================

try:
    import joblib
    import threading
    import pandas as pd

    PRICE_RF_MODEL = None
    _PRICE_RF_LOCK = threading.Lock()
    PRICE_MODEL_PATH = os.path.join(_BACKEND_DIR, 'ml_models', 'price_model_rf.pkl')

    def _load_price_model():
        global PRICE_RF_MODEL
        try:
            if os.path.exists(PRICE_MODEL_PATH):
                PRICE_RF_MODEL = joblib.load(PRICE_MODEL_PATH)
            else:
                PRICE_RF_MODEL = None
        except Exception:
            PRICE_RF_MODEL = None

    def _predict_price_with_rf(product_name, unit='kg', source_file='', file_date=None):
        """Predict a single price using the retrained time-series RF model."""
        if PRICE_RF_MODEL is None:
            raise RuntimeError('Price model not available')

        now = datetime.utcnow()
        if file_date:
            try:
                now = datetime.fromisoformat(str(file_date))
            except Exception:
                pass

        X = pd.DataFrame([{
            'name_text': product_name or '',
            'unit': unit or 'kg',
            'day_number': 0.0,
            'month': now.month,
            'day_of_week': now.weekday(),
            'price_low': 0.0,
            'price_high': 0.0,
            'price_spread': 0.0,
            'lag_1': 0.0,
            'lag_2': 0.0,
            'lag_3': 0.0,
            'rolling_mean_3': 0.0,
        }])
        pred = PRICE_RF_MODEL.predict(X)
        return float(pred[0])

    _load_price_model()
except Exception:
    PRICE_RF_MODEL = None


# ===================================================================
# Routes
# ===================================================================

@api_bp.route('/dti/reload-model', methods=['POST'])
@token_required
def api_dti_reload_model():
    """Hot-reload the RF model after retraining (admin only)."""
    try:
        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500
        from user_model import User
        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin only'}), 403

        _load_price_model()
        from dti_price_engine import _load_rf_model
        _load_rf_model()

        status = 'loaded' if PRICE_RF_MODEL is not None else 'not_found'
        return jsonify({'status': status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/suggest-price', methods=['GET'])
@token_required
def api_dti_suggest_price():
    """Suggest a retail price for a product based on DTI records."""
    try:
        from dti_price_engine import suggest_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        unit = request.args.get('unit', 'kg').strip()
        category = request.args.get('category', '').strip()
        audience = request.args.get('audience', '').strip().lower()

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        if audience == 'co-vendors':
            result = suggest_price(db, product_name, unit=unit, category=category, markup_override=0.15)
        else:
            result = suggest_price(db, product_name, unit=unit, category=category)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/predict-price', methods=['POST'])
@token_required
def api_dti_predict_price():
    try:
        from dti_price_engine import suggest_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        data = request.get_json() or {}
        product_name = (data.get('product_name') or '').strip()
        if not product_name:
            return jsonify({'error': 'product_name is required'}), 400

        unit = (data.get('unit') or 'kg').strip()
        source_file = (data.get('source_file') or '').strip()
        file_date = data.get('file_date', None)

        if PRICE_RF_MODEL is None:
            sugg = suggest_price(db, product_name, unit=unit)
            return jsonify({'model': 'heuristic', 'suggestion': sugg})

        try:
            price = _predict_price_with_rf(product_name, unit=unit, source_file=source_file, file_date=file_date)
            return jsonify({'model': 'price_model_rf', 'predicted_price': round(price, 2)})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/product-suggestions', methods=['GET'])
@token_required
def api_dti_product_suggestions():
    """Get product name suggestions from DTI records based on partial name matching."""
    try:
        from dti_price_engine import suggest_product_names

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        partial_name = request.args.get('name', '').strip()
        limit = request.args.get('limit', 10, type=int)

        if not partial_name or len(partial_name) < 1:
            return jsonify({'suggestions': []})

        suggestions = suggest_product_names(db, partial_name, limit=limit)
        return jsonify({'suggestions': suggestions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/prices', methods=['GET'])
@token_required
def api_dti_get_prices():
    """Get all active DTI price records."""
    try:
        from dti_price_engine import get_all_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        records = get_all_dti_records(db, active_only=True)
        return jsonify({'records': records, 'count': len(records)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/upload-pdf', methods=['POST'])
@token_required
def api_dti_upload_pdf():
    """Upload a DTI price monitoring PDF. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import parse_dti_pdf, save_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        pdf_file = request.files.get('pdf')
        if not pdf_file or not pdf_file.filename:
            return jsonify({'error': 'No PDF file provided'}), 400

        if not pdf_file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'File must be a PDF'}), 400

        upload_dir = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'dti_pdfs')
        os.makedirs(upload_dir, exist_ok=True)
        unique_name = f"{uuid.uuid4().hex}_{secure_filename(pdf_file.filename)}"
        filepath = os.path.join(upload_dir, unique_name)
        pdf_file.save(filepath)

        records, raw_text = parse_dti_pdf(filepath)

        if not records:
            return jsonify({
                'error': 'No price records could be extracted from the PDF. '
                         'You can add prices manually instead.',
                'raw_text_preview': raw_text[:2000] if raw_text else '',
            }), 400

        count = save_dti_records(db, records, pdf_file.filename, uploaded_by=request.user_email)

        return jsonify({
            'message': f'Successfully extracted and saved {count} price records',
            'count': count,
            'records': records,
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/manual-entry', methods=['POST'])
@token_required
def api_dti_manual_entry():
    """Manually add a DTI price record. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import save_manual_dti_price

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json() or {}
        product_name = data.get('product_name', '').strip()
        price_low = data.get('price_low')
        price_high = data.get('price_high')
        unit = data.get('unit', 'kg').strip()

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400
        try:
            price_low = float(price_low)
            price_high = float(price_high) if price_high else price_low
        except (TypeError, ValueError):
            return jsonify({'error': 'Valid prices are required'}), 400

        if price_low <= 0:
            return jsonify({'error': 'Price must be greater than 0'}), 400

        doc = save_manual_dti_price(db, product_name, price_low, price_high, unit,
                                    uploaded_by=request.user_email)
        doc['_id'] = str(doc.get('_id', ''))

        return jsonify({'message': 'Price record added', 'record': doc}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/bulk-entry', methods=['POST'])
@token_required
def api_dti_bulk_entry():
    """Add multiple DTI price records at once. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import save_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json() or {}
        records = data.get('records', [])

        if not records:
            return jsonify({'error': 'No records provided'}), 400

        parsed = []
        for rec in records:
            name = rec.get('product_name', '').strip()
            try:
                low = float(rec.get('price_low', 0))
                high = float(rec.get('price_high', 0)) or low
            except (TypeError, ValueError):
                continue
            if name and low > 0:
                parsed.append({
                    'product_name': name,
                    'price_low': low,
                    'price_high': high,
                    'average_price': round((low + high) / 2, 2),
                    'unit': rec.get('unit', 'kg'),
                })

        if not parsed:
            return jsonify({'error': 'No valid records found'}), 400

        count = save_dti_records(db, parsed, 'bulk_manual_entry', uploaded_by=request.user_email)
        return jsonify({'message': f'Added {count} price records', 'count': count}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/records/bulk-delete', methods=['POST'])
@token_required
def api_dti_bulk_delete():
    """Bulk delete (deactivate) multiple DTI price records. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_records_bulk, delete_all_active_dti_records

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        delete_all = data.get('delete_all', False)
        record_ids = data.get('record_ids', [])

        if delete_all:
            count = delete_all_active_dti_records(db)
        elif record_ids:
            count = delete_dti_records_bulk(db, record_ids)
        else:
            return jsonify({'error': 'Provide record_ids or set delete_all to true'}), 400

        return jsonify({'message': f'Deleted {count} record(s)', 'count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/records/<record_id>', methods=['DELETE'])
@token_required
def api_dti_delete_record(record_id):
    """Delete (deactivate) a single DTI price record. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_record

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        count = delete_dti_record(db, record_id)
        return jsonify({'message': f'Deleted {count} record(s)'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/batch/<batch_id>', methods=['DELETE'])
@token_required
def api_dti_delete_batch(batch_id):
    """Delete (deactivate) all records in a batch. Admin only."""
    try:
        from user_model import User
        from dti_price_engine import delete_dti_batch

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        user = User.get_by_email(db, request.user_email)
        if not user or getattr(user, 'role', 'user') != 'admin':
            return jsonify({'error': 'Admin access required'}), 403

        count = delete_dti_batch(db, batch_id)
        return jsonify({'message': f'Deleted {count} records from batch'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------
# Price Trends & Forecast
# ------------------------------------------------------------------

@api_bp.route('/dti/price-trends', methods=['GET'])
@token_required
def api_dti_price_trends():
    """Get historical price data and a price forecast for a product."""
    try:
        from dti_price_engine import get_price_trends

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        forecast_days = request.args.get('days', 30, type=int)

        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        result = get_price_trends(db, product_name, forecast_days=forecast_days)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/prediction-accuracy', methods=['GET'])
@token_required
def api_dti_prediction_accuracy():
    """Backtest accuracy report for a product."""
    try:
        from dti_price_engine import get_prediction_accuracy

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        result = get_prediction_accuracy(db, product_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/trendable-products', methods=['GET'])
@token_required
def api_dti_trendable_products():
    """Return products that have enough historical data for trend analysis."""
    try:
        from dti_price_engine import get_trendable_products

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 50, type=int)
        products = get_trendable_products(db, limit=limit)
        return jsonify({'products': products})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/trends', methods=['GET'])
@token_required
def api_dti_trends():
    """Return historical price trend data and forecast for a specific product."""
    try:
        from dti_price_engine import get_price_trends

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        product_name = request.args.get('name', '').strip()
        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400

        days = request.args.get('days', 30, type=int)
        result = get_price_trends(db, product_name, forecast_days=days)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/dti/public-predictions', methods=['GET'])
def api_dti_public_predictions():
    """Return predicted prices for the top most-ordered products with DTI trend data."""
    try:
        from dti_price_engine import get_trendable_products, get_price_trends
        from collections import defaultdict

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 6, type=int)
        forecast_days = request.args.get('days', 1, type=int)

        all_orders = list(db.orders.find({}, {'items': 1}))
        product_order_count = defaultdict(int)
        for o in all_orders:
            for item in o.get('items', []):
                name = (item.get('name') or '').strip()
                if name:
                    product_order_count[name.lower()] += int(item.get('quantity', 1))

        top_ordered_names = [n for n, _ in sorted(product_order_count.items(), key=lambda x: x[1], reverse=True)]

        trendable = get_trendable_products(db, limit=200)
        trendable_map = {p['product_name'].lower(): p for p in trendable}

        matched = []
        used = set()
        for ordered_name in top_ordered_names:
            if len(matched) >= limit:
                break
            if ordered_name in trendable_map and ordered_name not in used:
                matched.append(trendable_map[ordered_name])
                used.add(ordered_name)
                continue
            for tname, tprod in trendable_map.items():
                if tname in used:
                    continue
                if ordered_name in tname or tname in ordered_name:
                    matched.append(tprod)
                    used.add(tname)
                    break

        if len(matched) < limit:
            for tp in trendable:
                if len(matched) >= limit:
                    break
                key = tp['product_name'].lower()
                if key not in used:
                    matched.append(tp)
                    used.add(key)

        if not matched:
            return jsonify({'predictions': [], 'count': 0})

        predictions = []
        for prod in matched:
            try:
                trend = get_price_trends(db, prod['product_name'], forecast_days=forecast_days)
                if trend.get('found'):
                    predictions.append({
                        'product_name': trend['product_name'],
                        'current_price': trend['current_price'],
                        'predicted_price': trend.get('next_day_price', trend['predicted_price']),
                        'predicted_date': trend.get('next_day_date'),
                        'trend': trend.get('next_day_trend', trend['trend']),
                        'trend_pct': trend.get('next_day_change_pct', trend['trend_pct']),
                        'price_change': trend.get('next_day_change', 0),
                        'confidence': trend['confidence'],
                        'data_points': trend['data_points'],
                        'unit': trend.get('unit', 'kg'),
                        'history': trend.get('history', [])[-5:],
                        'forecast': trend.get('forecast', [])[:3],
                    })
            except Exception:
                continue

        return jsonify({'predictions': predictions, 'count': len(predictions)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/public/price-predictions', methods=['GET'])
def api_public_price_predictions():
    """Public (no auth) endpoint returning predicted prices for top products."""
    try:
        from dti_price_engine import get_trendable_products, get_price_trends
        from collections import defaultdict

        db, _ = get_mongodb_db(api_bp)
        if db is None:
            return jsonify({'error': 'Database connection failed'}), 500

        limit = request.args.get('limit', 6, type=int)
        forecast_days = request.args.get('days', 1, type=int)

        all_orders = list(db.orders.find({}, {'items': 1}))
        product_order_count = defaultdict(int)
        for o in all_orders:
            for item in o.get('items', []):
                name = (item.get('name') or '').strip()
                if name:
                    product_order_count[name.lower()] += int(item.get('quantity', 1))

        top_ordered = sorted(product_order_count.items(), key=lambda x: x[1], reverse=True)
        top_ordered_names = [name for name, _ in top_ordered]

        trendable = get_trendable_products(db, limit=200)
        trendable_map = {p['product_name'].lower(): p for p in trendable}

        matched = []
        used = set()
        for ordered_name in top_ordered_names:
            if len(matched) >= limit:
                break
            if ordered_name in trendable_map and ordered_name not in used:
                matched.append(trendable_map[ordered_name])
                used.add(ordered_name)
                continue
            for tname, tprod in trendable_map.items():
                if tname in used:
                    continue
                if ordered_name in tname or tname in ordered_name:
                    matched.append(tprod)
                    used.add(tname)
                    break

        if len(matched) < limit:
            for tp in trendable:
                if len(matched) >= limit:
                    break
                key = tp['product_name'].lower()
                if key not in used:
                    matched.append(tp)
                    used.add(key)

        if not matched:
            return jsonify({'predictions': [], 'count': 0})

        predictions = []
        for prod in matched:
            try:
                trend = get_price_trends(db, prod['product_name'], forecast_days=forecast_days)
                if trend.get('found'):
                    predictions.append({
                        'product_name': trend['product_name'],
                        'current_price': trend['current_price'],
                        'predicted_price': trend.get('next_day_price', trend['predicted_price']),
                        'predicted_date': trend.get('next_day_date'),
                        'trend': trend.get('next_day_trend', trend['trend']),
                        'trend_pct': trend.get('next_day_change_pct', trend['trend_pct']),
                        'price_change': trend.get('next_day_change', 0),
                        'confidence': trend['confidence'],
                        'data_points': trend['data_points'],
                        'unit': trend.get('unit', 'kg'),
                        'history': trend.get('history', [])[-5:],
                        'forecast': trend.get('forecast', [])[:3],
                    })
            except Exception:
                continue

        return jsonify({'predictions': predictions, 'count': len(predictions)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
