"""
Migration script: Convert is_farmer boolean to role string field
Converts:
  is_farmer: True  → role: "farmer"
  is_farmer: False → role: "user"
"""
from pymongo import MongoClient
from config import config
from datetime import datetime

def migrate_users_to_role():
    """Migrate all users from is_farmer to role field"""
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
        print(f"Found {len(users)} users to migrate")
        
        if len(users) == 0:
            print("⚠️ No users found in database")
            return
        
        for user in users:
            # Determine role based on is_farmer value
            is_farmer = user.get('is_farmer', False)
            new_role = 'farmer' if is_farmer else 'user'
            
            # Update user with new role field
            db.users.update_one(
                {'_id': user['_id']},
                {
                    '$set': {'role': new_role},
                    '$unset': {'is_farmer': ''}  # Remove old field
                }
            )
            print(f"✅ Migrated {user['email']}: is_farmer={is_farmer} → role={new_role}")
        
        print(f"\n✅ Migration completed! Migrated {len(users)} users")
        
        # Verify migration
        users_without_role = db.users.count_documents({'role': {'$exists': False}})
        users_with_role = db.users.count_documents({'role': {'$exists': True}})
        
        print(f"\nVerification:")
        print(f"  - Users with 'role' field: {users_with_role}")
        print(f"  - Users without 'role' field: {users_without_role}")
        
    except Exception as e:
        print(f"❌ Migration error: {e}")
        raise
    finally:
        if client:
            client.close()

if __name__ == '__main__':
    print("🚀 Starting migration: is_farmer → role")
    migrate_users_to_role()
