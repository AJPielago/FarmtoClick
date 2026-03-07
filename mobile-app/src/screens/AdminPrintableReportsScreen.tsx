import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { adminAPI } from '../services/api';

const AdminPrintableReportsScreen: React.FC = () => {
  const [reportData, setReportData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [days, setDays] = useState(30);

  const loadReport = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await adminAPI.getReports(days);
      setReportData(res.data);
    } catch (error) {
      if (__DEV__) console.error('Failed to load report:', error);
      Alert.alert('Error', 'Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const formatCurrency = (val: number) =>
    `₱${Number(val || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (!reportData) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>No report data available.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>System Report</Text>
        <Text style={styles.subtitle}>Last {days} Days</Text>
      </View>

      <View style={styles.filterContainer}>
        {[7, 30, 90, 365].map((d) => (
          <TouchableOpacity
            key={d}
            style={[styles.filterButton, days === d && styles.filterButtonActive]}
            onPress={() => setDays(d)}
          >
            <Text style={[styles.filterText, days === d && styles.filterTextActive]}>
              {d} Days
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Overview</Text>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Revenue:</Text>
          <Text style={styles.statValue}>{formatCurrency(reportData.total_revenue)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Orders:</Text>
          <Text style={styles.statValue}>{reportData.total_orders}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>New Users:</Text>
          <Text style={styles.statValue}>{reportData.new_users}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>New Farmers:</Text>
          <Text style={styles.statValue}>{reportData.new_farmers}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top Products</Text>
        {reportData.top_products?.map((product: any, index: number) => (
          <View key={index} style={styles.productRow}>
            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.productSales}>{product.sales} sold</Text>
          </View>
        ))}
      </View>
    </ScrollView>
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
  header: {
    backgroundColor: '#4CAF50',
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    marginTop: 5,
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
  },
  filterText: {
    color: '#666',
    fontWeight: 'bold',
  },
  filterTextActive: {
    color: 'white',
  },
  card: {
    backgroundColor: 'white',
    margin: 15,
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statLabel: {
    fontSize: 16,
    color: '#666',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  productName: {
    fontSize: 16,
    color: '#444',
    flex: 1,
  },
  productSales: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c7a2c',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});

export default AdminPrintableReportsScreen;
