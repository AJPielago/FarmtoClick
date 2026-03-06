"""
DTI SRP Price Suggestion Engine

Parses DTI (Department of Trade and Industry) price monitoring PDF records,
stores product prices in MongoDB, and uses a simple ML approach (fuzzy matching
+ weighted average) to suggest retail prices with a 15-20% profit markup.
"""

import os
import re
import uuid
from datetime import datetime, timedelta
from difflib import SequenceMatcher

# Try to import pdfplumber for PDF parsing (preferred); fall back to PyPDF2
try:
    import pdfplumber
    PDF_ENGINE = 'pdfplumber'
except ImportError:
    pdfplumber = None
    try:
        from PyPDF2 import PdfReader
        PDF_ENGINE = 'PyPDF2'
    except ImportError:
        PdfReader = None
        PDF_ENGINE = None

# ─── Load trained Random Forest model (if available) ─────────
_RF_MODEL = None
_RF_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              'ml_models', 'price_model_rf.pkl')

def _load_rf_model():
    """Load the RF pipeline from disk. Called at import time and can be
    called again after re-training to hot-reload the model."""
    global _RF_MODEL
    try:
        import joblib
        if os.path.exists(_RF_MODEL_PATH):
            _RF_MODEL = joblib.load(_RF_MODEL_PATH)
        else:
            _RF_MODEL = None
    except Exception:
        _RF_MODEL = None

_load_rf_model()


# ───────────────────────── Constants ──────────────────────────
MARKUP_MIN = 0.15   # 15 %
MARKUP_MAX = 0.20   # 20 %

# Common units found in DTI bulletins
_UNIT_ALIASES = {
    'kilogram': 'kg', 'kilograms': 'kg', 'kilo': 'kg', 'kilos': 'kg',
    'gram': 'g', 'grams': 'g',
    'piece': 'piece', 'pieces': 'piece', 'pc': 'piece', 'pcs': 'piece',
    'pack': 'pack', 'packs': 'pack',
    'bunch': 'bunch', 'bunches': 'bunch',
    'bundle': 'bundle', 'bundles': 'bundle',
    'liter': 'liter', 'liters': 'liter', 'litre': 'liter', 'litres': 'liter',
    'ml': 'ml', 'milliliter': 'ml',
    'lb': 'lb', 'lbs': 'lb', 'pound': 'lb', 'pounds': 'lb',
    'can': 'can', 'cans': 'can',
    'bottle': 'bottle', 'bottles': 'bottle',
    'box': 'box', 'boxes': 'box',
    'tray': 'tray', 'trays': 'tray',
    'kg': 'kg', 'g': 'g',
}

# ───────────────────────── PDF Parsing ────────────────────────

def _extract_text_from_pdf(filepath):
    """Extract all text from a PDF file."""
    if PDF_ENGINE == 'pdfplumber':
        text = ''
        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + '\n'
        return text
    elif PDF_ENGINE == 'PyPDF2':
        reader = PdfReader(filepath)
        text = ''
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + '\n'
        return text
    else:
        raise RuntimeError('No PDF library available. Install pdfplumber or PyPDF2.')


def _normalize_unit(raw_unit):
    """Normalize unit strings."""
    if not raw_unit:
        return 'kg'
    cleaned = raw_unit.strip().lower().rstrip('.')
    return _UNIT_ALIASES.get(cleaned, cleaned)


