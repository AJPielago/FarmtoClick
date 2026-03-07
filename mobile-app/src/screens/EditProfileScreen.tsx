import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { userAPI, API_BASE_URL } from '../services/api';

const EditProfileScreen: React.FC = () => {
  const { user, updateProfile } = useAuth();
  const navigation = useNavigation();

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    overall_location: '',
    shipping_address: '',
    overall_location_2: '',
    shipping_address_2: '',
    farm_name: '',
    farm_phone: '',
    farm_location: '',
    farm_description: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [profileImage, setProfileImage] = useState<{ uri: string } | null>(null);
  const [removeProfilePicture, setRemoveProfilePicture] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        overall_location: user.overall_location || '',
        shipping_address: user.shipping_address || '',
        overall_location_2: user.overall_location_2 || '',
        shipping_address_2: user.shipping_address_2 || '',
        farm_name: user.farm_name || '',
        farm_phone: user.farm_phone || '',
        farm_location: user.farm_location || '',
        farm_description: user.farm_description || '',
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
      // reset image states
      setProfileImage(null);
      setRemoveProfilePicture(false);
    }
  }, [user]);

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please grant photo library permissions');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      setProfileImage({ uri: result.assets[0].uri });
      setRemoveProfilePicture(false);
    }
  };

  const takePhoto = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please grant camera permissions');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      setProfileImage({ uri: result.assets[0].uri });
      setRemoveProfilePicture(false);
    }
  };

  const handleRemoveProfilePicture = () => {
    setProfileImage(null);
    setRemoveProfilePicture(true);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getLocationFromGPS = async () => {
    setIsGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable location services to use this feature.');
        setIsGettingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;

      // Reverse geocode
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
        {
          headers: { 'User-Agent': 'FarmToClick-Mobile/1.0' },
        }
      );
      const data = await response.json();

      if (data && data.display_name) {
        setFormData((prev) => ({
          ...prev,
          overall_location: data.display_name,
        }));
        Alert.alert('Success', 'Location set successfully!');
      } else {
        setFormData((prev) => ({
          ...prev,
          overall_location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        }));
      }
    } catch (error) {
      if (__DEV__) console.error('Error getting location:', error);
      Alert.alert('Error', 'Unable to get your location. Please enter it manually.');
    } finally {
      setIsGettingLocation(false);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      Alert.alert('Error', 'First name and last name are required');
      return;
    }

    // Password validation
    if (formData.new_password || formData.confirm_password) {
      if (!formData.current_password) {
        Alert.alert('Error', 'Please enter your current password to change password');
        return;
      }
      if (formData.new_password !== formData.confirm_password) {
        Alert.alert('Error', 'New passwords do not match');
        return;
      }
      if (formData.new_password.length < 6) {
        Alert.alert('Error', 'Password must be at least 6 characters long');
        return;
      }
    }

    setIsSaving(true);
    try {
      // If user changed profile image or requested removal, send FormData
      const hasImageChange = profileImage !== null || removeProfilePicture;

      if (hasImageChange) {
        const formDataToSend = new FormData();

        formDataToSend.append('first_name', formData.first_name);
        formDataToSend.append('last_name', formData.last_name);
        formDataToSend.append('phone', formData.phone);
        formDataToSend.append('overall_location', formData.overall_location);
        formDataToSend.append('shipping_address', formData.shipping_address);
        formDataToSend.append('overall_location_2', formData.overall_location_2);
        formDataToSend.append('shipping_address_2', formData.shipping_address_2);

        if (user?.is_farmer) {
          formDataToSend.append('farm_name', formData.farm_name);
          formDataToSend.append('farm_phone', formData.farm_phone);
          formDataToSend.append('farm_location', formData.farm_location);
          formDataToSend.append('farm_description', formData.farm_description);
        }

        if (formData.current_password && formData.new_password) {
          formDataToSend.append('current_password', formData.current_password);
          formDataToSend.append('new_password', formData.new_password);
        }

        if (profileImage) {
          const uri = profileImage.uri;
          const filename = uri.split('/').pop() || 'photo.jpg';
          const match = /\.(\w+)$/.exec(filename);
          const type = match ? `image/${match[1]}` : 'image/jpeg';
          // @ts-ignore
          formDataToSend.append('profile_picture', { uri, name: filename, type });
        } else if (removeProfilePicture) {
          formDataToSend.append('remove_profile_picture', '1');
        }

        const success = await updateProfile(formDataToSend as any);

        if (success) {
          Alert.alert('Success', 'Profile updated successfully!');
          setFormData((prev) => ({
            ...prev,
            current_password: '',
            new_password: '',
            confirm_password: '',
          }));
          navigation.goBack();
        } else {
          Alert.alert('Error', 'Failed to update profile. Please try again.');
        }

        setIsSaving(false);
        return;
      }

      const updateData: any = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone,
        overall_location: formData.overall_location,
        shipping_address: formData.shipping_address,
        overall_location_2: formData.overall_location_2,
        shipping_address_2: formData.shipping_address_2,
      };

      if (user?.is_farmer) {
        updateData.farm_name = formData.farm_name;
        updateData.farm_phone = formData.farm_phone;
        updateData.farm_location = formData.farm_location;
        updateData.farm_description = formData.farm_description;
      }

      if (formData.current_password && formData.new_password) {
        updateData.current_password = formData.current_password;
        updateData.new_password = formData.new_password;
      }

      const success = await updateProfile(updateData);

      if (success) {
        Alert.alert('Success', 'Profile updated successfully!');
        setFormData((prev) => ({
          ...prev,
          current_password: '',
          new_password: '',
          confirm_password: '',
        }));
        navigation.goBack();
      } else {
        Alert.alert('Error', 'Failed to update profile. Please try again.');
      }
    } catch (error) {
      if (__DEV__) console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Please login to edit your profile</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag">
        {/* Profile Picture Section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            {profileImage ? (
              <Image source={{ uri: profileImage.uri }} style={styles.avatarImage} />
            ) : user.profile_picture ? (
              <Image
                source={{ uri: (typeof user.profile_picture === 'string' && user.profile_picture.startsWith('http')) ? user.profile_picture : `${API_BASE_URL}/static/uploads/profiles/${user.profile_picture}` }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={styles.avatarText}>
                {user.first_name?.[0]}
                {user.last_name?.[0]}
              </Text>
            )}
          </View>
          <Text style={styles.avatarHint}>Profile Picture</Text>

          <View style={styles.avatarButtonsRow}>
            <TouchableOpacity style={styles.avatarButton} onPress={pickImage}>
              <Ionicons name="images" size={18} color="#fff" />
              <Text style={styles.avatarButtonText}>Change Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.avatarButton, styles.avatarButtonAlt]} onPress={takePhoto}>
              <Ionicons name="camera" size={18} color="#4CAF50" />
              <Text style={[styles.avatarButtonText, styles.avatarButtonTextAlt]}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.avatarButton, styles.avatarButtonRemove]} onPress={handleRemoveProfilePicture}>
              <Ionicons name="trash" size={18} color="#fff" />
              <Text style={styles.avatarButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Basic Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Basic Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.first_name}
              onChangeText={(value) => handleChange('first_name', value)}
              placeholder="Enter first name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.last_name}
              onChangeText={(value) => handleChange('last_name', value)}
              placeholder="Enter last name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, styles.inputDisabled]}
              value={formData.email}
              editable={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={formData.phone}
              onChangeText={(value) => handleChange('phone', value)}
              placeholder="Enter phone number"
              keyboardType="phone-pad"
            />
          </View>
        </View>

        {/* Location & Shipping */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location & Shipping</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Overall Location</Text>
            <View style={styles.locationInputContainer}>
              <TextInput
                style={[styles.input, styles.locationInput]}
                value={formData.overall_location}
                onChangeText={(value) => handleChange('overall_location', value)}
                placeholder="Enter your location"
                multiline
              />
              <TouchableOpacity
                style={styles.gpsButton}
                onPress={getLocationFromGPS}
                disabled={isGettingLocation}
              >
                {isGettingLocation ? (
                  <ActivityIndicator size="small" color="#4CAF50" />
                ) : (
                  <Ionicons name="locate" size={22} color="#4CAF50" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Shipping Address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.shipping_address}
              onChangeText={(value) => handleChange('shipping_address', value)}
              placeholder="Enter your full shipping address"
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        {/* Second Shipping Address (Optional) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="add-circle-outline" size={18} color="#4CAF50" /> Second Address (Optional)
          </Text>
          <Text style={styles.sectionHint}>Add an alternative address you can choose during checkout</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Overall Location</Text>
            <TextInput
              style={styles.input}
              value={formData.overall_location_2}
              onChangeText={(value) => handleChange('overall_location_2', value)}
              placeholder="City, Province, Country"
              multiline
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Shipping Address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.shipping_address_2}
              onChangeText={(value) => handleChange('shipping_address_2', value)}
              placeholder="Block, lot, street, or any specific location details"
              multiline
              numberOfLines={3}
            />
          </View>
        </View>

        {/* Farm Information (if farmer) */}
        {user.is_farmer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="leaf" size={18} color="#4CAF50" /> Farm Information
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Farm Name</Text>
              <TextInput
                style={styles.input}
                value={formData.farm_name}
                onChangeText={(value) => handleChange('farm_name', value)}
                placeholder="Enter farm name"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Farm Phone</Text>
              <TextInput
                style={styles.input}
                value={formData.farm_phone}
                onChangeText={(value) => handleChange('farm_phone', value)}
                placeholder="Enter farm phone"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Farm Location</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.farm_location}
                onChangeText={(value) => handleChange('farm_location', value)}
                placeholder="Enter farm location"
                multiline
                numberOfLines={2}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Farm Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.farm_description}
                onChangeText={(value) => handleChange('farm_description', value)}
                placeholder="Describe your farm"
                multiline
                numberOfLines={4}
              />
            </View>
          </View>
        )}

        {/* Change Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="lock-closed" size={18} color="#666" /> Change Password
          </Text>
          <Text style={styles.sectionHint}>Leave blank to keep current password</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Current Password</Text>
            <TextInput
              style={styles.input}
              value={formData.current_password}
              onChangeText={(value) => handleChange('current_password', value)}
              placeholder="Enter current password"
              secureTextEntry
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>New Password</Text>
            <TextInput
              style={styles.input}
              value={formData.new_password}
              onChangeText={(value) => handleChange('new_password', value)}
              placeholder="Enter new password"
              secureTextEntry
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput
              style={styles.input}
              value={formData.confirm_password}
              onChangeText={(value) => handleChange('confirm_password', value)}
              placeholder="Confirm new password"
              secureTextEntry
            />
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 25,
    backgroundColor: '#4CAF50',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  avatarHint: {
    marginTop: 10,
    fontSize: 14,
    color: '#E8F5E9',
  },
  avatarButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  avatarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  avatarButtonAlt: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  avatarButtonRemove: {
    backgroundColor: '#dc3545',
  },
  avatarButtonText: {
    color: '#fff',
    marginLeft: 8,
    fontWeight: '600',
  },
  avatarButtonTextAlt: {
    color: '#4CAF50',
  },
  section: {
    backgroundColor: '#fff',
    margin: 15,
    marginBottom: 0,
    borderRadius: 12,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  sectionHint: {
    fontSize: 12,
    color: '#888',
    marginBottom: 15,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  inputDisabled: {
    backgroundColor: '#f0f0f0',
    color: '#999',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  locationInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  locationInput: {
    flex: 1,
    marginRight: 10,
  },
  gpsButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: '#4CAF50',
    margin: 15,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  bottomPadding: {
    height: 30,
  },
});

export default EditProfileScreen;
