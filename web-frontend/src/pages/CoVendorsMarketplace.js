import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { productsAPI, cartAPI, dtiAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const CoVendorsMarketplace = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [searchParams, setSearchParams] = useSearchParams();
  const [flashMessages, setFlashMessages] = useState([]);
  const navigate = useNavigate();

  const categories = [
    'Vegetables', 'Fruits', 'Grains & Cereals', 'Dairy & Eggs', 'Meat & Poultry',
    'Herbs & Spices', 'Nuts & Seeds', 'Honey & Jams', 'Oils & Condiments',
    'Baked Goods', 'Beverages', 'Organic Products', 'Flowers'
  ];

  const loadProducts = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await productsAPI.getCovendors();
      const prods = response.data?.products || [];
      setProducts(prods);

      // Fetch suggested prices for each product (DTI-based suggestion)
      try {
        const suggestions = await Promise.allSettled(
          prods.map(p => dtiAPI.suggestPrice(p.name || '', p.unit || 'kg', p.category || '', 'co-vendors'))
        );

        const prodsWithSuggestion = prods.map((p, idx) => {
          const res = suggestions[idx];
          if (res.status === 'fulfilled' && res.value?.data) {
            const data = res.value.data;
            return { ...p, suggested_price: data.suggested_price || data.auto_price || null, dti_confidence: data.confidence || 0 };
          }
          return { ...p, suggested_price: null, dti_confidence: 0 };
        });

        setProducts(prodsWithSuggestion);
      } catch (e) {
        // Ignore suggestion errors; keep base products
        console.warn('DTI suggestion fetch failed', e);
      }
    } catch (error) {
      console.error('Error loading co-vendor products:', error);
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const filterProducts = useCallback(() => {
    let filtered = products;

    if (selectedCategory) {
      filtered = filtered.filter(product =>
        product.category && product.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    }

    if (searchQuery) {
      filtered = filtered.filter(product =>
        (product.name && product.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (product.description && product.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    if (minPrice) {
      filtered = filtered.filter(product => parseFloat(product.price) >= parseFloat(minPrice));
    }

    if (maxPrice) {
      filtered = filtered.filter(product => parseFloat(product.price) <= parseFloat(maxPrice));
    }

    if (sortBy === 'price_low') {
      filtered.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    } else if (sortBy === 'price_high') {
      filtered.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    } else if (sortBy === 'name_asc') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'name_desc') {
      filtered.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    setFilteredProducts(filtered);
  }, [products, searchQuery, selectedCategory, minPrice, maxPrice, sortBy]);

  useEffect(() => {
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const min = searchParams.get('min_price');
    const max = searchParams.get('max_price');
    const sort = searchParams.get('sort');

    if (category) setSelectedCategory(category);
    if (search) setSearchQuery(search);
    if (min) setMinPrice(min);
    if (max) setMaxPrice(max);
    if (sort) setSortBy(sort);

    // Only load if user is farmer or admin; otherwise leave empty
    if (user && (user.is_farmer || user.is_admin)) loadProducts();
    else setIsLoading(false);
  }, [searchParams, loadProducts, user]);

  useEffect(() => {
    filterProducts();
  }, [filterProducts]);

  const handleCategoryClick = (category) => {
    setSelectedCategory(selectedCategory === category ? null : category);
    const params = new URLSearchParams(searchParams);
    if (selectedCategory === category) params.delete('category');
    else params.set('category', category);
    setSearchParams(params);
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (selectedCategory) params.set('category', selectedCategory);
    if (searchQuery) params.set('search', searchQuery);
    if (minPrice) params.set('min_price', minPrice);
    if (maxPrice) params.set('max_price', maxPrice);
    if (sortBy) params.set('sort', sortBy);
    setSearchParams(params);
  };

  const handleReset = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    setMinPrice('');
    setMaxPrice('');
    setSortBy('newest');
    setSearchParams({});
  };

  const handleAddToCart = async (productId, productName) => {
    if (!user) {
      navigate('/login');
      return;
    }

    try {
      await cartAPI.addToCart(productId, 1);
      setFlashMessages([{ category: 'success', text: `${productName} added to cart!` }]);
    } catch (error) {
      console.error('Error adding to cart:', error);
      setFlashMessages([{ category: 'error', text: 'Network error. Please check your connection.' }]);
    }
  };

  if (!user || (!user.is_farmer && !user.is_admin)) {
    return (
      <div>
        <Navbar />
        <section className="products-page">
          <div className="container">
            <div style={{ padding: 40, textAlign: 'center' }}>
              <h3>Co-Vendors Marketplace</h3>
              <p>Only users with a farmer or admin account can view co-vendor listings.</p>
              <Link to="/start-selling" className="btn btn-primary">Become a Farmer</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="products-page vendors-shop">
      <Navbar activePage="co-vendors" />

      {flashMessages.length > 0 && (
        <div className="flash-messages">
          {flashMessages.map((message, index) => (
            <div key={index} className={`flash-message flash-${message.category}`}>
              <i className={`fas fa-${message.category === 'success' ? 'check-circle' : message.category === 'error' ? 'exclamation-circle' : 'info-circle'}`}></i>
              {message.text}
              <button className="flash-close" onClick={() => {
                const newMessages = [...flashMessages];
                newMessages.splice(index, 1);
                setFlashMessages(newMessages);
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="products-page-main">
        <div className="container">
          <div style={{ marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}><i className="fas fa-store"></i> Vendors Marketplace</h2>
            <small style={{ color: '#6b7280' }}><strong>Note:</strong> Prices suggested from DTI SRP use a 15% markup in the Vendors Marketplace.</small>
          </div>

          <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.1rem', fontWeight: '600' }}>
              <i className="fas fa-filter"></i> Search & Filter Products
            </h3>
            <form className="filter-form" onSubmit={handleFilterSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
              <div className="filter-group" style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="search" style={{ marginBottom: '6px', fontWeight: '500', fontSize: '0.95rem' }}>
                  <i className="fas fa-search"></i> Search
                </label>
                <input
                  className="filter-input"
                  type="text"
                  id="search"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit' }}
                />
              </div>

              <div className="filter-group" style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="category" style={{ marginBottom: '6px', fontWeight: '500', fontSize: '0.95rem' }}>
                  <i className="fas fa-tag"></i> Category
                </label>
                <select
                  id="category"
                  value={selectedCategory || ''}
                  onChange={(e) => setSelectedCategory(e.target.value || null)}
                  style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  <option value="">All Categories</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group" style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="min_price" style={{ marginBottom: '6px', fontWeight: '500', fontSize: '0.95rem' }}>
                  <i className="fas fa-coins"></i> Min Price
                </label>
                <input
                  className="filter-input"
                  type="number"
                  step="0.01"
                  min="0"
                  id="min_price"
                  placeholder="₱0"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit' }}
                />
              </div>

              <div className="filter-group" style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="max_price" style={{ marginBottom: '6px', fontWeight: '500', fontSize: '0.95rem' }}>
                  <i className="fas fa-coins"></i> Max Price
                </label>
                <input
                  className="filter-input"
                  type="number"
                  step="0.01"
                  min="0"
                  id="max_price"
                  placeholder="₱1000"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  onKeyDown={(e) => ['e', 'E', '+', '-'].includes(e.key) && e.preventDefault()}
                  style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit' }}
                />
              </div>

              <div className="filter-group" style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="sort" style={{ marginBottom: '6px', fontWeight: '500', fontSize: '0.95rem' }}>
                  <i className="fas fa-sort"></i> Sort By
                </label>
                <select
                  className="filter-select"
                  id="sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  <option value="newest">Newest</option>
                  <option value="price_low">Price: Low to High</option>
                  <option value="price_high">Price: High to Low</option>
                  <option value="name_asc">Name: A to Z</option>
                  <option value="name_desc">Name: Z to A</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignSelf: 'flex-end' }}>
                <button type="submit" className="btn btn-primary btn-small" style={{ whiteSpace: 'nowrap' }}>
                  <i className="fas fa-check"></i> Apply
                </button>
                <button type="button" onClick={handleReset} className="btn btn-outline btn-small" style={{ whiteSpace: 'nowrap' }}>
                  <i className="fas fa-undo"></i> Reset
                </button>
              </div>
            </form>
          </div>

          <div className="products-layout" style={{ display: 'block' }}>
            <main className="products-main" style={{ width: '100%' }}>
              {isLoading ? (
                <div className="loading-spinner" style={{ textAlign: 'center', padding: '4rem' }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: '3rem', color: '#4CAF50' }}></i>
                  <p style={{ marginTop: '1rem', color: '#666' }}>Loading vendors products...</p>
                </div>
              ) : filteredProducts.length > 0 ? (
                <>
                  <div className="products-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ color: '#666' }}>
                      {selectedCategory ? (
                        <>Showing {filteredProducts.length} {selectedCategory} product(s)</>
                      ) : (
                        <>Showing {filteredProducts.length} product(s)</>
                      )}
                    </p>
                  </div>

                  <div className="products-grid">
                    {filteredProducts.map(product => (
                      <div key={product.id || product._id} className="product-card">
                        <div className="product-image">
                          {product.image_url || product.image ? (
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
                              onError={(e) => {
                                e.target.style.display = 'none';
                                if (e.target.nextElementSibling) {
                                  e.target.nextElementSibling.style.display = 'flex';
                                }
                              }}
                            />
                          ) : null}
                          <div className="product-placeholder" style={{ display: !product.image_url && !product.image ? 'flex' : 'none' }}>
                            <i className="fas fa-leaf"></i>
                          </div>

                          {product.category && (
                            <span className="category-badge">
                              {product.category.charAt(0).toUpperCase() + product.category.slice(1)}
                            </span>
                          )}
                        </div>

                        <div className="product-info">
                          <h3>{product.name}</h3>

                          <p className="product-farmer">
                            <i className="fas fa-user-tie"></i> by{' '}
                            {(() => {
                              const farmerName = product.farmer?.farm_name || product.farmer?.name ||
                                (product.farmer?.first_name && product.farmer?.last_name ? `${product.farmer.first_name} ${product.farmer.last_name}` : null) ||
                                product.farmer_name || product.user?.name || null;
                              return farmerName ? (
                                <span style={{ color: '#4CAF50' }}>{farmerName}</span>
                              ) : (
                                <span style={{ color: '#999' }}>Unknown Farmer</span>
                              );
                            })()}
                          </p>

                          <p className="product-description">
                            {product.description
                              ? product.description.substring(0, 100) + (product.description.length > 100 ? '...' : '')
                              : 'Fresh produce, directly from the farm.'}
                          </p>

                          <div className="product-meta">
                            <span className="product-price">
                              <i className="fas fa-tag"></i> ₱{parseFloat(product.price).toFixed(2)}/{product.unit || 'unit'}
                            </span>
                            {product.suggested_price != null && (
                              <span className="product-price" style={{ marginLeft: '8px', color: '#ff9800' }}>
                                <i className="fas fa-lightbulb"></i> Suggested: ₱{parseFloat(product.suggested_price).toFixed(2)}
                              </span>
                            )}
                            <span className="product-quantity" style={{ color: product.quantity < 20 ? '#ff6b6b' : '#4CAF50' }}>
                              <i className="fas fa-box"></i> {product.quantity || 0} {product.unit || 'unit'} available
                            </span>
                          </div>

                          <div className="product-actions">
                            <Link to={`/product/${product.id || product._id}`} className="btn btn-outline btn-small">
                              <i className="fas fa-eye"></i> View Details
                            </Link>
                            <button className="btn btn-primary btn-small" onClick={() => handleAddToCart(product.id || product._id, product.name)}>
                              <i className="fas fa-shopping-cart"></i> Add to Cart
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="no-products" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                  <i className="fas fa-box-open" style={{ fontSize: '5rem', color: '#ddd', marginBottom: '1.5rem' }}></i>
                  <h3 style={{ color: '#666', marginBottom: '0.5rem' }}>No Products Found</h3>
                  <p style={{ color: '#999', marginBottom: '2rem' }}>
                    {selectedCategory ? (
                      <>No products available in the "{selectedCategory}" category at the moment.</>
                    ) : (
                      <>There are no vendor products available at the moment.</>
                    )}
                  </p>
                  <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '8px', marginTop: '2rem', maxWidth: '500px', margin: '2rem auto 0' }}>
                    <p style={{ margin: 0, color: '#666' }}>
                      <i className="fas fa-info-circle"></i> Vendors will appear here once farmers add them to the Vendors Marketplace.
                    </p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default CoVendorsMarketplace;
