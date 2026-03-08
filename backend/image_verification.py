"""
Business Permit Verification System (QR + ML + Name Cross-Check)
================================================================
Verifies farmers using a multi-layer approach:

  **Layer 1 - QR Code Verification**
    Scans the QR code on the DTI permit and validates it against the
    official DTI BNRS website.

  **Layer 2 - Trained ML Classifier**
    A machine-learning model (Random Forest / Gradient Boosting / SVM)
    trained on real permit images to classify whether an uploaded image
    is an authentic DTI business permit.

  **Layer 3 - Name Cross-Verification**
    Compares the business name and owner name provided by the applicant
    against the data scraped from the DTI BNRS page (via QR code link).

All layers run together.  The final decision combines their scores.
"""

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import os
import re
import json
import requests
from datetime import datetime
from urllib.parse import urlparse
from difflib import SequenceMatcher

try:
    from pyzbar.pyzbar import decode as pyzbar_decode
    from pyzbar.pyzbar import ZBarSymbol
    PYZBAR_AVAILABLE = True
except ImportError:
    PYZBAR_AVAILABLE = False
    print("[WARN] pyzbar not installed - QR verification will be unavailable. "
          "Install with: pip install pyzbar")

# OCR support
try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("[WARN] pytesseract not installed - OCR fallback will be unavailable. "
          "Install with: pip install pytesseract")

# Fuzzy matching for text extraction
try:
    from fuzzywuzzy import fuzz
    FUZZYWUZZY_AVAILABLE = True
except ImportError:
    FUZZYWUZZY_AVAILABLE = False
    print("[WARN] fuzzywuzzy not installed - text fuzzy matching will be slower. "
          "Install with: pip install fuzzywuzzy[speedup]")

# ML model loading
try:
    import joblib
    JOBLIB_AVAILABLE = True
except ImportError:
    JOBLIB_AVAILABLE = False


