import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { productsAPI, dtiAPI, API_BASE_URL } from '../services/api';
import { Product } from '../types';

const CATEGORIES = [
  'Vegetables',
  'Fruits',
  'Grains & Cereals',
  'Dairy & Eggs',
  'Meat & Poultry',
  'Herbs & Spices',
  'Nuts & Seeds',
  'Honey & Jams',
  'Oils & Condiments',
  'Baked Goods',
  'Beverages',
  'Organic Products',
  'Flowers',
];

const UNITS = ['kg', 'g', 'lb', 'lbs', 'piece', 'pack', 'bunch', 'bundle', 'box', 'tray', 'liter', 'ml'];

interface ProductFormData {
  name: string;
  category: string;
  price: string;
  quantity: string;
  unit: string;
  description: string;
  available: boolean;
  audience: string[];
  images: any[];  // new image picker assets
}

const initialFormData: ProductFormData = {
  name: '',
  category: '',
  price: '',
  quantity: '',
  unit: 'kg',
  description: '',
  available: true,
  audience: ['customers'],
  images: [],
};

const ManageProductsScreen: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  // Multi-image: separate new picks from existing remote URLs
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);

  const MAX_IMAGES = 5;

  // Price suggestion
  const [priceSuggestion, setPriceSuggestion] = useState<any>(null);
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);

  const { user } = useAuth();
  const navigation = useNavigation();

  const loadProducts = useCallback(async () => {
    if (!user?.is_farmer) {
      setIsLoading(false);
      return;
    }
    try {
      const response = await productsAPI.getProducts();
      const prods = response.data?.products || [];
      setProducts(prods);
      setFilteredProducts(prods);
    } catch (error) {
      if (__DEV__) console.error('Error loading products:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts])
  );

  // Filter products
  React.useEffect(() => {
    let filtered = products;
    if (searchQuery.trim()) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (filterCategory) {
      filtered = filtered.filter((p) => p.category === filterCategory);
    }
    setFilteredProducts(filtered);
  }, [products, searchQuery, filterCategory]);

  const onRefresh = () => {
    setRefreshing(true);
    loadProducts();
  };

  const fetchPriceSuggestion = async () => {
    if (!formData.name || formData.name.length < 2) {
      Alert.alert('Error', 'Please enter a product name first');
      return;
    }
    setIsFetchingPrice(true);
    try {
      // Match web frontend behaviour: only request 'co-vendors' markup when co-vendors is checked
      // and customers is NOT checked. Otherwise request default (empty) which backend treats as customers.
      const hasCoVendors = Array.isArray(formData.audience) && formData.audience.includes('co-vendors');
      const hasCustomers = Array.isArray(formData.audience) && formData.audience.includes('customers');
      const audienceParam = hasCoVendors && !hasCustomers ? 'co-vendors' : '';
      const res = await dtiAPI.suggestPrice(formData.name, formData.unit, formData.category, audienceParam);
      const data = res.data;
      setPriceSuggestion(data);
      if (data?.found && data.auto_price) {
        setFormData((prev) => ({ ...prev, price: data.auto_price.toFixed(2) }));
      }
    } catch (error) {
      setPriceSuggestion({ found: false, message: 'Failed to fetch DTI price' });
    } finally {
      setIsFetchingPrice(false);
    }
  };

  // Pick multiple images at once from gallery
  const pickImage = async () => {
    const total = imagePreviews.length;
    if (total >= MAX_IMAGES) {
      Alert.alert('Limit Reached', `You can upload up to ${MAX_IMAGES} images.`);
      return;
    }
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please grant camera roll permissions');
      return;
    }

    const remaining = MAX_IMAGES - total;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,   // v17 API (lowercase array)
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      const newAssets = result.assets.slice(0, remaining);
      setFormData((prev) => ({ ...prev, images: [...prev.images, ...newAssets] }));
      setImagePreviews((prev) => [...prev, ...newAssets.map((a) => a.uri)]);
    }
  };

  // Pick a single image (fallback for devices that don't support multi-select)
  const pickSingleImage = async () => {
    const total = imagePreviews.length;
    if (total >= MAX_IMAGES) {
      Alert.alert('Limit Reached', `You can upload up to ${MAX_IMAGES} images.`);
      return;
    }
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please grant camera roll permissions');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]) {
      setFormData((prev) => ({ ...prev, images: [...prev.images, result.assets[0]] }));
      setImagePreviews((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const takePhoto = async () => {
    const total = imagePreviews.length;
    if (total >= MAX_IMAGES) {
      Alert.alert('Limit Reached', `You can upload up to ${MAX_IMAGES} images.`);
      return;
    }
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please grant camera permissions');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setFormData((prev) => ({ ...prev, images: [...prev.images, result.assets[0]] }));
      setImagePreviews((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const removeImage = (index: number) => {
    const uri = imagePreviews[index];
    // Check if it's an existing remote URL or a new pick
    if (existingImageUrls.includes(uri)) {
      setExistingImageUrls((prev) => prev.filter((u) => u !== uri));
    } else {
      // Remove from new picks
      const newPickIndex = formData.images.findIndex((a: any) => a.uri === uri);
      if (newPickIndex >= 0) {
        setFormData((prev) => ({
          ...prev,
          images: prev.images.filter((_: any, i: number) => i !== newPickIndex),
        }));
      }
    }
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const openAddModal = () => {
    setFormData(initialFormData);
    setImagePreviews([]);
    setExistingImageUrls([]);
    setPriceSuggestion(null);
    setShowAddModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    // Build existing image URLs from product
    const existingUrls: string[] = [];
    if ((product as any).image_urls?.length) {
      existingUrls.push(...(product as any).image_urls);
    } else if (product.image_url) {
      existingUrls.push(
        product.image_url.startsWith('http') ? product.image_url : `${API_BASE_URL}${product.image_url}`
      );
    } else if (product.image) {
      existingUrls.push(`${API_BASE_URL}/static/uploads/products/${product.image}`);
    }
    setFormData({
      name: product.name,
      category: product.category,
      price: product.price.toString(),
      quantity: product.quantity.toString(),
      unit: product.unit,
      description: product.description || '',
      available: product.available !== false,
      audience: Array.isArray(product.audience)
        ? product.audience
        : product.audience
        ? [product.audience]
        : ['customers'],
      images: [],
    });
    setExistingImageUrls(existingUrls);
    setImagePreviews(existingUrls);
    setPriceSuggestion(null);
    setShowEditModal(true);
  };

  const closeModals = () => {
    setShowAddModal(false);
    setShowEditModal(false);
    setEditingProduct(null);
    setFormData(initialFormData);
    setImagePreviews([]);
    setExistingImageUrls([]);
    setPriceSuggestion(null);
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Product name is required');
      return false;
    }
    if (!formData.category) {
      Alert.alert('Error', 'Please select a category');
      return false;
    }
    if (!formData.price || parseFloat(formData.price) <= 0) {
      Alert.alert('Error', 'Please enter a valid price');
      return false;
    }
    if (!formData.quantity || parseInt(formData.quantity) < 0) {
      Alert.alert('Error', 'Please enter a valid quantity');
      return false;
    }
    return true;
  };

  const handleAddProduct = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const formDataToSend = new FormData();
      formDataToSend.append('name', formData.name);
      formDataToSend.append('category', formData.category);
      formDataToSend.append('price', formData.price);
      formDataToSend.append('quantity', formData.quantity);
      formDataToSend.append('unit', formData.unit);
      formDataToSend.append('description', formData.description);
      formDataToSend.append('available', formData.available ? '1' : '0');
      // audience may be multiple values (checkboxes)
      if (Array.isArray(formData.audience) && formData.audience.length) {
        formData.audience.forEach((a) => formDataToSend.append('audience', a));
      } else {
        formDataToSend.append('audience', 'customers');
      }

      if (formData.images.length > 0) {
        formData.images.forEach((asset: any) => {
          const uri = asset.uri;
          const filename = uri.split('/').pop() || 'photo.jpg';
          const match = /\.(\w+)$/.exec(filename);
          const type = match ? `image/${match[1]}` : 'image/jpeg';
          formDataToSend.append('images', {
            uri,
            name: filename,
            type,
          } as any);
        });
      }

      await productsAPI.addProduct(formDataToSend);
      Alert.alert('Success', 'Product added successfully!');
      closeModals();
      loadProducts();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to add product');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateProduct = async () => {
    if (!validateForm() || !editingProduct) return;

    setIsSaving(true);
    try {
      const formDataToSend = new FormData();
      formDataToSend.append('name', formData.name);
      formDataToSend.append('category', formData.category);
      formDataToSend.append('price', formData.price);
      formDataToSend.append('quantity', formData.quantity);
      formDataToSend.append('unit', formData.unit);
      formDataToSend.append('description', formData.description);
      formDataToSend.append('available', formData.available ? '1' : '0');
      // audience may be multiple values (checkboxes)
      if (Array.isArray(formData.audience) && formData.audience.length) {
        formData.audience.forEach((a) => formDataToSend.append('audience', a));
      } else {
        formDataToSend.append('audience', 'customers');
      }

      // Send existing (kept) URLs so backend can merge
      if (existingImageUrls.length > 0) {
        formDataToSend.append('existing_image_urls', existingImageUrls.join(','));
      }

      if (formData.images.length > 0) {
        formData.images.forEach((asset: any) => {
          const uri = asset.uri;
          const filename = uri.split('/').pop() || 'photo.jpg';
          const match = /\.(\w+)$/.exec(filename);
          const type = match ? `image/${match[1]}` : 'image/jpeg';
          formDataToSend.append('images', {
            uri,
            name: filename,
            type,
          } as any);
        });
      }

      await productsAPI.updateProduct(editingProduct.id, formDataToSend);
      Alert.alert('Success', 'Product updated successfully!');
      closeModals();
      loadProducts();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.message || 'Failed to update product');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProduct = (product: Product) => {
    Alert.alert('Delete Product', `Are you sure you want to delete "${product.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await productsAPI.deleteProduct(product.id);
            Alert.alert('Success', 'Product deleted successfully');
            loadProducts();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete product');
          }
        },
      },
    ]);
  };

  const renderProductItem = ({ item }: { item: Product }) => (
    <View style={styles.productCard}>
      <Image
        source={{
          uri: item.image_url
            ? (item.image_url.startsWith('http') ? item.image_url : `${API_BASE_URL}${item.image_url}`)
            : item.image
            ? `${API_BASE_URL}/static/uploads/products/${item.image}`
            : 'https://via.placeholder.com/80',
        }}
        style={styles.productImage}
      />
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.productCategory}>{item.category}</Text>
        <View style={styles.productMeta}>
          <Text style={styles.productPrice}>₱{item.price}</Text>
          <Text style={styles.productStock}>
            {item.quantity} {item.unit}
          </Text>
        </View>
        <View
          style={[
            styles.availabilityBadge,
            { backgroundColor: item.available !== false ? '#E8F5E9' : '#FFEBEE' },
          ]}
        >
          <Text
            style={[
              styles.availabilityText,
              { color: item.available !== false ? '#2E7D32' : '#C62828' },
            ]}
          >
            {item.available !== false ? 'Available' : 'Unavailable'}
          </Text>
        </View>
      </View>
      <View style={styles.productActions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => openEditModal(item)}
        >
          <Ionicons name="pencil" size={18} color="#4CAF50" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteProduct(item)}
        >
          <Ionicons name="trash" size={18} color="#dc3545" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderProductForm = (isEdit: boolean) => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView style={styles.formScrollView} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
        {/* Image Selection */}
        <View style={styles.imageSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollRow}>
            {imagePreviews.map((uri, index) => (
              <View key={`${uri}-${index}`} style={styles.imageThumbnailWrapper}>
                <Image source={{ uri }} style={styles.imageThumbnail} />
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeImage(index)}>
                  <Ionicons name="close-circle" size={22} color="#FF5252" />
                </TouchableOpacity>
              </View>
            ))}
            {imagePreviews.length < MAX_IMAGES && (
              <TouchableOpacity style={styles.addImageBtn} onPress={pickSingleImage}>
                <Ionicons name="add" size={32} color="#4CAF50" />
                <Text style={styles.addImageText}>Add</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <Text style={styles.imageCountText}>{imagePreviews.length}/{MAX_IMAGES} images</Text>
          <View style={styles.imageButtons}>
            <TouchableOpacity style={styles.imageButton} onPress={pickImage}>
              <Ionicons name="images" size={20} color="#4CAF50" />
              <Text style={styles.imageButtonText}>Select Multiple</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageButton} onPress={pickSingleImage}>
              <Ionicons name="image" size={20} color="#4CAF50" />
              <Text style={styles.imageButtonText}>Pick One</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageButton} onPress={takePhoto}>
              <Ionicons name="camera" size={20} color="#4CAF50" />
              <Text style={styles.imageButtonText}>Camera</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Product Name */}
        <View style={styles.formGroup}>
          <Text style={styles.formLabel}>Product Name *</Text>
          <TextInput
            style={styles.formInput}
            value={formData.name}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, name: value }))}
            placeholder="Enter product name"
          />
        </View>

        {/* Category */}
        <View style={styles.formGroup}>
          <Text style={styles.formLabel}>Category *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.categoryChips}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryChip,
                    formData.category === cat && styles.categoryChipSelected,
                  ]}
                  onPress={() => setFormData((prev) => ({ ...prev, category: cat }))}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      formData.category === cat && styles.categoryChipTextSelected,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Price with DTI Suggestion */}
        <View style={styles.formGroup}>
          <View style={styles.priceHeader}>
            <Text style={styles.formLabel}>Price (₱) *</Text>
            <TouchableOpacity
              style={styles.suggestPriceBtn}
              onPress={fetchPriceSuggestion}
              disabled={isFetchingPrice}
            >
              {isFetchingPrice ? (
                <ActivityIndicator size="small" color="#4CAF50" />
              ) : (
                <>
                  <Ionicons name="pricetag" size={14} color="#4CAF50" />
                  <Text style={styles.suggestPriceText}>Suggest Price</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.formInput}
            value={formData.price}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, price: value }))}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          {priceSuggestion && (
            <View
              style={[
                styles.priceSuggestionBox,
                { backgroundColor: priceSuggestion.found ? '#E8F5E9' : '#FFF3E0' },
              ]}
            >
              <Text style={styles.priceSuggestionText}>
                {priceSuggestion.found
                  ? `DTI SRP: ₱${priceSuggestion.srp_price?.toFixed(2)} (Auto: ₱${priceSuggestion.auto_price?.toFixed(2)})`
                  : priceSuggestion.message}
              </Text>
            </View>
          )}
        </View>

        {/* Quantity and Unit */}
        <View style={styles.rowGroup}>
          <View style={[styles.formGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.formLabel}>Quantity *</Text>
            <TextInput
              style={styles.formInput}
              value={formData.quantity}
              onChangeText={(value) => setFormData((prev) => ({ ...prev, quantity: value }))}
              placeholder="0"
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={styles.formLabel}>Unit *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.unitChips}>
                {UNITS.map((unit) => (
                  <TouchableOpacity
                    key={unit}
                    style={[
                      styles.unitChip,
                      formData.unit === unit && styles.unitChipSelected,
                    ]}
                    onPress={() => setFormData((prev) => ({ ...prev, unit }))}
                  >
                    <Text
                      style={[
                        styles.unitChipText,
                        formData.unit === unit && styles.unitChipTextSelected,
                      ]}
                    >
                      {unit}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>

        {/* Description */}
        <View style={styles.formGroup}>
          <Text style={styles.formLabel}>Description</Text>
          <TextInput
            style={[styles.formInput, styles.textArea]}
            value={formData.description}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, description: value }))}
            placeholder="Describe your product..."
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Audience / Sell To */}
        <View style={styles.formGroup}>
          <Text style={styles.formLabel}>Sell To</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { key: 'customers', label: 'Customers' },
              { key: 'co-vendors', label: 'Co-vendors' },
            ].map((opt) => {
              const selected = Array.isArray(formData.audience) && formData.audience.includes(opt.key);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.audienceChip,
                    selected && styles.audienceChipSelected,
                  ]}
                  onPress={() => {
                    const current = Array.isArray(formData.audience) ? [...formData.audience] : [];
                    const exists = current.includes(opt.key);
                    let next = exists ? current.filter((a) => a !== opt.key) : [...current, opt.key];
                    if (!next.length) next = ['customers'];
                    setFormData((prev) => ({ ...prev, audience: next }));
                  }}
                >
                  <Text style={[styles.audienceChipText, selected && styles.audienceChipTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Availability */}
        <View style={styles.switchGroup}>
          <Text style={styles.formLabel}>Available for Sale</Text>
          <Switch
            value={formData.available}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, available: value }))}
            trackColor={{ false: '#ddd', true: '#A5D6A7' }}
            thumbColor={formData.available ? '#4CAF50' : '#f4f3f4'}
          />
        </View>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.cancelButton} onPress={closeModals}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={isEdit ? handleUpdateProduct : handleAddProduct}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveButtonText}>{isEdit ? 'Update' : 'Add Product'}</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (!user?.is_farmer) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="storefront-outline" size={80} color="#ccc" />
        <Text style={styles.emptyTitle}>Not a Seller</Text>
        <Text style={styles.emptyText}>
          You need to be a seller to manage products
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading products...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Products</Text>
        <Text style={styles.headerSubtitle}>{products.length} products</Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#666" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Products List */}
      <FlatList
        data={filteredProducts}
        renderItem={renderProductItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        refreshing={refreshing}
        onRefresh={onRefresh}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Ionicons name="cube-outline" size={60} color="#ccc" />
            <Text style={styles.emptyListTitle}>No Products</Text>
            <Text style={styles.emptyListText}>
              Add your first product to start selling!
            </Text>
          </View>
        }
      />

      {/* Add Button */}
      <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      {/* Add Product Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModals}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add New Product</Text>
            <TouchableOpacity onPress={closeModals}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          {renderProductForm(false)}
        </View>
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModals}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Product</Text>
            <TouchableOpacity onPress={closeModals}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>
          {renderProductForm(true)}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 15,
    paddingHorizontal: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    paddingVertical: 12,
    fontSize: 16,
  },
  listContainer: {
    padding: 15,
    paddingTop: 0,
    paddingBottom: 100,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
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
  productCategory: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginRight: 10,
  },
  productStock: {
    fontSize: 12,
    color: '#666',
  },
  availabilityBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 5,
  },
  availabilityText: {
    fontSize: 11,
    fontWeight: '600',
  },
  productActions: {
    justifyContent: 'center',
    gap: 10,
  },
  editButton: {
    padding: 8,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
  },
  deleteButton: {
    padding: 8,
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
  },
  emptyList: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyListTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  emptyListText: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
  addButton: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  formScrollView: {
    flex: 1,
    padding: 15,
  },
  imageSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  imageScrollRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  imageThumbnailWrapper: {
    position: 'relative',
    marginRight: 10,
  },
  imageThumbnail: {
    width: 100,
    height: 100,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  removeImageBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#fff',
    borderRadius: 11,
  },
  addImageBtn: {
    width: 100,
    height: 100,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fff9',
  },
  addImageText: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 2,
  },
  imageCountText: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  imagePreviewContainer: {
    width: 150,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: {
    marginTop: 8,
    color: '#888',
  },
  imageButtons: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 10,
  },
  imageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4CAF50',
    gap: 5,
  },
  imageButtonText: {
    color: '#4CAF50',
    fontSize: 14,
  },
  formGroup: {
    marginBottom: 15,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  categoryChips: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  categoryChipSelected: {
    backgroundColor: '#4CAF50',
  },
  categoryChipText: {
    fontSize: 13,
    color: '#666',
  },
  categoryChipTextSelected: {
    color: '#fff',
  },
  audienceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  audienceChipSelected: {
    backgroundColor: '#4CAF50',
  },
  audienceChipText: {
    fontSize: 13,
    color: '#666',
  },
  audienceChipTextSelected: {
    color: '#fff',
  },
  priceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  suggestPriceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  suggestPriceText: {
    fontSize: 12,
    color: '#4CAF50',
  },
  priceSuggestionBox: {
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  priceSuggestionText: {
    fontSize: 12,
    color: '#333',
  },
  rowGroup: {
    flexDirection: 'row',
  },
  unitChips: {
    flexDirection: 'row',
    gap: 6,
  },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
  },
  unitChipSelected: {
    backgroundColor: '#4CAF50',
  },
  unitChipText: {
    fontSize: 12,
    color: '#666',
  },
  unitChipTextSelected: {
    color: '#fff',
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    padding: 15,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ManageProductsScreen;
