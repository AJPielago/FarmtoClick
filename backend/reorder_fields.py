"""
Migration script: Reorder fields in users collection
Moves role field to appear after profile_picture and before is_active
"""
from pymongo import MongoClient
from config import config
from datetime import datetime

def reorder_user_fields():
    """Reorder fields in all user documents"""
    try:
        # Connect directly to MongoDB
        dev_config = config['development']
        mongo_uri = dev_config.MONGODB_URI
        client = MongoClient(mongo_uri)
        db = client.get_database()
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        return
    
    try:
        # Get all users
        users = list(db.users.find({}))
        print(f"Found {len(users)} users to reorder")
        
        if len(users) == 0:
            print("⚠️ No users found in database")
            return
        
        for user in users:
            # Extract all fields
            user_data = dict(user)
            user_id = user_data.pop('_id')
            
            # Rebuild document in correct field order
            reordered = {}
            
            # Define field order
            field_order = [
                'email', 'password_hash', 'first_name', 'last_name', 'full_name',
                'phone', 'profile_picture', 'role', 'is_active', 'created_at', 'last_login',
                'business_verification_status', 'business_verification_image', 'business_verification_submitted_at',
                'business_verification_ml', 'permit_extracted_text', 'permit_business_name', 'permit_owner_name',
                'permit_qr_data', 'dti_business_info', 'ml_prediction', 'name_verification',
                'farmer_application_status', 'farmer_application_submitted_at',
                'farm_name', 'farm_description', 'farm_location', 'farm_phone', 'exact_address',
                'overall_location', 'shipping_address', 'id'
            ]
            
            # Add fields in order
            for field in field_order:
                if field in user_data:
                    reordered[field] = user_data.pop(field)
            
            # Add any remaining fields not in the order list
            for field, value in user_data.items():
                reordered[field] = value
            
            # Update document with reordered fields
            db.users.replace_one({'_id': user_id}, reordered)
            print(f"✅ Reordered {user.get('email', 'unknown')}: role field moved to correct position")
        
        print(f"\n✅ Field reordering completed! Reordered {len(users)} users")
        
    except Exception as e:
        print(f"❌ Reordering error: {e}")
        raise
    finally:
        if client:
            client.close()

if __name__ == '__main__':
    print("🚀 Starting field reordering: Moving role field to correct position")
    reorder_user_fields()