class ImageVerificationSystem:
    """QR-code + ML + Name-cross-check DTI business permit verification."""

    # Minimum similarity ratio for fuzzy name matching (0.0 - 1.0)
    NAME_MATCH_THRESHOLD = 0.65

    # Known DTI / BNRS domains that appear in QR codes
    DTI_DOMAINS = [
        'bnrs.dti.gov.ph',
        'www.bnrs.dti.gov.ph',
        'dti.gov.ph',
        'www.dti.gov.ph',
    ]

    # Patterns that match DTI business-name registration URLs
    DTI_URL_PATTERNS = [
        r'https?://bnrs\.dti\.gov\.ph',
        r'https?://www\.bnrs\.dti\.gov\.ph',
        r'https?://(?:www\.)?dti\.gov\.ph',
    ]

    # Trusted domains that may host DTI permit registration pages
    # (e.g. new DTI QR codes redirect to Google Sites or use QR shorteners)
    TRUSTED_PERMIT_DOMAINS = [
        'bnrs.dti.gov.ph',
        'www.bnrs.dti.gov.ph',
        'dti.gov.ph',
        'www.dti.gov.ph',
        'sites.google.com',
        'qrs.ly',
        'q.me-qr.com',
    ]

    # Patterns that match any verifiable permit QR URL
    PERMIT_URL_PATTERNS = [
        r'https?://bnrs\.dti\.gov\.ph',
        r'https?://www\.bnrs\.dti\.gov\.ph',
        r'https?://(?:www\.)?dti\.gov\.ph',
        r'https?://sites\.google\.com/view/.+',
        r'https?://qrs\.ly/.+',
        r'https?://q\.me-qr\.com/.+',
    ]

    def __init__(self, quiet=False):
        """Initialise the verification system and load ML model if available."""
        self._quiet = quiet
        if not PYZBAR_AVAILABLE:
            print("[WARN] QR verification disabled - pyzbar not found.")

        # --- Load trained ML model ---
        self.ml_model = None
        self.ml_extractor = None
        self._load_ml_model()

    def _load_ml_model(self):
        """Attempt to load the trained permit classifier from disk."""
        if not JOBLIB_AVAILABLE:
            print("[WARN] joblib not available - ML classifier disabled.")
            return

        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            'ml_models', 'permit_classifier.pkl',
        )
        if not os.path.exists(model_path):
            print("[INFO] No trained ML model found at ml_models/permit_classifier.pkl")
            print("   Run 'python train_permit_model.py' to train one.")
            return

        try:
            self.ml_model = joblib.load(model_path)
            from permit_feature_extractor import PermitFeatureExtractor
            self.ml_extractor = PermitFeatureExtractor()
            if not getattr(self, '_quiet', False):
                print("[OK] ML permit classifier loaded!")
        except Exception as e:
            print(f"[WARN] Failed to load ML model: {e}")
            self.ml_model = None
            self.ml_extractor = None

    # ------------------------------------------------------------------
    # ML Prediction
    # ------------------------------------------------------------------
    def predict_permit_ml(self, image_path):
        """
        Run the trained ML model on the image.
        Returns dict with is_permit (bool), confidence (float 0-1), label.
        """
        result = {
            'available': False,
            'is_permit': False,
            'confidence': 0.0,
            'label': 'unknown',
        }
        if self.ml_model is None or self.ml_extractor is None:
            return result

        try:
            features = self.ml_extractor.extract_all_features(image_path)
            if features is None:
                return result

            vec = self.ml_extractor.features_to_vector(features).reshape(1, -1)
            prediction = self.ml_model.predict(vec)[0]

            # Get probability if the model supports it
            if hasattr(self.ml_model, 'predict_proba'):
                proba = self.ml_model.predict_proba(vec)[0]
                confidence = float(max(proba))
            else:
                confidence = 0.85 if prediction == 1 else 0.15

            result['available'] = True
            result['is_permit'] = bool(prediction == 1)
            result['confidence'] = round(confidence, 4)
            result['label'] = 'authentic' if prediction == 1 else 'non_permit'
            return result
        except Exception as e:
            print(f"ML prediction error: {e}")
            return result

    # ------------------------------------------------------------------
    # 1. Image quality
    # ------------------------------------------------------------------
    def check_image_quality(self, image_path):
        """Ensure the uploaded image is readable and of decent quality."""
        try:
            img = cv2.imread(image_path)
            if img is None:
                return False, "Invalid image file"
            # Use a fixed-size resize for consistent clarity measurements
            # (reduces variance between camera resolutions and compression).
            standard_w, standard_h = 800, 600
            orig_h, orig_w = img.shape[:2]
            if orig_h < 200 or orig_w < 200:
                return False, f"Image too small ({orig_w}×{orig_h}). Please upload at least 400×300."

            try:
                resized = cv2.resize(img, (standard_w, standard_h), interpolation=cv2.INTER_AREA)
            except Exception:
                resized = img

            gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
            lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()

            # Lowered threshold to reduce false positives on compressed/phone images
            BLUR_THRESHOLD = 10.0
            if lap_var < BLUR_THRESHOLD:
                brightness = np.mean(gray)
                return False, (
                    f"Image is too blurry (clarity={lap_var:.1f} < {BLUR_THRESHOLD}). "
                    f"Brightness={brightness:.0f}. Please take a clearer, well-lit photo with the QR code in focus."
                )

            # Brightness range: 20-253 (permits on white paper are naturally
            # very bright — scanned DTI permits regularly hit 240-250)
            brightness = np.mean(gray)
            if brightness < 20 or brightness > 253:
                return False, (
                    f"Image brightness is poor ({brightness:.0f}). "
                    "Ensure good lighting when photographing the permit."
                )

            return True, "Image quality OK"
        except Exception as e:
            return False, f"Quality check error: {e}"

    # ------------------------------------------------------------------
    # 2. QR Code scanning (multiple strategies)
    # ------------------------------------------------------------------
    def _decode_qr_from_array(self, img_array):
        """Run pyzbar on a numpy/PIL array and return decoded objects."""
        if not PYZBAR_AVAILABLE:
            return []
        # Try QR-only first for speed, then ANY barcode as fallback
        results = pyzbar_decode(img_array, symbols=[ZBarSymbol.QRCODE])
        if not results:
            results = pyzbar_decode(img_array)
        return results

    def _preprocess_variants(self, image_path):
        """
        Generator that yields multiple preprocessed versions of the image
        to maximise QR detection success rate.
        """
        img = Image.open(image_path)

        # 1️⃣  Original
        yield np.array(img), "original"

        # 2️⃣  Grayscale
        gray = img.convert('L')
        yield np.array(gray), "grayscale"

        # 3️⃣  High contrast grayscale
        enhancer = ImageEnhance.Contrast(gray)
        yield np.array(enhancer.enhance(2.5)), "high-contrast"

        # 4️⃣  Sharpened
        sharpened = img.filter(ImageFilter.SHARPEN)
        yield np.array(sharpened), "sharpened"

        cv_img = cv2.imread(image_path)
        if cv_img is not None:
            cv_gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
            
            # 5️⃣  Adaptive-threshold via OpenCV
            thresh = cv2.adaptiveThreshold(
                cv_gray, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2,
            )
            yield thresh, "adaptive-threshold"

            # 6️⃣  Otsu binarisation
            _, otsu = cv2.threshold(cv_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            yield otsu, "otsu"

            # 7️⃣  Inverted (white-on-black QR codes)
            yield cv2.bitwise_not(otsu), "inverted-otsu"

            # 8️⃣  Upscaled (helps with small QR codes)
            if cv_gray.shape[0] < 1000:
                upscaled = cv2.resize(cv_gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                _, up_thresh = cv2.threshold(upscaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                yield up_thresh, "upscaled-otsu"

            # 9️⃣ Enhanced contrast + aggressive sharpening
            enhanced_contrast = cv2.convertScaleAbs(cv2.Laplacian(cv_gray, cv2.CV_64F))
            yield enhanced_contrast, "laplacian-enhanced"

            # 🔟 Histogram equalization (improves visibility of dark/light areas)
            eq = cv2.equalizeHist(cv_gray)
            yield eq, "histogram-equalized"

            # 1️⃣1️⃣ Morphological operations - erosion then dilation (cleanup)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            morph = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel)
            yield morph, "morphology-closed"

            # 1️⃣2️⃣ CLAHE (Contrast Limited Adaptive Histogram Equalization)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            clahe_img = clahe.apply(cv_gray)
            yield clahe_img, "clahe"


    def scan_qr_code(self, image_path):
        """
        Attempt to find and decode a QR code from the permit image.
        Returns (success: bool, data: str | error_message: str, method: str).
        Falls back to OCR if QR detection fails.
        """
        if not PYZBAR_AVAILABLE:
            return False, "pyzbar library not installed", ""

        for img_variant, method_name in self._preprocess_variants(image_path):
            decoded = self._decode_qr_from_array(img_variant)
            for obj in decoded:
                try:
                    data = obj.data.decode('utf-8', errors='replace').strip()
                except Exception:
                    data = str(obj.data)
                if data:
                    print(f"[OK] QR decoded via [{method_name}]: {data[:120]}")
                    return True, data, method_name

        # QR detection failed - try OCR fallback
        print("[WARN] QR code not found, attempting OCR fallback...")
        ocr_success, ocr_data = self._extract_text_with_ocr(image_path)
        if ocr_success and ocr_data:
            return True, ocr_data, "ocr-fallback"

        return False, (
            "No QR code detected. Please ensure the QR code on your "
            "DTI Business Permit is clearly visible and not obstructed."
        ), ""

    # ------------------------------------------------------------------
    # 2b. OCR-based text extraction (fallback)
    # ------------------------------------------------------------------
    def _extract_text_with_ocr(self, image_path):
        """
        Extract text from image using Tesseract OCR.
        Returns (success: bool, extracted_text: str).
        """
        if not TESSERACT_AVAILABLE:
            return False, ""

        try:
            img = cv2.imread(image_path)
            if img is None:
                return False, ""

            # Resize large images to a standard width for consistent OCR
            h, w = img.shape[:2]
            target_w = 1200
            if w > target_w:
                scale = target_w / w
                img = cv2.resize(img, (target_w, int(h * scale)), interpolation=cv2.INTER_AREA)

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

            # Try multiple preprocessing strategies; pick the one that yields the most text
            best_text = ""

            # Strategy 1: CLAHE + Otsu
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)
            _, thresh1 = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            text1 = pytesseract.image_to_string(thresh1, config='--psm 6')
            if len(text1.strip()) > len(best_text):
                best_text = text1.strip()

            # Strategy 2: Adaptive threshold
            thresh2 = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 8
            )
            text2 = pytesseract.image_to_string(thresh2, config='--psm 6')
            if len(text2.strip()) > len(best_text):
                best_text = text2.strip()

            # Strategy 3: Simple sharpen + threshold
            kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
            sharpened = cv2.filter2D(gray, -1, kernel)
            _, thresh3 = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            text3 = pytesseract.image_to_string(thresh3, config='--psm 6')
            if len(text3.strip()) > len(best_text):
                best_text = text3.strip()

            if best_text:
                print(f"[INFO] OCR extracted text: {len(best_text)} characters")
                return True, best_text
        except Exception as e:
            print(f"[WARN] OCR extraction failed: {e}")

        return False, ""

    def _extract_dti_id_from_ocr(self, ocr_text):
        """
        Try to extract DTI registration/reference ID from OCR text using fuzzy matching.
        Looks for patterns like registration numbers, reference IDs, etc.
        Returns extracted ID or None.
        """
        if not ocr_text:
            return None

        # Common DTI ID patterns
        patterns = [
            r'(?:Registration|Ref|Reference|ID|No\.?)\s*[:\-]?\s*([A-Z0-9\-]{5,})',
            r'([0-9]{4}[\-/]?[0-9]{4}[\-/]?[0-9]{4})',  # Format: 1234-5678-9012
            r'DTI[\s\-]?([A-Z0-9]{3,})',
            r'BNRS[\s\-]?([A-Z0-9]{3,})',
        ]

        ocr_upper = ocr_text.upper()
        for pattern in patterns:
            matches = re.findall(pattern, ocr_upper)
            for match in matches:
                return match.strip()

        return None

    # ------------------------------------------------------------------
    # 2c. QR Text parsing and permit text verification
    # ------------------------------------------------------------------
    def _parse_qr_text(self, qr_text):
        """
        Parse structured text from QR code into fields.
        Example QR format (text-based):
            BUSINESS NAME: CHRISTIAN WATER REFILLING STATION
            SCOPE: CITY/MUNICIPALITY...
            BUSINESS OWNER: JEFFREY VILLAR BERNABE
            VALIDITY DATE: 12 January 2022 to 12 January 2027
            BUSINESS NAME NO.: 3434737
        
        Returns dict with extracted fields.
        """
        fields = {
            'business_name': None,
            'business_owner': None,
            'validity_date': None,
            'business_number': None,
            'scope': None,
            'raw_text': qr_text,
        }

        lines = qr_text.split('\n')
        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Business name
            if line.upper().startswith('BUSINESS NAME:') and not 'NO.' in line.upper():
                fields['business_name'] = line.split(':', 1)[1].strip()

            # Business owner
            elif line.upper().startswith('BUSINESS OWNER:'):
                fields['business_owner'] = line.split(':', 1)[1].strip()

            # Validity date
            elif line.upper().startswith('VALIDITY DATE:'):
                fields['validity_date'] = line.split(':', 1)[1].strip()

            # Business number
            elif line.upper().startswith('BUSINESS NAME NO.:') or line.upper().startswith('BUSINESS NO.:'):
                fields['business_number'] = line.split(':', 1)[1].strip()

            # Scope
            elif line.upper().startswith('SCOPE:'):
                fields['scope'] = line.split(':', 1)[1].strip()

        return fields

    def _extract_permit_text_details(self, ocr_text):
        """
        Extract permit details from OCR text.
        Tries to find: business name, owner, validity date, business number, scope.
        
        Returns dict with extracted fields.
        """
        fields = {
            'business_name': None,
            'business_owner': None,
            'validity_date': None,
            'business_number': None,
            'scope': None,
        }

        lines = ocr_text.split('\n')
        for line in lines:
            line = line.strip()
            if not line:
                continue

            line_upper = line.upper()

            # Try to extract business name
            if 'BUSINESS NAME' in line_upper and 'NO.' not in line_upper:
                if ':' in line:
                    extracted = line.split(':', 1)[1].strip()
                    if extracted and len(extracted) > 2:
                        fields['business_name'] = extracted

            # Try to extract owner
            elif 'OWNER' in line_upper or 'PROPRIETOR' in line_upper:
                if ':' in line:
                    extracted = line.split(':', 1)[1].strip()
                    if extracted and len(extracted) > 2:
                        fields['business_owner'] = extracted

            # Try to extract validity/expiration date
            elif 'VALIDITY' in line_upper or 'VALID' in line_upper or 'EXPIRES' in line_upper:
                if ':' in line:
                    extracted = line.split(':', 1)[1].strip()
                    if extracted and len(extracted) > 4:
                        fields['validity_date'] = extracted

            # Try to extract business number
            elif 'BUSINESS' in line_upper and ('NO' in line_upper or 'NUMBER' in line_upper or 'REGISTRATION' in line_upper):
                if ':' in line:
                    extracted = line.split(':', 1)[1].strip()
                    if extracted and len(extracted) > 2:
                        fields['business_number'] = extracted

            # Try to extract scope
            elif 'SCOPE' in line_upper:
                if ':' in line:
                    extracted = line.split(':', 1)[1].strip()
                    if extracted and len(extracted) > 2:
                        fields['scope'] = extracted

        return fields

    def _compare_permit_fields(self, qr_fields, permit_fields, threshold=0.70):
        """
        Compare extracted fields from QR vs permit OCR.
        Uses fuzzy matching to account for OCR errors.
        
        Returns (match_status: bool, details: dict, confidence: float).
        """
        if not FUZZYWUZZY_AVAILABLE:
            # Fallback to simple string matching if fuzzywuzzy unavailable
            return self._compare_fields_simple(qr_fields, permit_fields)

        comparison = {
            'business_name_match': False,
            'business_owner_match': False,
            'validity_date_match': False,
            'business_number_match': False,
            'scope_match': False,
            'details': '',
            'mismatches': [],
            'confidence': 0.0,
        }

        matches = 0
        checked = 0

        # Compare business name
        if qr_fields.get('business_name') and permit_fields.get('business_name'):
            checked += 1
            qr_name = qr_fields['business_name'].lower().strip()
            permit_name = permit_fields['business_name'].lower().strip()
            similarity = fuzz.token_set_ratio(qr_name, permit_name) / 100.0
            comparison['business_name_match'] = similarity >= threshold
            if comparison['business_name_match']:
                matches += 1
                comparison['details'] += f"✓ Business name matches ({similarity:.0%}). "
            else:
                comparison['mismatches'].append(
                    f"Business name mismatch ({similarity:.0%}): QR='{qr_fields['business_name']}' vs Permit='{permit_fields['business_name']}'"
                )

        # Compare business owner
        if qr_fields.get('business_owner') and permit_fields.get('business_owner'):
            checked += 1
            qr_owner = qr_fields['business_owner'].lower().strip()
            permit_owner = permit_fields['business_owner'].lower().strip()
            similarity = fuzz.token_set_ratio(qr_owner, permit_owner) / 100.0
            comparison['business_owner_match'] = similarity >= threshold
            if comparison['business_owner_match']:
                matches += 1
                comparison['details'] += f"✓ Owner name matches ({similarity:.0%}). "
            else:
                comparison['mismatches'].append(
                    f"Owner mismatch ({similarity:.0%}): QR='{qr_fields['business_owner']}' vs Permit='{permit_fields['business_owner']}'"
                )

        # Compare business number
        if qr_fields.get('business_number') and permit_fields.get('business_number'):
            checked += 1
            qr_num = qr_fields['business_number'].strip()
            permit_num = permit_fields['business_number'].strip()
            exact_match = qr_num == permit_num
            comparison['business_number_match'] = exact_match
            if exact_match:
                matches += 1
                comparison['details'] += f"✓ Business number matches ({qr_num}). "
            else:
                comparison['mismatches'].append(
                    f"Business number mismatch: QR='{qr_num}' vs Permit='{permit_num}'"
                )

        # Compare validity date
        if qr_fields.get('validity_date') and permit_fields.get('validity_date'):
            checked += 1
            qr_date = qr_fields['validity_date'].lower().strip()
            permit_date = permit_fields['validity_date'].lower().strip()
            similarity = fuzz.token_set_ratio(qr_date, permit_date) / 100.0
            comparison['validity_date_match'] = similarity >= 0.80  # Higher threshold for dates
            if comparison['validity_date_match']:
                matches += 1
                comparison['details'] += f"✓ Validity date matches ({similarity:.0%}). "
            else:
                comparison['mismatches'].append(
                    f"Validity date mismatch ({similarity:.0%}): QR='{qr_date}' vs Permit='{permit_date}'"
                )

        # Calculate overall confidence
        if checked > 0:
            comparison['confidence'] = matches / checked
        else:
            comparison['confidence'] = 0.0  # No fields to compare

        return comparison

    def _compare_fields_simple(self, qr_fields, permit_fields):
        """Simple fallback comparison without fuzzywuzzy."""
        comparison = {
            'business_name_match': False,
            'business_owner_match': False,
            'validity_date_match': False,
            'business_number_match': False,
            'scope_match': False,
            'details': '',
            'mismatches': [],
            'confidence': 0.0,
        }

        matches = 0
        checked = 0

        # Simple substring matching
        if qr_fields.get('business_name') and permit_fields.get('business_name'):
            checked += 1
            qr = qr_fields['business_name'].lower()
            permit = permit_fields['business_name'].lower()
            match = qr in permit or permit in qr
            comparison['business_name_match'] = match
            if match:
                matches += 1

        if qr_fields.get('business_number') and permit_fields.get('business_number'):
            checked += 1
            match = qr_fields['business_number'] == permit_fields['business_number']
            comparison['business_number_match'] = match
            if match:
                matches += 1

        if checked > 0:
            comparison['confidence'] = matches / checked

        return comparison

    # ------------------------------------------------------------------
    # 3. DTI URL validation
    # ------------------------------------------------------------------
    def is_dti_url(self, url_string):
        """Check whether the decoded QR data is a valid DTI/BNRS URL."""
        try:
            parsed = urlparse(url_string)
            domain = parsed.netloc.lower().rstrip('.')
            if domain in self.DTI_DOMAINS:
                return True
            for pattern in self.DTI_URL_PATTERNS:
                if re.match(pattern, url_string, re.IGNORECASE):
                    return True
        except Exception:
            pass
        return False

    def classify_qr_url(self, qr_data):
        """
        Classify QR code data into one of three categories:
          - 'dti_direct'   : URL points directly to a DTI/BNRS domain
          - 'external_url' : URL points to a trusted external host (e.g. Google Sites)
          - 'any_url'      : URL points to an untrusted domain (still attempted)
          - 'text_data'    : Not a URL at all — plain text / structured data
        """
        if not qr_data or not isinstance(qr_data, str):
            return 'text_data'

        qr_data_stripped = qr_data.strip()
        # Must start with http:// or https://
        if not re.match(r'https?://', qr_data_stripped, re.IGNORECASE):
            return 'text_data'

        # Check if it's a direct DTI domain
        if self.is_dti_url(qr_data_stripped):
            return 'dti_direct'

        # Check if it matches a known permit URL pattern (e.g. Google Sites)
        for pattern in self.PERMIT_URL_PATTERNS:
            if re.match(pattern, qr_data_stripped, re.IGNORECASE):
                return 'external_url'

        # Check if the domain is in the trusted list
        try:
            parsed = urlparse(qr_data_stripped)
            domain = parsed.netloc.lower().rstrip('.')
            if domain in self.TRUSTED_PERMIT_DOMAINS:
                return 'external_url'
        except Exception:
            pass

        # It's a URL but not on any trusted/known domain
        return 'any_url'

    def _follow_redirects(self, url, max_redirects=10):
        """
        Follow HTTP redirects manually, recording each hop.
        Returns (chain: list[dict], final_response: Response | None).
        """
        chain = []
        current_url = url
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
            'Accept': 'text/html,application/xhtml+xml,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        session = requests.Session()
        final_resp = None
        try:
            for _ in range(max_redirects):
                resp = session.get(
                    current_url, headers=headers,
                    timeout=15, allow_redirects=False,
                )
                chain.append({
                    'url': current_url,
                    'status': resp.status_code,
                    'domain': urlparse(current_url).netloc.lower(),
                })
                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get('Location', '')
                    if not location:
                        final_resp = resp
                        break
                    # Handle relative redirects
                    if location.startswith('/'):
                        parsed = urlparse(current_url)
                        location = f"{parsed.scheme}://{parsed.netloc}{location}"
                    current_url = location
                else:
                    final_resp = resp
                    break
        except Exception:
            pass
        return chain, final_resp

    def extract_business_info_from_url(self, url_string):
        """
        Parse the QR URL for embedded business registration details.
        DTI BNRS QR URLs typically contain the registration/application number.
        """
        info = {'url': url_string}
        try:
            parsed = urlparse(url_string)
            params = dict(
                p.split('=', 1) for p in parsed.query.split('&') if '=' in p
            )
            # Common DTI BNRS params
            if 'id' in params:
                info['registration_id'] = params['id']
            if 'bn' in params:
                info['business_name'] = params['bn']
            if 'reg' in params:
                info['registration_number'] = params['reg']

            # Also grab path segments (some QR codes use path-based IDs)
            path_parts = [p for p in parsed.path.strip('/').split('/') if p]
            if path_parts:
                info['path_segments'] = path_parts
        except Exception:
            pass
        return info

    # ------------------------------------------------------------------
    # 4. Online DTI BNRS validation
    # ------------------------------------------------------------------
    def validate_with_dti(self, qr_url):
        """
        Attempt to reach the DTI BNRS page referenced by the QR code.
        If the page responds with HTTP 200 and contains expected markers,
        we consider the business registration valid.

        Returns (valid: bool, details: dict).
        """
        details = {
            'url_checked': qr_url,
            'reachable': False,
            'dti_confirmed': False,
            'business_name': None,
            'owner_name': None,
            'registration_number': None,
            'status': None,
            'message': '',
        }

        try:
            headers = {
                'User-Agent': (
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/120.0.0.0 Safari/537.36'
                ),
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
            }

            resp = requests.get(qr_url, headers=headers, timeout=15, allow_redirects=True)
            details['http_status'] = resp.status_code
            details['reachable'] = True

            if resp.status_code != 200:
                details['message'] = (
                    f"DTI website returned status {resp.status_code}. "
                    "The registration may have expired or the URL is invalid."
                )
                return False, details

            page = resp.text

            # ----- look for confirmation markers on the DTI page -----
            dti_markers = [
                'department of trade and industry',
                'dti', 'bnrs', 'business name',
                'certificate', 'registration',
                'registered', 'business name registration',
            ]
            page_lower = page.lower()
            marker_hits = sum(1 for m in dti_markers if m in page_lower)

            if marker_hits >= 2:
                details['dti_confirmed'] = True
            else:
                details['message'] = (
                    "Page did not contain expected DTI registration markers. "
                    "It may not be a valid DTI certificate page."
                )
                return False, details

            # Try to scrape business name
            bn_patterns = [
                r'(?:business\s*name|bn)\s*[:\-]?\s*([A-Z][A-Za-z0-9\s\',.\-&]+)',
                r'<(?:td|span|div|h\d)[^>]*>\s*([A-Z][A-Za-z0-9\s\',.\-&]{5,60})\s*</',
            ]
            for pat in bn_patterns:
                m = re.search(pat, page, re.IGNORECASE)
                if m:
                    details['business_name'] = m.group(1).strip()
                    break

            # Try to scrape owner / registrant name
            owner_patterns = [
                r'(?:owner|proprietor|registrant|applicant)\s*(?:name)?\s*[:\-]?\s*([A-Z][A-Za-z\s\',.\-]{3,60})',
                r'(?:name\s*of\s*(?:owner|proprietor))\s*[:\-]?\s*([A-Z][A-Za-z\s\',.\-]{3,60})',
            ]
            for pat in owner_patterns:
                m = re.search(pat, page, re.IGNORECASE)
                if m:
                    details['owner_name'] = m.group(1).strip()
                    break

            # Try to scrape registration number
            reg_patterns = [
                r'(?:registration|reg(?:istration)?\s*(?:no|number|#))\s*[:\-]?\s*(\d[\d\-]+\d)',
                r'(\d{4,}[\-]\d+)',
            ]
            for pat in reg_patterns:
                m = re.search(pat, page, re.IGNORECASE)
                if m:
                    details['registration_number'] = m.group(1).strip()
                    break

            # Check for "active" / "registered" status indicators
            status_patterns = [
                r'(?:status)\s*[:\-]?\s*(active|registered|approved|valid)',
                r'(registered|active|approved|valid)\s+(?:business|name)',
            ]
            for pat in status_patterns:
                m = re.search(pat, page, re.IGNORECASE)
                if m:
                    details['status'] = m.group(1).strip().title()
                    break

            details['message'] = "DTI registration confirmed via BNRS."
            return True, details

        except requests.exceptions.Timeout:
            details['message'] = (
                "DTI website timed out. The QR URL looks valid but the DTI "
                "server is slow. Please try again later."
            )
            return False, details
        except requests.exceptions.ConnectionError:
            details['message'] = (
                "Could not connect to DTI website. Please check your internet "
                "connection or try again later."
            )
            return False, details
        except Exception as e:
            details['message'] = f"DTI validation error: {str(e)}"
            return False, details

    def validate_permit_page(self, qr_url):
        """
        Generalized permit page validation.  Works for *any* URL that may
        host DTI registration information (DTI BNRS, Google Sites, etc.).

        1. Follow the full redirect chain, recording every hop.
        2. Fetch the final destination page.
        3. Scrape for DTI registration markers and business details.
        4. Optionally check the permit validity date.

        Returns (valid: bool, details: dict).
        """
        details = {
            'url_checked': qr_url,
            'reachable': False,
            'dti_confirmed': False,
            'business_name': None,
            'owner_name': None,
            'registration_number': None,
            'validity_date': None,
            'scope': None,
            'status': None,
            'redirect_chain': [],
            'final_url': None,
            'message': '',
        }

        try:
            # --- Follow redirects and record the chain ---
            chain, final_resp = self._follow_redirects(qr_url)
            details['redirect_chain'] = chain

            if chain:
                details['final_url'] = chain[-1]['url']

            # If manual redirect tracking returned a response, use it;
            # otherwise fall back to a normal request.
            if final_resp is None:
                headers = {
                    'User-Agent': (
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/120.0.0.0 Safari/537.36'
                    ),
                    'Accept': 'text/html,application/xhtml+xml,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
                final_resp = requests.get(
                    qr_url, headers=headers, timeout=15, allow_redirects=True,
                )

            details['http_status'] = final_resp.status_code
            details['reachable'] = True

            if final_resp.status_code != 200:
                details['message'] = (
                    f"Page returned status {final_resp.status_code}. "
                    "The registration may have expired or the URL is invalid."
                )
                return False, details

            page = final_resp.text
            return self._scrape_permit_page(page, details)

        except requests.exceptions.Timeout:
            details['message'] = (
                "Page timed out. The QR URL may be valid but the server "
                "is slow. Please try again later."
            )
            return False, details
        except requests.exceptions.ConnectionError:
            details['message'] = (
                "Could not connect to the permit page. Please check your "
                "internet connection or try again later."
            )
            return False, details
        except Exception as e:
            details['message'] = f"Permit page validation error: {str(e)}"
            return False, details

    # ------------------------------------------------------------------
    # 4b. Shared page-scraping logic
    # ------------------------------------------------------------------
    def _scrape_permit_page(self, page, details):
        """
        Scrape an HTML page for DTI registration markers and business
        details.  Called by validate_permit_page().

        Mutates *details* in-place and returns (valid, details).
        """
        # ----- Strip HTML tags for cleaner regex matching -----
        clean_text = re.sub(r'<[^>]+>', '\n', page)
        clean_text = re.sub(r'[ \t]+', ' ', clean_text)       # collapse spaces
        clean_text = re.sub(r'\n\s*\n', '\n', clean_text)     # collapse blank lines
        # Use clean_text for regex scraping, page_lower for marker detection
        page_lower = page.lower()

        # ----- look for confirmation markers on the page -----
        dti_markers = [
            'department of trade and industry',
            'dti', 'bnrs', 'business name',
            'certificate', 'registration',
            'registered', 'business name registration',
            'trade hub', 'business owner', 'validity date',
            'business name no',
        ]
        marker_hits = sum(1 for m in dti_markers if m in page_lower)

        if marker_hits >= 2:
            details['dti_confirmed'] = True
        else:
            # Check if the page is an expired QR shortlink
            expired_indicators = ['expired', 'time limit', 'no longer available',
                                  'not found', 'removed', 'deactivated']
            page_text_lower = clean_text.lower()
            is_expired = any(ind in page_text_lower for ind in expired_indicators)

            if is_expired:
                details['message'] = (
                    "QR code shortlink has expired or been deactivated. "
                    "The permit may still be valid — ML classification will be used as fallback."
                )
            else:
                details['message'] = (
                    "Page did not contain expected DTI registration markers. "
                    "It may not be a valid DTI certificate page."
                )
            return False, details

        # Try to scrape business name
        # Pattern targets "BUSINESS NAME:" followed by value on same/next line
        bn_patterns = [
            r'BUSINESS\s+NAME\s*:\s*(.+)',
            r'(?:business\s*name|bn)\s*[:\-]\s*([^\n]{3,60})',
        ]
        for pat in bn_patterns:
            m = re.search(pat, clean_text)
            if m:
                val = m.group(1).strip()
                val = re.split(r'\n', val)[0].strip()
                if val and len(val) > 1:
                    details['business_name'] = val
                    break

        # Try to scrape owner / registrant name
        owner_patterns = [
            r'BUSINESS\s+OWNER\s*:\s*(.+)',
            r'(?:owner|proprietor|registrant|applicant)\s*(?:name)?\s*[:\-]\s*([^\n]{3,60})',
        ]
        for pat in owner_patterns:
            m = re.search(pat, clean_text)
            if m:
                val = m.group(1).strip()
                val = re.split(r'\n', val)[0].strip()
                if val and len(val) > 1:
                    details['owner_name'] = val
                    break

        # Try to scrape registration / business-name number
        reg_patterns = [
            r'BUSINESS\s+NAME\s+NO\.?\s*:\s*(\d[\d\-]*)',
            r'(?:business\s*name\s*no\.?)\s*[:\-]?\s*(\d[\d\-]+)',
            r'(?:registration|reg(?:istration)?\s*(?:no|number|#))\s*[:\-]?\s*(\d[\d\-]+\d)',
            r'(\d{4,}[\-]\d+)',
            r'(\d{5,})',
        ]
        for pat in reg_patterns:
            m = re.search(pat, clean_text, re.IGNORECASE)
            if m:
                details['registration_number'] = m.group(1).strip()
                break

        # Try to scrape validity date range
        validity_patterns = [
            r'VALIDITY\s+DATE\s*:\s*(.+)',
            r'(?:validity\s*(?:date|period)?)\s*[:\-]?\s*(\d{1,2}\s+\w+\s+\d{4}\s*[\u2013\-]\s*\d{1,2}\s+\w+\s+\d{4})',
        ]
        for pat in validity_patterns:
            m = re.search(pat, clean_text, re.IGNORECASE)
            if m:
                val = m.group(1).strip()
                val = re.split(r'\n', val)[0].strip()
                if val:
                    details['validity_date'] = val
                break

        # Try to scrape scope (regional / national)
        scope_patterns = [
            r'SCOPE\s*:\s*(.+)',
            r'(?:scope)\s*[:\-]\s*((?:regional|national|local)[^\n]*)',
        ]
        for pat in scope_patterns:
            m = re.search(pat, clean_text)
            if m:
                val = m.group(1).strip()
                val = re.split(r'\n', val)[0].strip()
                if val:
                    details['scope'] = val
                break

        # Check for "active" / "registered" status indicators
        status_patterns = [
            r'(?:status)\s*[:\-]?\s*(active|registered|approved|valid)',
            r'(registered|active|approved|valid)\s+(?:business|name)',
        ]
        for pat in status_patterns:
            m = re.search(pat, clean_text, re.IGNORECASE)
            if m:
                details['status'] = m.group(1).strip().title()
                break

        # ----- Validity date expiry check -----
        expired, expiry_msg = self._check_validity_date(
            details.get('validity_date')
        )
        if expired:
            details['message'] = expiry_msg
            details['expired'] = True
            return False, details

        details['message'] = "DTI registration confirmed."
        return True, details

    # ------------------------------------------------------------------
    # 4c. Validity date checking
    # ------------------------------------------------------------------
    @staticmethod
    def _check_validity_date(validity_string):
        """
        Parse a validity-date range like
            "20 February 2023 – 20 February 2028"
        and check if the permit has expired.

        Returns (expired: bool, message: str).
        """
        if not validity_string:
            return False, ''

        try:
            # Split on dash/en-dash
            parts = re.split(r'\s*[\u2013\-]\s*', validity_string)
            if len(parts) < 2:
                return False, ''

            end_str = parts[-1].strip()
            # Flexible date parsing
            for fmt in ('%d %B %Y', '%d %b %Y', '%B %d, %Y', '%b %d, %Y',
                        '%d/%m/%Y', '%m/%d/%Y', '%Y-%m-%d'):
                try:
                    end_date = datetime.strptime(end_str, fmt)
                    break
                except ValueError:
                    continue
            else:
                # Could not parse
                return False, ''

            if end_date < datetime.now():
                return True, (
                    f"Permit has expired (validity ended {end_str}). "
                    "Please renew your DTI business name registration."
                )
            return False, ''
        except Exception:
            return False, ''

    # ------------------------------------------------------------------
    # 5. Name cross-verification
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_name(name):
        """Normalize a name for comparison: lowercase, strip punctuation/suffixes."""
        if not name:
            return ''
        name = name.lower().strip()
        # Remove common business suffixes that may differ between form and DTI
        for suffix in ['trading', 'enterprises', 'enterprise', 'farm', 'farms',
                       'agri', 'agricultural', 'products', 'store', 'shop']:
            name = re.sub(rf'\b{suffix}\b', '', name)
        name = re.sub(r'[^a-z0-9\s]', '', name)
        name = re.sub(r'\s+', ' ', name).strip()
        return name

    @staticmethod
    def _name_similarity(name_a, name_b):
        """
        Compute similarity between two names using SequenceMatcher.
        Returns a float 0.0 - 1.0.
        """
        if not name_a or not name_b:
            return 0.0
        a = ImageVerificationSystem._normalize_name(name_a)
        b = ImageVerificationSystem._normalize_name(name_b)
        if not a or not b:
            return 0.0
        if a == b:
            return 1.0
        # One contains the other (e.g. "Juan Farm" vs "Juan")
        if a in b or b in a:
            return 0.9
        return SequenceMatcher(None, a, b).ratio()

    def cross_check_names(self, user_business_name, user_owner_name,
                          dti_business_name, dti_owner_name):
        """
        Compare the names the farmer typed in the form with what the DTI
        page shows (scraped from the QR-linked page).

        Returns dict with match results and an overall score.
        """
        result = {
            'business_name_match': None,
            'owner_name_match': None,
            'business_name_similarity': 0.0,
            'owner_name_similarity': 0.0,
            'overall_match': False,
            'score': 0.0,
            'details': '',
        }

        checks_done = 0
        total_score = 0.0

        # --- Business name ---
        if user_business_name and dti_business_name:
            sim = self._name_similarity(user_business_name, dti_business_name)
            result['business_name_similarity'] = round(sim, 3)
            result['business_name_match'] = sim >= self.NAME_MATCH_THRESHOLD
            checks_done += 1
            total_score += sim
            if result['business_name_match']:
                result['details'] += (
                    f"Business name matches ({sim:.0%}): "
                    f"'{user_business_name}' ~ '{dti_business_name}'. "
                )
            else:
                result['details'] += (
                    f"Business name MISMATCH ({sim:.0%}): "
                    f"you entered '{user_business_name}' but DTI shows "
                    f"'{dti_business_name}'. "
                )
        elif user_business_name and not dti_business_name:
            result['details'] += "Could not extract business name from DTI for comparison. "

        # --- Owner name ---
        if user_owner_name and dti_owner_name:
            sim = self._name_similarity(user_owner_name, dti_owner_name)
            result['owner_name_similarity'] = round(sim, 3)
            result['owner_name_match'] = sim >= self.NAME_MATCH_THRESHOLD
            checks_done += 1
            total_score += sim
            if result['owner_name_match']:
                result['details'] += (
                    f"Owner name matches ({sim:.0%}): "
                    f"'{user_owner_name}' ~ '{dti_owner_name}'. "
                )
            else:
                result['details'] += (
                    f"Owner name MISMATCH ({sim:.0%}): "
                    f"you entered '{user_owner_name}' but DTI shows "
                    f"'{dti_owner_name}'. "
                )
        elif user_owner_name and not dti_owner_name:
            result['details'] += "Could not extract owner name from DTI for comparison. "

        if checks_done > 0:
            result['score'] = round(total_score / checks_done, 3)
            result['overall_match'] = result['score'] >= self.NAME_MATCH_THRESHOLD
        else:
            # No DTI-side names to compare against — cannot confirm identity
            result['score'] = 0.0
            result['overall_match'] = False
            result['details'] += "No DTI name data available for cross-check — verification cannot be completed automatically. "

        return result

    # ------------------------------------------------------------------
    # 6. Full verification pipeline
    # ------------------------------------------------------------------
    def verify_permit_image(self, image_path, user_business_name=None,
                            user_owner_name=None):
        """
        Complete verification pipeline (QR + ML + Name Cross-Check).

        Steps:
          1. Check image quality
          2. Run ML classifier (if model is loaded)
          3. Scan for QR code
          4. Classify QR data (DTI URL / external URL / text)
          5. Validate against permit page (DTI BNRS or Google Sites etc.)
          6. Cross-check business/owner names against page data
          7. Check permit validity date (expiry)
          8. Combine all scores for final decision
        """
        results = {
            'valid': False,
            'confidence': 0.0,
            'quality_check': None,
            'ml_prediction': None,
            'qr_scan': None,
            'qr_data': None,
            'dti_url_valid': False,
            'dti_validation': None,
            'business_info': None,
            'name_verification': None,
            'text_verification': None,
            'extracted_text': '',
            'timestamp': datetime.now().isoformat(),
            'file_path': image_path,
            'permit_validation': {'passed': False, 'message': ''},
        }

        # ---- Step 1: Image quality ----
        quality_ok, quality_msg = self.check_image_quality(image_path)
        results['quality_check'] = {'passed': quality_ok, 'message': quality_msg}
        if not quality_ok:
            results['permit_validation']['message'] = quality_msg
            return results

        # ---- Step 2: ML classification ----
        ml_result = self.predict_permit_ml(image_path)
        results['ml_prediction'] = ml_result

        # ---- Step 3: Scan QR code ----
        qr_ok, qr_data, qr_method = self.scan_qr_code(image_path)
        results['qr_scan'] = {
            'passed': qr_ok,
            'message': qr_data if not qr_ok else f"QR decoded ({qr_method})",
            'method': qr_method,
        }

        if qr_ok:
            results['qr_data'] = qr_data
            results['extracted_text'] = qr_data

            # ---- Step 3b: Verify QR text against actual permit text ----
            # Parse the QR text data
            qr_fields = self._parse_qr_text(qr_data)
            
            # Extract text from the actual permit image
            ocr_success, ocr_text = self._extract_text_with_ocr(image_path)
            
            if ocr_success and ocr_text:
                permit_fields = self._extract_permit_text_details(ocr_text)
                text_comparison = self._compare_permit_fields(qr_fields, permit_fields)
                results['text_verification'] = text_comparison
                
                print(f"[INFO] Text Verification: {text_comparison['confidence']:.0%} confidence")
                if text_comparison['mismatches']:
                    for mismatch in text_comparison['mismatches']:
                        print(f"  [WARN] {mismatch}")
                else:
                    print(f"  [OK] All checked fields match")
            else:
                results['text_verification'] = {
                    'confidence': 0.0,
                    'details': 'Could not extract text from permit image for verification',
                    'mismatches': [],
                }

            # ---- Step 4: Classify QR URL ----
            url_type = self.classify_qr_url(qr_data)
            is_dti = url_type == 'dti_direct'
            is_verifiable_url = url_type in ('dti_direct', 'external_url', 'any_url')
            results['dti_url_valid'] = is_dti
            results['qr_url_type'] = url_type

            if is_verifiable_url:
                # The QR code contains a URL — try online page validation
                print(f"[INFO] QR URL classified as '{url_type}': {qr_data[:100]}")

                results['business_info'] = self.extract_business_info_from_url(qr_data)

                # ---- Step 5: Validate against the permit page ----
                if is_dti:
                    page_valid, page_details = self.validate_with_dti(qr_data)
                else:
                    page_valid, page_details = self.validate_permit_page(qr_data)

                results['dti_validation'] = page_details

                # ---- Step 6: Name cross-check ----
                page_biz_name = page_details.get('business_name')
                page_own_name = page_details.get('owner_name')
                name_check = self.cross_check_names(
                    user_business_name, user_owner_name,
                    page_biz_name, page_own_name,
                )
                results['name_verification'] = name_check

                # Apply a small confidence penalty for untrusted external domains
                domain_penalty = 0.0
                if url_type == 'any_url':
                    domain_penalty = 0.10
                    print("[WARN] QR URL domain is not in the trusted list — applying confidence penalty")

                if page_valid:
                    # --- Permit expired? ---
                    if page_details.get('expired'):
                        results['confidence'] = 0.3
                        results['permit_validation'] = {
                            'passed': False,
                            'message': page_details.get('message', 'Permit expired.'),
                        }
                        return results

                    # Base confidence from QR + page validation
                    base_confidence = 0.90 - domain_penalty

                    # Boost / penalise based on name match
                    # Only penalise if the user actually provided names to compare
                    user_provided_names = bool(user_business_name or user_owner_name)
                    if name_check['overall_match']:
                        base_confidence += 0.05
                    elif user_provided_names and name_check['score'] < 0.4 and (page_biz_name or page_own_name):
                        # Names clearly don't match - suspicious
                        base_confidence -= 0.20
                        results['permit_validation'] = {
                            'passed': False,
                            'message': (
                                "QR code page is valid, but the names you provided "
                                "do not match the registration records. " + name_check['details'] +
                                "Please ensure you entered the exact names from your permit."
                            ),
                            'name_mismatch': True,
                        }
                        results['confidence'] = base_confidence
                        return results

                    # Boost if ML also agrees
                    if ml_result.get('available') and ml_result.get('is_permit'):
                        base_confidence = min(0.99, base_confidence + ml_result['confidence'] * 0.04)

                    results['valid'] = True
                    results['confidence'] = base_confidence

                    # Build informative message
                    src_label = 'DTI BNRS' if is_dti else 'permit registration page'
                    validity_info = ''
                    if page_details.get('validity_date'):
                        validity_info = f" Validity: {page_details['validity_date']}."

                    results['permit_validation'] = {
                        'passed': True,
                        'message': (
                            f"QR code verified against {src_label}. "
                            f"Business: {page_details.get('business_name', 'N/A')}. "
                            f"Owner: {page_details.get('owner_name', 'N/A')}. "
                            f"Reg #: {page_details.get('registration_number', 'N/A')}."
                            f"{validity_info}"
                        ),
                    }
                    if name_check['details']:
                        results['permit_validation']['name_check_details'] = name_check['details']
                    if page_details.get('business_name'):
                        results['business_info']['business_name'] = page_details['business_name']
                    if page_details.get('owner_name'):
                        results['business_info']['owner_name'] = page_details['owner_name']
                    if page_details.get('registration_number'):
                        results['business_info']['registration_number'] = page_details['registration_number']

                    return results
                else:
                    # Online page check was inconclusive or failed
                    # Use ML classifier as tiebreaker when QR was decoded
                    ml_is_permit = (ml_result.get('available') and
                                    ml_result.get('is_permit') and
                                    ml_result['confidence'] > 0.7)

                    if not page_details.get('reachable'):
                        # Page unreachable — use ML as tiebreaker
                        if ml_is_permit:
                            results['valid'] = True
                            results['confidence'] = 0.75 - domain_penalty
                            results['permit_validation'] = {
                                'passed': True,
                                'message': (
                                    "Permit page unreachable, but QR URL is valid and "
                                    f"ML classifier confirms permit (confidence: {ml_result['confidence']:.0%})."
                                ),
                            }
                            return results
                        else:
                            results['confidence'] = 0.5
                            results['permit_validation'] = {
                                'passed': False,
                                'message': (
                                    page_details.get('message', 'Permit page unreachable.') +
                                    ' Please try again later or upload a clearer image with a visible QR code.'
                                ),
                            }
                            return results
                    else:
                        # Page reachable but no DTI markers found
                        # Common cause: QR shortener link expired (qrs.ly, me-qr.com)
                        page_msg = page_details.get('message', '')
                        is_expired_shortlink = any(
                            kw in page_msg.lower()
                            for kw in ['expired', 'not found', 'removed', 'no longer']
                        ) or any(
                            kw in (page_details.get('final_url') or '').lower()
                            for kw in ['expired', '404', 'error']
                        )

                        if ml_is_permit:
                            # ML confidently says it's a permit — accept with
                            # moderate confidence (QR was present but link expired/failed)
                            conf = 0.80 - domain_penalty
                            if is_expired_shortlink:
                                reason = (
                                    "QR code shortlink has expired, but ML classifier "
                                    f"confirms this is an authentic permit "
                                    f"(confidence: {ml_result['confidence']:.0%}). "
                                    "Consider updating the QR code on your permit."
                                )
                            else:
                                reason = (
                                    "Permit page did not contain expected registration "
                                    "markers, but ML classifier confirms this is an "
                                    f"authentic permit (confidence: {ml_result['confidence']:.0%})."
                                )
                            results['valid'] = True
                            results['confidence'] = conf
                            results['permit_validation'] = {
                                'passed': True,
                                'message': reason,
                            }
                            return results
                        else:
                            results['confidence'] = 0.4
                            results['permit_validation'] = {
                                'passed': False,
                                'message': page_details.get('message', 'Permit page validation failed.'),
                            }
                            return results
            else:
                # QR found but NOT a URL — treat as text-based QR with business info
                print(f"📄 Processing text-based QR code (not a URL)")
                
                # Get fields from QR text (already done in Step 3b)
                qr_fields = self._parse_qr_text(qr_data)
                
                # Extract permit text details (already done in Step 3b)
                ocr_success, ocr_text = self._extract_text_with_ocr(image_path)
                
                if ocr_success and ocr_text:
                    permit_fields = self._extract_permit_text_details(ocr_text)
                    
                    # Compare QR text vs permit OCR text
                    text_comparison = self._compare_permit_fields(qr_fields, permit_fields)
                    results['text_verification'] = text_comparison
                    
                    print(f"📋 QR Text vs Permit OCR: {text_comparison['confidence']:.0%} confidence")
                    
                    # Compare with farmer-provided information
                    qr_extracted_business = qr_fields.get('business_name')
                    qr_extracted_owner = qr_fields.get('business_owner')
                    
                    name_check = self.cross_check_names(
                        user_business_name or qr_extracted_business,
                        user_owner_name or qr_extracted_owner,
                        qr_extracted_business,
                        qr_extracted_owner,
                    )
                    results['name_verification'] = name_check
                    
                    # Weighted average: 40% text match, 40% name match, 20% ML confidence
                    text_conf = text_comparison.get('confidence', 0.0)
                    name_conf = name_check.get('score', 0.5)
                    ml_conf = ml_result.get('confidence', 0.5) if ml_result.get('available') else 0.5
                    base_confidence = (text_conf * 0.4) + (name_conf * 0.4) + (ml_conf * 0.2)
                    
                    # Ensure ML classifier confirms it's a permit
                    if ml_result.get('available') and ml_result.get('is_permit'):
                        if base_confidence > 0.65:
                            results['valid'] = True
                            results['confidence'] = min(0.95, base_confidence)
                            results['permit_validation'] = {
                                'passed': True,
                                'message': (
                                    f"QR code verified. Business information matches permit. "
                                    f"QR Text: {qr_extracted_business or 'N/A'}. "
                                    f"Owner: {qr_extracted_owner or 'N/A'}. "
                                    f"Confidence: {base_confidence:.0%}"
                                ),
                            }
                            if name_check.get('details'):
                                results['permit_validation']['name_check_details'] = name_check['details']
                            return results
                        else:
                            results['confidence'] = base_confidence
                            results['permit_validation'] = {
                                'passed': False,
                                'message': (
                                    f"QR code business information does not sufficiently match "
                                    f"the permit and your provided information. "
                                    f"Please verify the accuracy of the permit. "
                                    f"Confidence: {base_confidence:.0%}"
                                ),
                                'mismatches': text_comparison.get('mismatches', []),
                            }
                            return results
                    else:
                        # No ML model - rely on text matching alone
                        if text_conf > 0.7:
                            results['valid'] = True
                            results['confidence'] = min(0.85, text_conf)
                            results['permit_validation'] = {
                                'passed': True,
                                'message': (
                                    f"QR code verified. Business information matches permit. "
                                    f"Confidence: {text_conf:.0%}"
                                ),
                            }
                            return results
                        else:
                            results['confidence'] = text_conf
                            results['permit_validation'] = {
                                'passed': False,
                                'message': (
                                    f"QR code business information does not match the permit. "
                                    f"Please verify the QR code is from a valid permit. "
                                    f"Confidence: {text_conf:.0%}"
                                ),
                                'mismatches': text_comparison.get('mismatches', []),
                            }
                            return results
                else:
                    # Could not extract text from permit for comparison
                    results['confidence'] = 0.4
                    results['permit_validation'] = {
                        'passed': False,
                        'message': (
                            "Cannot extract text from permit image for QR comparison. "
                            "Please ensure the permit image is clear and readable."
                        ),
                    }
                    return results

        # ---- QR scan failed — fall back to ML-only ----
        if ml_result.get('available') and ml_result.get('is_permit') and ml_result['confidence'] > 0.8:
            # ML is very confident this is a permit, but no QR found
            # Auto-reject but with high ML confidence noted — user should retry with visible QR
            results['confidence'] = ml_result['confidence'] * 0.7  # cap at ~0.7
            results['permit_validation'] = {
                'passed': False,
                'message': (
                    f"No QR code detected, but ML classifier identifies this as a "
                    f"business permit (confidence: {ml_result['confidence']:.0%}). "
                    "Please re-upload a clearer photo with the QR code fully visible "
                    "so the system can complete automated verification."
                ),
            }
        elif ml_result.get('available') and not ml_result.get('is_permit'):
            results['confidence'] = 0.1
            results['permit_validation'] = {
                'passed': False,
                'message': (
                    "No QR code detected and the image does not appear to be a "
                    "business permit. Please upload a clear photo of your DTI "
                    "Business Permit with the QR code visible."
                ),
            }
        else:
            # No ML model available, no QR code
            results['permit_validation']['message'] = qr_data  # error message from scan

        return results

    # ------------------------------------------------------------------
    # 7. Audit trail
    # ------------------------------------------------------------------
    def save_verification_record(self, user_id, verification_result,
                                 output_folder='verification_records',
                                 db=None, user_obj=None, permit_business_name=None,
                                 permit_owner_name=None, image_filename=None,
                                 image_path=None):
        """
        Save verification results for audit trail to both:
        1. File system (JSON) - for backward compatibility
        2. MongoDB - for queryable database records
        """
        # Save to file system
        os.makedirs(output_folder, exist_ok=True)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        record_path = os.path.join(output_folder, f"{user_id}_{ts}.json")

        with open(record_path, 'w') as f:
            json.dump(verification_result, f, indent=2, default=str)

        # Save to MongoDB if db is available
        if db is not None:
            try:
                from models import PermitVerification
                
                # Get user info for the record - no MongoEngine User lookup needed
                user_email = getattr(user_obj, 'email', None) if user_obj else None
                user_name = None
                user_farm_name = None
                
                if user_obj:
                    first_name = getattr(user_obj, 'first_name', '') or ''
                    last_name = getattr(user_obj, 'last_name', '') or ''
                    user_name = f"{first_name} {last_name}".strip()
                    user_farm_name = getattr(user_obj, 'farm_name', None)
                
                if user_email:
                    # Extract key fields from verification result
                    ml_pred = verification_result.get('ml_prediction', {})
                    dti_val = verification_result.get('dti_validation', {})
                    name_ver = verification_result.get('name_verification', {})
                    
                    # Create PermitVerification record using email instead of ReferenceField
                    record = PermitVerification(
                        user_email=user_email,
                        user_name=user_name,
                        user_farm_name=user_farm_name or permit_business_name,
                        status='verified' if verification_result.get('valid') else 'rejected',
                        verification_result=verification_result,
                        confidence=verification_result.get('confidence', 0.0),
                        valid=verification_result.get('valid', False),
                        image_filename=image_filename,
                        image_path=image_path or verification_result.get('file_path'),
                        permit_business_name=permit_business_name,
                        permit_owner_name=permit_owner_name,
                        dti_business_name=dti_val.get('business_name') if dti_val else None,
                        dti_owner_name=dti_val.get('owner_name') if dti_val else None,
                        dti_business_number=dti_val.get('business_number') if dti_val else None,
                        qr_data=verification_result.get('qr_data'),
                        qr_valid=verification_result.get('qr_scan', {}).get('passed', False),
                        ml_confidence=ml_pred.get('confidence', 0.0) if ml_pred else 0.0,
                        ml_is_permit=ml_pred.get('is_permit', False) if ml_pred else False,
                    )
                    record.save()
                    print(f"[OK] Verification record saved to MongoDB: {record.id}")
                else:
                    print(f"[WARN] Could not find user email for id={user_id}")
            except Exception as e:
                import traceback
                print(f"[WARN] Could not save to MongoDB: {e}")
                print(traceback.format_exc())
                # Continue anyway - JSON file was saved

        return record_path
