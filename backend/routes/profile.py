"""
User profile route (template-rendered).
"""
import os
import uuid
from datetime import datetime

from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
import cloudinary.uploader
import re

from db import get_mongodb_db
from helpers import allowed_file, MAX_FILE_SIZE

profile_bp = Blueprint('profile', __name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # routes/ -> backend/
UPLOAD_FOLDER = os.path.join(_BACKEND_DIR, 'static', 'uploads', 'profiles')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@profile_bp.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    shipping_defaults = {}
    try:
        db, _ = get_mongodb_db(profile_bp)
        if db is not None:
            user_doc = db.users.find_one({'email': current_user.email})
            if user_doc:
                shipping_defaults = {
                    'overall_location': user_doc.get('overall_location', ''),
                    'shipping_address': user_doc.get('shipping_address', ''),
                }
    except Exception as e:
        print(f"Shipping defaults load error: {e}")

    def _render():
        return render_template('profile.html', shipping_defaults=shipping_defaults)

    if request.method == 'POST':
        try:
            from user_model import User

            db, _ = get_mongodb_db(profile_bp)
            if db is None:
                flash('Database connection failed. Please try again.', 'error')
                return _render()

            first_name = request.form.get('first_name', '').strip()
            last_name = request.form.get('last_name', '').strip()
            phone = request.form.get('phone', '').strip()

            user = User.get_by_email(db, current_user.email)
            if user:
                user.first_name = first_name
                user.last_name = last_name
                user.phone = phone
                user.overall_location = request.form.get('overall_location', '').strip()
                user.shipping_address = request.form.get('shipping_address', '').strip()

                # Profile picture
                profile_picture = request.files.get('profile_picture')
                remove_picture = request.form.get('remove_profile_picture') == '1'

                if remove_picture:
                    # remove stored profile picture reference
                    # try to remove remote resource if it's a Cloudinary URL
                    try:
                        if hasattr(user, 'profile_picture') and user.profile_picture and user.profile_picture.startswith('http'):
                            # attempt to extract public_id from Cloudinary URL and destroy
                            m = re.search(r"/upload/(?:v\d+/)?(.+?)\.(?:jpg|jpeg|png|gif|webp)$", user.profile_picture)
                            if m:
                                public_id = m.group(1)
                                cloudinary.uploader.destroy(public_id)
                    except Exception:
                        pass
                    if hasattr(user, 'profile_picture') and user.profile_picture:
                        # if it was stored locally, remove local file
                        old = os.path.join(UPLOAD_FOLDER, user.profile_picture)
                        if os.path.exists(old):
                            try:
                                os.remove(old)
                            except Exception:
                                pass
                    user.profile_picture = None
                elif profile_picture and profile_picture.filename:
                    if allowed_file(profile_picture.filename):
                        profile_picture.seek(0, os.SEEK_END)
                        fsize = profile_picture.tell()
                        profile_picture.seek(0)
                        if fsize > MAX_FILE_SIZE:
                            flash('Profile picture must be less than 5MB.', 'error')
                            return _render()

                        # Upload to Cloudinary
                        try:
                            upload_res = cloudinary.uploader.upload(
                                profile_picture,
                                folder='farmtoclick/profiles',
                                resource_type='image'
                            )
                            secure_url = upload_res.get('secure_url')
                        except Exception as e:
                            print(f"Cloudinary upload failed: {e}")
                            flash('Failed to upload profile picture. Please try again.', 'error')
                            return _render()

                        # remove old local file if exists
                        if hasattr(user, 'profile_picture') and user.profile_picture:
                            old = os.path.join(UPLOAD_FOLDER, user.profile_picture)
                            if os.path.exists(old):
                                try:
                                    os.remove(old)
                                except Exception:
                                    pass
                        # store full URL in profile_picture for easy serving
                        user.profile_picture = secure_url
                    else:
                        flash('Invalid file type. Please upload JPG, PNG, GIF, or WebP image.', 'error')
                        return _render()

                # Farmer fields
                if user.role == 'farmer':
                    user.farm_name = request.form.get('farm_name', '').strip()
                    user.farm_description = request.form.get('farm_description', '').strip()
                    user.farm_location = request.form.get('farm_location', '').strip()
                    user.farm_phone = request.form.get('farm_phone', '').strip()

                # Password change
                current_password = request.form.get('current_password', '')
                new_password = request.form.get('new_password', '')
                confirm_password = request.form.get('confirm_password', '')

                if new_password:
                    if not current_password:
                        flash('Please enter your current password to change password', 'error')
                        return _render()
                    if not user.check_password(current_password):
                        flash('Current password is incorrect', 'error')
                        return _render()
                    if new_password != confirm_password:
                        flash('New passwords do not match', 'error')
                        return _render()
                    if len(new_password) < 6:
                        flash('Password must be at least 6 characters long', 'error')
                        return _render()
                    user.set_password(new_password)

                user.save(db)

                try:
                    db.users.update_one(
                        {'email': current_user.email},
                        {'$set': {
                            'shipping_name': user.shipping_name,
                            'shipping_phone': user.shipping_phone,
                            'overall_location': user.overall_location,
                            'shipping_address': user.shipping_address,
                            'updated_at': datetime.utcnow(),
                        }},
                    )
                except Exception as e:
                    print(f"Shipping info save error: {e}")

                flash('Profile updated successfully!', 'success')
                return redirect(url_for('profile.profile'))

        except Exception as e:
            flash(f'Profile update failed: {str(e)}', 'error')

    return _render()
