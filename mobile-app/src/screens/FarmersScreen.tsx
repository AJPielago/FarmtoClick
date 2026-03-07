import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { farmersAPI, API_BASE_URL } from '../services/api';
import { Farmer, RootStackParamList } from '../types';

type FarmersScreenNavigationProp = StackNavigationProp<RootStackParamList>;

const FarmersScreen: React.FC = () => {
  const navigation = useNavigation<FarmersScreenNavigationProp>();
  const resolveProfileImage = (profile_picture?: string) => {
    if (!profile_picture) return null;
    if (profile_picture.startsWith('http')) return profile_picture;
    if (profile_picture.startsWith('/')) return `${API_BASE_URL}${profile_picture}`;
    return `${API_BASE_URL}/static/uploads/profiles/${profile_picture}`;
  };
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [filteredFarmers, setFilteredFarmers] = useState<Farmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'products'>('name');

  const fetchFarmers = useCallback(async () => {
    try {
      const response = await farmersAPI.getAll();
      if (__DEV__) console.log('[FarmersScreen] fetched farmers:', response.data);
      setFarmers(response.data);
      setFilteredFarmers(response.data);
    } catch (error) {
      if (__DEV__) console.error('Error fetching farmers:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFarmers();
  }, [fetchFarmers]);

  useEffect(() => {
    let filtered = [...farmers];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (farmer) =>
          (farmer.farm_name || '').toLowerCase().includes(query) ||
          (farmer.first_name || '').toLowerCase().includes(query) ||
          (farmer.last_name || '').toLowerCase().includes(query) ||
          (farmer.location || farmer.farm_location || '').toLowerCase().includes(query)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = a.farm_name || `${a.first_name || ''} ${a.last_name || ''}`.trim();
        const nameB = b.farm_name || `${b.first_name || ''} ${b.last_name || ''}`.trim();
        return nameA.localeCompare(nameB);
      } else {
        return (b.product_count || 0) - (a.product_count || 0);
      }
    });

    setFilteredFarmers(filtered);
  }, [searchQuery, sortBy, farmers]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchFarmers();
  };

  const renderFarmerCard = ({ item }: { item: Farmer }) => (
    <TouchableOpacity
      style={styles.farmerCard}
      onPress={() => navigation.navigate('FarmerProfile', { farmerId: item.id })}
    >
      <View style={styles.cardLeft}>
        {item.profile_picture ? (
          <Image
            source={{ uri: resolveProfileImage(item.profile_picture) || undefined }}
            style={styles.farmerAvatar}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {((item.first_name || '').charAt(0) || '') + ((item.last_name || '').charAt(0) || '')}
            </Text>
          </View>
        )}
      </View>
      
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.farmName} numberOfLines={1}>
            {item.farm_name || `${item.first_name}'s Farm`}
          </Text>
          {item.is_verified && (
            <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
          )}
        </View>
        
        <Text style={styles.farmerName}>
          {(item.first_name || '') + (item.last_name ? ` ${item.last_name}` : '')}
        </Text>
        
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={14} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>
            {item.location || item.farm_location || item.overall_location || 'Location not set'}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="cube-outline" size={14} color="#4CAF50" />
            <Text style={styles.statText}>
              {(item.product_count ?? (item.products ? item.products.length : 0))} Products
            </Text>
          </View>
          {item.rating && (
            <View style={styles.stat}>
              <Ionicons name="star" size={14} color="#FFC107" />
              <Text style={styles.statText}>{item.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
      </View>
      
      <Ionicons name="chevron-forward" size={22} color="#ccc" />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading farmers...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#888" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search farmers or farms..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#888"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        <Text style={styles.sortLabel}>Sort by:</Text>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'name' && styles.sortButtonActive]}
          onPress={() => setSortBy('name')}
        >
          <Ionicons
            name="text"
            size={14}
            color={sortBy === 'name' ? '#fff' : '#666'}
          />
          <Text style={[styles.sortButtonText, sortBy === 'name' && styles.sortButtonTextActive]}>
            Name
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'products' && styles.sortButtonActive]}
          onPress={() => setSortBy('products')}
        >
          <Ionicons
            name="cube"
            size={14}
            color={sortBy === 'products' ? '#fff' : '#666'}
          />
          <Text style={[styles.sortButtonText, sortBy === 'products' && styles.sortButtonTextActive]}>
            Products
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results Count */}
      <Text style={styles.resultsCount}>
        {filteredFarmers.length} {filteredFarmers.length === 1 ? 'farmer' : 'farmers'} found
      </Text>

      {/* Farmers List */}
      {filteredFarmers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={80} color="#ddd" />
          <Text style={styles.emptyTitle}>No Farmers Found</Text>
          <Text style={styles.emptyText}>
            {searchQuery
              ? 'Try a different search term'
              : 'No farmers available at the moment'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredFarmers}
          renderItem={renderFarmerCard}
          keyExtractor={(item, index) => (item.id ? String(item.id) : String(index))}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
              tintColor="#4CAF50"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
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
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  searchContainer: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingBottom: 10,
    gap: 10,
  },
  sortLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 5,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0e0e0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    gap: 5,
  },
  sortButtonActive: {
    backgroundColor: '#4CAF50',
  },
  sortButtonText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  sortButtonTextActive: {
    color: '#fff',
  },
  resultsCount: {
    paddingHorizontal: 15,
    paddingBottom: 10,
    fontSize: 14,
    color: '#888',
  },
  listContainer: {
    paddingHorizontal: 15,
    paddingBottom: 20,
  },
  farmerCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  cardLeft: {
    marginRight: 12,
  },
  farmerAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  farmName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  farmerName: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: '#666',
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 15,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
    textAlign: 'center',
  },
});

export default FarmersScreen;