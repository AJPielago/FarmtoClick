import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { reviewsAPI } from '../services/api';

const MAX_REVIEW_IMAGES = 3;

const STAR_FULL = 'star';
const STAR_EMPTY = 'star-outline';
const STAR_HALF = 'star-half';

interface Review {
  id: string;
  rating: number;
  comment: string;
  user_name: string;
  created_at: string;
  user_id?: string;
  images?: string[];
}

interface ProductReviewsProps {
  productId: string;
}

const ProductReviews: React.FC<ProductReviewsProps> = ({ productId }) => {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [eligibility, setEligibility] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formRating, setFormRating] = useState(5);
  const [formComment, setFormComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  // Multi-image state for review form
  const [formImages, setFormImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [formImagePreviews, setFormImagePreviews] = useState<string[]>([]);
  const [existingReviewImages, setExistingReviewImages] = useState<string[]>([]);

  const loadReviews = useCallback(async () => {
    try {
      const res = await reviewsAPI.getProductReviews(productId);
      const data = res.data;
      setReviews(data.reviews || []);
      setAverageRating(data.average_rating || 0);
      setTotalReviews(data.total || 0);
    } catch (err) {
      if (__DEV__) console.error('Failed to load reviews:', err);
    }
  }, [productId]);

  const loadEligibility = useCallback(async () => {
    if (!user) return;
    try {
      const res = await reviewsAPI.checkEligibility(productId);
      setEligibility(res.data);
    } catch {
      setEligibility(null);
    }
  }, [productId, user]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadReviews(), loadEligibility()]);
      setLoading(false);
    };
    init();
  }, [loadReviews, loadEligibility]);

  const pickReviewImages = async () => {
    const total = formImagePreviews.length;
    if (total >= MAX_REVIEW_IMAGES) {
      Alert.alert('Limit Reached', `You can upload up to ${MAX_REVIEW_IMAGES} images.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Please grant photo library permissions.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      selectionLimit: MAX_REVIEW_IMAGES - total,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length) {
      const newAssets = result.assets.slice(0, MAX_REVIEW_IMAGES - total);
      setFormImages((prev) => [...prev, ...newAssets]);
      setFormImagePreviews((prev) => [...prev, ...newAssets.map((a) => a.uri)]);
    }
  };

  const removeReviewImage = (index: number) => {
    const uri = formImagePreviews[index];
    if (existingReviewImages.includes(uri)) {
      setExistingReviewImages((prev) => prev.filter((u) => u !== uri));
    } else {
      const pickIdx = formImages.findIndex((a) => a.uri === uri);
      if (pickIdx >= 0) setFormImages((prev) => prev.filter((_, i) => i !== pickIdx));
    }
    setFormImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingReviewId(null);
    setFormRating(5);
    setFormComment('');
    setFormImages([]);
    setFormImagePreviews([]);
    setExistingReviewImages([]);
  };

  const handleSubmit = async () => {
    if (!formComment.trim()) {
      Alert.alert('Error', 'Please write a review comment.');
      return;
    }
    setSubmitting(true);
    try {
      const hasImages = formImages.length > 0 || existingReviewImages.length > 0;

      if (hasImages) {
        // Use FormData when images are present
        const fd = new FormData();
        fd.append('rating', String(formRating));
        fd.append('comment', formComment);
        if (existingReviewImages.length > 0) {
          fd.append('existing_images', existingReviewImages.join(','));
        }
        formImages.forEach((asset) => {
          const uri = asset.uri;
          const filename = uri.split('/').pop() || 'photo.jpg';
          const ext = /\.(\w+)$/.exec(filename);
          const type = ext ? `image/${ext[1]}` : 'image/jpeg';
          fd.append('images', { uri, name: filename, type } as any);
        });

        if (editingReviewId) {
          await reviewsAPI.updateReview(editingReviewId, fd, true);
          Alert.alert('Success', 'Review updated!');
        } else {
          await reviewsAPI.createReview(productId, fd, true);
          Alert.alert('Success', 'Review submitted!');
        }
      } else {
        // JSON when no images
        if (editingReviewId) {
          await reviewsAPI.updateReview(editingReviewId, { rating: formRating, comment: formComment });
          Alert.alert('Success', 'Review updated!');
        } else {
          await reviewsAPI.createReview(productId, { rating: formRating, comment: formComment });
          Alert.alert('Success', 'Review submitted!');
        }
      }
      resetForm();
      loadReviews();
      loadEligibility();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (reviewId: string) => {
    Alert.alert('Delete Review', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await reviewsAPI.deleteReview(reviewId);
            loadReviews();
            loadEligibility();
          } catch (err: any) {
            Alert.alert('Error', 'Failed to delete review');
          }
        },
      },
    ]);
  };

  const startEdit = (review: Review) => {
    setEditingReviewId(review.id);
    setFormRating(review.rating);
    setFormComment(review.comment);
    const imgs = review.images || [];
    setExistingReviewImages(imgs);
    setFormImagePreviews(imgs);
    setFormImages([]);
    setShowForm(true);
  };

  const renderStars = (rating: number, size = 16) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
        let name: any = STAR_EMPTY;
        if (rating >= i) name = STAR_FULL;
        else if (rating >= i - 0.5) name = STAR_HALF;
        
        stars.push(<Ionicons key={i} name={name} size={size} color="#f59e0b" />);
    }
    return <View style={{ flexDirection: 'row' }}>{stars}</View>;
  };

  const renderInputStars = () => {
    return (
      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity key={star} onPress={() => setFormRating(star)}>
            <Ionicons
              name={formRating >= star ? STAR_FULL : STAR_EMPTY}
              size={32}
              color="#f59e0b"
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (loading) return <ActivityIndicator size="small" color="#4CAF50" />;

  const canReview = eligibility?.can_review && !user?.is_farmer;
  const existingReview = eligibility?.existing_review;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Customer Reviews ({totalReviews})</Text>
      
      <View style={styles.summary}>
        <Text style={styles.avgRating}>{averageRating.toFixed(1)}</Text>
        {renderStars(averageRating, 24)}
      </View>

      {/* Review Form Toggle */}
      {!showForm && !existingReview && canReview && (
        <TouchableOpacity style={styles.writeButton} onPress={() => setShowForm(true)}>
          <Text style={styles.writeButtonText}>Write a Review</Text>
        </TouchableOpacity>
      )}

      {/* Existing Review Actions */}
      {!showForm && existingReview && (
          <View style={styles.yourReviewBox}>
            <Text style={{fontWeight:'bold'}}>You have reviewed this product.</Text>
            <View style={{flexDirection:'row', marginTop: 5}}>
                <TouchableOpacity onPress={() => startEdit(existingReview)} style={{marginRight:15}}>
                    <Text style={{color:'#4CAF50'}}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(existingReview.id)}>
                    <Text style={{color:'red'}}>Delete</Text>
                </TouchableOpacity>
            </View>
          </View>
      )}

      {/* Review Form */}
      {showForm && (
        <View style={styles.form}>
          <Text style={styles.formTitle}>{editingReviewId ? 'Edit Review' : 'Write Review'}</Text>
          <Text>Rating:</Text>
          {renderInputStars()}
          <TextInput
            style={styles.input}
            multiline
            numberOfLines={4}
            placeholder="Share your thoughts..."
            value={formComment}
            onChangeText={setFormComment}
          />
          {/* Image picker for reviews */}
          <View style={styles.reviewImageSection}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {formImagePreviews.map((uri, idx) => (
                <View key={`${uri}-${idx}`} style={styles.reviewThumbWrap}>
                  <Image source={{ uri }} style={styles.reviewThumb} />
                  <TouchableOpacity style={styles.reviewThumbRemove} onPress={() => removeReviewImage(idx)}>
                    <Ionicons name="close-circle" size={20} color="#FF5252" />
                  </TouchableOpacity>
                </View>
              ))}
              {formImagePreviews.length < MAX_REVIEW_IMAGES && (
                <TouchableOpacity style={styles.reviewAddImageBtn} onPress={pickReviewImages}>
                  <Ionicons name="camera" size={24} color="#4CAF50" />
                  <Text style={styles.reviewAddImageText}>Photo</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <Text style={styles.reviewImageCount}>{formImagePreviews.length}/{MAX_REVIEW_IMAGES} photos</Text>
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
                <Text style={{color: '#666'}}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[styles.submitButton, submitting && {opacity: 0.7}]}
                onPress={handleSubmit}
                disabled={submitting}
            >
                <Text style={{color: '#fff', fontWeight:'bold'}}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Reviews List */}
      {reviews.map((review) => (
        <View key={review.id} style={styles.reviewItem}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewerName}>{review.user_name || 'Anonymous'}</Text>
            <Text style={styles.reviewDate}>
              {new Date(review.created_at).toLocaleDateString()}
            </Text>
          </View>
          {renderStars(review.rating, 14)}
          <Text style={styles.reviewComment}>{review.comment}</Text>
          {review.images && review.images.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reviewImagesRow}>
              {review.images.map((img, idx) => (
                <Image key={idx} source={{ uri: img }} style={styles.reviewListImage} />
              ))}
            </ScrollView>
          )}
        </View>
      ))}

      {reviews.length === 0 && (
          <Text style={styles.noReviews}>No reviews yet.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
    marginTop: 10,
  },
  header: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avgRating: {
    fontSize: 24,
    fontWeight: 'bold',
    marginRight: 10,
    color: '#333',
  },
  writeButton: {
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  writeButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  form: {
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  formTitle: {
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    height: 100,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 5,
  },
  cancelButton: {
    padding: 10,
  },
  reviewItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 15,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  reviewerName: {
    fontWeight: 'bold',
  },
  reviewDate: {
    color: '#888',
    fontSize: 12,
  },
  reviewComment: {
    marginTop: 5,
    lineHeight: 20,
    color: '#444',
  },
  yourReviewBox: {
      marginBottom: 20,
      padding: 10,
      backgroundColor: '#f0f8ff',
      borderRadius: 5,
      borderWidth: 1,
      borderColor: '#d0e0f0'
  },
  noReviews: {
      fontStyle: 'italic',
      color: '#888',
      textAlign: 'center',
      marginTop: 20
  },
  // Multi-image review styles
  reviewImageSection: {
    marginBottom: 10,
  },
  reviewThumbWrap: {
    position: 'relative',
    marginRight: 8,
  },
  reviewThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  reviewThumbRemove: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  reviewAddImageBtn: {
    width: 70,
    height: 70,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fff9',
  },
  reviewAddImageText: {
    fontSize: 10,
    color: '#4CAF50',
    marginTop: 2,
  },
  reviewImageCount: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },
  reviewImagesRow: {
    marginTop: 8,
    flexDirection: 'row',
  },
  reviewListImage: {
    width: 60,
    height: 60,
    borderRadius: 6,
    marginRight: 6,
    backgroundColor: '#f0f0f0',
  },
});

export default ProductReviews;
