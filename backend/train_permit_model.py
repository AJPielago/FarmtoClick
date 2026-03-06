"""
Train Permit Classifier
========================
Trains a machine-learning model to classify images as either:
  - **authentic** DTI business permits
  - **non_permit** (random photos, selfies, screenshots, etc.)

Because you may only have a handful of real permit images, the script
includes **heavy data augmentation** to synthesize many realistic
training variants from each original.

Usage
-----
1. Place your authentic permit images in:
       training_data/authentic/

2. Place NON-permit images (selfies, food, scenery, random docs) in:
       training_data/non_permit/

   Don't have non-permit images?  The script can auto-generate synthetic
   negatives if you run it with --generate-negatives.

3. Run:
       python train_permit_model.py

   or with auto-negatives:
       python train_permit_model.py --generate-negatives

4. The trained model is saved to:
       ml_models/permit_classifier.pkl

The verification system loads this model automatically on startup.
"""

import os
import sys
import glob
import json
import random
import argparse
import numpy as np
import cv2
from datetime import datetime
from pathlib import Path

from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_val_score, GroupKFold, train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.pipeline import Pipeline
import joblib

# Resolve project paths
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _SCRIPT_DIR)

from permit_feature_extractor import PermitFeatureExtractor, FEATURE_NAMES

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
TRAINING_DATA_DIR = os.path.join(_SCRIPT_DIR, 'training_data')
AUTHENTIC_DIR = os.path.join(TRAINING_DATA_DIR, 'authentic')
NON_PERMIT_DIR = os.path.join(TRAINING_DATA_DIR, 'non_permit')
AUGMENTED_DIR = os.path.join(TRAINING_DATA_DIR, 'augmented')
MODEL_DIR = os.path.join(_SCRIPT_DIR, 'ml_models')
MODEL_PATH = os.path.join(MODEL_DIR, 'permit_classifier.pkl')
SCALER_PATH = os.path.join(MODEL_DIR, 'permit_scaler.pkl')
METADATA_PATH = os.path.join(MODEL_DIR, 'model_metadata.json')

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}


