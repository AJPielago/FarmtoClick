"""
Train a Random Forest price-forecasting model using DTI price records
stored in MongoDB.

Usage:
    cd backend
    python train_price_rf.py                 # default: connect to MongoDB from .env
    python train_price_rf.py --csv data/dti_records.csv   # or from CSV fallback

The trained model is saved to  ml_models/price_model_rf.pkl
and metadata to                ml_models/price_model_rf_metadata.json

How it works:
    1. Exports all active DTI price records from MongoDB (or reads from CSV).
    2. Engineers time-series features per product:
       - day_number  (days since the product's first record)
       - month, day_of_week
       - lag_1, lag_2, lag_3  (previous prices)
       - rolling_mean_3  (3-point moving average)
       - price_low, price_high
       - product name encoded via TF-IDF
       - unit one-hot encoded
    3. Trains a single RandomForestRegressor on all products.
    4. Saves the sklearn Pipeline (.pkl) so get_price_trends() can load it.
"""

import os
import sys
import json
import argparse
import warnings
import pandas as pd
import numpy as np
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

warnings.filterwarnings('ignore', category=UserWarning)

_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(_DIR, 'ml_models')
OUT_MODEL = os.path.join(OUT_DIR, 'price_model_rf.pkl')
OUT_META = os.path.join(OUT_DIR, 'price_model_rf_metadata.json')
DATA_CSV = os.path.join(_DIR, 'data', 'dti_records.csv')


# ───────────────────── Data loading ───────────────────────────

def load_from_mongodb():
    """Pull all active DTI price records directly from MongoDB."""
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(_DIR, '.env'))
    except Exception:
        pass

    mongo_uri = os.environ.get('MONGODB_URI')
    if not mongo_uri:
        print("⚠  MONGODB_URI not set – cannot pull from database.")
        return None

    from pymongo import MongoClient
    client = MongoClient(mongo_uri)
    db = client.get_database()
    cursor = db.dti_prices.find({'is_active': True}).sort('uploaded_at', 1)
    rows = []
    for rec in cursor:
        uploaded = rec.get('uploaded_at')
        if uploaded and hasattr(uploaded, 'strftime'):
            date_str = uploaded.strftime('%Y-%m-%d')
        else:
            date_str = str(uploaded)[:10] if uploaded else ''
        rows.append({
            'product_name': rec.get('product_name', ''),
            'price_low': rec.get('price_low', 0),
            'price_high': rec.get('price_high', 0),
            'average_price': rec.get('average_price', 0),
            'unit': rec.get('unit', 'kg'),
            'source_file': rec.get('source_file', ''),
            'file_date': date_str,
        })
    client.close()
    if not rows:
        return None
    df = pd.DataFrame(rows)
    print(f"✅ Loaded {len(df)} records from MongoDB")
    return df


def load_from_csv(path):
    """Load records from a CSV file (fallback)."""
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path)
    print(f"✅ Loaded {len(df)} records from CSV: {path}")
    return df


# ───────────────── Feature engineering ────────────────────────

def engineer_features(df):
    """
    Build time-series features from raw DTI records.

    For each product, records are sorted by date and enriched with:
      day_number, month, day_of_week, lag_1..3, rolling_mean_3, etc.
    """
    df = df.copy()
    df['average_price'] = pd.to_numeric(df['average_price'], errors='coerce')
    df['price_low'] = pd.to_numeric(df['price_low'], errors='coerce').fillna(0)
    df['price_high'] = pd.to_numeric(df['price_high'], errors='coerce').fillna(0)
    df = df[df['average_price'].notnull() & (df['average_price'] > 0)].copy()

    if df.empty:
        return df

    # Parse dates
    df['date'] = pd.to_datetime(df['file_date'], errors='coerce')
    df = df[df['date'].notnull()].copy()

    # Normalise product name for grouping
    df['product_key'] = df['product_name'].str.lower().str.strip()

    # --- Per-date average (if multiple records on same day for same product) ---
    agg = df.groupby(['product_key', 'date']).agg({
        'average_price': 'mean',
        'price_low': 'min',
        'price_high': 'max',
        'unit': 'first',
        'product_name': 'first',
        'source_file': 'first',
    }).reset_index().sort_values(['product_key', 'date'])

    # --- Day number (days since product's first date) ---
    agg['day_number'] = agg.groupby('product_key')['date'].transform(
        lambda s: (s - s.min()).dt.days
    )

    # Calendar features
    agg['month'] = agg['date'].dt.month
    agg['day_of_week'] = agg['date'].dt.dayofweek  # Mon=0 Sun=6

    # Price spread
    agg['price_spread'] = agg['price_high'] - agg['price_low']

    # --- Lag features (per product) ---
    for lag in [1, 2, 3]:
        agg[f'lag_{lag}'] = agg.groupby('product_key')['average_price'].shift(lag)

    # Rolling mean (3-day)
    agg['rolling_mean_3'] = agg.groupby('product_key')['average_price'].transform(
        lambda s: s.rolling(3, min_periods=1).mean()
    )

    # TF-IDF source text
    agg['name_text'] = agg['product_name'].fillna('')

    # Fill NaN lags with forward-fill per product (avoids leaking the target)
    for lag in [1, 2, 3]:
        agg[f'lag_{lag}'] = agg.groupby('product_key')[f'lag_{lag}'].ffill()
        # For the very first records where ffill still leaves NaN, use 0
        agg[f'lag_{lag}'] = agg[f'lag_{lag}'].fillna(0)

    agg['unit'] = agg['unit'].fillna('kg')

    return agg


