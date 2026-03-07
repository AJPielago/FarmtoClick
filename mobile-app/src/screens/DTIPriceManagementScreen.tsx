import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../context/AuthContext';
import { dtiAPI } from '../services/api';

const DTIPriceManagementScreen: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'records' | 'upload'>('records');
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<any>(null);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const res = await dtiAPI.getPrices();
      setRecords(res.data?.records || []);
    } catch (error) {
      if (__DEV__) console.error('Failed to load DTI records:', error);
      Alert.alert('Error', 'Failed to load DTI price records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.is_admin) loadRecords();
  }, [user, loadRecords]);

  const filtered = records.filter(
    (r) => !searchQuery || (r.product_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const displayed = selectedDate
    ? filtered.filter((r) => r.uploaded_at && r.uploaded_at.startsWith(selectedDate))
    : filtered;

  const deleteDisplayed = async () => {
    if (displayed.length === 0) return Alert.alert('Nothing to delete');
    Alert.alert(
      'Confirm',
      `Delete ${displayed.length} displayed record(s)? This will deactivate them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const ids = displayed.map((d) => d._id).filter(Boolean);
              const res = await dtiAPI.bulkDelete(ids, false);
              Alert.alert('Success', res.data?.message || `${ids.length} record(s) deleted`);
              loadRecords();
            } catch (err) {
              if (__DEV__) console.error(err);
              Alert.alert('Error', 'Failed to delete records');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        setUploadResult(null);
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick PDF file');
    }
  };

  const uploadPdf = async () => {
    if (!selectedFile) {
      Alert.alert('Error', 'Please select a PDF file first');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', {
        uri: selectedFile.uri,
        type: 'application/pdf',
        name: selectedFile.name || 'dti_prices.pdf',
      } as any);

      const res = await dtiAPI.uploadPdf(formData);
      setUploadResult(res.data);
      setSelectedFile(null);
      Alert.alert('Success', res.data?.message || 'PDF uploaded and processed successfully');
      loadRecords();
    } catch (error: any) {
      if (__DEV__) console.error('Upload error:', error);
      Alert.alert(
        'Error',
        error.response?.data?.message || 'Failed to upload PDF'
      );
    } finally {
      setUploading(false);
    }
  };

  if (!user || !user.is_admin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={60} color="#ccc" />
        <Text style={styles.title}>Access Denied</Text>
        <Text>This page is for administrators only.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'records' && styles.tabActive]}
          onPress={() => setActiveTab('records')}
        >
          <Ionicons
            name="list"
            size={18}
            color={activeTab === 'records' ? '#4CAF50' : '#666'}
          />
          <Text style={[styles.tabText, activeTab === 'records' && styles.tabTextActive]}>
            Price Records
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'upload' && styles.tabActive]}
          onPress={() => setActiveTab('upload')}
        >
          <Ionicons
            name="cloud-upload"
            size={18}
            color={activeTab === 'upload' ? '#4CAF50' : '#666'}
          />
          <Text style={[styles.tabText, activeTab === 'upload' && styles.tabTextActive]}>
            Upload PDF
          </Text>
        </TouchableOpacity>
      </View>

      {/* Records Tab */}
      {activeTab === 'records' && (
        <View style={{ flex: 1 }}>
          <View style={styles.headerRow}>
            <TextInput
              placeholder="Search products..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.input}
            />
            <TextInput
              placeholder="YYYY-MM-DD"
              value={selectedDate}
              onChangeText={setSelectedDate}
              style={[styles.input, { width: 130 }]}
            />
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.button}
              onPress={() => {
                setSelectedDate('');
                setSearchQuery('');
              }}
            >
              <Text style={styles.buttonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#dc3545' }]}
              onPress={deleteDisplayed}
            >
              <Text style={styles.buttonText}>Delete Displayed ({displayed.length})</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={displayed}
              keyExtractor={(item) => item._id || item.product_name || Math.random().toString()}
              renderItem={({ item }) => (
                <View style={styles.item}>
                  <Text style={styles.product}>{item.product_name}</Text>
                  <Text style={styles.meta}>
                    ₱{(item.average_price || 0).toFixed(2)} • {item.unit || '-'}
                  </Text>
                  <Text style={styles.metaSmall}>
                    {item.source_file || ''} •{' '}
                    {item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : '-'}
                  </Text>
                </View>
              )}
              ListEmptyComponent={() => (
                <View style={styles.center}>
                  <Text>No records found.</Text>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* Upload PDF Tab */}
      {activeTab === 'upload' && (
        <ScrollView style={styles.uploadContainer}>
          <View style={styles.uploadCard}>
            <Ionicons name="document-text" size={50} color="#4CAF50" />
            <Text style={styles.uploadTitle}>Upload DTI Price Bulletin</Text>
            <Text style={styles.uploadSubtext}>
              Upload a DTI price bulletin PDF to automatically extract and store price records.
            </Text>

            <TouchableOpacity style={styles.pickButton} onPress={pickPdf}>
              <Ionicons name="folder-open" size={20} color="#fff" />
              <Text style={styles.pickButtonText}>
                {selectedFile ? 'Change File' : 'Select PDF File'}
              </Text>
            </TouchableOpacity>

            {selectedFile && (
              <View style={styles.fileInfo}>
                <Ionicons name="document" size={20} color="#4CAF50" />
                <Text style={styles.fileName} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
                <Text style={styles.fileSize}>
                  {((selectedFile.size || 0) / 1024).toFixed(1)} KB
                </Text>
              </View>
            )}

            {selectedFile && (
              <TouchableOpacity
                style={[styles.uploadButton, uploading && { opacity: 0.6 }]}
                onPress={uploadPdf}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={20} color="#fff" />
                    <Text style={styles.uploadButtonText}>Upload & Process</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Upload Result Preview */}
          {uploadResult && (
            <View style={styles.resultCard}>
              <Text style={styles.resultTitle}>Upload Result</Text>
              {uploadResult.records_added !== undefined && (
                <Text style={styles.resultText}>
                  Records added: {uploadResult.records_added}
                </Text>
              )}
              {uploadResult.records_updated !== undefined && (
                <Text style={styles.resultText}>
                  Records updated: {uploadResult.records_updated}
                </Text>
              )}
              {uploadResult.products && uploadResult.products.length > 0 && (
                <>
                  <Text style={[styles.resultTitle, { marginTop: 10 }]}>Extracted Products</Text>
                  {uploadResult.products.slice(0, 10).map((p: any, i: number) => (
                    <View key={i} style={styles.resultItem}>
                      <Text style={styles.product}>{p.product_name || p.name}</Text>
                      <Text style={styles.meta}>
                        ₱{(p.average_price || p.price || 0).toFixed(2)} / {p.unit || '-'}
                      </Text>
                    </View>
                  ))}
                  {uploadResult.products.length > 10 && (
                    <Text style={styles.metaSmall}>
                      ... and {uploadResult.products.length - 10} more
                    </Text>
                  )}
                </>
              )}
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8, marginTop: 10 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#4CAF50',
  },
  tabText: { fontSize: 14, color: '#666', fontWeight: '500' },
  tabTextActive: { color: '#4CAF50', fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    paddingBottom: 0,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    paddingTop: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  item: {
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  product: { fontWeight: '700', color: '#333' },
  meta: { color: '#666', marginTop: 4 },
  metaSmall: { color: '#999', marginTop: 2, fontSize: 12 },
  uploadContainer: { flex: 1, padding: 15 },
  uploadCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 15,
  },
  uploadSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
    gap: 8,
  },
  pickButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
    width: '100%',
    gap: 8,
  },
  fileName: { flex: 1, fontSize: 14, color: '#333' },
  fileSize: { fontSize: 12, color: '#888' },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginTop: 15,
    width: '100%',
    gap: 8,
  },
  uploadButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginTop: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  resultText: { fontSize: 14, color: '#555', marginBottom: 4 },
  resultItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
});

export default DTIPriceManagementScreen;
