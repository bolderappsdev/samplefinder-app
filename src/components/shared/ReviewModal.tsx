import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import type { ComponentProps } from 'react';
import GradientBottomSheetBackdrop from '@/components/shared/GradientBottomSheetBackdrop';
import { Monicon } from '@monicon/native';
import { Colors } from '@/constants/Colors';
import ReviewStarFilledIcon from '@/icons/ReviewStarFilledIcon';
import ReviewStarOutlineIcon from '@/icons/ReviewStarOutlineIcon';
import CloseIcon from './CloseIcon';

// Rating descriptions
const RATING_DESCRIPTIONS: { [key: number]: string } = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Almost Perfect!',
  5: 'Perfect!',
};

// Feedback tags arranged in rows matching approved design
const FEEDBACK_TAGS_ROW_1 = ['Staff', 'Swag', 'Sample', 'Presentation','Experience', 'Professionalism', 'Other'];
// const FEEDBACK_TAGS_ROW_2 = [];

interface ReviewModalProps {
  bottomSheetRef: React.RefObject<BottomSheet | null>;
  eventName?: string;
  brandName?: string;
  isSubmitting?: boolean;
  onClose?: () => void;
  onSubmit: (reviewText: string, rating: number, tags?: string[], purchased?: boolean) => void;
}

