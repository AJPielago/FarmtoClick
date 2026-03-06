import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { productsAPI, cartAPI } from '../services/api';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ProductReviews from '../components/ProductReviews';

const ProductDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { refreshCartCount } = useCart();
  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [flashMessage, setFlashMessage] = useState(null);

  const renderStars = (ratingValue) => {
    const rating = Math.max(0, Math.min(5, Number(ratingValue || 0)));
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating - fullStars >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {Array.from({ length: fullStars }).map((_, idx) => (
          <i key={`full-${idx}`} className="fas fa-star" style={{ color: '#f59e0b' }}></i>
        ))}
        {hasHalfStar && <i className="fas fa-star-half-alt" style={{ color: '#f59e0b' }}></i>}
        {Array.from({ length: emptyStars }).map((_, idx) => (
          <i key={`empty-${idx}`} className="far fa-star" style={{ color: '#d1d5db' }}></i>
        ))}
      </span>
    );
  };

  const loadProduct = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await productsAPI.getById(id);
      setProduct(response.product || response.data || response);
      
      // Load related products from same farmer
      if (response.product?.farmer?.id || response.product?.farmer_id) {
        const farmerId = response.product?.farmer?.id || response.product?.farmer_id;
        const relatedRes = await productsAPI.getProducts({ farmer_id: farmerId, limit: 4 });
        const filtered = (relatedRes.products || []).filter(p => (p.id || p._id) !== id && p.available);
        setRelatedProducts(filtered.slice(0, 4));
      }
    } catch (error) {
      console.error('Error loading product:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  const decreaseQuantity = () => {
    if (quantity > 1) setQuantity(quantity - 1);
  };

  const increaseQuantity = () => {
    if (quantity < product.quantity) setQuantity(quantity + 1);
  };

  const handleAddToCart = async () => {
    if (!user) {
      setFlashMessage({ type: 'error', text: 'Please login to add items to cart' });
      return;
    }

    try {
      await cartAPI.addToCart(product.id || product._id, quantity);
      setFlashMessage({ type: 'success', text: `Added ${quantity} ${product.unit} of ${product.name} to cart!` });
      refreshCartCount();
    } catch (error) {
      setFlashMessage({ type: 'error', text: 'Failed to add to cart. Please try again.' });
    }
  };


  if (isLoading) {
    return (
      <div className="product-detail-page">
        <Navbar activePage="products" />
        <div className="container" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#2c7a2c' }}></i>
          <p style={{ marginTop: '16px' }}>Loading product...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="product-detail-page">
        <Navbar activePage="products" />
        <div className="container" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <i className="fas fa-exclamation-triangle" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '16px' }}></i>
          <h2>Product not found</h2>
          <p>The product you're looking for doesn't exist or has been removed.</p>
          <Link to="/products" className="btn btn-primary" style={{ marginTop: '20px' }}>Browse Products</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="product-detail-page">
      {/* Navigation */}
      <Navbar activePage="products" />

      {/* Flash Message */}
      {flashMessage && (
        <div className="container" style={{ paddingTop: '20px' }}>
          <div className={`alert alert-${flashMessage.type}`}>
            {flashMessage.text}
            <button onClick={() => setFlashMessage(null)} style={{ marginLeft: '10px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      )}

      {/* Product Detail Section */}
      <section className="product-detail">
        <div className="container">
          <div className="product-detail-layout">
            <div className="product-image-section">
              <div className="product-image-large">
                {(product.image_url || product.image) ? (
                  <img
                    src={
                      (() => {
                        const val = (product.image_url || product.image || '');
                        if (!val) return '';
                        if (val.startsWith('http') || val.startsWith('/')) return val;
                        return `/uploads/products/${val}`;
                      })()
                    }
                    alt={product.name}
                  />
                ) : (
                  <div className="product-placeholder-large"><i className="fas fa-leaf"></i></div>
                )}
              </div>
            </div>

            <div className="product-info-section">
              <h1>{product.name}</h1>
              <p className="product-category">{product.category ? product.category.charAt(0).toUpperCase() + product.category.slice(1) : 'Uncategorized'}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#6b7280' }}>
                {renderStars(product.average_rating)}
                <strong style={{ color: '#374151' }}>{Number(product.average_rating || 0).toFixed(1)}</strong>
                <span>({Number(product.review_count || 0)} review{Number(product.review_count || 0) === 1 ? '' : 's'})</span>
              </div>

              <div className="product-farmer-info">
                {product.farmer ? (
                  <>
                    <p>Sold by: <Link to={`/farmer/${product.farmer.id || product.farmer_id}`}>{product.farmer.farm_name || product.farmer.name || 'Unknown Farm'}</Link></p>
                    <p className="location"><i className="fas fa-map-marker-alt"></i> {product.farmer.location || product.farmer.farm_location || 'Location not specified'}</p>
                  </>
                ) : (
                  <>
                    <p>Sold by: <span>Unknown Farmer</span></p>
                    <p className="location"><i className="fas fa-map-marker-alt"></i> Location not specified</p>
                  </>
                )}
              </div>

              <div className="product-price-section">
                <div className="price">₱{product.price?.toFixed(2)}/{product.unit}</div>
                <div className="availability">
                  {product.available !== false && product.quantity > 0 ? (
                    <>
                      <span className="available"><i className="fas fa-check-circle"></i> In Stock</span>
                      <span className="quantity">{product.quantity} {product.unit} available</span>
                    </>
                  ) : (
                    <span className="unavailable"><i className="fas fa-times-circle"></i> Out of Stock</span>
                  )}
                </div>
              </div>

              <div className="product-description">
                <h3>Description</h3>
                <p>{product.description}</p>
              </div>

              {product.available !== false && product.quantity > 0 && (
                <div className="purchase-section">
                  <div className="quantity-selector">
                    <label htmlFor="quantity">Quantity:</label>
                    <div className="quantity-controls">
                      <button type="button" onClick={decreaseQuantity}>-</button>
                      <input type="number" id="quantity" value={quantity} min="1" max={product.quantity} onChange={(e) => setQuantity(Math.min(Math.max(1, parseInt(e.target.value) || 1), product.quantity))} onKeyDown={(e) => ['e', 'E', '+', '-', '.'].includes(e.key) && e.preventDefault()} />
                      <button type="button" onClick={increaseQuantity}>+</button>
                    </div>
                    <span className="unit">{product.unit}</span>
                  </div>
                  <div className="purchase-actions">
                    <button className="btn btn-primary btn-large" onClick={handleAddToCart}>
                      Add to Cart
                    </button>
                    <button className="btn btn-outline"><i className="fas fa-heart"></i> Save for Later</button>
                  </div>
                </div>
              )}

              <div className="product-meta">
                <h3>Product Details</h3>
                <ul>
                  <li><strong>Category:</strong> {product.category ? product.category.charAt(0).toUpperCase() + product.category.slice(1) : 'Uncategorized'}</li>
                  <li><strong>Price per {product.unit}:</strong> ₱{product.price?.toFixed(2)}</li>
                  <li><strong>Available Quantity:</strong> {product.quantity} {product.unit}</li>
                  <li><strong>Farm:</strong> {product.farmer?.farm_name || product.farmer?.name || 'Unknown Farm'}</li>
                  <li><strong>Location:</strong> <i className="fas fa-map-marker-alt"></i> {product.farmer?.location || product.farmer?.farm_location || 'Location not specified'}</li>
                  {product.created_at && (
                    <li><strong>Listed on:</strong> {new Date(product.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Reviews */}
      <ProductReviews productId={id} />

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <section className="related-products">
          <div className="container">
            <h2>More from {product.farmer?.name || product.farmer?.farm_name || 'this farmer'}</h2>
            <div className="products-grid">
              {relatedProducts.map(relatedProduct => (
                <div key={relatedProduct.id || relatedProduct._id} className="product-card">
                  <div className="product-image">
                    {(relatedProduct.image_url || relatedProduct.image) ? (
                      <img
                        src={
                          (() => {
                            const val = (relatedProduct.image_url || relatedProduct.image || '');
                            if (!val) return '';
                            if (val.startsWith('http') || val.startsWith('/')) return val;
                            return `/uploads/products/${val}`;
                          })()
                        }
                        alt={relatedProduct.name}
                      />
                    ) : (
                      <div className="product-placeholder"><i className="fas fa-leaf"></i></div>
                    )}
                  </div>
                  <div className="product-info">
                    <h3>{relatedProduct.name}</h3>
                    <p className="product-price">₱{relatedProduct.price?.toFixed(2)}/{relatedProduct.unit}</p>
                    <Link to={`/product/${relatedProduct.id || relatedProduct._id}`} className="btn btn-outline btn-small">View Details</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
};

export default ProductDetail;