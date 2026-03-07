/**
 * CachedImage — drop-in replacement for <Image> that uses expo-image
 * for automatic disk + memory caching of remote images.
 *
 * Usage:
 *   import { CachedImage } from '../components/CachedImage';
 *   <CachedImage source={{ uri: url }} style={styles.img} />
 */
import React from 'react';
import { Image, ImageProps } from 'expo-image';
import { StyleProp, ImageStyle } from 'react-native';

// expo-image uses "contentFit" instead of "resizeMode"
type ContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

interface CachedImageProps extends Omit<ImageProps, 'contentFit'> {
  /** Maps to expo-image's contentFit. Defaults to 'cover'. */
  resizeMode?: ContentFit;
  style?: StyleProp<ImageStyle>;
}

const blurhashDefault = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export const CachedImage: React.FC<CachedImageProps> = ({
  resizeMode = 'cover',
  placeholder,
  transition,
  ...rest
}) => {
  return (
    <Image
      contentFit={resizeMode}
      placeholder={placeholder ?? { blurhash: blurhashDefault }}
      transition={transition ?? { duration: 200 }}
      cachePolicy="memory-disk"
      {...rest}
    />
  );
};

export default CachedImage;
