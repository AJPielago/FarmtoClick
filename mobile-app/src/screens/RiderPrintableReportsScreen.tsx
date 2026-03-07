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
import { ordersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const RiderPrintableReportsScreen: React.FC = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [period, setPeriod] = useState('30d');

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await ordersAPI.getRiderDashboard(period);
      setData(res.data);
    } catch (error) {
      if (__DEV__) console.error('Failed to load rider report data:', error);
      Alert.alert('Error', 'Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatCurrency = (val: number) =>
    `₱${Number(val || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.centerContainer}>
        <Text>No data available</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Rider Report</Text>
        <Text style={styles.subtitle}>Performance Overview</Text>
      </View>

      <View style={styles.filterContainer}>
        {['7d', '30d', 'all'].map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.filterButton, period === p && styles.filterButtonActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.filterText, period === p && styles.filterTextActive]}>
              {p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : 'All Time'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stats Summary</Text>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Earnings</Text>
          <Text style={styles.statValue}>{formatCurrency(data.total_earnings)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Deliveries</Text>
          <Text style={styles.statValue}>{data.total_deliveries}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Completed</Text>
          <Text style={[styles.statValue, { color: 'green' }]}>{data.completed_deliveries}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Activity</Text>
        {data.recent_orders?.length === 0 ? (
          <Text style={styles.emptyText}>No recent orders</Text>
        ) : (
          data.recent_orders?.map((order: any, index: number) => (
            <View key={index} style={styles.orderRow}>
              <Text style={styles.orderId}>Order #{order.id}</Text>
              <Text style={styles.orderStatus}>{order.status}</Text>
              <Text style={styles.orderDate}>
                {new Date(order.created_at).toLocaleDateString()}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  filterText: {
    color: '#666',
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statLabel: {
    fontSize: 16,
    color: '#555',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  emptyText: {
    fontStyle: 'italic',
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  orderId: {
    fontWeight: 'bold',
    color: '#333',
  },
  orderStatus: {
    textTransform: 'capitalize',
    color: '#4CAF50',
  },
  orderDate: {
    color: '#888',
    fontSize: 12,
  },
});

export default RiderPrintableReportsScreen;
