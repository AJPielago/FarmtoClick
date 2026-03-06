// Mobile Menu Toggle
function toggleMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    const mobileToggle = document.querySelector('.mobile-menu-toggle i');
    
    navMenu.classList.toggle('active');
    
    if (navMenu.classList.contains('active')) {
        mobileToggle.classList.remove('fa-bars');
        mobileToggle.classList.add('fa-times');
    } else {
        mobileToggle.classList.remove('fa-times');
        mobileToggle.classList.add('fa-bars');
    }
}

// Close mobile menu when clicking on a link
document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const navMenu = document.querySelector('.nav-menu');
            const mobileToggle = document.querySelector('.mobile-menu-toggle i');
            
            navMenu.classList.remove('active');
            mobileToggle.classList.remove('fa-times');
            mobileToggle.classList.add('fa-bars');
        });
    });
});

// FAQ Accordion functionality
document.addEventListener('DOMContentLoaded', function() {
    // FAQ accordion
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', () => {
            // Close all other FAQ items
            faqItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current FAQ item
            item.classList.toggle('active');
        });
    });
    
    // Real YouTube video functionality
    function playVideo(button) {
        const card = button.closest('.resource-card');
        const iframe = card.querySelector('iframe');
        const currentSrc = iframe.src;
        
        // Enable autoplay by adding autoplay parameter
        if (!currentSrc.includes('autoplay=1')) {
            iframe.src = currentSrc + '&autoplay=1';
        }
        
        // Scroll to video
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // Video placeholder interactions (for any remaining placeholders)
    const videoPlaceholders = document.querySelectorAll('.video-placeholder');
    
    videoPlaceholders.forEach(placeholder => {
        placeholder.addEventListener('click', function() {
            // Simulate video playback
            const playIcon = this.querySelector('i');
            const img = this.querySelector('img');
            
            if (playIcon) {
                // Create a simple video player simulation
                this.innerHTML = `
                    <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #000; color: white; font-size: 1.2rem;">
                        <div style="text-align: center;">
                            <i class="fas fa-play-circle" style="font-size: 3rem; margin-bottom: 10px;"></i>
                            <p>Video Player Demo</p>
                            <p style="font-size: 0.9rem; opacity: 0.7;">Click to close</p>
                        </div>
                    </div>
                `;
                
                // Add click to close functionality
                this.addEventListener('click', function(e) {
                    e.stopPropagation();
                    location.reload(); // Simple way to restore original state
                }, { once: true });
            }
        });
    });
    
    // Learning card interactions
    const learningCards = document.querySelectorAll('.learning-card');
    
    learningCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            const icon = this.querySelector('.learning-icon');
            if (icon) {
                icon.style.background = '#236623';
            }
        });
        
        card.addEventListener('mouseleave', function() {
            const icon = this.querySelector('.learning-icon');
            if (icon) {
                icon.style.background = '#2c7a2c';
            }
        });
    });
    
    // Resource card video button interactions
    const resourceButtons = document.querySelectorAll('.resource-card .btn');
    
    resourceButtons.forEach(button => {
        if (button.textContent.includes('Watch Video')) {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                const card = this.closest('.resource-card');
                const videoPlaceholder = card.querySelector('.video-placeholder');
                
                if (videoPlaceholder) {
                    videoPlaceholder.click();
                }
            });
        }
    });
    
    // Learning hub button interactions
    const learningButtons = document.querySelectorAll('.learning-card .btn');
    
    learningButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            const card = this.closest('.learning-card');
            const title = card.querySelector('h3').textContent;
            
            // Simulate navigation to detailed resource
            alert(`Navigating to ${title}... (This would open a detailed page in a full implementation)`);
        });
    });
});

// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scrolling for anchor links
    const anchorLinks = document.querySelectorAll('a[href^="#"]');
    anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });

    // Add to cart functionality
    const addToCartButtons = document.querySelectorAll('.js-add-to-cart');
    addToCartButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();

            const productId = this.dataset.productId;
            const productName = this.dataset.productName || 'Product';
            const quantityInputId = this.dataset.quantityInput;

            let quantity = 1;
            if (quantityInputId) {
                const quantityInput = document.getElementById(quantityInputId);
                if (quantityInput) {
                    quantity = parseInt(quantityInput.value, 10) || 1;
                }
            }

            addToCart(productId, productName, quantity, true);
        });
    });

    // Contact form submission (placeholder)
    const contactForm = document.querySelector('.contact-form form');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            // Placeholder for form submission
            alert('Thank you for your message! We will get back to you soon.');
            this.reset();
        });
    }

    // Mobile menu toggle (if needed for responsive design)
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (mobileMenuToggle && navMenu) {
        mobileMenuToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
        });
    }

    // Scroll animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe feature cards and product cards for scroll animations
    const animatedElements = document.querySelectorAll('.feature-card, .product-card, .farmer-card');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
});

// Quantity selector functions for product detail page
function increaseQuantity() {
    const input = document.getElementById('quantity');
    const max = parseInt(input.max);
    if (input.value < max) {
        input.value = parseInt(input.value) + 1;
    }
}

function decreaseQuantity() {
    const input = document.getElementById('quantity');
    if (input.value > 1) {
        input.value = parseInt(input.value) - 1;
    }
}

// Search functionality (placeholder)
function searchProducts() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            // Placeholder for search functionality
            console.log('Searching for:', searchTerm);
        });
    }
}

// Filter functionality
function filterProducts(category) {
    // Placeholder for filtering functionality
    console.log('Filtering by category:', category);
}

// Newsletter subscription (placeholder)
function subscribeNewsletter() {
    const newsletterForm = document.querySelector('.newsletter-form');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            alert('Thank you for subscribing to our newsletter!');
            this.reset();
        });
    }
}

// Image lazy loading
function lazyLoadImages() {
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    images.forEach(img => imageObserver.observe(img));
}

// Initialize lazy loading
lazyLoadImages();

// Price formatting utility
function formatPrice(price) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'PHP'
    }).format(price);
}

// Date formatting utility
function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(new Date(date));
}

// Add to cart helper (server-backed)
function addToCart(productId, productName, quantity = 1, redirectToCart = false) {
    if (!productId) {
        alert('Unable to add item: missing product information.');
        return;
    }

    fetch(`/cart/add/${productId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ quantity: quantity })
    })
        .then(response => {
            if (response.redirected && response.url) {
                window.location.href = response.url;
                return null;
            }
            return response.json();
        })
        .then(data => {
            if (!data) {
                return;
            }
            if (data.success) {
                showToast(`${productName} added to cart`, 'success');
            } else {
                alert(data.message || 'Error adding item to cart.');
            }
        })
        .catch(() => {
            showToast('Unable to add item to cart. Please try again.', 'error');
        });
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✓' : '!'}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" aria-label="Close">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));

    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 250);
    }, 3000);
}

// Local storage utilities for cart (placeholder)
const cart = {
    items: [],
    
    addItem: function(product, quantity) {
        const existingItem = this.items.find(item => item.id === product.id);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.items.push({
                id: product.id,
                name: product.name,
                price: product.price,
                quantity: quantity,
                farmer: product.farmer.name
            });
        }
        this.saveCart();
        this.updateCartUI();
    },
    
    removeItem: function(productId) {
        this.items = this.items.filter(item => item.id !== productId);
        this.saveCart();
        this.updateCartUI();
    },
    
    getTotalItems: function() {
        return this.items.reduce((total, item) => total + item.quantity, 0);
    },
    
    getTotalPrice: function() {
        return this.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    },
    
    saveCart: function() {
        localStorage.setItem('farmtoclick-cart', JSON.stringify(this.items));
    },
    
    loadCart: function() {
        const savedCart = localStorage.getItem('farmtoclick-cart');
        if (savedCart) {
            this.items = JSON.parse(savedCart);
        }
    },
    
    updateCartUI: function() {
        // Placeholder for updating cart UI
        console.log('Cart updated:', this.items);
        console.log('Total items:', this.getTotalItems());
        console.log('Total price:', formatPrice(this.getTotalPrice()));
    }
};

// Load cart on page load
cart.loadCart();

// Export functions for use in HTML
window.cart = cart;
window.formatPrice = formatPrice;
window.formatDate = formatDate;
window.addToCart = addToCart;