# ───────────────── Pipeline builder ───────────────────────────

FEATURE_COLS = [
    'name_text', 'unit',
    'day_number', 'month', 'day_of_week',
    'lag_1', 'lag_2', 'lag_3', 'rolling_mean_3',
]


def build_pipeline(n_estimators=300):
    text_pipe = Pipeline([
        ('tfidf', TfidfVectorizer(max_features=2000, ngram_range=(1, 2)))
    ])
    unit_pipe = Pipeline([
        ('ohe', OneHotEncoder(handle_unknown='ignore', sparse_output=False))
    ])
    num_pipe = Pipeline([
        ('scale', StandardScaler())
    ])

    num_features = [
        'day_number', 'month', 'day_of_week',
        'lag_1', 'lag_2', 'lag_3', 'rolling_mean_3',
    ]

    pre = ColumnTransformer(transformers=[
        ('text', text_pipe, 'name_text'),
        ('unit', unit_pipe, ['unit']),
        ('num', num_pipe, num_features),
    ], remainder='drop')

    pipe = Pipeline([
        ('pre', pre),
        ('rf', RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=20,
            min_samples_leaf=2,
            n_jobs=-1,
            random_state=42,
        ))
    ])
    return pipe


# ───────────────── Training ───────────────────────────────────

def main(args):
    os.makedirs(OUT_DIR, exist_ok=True)

    # Step 1: Load data (MongoDB first, CSV fallback)
    df = None
    if not args.csv_only:
        df = load_from_mongodb()
    if df is None:
        csv_path = args.csv or DATA_CSV
        df = load_from_csv(csv_path)
    if df is None or df.empty:
        print("❌ No data available. Upload DTI PDFs first or provide a CSV.")
        sys.exit(1)

    # Step 2: Feature engineering
    print("⚙  Engineering features…")
    feat = engineer_features(df)
    if feat.empty:
        print("❌ No valid records after feature engineering.")
        sys.exit(1)

    X = feat[FEATURE_COLS]
    y = feat['average_price'].values

    print(f"   {len(X)} samples · {X['name_text'].nunique()} products")

    # Step 3: Train / test split (time-aware: last 20% of each product)
    if args.time_split:
        # Chronological split per product
        train_idx, test_idx = [], []
        for _, grp in feat.groupby('product_key'):
            n = len(grp)
            cutoff = int(n * (1 - args.test_size))
            train_idx.extend(grp.index[:cutoff])
            test_idx.extend(grp.index[cutoff:])
        X_train, X_test = X.loc[train_idx], X.loc[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=args.test_size, random_state=42
        )

    # Step 4: Build and train
    print(f"🏋  Training RandomForest ({args.n_estimators} trees)…")
    pipeline = build_pipeline(n_estimators=args.n_estimators)
    pipeline.fit(X_train, y_train)

    # Step 5: Evaluate
    y_pred = pipeline.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = mean_squared_error(y_test, y_pred) ** 0.5
    r2 = r2_score(y_test, y_pred)

    print(f"   MAE:  ₱{mae:.2f}")
    print(f"   RMSE: ₱{rmse:.2f}")
    print(f"   R²:   {r2:.4f}")

    # Step 6: Save model + metadata
    out_path = args.out or OUT_MODEL
    meta_path = args.meta or OUT_META

    joblib.dump(pipeline, out_path)

    # Save feature column list so the engine knows which columns to build
    meta = {
        'model': 'RandomForestRegressor',
        'n_estimators': args.n_estimators,
        'features': FEATURE_COLS,
        'trained_at': datetime.utcnow().isoformat(),
        'training_samples': int(len(y_train)),
        'test_samples': int(len(y_test)),
        'mae': round(float(mae), 4),
        'rmse': round(float(rmse), 4),
        'r2': round(float(r2), 4),
    }
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"\n✅ Model saved to {out_path}")
    print(f"✅ Metadata saved to {meta_path}")


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Train DTI price forecasting model')
    p.add_argument('--csv', default=None, help='Path to CSV (fallback if MongoDB unavailable)')
    p.add_argument('--csv-only', action='store_true', help='Skip MongoDB, use CSV only')
    p.add_argument('--out', default=None, help='Output model path')
    p.add_argument('--meta', default=None, help='Output metadata path')
    p.add_argument('--n-estimators', type=int, default=300, help='Number of RF trees')
    p.add_argument('--test-size', type=float, default=0.2, help='Test set fraction')
    p.add_argument('--time-split', action='store_true', default=True,
                   help='Use chronological train/test split (default: True)')
    p.add_argument('--no-time-split', dest='time_split', action='store_false',
                   help='Use random train/test split instead')
    args = p.parse_args()
    main(args)