const ReviewModal: React.FC<ReviewModalProps> = ({
  bottomSheetRef,
  isSubmitting = false,
  onClose,
  onSubmit,
}) => {
  const [rating, setRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [purchased, setPurchased] = useState<boolean | null>(null);

  const scrollViewRef = useRef<BottomSheetScrollViewMethods>(null);
  const focusScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapPoints = useMemo(() => ['90%'], []);

  const resetState = useCallback(() => {
    setRating(0);
    setReviewText('');
    setSelectedTags([]);
    setPurchased(null);
  }, []);

  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) {
        if (focusScrollTimerRef.current) {
          clearTimeout(focusScrollTimerRef.current);
          focusScrollTimerRef.current = null;
        }
        resetState();
        onClose?.();
      }
    },
    [onClose, resetState]
  );

  const handleReviewInputFocus = useCallback(() => {
    if (focusScrollTimerRef.current) {
      clearTimeout(focusScrollTimerRef.current);
    }
    // Wait for the keyboard show + Android adjustResize layout pass to settle
    // before scrolling, otherwise the scroll target is computed against the
    // pre-resize content height and the input ends up hidden again.
    focusScrollTimerRef.current = setTimeout(
      () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
        focusScrollTimerRef.current = null;
      },
      Platform.OS === 'android' ? 450 : 150
    );
  }, []);

  const renderBackdrop = useMemo(
    () => (props: ComponentProps<typeof GradientBottomSheetBackdrop>) => (
      <GradientBottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.75}
      />
    ),
    []
  );

  const handleStarPress = (starIndex: number) => {
    setRating(starIndex + 1);
  };

  const handleTagPress = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = () => {
    if (rating === 0 || isSubmitting) return;
    onSubmit(reviewText, rating, selectedTags, purchased ?? undefined);
  };

  const handleClose = () => {
    bottomSheetRef.current?.close();
  };

  const renderTagRow = (tags: string[]) => (
    <View style={styles.tagsRow}>
      {tags.map((tag) => (
        <TouchableOpacity
          key={tag}
          style={[styles.tag, selectedTags.includes(tag) && styles.tagSelected]}
          onPress={() => handleTagPress(tag)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tagText, selectedTags.includes(tag) && styles.tagTextSelected]}>
            {tag}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleSheetChanges}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      handleStyle={styles.handleContainer}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustPan"
      overDragResistanceFactor={0}
      bottomInset={0}
    >
      <BottomSheetScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <CloseIcon/>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>How Did Sampling Go?</Text>
        </View>

        {/* Star Rating */}
        <View style={styles.ratingContainer}>
          <View style={styles.starsContainer}>
            {Array.from({ length: 5 }).map((_, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => handleStarPress(index)}
                style={styles.starButton}
              >
                {index < rating ? (
                  <ReviewStarFilledIcon width={37} height={37} />
                ) : (
                  <ReviewStarOutlineIcon width={37} height={37} />
                )}
              </TouchableOpacity>
            ))}
          </View>
          {rating > 0 && (
            <Text style={styles.ratingDescription}>
              {RATING_DESCRIPTIONS[rating]}
            </Text>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* What Did You Like? */}
        <View style={styles.section}>
          <Text style={styles.sectionTitleCenter}>What Did You Like?</Text>
          <View style={styles.tagsContainer}>
            {renderTagRow(FEEDBACK_TAGS_ROW_1)}
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Did You Purchase The Product? */}
        <View style={styles.section}>
          <Text style={styles.sectionTitleCenter}>Did You Purchase The Product?</Text>
          <View style={styles.purchaseContainer}>
            <TouchableOpacity
              style={[styles.purchaseButton, purchased === true && styles.purchaseButtonSelected]}
              onPress={() => setPurchased(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.purchaseButtonText, purchased === true && styles.purchaseButtonTextSelected]}>
                Yes
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.purchaseButton, purchased === false && styles.purchaseButtonSelected]}
              onPress={() => setPurchased(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.purchaseButtonText, purchased === false && styles.purchaseButtonTextSelected]}>
                No
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Add Details */}
        <View style={[styles.section, styles.reviewInputSection]}>
          <Text style={styles.sectionTitleLeft}>Add Details:</Text>
          <BottomSheetTextInput
            style={styles.reviewInput}
            multiline
            numberOfLines={4}
            placeholder="Tell us about your experience..."
            placeholderTextColor="#999"
            value={reviewText}
            onChangeText={setReviewText}
            onFocus={handleReviewInputFocus}
            maxLength={500}
            textAlignVertical="top"
          />
        </View>
        <View style={styles.divider} />
        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, (rating === 0 || isSubmitting) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          activeOpacity={0.7}
          disabled={rating === 0 || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.submitButtonText}>Submit</Text>
          )}
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    display: 'none',
  },
  handleContainer: {
    padding: 0,
    height: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'android' ? 0 : 36,
  },
  closeButton: {
    position: 'absolute',
    top: 0,
    right: 5,
    zIndex: 10,
    padding: 4,
  },
  closeButtonCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.pinDarkBlue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
  },
  ratingContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  starButton: {
    padding: 2,
  },
  ratingDescription: {
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinDarkBlue,
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#D0D0D0',
    marginVertical: 16,
    marginHorizontal: -20,
  },
  section: {
    marginBottom: 0,
  },
  sectionTitleCenter: {
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
    marginBottom: 12,
  },
  sectionTitleLeft: {
    fontSize: 15,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
    textAlign: 'left',
    marginBottom: 12,
  },
  tagsContainer: {
    gap: 8,
 
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent:"center",
    alignItems:"center",
    gap: 8,
  },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.pinDarkBlue,
    backgroundColor: Colors.white,
  },
  tagSelected: {
    backgroundColor: Colors.pinDarkBlue,
  },
  tagText: {
    fontSize: 13,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.pinDarkBlue,
  },
  tagTextSelected: {
    color: Colors.white,
  },
  purchaseContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  purchaseButton: {
    paddingVertical: 6,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.pinDarkBlue,
    backgroundColor: Colors.white,
    minWidth: 56,
    alignItems: 'center',
  },
  purchaseButtonSelected: {
    backgroundColor: Colors.pinDarkBlue,
  },
  purchaseButtonText: {
    fontSize: 13,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.pinDarkBlue,
  },
  purchaseButtonTextSelected: {
    color: Colors.white,
  },
  reviewInputSection:{
    paddingHorizontal: 20
  },
  reviewInput: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinDarkBlue,
    minHeight: 80,
    borderWidth: 1.5,
    borderColor: Colors.pinDarkBlue,
    textAlign: 'left',
  },
  submitButton: {
    backgroundColor: Colors.blueColorMode,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 5,
    marginHorizontal:20,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 18,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.white,
    letterSpacing: 0.5,
  },
});

export default ReviewModal;
