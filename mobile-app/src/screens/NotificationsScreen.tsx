import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { notificationsAPI } from '../services/api';

const NotificationsScreen: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await notificationsAPI.getNotifications();
      setItems(res.data?.notifications || res.data || []);
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => {
    try {
      await notificationsAPI.markAsRead(id);
      setItems(prev => prev.map(i => i.id === id ? { ...i, read: true } : i));
    } catch (err) {
      if (__DEV__) console.error(err);
    }
  };

  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator size="large" color="#4CAF50" /> : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id || i._id}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.item, item.read ? { opacity: 0.6 } : {}]} onPress={() => markRead(item.id || item._id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title || item.message || 'Notification'}</Text>
                <Text style={styles.meta}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={() => <View style={styles.center}><Text>No notifications.</Text></View>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, backgroundColor: '#fff' },
  item: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f1f1' },
  title: { fontWeight: '700' },
  meta: { color: '#666', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default NotificationsScreen;