def _parse_price_lines(text):
    """
    Parse DTI price bulletin text and extract product → price records.

    Handles common DTI bulletin formats:
      - "Product Name   ₱XX.XX - ₱YY.YY per unit"
      - "Product Name   XX.XX   YY.YY"
      - "Product Name ... XX.XX"
      - Tabular formats
      - Multi-line product names (e.g. "Cooking Oil (Palm Olein, Jolly\nBrand) 1,000 ml/bottle")
    """
    records = []
    raw_lines = text.split('\n')

    # ── Pre-process: join continuation lines (multi-line product names) ──
    # If a line has only text (no decimal prices) and the next line has
    # prices, the first line is probably the start of a wrapped product name.
    _has_decimal = re.compile(r'\d+\.\d+')           # line contains a price
    _text_only   = re.compile(r'^[A-Za-z()\s,/\-]+$')  # line is text-only

    lines = []
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i].strip()
        if not line:
            i += 1
            continue
        # If this line is text-only (no numbers at all) and the next line
        # exists and contains at least one decimal price, join them.
        if _text_only.match(line) and i + 1 < len(raw_lines):
            next_line = raw_lines[i + 1].strip()
            if next_line and _has_decimal.search(next_line):
                lines.append(line + ' ' + next_line)
                i += 2
                continue
        lines.append(line)
        i += 1

    # Pattern: product name, then one or two prices (possibly with peso sign)
    # Matches: "Tomato  ₱50.00 - ₱60.00 / kg" or "Tomato  50.00  60.00"
    price_pattern = re.compile(
        r'^(.+?)\s+'                           # product name (non-greedy)
        r'(?:₱|P|Php|PHP|PhP)?\s*'             # optional peso symbol
        r'(\d+(?:[.,]\d+)?)'                   # first price
        r'(?:\s*[-–—to]+\s*'                   # optional separator
        r'(?:₱|P|Php|PHP|PhP)?\s*'             # optional peso symbol
        r'(\d+(?:[.,]\d+)?))?'                 # second price (optional)
        r'(?:\s*(?:per|/|\\)?\s*'              # optional "per" / "/"
        r'([a-zA-Z]+\.?))?'                    # optional unit
        r'\s*$',
        re.IGNORECASE
    )

    # Simpler pattern: Name followed by number(s)
    simple_pattern = re.compile(
        r'^([A-Za-z][A-Za-z\s,()/-]+?)\s+'
        r'(\d+(?:\.\d+)?)\s*'
        r'(?:(\d+(?:\.\d+)?)\s*)?'
        r'(?:(\d+(?:\.\d+)?)\s*)?$'
    )

    for raw_line in lines:
        line = raw_line.strip()
        if not line or len(line) < 4:
            continue

        # Skip header / footer lines
        lower_line = line.lower()
        if any(skip in lower_line for skip in [
            'prevailing', 'price monitoring', 'date:', 'source:',
            'region', 'as of', 'commodity', 'product name',
            'department of trade', 'dti', 'page', 'bulletin',
            'low', 'high', 'average', 'prev', 'week',
            '---', '===', '***', 'note:'
        ]):
            continue

        match = price_pattern.match(line)
        if match:
            name = match.group(1).strip().rstrip('.')
            price_low_str = match.group(2).replace(',', '.')
            price_high_str = match.group(3).replace(',', '.') if match.group(3) else None
            unit = _normalize_unit(match.group(4)) if match.group(4) else 'kg'

            try:
                price_low = float(price_low_str)
                price_high = float(price_high_str) if price_high_str else price_low
            except ValueError:
                continue

            if price_low <= 0:
                continue

            # Filter out obviously wrong numbers (likely page numbers, dates, etc.)
            if price_low > 10000:
                continue

            records.append({
                'product_name': name,
                'price_low': price_low,
                'price_high': price_high,
                'average_price': round((price_low + price_high) / 2, 2),
                'unit': unit,
            })
            continue

        match2 = simple_pattern.match(line)
        if match2:
            name = match2.group(1).strip().rstrip('.')
            prices = []
            for g in [match2.group(2), match2.group(3), match2.group(4)]:
                if g:
                    try:
                        p = float(g)
                        if 0 < p < 10000:
                            prices.append(p)
                    except ValueError:
                        pass
            if prices:
                records.append({
                    'product_name': name,
                    'price_low': min(prices),
                    'price_high': max(prices),
                    'average_price': round(sum(prices) / len(prices), 2),
                    'unit': 'kg',
                })

    return records


def parse_dti_pdf(filepath):
    """
    Parse a DTI price monitoring PDF and return structured price records.

    Returns list of dicts with keys:
        product_name, price_low, price_high, average_price, unit
    """
    text = _extract_text_from_pdf(filepath)
    records = _parse_price_lines(text)
    return records, text


# ───────────────────────── Database helpers ───────────────────

def save_dti_records(db, records, source_filename, uploaded_by=None):
    """
    Save parsed DTI price records into the `dti_prices` collection.
    
    Each record gets a batch_id so we can track which upload it came from.
    """
    if not records:
        return 0

    batch_id = str(uuid.uuid4())
    now = datetime.utcnow()

    docs = []
    for rec in records:
        docs.append({
            'batch_id': batch_id,
            'product_name': rec['product_name'],
            'product_name_lower': rec['product_name'].lower().strip(),
            'price_low': rec['price_low'],
            'price_high': rec['price_high'],
            'average_price': rec['average_price'],
            'unit': rec['unit'],
            'source_file': source_filename,
            'uploaded_by': uploaded_by,
            'uploaded_at': now,
            'is_active': True,
        })

    result = db.dti_prices.insert_many(docs)

    # Ensure search index
    try:
        db.dti_prices.create_index([('product_name_lower', 1)])
        db.dti_prices.create_index([('is_active', 1)])
        db.dti_prices.create_index([('uploaded_at', -1)])
    except Exception:
        pass

    return len(result.inserted_ids)


