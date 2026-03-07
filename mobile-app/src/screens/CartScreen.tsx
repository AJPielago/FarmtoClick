import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { cartAPI, API_BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { CartItem, RootStackParamList } from '../types';

type CartScreenNavigationProp = StackNavigationProp<RootStackParamList>;

const CartScreen: React.FC = () => {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<string>('');
  const [selectedAddress, setSelectedAddress] = useState<'primary' | 'secondary'>('primary');
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const { user } = useAuth();
  const { refreshCartCount } = useCart();
  const navigation = useNavigation<CartScreenNavigationProp>();

  const loadCart = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    try {
      const response = await cartAPI.getCart();
      setCartItems(response.data?.items || []);
    } catch (error) {
      if (__DEV__) console.error('Error loading cart:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadCart();
    }, [loadCart])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadCart();
  };

  const updateQuantity = async (productId: string, newQuantity: number) => {
    if (newQuantity < 1) return;
    setIsUpdating(true);
    try {
      await cartAPI.updateQuantity(productId, newQuantity);
      setCartItems(prev =>
        prev.map(item =>
          item.product?.id === productId
            ? { ...item, quantity: newQuantity }
            : item
        )
      );
      refreshCartCount();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to update quantity');
    } finally {
      setIsUpdating(false);
    }
  };

  const removeItem = async (productId: string) => {
    Alert.alert(
      'Remove Item',
      'Are you sure you want to remove this item from your cart?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsUpdating(true);
            try {
              await cartAPI.removeItem(productId);
              setCartItems(prev => prev.filter(item => item.product?.id !== productId));
              refreshCartCount();
            } catch (error) {
              Alert.alert('Error', 'Failed to remove item');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleCheckout = async () => {
    if (!selectedPayment) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }
    if (!user?.shipping_address && !user?.shipping_address_2) {
      Alert.alert(
        'Missing Address',
        'Please add your shipping address in your profile before checking out.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Go to Profile',
            onPress: () => navigation.navigate('EditProfile'),
          },
        ]
      );
      return;
    }
    const useAddress = selectedAddress === 'secondary' ? user.shipping_address_2 : user.shipping_address;
    if (!useAddress) {
      Alert.alert('Error', 'Please select a valid shipping address');
      return;
    }

    setIsCheckingOut(true);
    try {
      await cartAPI.checkout({
        shipping_name: `${user.first_name} ${user.last_name}`,
        shipping_phone: user.phone,
        shipping_address: useAddress,
        payment_method: selectedPayment,
      });
      Alert.alert('Success', 'Order placed successfully!', [
        {
          text: 'View Orders',
          onPress: () => navigation.navigate('Orders'),
        },
      ]);
      setCartItems([]);
      setSelectedPayment('');
      refreshCartCount();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Checkout failed');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const subtotal = cartItems.reduce(
    (sum, item) => sum + (item.product?.price || 0) * (item.quantity || 0),
    0
  );

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="lock-closed-outline" size={80} color="#ccc" />
        <Text style={styles.emptyTitle}>Please Login</Text>
        <Text style={styles.emptyText}>You need to be logged in to view your cart</Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.loginButtonText}>Login Now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading cart...</Text>
      </View>
    );
  }

  if (cartItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="cart-outline" size={80} color="#ccc" />
        <Text style={styles.emptyTitle}>Your Cart is Empty</Text>
        <Text style={styles.emptyText}>Add some fresh products to get started!</Text>
        <TouchableOpacity
          style={styles.shopButton}
          onPress={() => navigation.navigate('MainTabs')}
        >
          <Text style={styles.shopButtonText}>Browse Products</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />
        }
      >
        {/* Cart Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Shopping Cart</Text>
          <Text style={styles.headerSubtitle}>{cartItems.length} items</Text>
        </View>

        {/* Cart Items */}
        {cartItems.map((item) => (
          <View key={item.product?.id} style={styles.cartItem}>
            <CachedImage
              source={{
                uri: item.product?.image_url
                  ? (item.product!.image_url!.startsWith('http') ? item.product!.image_url! : `${API_BASE_URL}${item.product!.image_url!}`)
                  : item.product?.image
                  ? `${API_BASE_URL}/static/uploads/products/${item.product?.image}`
                  : 'https://via.placeholder.com/80',
              }}
              style={styles.productImage}
            />
            <View style={styles.productInfo}>
              <Text style={styles.productName} numberOfLines={2}>
                {item.product?.name}
              </Text>
              <Text style={styles.productPrice}>
                ₱{(item.product?.price || 0).toFixed(2)}/{item.product?.unit}
              </Text>
              <View style={styles.quantityContainer}>
                <TouchableOpacity
                  style={styles.quantityButton}
                  onPress={() => updateQuantity(item.product?.id, item.quantity - 1)}
                  disabled={isUpdating || item.quantity <= 1}
                >
                  <Ionicons name="remove" size={18} color="#4CAF50" />
                </TouchableOpacity>
                <Text style={styles.quantityText}>{item.quantity}</Text>
                <TouchableOpacity
                  style={styles.quantityButton}
                  onPress={() => updateQuantity(item.product?.id, item.quantity + 1)}
                  disabled={isUpdating}
                >
                  <Ionicons name="add" size={18} color="#4CAF50" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.itemRight}>
              <Text style={styles.itemTotal}>
                ₱{((item.product?.price || 0) * item.quantity).toFixed(2)}
              </Text>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => removeItem(item.product?.id)}
              >
                <Ionicons name="trash-outline" size={20} color="#dc3545" />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Payment Method Selection */}
        <View style={styles.paymentSection}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          {['Cash on Delivery', 'GCash', 'PayMaya'].map((method) => (
            <TouchableOpacity
              key={method}
              style={[
                styles.paymentOption,
                selectedPayment === method && styles.paymentOptionSelected,
              ]}
              onPress={() => setSelectedPayment(method)}
            >
              <View style={styles.radioCircle}>
                {selectedPayment === method && <View style={styles.radioSelected} />}
              </View>
              <Text style={styles.paymentText}>{method}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Shipping Address */}
        <View style={styles.addressSection}>
          <Text style={styles.sectionTitle}>Shipping Address</Text>
          {user?.shipping_address && user?.shipping_address_2 ? (
            <View>
              <TouchableOpacity
                style={[
                  styles.addressOption,
                  selectedAddress === 'primary' && styles.addressOptionSelected,
                ]}
                onPress={() => setSelectedAddress('primary')}
              >
                <View style={styles.radioCircle}>
                  {selectedAddress === 'primary' && <View style={styles.radioSelected} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addressLabel}>Primary Address</Text>
                  <Text style={styles.addressText}>{user.shipping_address}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addressOption,
                  selectedAddress === 'secondary' && styles.addressOptionSelected,
                ]}
                onPress={() => setSelectedAddress('secondary')}
              >
                <View style={styles.radioCircle}>
                  {selectedAddress === 'secondary' && <View style={styles.radioSelected} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addressLabel}>Secondary Address</Text>
                  <Text style={styles.addressText}>{user.shipping_address_2}</Text>
                </View>
              </TouchableOpacity>
            </View>
          ) : (user?.shipping_address || user?.shipping_address_2) ? (
            <View style={styles.addressCard}>
              <Ionicons name="location-outline" size={20} color="#4CAF50" />
              <Text style={styles.addressText}>{user?.shipping_address || user?.shipping_address_2}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addAddressButton}
              onPress={() => navigation.navigate('EditProfile')}
            >
              <Ionicons name="add-circle-outline" size={20} color="#4CAF50" />
              <Text style={styles.addAddressText}>Add shipping address</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Bottom Summary */}
      <View style={styles.summaryContainer}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>₱{subtotal.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Delivery Fee</Text>
          <Text style={styles.summaryValue}>Calculated at delivery</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>₱{subtotal.toFixed(2)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.checkoutButton, isCheckingOut && styles.checkoutButtonDisabled]}
          onPress={handleCheckout}
          disabled={isCheckingOut || isUpdating}
        >
          {isCheckingOut ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="card-outline" size={20} color="#fff" />
              <Text style={styles.checkoutButtonText}>Place Order</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
  loginButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  shopButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  shopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 20,
    paddingTop: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#E8F5E9',
    marginTop: 5,
  },
  cartItem: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginTop: 15,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  productPrice: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '500',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityText: {
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 15,
    color: '#333',
  },
  itemRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  removeButton: {
    padding: 8,
  },
  paymentSection: {
    backgroundColor: '#fff',
    margin: 15,
    borderRadius: 12,
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f9f9f9',
  },
  paymentOptionSelected: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
    borderWidth: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#4CAF50',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  paymentText: {
    fontSize: 16,
    color: '#333',
  },
  addressSection: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 12,
    padding: 15,
  },
  addressCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
  },
  addressText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  addAddressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
  },
  addAddressText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#4CAF50',
  },
  addressOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  addressOptionSelected: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  addressLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4CAF50',
    marginBottom: 2,
  },
  summaryContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  summaryValue: {
    fontSize: 14,
    color: '#333',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
    marginTop: 5,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  checkoutButton: {
    flexDirection: 'row',
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
  },
  checkoutButtonDisabled: {
    opacity: 0.6,
  },
  checkoutButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
});

export default CartScreen;