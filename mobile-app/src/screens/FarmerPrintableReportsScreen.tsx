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
import { productsAPI, ordersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const FarmerPrintableReportsScreen: React.FC = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    pendingOrders: 0,
  });

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [productsRes, ordersRes] = await Promise.all([
        productsAPI.getProducts(),
        ordersAPI.getSellerOrders(),
      ]);

      const prodData = productsRes.data?.products || [];
      const ordData = ordersRes.data?.orders || [];
      
      setProducts(prodData);
      setOrders(ordData);
      calculateStats(ordData);
    } catch (error) {
      if (__DEV__) console.error('Failed to load farmer report data:', error);
      Alert.alert('Error', 'Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const calculateStats = (ordersData: any[]) => {
    let revenue = 0;
    let completed = 0;
    let cancelled = 0;
    let pending = 0;

    ordersData.forEach(order => {
      const total = parseFloat(order.total_amount || 0);
      if (order.status === 'completed' || order.status === 'delivered') {
        revenue += total;
        completed++;
      } else if (order.status === 'cancelled') {
        cancelled++;
      } else {
        pending++;
      }
    });

    setStats({
      totalRevenue: revenue,
      totalOrders: ordersData.length,
      completedOrders: completed,
      cancelledOrders: cancelled,
      pendingOrders: pending,
    });
  };

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

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Farmer Report</Text>
        <Text style={styles.subtitle}>Performance Overview</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sales Summary</Text>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Revenue</Text>
          <Text style={styles.statValue}>{formatCurrency(stats.totalRevenue)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Orders</Text>
          <Text style={styles.statValue}>{stats.totalOrders}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Completed</Text>
          <Text style={[styles.statValue, { color: 'green' }]}>{stats.completedOrders}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Pending</Text>
          <Text style={[styles.statValue, { color: 'orange' }]}>{stats.pendingOrders}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Cancelled</Text>
          <Text style={[styles.statValue, { color: 'red' }]}>{stats.cancelledOrders}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Product Inventory</Text>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Products</Text>
          <Text style={styles.statValue}>{products.length}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Low Stock Items</Text>
          <Text style={styles.statValue}>{products.filter(p => p.stock < 10).length}</Text>
        </View>
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
});

export default FarmerPrintableReportsScreen;
