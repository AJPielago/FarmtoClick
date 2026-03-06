import base64
import hashlib
import hmac
import os
from typing import Dict, List, Optional

import requests

PAYMONGO_API_BASE = 'https://api.paymongo.com/v1'


class PayMongoError(RuntimeError):
    pass


def _build_headers() -> Dict[str, str]:
    secret_key = (os.environ.get('PAYMONGO_SECRET_KEY') or '').strip()
    if not secret_key:
        raise PayMongoError('PAYMONGO_SECRET_KEY is not configured')

    token = base64.b64encode(f"{secret_key}:".encode('utf-8')).decode('utf-8')
    return {
        'Authorization': f'Basic {token}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def create_checkout_session(
    *,
    amount: int,
    description: str,
    success_url: str,
    cancel_url: str,
    payment_method_types: List[str],
    line_items: List[Dict[str, object]],
    metadata: Optional[Dict[str, str]] = None,
    reference_number: Optional[str] = None,
) -> Dict[str, str]:
    if amount <= 0:
        raise PayMongoError('Amount must be greater than zero')

    attributes: Dict[str, object] = {
        'amount': int(amount),
        'currency': 'PHP',
        'description': description,
        'payment_method_types': payment_method_types,
        'success_url': success_url,
        'cancel_url': cancel_url,
        'line_items': line_items,
    }

    if metadata:
        attributes['metadata'] = metadata
    if reference_number:
        attributes['reference_number'] = reference_number

    payload = {'data': {'attributes': attributes}}

    response = requests.post(
        f'{PAYMONGO_API_BASE}/checkout_sessions',
        json=payload,
        headers=_build_headers(),
        timeout=20,
    )
    if response.status_code not in (200, 201):
        raise PayMongoError(f"PayMongo error: {response.text}")

    data = response.json().get('data', {})
    attrs = data.get('attributes', {})
    checkout_url = attrs.get('checkout_url')
    checkout_id = data.get('id')
    if not checkout_url or not checkout_id:
        raise PayMongoError('Invalid PayMongo response')

    return {'id': checkout_id, 'checkout_url': checkout_url}


def verify_webhook_signature(payload: bytes, signature_header: str) -> bool:
    secret = (os.environ.get('PAYMONGO_WEBHOOK_SECRET') or '').strip()
    if not secret:
        raise PayMongoError('PAYMONGO_WEBHOOK_SECRET is not configured')

    if not signature_header:
        return False

    provided = signature_header.strip()
    if 'v1=' in provided:
        parts = [p.strip() for p in provided.split(',') if '=' in p]
        parsed = {p.split('=', 1)[0]: p.split('=', 1)[1] for p in parts}
        provided = parsed.get('v1', provided).strip()

    digest = hmac.new(secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, digest)


def get_checkout_session(checkout_id: str) -> Dict[str, object]:
    if not checkout_id:
        raise PayMongoError('Checkout session id is required')

    response = requests.get(
        f'{PAYMONGO_API_BASE}/checkout_sessions/{checkout_id}',
        headers=_build_headers(),
        timeout=20,
    )
    if response.status_code != 200:
        raise PayMongoError(f"PayMongo error: {response.text}")

    return response.json().get('data', {})
