#!/usr/bin/env python3
"""
Migration script: upload existing local uploads to Cloudinary and update DB documents.
Run with: python scripts/migrate_to_cloudinary.py
"""
import os
import sys
import glob
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader
from db import get_mongodb_db

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS_FOLDER = os.path.join(_BASE, 'static', 'uploads', 'products')
PROFILES_FOLDER = os.path.join(_BASE, 'static', 'uploads', 'profiles')

if __name__ == '__main__':
    # Ensure environment variables (including Cloudinary keys) are loaded
    _ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(_ROOT, '.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)

    # Configure Cloudinary from environment variables
    cloudinary.config(
        cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
        api_key=os.environ.get('CLOUDINARY_API_KEY'),
        api_secret=os.environ.get('CLOUDINARY_API_SECRET'),
        secure=True,
    )

    db, _ = get_mongodb_db()
    if db is None:
        print('Database connection failed')
        sys.exit(1)

    # Upload product images
    for filepath in glob.glob(os.path.join(PRODUCTS_FOLDER, '*')):
        fname = os.path.basename(filepath)
        print('Uploading', fname)
        try:
            res = cloudinary.uploader.upload(filepath, folder='farmtoclick/products', resource_type='image')
            url = res.get('secure_url')
            # Update any product docs that reference this filename in image_url or image
            db.products.update_many({'image': fname}, {'$set': {'image_url': url}})
            db.products.update_many({'image_url': {'$regex': f'.*{fname}'}}, {'$set': {'image_url': url}})
            print(' -> uploaded to', url)
        except Exception as e:
            print(' -> failed:', e)

    # Upload profile pictures
    for filepath in glob.glob(os.path.join(PROFILES_FOLDER, '*')):
        fname = os.path.basename(filepath)
        print('Uploading profile', fname)
        try:
            res = cloudinary.uploader.upload(filepath, folder='farmtoclick/profiles', resource_type='image')
            url = res.get('secure_url')
            # Update user docs
            db.users.update_many({'profile_picture': fname}, {'$set': {'profile_picture': url}})
            db.users.update_many({'profile_picture': {'$regex': f'.*{fname}'}}, {'$set': {'profile_picture': url}})
            print(' -> uploaded to', url)
        except Exception as e:
            print(' -> failed:', e)

    print('Migration complete')
