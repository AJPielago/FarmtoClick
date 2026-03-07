import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions, ViewStyle } from 'react-native';
import { COLORS, BORDER_RADIUS, SPACING } from '../theme';

const { width } = Dimensions.get('window');

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * A single shimmer block that pulses to indicate loading.
 */
export const SkeletonBlock: React.FC<SkeletonProps> = ({
  width: w = '100%',
  height: h = 20,
  borderRadius = 8,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width: w as any, height: h, borderRadius, backgroundColor: '#E0E0E0', opacity },
        style,
      ]}
    />
  );
};

/**
 * Skeleton placeholder for a product card in a 2-column grid.
 */
export const ProductCardSkeleton: React.FC = () => (
  <View style={styles.productCard}>
    <SkeletonBlock height={140} borderRadius={BORDER_RADIUS.m} />
    <View style={styles.productInfo}>
      <SkeletonBlock width="75%" height={14} style={{ marginBottom: 6 }} />
      <SkeletonBlock width="50%" height={12} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="40%" height={16} />
    </View>
  </View>
);

/**
 * Skeleton for a horizontal list item (order card, etc.)
 */
export const ListItemSkeleton: React.FC = () => (
  <View style={styles.listItem}>
    <SkeletonBlock width={70} height={70} borderRadius={BORDER_RADIUS.m} />
    <View style={styles.listItemInfo}>
      <SkeletonBlock width="70%" height={14} style={{ marginBottom: 6 }} />
      <SkeletonBlock width="50%" height={12} style={{ marginBottom: 6 }} />
      <SkeletonBlock width="30%" height={12} />
    </View>
  </View>
);

/**
 * Full-screen skeleton for product grids (shows 4 cards).
 */
export const ProductGridSkeleton: React.FC = () => (
  <View style={styles.grid}>
    {[1, 2, 3, 4].map((i) => (
      <ProductCardSkeleton key={i} />
    ))}
  </View>
);

/**
 * Full-screen skeleton for list-based screens (shows 4 items).
 */
export const ListSkeleton: React.FC = () => (
  <View style={styles.listContainer}>
    {[1, 2, 3, 4].map((i) => (
      <ListItemSkeleton key={i} />
    ))}
  </View>
);

/**
 * Home screen skeleton with header area + cards.
 */
export const HomeScreenSkeleton: React.FC = () => (
  <View style={styles.homeContainer}>
    {/* Header skeleton */}
    <View style={styles.homeHeader}>
      <SkeletonBlock width="40%" height={16} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="60%" height={24} />
    </View>
    {/* Categories */}
    <View style={styles.categoriesRow}>
      {[1, 2, 3, 4].map((i) => (
        <SkeletonBlock key={i} width={80} height={36} borderRadius={20} />
      ))}
    </View>
    {/* Featured products */}
    <View style={styles.featuredRow}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.featuredCard}>
          <SkeletonBlock height={130} borderRadius={BORDER_RADIUS.m} />
          <SkeletonBlock width="70%" height={14} style={{ marginTop: 8 }} />
          <SkeletonBlock width="40%" height={16} style={{ marginTop: 6 }} />
        </View>
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  productCard: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    overflow: 'hidden',
    marginBottom: SPACING.m,
    padding: 10,
  },
  productInfo: {
    paddingTop: SPACING.s,
  },
  listItem: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.l,
    padding: SPACING.m,
    marginBottom: SPACING.m,
    marginHorizontal: SPACING.m,
  },
  listItemInfo: {
    flex: 1,
    marginLeft: SPACING.m,
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.m,
    paddingTop: SPACING.m,
  },
  listContainer: {
    paddingTop: SPACING.m,
  },
  homeContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  homeHeader: {
    padding: SPACING.l,
    paddingTop: SPACING.xl + 20,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    marginBottom: SPACING.m,
    opacity: 0.5,
  },
  categoriesRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.l,
    gap: SPACING.s,
    marginBottom: SPACING.l,
  },
  featuredRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.l,
    gap: SPACING.m,
  },
  featuredCard: {
    width: width * 0.4,
    padding: 10,
  },
});