# ===================================================================
# 1.  DATA AUGMENTATION
# ===================================================================
class PermitAugmentor:
    """
    Generate many realistic image variants from a single permit photo.
    Simulates real-world capture conditions: angle, lighting, noise,
    partial crop, blur, colour jitter, etc.
    """

    def __init__(self, output_dir, augmentations_per_image=30):
        self.output_dir = output_dir
        self.n = augmentations_per_image
        os.makedirs(output_dir, exist_ok=True)

    def augment_image(self, image_path, label_prefix='aug'):
        """Generate self.n augmented copies of the given image."""
        img = cv2.imread(image_path)
        if img is None:
            print(f"  [WARN] Cannot read {image_path}")
            return []

        base = Path(image_path).stem
        generated = []

        for i in range(self.n):
            aug = img.copy()
            ops_applied = []

            # --- Rotation (slight tilt ±15°) ---
            if random.random() < 0.7:
                angle = random.uniform(-15, 15)
                h, w = aug.shape[:2]
                M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
                aug = cv2.warpAffine(aug, M, (w, h),
                                     borderMode=cv2.BORDER_REPLICATE)
                ops_applied.append('rot')

            # --- Perspective warp (simulates camera angle) ---
            if random.random() < 0.5:
                h, w = aug.shape[:2]
                d = int(min(h, w) * random.uniform(0.02, 0.08))
                pts1 = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
                pts2 = np.float32([
                    [random.randint(0, d), random.randint(0, d)],
                    [w - random.randint(0, d), random.randint(0, d)],
                    [random.randint(0, d), h - random.randint(0, d)],
                    [w - random.randint(0, d), h - random.randint(0, d)],
                ])
                M = cv2.getPerspectiveTransform(pts1, pts2)
                aug = cv2.warpPerspective(aug, M, (w, h),
                                          borderMode=cv2.BORDER_REPLICATE)
                ops_applied.append('persp')

            # --- Random crop (75-100% of image) ---
            if random.random() < 0.6:
                h, w = aug.shape[:2]
                crop_pct = random.uniform(0.75, 0.98)
                new_h, new_w = int(h * crop_pct), int(w * crop_pct)
                y = random.randint(0, h - new_h)
                x = random.randint(0, w - new_w)
                aug = aug[y:y + new_h, x:x + new_w]
                ops_applied.append('crop')

            # --- Brightness change ---
            if random.random() < 0.7:
                factor = random.uniform(0.6, 1.5)
                aug = np.clip(aug * factor, 0, 255).astype(np.uint8)
                ops_applied.append('bright')

            # --- Contrast change ---
            if random.random() < 0.5:
                factor = random.uniform(0.5, 1.8)
                mean = np.mean(aug)
                aug = np.clip((aug - mean) * factor + mean, 0, 255).astype(np.uint8)
                ops_applied.append('contrast')

            # --- Gaussian noise ---
            if random.random() < 0.4:
                sigma = random.uniform(5, 25)
                noise = np.random.normal(0, sigma, aug.shape)
                aug = np.clip(aug + noise, 0, 255).astype(np.uint8)
                ops_applied.append('noise')

            # --- Gaussian blur ---
            if random.random() < 0.4:
                k = random.choice([3, 5, 7])
                aug = cv2.GaussianBlur(aug, (k, k), 0)
                ops_applied.append('blur')

            # --- JPEG compression artefacts ---
            if random.random() < 0.5:
                quality = random.randint(20, 70)
                _, buf = cv2.imencode('.jpg', aug,
                                      [cv2.IMWRITE_JPEG_QUALITY, quality])
                aug = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                ops_applied.append('jpeg')

            # --- Colour jitter (hue/saturation shift) ---
            if random.random() < 0.4:
                hsv = cv2.cvtColor(aug, cv2.COLOR_BGR2HSV).astype(np.float64)
                hsv[:, :, 0] = (hsv[:, :, 0] + random.uniform(-10, 10)) % 180
                hsv[:, :, 1] = np.clip(hsv[:, :, 1] * random.uniform(0.7, 1.3), 0, 255)
                aug = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
                ops_applied.append('colour')

            # --- Horizontal flip (rare, permits are usually oriented) ---
            if random.random() < 0.15:
                aug = cv2.flip(aug, 1)
                ops_applied.append('hflip')

            # --- Scale / resize ---
            if random.random() < 0.5:
                scale = random.uniform(0.5, 1.5)
                h, w = aug.shape[:2]
                new_size = (max(100, int(w * scale)), max(100, int(h * scale)))
                aug = cv2.resize(aug, new_size)
                ops_applied.append('scale')

            # Save
            ops_tag = '_'.join(ops_applied) if ops_applied else 'orig'
            fname = f"{label_prefix}_{base}_{i:03d}_{ops_tag}.jpg"
            out_path = os.path.join(self.output_dir, fname)
            cv2.imwrite(out_path, aug)
            generated.append(out_path)

        return generated


