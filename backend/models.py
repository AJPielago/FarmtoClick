from flask_login import UserMixin
from mongoengine import Document, StringField, EmailField, BooleanField, DateTimeField, ReferenceField, ListField, FloatField, IntField, DictField
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

def _to_iso(value):
    if not value:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return None

class User(UserMixin, Document):
    meta = {'collection': 'users', 'strict': False}  # Allow extra fields from PyMongo
    
    email = EmailField(required=True, unique=True)
    password_hash = StringField(required=True, min_length=6)
    first_name = StringField(required=True, max_length=50)
    last_name = StringField(required=True, max_length=50)
    phone = StringField(max_length=20)
    profile_picture = StringField()
    role = StringField(default='user', choices=['user', 'farmer', 'admin'])
    is_active = BooleanField(default=True)
    created_at = DateTimeField(default=datetime.utcnow)
    last_login = DateTimeField()
    
    # For farmers
    farm_name = StringField(max_length=100)
    farm_description = StringField()
    farm_location = StringField(max_length=200)
    farm_phone = StringField(max_length=20)
    
    # Additional fields from PyMongo backend (compatibility)
    # These are optional and handled by 'strict': False
    # - business_verification_status
    # - business_verification_image
    # - business_verification_submitted_at
    # - business_verification_ml
    # - permit_extracted_text
    # - farmer_application_status
    # - farmer_application_submitted_at
    # - exact_address
    # - full_name
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"
    
    def to_dict(self):
        return {
            'id': str(self.id),
            'email': self.email,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'full_name': self.full_name,
            'phone': self.phone,
            'profile_picture': self.profile_picture,
            'role': self.role,
            'is_active': self.is_active,
            'farm_name': self.farm_name,
            'farm_location': self.farm_location,
            'created_at': _to_iso(self.created_at)
        }

class Product(Document):
    meta = {'collection': 'products'}
    
    name = StringField(required=True, max_length=100)
    description = StringField(required=True)
    price = FloatField(required=True)
    quantity = IntField(required=True)
    unit = StringField(required=True, max_length=20)
    category = StringField(required=True, max_length=50)
    image_url = StringField(max_length=200)
    available = BooleanField(default=True)
    created_at = DateTimeField(default=datetime.utcnow)
    farmer = ReferenceField(User, required=True)
    
    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'price': self.price,
            'quantity': self.quantity,
            'unit': self.unit,
            'category': self.category,
            'image_url': self.image_url,
            'available': self.available,
            'created_at': _to_iso(self.created_at),
            'farmer_id': str(self.farmer.id) if self.farmer else None,
            'farmer_name': self.farmer.full_name if self.farmer else None,
            'farm_name': self.farmer.farm_name if self.farmer else None
        }

class Order(Document):
    meta = {'collection': 'orders'}
    
    user = ReferenceField(User, required=True)
    items = ListField(ReferenceField(Product))
    total_amount = FloatField(required=True)
    status = StringField(default='pending', choices=['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'])
    delivery_address = StringField()
    delivery_notes = StringField()
    driver_location = DictField()  # Stores {'lat': float, 'lng': float, 'updated_at': datetime}
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': str(self.id),
            'user_id': str(self.user.id) if self.user else None,
            'items': [str(item.id) for item in self.items],
            'total_amount': self.total_amount,
            'status': self.status,
            'delivery_address': self.delivery_address,
            'delivery_notes': self.delivery_notes,
            'driver_location': self.driver_location,
            'created_at': _to_iso(self.created_at),
            'updated_at': _to_iso(self.updated_at)
        }

class Review(Document):
    meta = {
        'collection': 'reviews',
        'indexes': [
            {'fields': ['user', 'product'], 'unique': True},  # one review per user per product
            'product',
            'created_at',
        ],
    }

    user = ReferenceField(User, required=True)
    product = ReferenceField(Product, required=True)
    rating = IntField(required=True, min_value=1, max_value=5)
    comment = StringField(max_length=1000)
    updated_at = DateTimeField()
    created_at = DateTimeField(default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': str(self.id),
            'user_id': str(self.user.id) if self.user else None,
            'user_name': self.user.full_name if self.user else None,
            'user_profile_picture': self.user.profile_picture if self.user else None,
            'product_id': str(self.product.id) if self.product else None,
            'product_name': self.product.name if self.product else None,
            'rating': self.rating,
            'comment': self.comment,
            'updated_at': _to_iso(self.updated_at),
            'created_at': _to_iso(self.created_at),
        }

class PermitVerification(Document):
    meta = {'collection': 'permit_verifications', 'indexes': ['user_email', 'status', 'created_at']}
    
    # Store user email instead of ReferenceField to avoid ObjectId/UUID conflicts
    user_email = StringField(required=True)
    user_name = StringField()  # Cache user name for display
    user_farm_name = StringField()  # Cache farm name for display
    
    status = StringField(required=True, default='rejected', choices=['verified', 'rejected'])
    
    # Full verification result from ML system
    verification_result = DictField(required=True)
    
    # Extract key fields for easier querying
    confidence = FloatField(default=0.0)
    valid = BooleanField(default=False)
    
    # Image information
    image_filename = StringField()  # e.g., "permit_uuid_filename.jpg"
    image_path = StringField()      # Full file path
    
    # Form data submitted
    permit_business_name = StringField()
    permit_owner_name = StringField()
    
    # DTI information (if found)
    dti_business_name = StringField()
    dti_owner_name = StringField()
    dti_business_number = StringField()
    
    # QR data
    qr_data = StringField()
    qr_valid = BooleanField(default=False)
    
    # ML prediction
    ml_confidence = FloatField(default=0.0)
    ml_is_permit = BooleanField(default=False)
    
    # Admin review
    admin_notes = StringField()
    reviewed_by = StringField()  # Admin email
    reviewed_at = DateTimeField()
    
    # Timestamps
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': str(self.id),
            'user_email': self.user_email,
            'user_name': self.user_name,
            'user_farm_name': self.user_farm_name,
            'status': self.status,
            'confidence': self.confidence,
            'valid': self.valid,
            'permit_business_name': self.permit_business_name,
            'permit_owner_name': self.permit_owner_name,
            'dti_business_name': self.dti_business_name,
            'dti_owner_name': self.dti_owner_name,
            'ml_confidence': self.ml_confidence,
            'ml_is_permit': self.ml_is_permit,
            'qr_valid': self.qr_valid,
            'admin_notes': self.admin_notes,
            'reviewed_at': _to_iso(self.reviewed_at),
            'created_at': _to_iso(self.created_at),
            'updated_at': _to_iso(self.updated_at)
        }

