"""
Permit Feature Extractor
========================
Extracts visual features from business permit images for ML classification.
Features: quality, document structure, text/layout, color, edge, QR, and
texture (LBP + GLCM-like) — giving the classifier rich signals to
distinguish authentic DTI permits from random images.

Does NOT require Tesseract OCR; uses purely vision-based text metrics
so the model can be trained on any machine.
"""

import cv2
import numpy as np
from PIL import Image

# Feature names in a fixed, deterministic order (used by training & inference)
FEATURE_NAMES = [
    # Quality (7)
    'blur_score', 'brightness', 'contrast', 'image_area',
    'width', 'height', 'aspect_ratio',
    # Document structure (4)
    'num_contours', 'max_contour_area', 'avg_contour_area', 'edge_density',
    # Text-like layout (3)
    'text_pixel_ratio', 'horizontal_line_ratio', 'text_region_count',
    # Color (4)
    'color_variance', 'hue_entropy', 'saturation_entropy', 'value_entropy',
    # Edge (3)
    'edge_density_sobel', 'corner_count', 'edge_magnitude_mean',
    # QR code presence (2)
    'has_qr_code', 'qr_area_ratio',
    # Texture (4)
    'lbp_mean', 'lbp_std', 'glcm_contrast', 'glcm_homogeneity',
]


class PermitFeatureExtractor:
    """Extract a fixed-length feature vector from a permit image."""

    # Standard size images are resized to before extraction (keeps features
    # comparable across different cameras / resolutions).
    STANDARD_SIZE = (800, 600)  # width, height

    def __init__(self):
        pass  # No external dependencies on init

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def extract_all_features(self, image_path):
        """Return a dict of all features, or None on error."""
        try:
            img = cv2.imread(image_path)
            if img is None:
                return None
            features = {}
            features.update(self._extract_quality_features(img))
            features.update(self._extract_document_features(img))
            features.update(self._extract_text_features(img))
            features.update(self._extract_color_features(img))
            features.update(self._extract_edge_features(img))
            features.update(self._extract_qr_features(img))
            features.update(self._extract_texture_features(img))
            return features
        except Exception as e:
            print(f'Error extracting features: {e}')
            return None

    def features_to_vector(self, feature_dict):
        """Convert feature dict → ordered numpy array matching FEATURE_NAMES."""
        return np.array([float(feature_dict.get(k, 0)) for k in FEATURE_NAMES])

    # ------------------------------------------------------------------
    # Individual extractors
    # ------------------------------------------------------------------
    def _extract_quality_features(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        brightness = np.mean(gray)
        contrast = np.std(gray)
        height, width = gray.shape
        resolution = width * height
        return {
            'blur_score': laplacian_var,
            'brightness': brightness,
            'contrast': contrast,
            'image_area': resolution,
            'width': width,
            'height': height,
            'aspect_ratio': width / height if height > 0 else 0,
        }

    def _extract_document_features(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        num_contours = len(contours)
        areas = [cv2.contourArea(c) for c in contours if cv2.contourArea(c) > 100]
        return {
            'num_contours': num_contours,
            'max_contour_area': max(areas) if areas else 0,
            'avg_contour_area': float(np.mean(areas)) if areas else 0,
            'edge_density': float(np.sum(edges > 0) / edges.size) if edges.size > 0 else 0,
        }

    def _extract_text_features(self, img):
        """
        Vision-based text metrics (no OCR needed):
          - text_pixel_ratio: dark-pixel ratio in binarised image
          - horizontal_line_ratio: proxy for text lines (horizontal runs)
          - text_region_count: connected components that look like text blocks
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        text_pixel_ratio = float(np.sum(binary > 0) / binary.size)

        # Horizontal projection → count prominent "text-line" peaks
        h_proj = np.sum(binary, axis=1)
        threshold = 0.1 * h_proj.max() if h_proj.max() > 0 else 1
        above = h_proj > threshold
        transitions = np.diff(above.astype(int))
        text_region_count = int(np.sum(transitions == 1))

        # Morphological horizontal kernel to detect lines of text
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
        h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        horizontal_line_ratio = float(np.sum(h_lines > 0) / binary.size) if binary.size else 0

        return {
            'text_pixel_ratio': text_pixel_ratio,
            'horizontal_line_ratio': horizontal_line_ratio,
            'text_region_count': text_region_count,
        }

    def _extract_color_features(self, img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hist_h = cv2.calcHist([hsv], [0], None, [180], [0, 180])
        hist_s = cv2.calcHist([hsv], [1], None, [256], [0, 256])
        hist_v = cv2.calcHist([hsv], [2], None, [256], [0, 256])
        b, g, r = cv2.split(img)
        color_variance = float(np.var(r) + np.var(g) + np.var(b))
        return {
            'color_variance': color_variance,
            'hue_entropy': float(np.sum(hist_h * np.log(hist_h + 1))),
            'saturation_entropy': float(np.sum(hist_s * np.log(hist_s + 1))),
            'value_entropy': float(np.sum(hist_v * np.log(hist_v + 1))),
        }

    def _extract_edge_features(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        edge_magnitude = np.sqrt(sobelx**2 + sobely**2)
        edge_density = float(np.sum(edge_magnitude > 100) / edge_magnitude.size)
        corners = cv2.cornerHarris(gray, 2, 3, 0.04)
        corner_count = int(np.sum(corners > 0.01 * corners.max())) if corners.max() > 0 else 0
        return {
            'edge_density_sobel': edge_density,
            'corner_count': corner_count,
            'edge_magnitude_mean': float(np.mean(edge_magnitude)),
        }

    def _extract_qr_features(self, img):
        """Detect QR code presence and relative size using OpenCV's built-in detector."""
        try:
            detector = cv2.QRCodeDetector()
            retval, points, _ = detector.detectAndDecode(img)
            if points is not None and len(points) > 0:
                pts = points[0]
                qr_w = np.linalg.norm(pts[0] - pts[1])
                qr_h = np.linalg.norm(pts[1] - pts[2])
                qr_area = qr_w * qr_h
                img_area = img.shape[0] * img.shape[1]
                return {
                    'has_qr_code': 1.0,
                    'qr_area_ratio': float(qr_area / img_area) if img_area > 0 else 0,
                }
        except Exception:
            pass
        return {'has_qr_code': 0.0, 'qr_area_ratio': 0.0}

    def _extract_texture_features(self, img):
        """
        Lightweight texture descriptors:
          - LBP (Local Binary Pattern) mean & std  → captures micro-texture
          - Simple GLCM-like contrast & homogeneity → captures macro-texture
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Resize for speed
        small = cv2.resize(gray, (256, 256))

        # ---- Simple LBP ----
        lbp = np.zeros_like(small, dtype=np.float64)
        for dy, dx in [(-1, -1), (-1, 0), (-1, 1), (0, 1),
                        (1, 1), (1, 0), (1, -1), (0, -1)]:
            shifted = np.roll(np.roll(small, dy, axis=0), dx, axis=1)
            lbp = lbp * 2 + (shifted >= small).astype(np.float64)

        # ---- GLCM-like: co-occurrence at offset (0,1) ----
        left = small[:, :-1].astype(np.float64)
        right = small[:, 1:].astype(np.float64)
        diff = np.abs(left - right)
        glcm_contrast = float(np.mean(diff ** 2))
        glcm_homogeneity = float(np.mean(1.0 / (1.0 + diff)))

        return {
            'lbp_mean': float(np.mean(lbp)),
            'lbp_std': float(np.std(lbp)),
            'glcm_contrast': glcm_contrast,
            'glcm_homogeneity': glcm_homogeneity,
        }