# ===================================================================
# 2.  SYNTHETIC NEGATIVE GENERATOR
# ===================================================================
def generate_synthetic_negatives(n=60, output_dir=None):
    """
    Create fake 'non-permit' images: solid colours, gradients, random
    noise, simple shapes.  These help when you don't have many real
    negative samples.
    """
    out = output_dir or NON_PERMIT_DIR
    os.makedirs(out, exist_ok=True)
    generated = []

    for i in range(n):
        h, w = random.randint(300, 900), random.randint(400, 1200)
        kind = random.choice(['noise', 'solid', 'gradient', 'shapes', 'stripes'])

        if kind == 'noise':
            img = np.random.randint(0, 256, (h, w, 3), dtype=np.uint8)
        elif kind == 'solid':
            colour = [random.randint(0, 255) for _ in range(3)]
            img = np.full((h, w, 3), colour, dtype=np.uint8)
        elif kind == 'gradient':
            img = np.zeros((h, w, 3), dtype=np.uint8)
            for c in range(3):
                img[:, :, c] = np.linspace(
                    random.randint(0, 128), random.randint(128, 255), w,
                    dtype=np.uint8).reshape(1, -1).repeat(h, axis=0)
        elif kind == 'shapes':
            img = np.full((h, w, 3), 240, dtype=np.uint8)
            for _ in range(random.randint(5, 20)):
                color = tuple(random.randint(0, 255) for _ in range(3))
                pt1 = (random.randint(0, w), random.randint(0, h))
                pt2 = (random.randint(0, w), random.randint(0, h))
                thickness = random.randint(1, 5)
                shape = random.choice(['rect', 'circle', 'line'])
                if shape == 'rect':
                    cv2.rectangle(img, pt1, pt2, color, thickness)
                elif shape == 'circle':
                    cv2.circle(img, pt1, random.randint(10, 100), color, thickness)
                else:
                    cv2.line(img, pt1, pt2, color, thickness)
        else:  # stripes
            img = np.zeros((h, w, 3), dtype=np.uint8)
            stripe_w = random.randint(5, 30)
            for x in range(0, w, stripe_w * 2):
                img[:, x:x + stripe_w] = [random.randint(100, 255)] * 3

        fpath = os.path.join(out, f'synth_neg_{i:04d}.jpg')
        cv2.imwrite(fpath, img)
        generated.append(fpath)

    print(f"  [OK] Generated {len(generated)} synthetic negatives in {out}")
    return generated


# ===================================================================
# 3.  FEATURE EXTRACTION PIPELINE
# ===================================================================
def collect_image_paths(directory):
    """Return list of image file paths in a directory."""
    paths = []
    for ext in IMAGE_EXTENSIONS:
        paths.extend(glob.glob(os.path.join(directory, f'*{ext}')))
        paths.extend(glob.glob(os.path.join(directory, f'*{ext.upper()}')))
    return sorted(set(paths))


def extract_dataset(extractor, image_paths, label):
    """Extract features from a list of images and assign a label.
    Returns (X_list, y_list, paths_list)."""
    X, y, used_paths = [], [], []
    for path in image_paths:
        features = extractor.extract_all_features(path)
        if features is None:
            continue
        vec = extractor.features_to_vector(features)
        X.append(vec)
        y.append(label)
        used_paths.append(path)
    return X, y, used_paths


