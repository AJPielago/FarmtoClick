import os
import csv
from datetime import datetime
from dti_price_engine import parse_dti_pdf

PDF_DIR = os.path.join(os.path.dirname(__file__), 'static', 'uploads', 'dti_pdfs')
OUT_DIR = os.path.join(os.path.dirname(__file__), 'data')
OUT_CSV = os.path.join(OUT_DIR, 'dti_records.csv')

os.makedirs(OUT_DIR, exist_ok=True)

def file_mtime_iso(path):
    try:
        return datetime.utcfromtimestamp(os.path.getmtime(path)).isoformat()
    except Exception:
        return ''

rows = []
if not os.path.isdir(PDF_DIR):
    print(f"PDF folder not found: {PDF_DIR}")
else:
    for fname in sorted(os.listdir(PDF_DIR)):
        if not fname.lower().endswith('.pdf'):
            continue
        path = os.path.join(PDF_DIR, fname)
        try:
            records, raw = parse_dti_pdf(path)
        except Exception as e:
            print(f"Failed to parse {fname}: {e}")
            continue
        ts = file_mtime_iso(path)
        for r in records:
            rows.append({
                'source_file': fname,
                'file_date': ts,
                'product_name': r.get('product_name'),
                'price_low': r.get('price_low', ''),
                'price_high': r.get('price_high', ''),
                'average_price': r.get('average_price', ''),
                'unit': r.get('unit', ''),
            })

if not rows:
    print("No records extracted.")
else:
    with open(OUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUT_CSV}")
