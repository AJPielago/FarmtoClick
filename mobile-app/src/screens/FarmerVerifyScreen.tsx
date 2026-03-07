import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { verificationAPI, userAPI } from '../services/api';
import { RootStackParamList } from '../types';

type FarmerVerifyScreenNavigationProp = StackNavigationProp<RootStackParamList>;

interface VerificationStatus {
  status: string;
  verification?: {
    verification_status: string;
    timestamp?: string;
    rejection_reason?: string;
  };
}

const FarmerVerifyScreen: React.FC = () => {
  const navigation = useNavigation<FarmerVerifyScreenNavigationProp>();
  const { user, refreshUser } = useAuth();

  const [formData, setFormData] = useState({
    farm_phone: user?.farm_phone || '',
    farm_location: user?.farm_location || '',
    exact_address: user?.exact_address || '',
    farm_description: user?.farm_description || '',
    permit_business_name: user?.permit_business_name || '',
    permit_owner_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
  });

  const [farmPhoto, setFarmPhoto] = useState<string | null>(null);
  const [permitPhoto, setPermitPhoto] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    try {
      setIsCheckingStatus(true);
      const response = await verificationAPI.getVerificationStatus();
      setVerificationStatus(response.data);
    } catch (error) {
      if (__DEV__) console.error('Error checking verification status:', error);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const getLocationFromGPS = async () => {
    try {
      setGettingLocation(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please allow location access to use this feature.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;

      // Reverse geocode to get address
      const [address] = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      if (address) {
        const locationString = [
          address.street,
          address.city,
          address.region,
          address.country,
        ]
          .filter(Boolean)
          .join(', ');
        setFormData((prev) => ({ ...prev, farm_location: locationString }));
      } else {
        setFormData((prev) => ({
          ...prev,
          farm_location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        }));
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to get your location. Please enter it manually.');
    } finally {
      setGettingLocation(false);
    }
  };

  const pickImage = async (type: 'farm' | 'permit') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: type === 'permit' ? [4, 3] : [16, 9],
      quality: 0.8,
    };

    Alert.alert(
      'Select Photo',
      'Choose how to add the photo',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Denied', 'Camera access is required.');
              return;
            }
            const result = await ImagePicker.launchCameraAsync(options);
            if (!result.canceled && result.assets[0]) {
              if (type === 'farm') {
                setFarmPhoto(result.assets[0].uri);
              } else {
                setPermitPhoto(result.assets[0].uri);
              }
            }
          },
        },
        {
          text: 'Gallery',
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Denied', 'Gallery access is required.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync(options);
            if (!result.canceled && result.assets[0]) {
              if (type === 'farm') {
                setFarmPhoto(result.assets[0].uri);
              } else {
                setPermitPhoto(result.assets[0].uri);
              }
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.farm_phone.trim()) {
      Alert.alert('Error', 'Farm phone number is required');
      return;
    }
    if (!formData.farm_location.trim()) {
      Alert.alert('Error', 'Farm location is required');
      return;
    }
    if (!formData.permit_business_name.trim()) {
      Alert.alert('Error', 'Business name on permit is required');
      return;
    }
    if (!formData.permit_owner_name.trim()) {
      Alert.alert('Error', 'Owner name on permit is required');
      return;
    }
    if (!farmPhoto) {
      Alert.alert('Error', 'Farm photo is required');
      return;
    }
    if (!permitPhoto) {
      Alert.alert('Error', 'DTI/Business permit photo is required');
      return;
    }

    try {
      setIsLoading(true);

      // First update the profile with farm information
      await userAPI.updateProfile({
        farm_phone: formData.farm_phone,
        farm_location: formData.farm_location,
        exact_address: formData.exact_address,
        farm_description: formData.farm_description,
        permit_business_name: formData.permit_business_name,
        permit_owner_name: formData.permit_owner_name,
        is_farmer: true,
      });

      // Then submit verification with photos
      const verificationFormData = new FormData();
      verificationFormData.append('permit_business_name', formData.permit_business_name);
      verificationFormData.append('permit_owner_name', formData.permit_owner_name);

      // Add farm photo
      const farmPhotoName = farmPhoto.split('/').pop() || 'farm_photo.jpg';
      verificationFormData.append('farm_photo', {
        uri: farmPhoto,
        type: 'image/jpeg',
        name: farmPhotoName,
      } as any);

      // Add permit photo - backend expects 'business_permit_photo'
      const permitPhotoName = permitPhoto.split('/').pop() || 'permit_photo.jpg';
      verificationFormData.append('business_permit_photo', {
        uri: permitPhoto,
        type: 'image/jpeg',
        name: permitPhotoName,
      } as any);

      await verificationAPI.submitVerification(verificationFormData);

      Alert.alert(
        'Success',
        'Your verification request has been submitted. An admin will review it shortly.',
        [
          {
            text: 'OK',
            onPress: () => {
              refreshUser();
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error: any) {
      if (__DEV__) console.error('Verification submission error:', error);
      Alert.alert(
        'Error',
        error.response?.data?.error || 'Failed to submit verification. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingStatus) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Checking verification status...</Text>
      </View>
    );
  }

  // Show status if already submitted
  if (verificationStatus?.status === 'found' && verificationStatus.verification) {
    const status = verificationStatus.verification.verification_status;
    return (
      <ScrollView style={styles.container} keyboardDismissMode="on-drag">
        <View style={styles.statusContainer}>
          <View
            style={[
              styles.statusIcon,
              status === 'verified' && styles.statusIconVerified,
              status === 'pending' && styles.statusIconPending,
              status === 'rejected' && styles.statusIconRejected,
            ]}
          >
            <Ionicons
              name={
                status === 'verified'
                  ? 'checkmark-circle'
                  : status === 'pending'
                  ? 'time'
                  : 'close-circle'
              }
              size={60}
              color="#fff"
            />
          </View>
          <Text style={styles.statusTitle}>
            {status === 'verified'
              ? 'Verification Approved!'
              : status === 'pending'
              ? 'Verification Pending'
              : 'Verification Rejected'}
          </Text>
          <Text style={styles.statusText}>
            {status === 'verified'
              ? 'Your farm has been verified. You can now sell products on Farm to Click.'
              : status === 'pending'
              ? 'Your verification is being reviewed. This usually takes 1-2 business days.'
              : 'Unfortunately, your verification was not approved.'}
          </Text>

          {status === 'rejected' && verificationStatus.verification.rejection_reason && (
            <View style={styles.rejectionBox}>
              <Text style={styles.rejectionTitle}>Reason:</Text>
              <Text style={styles.rejectionText}>
                {verificationStatus.verification.rejection_reason}
              </Text>
            </View>
          )}

          {status === 'rejected' && (
            <TouchableOpacity
              style={styles.resubmitButton}
              onPress={() => setVerificationStatus(null)}
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.resubmitButtonText}>Submit Again</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={50} color="#4CAF50" />
          <Text style={styles.headerTitle}>Verify Your Farm</Text>
          <Text style={styles.headerSubtitle}>
            Submit your DTI/Business permit to become a verified seller
          </Text>
        </View>

        {/* Farm Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="leaf" size={18} color="#4CAF50" /> Farm Information
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Farm Phone Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., 09171234567"
              value={formData.farm_phone}
              onChangeText={(text) => setFormData({ ...formData, farm_phone: text })}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Farm Location *</Text>
            <View style={styles.locationRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Enter farm address or use GPS"
                value={formData.farm_location}
                onChangeText={(text) =>
                  setFormData({ ...formData, farm_location: text })
                }
                multiline
              />
              <TouchableOpacity
                style={styles.gpsButton}
                onPress={getLocationFromGPS}
                disabled={gettingLocation}
              >
                {gettingLocation ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="location" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Exact Address (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="House/Building No., Street, Barangay"
              value={formData.exact_address}
              onChangeText={(text) =>
                setFormData({ ...formData, exact_address: text })
              }
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Farm Description (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe your farm, products, etc."
              value={formData.farm_description}
              onChangeText={(text) =>
                setFormData({ ...formData, farm_description: text })
              }
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        {/* Farm Photo Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="camera" size={18} color="#4CAF50" /> Farm Photo *
          </Text>
          <Text style={styles.photoHint}>
            Take or upload a clear photo of your farm
          </Text>

          {farmPhoto ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: farmPhoto }} style={styles.photoPreview} />
              <TouchableOpacity
                style={styles.removePhotoButton}
                onPress={() => setFarmPhoto(null)}
              >
                <Ionicons name="close-circle" size={28} color="#ff4444" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.photoButton}
              onPress={() => pickImage('farm')}
            >
              <Ionicons name="image-outline" size={40} color="#888" />
              <Text style={styles.photoButtonText}>Add Farm Photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Permit Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="document-text" size={18} color="#4CAF50" /> DTI/Business
            Permit *
          </Text>
          <Text style={styles.photoHint}>
            Take a clear photo of your DTI Certificate or Business Permit
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Business Name on Permit *</Text>
            <TextInput
              style={styles.input}
              placeholder="Name registered on permit"
              value={formData.permit_business_name}
              onChangeText={(text) =>
                setFormData({ ...formData, permit_business_name: text })
              }
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Owner Name on Permit *</Text>
            <TextInput
              style={styles.input}
              placeholder="Owner's full name on permit"
              value={formData.permit_owner_name}
              onChangeText={(text) =>
                setFormData({ ...formData, permit_owner_name: text })
              }
            />
          </View>

          {permitPhoto ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: permitPhoto }} style={styles.photoPreview} />
              <TouchableOpacity
                style={styles.removePhotoButton}
                onPress={() => setPermitPhoto(null)}
              >
                <Ionicons name="close-circle" size={28} color="#ff4444" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.photoButton}
              onPress={() => pickImage('permit')}
            >
              <Ionicons name="document-outline" size={40} color="#888" />
              <Text style={styles.photoButtonText}>Add Permit Photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Verification</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By submitting, you confirm that all information provided is accurate.
          Verification typically takes 1-2 business days.
        </Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#fff',
    padding: 25,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
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
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 15,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#555',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gpsButton: {
    backgroundColor: '#4CAF50',
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoHint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
  },
  photoButton: {
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButtonText: {
    marginTop: 10,
    fontSize: 14,
    color: '#888',
  },
  photoContainer: {
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  removePhotoButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#4CAF50',
    margin: 15,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  disclaimer: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginHorizontal: 20,
    marginTop: 5,
  },
  // Status display styles
  statusContainer: {
    padding: 30,
    alignItems: 'center',
  },
  statusIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusIconVerified: {
    backgroundColor: '#4CAF50',
  },
  statusIconPending: {
    backgroundColor: '#FF9800',
  },
  statusIconRejected: {
    backgroundColor: '#f44336',
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  statusText: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  rejectionBox: {
    backgroundColor: '#ffebee',
    borderRadius: 8,
    padding: 15,
    marginTop: 20,
    width: '100%',
  },
  rejectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c62828',
    marginBottom: 5,
  },
  rejectionText: {
    fontSize: 14,
    color: '#c62828',
  },
  resubmitButton: {
    flexDirection: 'row',
    backgroundColor: '#4CAF50',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 25,
    alignItems: 'center',
    gap: 8,
  },
  resubmitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    marginTop: 15,
  },
  backButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default FarmerVerifyScreen;