# ===================================================================
# 4.  TRAINING
# ===================================================================
def train_model(X, y, feature_names, groups=None):
    """Train an ensemble classifier and return (pipeline, report)."""
    X = np.array(X)
    y = np.array(y)

    print(f"\n[DATA] Dataset: {len(y)} samples, "
          f"{np.sum(y == 1)} authentic, {np.sum(y == 0)} non-permit")
    print(f"   Features per sample: {X.shape[1]}")

    # --- Build pipeline ---
    scaler = StandardScaler()

    # We train three models and pick the best via cross-validation
    classifiers = {
        'RandomForest': RandomForestClassifier(
            n_estimators=200,
            max_depth=None,
            min_samples_split=2,
            min_samples_leaf=1,
            class_weight='balanced',
            random_state=42,
            n_jobs=-1,
        ),
        'GradientBoosting': GradientBoostingClassifier(
            n_estimators=150,
            max_depth=5,
            learning_rate=0.1,
            random_state=42,
        ),
        'SVM': SVC(
            kernel='rbf',
            C=10,
            gamma='scale',
            class_weight='balanced',
            probability=True,
            random_state=42,
        ),
    }

    best_name, best_score, best_pipeline = None, -1, None

    # Use group-aware splitting if groups are provided (keeps augmentations
    # from the same source image in the same fold to prevent data leakage)
    unique_groups = None
    if groups is not None:
        unique_groups = list(set(groups))

    for name, clf in classifiers.items():
        pipe = Pipeline([
            ('scaler', StandardScaler()),
            ('classifier', clf),
        ])

        try:
            if unique_groups is not None and len(unique_groups) >= 3:
                n_splits = min(5, len(unique_groups))
                gkf = GroupKFold(n_splits=n_splits)
                scores = cross_val_score(pipe, X, y, cv=gkf, groups=groups, scoring='f1')
            else:
                n_splits = min(5, max(2, min(np.sum(y == 0), np.sum(y == 1))))
                skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
                scores = cross_val_score(pipe, X, y, cv=skf, scoring='f1')
            mean_score = scores.mean()
            print(f"   {name:20s}  CV F1 = {mean_score:.4f} (±{scores.std():.4f})")
        except Exception as e:
            print(f"   {name:20s}  CV failed: {e}")
            mean_score = 0

        if mean_score > best_score:
            best_score = mean_score
            best_name = name
            best_pipeline = pipe

    # Hold-out test split (group-aware to avoid leakage)
    print(f"\n[BEST] Best model: {best_name} (CV F1={best_score:.4f})")

    if unique_groups is not None and len(unique_groups) >= 5:
        from sklearn.model_selection import GroupShuffleSplit
        gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
        train_idx, test_idx = next(gss.split(X, y, groups=groups))
        X_train = [X[i] for i in train_idx]
        X_test = [X[i] for i in test_idx]
        y_train = [y[i] for i in train_idx]
        y_test = [y[i] for i in test_idx]
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

    best_pipeline.fit(X_train, y_train)

    # Evaluate on held-out test set (not training data)
    y_pred = best_pipeline.predict(X_test)
    report = classification_report(
        y_test, y_pred,
        target_names=['non_permit', 'authentic'],
        output_dict=True,
    )
    print("\n[REPORT] Held-out test-set classification report:")
    print(classification_report(y_test, y_pred,
                                target_names=['non_permit', 'authentic']))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    # Feature importances (if available)
    clf_step = best_pipeline.named_steps['classifier']
    importances = {}
    if hasattr(clf_step, 'feature_importances_'):
        for fname, imp in sorted(zip(feature_names, clf_step.feature_importances_),
                                  key=lambda x: -x[1]):
            importances[fname] = round(float(imp), 4)
            if imp > 0.01:
                print(f"   {fname:30s} importance = {imp:.4f}")

    return best_pipeline, {
        'best_model': best_name,
        'cv_f1_score': round(best_score, 4),
        'report': report,
        'feature_importances': importances,
    }


