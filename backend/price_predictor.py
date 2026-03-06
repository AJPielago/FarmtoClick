import os
import argparse
import joblib
import json
from datetime import datetime

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'ml_models', 'price_model_rf.pkl')
META_PATH = os.path.join(os.path.dirname(__file__), 'ml_models', 'price_model_rf_metadata.json')

def month_from_iso(s):
    try:
        return datetime.fromisoformat(s).month
    except Exception:
        return 0

def _load_expected_features():
    """Read the feature list from model metadata so predictions stay in sync with training."""
    try:
        with open(META_PATH, 'r') as f:
            meta = json.load(f)
        return meta.get('features', [])
    except Exception:
        return []

def predict(model, product_name, source_file='', unit='kg', file_date=None,
           day_number=0, lag_1=0, lag_2=0, lag_3=0, rolling_mean_3=0):
    name_text = f"{product_name} __ {source_file}"
    month = month_from_iso(file_date) if file_date else 0
    day_of_week = 0
    try:
        if file_date:
            day_of_week = datetime.fromisoformat(file_date).weekday()
    except Exception:
        pass

    row = {
        'name_text': name_text,
        'unit': unit,
        'day_number': day_number,
        'month': month,
        'day_of_week': day_of_week,
        'lag_1': lag_1,
        'lag_2': lag_2,
        'lag_3': lag_3,
        'rolling_mean_3': rolling_mean_3,
    }

    # If the trained model still expects the old features (price_low/high/spread),
    # provide them as zeros so it doesn't crash with the old .pkl file.
    expected = _load_expected_features()
    for col in expected:
        if col not in row:
            row[col] = 0

    pred = model.predict([row])[0]
    return float(pred)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--model', default=MODEL_PATH)
    p.add_argument('--product', required=True)
    p.add_argument('--source-file', default='')
    p.add_argument('--unit', default='kg')
    p.add_argument('--file-date', default=None)
    args = p.parse_args()

    model = joblib.load(args.model)
    pred = predict(model, args.product, args.source_file, args.unit, args.file_date)
    print(json.dumps({'predicted_price': round(pred,2)}))
