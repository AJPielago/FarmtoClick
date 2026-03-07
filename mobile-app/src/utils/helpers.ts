import { API_BASE_URL } from '../services/api';

/**
 * Resolve a product image URL to a fully-qualified URI.
 * Handles Cloudinary URLs, relative paths, and fallbacks.
 */
export const resolveProductImage = (image_url?: string, image?: string): string => {
  if (image_url) return image_url.startsWith('http') ? image_url : `${API_BASE_URL}${image_url}`;
  if (image) return `${API_BASE_URL}/static/uploads/products/${image}`;
  return 'https://via.placeholder.com/400';
};

/**
 * Format an order/product status string for display.
 * e.g. "ready_for_ship" → "Ready For Ship"
 */
export const formatStatus = (status?: string): string => {
  return (status || 'pending')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Format a date string for readable display.
 */
export const formatDate = (dateStr?: string): string => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Format a short order/document ID (first 6 chars).
 */
export const formatShortId = (value?: string): string => {
  if (!value) return '';
  return value.slice(0, 6);
};

/**
 * Format currency amount in Philippine Peso.
 */
export const formatCurrency = (amount: number): string => {
  return `₱${amount.toFixed(2)}`;
};

/**
 * Get a time-appropriate greeting based on current hour.
 */
export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};
