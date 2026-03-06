# FarmtoClick - Fresh Produce Marketplace

FarmtoClick is an e-commerce platform that connects consumers directly with local farmers, providing a marketplace for fresh, locally-grown produce.

## Features

- **Landing Page**: Welcoming homepage showcasing featured products and farmers
- **Product Catalog**: Browse and search for fresh produce by category
- **Farmer Profiles**: Learn about local farmers and their farming practices
- **Product Details**: Detailed information about each product including pricing and availability
- **Responsive Design**: Mobile-friendly interface that works on all devices
- **Direct Farmer-to-Consumer**: Connect directly with the people who grow your food

## Technology Stack

- **Backend**: Flask (Python web framework)
- **Database**: SQLite with SQLAlchemy ORM
- **Frontend**: HTML5, CSS3, JavaScript
- **Styling**: Custom CSS with responsive design
- **Icons**: Emoji icons for simplicity and universal compatibility

## Project Structure

```
FarmtoClick/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── README.md             # Project documentation
├── static/
│   ├── css/
│   │   └── style.css     # Main stylesheet
│   ├── js/
│   │   └── script.js     # JavaScript functionality
│   └── images/           # Image assets (placeholder)
└── templates/
    ├── landing.html      # Landing page
    ├── products.html     # Products listing page
    ├── farmers.html      # Farmers listing page
    ├── farmer_profile.html # Individual farmer profile
    └── product_detail.html # Individual product details
```

## Installation

### Prerequisites

- Python 3.7 or higher
- pip (Python package manager)

### Setup Instructions

1. **Clone or download the project** to your local machine

2. **Navigate to the project directory**:
   ```bash
   cd FarmtoClick
   ```

3. **Create a virtual environment** (recommended):
   ```bash
   python -m venv venv
   ```

4. **Activate the virtual environment**:
   
   - On Windows:
     ```bash
     venv\Scripts\activate
     ```
   
   - On macOS/Linux:
     ```bash
     source venv/bin/activate
     ```

5. **Install the required dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

6. **Run the application**:
   ```bash
   python app.py
   ```

7. **Open your web browser** and navigate to:
   ```
   http://127.0.0.1:5000
   ```

## Usage

### For Consumers

1. **Browse Products**: Visit the landing page and click "Shop Now" to browse available products
2. **Filter by Category**: Use category filters to find specific types of produce
3. **View Product Details**: Click on any product to see detailed information
4. **Meet Farmers**: Browse farmer profiles to learn about local producers
5. **Contact Farmers**: Use provided contact information to reach out directly

### For Farmers

1. **Join the Platform**: Contact the platform administrators to register as a farmer
2. **List Products**: Add your fresh produce to the marketplace
3. **Manage Inventory**: Update product availability and pricing
4. **Connect with Customers**: Receive direct inquiries from local consumers

## Database Models

### Farmer
- Personal information (name, email, phone)
- Farm details (farm name, location, description)
- Relationship with products

### Product
- Product information (name, description, price)
- Inventory details (quantity, unit, availability)
- Category classification
- Relationship with farmer

## API Endpoints

- `GET /` - Landing page with featured products and farmers
- `GET /products` - Products listing with optional category filtering
- `GET /products?category=<category>` - Filtered products by category
- `GET /farmers` - All farmers listing
- `GET /farmer/<id>` - Individual farmer profile
- `GET /product/<id>` - Individual product details

## Customization

### Adding Sample Data

To add sample data for testing, you can create a script or use the Flask shell:

```python
from app import app, db, Farmer, Product

with app.app_context():
    # Create sample farmer
    farmer = Farmer(
        name="John Smith",
        email="john@greenvalleyfarm.com",
        phone="555-0123",
        farm_name="Green Valley Farm",
        location="Springfield, IL",
        description="Family-owned organic farm specializing in seasonal vegetables."
    )
    db.session.add(farmer)
    
    # Create sample product
    product = Product(
        name="Fresh Tomatoes",
        description="Vine-ripened tomatoes grown without pesticides",
        price=3.99,
        quantity=50,
        unit="lb",
        category="vegetables",
        farmer=farmer
    )
    db.session.add(product)
    db.session.commit()
```

### Styling Customization

- Edit `static/css/style.css` to modify colors, layouts, and responsive behavior
- The design uses a green color scheme (#2c7a2c) representing agriculture and freshness
- Responsive breakpoints are set at 768px and 480px for mobile devices

### Adding New Features

- Add new routes in `app.py`
- Create corresponding templates in the `templates/` directory
- Update the navigation menu in all templates
- Add new CSS styles as needed

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Future Enhancements

- User authentication and registration system
- Shopping cart and checkout functionality
- Payment integration
- Order management system
- Farmer dashboard for product management
- Review and rating system
- Advanced search and filtering
- Email notifications
- Mobile app development

## Support

For questions, issues, or feature requests, please contact:
- Email: info@farmtoclick.com
- Phone: (555) 123-4567

## License

This project is open source and available under the MIT License.

---

**FarmtoClick** - Connecting communities with fresh, local produce since 2024.
