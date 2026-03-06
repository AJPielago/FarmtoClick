from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import uuid
import traceback

class User(UserMixin):
    """Simple User class using PyMongo directly"""
    
    def __init__(self, **kwargs):
        self.id = kwargs.get('id') or str(uuid.uuid4())
        self.email = kwargs.get('email', '')
        self.password_hash = kwargs.get('password_hash', '')
        self.first_name = kwargs.get('first_name', '')
        self.last_name = kwargs.get('last_name', '')
        self.phone = kwargs.get('phone', '')
        self.profile_picture = kwargs.get('profile_picture', None)
        self.role = kwargs.get('role', 'user')
        self._is_active = kwargs.get('is_active', True)  # Use private attribute
        self.created_at = kwargs.get('created_at', datetime.utcnow())
        self.last_login = kwargs.get('last_login', None)

        # Farmer business verification
        self.business_verification_status = kwargs.get('business_verification_status', None)
        self.business_verification_image = kwargs.get('business_verification_image', None)
        self.business_verification_submitted_at = kwargs.get('business_verification_submitted_at', None)
        self.business_verification_ml = kwargs.get('business_verification_ml', None)
        self.permit_extracted_text = kwargs.get('permit_extracted_text', '')

        # Name verification fields (cross-checked against DTI)
        self.permit_business_name = kwargs.get('permit_business_name', '')
        self.permit_owner_name = kwargs.get('permit_owner_name', '')
        self.permit_qr_data = kwargs.get('permit_qr_data', '')
        self.dti_business_info = kwargs.get('dti_business_info', None)
        self.ml_prediction = kwargs.get('ml_prediction', None)
        self.name_verification = kwargs.get('name_verification', None)

        self.farmer_application_status = kwargs.get('farmer_application_status', None)
        self.farmer_application_submitted_at = kwargs.get('farmer_application_submitted_at', None)
        
        # For farmers
        self.farm_name = kwargs.get('farm_name', '')
        self.farm_description = kwargs.get('farm_description', '')
        self.farm_location = kwargs.get('farm_location', '')
        self.farm_phone = kwargs.get('farm_phone', '')
        self.exact_address = kwargs.get('exact_address', '')
        self.overall_location = kwargs.get('overall_location', '')
        self.shipping_address = kwargs.get('shipping_address', '')
    
    @property
    def is_active(self):
        """Get is_active status"""
        return getattr(self, '_is_active', True)
    
    @is_active.setter
    def is_active(self, value):
        """Set is_active status"""
        self._is_active = value
    
    def set_password(self, password):
        """Hash and set password"""
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """Check if password matches"""
        return check_password_hash(self.password_hash, password)
    
    @property
    def full_name(self):
        """Get full name"""
        return f"{self.first_name} {self.last_name}"
    
    def to_dict(self):
        """Convert to dictionary"""
        def _to_iso(value):
            if not value:
                return None
            if isinstance(value, str):
                return value
            if hasattr(value, 'isoformat'):
                try:
                    return value.isoformat()
                except Exception:
                    return None
            return None

        return {
            'id': self.id,
            'email': self.email,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'full_name': self.full_name,
            'phone': self.phone,
            'profile_picture': self.profile_picture,
            'role': self.role,
            'is_active': self.is_active,
            'created_at': _to_iso(self.created_at),
            'last_login': _to_iso(self.last_login),
            'business_verification_status': self.business_verification_status,
            'business_verification_image': self.business_verification_image,
            'business_verification_submitted_at': _to_iso(self.business_verification_submitted_at),
            'business_verification_ml': self.business_verification_ml,
            'permit_extracted_text': self.permit_extracted_text,
            'permit_business_name': self.permit_business_name,
            'permit_owner_name': self.permit_owner_name,
            'permit_qr_data': self.permit_qr_data,
            'dti_business_info': self.dti_business_info,
            'ml_prediction': self.ml_prediction,
            'name_verification': self.name_verification,
            'farmer_application_status': self.farmer_application_status,
            'farmer_application_submitted_at': _to_iso(self.farmer_application_submitted_at),
            'farm_name': self.farm_name,
            'farm_description': self.farm_description,
            'farm_location': self.farm_location,
            'farm_phone': self.farm_phone,
            'exact_address': self.exact_address,
            'overall_location': self.overall_location,
            'shipping_address': self.shipping_address
        }
    
    @classmethod
    def from_dict(cls, data):
        """Create user from dictionary"""
        return cls(**data)
    
    def save(self, db):
        """Save user to database"""
        try:
            user_data = self.to_dict()
            user_data.pop('id', None)  # Remove id for update
            
            # Preserve the actual is_active value from the object
            user_data['is_active'] = self.is_active

            # Ensure password_hash is included for DB persistence
            user_data['password_hash'] = self.password_hash
            
            print(f"💾 Attempting to save user: {self.email} (role={self.role})")
            
            if db.users.find_one({'email': self.email}):
                # Update existing user
                result = db.users.update_one({'email': self.email}, {'$set': user_data})
                print(f"✅ Update result: {result.modified_count}")
            else:
                # Insert new user
                user_data['id'] = self.id
                result = db.users.insert_one(user_data)
                print(f"✅ Insert result: {result.inserted_id}")
            
            # Verify the save
            saved_user = db.users.find_one({'email': self.email})
            if saved_user:
                print(f"✅ Verification: User found in database with email {saved_user.get('email')}")
            else:
                print(f"❌ Verification: User NOT found in database")
                
        except Exception as e:
            print(f"❌ Save error: {e}")
            print(traceback.format_exc())
            raise
    
    @classmethod
    def get_by_email(cls, db, email):
        """Get user by email"""
        user_data = db.users.find_one({'email': email})
        if user_data:
            return cls.from_dict(user_data)
        return None
    
    @classmethod
    def get_by_id(cls, db, user_id):
        """Get user by ID"""
        user_data = db.users.find_one({'id': user_id})
        if user_data:
            return cls.from_dict(user_data)
        else:
            # Try with MongoDB _id as fallback
            try:
                from bson.objectid import ObjectId
                user_data = db.users.find_one({'_id': ObjectId(user_id)})
                if user_data:
                    return cls.from_dict(user_data)
            except:
                pass
        return None
