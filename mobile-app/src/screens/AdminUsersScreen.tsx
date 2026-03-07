import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminAPI } from '../services/api';
import { User } from '../types';

const AdminUsersScreen: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [pendingDeactivateUser, setPendingDeactivateUser] = useState<User | null>(null);
  const [deactivationReason, setDeactivationReason] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const res = await adminAPI.getUsers();
      setUsers(res.data?.users || []);
    } catch (error) {
      if (__DEV__) console.error('Failed to load users:', error);
      Alert.alert('Error', 'Failed to load users');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const handleRoleChange = (userId: string, currentRole: string) => {
    Alert.alert(
      'Change Role',
      `Current role: ${currentRole}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make Admin', onPress: () => updateRole(userId, 'admin') },
        { text: 'Make User', onPress: () => updateRole(userId, 'user') },
        { text: 'Make Rider', onPress: () => updateRole(userId, 'rider') },
      ]
    );
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
      await adminAPI.updateUserRole(userId, newRole);
      Alert.alert('Success', `User role updated to ${newRole}`);
      loadUsers();
    } catch (error) {
      if (__DEV__) console.error('Failed to update role:', error);
      Alert.alert('Error', 'Failed to update user role');
    }
  };

  const handleToggleStatus = (targetUser: User) => {
    const isCurrentlyActive = targetUser.is_active !== false;
    if (isCurrentlyActive) {
      setPendingDeactivateUser(targetUser);
      setDeactivationReason('');
      setReasonModalVisible(true);
      return;
    }

    Alert.alert(
      'Activate User',
      `Activate ${targetUser.first_name} ${targetUser.last_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Activate', onPress: () => submitToggleStatus(targetUser, true) },
      ]
    );
  };

  const submitToggleStatus = async (targetUser: User, nextStatus: boolean, reason?: string) => {
    try {
      setTogglingUserId(targetUser.id);
      await adminAPI.toggleUserStatus(targetUser.id, nextStatus, reason);
      Alert.alert('Success', `User ${nextStatus ? 'activated' : 'deactivated'} successfully`);
      await loadUsers();
    } catch (error: any) {
      if (__DEV__) console.error('Failed to toggle user status:', error);
      Alert.alert('Error', error?.response?.data?.error || 'Failed to update user status');
    } finally {
      setTogglingUserId(null);
    }
  };

  const confirmDeactivation = async () => {
    const reason = deactivationReason.trim();
    if (!reason) {
      Alert.alert('Reason Required', 'Please enter a reason for deactivation.');
      return;
    }
    if (!pendingDeactivateUser) return;

    setReasonModalVisible(false);
    await submitToggleStatus(pendingDeactivateUser, false, reason);
    setPendingDeactivateUser(null);
    setDeactivationReason('');
  };

  const renderUser = ({ item }: { item: User }) => (
    <View style={styles.userCard}>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.first_name} {item.last_name}</Text>
        <Text style={styles.userEmail}>{item.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{item.role || 'user'}</Text>
        </View>
        <View style={[styles.statusBadge, (item.is_active !== false) ? styles.statusActive : styles.statusInactive]}>
          <Text style={[styles.statusText, (item.is_active !== false) ? styles.statusTextActive : styles.statusTextInactive]}>
            {(item.is_active !== false) ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>
      <View style={styles.actionsCol}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => handleRoleChange(item.id, item.role || 'user')}
        >
          <Ionicons name="create-outline" size={20} color="#4CAF50" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            (item.is_active !== false) ? styles.deactivateButton : styles.activateButton,
            togglingUserId === item.id && styles.disabledButton,
          ]}
          disabled={togglingUserId === item.id}
          onPress={() => handleToggleStatus(item)}
        >
          <Text style={styles.toggleButtonText}>
            {togglingUserId === item.id ? '...' : ((item.is_active !== false) ? 'Deactivate' : 'Activate')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No users found.</Text>
        }
      />

      <Modal
        transparent
        visible={reasonModalVisible}
        animationType="fade"
        onRequestClose={() => setReasonModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Deactivation Reason</Text>
            <Text style={styles.modalSubtitle}>
              Please provide a reason for deactivating this account. This will be emailed to the user.
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Enter reason"
              value={deactivationReason}
              onChangeText={setDeactivationReason}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setReasonModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={confirmDeactivation}>
                <Text style={styles.modalBtnConfirmText}>Deactivate</Text>
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
    backgroundColor: '#f8f9fa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    padding: 15,
  },
  userCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  roleBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  roleText: {
    color: '#2e7d32',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  statusActive: {
    backgroundColor: '#dcfce7',
  },
  statusInactive: {
    backgroundColor: '#fee2e2',
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  statusTextActive: {
    color: '#166534',
  },
  statusTextInactive: {
    color: '#b91c1c',
  },
  actionsCol: {
    marginLeft: 12,
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    padding: 8,
  },
  toggleButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 88,
    alignItems: 'center',
  },
  activateButton: {
    backgroundColor: '#16a34a',
  },
  deactivateButton: {
    backgroundColor: '#dc2626',
  },
  disabledButton: {
    opacity: 0.6,
  },
  toggleButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 20,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalSubtitle: {
    marginTop: 8,
    fontSize: 13,
    color: '#4b5563',
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    marginTop: 12,
    minHeight: 90,
    padding: 10,
    textAlignVertical: 'top',
    color: '#111827',
  },
  modalActions: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalBtnCancel: {
    backgroundColor: '#e5e7eb',
  },
  modalBtnConfirm: {
    backgroundColor: '#dc2626',
  },
  modalBtnCancelText: {
    color: '#111827',
    fontWeight: '600',
  },
  modalBtnConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default AdminUsersScreen;
