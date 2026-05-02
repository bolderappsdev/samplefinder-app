import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Platform,
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { Monicon } from '@monicon/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PointsBadge from './PointsBadge';

interface CheckInSuccessProps {
  onLeaveReview?: () => void;
  pointsEarned?: number;
  showReviewButton?: boolean;
  discount?: string | null; // Discount text/description
  discountImageURL?: string | null;
}

const CheckInSuccess: React.FC<CheckInSuccessProps> = ({
  onLeaveReview,
  pointsEarned = 10,
  showReviewButton = true,
  discount,
  discountImageURL,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [barcodeFullscreenVisible, setBarcodeFullscreenVisible] = useState(false);

  const fullscreenBarcodeSize = {
    width: windowWidth - 32,
    // RN network Images need explicit width + height; maxHeight-only layouts often render empty.
    height: windowHeight * 0.55,
  };

  const hasDiscountText = discount != null && discount.trim() !== '';
  const hasDiscountImage = Boolean(discountImageURL && discountImageURL.trim() !== '');
  const hasDiscount = hasDiscountText || hasDiscountImage;

  return (
    <View style={styles.container}>
      {/* Barcode/Discount Section - only show if discount exists */}
      {hasDiscount && (
        <View style={styles.barcodeSection}>
          <View style={styles.barcodeRow}>
            {hasDiscountText && (
              <Text style={styles.barcodeText}>
                {discount}
              </Text>
            )}
            {hasDiscountImage && (
              <TouchableOpacity
                style={styles.barcodeContainer}
                onPress={() => setBarcodeFullscreenVisible(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="View barcode full screen"
              >
                <Image
                  source={{ uri: discountImageURL as string }}
                  style={styles.discountImage}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {hasDiscountImage ? (
        <Modal
          visible={barcodeFullscreenVisible}
          animationType="fade"
          presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
          onRequestClose={() => setBarcodeFullscreenVisible(false)}
        >
          <View style={styles.barcodeModalRoot}>
            <View style={[styles.barcodeModalHeader, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
              <Pressable
                onPress={() => setBarcodeFullscreenVisible(false)}
                style={styles.barcodeModalClose}
                accessibilityRole="button"
                accessibilityLabel="Close barcode"
              >
                <Monicon name="mdi:close" size={28} color={Colors.blueColorMode} />
              </Pressable>
            </View>
            <View style={styles.barcodeModalBodyWrap}>
              <TouchableOpacity
                style={[StyleSheet.absoluteFillObject, styles.barcodeModalDismissHit]}
                activeOpacity={1}
                onPress={() => setBarcodeFullscreenVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss barcode"
              />
              <View
                pointerEvents="box-none"
                style={styles.barcodeModalImageLayer}
              >
                <Image
                  source={{ uri: discountImageURL as string }}
                  style={fullscreenBarcodeSize}
                  resizeMode="contain"
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Points Earned Badge */}
      <PointsBadge points={pointsEarned} />

      {/* Leave A Review Button */}
      {showReviewButton && onLeaveReview && (
        <TouchableOpacity
          style={styles.reviewButton}
          onPress={onLeaveReview}
          activeOpacity={0.7}
        >
          <Text style={styles.reviewButtonText}>Leave A Review</Text>
          <View style={styles.starsContainer}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Monicon
                key={i}
                name="mdi:star-outline"
                size={18}
                color={Colors.white}
              />
            ))}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  barcodeSection: {
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    width: '100%',
  },
  barcodeText: {
    fontSize: 18,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    lineHeight: 24,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  barcodeContainer: {
    alignItems: 'center',
    flexShrink: 0,
  },
  discountImage: {
    width: 168,
    height: 68,
    backgroundColor: Colors.white,
  },
  barcodeModalRoot: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  barcodeModalHeader: {
    paddingHorizontal: 16,
    alignItems: 'flex-end',
  },
  barcodeModalClose: {
    padding: 8,
  },
  barcodeModalBodyWrap: {
    flex: 1,
    position: 'relative',
  },
  barcodeModalDismissHit: {
    zIndex: 0,
  },
  barcodeModalImageLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 1,
  },
  reviewButton: {
    backgroundColor: Colors.blueColorMode,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
    marginHorizontal: 20,
  },
  reviewButtonText: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.white,
    marginBottom: 6,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
});

export default CheckInSuccess;

