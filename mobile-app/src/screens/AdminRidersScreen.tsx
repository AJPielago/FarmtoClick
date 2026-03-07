import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Switch,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ridersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Rider {
  id: string;
  _id?: string;
  name: string;
  full_name?: string;
  username?: string;
  email?: string;
  phone?: string;
  barangay?: string;
  city?: string;
  province?: string;
  is_active?: boolean;
}

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  phone: '',
  barangay: '',
  city: '',
  province: '',
  is_active: true,
};

const AdminRidersScreen: React.FC = () => {
  const { user } = useAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await ridersAPI.getAdminRiders();
      setRiders(res.data?.riders || res.data || []);
    } catch (err) {
      if (__DEV__) console.error(err);
      Alert.alert('Error', 'Failed to load riders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openCreateModal = () => {
    setEditingRider(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  };

  const openEditModal = (rider: Rider) => {
    setEditingRider(rider);
    setForm({
      name: rider.name || rider.full_name || rider.username || '',
      email: rider.email || '',
      password: '',
      phone: rider.phone || '',
      barangay: rider.barangay || '',
      city: rider.city || '',
      province: rider.province || '',
      is_active: rider.is_active !== false,
    });
    setModalVisible(true);
  };

  const saveRider = async () => {
    if (!form.name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    if (!editingRider && !form.email.trim()) {
      Alert.alert('Error', 'Email is required for new riders');
      return;
    }
    if (!editingRider && !form.password.trim()) {
      Alert.alert('Error', 'Password is required for new riders');
      return;
    }

    try {
      setSaving(true);
      const payload: any = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        barangay: form.barangay.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        is_active: form.is_active,
      };

      if (editingRider) {
        if (form.email.trim()) payload.email = form.email.trim();
        if (form.password.trim()) payload.password = form.password.trim();
        await ridersAPI.updateAdminRider(editingRider.id || editingRider._id!, payload);
        Alert.alert('Success', 'Rider updated successfully');
      } else {
        payload.email = form.email.trim();
        payload.password = form.password.trim();
        await ridersAPI.createAdminRider(payload);
        Alert.alert('Success', 'Rider created successfully');
      }

      setModalVisible(false);
      load();
    } catch (err: any) {
      if (__DEV__) console.error(err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to save rider');
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    Alert.alert('Confirm Delete', 'Are you sure you want to delete this rider?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await ridersAPI.deleteAdminRider(id);
            Alert.alert('Success', 'Rider deleted');
            load();
          } catch (err) {
            if (__DEV__) console.error(err);
            Alert.alert('Error', 'Failed to delete rider');
          }
        },
      },
    ]);
  };

  if (!user?.is_admin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={60} color="#ccc" />
        <Text style={styles.accessTitle}>Access Denied</Text>
      </View>
    );
  }

  // Stats
  const activeRiders = riders.filter((r) => r.is_active !== false).length;
  const coverageAreas = new Set(riders.map((r) => r.city).filter(Boolean)).size;

  return (
    <View style={styles.container}>
      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{activeRiders}</Text>
          <Text style={styles.statLabel}>Active Riders</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{riders.length}</Text>
          <Text style={styles.statLabel}>Total Riders</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{coverageAreas}</Text>
          <Text style={styles.statLabel}>Coverage Areas</Text>
        </View>
      </View>

      {/* Add Button */}
      <TouchableOpacity style={styles.addButton} onPress={openCreateModal}>
        <Ionicons name="add-circle" size={22} color="#fff" />
        <Text style={styles.addButtonText}>Add Rider</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={riders}
          keyExtractor={(i) => i.id || i._id || ''}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />
          }
          renderItem={({ item }) => (
            <View style={styles.riderCard}>
              <View style={styles.riderAvatar}>
                <Ionicons name="bicycle" size={24} color="#4CAF50" />
              </View>
              <View style={styles.riderInfo}>
                <Text style={styles.riderName}>
                  {item.name || item.full_name || item.username}
                </Text>
                {item.email && <Text style={styles.riderMeta}>{item.email}</Text>}
                {item.phone && <Text style={styles.riderMeta}>{item.phone}</Text>}
                {(item.barangay || item.city || item.province) && (
                  <Text style={styles.riderArea}>
                    {[item.barangay, item.city, item.province].filter(Boolean).join(', ')}
                  </Text>
                )}
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.activeBadge,
                      { backgroundColor: item.is_active !== false ? '#E8F5E9' : '#FFEBEE' },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color: item.is_active !== false ? '#2E7D32' : '#C62828',
                        fontWeight: '600',
                      }}
                    >
                      {item.is_active !== false ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.riderActions}>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => openEditModal(item)}
                >
                  <Ionicons name="create" size={18} color="#1565C0" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => remove(item.id || item._id!)}
                >
                  <Ionicons name="trash" size={18} color="#C62828" />
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyState}>
              <Ionicons name="bicycle-outline" size={50} color="#ccc" />
              <Text style={styles.emptyText}>No riders found</Text>
              <Text style={styles.emptySubtext}>Add a rider to get started</Text>
            </View>
          )}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {editingRider ? 'Edit Rider' : 'Create Rider'}
            </Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.formInput}
              value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="Full name"
            />

            <Text style={styles.fieldLabel}>Email {editingRider ? '' : '*'}</Text>
            <TextInput
              style={styles.formInput}
              value={form.email}
              onChangeText={(v) => setForm({ ...form, email: v })}
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>
              Password {editingRider ? '(leave blank to keep current)' : '*'}
            </Text>
            <TextInput
              style={styles.formInput}
              value={form.password}
              onChangeText={(v) => setForm({ ...form, password: v })}
              placeholder="Password"
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.formInput}
              value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: v })}
              placeholder="Phone number"
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Barangay</Text>
            <TextInput
              style={styles.formInput}
              value={form.barangay}
              onChangeText={(v) => setForm({ ...form, barangay: v })}
              placeholder="Barangay"
            />

            <Text style={styles.fieldLabel}>City</Text>
            <TextInput
              style={styles.formInput}
              value={form.city}
              onChangeText={(v) => setForm({ ...form, city: v })}
              placeholder="City"
            />

            <Text style={styles.fieldLabel}>Province</Text>
            <TextInput
              style={styles.formInput}
              value={form.province}
              onChangeText={(v) => setForm({ ...form, province: v })}
              placeholder="Province"
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Active</Text>
              <Switch
                value={form.is_active}
                onValueChange={(v) => setForm({ ...form, is_active: v })}
                trackColor={{ true: '#4CAF50', false: '#ccc' }}
                thumbColor="#fff"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              onPress={saveRider}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {editingRider ? 'Update Rider' : 'Create Rider'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  accessTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginTop: 15 },
  statsRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  statNumber: { fontSize: 22, fontWeight: 'bold', color: '#4CAF50' },
  statLabel: { fontSize: 11, color: '#666', marginTop: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  riderAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  riderInfo: { flex: 1 },
  riderName: { fontSize: 15, fontWeight: '700', color: '#333' },
  riderMeta: { fontSize: 13, color: '#666', marginTop: 2 },
  riderArea: { fontSize: 12, color: '#888', marginTop: 2 },
  statusRow: { flexDirection: 'row', marginTop: 5 },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  riderActions: { flexDirection: 'row', gap: 8 },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFEBEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#666', marginTop: 10 },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#4CAF50',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  modalBody: { flex: 1, padding: 20 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginTop: 12,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fafafa',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 25,
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

export default AdminRidersScreen;