def save_manual_dti_price(db, product_name, price_low, price_high, unit='kg', uploaded_by=None):
    """Save a single manually-entered DTI price record."""
    now = datetime.utcnow()
    avg = round((price_low + price_high) / 2, 2)
    doc = {
        'batch_id': 'manual',
        'product_name': product_name,
        'product_name_lower': product_name.lower().strip(),
        'price_low': price_low,
        'price_high': price_high,
        'average_price': avg,
        'unit': unit,
        'source_file': 'manual_entry',
        'uploaded_by': uploaded_by,
        'uploaded_at': now,
        'is_active': True,
    }
    db.dti_prices.insert_one(doc)
    return doc


# ───────────────────── ML Price Suggestion ────────────────────

def _similarity(a, b):
    """Calculate string similarity ratio (0-1)."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _fuzzy_match_score(query, candidate):
    """
    Compute a fuzzy match score between a query product name and a DTI record.
    Uses multiple matching strategies and returns the best score.
    """
    q = query.lower().strip()
    c = candidate.lower().strip()

    # Exact match
    if q == c:
        return 1.0

    # Direct containment
    if q in c or c in q:
        return 0.9

    # Sequence matcher
    seq_score = _similarity(q, c)

    # Word-level overlap (Jaccard)
    q_words = set(q.split())
    c_words = set(c.split())
    if q_words and c_words:
        intersection = q_words & c_words
        union = q_words | c_words
        jaccard = len(intersection) / len(union)
    else:
        jaccard = 0.0

    # Best partial word match
    partial_scores = []
    for qw in q.split():
        best = max((_similarity(qw, cw) for cw in c.split()), default=0)
        partial_scores.append(best)
    partial_avg = sum(partial_scores) / len(partial_scores) if partial_scores else 0

    # Weighted combination
    score = max(seq_score, 0.4 * jaccard + 0.6 * partial_avg)
    return score


def suggest_price(db, product_name, unit='kg', category=None, markup_override=None):
    """
    Suggest a retail price for a product based on DTI records.

    Uses fuzzy matching to find the most relevant DTI price records,
    then applies a 15-20% markup for profit.

    Returns dict:
        {
            'found': True/False,
            'dti_avg_price': float,        # DTI average without markup
            'suggested_price_low': float,  # With 15% markup
            'suggested_price_high': float, # With 20% markup
            'suggested_price': float,      # Midpoint suggestion
            'confidence': float,           # 0-1 match confidence
            'matched_products': [...]      # DTI records used
            'unit': str,
            'markup_range': '15-20%'
        }
    """
    if not product_name:
        return {'found': False, 'message': 'No product name provided'}

    # Fetch active DTI records
    active_records = list(db.dti_prices.find({'is_active': True}).sort('uploaded_at', -1))

    if not active_records:
        return {'found': False, 'message': 'No DTI price records available'}

    # Score each record against the query
    scored = []
    for rec in active_records:
        score = _fuzzy_match_score(product_name, rec.get('product_name', ''))
        if score >= 0.55:  # Minimum threshold
            scored.append((score, rec))

    if not scored:
        return {
            'found': False,
            'message': f'No matching DTI records found for "{product_name}"',
        }

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)

    # Take top matches (up to 5)
    top_matches = scored[:5]
    best_score = top_matches[0][0]

    # Weighted average price using match scores as weights
    total_weight = 0
    weighted_price_sum = 0

    matched_products = []
    for score, rec in top_matches:
        weight = score ** 2  # Square the score for emphasis on better matches
        avg_price = rec.get('average_price', 0)
        weighted_price_sum += avg_price * weight
        total_weight += weight

        matched_products.append({
            'name': rec.get('product_name'),
            'price_low': rec.get('price_low'),
            'price_high': rec.get('price_high'),
            'average_price': avg_price,
            'unit': rec.get('unit', 'kg'),
            'similarity': round(score, 2),
            'source_file': rec.get('source_file'),
            'date': rec.get('uploaded_at').isoformat() if rec.get('uploaded_at') else None,
        })

    dti_avg_price = round(weighted_price_sum / total_weight, 2) if total_weight > 0 else 0

    # Determine markup to apply. Allow override (e.g., 0.15 for co-vendors)
    if markup_override is None:
        markup_min = MARKUP_MIN
        markup_max = MARKUP_MAX
    else:
        try:
            m = float(markup_override)
            markup_min = m
            markup_max = m
        except Exception:
            markup_min = MARKUP_MIN
            markup_max = MARKUP_MAX

    # Apply markup
    suggested_low = round(dti_avg_price * (1 + markup_min), 2)
    suggested_high = round(dti_avg_price * (1 + markup_max), 2)
    auto_price = round(dti_avg_price * (1 + markup_max), 2)
    suggested_mid = round((suggested_low + suggested_high) / 2, 2)

    return {
        'found': True,
        'dti_avg_price': dti_avg_price,
        'suggested_price_low': suggested_low,
        'suggested_price_high': suggested_high,
        'suggested_price': suggested_mid,
        'auto_price': auto_price,
        'confidence': round(best_score, 2),
        'matched_products': matched_products,
        'unit': unit,
        'markup_pct': markup_max * 100,
        'markup_range': f"{int(markup_min*100)}-{int(markup_max*100)}%" if markup_min != markup_max else f"{int(markup_max*100)}%",
        'markup_min_pct': markup_min * 100,
        'markup_max_pct': markup_max * 100,
    }


def _accurate_product_match_score(query, candidate):
    """
    More accurate scoring for product name suggestions.
    Prioritizes:
    1. Exact substring matches (high score)
    2. Word boundary matches (high score)
    3. Word-level overlap (medium score)
    4. Fuzzy matching as fallback (lower score)
    """
    q = query.lower().strip()
    c = candidate.lower().strip()
    
    # Exact match
    if q == c:
        return 1.0
    
    # Query is exact substring at word boundary (e.g., "banana" in "Banana (Cavendish)")
    if ' ' + q + ' ' in ' ' + c + ' ' or c.startswith(q + ' ') or c.startswith(q + '('):
        return 0.95
    
    # Query is contained as a word in candidate
    c_words = c.split()
    q_words = q.split()
    
    if len(q_words) == 1:
        # Single word query - check if it starts any word in candidate
        query_word = q_words[0]
        matching_words = sum(1 for w in c_words if w.startswith(query_word))
        if matching_words > 0:
            return 0.85
    
    # Word-level overlap (multiple words)
    if len(q_words) > 1:
        intersection = sum(1 for qw in q_words if any(cw.startswith(qw) for cw in c_words))
        if intersection == len(q_words):  # All query words match
            return 0.80
    
    # Prefix match (query is at the start of candidate)
    if c.startswith(q):
        return 0.75
    
    # Substring match (query appears anywhere in candidate)
    if q in c:
        return 0.60
    
    # Use fuzzy matching only as fallback
    seq_score = _similarity(q, c)
    if seq_score >= 0.7:
        return seq_score * 0.5  # Lower the fuzzy score
    
    return 0.0


def suggest_product_names(db, partial_name, limit=10):
    """
    Suggest product names based on ACCURATE partial name matching.
    Returns unique product names from DTI records with high relevance.
    Each suggestion includes the product name (base) and its variations in parentheses.
    
    Uses accurate matching to avoid too many irrelevant suggestions.
    
    Example:
        If user types "banana", returns:
        [
            "Banana (Cavendish)",
            "Banana (Latundan)",
            "Banana (Saba)"
        ]
    
    Returns list of dicts:
        [
            {'name': 'Banana (Cavendish)', 'base_name': 'Banana', 'variety': 'Cavendish'},
            ...
        ]
    """
    if not partial_name or len(partial_name) < 2:
        return []
    
    # Fetch active DTI records
    active_records = list(db.dti_prices.find({'is_active': True}).sort('uploaded_at', -1))
    
    if not active_records:
        return []
    
    # Score each record against the query using accurate matching
    scored = []
    for rec in active_records:
        product_name = rec.get('product_name', '')
        score = _accurate_product_match_score(partial_name, product_name)
        if score >= 0.55:  # Much stricter threshold for accuracy
            scored.append((score, product_name))
    
    if not scored:
        return []
    
    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)
    
    # Group by normalized product name to handle variations
    # e.g., "Banana (Cavendish)" and "Banana (Latundan)" are variations of "Banana"
    suggestions_dict = {}
    
    for score, product_name in scored:
        # Extract base name (before parentheses) if it exists
        if '(' in product_name and ')' in product_name:
            base_name = product_name[:product_name.index('(')].strip()
            variety = product_name[product_name.index('(')+1:product_name.index(')')].strip()
        else:
            base_name = product_name.strip()
            variety = None
        
        # Normalize base name for grouping
        normalized_base = base_name.lower().strip()
        
        if normalized_base not in suggestions_dict:
            suggestions_dict[normalized_base] = {
                'base_name': base_name,
                'varieties': set(),
                'score': score,  # Store the best score
            }
        else:
            # Update score if this is a better match
            suggestions_dict[normalized_base]['score'] = max(suggestions_dict[normalized_base]['score'], score)
        
        if variety:
            suggestions_dict[normalized_base]['varieties'].add(variety)
    
    # Format results
    results = []
    for normalized_base in sorted(suggestions_dict.keys(), 
                                  key=lambda k: suggestions_dict[k]['score'], 
                                  reverse=True):
        entry = suggestions_dict[normalized_base]
        base_name = entry['base_name']
        varieties = sorted(entry['varieties'])
        
        if varieties:
            # Add each variety as a separate suggestion
            for variety in varieties:
                results.append({
                    'name': f"{base_name} ({variety})",
                    'base_name': base_name,
                    'variety': variety,
                })
        else:
            # No variety info, just add the base name
            results.append({
                'name': base_name,
                'base_name': base_name,
                'variety': None,
            })
    
    return results[:limit]


def get_all_dti_records(db, active_only=True):
    """Return all DTI price records, optionally filtered to active only."""
    query = {'is_active': True} if active_only else {}
    records = list(db.dti_prices.find(query).sort('uploaded_at', -1))
    for rec in records:
        rec['_id'] = str(rec['_id'])
    return records


def delete_dti_batch(db, batch_id):
    """Soft-delete all records in a batch by marking them inactive."""
    result = db.dti_prices.update_many(
        {'batch_id': batch_id},
        {'$set': {'is_active': False}}
    )
    return result.modified_count


def delete_dti_record(db, record_id):
    """Soft-delete a single DTI record."""
    from bson import ObjectId
    result = db.dti_prices.update_one(
        {'_id': ObjectId(record_id)},
        {'$set': {'is_active': False}}
    )
    return result.modified_count


def delete_dti_records_bulk(db, record_ids):
    """Soft-delete multiple DTI records by their IDs."""
    from bson import ObjectId
    obj_ids = [ObjectId(rid) for rid in record_ids]
    result = db.dti_prices.update_many(
        {'_id': {'$in': obj_ids}},
        {'$set': {'is_active': False}}
    )
    return result.modified_count


def delete_all_active_dti_records(db):
    """Soft-delete ALL active DTI price records."""
    result = db.dti_prices.update_many(
        {'is_active': True},
        {'$set': {'is_active': False}}
    )
    return result.modified_count


# ───────────────── Price Trend & Forecast ─────────────────────

def get_price_trends(db, product_name, forecast_days=30):
    """
    Analyse historical DTI price records for a product and forecast
    future prices using linear regression.

    Parameters
    ----------
    db : pymongo database
    product_name : str – the product to look up (fuzzy-matched)
    forecast_days : int – how many days into the future to predict

    Returns
    -------
    dict with keys:
        found, product_name, history (list of {date, avg, low, high}),
        forecast (list of {date, predicted_price}),
        trend (up / down / stable), trend_pct, current_price,
        predicted_price, confidence
    """
    import numpy as np
    from collections import defaultdict

    if not product_name:
        return {'found': False, 'message': 'No product name provided'}

    # Fetch active DTI records
    active_records = list(db.dti_prices.find({'is_active': True}).sort('uploaded_at', -1))
    if not active_records:
        return {'found': False, 'message': 'No DTI price records available'}

    # Fuzzy-match all records for this product
    matched = []
    for rec in active_records:
        score = _fuzzy_match_score(product_name, rec.get('product_name', ''))
        if score >= 0.55:
            matched.append((score, rec))

    if not matched:
        return {
            'found': False,
            'message': f'No matching DTI records found for "{product_name}"',
        }

    # Use the best-matched product name for display
    matched.sort(key=lambda x: x[0], reverse=True)
    canonical_name = matched[0][1].get('product_name', product_name)

    # Group prices by date (yyyy-mm-dd) using only high-confidence matches
    best_score = matched[0][0]
    threshold = max(0.55, best_score - 0.15)

    daily = defaultdict(list)
    for score, rec in matched:
        if score < threshold:
            continue
        ts = rec.get('uploaded_at')
        if not ts:
            continue
        if hasattr(ts, 'strftime'):
            date_key = ts.strftime('%Y-%m-%d')
        else:
            try:
                date_key = datetime.fromisoformat(str(ts)).strftime('%Y-%m-%d')
            except Exception:
                continue
        daily[date_key].append({
            'avg': rec.get('average_price', 0),
            'low': rec.get('price_low', 0),
            'high': rec.get('price_high', 0),
        })

    if not daily:
        return {'found': False, 'message': 'Matched records have no date information'}

    # Build sorted history
    sorted_dates = sorted(daily.keys())
    history = []
    for d in sorted_dates:
        entries = daily[d]
        avg_price = round(sum(e['avg'] for e in entries) / len(entries), 2)
        low_price = round(min(e['low'] for e in entries), 2)
        high_price = round(max(e['high'] for e in entries), 2)
        history.append({
            'date': d,
            'average_price': avg_price,
            'price_low': low_price,
            'price_high': high_price,
        })

    # Current price = latest date's average
    current_price = history[-1]['average_price']

    # ----- Forecasting -----
    # Convert dates to numeric (days since first date)
    base_date = datetime.strptime(sorted_dates[0], '%Y-%m-%d')
    x_vals = []
    y_vals = []
    low_vals = []
    high_vals = []
    for h in history:
        dt = datetime.strptime(h['date'], '%Y-%m-%d')
        x_vals.append((dt - base_date).days)
        y_vals.append(h['average_price'])
        low_vals.append(h['price_low'])
        high_vals.append(h['price_high'])

    x = np.array(x_vals, dtype=float)
    y = np.array(y_vals, dtype=float)
    unit = matched[0][1].get('unit', 'kg')

    # ---------- Try Random Forest model first ----------
    use_rf = False
    if _RF_MODEL is not None and len(history) >= 2:
        try:
            import pandas as pd
            use_rf = True

            last_day = x_vals[-1]
            forecast = []

            # Seed lag/rolling buffers from the end of history
            recent_prices = list(y_vals[-3:])  # up to last 3 prices
            recent_lows = list(low_vals[-3:])
            recent_highs = list(high_vals[-3:])

            for i in range(1, forecast_days + 1):
                future_day = last_day + i
                future_date = base_date + timedelta(days=future_day)

                lag1 = recent_prices[-1] if len(recent_prices) >= 1 else current_price
                lag2 = recent_prices[-2] if len(recent_prices) >= 2 else lag1
                lag3 = recent_prices[-3] if len(recent_prices) >= 3 else lag2
                rolling_mean_3 = round(np.mean(recent_prices[-3:]), 2)
                p_low = recent_lows[-1] if recent_lows else 0
                p_high = recent_highs[-1] if recent_highs else 0

                row = pd.DataFrame([{
                    'name_text': canonical_name,
                    'unit': unit,
                    'day_number': float(future_day),
                    'month': future_date.month,
                    'day_of_week': future_date.weekday(),
                    'price_low': p_low,
                    'price_high': p_high,
                    'price_spread': p_high - p_low,
                    'lag_1': lag1,
                    'lag_2': lag2,
                    'lag_3': lag3,
                    'rolling_mean_3': rolling_mean_3,
                }])

                pred = float(_RF_MODEL.predict(row)[0])
                pred = max(pred, 0)

                forecast.append({
                    'date': future_date.strftime('%Y-%m-%d'),
                    'predicted_price': round(pred, 2),
                })

                # Update rolling buffers so next iteration gets proper lags
                recent_prices.append(pred)
                recent_lows.append(p_low)
                recent_highs.append(p_high)

            # Confidence: use R² from metadata if available, else estimate
            try:
                import json as _json
                meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         'ml_models', 'price_model_rf_metadata.json')
                with open(meta_path) as _mf:
                    _meta = _json.load(_mf)
                r_squared = float(_meta.get('r2', 0.8))
            except Exception:
                r_squared = 0.8

        except Exception:
            use_rf = False

    # ---------- Fallback: linear regression ----------
    if not use_rf:
        if len(x) >= 2:
            n = len(x)
            sum_x = np.sum(x)
            sum_y = np.sum(y)
            sum_xy = np.sum(x * y)
            sum_x2 = np.sum(x ** 2)
            denom = n * sum_x2 - sum_x ** 2
            if denom != 0:
                slope = (n * sum_xy - sum_x * sum_y) / denom
                intercept = (sum_y - slope * sum_x) / n
            else:
                slope = 0.0
                intercept = float(np.mean(y))
            y_pred_hist = slope * x + intercept
            ss_res = np.sum((y - y_pred_hist) ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
        else:
            slope = 0.0
            intercept = float(y[0]) if len(y) else 0.0
            r_squared = 0.0

        last_day = x_vals[-1] if x_vals else 0
        forecast = []
        for i in range(1, forecast_days + 1):
            future_day = last_day + i
            pred_price = slope * future_day + intercept
            pred_price = max(pred_price, 0)
            future_date = base_date + timedelta(days=future_day)
            forecast.append({
                'date': future_date.strftime('%Y-%m-%d'),
                'predicted_price': round(pred_price, 2),
            })

    predicted_price = forecast[-1]['predicted_price'] if forecast else current_price

    # Next-day prediction (first forecast entry = tomorrow)
    next_day = forecast[0] if forecast else None
    next_day_price = next_day['predicted_price'] if next_day else current_price
    next_day_date = next_day['date'] if next_day else None
    next_day_change = round(next_day_price - current_price, 2)
    next_day_change_pct = round((next_day_change / current_price * 100), 2) if current_price else 0.0

    # Determine trend
    if len(history) >= 2:
        price_change = predicted_price - current_price
        pct_change = (price_change / current_price * 100) if current_price else 0
        if pct_change > 1:
            trend = 'up'
        elif pct_change < -1:
            trend = 'down'
        else:
            trend = 'stable'
    else:
        pct_change = 0
        trend = 'stable'

    # Next-day trend direction
    if next_day_change_pct > 0.5:
        next_day_trend = 'up'
    elif next_day_change_pct < -0.5:
        next_day_trend = 'down'
    else:
        next_day_trend = 'stable'

    return {
        'found': True,
        'product_name': canonical_name,
        'history': history,
        'forecast': forecast,
        'trend': trend,
        'trend_pct': round(pct_change, 2),
        'current_price': current_price,
        'predicted_price': predicted_price,
        'next_day_price': next_day_price,
        'next_day_date': next_day_date,
        'next_day_change': next_day_change,
        'next_day_change_pct': next_day_change_pct,
        'next_day_trend': next_day_trend,
        'confidence': round(r_squared, 3),
        'model': 'random_forest' if use_rf else 'linear_regression',
        'data_points': len(history),
        'unit': unit,
    }


def get_prediction_accuracy(db, product_name):
    """
    Backtest the RF model on a product's historical data.

    For each historical data point (starting from the 2nd), we predict
    using only prior data as lag features, then compare predicted vs actual.

    Returns
    -------
    dict with keys:
        found, product_name, comparisons (list of {date, actual, predicted, error, error_pct}),
        overall_mae, overall_mape, overall_rmse, accuracy_pct, model, data_points
    """
    import numpy as np

    # Re-use the same matching / history-building logic from get_price_trends
    result = get_price_trends(db, product_name, forecast_days=1)
    if not result.get('found'):
        return result

    history = result['history']
    canonical_name = result['product_name']
    unit = result.get('unit', 'kg')
    model_name = result.get('model', 'linear_regression')

    if len(history) < 3:
        return {
            'found': True,
            'product_name': canonical_name,
            'message': 'Need at least 3 data points for accuracy testing.',
            'comparisons': [],
            'data_points': len(history),
            'accuracy_pct': 0,
            'overall_mae': 0,
            'overall_mape': 0,
            'overall_rmse': 0,
            'model': model_name,
            'unit': unit,
        }

    base_date = datetime.strptime(history[0]['date'], '%Y-%m-%d')
    comparisons = []

    # ---------- RF-based backtest ----------
    if _RF_MODEL is not None:
        import pandas as pd

        for i in range(2, len(history)):  # start at 3rd point (need 2 lags)
            h = history[i]
            dt = datetime.strptime(h['date'], '%Y-%m-%d')
            day_num = (dt - base_date).days

            lag1 = history[i - 1]['average_price']
            lag2 = history[i - 2]['average_price'] if i >= 2 else lag1
            lag3 = history[i - 3]['average_price'] if i >= 3 else lag2
            recent = [history[j]['average_price'] for j in range(max(0, i - 3), i)]
            rolling_mean_3 = float(np.mean(recent)) if recent else lag1
            p_low = history[i - 1]['price_low']
            p_high = history[i - 1]['price_high']

            row = pd.DataFrame([{
                'name_text': canonical_name,
                'unit': unit,
                'day_number': float(day_num),
                'month': dt.month,
                'day_of_week': dt.weekday(),
                'price_low': p_low,
                'price_high': p_high,
                'price_spread': p_high - p_low,
                'lag_1': lag1,
                'lag_2': lag2,
                'lag_3': lag3,
                'rolling_mean_3': rolling_mean_3,
            }])

            predicted = float(_RF_MODEL.predict(row)[0])
            actual = h['average_price']
            error = abs(predicted - actual)
            error_pct = round((error / actual) * 100, 2) if actual else 0

            comparisons.append({
                'date': h['date'],
                'actual': round(actual, 2),
                'predicted': round(predicted, 2),
                'error': round(error, 2),
                'error_pct': error_pct,
            })
    else:
        # Linear regression backtest
        x_all = []
        y_all = []
        for h in history:
            dt = datetime.strptime(h['date'], '%Y-%m-%d')
            x_all.append((dt - base_date).days)
            y_all.append(h['average_price'])

        for i in range(2, len(history)):
            x_train = np.array(x_all[:i], dtype=float)
            y_train = np.array(y_all[:i], dtype=float)
            n = len(x_train)
            sx = np.sum(x_train)
            sy = np.sum(y_train)
            sxy = np.sum(x_train * y_train)
            sx2 = np.sum(x_train ** 2)
            denom = n * sx2 - sx ** 2
            if denom != 0:
                slope = (n * sxy - sx * sy) / denom
                intercept = (sy - slope * sx) / n
            else:
                slope = 0
                intercept = float(np.mean(y_train))
            predicted = slope * x_all[i] + intercept
            actual = y_all[i]
            error = abs(predicted - actual)
            error_pct = round((error / actual) * 100, 2) if actual else 0
            comparisons.append({
                'date': history[i]['date'],
                'actual': round(actual, 2),
                'predicted': round(predicted, 2),
                'error': round(error, 2),
                'error_pct': error_pct,
            })

    if not comparisons:
        return {
            'found': True,
            'product_name': canonical_name,
            'comparisons': [],
            'data_points': len(history),
            'message': 'Not enough data for backtest.',
            'accuracy_pct': 0,
            'overall_mae': 0,
            'overall_mape': 0,
            'overall_rmse': 0,
            'model': model_name,
            'unit': unit,
        }

    errors = [c['error'] for c in comparisons]
    error_pcts = [c['error_pct'] for c in comparisons]
    mae = round(float(np.mean(errors)), 2)
    rmse = round(float(np.sqrt(np.mean(np.array(errors) ** 2))), 2)
    mape = round(float(np.mean(error_pcts)), 2)
    accuracy_pct = round(100 - mape, 2)

    return {
        'found': True,
        'product_name': canonical_name,
        'comparisons': comparisons,
        'overall_mae': mae,
        'overall_mape': mape,
        'overall_rmse': rmse,
        'accuracy_pct': accuracy_pct,
        'model': model_name,
        'data_points': len(history),
        'unit': unit,
    }


def get_trendable_products(db, limit=50):
    """
    Return a list of unique product names from DTI records that have
    data on at least 2 different dates (i.e. enough for trend analysis).
    """
    pipeline = [
        {'$match': {'is_active': True}},
        {'$group': {
            '_id': '$product_name_lower',
            'product_name': {'$first': '$product_name'},
            'unit': {'$first': '$unit'},
            'date_count': {'$addToSet': {
                '$dateToString': {'format': '%Y-%m-%d', 'date': '$uploaded_at'}
            }},
            'latest_avg': {'$first': '$average_price'},
        }},
        {'$project': {
            'product_name': 1,
            'unit': 1,
            'latest_avg': 1,
            'date_count': {'$size': '$date_count'},
        }},
        {'$match': {'date_count': {'$gte': 2}}},
        {'$sort': {'product_name': 1}},
        {'$limit': limit},
    ]
    try:
        results = list(db.dti_prices.aggregate(pipeline))
    except Exception:
        # Fallback if aggregation fails (e.g. $dateToString unsupported)
        return []
    return [
        {
            'product_name': r['product_name'],
            'unit': r.get('unit', 'kg'),
            'latest_price': r.get('latest_avg', 0),
            'data_points': r.get('date_count', 0),
        }
        for r in results
    ]
