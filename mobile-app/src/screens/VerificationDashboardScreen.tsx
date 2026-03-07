import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { adminAPI, API_BASE_URL } from '../services/api';

interface Verification {
  id: string;
  user?: {
    email?: string;
    name?: string;
    farm_name?: string;
  };
  // Mapped fields for display
  user_name?: string;
  user_email?: string;
  permit_business_name?: string;
  permit_owner_name?: string;
  farm_photo?: string;
  permit_photo?: string;
  image_filename?: string;
  // Status fields
  status?: string;  // 'verified', 'rejected'
  verification_status?: string;
  valid?: boolean;
  rejected?: boolean;
  // Timestamps
  timestamp?: string;
  created_at?: string;
  // Verification details
  confidence?: number;
  ml_confidence?: number;
  qr_valid?: boolean;
  ml_is_permit?: boolean;
  dti_business_name?: string;
  admin_notes?: string;
  // Check results for display
  quality_check_passed?: boolean;
  document_detection_passed?: boolean;
}

interface Stats {
  total: number;
  verified: number;
  rejected: number;
}

const VerificationDashboardScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();

  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, verified: 0, rejected: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'verified' | 'rejected'>('all');
  
  // Modal states
  const [selectedVerification, setSelectedVerification] = useState<Verification | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const loadVerifications = useCallback(async () => {
    try {
      const response = await adminAPI.getVerifications();
      const data = response.data;

      if (data.verifications) {
        // Transform data from permit_verifications endpoint
        const transformed = data.verifications.map((v: any) => ({
          ...v,
          // Map user object to flat fields for display
          user_name: v.user?.name || v.permit_business_name || 'N/A',
          user_email: v.user?.email || 'N/A',
          permit_business_name: v.permit_business_name || v.user?.farm_name || 'N/A',
          // Map status to valid/rejected booleans
          valid: v.valid || v.status === 'verified',
          rejected: v.status === 'rejected',
          // Timestamps
          timestamp: v.created_at || v.timestamp,
          // Map check results
          quality_check_passed: v.confidence > 0.5 || v.ml_confidence > 0.5,
          document_detection_passed: v.ml_is_permit || v.qr_valid,
        }));
        setVerifications(transformed);
      }
      
      if (data.stats) {
        setStats({
          total: data.stats.total || 0,
          verified: data.stats.verified || 0,
          rejected: data.stats.rejected || 0,
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading verifications:', error);
      Alert.alert('Error', 'Failed to load verifications');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) {
      loadVerifications();
    }
  }, [user, loadVerifications]);

  const onRefresh = () => {
    setRefreshing(true);
    loadVerifications();
  };

  const getFilteredVerifications = () => {
    return verifications.filter((v) => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'verified') return v.status === 'verified' || v.valid === true;
      if (activeFilter === 'rejected') return v.status === 'rejected' || v.rejected === true;
      return true;
    });
  };

  const openDetailModal = (verification: Verification) => {
    setSelectedVerification(verification);
    setShowDetailModal(true);
  };

  const closeDetailModal = () => {
    setShowDetailModal(false);
    setSelectedVerification(null);
  };

  const handleApprove = async (verification: Verification) => {
    Alert.alert(
      'Approve Verification',
      `Are you sure you want to approve ${verification.permit_business_name || verification.user_name || 'this farmer'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setIsProcessing(true);
            try {
              await adminAPI.approveVerification(verification.id);
              Alert.alert('Success', 'Verification approved successfully');
              closeDetailModal();
              loadVerifications();
            } catch (error) {
              if (__DEV__) console.error('Error approving verification:', error);
              Alert.alert('Error', 'Failed to approve verification');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const openRejectModal = (verification: Verification) => {
    setSelectedVerification(verification);
    setShowRejectModal(true);
    setRejectionReason('');
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }

    if (!selectedVerification) return;

    setIsProcessing(true);
    try {
      await adminAPI.rejectVerification(selectedVerification.id, rejectionReason);
      Alert.alert('Success', 'Verification rejected');
      setShowRejectModal(false);
      closeDetailModal();
      loadVerifications();
    } catch (error) {
      if (__DEV__) console.error('Error rejecting verification:', error);
      Alert.alert('Error', 'Failed to reject verification');
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusBadge = (verification: Verification) => {
    if (verification.status === 'verified' || verification.valid) {
      return { text: 'Verified', color: '#4CAF50', bg: '#E8F5E9' };
    }
    if (verification.status === 'rejected' || verification.rejected) {
      return { text: 'Rejected', color: '#F44336', bg: '#FFEBEE' };
    }
    return { text: 'Rejected', color: '#F44336', bg: '#FFEBEE' };
  };

  if (!user?.is_admin) {
    return (
      <View style={styles.accessDenied}>
        <Ionicons name="lock-closed" size={60} color="#ccc" />
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          Admin access required
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading verifications...</Text>
      </View>
    );
  }

  const filteredVerifications = getFilteredVerifications();

  return (
    <View style={styles.container}>
      {/* Stats Header */}
      <View style={styles.statsHeader}>
        <View style={styles.statsRow}>
          <View style={[styles.statBadge, { backgroundColor: '#E3F2FD' }]}>
            <Text style={[styles.statNumber, { color: '#1565C0' }]}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={[styles.statBadge, { backgroundColor: '#E8F5E9' }]}>
            <Text style={[styles.statNumber, { color: '#4CAF50' }]}>{stats.verified}</Text>
            <Text style={styles.statLabel}>Verified</Text>
          </View>
          <View style={[styles.statBadge, { backgroundColor: '#FFEBEE' }]}>
            <Text style={[styles.statNumber, { color: '#F44336' }]}>{stats.rejected}</Text>
            <Text style={styles.statLabel}>Rejected</Text>
          </View>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['all', 'verified', 'rejected'] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.filterButton,
                activeFilter === filter && styles.filterButtonActive,
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[
                  styles.filterText,
                  activeFilter === filter && styles.filterTextActive,
                ]}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Verifications List */}
      <ScrollView
        style={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#4CAF50']}
          />
        }
      >
        {filteredVerifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={60} color="#ddd" />
            <Text style={styles.emptyTitle}>No Verifications</Text>
            <Text style={styles.emptyText}>No {activeFilter !== 'all' ? activeFilter : ''} verifications found</Text>
          </View>
        ) : (
          filteredVerifications.map((verification, index) => {
            const status = getStatusBadge(verification);
            return (
              <TouchableOpacity
                key={verification.id || index}
                style={styles.verificationCard}
                onPress={() => openDetailModal(verification)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={styles.businessName} numberOfLines={1}>
                      {verification.permit_business_name || 'No Business Name'}
                    </Text>
                    <Text style={styles.ownerName}>
                      {verification.permit_owner_name || verification.user_name || 'Unknown'}
                    </Text>
                    {verification.timestamp && (
                      <Text style={styles.timestamp}>
                        Submitted: {new Date(verification.timestamp).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>
                      {status.text}
                    </Text>
                  </View>
                </View>

                {/* Action buttons for pending verifications */}
                {!verification.valid && !verification.rejected && (
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => openRejectModal(verification)}
                    >
                      <Ionicons name="close" size={18} color="#F44336" />
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.approveButton}
                      onPress={() => handleApprove(verification)}
                    >
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.approveButtonText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Detail Modal */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={closeDetailModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalClose} onPress={closeDetailModal}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Verification Details</Text>

              {selectedVerification && (
                <>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Business Name</Text>
                    <Text style={styles.detailValue}>
                      {selectedVerification.permit_business_name || 'N/A'}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Owner Name</Text>
                    <Text style={styles.detailValue}>
                      {selectedVerification.permit_owner_name || 'N/A'}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Email</Text>
                    <Text style={styles.detailValue}>
                      {selectedVerification.user_email || 'N/A'}
                    </Text>
                  </View>

                  {selectedVerification.farm_photo && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Farm Photo</Text>
                      <Image
                        source={{
                          uri: `${API_BASE_URL}/static/uploads/verifications/${selectedVerification.farm_photo}`,
                        }}
                        style={styles.photoPreview}
                        resizeMode="cover"
                      />
                    </View>
                  )}

                  {selectedVerification.permit_photo && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Permit Photo</Text>
                      <Image
                        source={{
                          uri: `${API_BASE_URL}/static/uploads/verifications/${selectedVerification.permit_photo}`,
                        }}
                        style={styles.photoPreview}
                        resizeMode="cover"
                      />
                    </View>
                  )}

                  {/* Quality Checks */}
                  <View style={styles.checksSection}>
                    <Text style={styles.detailLabel}>Verification Checks</Text>
                    <View style={styles.checkRow}>
                      <Ionicons
                        name={selectedVerification.quality_check_passed ? 'checkmark-circle' : 'close-circle'}
                        size={20}
                        color={selectedVerification.quality_check_passed ? '#4CAF50' : '#F44336'}
                      />
                      <Text style={styles.checkText}>Quality Check</Text>
                    </View>
                    <View style={styles.checkRow}>
                      <Ionicons
                        name={selectedVerification.document_detection_passed ? 'checkmark-circle' : 'close-circle'}
                        size={20}
                        color={selectedVerification.document_detection_passed ? '#4CAF50' : '#F44336'}
                      />
                      <Text style={styles.checkText}>Document Detection</Text>
                    </View>
                  </View>

                  {/* Action Buttons for pending */}
                  {!selectedVerification.valid && !selectedVerification.rejected && (
                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalRejectButton]}
                        onPress={() => {
                          closeDetailModal();
                          openRejectModal(selectedVerification);
                        }}
                      >
                        <Text style={styles.modalRejectText}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalButton, styles.modalApproveButton]}
                        onPress={() => handleApprove(selectedVerification)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.modalApproveText}>Approve</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rejection Modal */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '50%' }]}>
            <Text style={styles.modalTitle}>Reject Verification</Text>
            <Text style={styles.rejectHint}>
              Please provide a reason for rejection. This will be shown to the farmer.
            </Text>
            <TextInput
              style={styles.rejectInput}
              placeholder="Enter rejection reason..."
              value={rejectionReason}
              onChangeText={setRejectionReason}
              multiline
              numberOfLines={4}
            />
            <View style={styles.rejectActions}>
              <TouchableOpacity
                style={styles.rejectCancel}
                onPress={() => setShowRejectModal(false)}
              >
                <Text style={styles.rejectCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectConfirm}
                onPress={handleReject}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.rejectConfirmText}>Reject</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  accessDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  accessDeniedTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 15,
  },
  accessDeniedText: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  statsHeader: {
    backgroundColor: '#fff',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  filterContainer: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 10,
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
  },
  filterText: {
    fontSize: 14,
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
    padding: 15,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 50,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 15,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  },
  verificationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardInfo: {
    flex: 1,
  },
  businessName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  ownerName: {
    fontSize: 14,
    color: '#666',
    marginTop: 3,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: 5,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 10,
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F44336',
    gap: 5,
  },
  rejectButtonText: {
    color: '#F44336',
    fontWeight: '600',
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    gap: 5,
  },
  approveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  modalClose: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  detailSection: {
    marginBottom: 15,
  },
  detailLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 5,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 16,
    color: '#333',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  checksSection: {
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  checkText: {
    fontSize: 14,
    color: '#555',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 25,
    gap: 15,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalRejectButton: {
    backgroundColor: '#FFEBEE',
  },
  modalRejectText: {
    color: '#F44336',
    fontWeight: '600',
    fontSize: 16,
  },
  modalApproveButton: {
    backgroundColor: '#4CAF50',
  },
  modalApproveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  rejectHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  rejectInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    height: 100,
    textAlignVertical: 'top',
  },
  rejectActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
    gap: 12,
  },
  rejectCancel: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rejectCancelText: {
    color: '#666',
    fontSize: 16,
  },
  rejectConfirm: {
    backgroundColor: '#F44336',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 8,
  },
  rejectConfirmText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default VerificationDashboardScreen;
