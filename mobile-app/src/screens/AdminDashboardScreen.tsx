import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { adminAPI } from '../services/api';
import { RootStackParamList } from '../types';
import { COLORS, SPACING, BORDER_RADIUS, SHADOWS, TYPOGRAPHY } from '../theme';

type AdminDashboardScreenNavigationProp = StackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface DashboardStats {
  totalProducts: number;
  totalFarmers: number;
  totalOrders: number;
  totalRevenue: number;
  pendingVerifications: number;
  activeRiders: number;
  totalRiders: number;
}

interface Order {
  id: string;
  _id?: string;
  customer_name?: string;
  total: number;
  total_amount?: number;
  status: string;
  created_at: string;
  delivery_proof_url?: string;
}

interface ReportKPIs {
  total_revenue?: number;
  completed_orders?: number;
  cancelled_orders?: number;
  avg_order_value?: number;
  assumed_margin_pct?: number;
  revenue_growth_pct?: number;
}

interface ReportData {
  kpis?: ReportKPIs;
  revenue_timeline?: { date: string; revenue: number; orders: number }[];
  order_status?: { status: string; count: number }[];
  top_products?: { name: string; revenue: number; quantity_sold: number }[];
  top_farmers?: { name: string; revenue: number }[];
  payment_breakdown?: { method: string; revenue: number; count: number }[];
}

