"""
Utility helpers: email sending, PDF receipt generation, file helpers.
"""
import io
import os
import smtplib
import ssl
import hashlib
from datetime import datetime
from db import get_mongodb_db
from email.message import EmailMessage

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


def calculate_shipping_fee(address):
    """
    Calculate shipping fee based on distance (simulated via address hash).
    Minimum fee: 39 pesos. Maximum fee: 80 pesos.
    """
    if not address:
        return 39.0
    
    # Generate a pseudo-random distance based on the address string
    h = 0
    for char in address:
        h = ((h << 5) - h) + ord(char)
        h &= 0xFFFFFFFF
    if h & 0x80000000:
        h = -((h ^ 0xFFFFFFFF) + 1)
    hash_val = abs(h)
    
    # Distance between 1 and 50 km
    distance = 1.0 + (hash_val % 50)
    
    # Base fee is 39 for up to 5km. Then +1 peso per km.
    fee = 39.0 + max(0, distance - 5) * 1.0
    
    if fee > 80.0:
        fee = 80.0
        
    return float(fee)


def calculate_bulk_discount(total_items, total_amount):
    """
    Calculate discount for bulk orders.
    - 5-9 items: 5% discount
    - 10-19 items: 10% discount
    - 20+ items: 15% discount
    """
    discount_rate = 0.0
    if total_items >= 20:
        discount_rate = 0.15
    elif total_items >= 10:
        discount_rate = 0.10
    elif total_items >= 5:
        discount_rate = 0.05
        
    discount_amount = total_amount * discount_rate
    return discount_rate, discount_amount


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def send_system_email(app, to_email, subject, body, attachments=None, html_body=None):
    """Send an email using the app's SMTP settings."""
    mail_user = app.config.get('MAIL_USERNAME')
    mail_pass = app.config.get('MAIL_PASSWORD')
    mail_server = app.config.get('MAIL_SERVER')
    mail_port = app.config.get('MAIL_PORT')
    mail_use_tls = app.config.get('MAIL_USE_TLS')
    mail_sender = app.config.get('MAIL_DEFAULT_SENDER')

    if not all([mail_user, mail_pass, mail_server, mail_port, mail_sender]):
        print("Email not configured: missing SMTP settings.")
        return False

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = mail_sender
    msg['To'] = to_email
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype='html')

    if attachments:
        for att in attachments:
            fn = att.get('filename')
            content = att.get('content')
            maintype = att.get('maintype', 'application')
            subtype = att.get('subtype', 'octet-stream')
            if fn and content:
                msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=fn)

    try:
        context = ssl.create_default_context()
        if mail_use_tls:
            with smtplib.SMTP(mail_server, mail_port) as server:
                server.starttls(context=context)
                server.login(mail_user, mail_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(mail_server, mail_port, context=context) as server:
                server.login(mail_user, mail_pass)
                server.send_message(msg)
        # Create a short notification record in MongoDB for the recipient email
        try:
            db, _ = get_mongodb_db(app)
            if db is not None:
                snippet = (body or '').strip().replace('\n', ' ')
                if len(snippet) > 120:
                    snippet = snippet[:117] + '...'
                if subject:
                    notif_message = f"{subject} — check your email"
                else:
                    notif_message = f"{snippet[:100]} — check your email"

                notif_doc = {
                    'user_email': to_email,
                    'subject': subject or '',
                    'message': notif_message,
                    'read': False,
                    'created_at': datetime.utcnow(),
                }
                try:
                    db.notifications.insert_one(notif_doc)
                except Exception:
                    pass
        except Exception:
            pass

        return True
    except Exception as e:
        print(f"Email send error: {e}")
        return False


def build_email_html(title, subtitle, content_html, badge_text=None):
    badge_html = ""
    if badge_text:
        badge_html = (
            f'<div style="display:inline-block; padding:6px 12px; background:#eef6ef; '
            f'color:#1f4d1f; border-radius:999px; font-weight:600; font-size:12px; margin:8px 0 0;">'
            f'{badge_text}</div>'
        )
    return f"""
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f6f7fb; padding:28px;">
        <div style="max-width:640px; margin:0 auto; background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 12px 32px rgba(15,23,42,0.12);">
            <div style="background:#2c7a2c; color:#fff; padding:20px 24px;">
                <h2 style="margin:0; font-size:20px;">FarmtoClick</h2>
                <p style="margin:6px 0 0; font-size:14px;">{subtitle}</p>
            </div>
            <div style="padding:24px; color:#111827;">
                <h3 style="margin:0 0 8px; font-size:18px;">{title}</h3>
                {badge_html}
                <div style="margin-top:16px; font-size:14px; line-height:1.6; color:#374151;">
                    {content_html}
                </div>
            </div>
            <div style="padding:14px 22px; font-size:12px; color:#6b7280; border-top:1px solid #e5e7eb; background:#fafafa;">
                This is an automated message from FarmtoClick. Please do not reply.
            </div>
        </div>
    </div>
    """


def generate_receipt_pdf(order_id, buyer_name, buyer_email, items, subtotal, discount_amount=0, shipping_fee=0, final_total=0):
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    margin_x = 50
    top = height - 50

    # Header
    pdf.setFillColorRGB(0.17, 0.48, 0.17)
    pdf.rect(0, height - 80, width, 80, stroke=0, fill=1)
    pdf.setFillColorRGB(1, 1, 1)
    logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'images', 'farm.jpg')
    if os.path.exists(logo_path):
        try:
            logo = ImageReader(logo_path)
            pdf.drawImage(logo, margin_x, height - 70, width=42, height=42, mask='auto')
        except Exception:
            pass

    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x + 52, height - 50, "FarmtoClick")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(margin_x + 52, height - 68, "Order Receipt")

    # Order info
    pdf.setFillColorRGB(0, 0, 0)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x, top - 40, f"Order ID: {order_id}")
    pdf.drawString(margin_x, top - 55, f"Customer: {buyer_name}")
    pdf.drawString(margin_x, top - 70, f"Email: {buyer_email}")
    pdf.drawString(margin_x, top - 85, f"Date: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")

    pdf.setStrokeColorRGB(0.9, 0.9, 0.9)
    pdf.line(margin_x, top - 95, width - margin_x, top - 95)

    # Table header
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(margin_x, top - 115, "Item")
    pdf.drawString(width - 220, top - 115, "Qty")
    pdf.drawString(width - 170, top - 115, "Price")
    pdf.drawString(width - 110, top - 115, "Total")

    # Items
    y = top - 135
    pdf.setFont("Helvetica", 10)
    for item in items:
        name = item.get('name', 'Item')
        qty = int(item.get('quantity', 1))
        price = float(item.get('price', 0))
        line_total = price * qty
        pdf.drawString(margin_x, y, name[:40])
        pdf.drawRightString(width - 190, y, str(qty))
        pdf.drawRightString(width - 130, y, f"\u20b1{price:.2f}")
        pdf.drawRightString(width - margin_x, y, f"\u20b1{line_total:.2f}")
        y -= 16
        if y < 90:
            pdf.showPage()
            y = height - 60

    pdf.setStrokeColorRGB(0.85, 0.85, 0.85)
    pdf.line(margin_x, y - 6, width - margin_x, y - 6)
    
    y -= 22
    pdf.setFont("Helvetica", 10)
    pdf.drawRightString(width - margin_x, y, f"Subtotal: \u20b1{float(subtotal):.2f}")
    
    if discount_amount > 0:
        y -= 16
        pdf.drawRightString(width - margin_x, y, f"Discount: -\u20b1{float(discount_amount):.2f}")
        
    if shipping_fee > 0:
        y -= 16
        pdf.drawRightString(width - margin_x, y, f"Shipping Fee: \u20b1{float(shipping_fee):.2f}")
        
    y -= 20
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawRightString(width - margin_x, y, f"Total: \u20b1{float(final_total):.2f}")

    pdf.setFont("Helvetica", 9)
    pdf.setFillColorRGB(0.4, 0.4, 0.4)
    pdf.drawString(margin_x, 40, "Thank you for shopping with FarmtoClick.")
    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()