# ===================================================================
# 5.  MAIN
# ===================================================================
def main():
    parser = argparse.ArgumentParser(description='Train DTI Permit Classifier')
    parser.add_argument('--generate-negatives', action='store_true',
                        help='Auto-generate synthetic negative images')
    parser.add_argument('--augment-count', type=int, default=30,
                        help='Number of augmented copies per authentic image (default: 30)')
    parser.add_argument('--neg-count', type=int, default=60,
                        help='Number of synthetic negatives to generate (default: 60)')
    args = parser.parse_args()

    print("=" * 60)
    print("  DTI Business Permit — ML Model Training")
    print("=" * 60)

    # --- Ensure directories ---
    os.makedirs(AUTHENTIC_DIR, exist_ok=True)
    os.makedirs(NON_PERMIT_DIR, exist_ok=True)
    os.makedirs(MODEL_DIR, exist_ok=True)

    # --- Check for authentic images ---
    authentic_paths = collect_image_paths(AUTHENTIC_DIR)
    if not authentic_paths:
        print(f"\n[ERROR] No authentic permit images found in:\n   {AUTHENTIC_DIR}\n")
        print("   Please place at least 1 DTI business permit photo in that folder")
        print("   and run this script again.\n")
        sys.exit(1)

    print(f"\n[OK] Found {len(authentic_paths)} authentic permit image(s)")

    # --- Generate synthetic negatives if requested or if none exist ---
    non_permit_paths = collect_image_paths(NON_PERMIT_DIR)
    if args.generate_negatives or not non_permit_paths:
        if not non_permit_paths:
            print("   No non-permit images found — auto-generating synthetic negatives...")
        generate_synthetic_negatives(n=args.neg_count)
        non_permit_paths = collect_image_paths(NON_PERMIT_DIR)

    print(f"[OK] Found {len(non_permit_paths)} non-permit image(s)")

    # --- Augment authentic images ---
    print(f"\n[AUG] Augmenting {len(authentic_paths)} authentic image(s) "
          f"x {args.augment_count} variants each...")
    aug_auth_dir = os.path.join(AUGMENTED_DIR, 'authentic')
    aug_neg_dir = os.path.join(AUGMENTED_DIR, 'non_permit')

    augmentor = PermitAugmentor(aug_auth_dir, augmentations_per_image=args.augment_count)
    all_authentic = list(authentic_paths)  # originals
    for path in authentic_paths:
        generated = augmentor.augment_image(path, label_prefix='auth')
        all_authentic.extend(generated)
    print(f"   Total authentic samples (orig + augmented): {len(all_authentic)}")

    # Also augment non-permit images (less aggressively)
    augmentor_neg = PermitAugmentor(aug_neg_dir, augmentations_per_image=max(5, args.augment_count // 3))
    all_non_permit = list(non_permit_paths)
    for path in non_permit_paths:
        generated = augmentor_neg.augment_image(path, label_prefix='neg')
        all_non_permit.extend(generated)
    print(f"   Total non-permit samples (orig + augmented): {len(all_non_permit)}")

    # --- Extract features ---
    print("\n[FEAT] Extracting features...")
    extractor = PermitFeatureExtractor()

    X_auth, y_auth, paths_auth = extract_dataset(extractor, all_authentic, label=1)
    X_neg, y_neg, paths_neg = extract_dataset(extractor, all_non_permit, label=0)

    print(f"   Authentic feature vectors: {len(X_auth)}")
    print(f"   Non-permit feature vectors: {len(X_neg)}")

    if len(X_auth) < 2 or len(X_neg) < 2:
        print("\n[ERROR] Not enough valid samples to train. Need >=2 of each class.")
        sys.exit(1)

    X = X_auth + X_neg
    y = y_auth + y_neg
    all_paths = paths_auth + paths_neg

    # Build group IDs from source image (so augmentations stay together)
    def _source_group(p):
        """Map an image path to its source image name (strip aug prefix)."""
        base = os.path.basename(p)
        # Augmented files look like: auth_<origname>_<idx>.ext or neg_<origname>_<idx>.ext
        for prefix in ('auth_', 'neg_'):
            if base.startswith(prefix):
                # Remove prefix and trailing _NNN before the extension
                core = base[len(prefix):]
                parts = core.rsplit('_', 1)
                if len(parts) == 2 and parts[1].split('.')[0].isdigit():
                    return parts[0]
        return base

    groups = [_source_group(p) for p in all_paths]

    # --- Train ---
    print("\n[TRAIN] Training classifier...")
    pipeline, metadata = train_model(X, y, FEATURE_NAMES, groups=groups)

    # --- Save model ---
    joblib.dump(pipeline, MODEL_PATH)
    print(f"\n[SAVE] Model saved to: {MODEL_PATH}")

    # --- Save metadata ---
    metadata.update({
        'trained_at': datetime.now().isoformat(),
        'authentic_images_used': len(authentic_paths),
        'total_authentic_samples': len(X_auth),
        'total_non_permit_samples': len(X_neg),
        'feature_names': FEATURE_NAMES,
        'model_path': MODEL_PATH,
    })
    with open(METADATA_PATH, 'w') as f:
        json.dump(metadata, f, indent=2, default=str)
    print(f"[META] Metadata saved to: {METADATA_PATH}")

    print("\n" + "=" * 60)
    print("  [DONE] Training complete!")
    print(f"     Best model:  {metadata['best_model']}")
    print(f"     CV F1 score: {metadata['cv_f1_score']}")
    print("=" * 60)
    print("\nThe model will be loaded automatically when the Flask server starts.")
    print("To retrain, add more images to training_data/ and run this script again.\n")


if __name__ == '__main__':
    main()