const AdminDashboardScreen: React.FC = () => {
  const navigation = useNavigation<AdminDashboardScreenNavigationProp>();
  const { user } = useAuth();

  const [stats, setStats] = useState<DashboardStats>({
    totalProducts: 0,
    totalFarmers: 0,
    totalOrders: 0,
    totalRevenue: 0,
    pendingVerifications: 0,
    activeRiders: 0,
    totalRiders: 0,
  });
  const [reports, setReports] = useState<ReportData | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'manage'>('overview');
  const [reportDays, setReportDays] = useState(30);

  const loadDashboardData = useCallback(async () => {
    try {
      const [productsRes, farmersRes, ordersRes, verificationsRes, reportsRes] =
        await Promise.allSettled([
          adminAPI.getProducts(),
          adminAPI.getFarmers(),
          adminAPI.getOrders(),
          adminAPI.getVerifications(),
          adminAPI.getReports(reportDays),
        ]);

      let totalProducts = 0,
        totalFarmers = 0,
        totalOrders = 0,
        totalRevenue = 0,
        pendingVerifications = 0;
      let orders: Order[] = [];

      if (productsRes.status === 'fulfilled') {
        totalProducts = (productsRes.value.data.products || []).length;
      }
      if (farmersRes.status === 'fulfilled') {
        totalFarmers = (farmersRes.value.data.farmers || []).length;
      }
      if (ordersRes.status === 'fulfilled') {
        orders = ordersRes.value.data.orders || [];
        totalOrders = orders.length;
        totalRevenue = orders.reduce(
          (sum: number, o: any) =>
            sum + (parseFloat(o.total) || parseFloat(o.total_amount) || 0),
          0
        );
      }
      if (verificationsRes.status === 'fulfilled' && verificationsRes.value.data.stats) {
        const vStats = verificationsRes.value.data.stats;
        pendingVerifications = Math.max(
          0,
          (vStats.total || 0) - (vStats.verified || 0) - (vStats.rejected || 0)
        );
      }
      if (reportsRes.status === 'fulfilled') {
        setReports(reportsRes.value.data);
      }

      setStats({
        totalProducts,
        totalFarmers,
        totalOrders,
        totalRevenue,
        pendingVerifications,
        activeRiders: 0,
        totalRiders: 0,
      });

      setRecentOrders(orders.slice(0, 6));
    } catch (error) {
      if (__DEV__) console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [reportDays]);

  useEffect(() => {
    if (user?.is_admin) {
      loadDashboardData();
    }
  }, [user, loadDashboardData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboardData();
  };

  const formatCurrency = (value: number) =>
    '\u20B1' +
    Number(value || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: '#FF9800',
      confirmed: '#2196F3',
      preparing: '#9C27B0',
      ready: '#00BCD4',
      completed: '#4CAF50',
      delivered: '#2E7D32',
      cancelled: '#F44336',
    };
    return colors[status?.toLowerCase()] || '#9E9E9E';
  };

  const formatStatus = (status?: string) => {
    return (status || 'pending')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Derived KPIs from reports
  const kpis = reports?.kpis || {};
  const marginPct = kpis.assumed_margin_pct ?? 15;
  const revenueForCalc =
    kpis.total_revenue !== undefined && kpis.total_revenue !== null
      ? kpis.total_revenue
      : stats.totalRevenue;
  const estimatedProfit = Number(revenueForCalc) * (Number(marginPct) / 100);
  const completedOrders = kpis.completed_orders || 0;
  const cancelledOrders = kpis.cancelled_orders || 0;
  const completionRate =
    stats.totalOrders > 0
      ? ((completedOrders / stats.totalOrders) * 100).toFixed(1)
      : '0.0';
  const inProgressOrders = Math.max(0, stats.totalOrders - completedOrders - cancelledOrders);

  // Top products and farmers from reports
  const topProducts = reports?.top_products || [];
  const topFarmers = reports?.top_farmers || [];
  const orderStatusData = reports?.order_status || [];

  if (!user?.is_admin) {
    return (
      <View style={styles.accessDenied}>
        <View style={styles.accessDeniedIcon}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textLight} />
        </View>
        <Text style={styles.accessDeniedTitle}>Access Denied</Text>
        <Text style={styles.accessDeniedText}>
          You don't have permission to access this page.
        </Text>
        <TouchableOpacity
          style={styles.goBackButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.goBackButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  const managementItems = [
    {
      title: 'Permit Verifications',
      subtitle: `${stats.pendingVerifications} pending`,
      icon: 'shield-checkmark',
      iconColor: '#4CAF50',
      bgColor: '#E8F5E9',
      screen: 'VerificationDashboard',
    },
    {
      title: 'User Management',
      subtitle: 'Manage all users',
      icon: 'people',
      iconColor: '#1565C0',
      bgColor: '#E3F2FD',
      screen: 'AdminUsers',
    },
    {
      title: 'Browse Products',
      subtitle: `${stats.totalProducts} products`,
      icon: 'cube',
      iconColor: '#E65100',
      bgColor: '#FFF3E0',
      screen: 'MainTabs',
      params: { screen: 'Products' },
    },
    {
      title: 'Manage Riders',
      subtitle: 'Delivery fleet',
      icon: 'bicycle',
      iconColor: '#00897B',
      bgColor: '#E0F2F1',
      screen: 'AdminRiders',
    },
    {
      title: 'DTI Price Management',
      subtitle: 'SRP Engine',
      icon: 'pricetags',
      iconColor: '#5E35B1',
      bgColor: '#EDE7F6',
      screen: 'DTIPriceManagement',
    },
    {
      title: 'Price Trends & Forecast',
      subtitle: 'Prediction analytics',
      icon: 'trending-up',
      iconColor: '#0288D1',
      bgColor: '#E1F5FE',
      screen: 'PriceTrends',
    },
    {
      title: 'Vendors Marketplace',
      subtitle: 'Co-vendor products',
      icon: 'storefront',
      iconColor: '#1565C0',
      bgColor: '#E3F2FD',
      screen: 'CoVendorsMarketplace',
    },
    {
      title: 'Customer Reviews',
      subtitle: 'Moderate reviews',
      icon: 'star',
      iconColor: '#F9A825',
      bgColor: '#FFFDE7',
      screen: 'AdminReviews',
    },
    {
      title: 'Printable Reports',
      subtitle: 'PDF export',
      icon: 'document-text',
      iconColor: '#C2185B',
      bgColor: '#FCE4EC',
      screen: 'AdminPrintableReports',
    },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.welcomeText}>Admin Dashboard</Text>
            <Text style={styles.dateText}>
              {new Date().toLocaleDateString('en-PH', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
            <Ionicons name="refresh" size={22} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        {([
          { key: 'overview' as const, label: 'Overview', icon: 'analytics' },
          { key: 'manage' as const, label: 'Management', icon: 'settings' },
        ]).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={18}
              color={activeTab === tab.key ? COLORS.primary : COLORS.textLight}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ========== OVERVIEW TAB ========== */}
      {activeTab === 'overview' && (
        <View style={styles.content}>
          {/* KPI Stats Grid */}
          <View style={styles.kpiGrid}>
            {/* Revenue */}
            <View style={[styles.kpiCard, styles.kpiCardWide]}>
              <View style={[styles.kpiIcon, { backgroundColor: '#047857' }]}>
                <Ionicons name="cash" size={22} color="#fff" />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{formatCurrency(stats.totalRevenue)}</Text>
                <Text style={styles.kpiLabel}>Total Revenue</Text>
                {kpis.revenue_growth_pct !== undefined && kpis.revenue_growth_pct !== 0 && (
                  <View style={styles.trendRow}>
                    <Ionicons
                      name={kpis.revenue_growth_pct > 0 ? 'arrow-up' : 'arrow-down'}
                      size={12}
                      color={kpis.revenue_growth_pct > 0 ? '#16a34a' : '#dc2626'}
                    />
                    <Text
                      style={[
                        styles.trendText,
                        { color: kpis.revenue_growth_pct > 0 ? '#16a34a' : '#dc2626' },
                      ]}
                    >
                      {Math.abs(kpis.revenue_growth_pct)}% vs prev period
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Estimated Profit */}
            <View style={[styles.kpiCard, styles.kpiCardWide]}>
              <View style={[styles.kpiIcon, { backgroundColor: '#d97706' }]}>
                <Ionicons name="wallet" size={22} color="#fff" />
              </View>
              <View style={styles.kpiInfo}>
                <Text style={styles.kpiValue}>{formatCurrency(estimatedProfit)}</Text>
                <Text style={styles.kpiLabel}>Est. Profit</Text>
                <Text style={styles.kpiSub}>Margin: {marginPct}%</Text>
              </View>
            </View>

            {/* Total Orders */}
            <View style={styles.kpiCard}>
              <View style={[styles.kpiIcon, { backgroundColor: '#c2410c' }]}>
                <Ionicons name="receipt" size={20} color="#fff" />
              </View>
              <Text style={styles.kpiValue}>{stats.totalOrders}</Text>
              <Text style={styles.kpiLabel}>Orders</Text>
              <Text style={styles.kpiSub}>
                Avg: {formatCurrency(kpis.avg_order_value || 0)}
              </Text>
            </View>

            {/* Completed */}
            <View style={styles.kpiCard}>
              <View style={[styles.kpiIcon, { backgroundColor: '#16a34a' }]}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
              </View>
              <Text style={styles.kpiValue}>{completedOrders}</Text>
              <Text style={styles.kpiLabel}>Completed</Text>
              <Text style={styles.kpiSub}>{cancelledOrders} cancelled</Text>
            </View>

            {/* Completion Rate */}
            <View style={styles.kpiCard}>
              <View style={[styles.kpiIcon, { backgroundColor: '#7c3aed' }]}>
                <Ionicons name="speedometer" size={20} color="#fff" />
              </View>
              <Text style={styles.kpiValue}>{completionRate}%</Text>
              <Text style={styles.kpiLabel}>Completion</Text>
              <Text style={styles.kpiSub}>{inProgressOrders} in progress</Text>
            </View>

            {/* Farmers */}
            <View style={styles.kpiCard}>
              <View style={[styles.kpiIcon, { backgroundColor: '#6d28d9' }]}>
                <Ionicons name="people" size={20} color="#fff" />
              </View>
              <Text style={styles.kpiValue}>{stats.totalFarmers}</Text>
              <Text style={styles.kpiLabel}>Farmers</Text>
              <Text style={styles.kpiSub}>{stats.totalProducts} products</Text>
            </View>
          </View>

          {/* Pending Verifications Alert */}
          {stats.pendingVerifications > 0 && (
            <TouchableOpacity
              style={styles.alertCard}
              onPress={() => navigation.navigate('VerificationDashboard')}
              activeOpacity={0.8}
            >
              <View style={styles.alertIconContainer}>
                <Ionicons name="alert-circle" size={28} color="#FF9800" />
              </View>
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle}>Pending Verifications</Text>
                <Text style={styles.alertText}>
                  {stats.pendingVerifications} farmer
                  {stats.pendingVerifications > 1 ? 's' : ''} waiting for review
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FF9800" />
            </TouchableOpacity>
          )}

          {/* Period Selector */}
          <View style={styles.periodContainer}>
            <Text style={styles.periodLabel}>Report Period:</Text>
            <View style={styles.periodButtons}>
              {[7, 14, 30, 60, 90].map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.periodButton,
                    reportDays === d && styles.periodButtonActive,
                  ]}
                  onPress={() => setReportDays(d)}
                >
                  <Text
                    style={[
                      styles.periodButtonText,
                      reportDays === d && styles.periodButtonTextActive,
                    ]}
                  >
                    {d}d
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Order Status Breakdown */}
          {orderStatusData.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Order Status Breakdown</Text>
              {orderStatusData.map((item, idx) => {
                const total = orderStatusData.reduce((s, r) => s + (r.count || 0), 0);
                const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0';
                return (
                  <View key={idx} style={styles.statusRow}>
                    <View style={styles.statusLeft}>
                      <View
                        style={[
                          styles.statusDot,
                          { backgroundColor: getStatusColor(item.status) },
                        ]}
                      />
                      <Text style={styles.statusLabel}>
                        {formatStatus(item.status)}
                      </Text>
                    </View>
                    <View style={styles.statusRight}>
                      <View style={styles.statusBarBg}>
                        <View
                          style={[
                            styles.statusBarFill,
                            {
                              width: `${pct}%`,
                              backgroundColor: getStatusColor(item.status),
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.statusCount}>
                        {item.count} ({pct}%)
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Top Products */}
          {topProducts.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Products by Revenue</Text>
              {topProducts.slice(0, 5).map((product, idx) => (
                <View key={idx} style={styles.rankRow}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankNumber}>
                      {idx === 0 ? '\uD83E\uDD47' : idx === 1 ? '\uD83E\uDD48' : idx === 2 ? '\uD83E\uDD49' : `${idx + 1}`}
                    </Text>
                  </View>
                  <View style={styles.rankInfo}>
                    <Text style={styles.rankName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={styles.rankSub}>
                      {product.quantity_sold} units sold
                    </Text>
                  </View>
                  <Text style={styles.rankValue}>
                    {formatCurrency(product.revenue)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Top Farmers */}
          {topFarmers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Farmers by Revenue</Text>
              {topFarmers.slice(0, 5).map((farmer, idx) => {
                const totalFarmerRev = topFarmers.reduce(
                  (s, f) => s + (f.revenue || 0),
                  0
                );
                const share =
                  totalFarmerRev > 0
                    ? ((farmer.revenue / totalFarmerRev) * 100).toFixed(1)
                    : '0';
                return (
                  <View key={idx} style={styles.rankRow}>
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankNumber}>
                        {idx === 0
                          ? '\uD83E\uDD47'
                          : idx === 1
                          ? '\uD83E\uDD48'
                          : idx === 2
                          ? '\uD83E\uDD49'
                          : `${idx + 1}`}
                      </Text>
                    </View>
                    <View style={styles.rankInfo}>
                      <Text style={styles.rankName} numberOfLines={1}>
                        {farmer.name}
                      </Text>
                      <Text style={styles.rankSub}>{share}% of total</Text>
                    </View>
                    <Text style={styles.rankValue}>
                      {formatCurrency(farmer.revenue)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Recent Orders */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recent Orders</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Orders' as any)}
              >
                <Text style={styles.viewAllText}>View All</Text>
              </TouchableOpacity>
            </View>

            {recentOrders.length > 0 ? (
              recentOrders.map((order, index) => (
                <View key={order.id || order._id || index} style={styles.orderRow}>
                  <View style={styles.orderLeft}>
                    <Text style={styles.orderId}>
                      #{(order.id || order._id || '').toString().substring(0, 6).toUpperCase()}
                    </Text>
                    <Text style={styles.orderDate}>
                      {order.created_at
                        ? new Date(order.created_at).toLocaleDateString('en-PH', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'N/A'}
                    </Text>
                    {order.delivery_proof_url && (
                      <TouchableOpacity
                        onPress={() =>
                          Linking.openURL(order.delivery_proof_url || '')
                        }
                      >
                        <Text style={styles.proofLink}>View Proof</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.orderRight}>
                    <Text style={styles.orderAmount}>
                      {formatCurrency(
                        parseFloat(String(order.total)) ||
                          parseFloat(String(order.total_amount)) ||
                          0
                      )}
                    </Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            getStatusColor(order.status) + '20',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          { color: getStatusColor(order.status) },
                        ]}
                      >
                        {formatStatus(order.status)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={40} color={COLORS.textLight} />
                <Text style={styles.emptyStateText}>No recent orders</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ========== MANAGEMENT TAB ========== */}
      {activeTab === 'manage' && (
        <View style={styles.content}>
          <Text style={styles.manageSectionTitle}>Management Tools</Text>
          <Text style={styles.manageSectionSubtitle}>
            Access all admin features and system tools
          </Text>

          {managementItems.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.manageCard}
              activeOpacity={0.7}
              onPress={() => {
                if (item.params) {
                  navigation.navigate(item.screen as any, item.params as any);
                } else {
                  navigation.navigate(item.screen as any);
                }
              }}
            >
              <View
                style={[styles.manageIcon, { backgroundColor: item.bgColor }]}
              >
                <Ionicons
                  name={item.icon as any}
                  size={24}
                  color={item.iconColor}
                />
              </View>
              <View style={styles.manageInfo}>
                <Text style={styles.manageTitle}>{item.title}</Text>
                <Text style={styles.manageSubtitle}>{item.subtitle}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.textLight}
              />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: SPACING.m,
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },

  // Access Denied
  accessDenied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
    backgroundColor: COLORS.background,
  },
  accessDeniedIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.m,
  },
  accessDeniedTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginBottom: SPACING.s,
  },
  accessDeniedText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.l,
  },
  goBackButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.m,
    borderRadius: BORDER_RADIUS.l,
    ...SHADOWS.soft,
  },
  goBackButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 16,
  },

  // Header
  header: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.l,
    paddingTop: SPACING.l,
    paddingBottom: SPACING.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...SHADOWS.medium,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.white,
  },
  dateText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: SPACING.m,
    marginTop: -SPACING.m,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: 4,
    ...SHADOWS.soft,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.s + 2,
    borderRadius: BORDER_RADIUS.m,
    gap: 6,
  },
  tabActive: {
    backgroundColor: COLORS.primaryPale,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textLight,
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },

  content: {
    padding: SPACING.m,
  },

  // KPI Grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: SPACING.m,
  },
  kpiCardWide: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.m,
  },
  kpiCard: {
    width: (SCREEN_WIDTH - SPACING.m * 2 - 10) / 2 - 0.5,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.m,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.soft,
  },
  kpiIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  kpiInfo: {
    flex: 1,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  kpiSub: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 3,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Alert Card
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    padding: SPACING.m,
    borderRadius: BORDER_RADIUS.l,
    marginBottom: SPACING.m,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
    ...SHADOWS.soft,
  },
  alertIconContainer: {
    marginRight: SPACING.s,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E65100',
  },
  alertText: {
    fontSize: 12,
    color: '#F57C00',
    marginTop: 2,
  },

  // Period Selector
  periodContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.m,
    backgroundColor: COLORS.surface,
    padding: SPACING.s,
    borderRadius: BORDER_RADIUS.m,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginRight: SPACING.s,
    marginLeft: SPACING.xs,
  },
  periodButtons: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  periodButton: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.s,
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  periodButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  periodButtonTextActive: {
    color: COLORS.white,
  },

  // Cards
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.m,
    marginBottom: SPACING.m,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.soft,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.m,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.s,
  },
  viewAllText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Status Rows
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 110,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
  },
  statusRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statusBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  statusCount: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
    width: 70,
    textAlign: 'right',
  },

  // Rank Rows (products & farmers)
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.s,
  },
  rankNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  rankInfo: {
    flex: 1,
  },
  rankName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  rankSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  rankValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Order Rows
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  orderLeft: {
    flex: 1,
  },
  orderId: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  orderDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  proofLink: {
    fontSize: 11,
    color: COLORS.primary,
    marginTop: 3,
    textDecorationLine: 'underline',
  },
  orderRight: {
    alignItems: 'flex-end',
  },
  orderAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.round,
    marginTop: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyStateText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: SPACING.s,
  },

  // Management Tab
  manageSectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 4,
  },
  manageSectionSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: SPACING.l,
  },
  manageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.m,
    borderRadius: BORDER_RADIUS.l,
    marginBottom: SPACING.s,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.soft,
  },
  manageIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.m,
  },
  manageInfo: {
    flex: 1,
  },
  manageTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  manageSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});

export default AdminDashboardScreen;
