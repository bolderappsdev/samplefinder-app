import React, { useRef, useState } from 'react';
import {
  ScrollView,
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ActionButtons,
  BrandInfo,
  BrandLocationPin,
  DiscountMessage,
  EventInfoSection,
  ProductsSection,
  CheckInCodeInput,
  CheckInSuccess,
} from './components';
import BackShareHeader from '@/components/wrappers/BackShareHeader';
import ReviewModal from '@/components/shared/ReviewModal';
import PointsEarnedModal from '@/components/shared/PointsEarnedModal';
import BadgeEarnedModal from '@/components/shared/BadgeEarnedModal';
import ConfirmationModal from '@/components/shared/ConfirmationModal';
import { useBrandDetailsScreen, BrandDetailsData } from './useBrandDetailsScreen';
import styles from './styles';

export type { BrandDetailsData };

interface BrandDetailsScreenProps {
  route: {
    params: { eventId?: string; brand?: BrandDetailsData; fromFavorites?: boolean; fromNotifications?: boolean };
  };
}

const BrandDetailsScreen: React.FC<BrandDetailsScreenProps> = ({ route }) => {
  const contentRef = useRef<View>(null);
  const shareContentRef = useRef<View>(null);
  const [isShareMode, setIsShareMode] = useState(false);
  const {
    brand,
    isLoading,
    error,
    unavailableReason,
    checkInStatus,
    brandLogoUrl,
    isFavorite,
    isAddedToCalendar,
    reviewBottomSheetRef,
    isSubmittingCheckIn,
    isSubmittingReview,
    pointsModalVisible,
    pointsModalTitle,
    pointsModalAmount,
    hasReviewed,
    checkInPoints,
    totalEarnedPoints,
    badgeModalVisible,
    badgeType,
    badgeNumber,
    badgeAchievementCount,
    handleBack,
    handleShare,
    handleAddToCalendar,
    handleAddFavorite,
    unfavoriteConfirmVisible,
    handleConfirmUnfavorite,
    handleCancelUnfavorite,
    isUnfavoriting,
    handleCodeSubmit,
    handleLeaveReview,
    handleCloseReviewModal,
    handleSubmitReview,
    handleClosePointsModal,
    handleViewRewards,
    handleCloseBadgeModal,
    handleShareBadge,
    isRefreshing,
    handleRefreshDetails,
  } = useBrandDetailsScreen({ route, contentRef, shareContentRef });

  const handleShareWithShareMode = async () => {
    setIsShareMode(true);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    try {
      await handleShare();
    } finally {
      setIsShareMode(false);
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <View ref={contentRef} style={styles.container} collapsable={false}>
        <StatusBar style="light" />
        <BackShareHeader onBack={handleBack} onShare={handleShareWithShareMode} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2D1B69" />
          <Text style={styles.loadingText}>Loading event details...</Text>
        </View>
      </View>
    );
  }

  /*
    Event taken down, not a failure.
    Reached by a link that outlived its event: a pop-up banner or a push notification whose
    event was archived, hidden or deleted afterwards. This used to fall into the error branch
    below and read "Event not found / Please try again later" — a retry prompt for something
    no retry can fix, which looked like the app had broken. Say what happened and offer the
    one action that helps.
  */
  if (unavailableReason) {
    const isMissing = unavailableReason === 'missing';
    // handleBack returns to Favorites or Notifications when the user came from there;
    // otherwise it pops to the Home stack, which is the event list.
    const backToList = !route.params.fromFavorites && !route.params.fromNotifications;
    return (
      <View ref={contentRef} style={styles.container} collapsable={false}>
        <StatusBar style="light" />
        <BackShareHeader onBack={handleBack} onShare={handleShareWithShareMode} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>This event is no longer available</Text>
          <Text style={styles.errorSubtext}>
            {isMissing
              ? 'It looks like this event has been removed. Have a look at what else is on.'
              : "It has finished or been taken down, so there's nothing to show here anymore."}
          </Text>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={handleBack}
            accessibilityRole="button"
          >
            <Text style={styles.errorButtonText}>
              {backToList ? 'Browse Events' : 'Go Back'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show error state
  if (error || !brand) {
    return (
      <View ref={contentRef} style={styles.container} collapsable={false}>
        <StatusBar style="light" />
        <BackShareHeader onBack={handleBack} onShare={handleShareWithShareMode} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            {error || 'Event details not available'}
          </Text>
          <Text style={styles.errorSubtext}>
            Please try again later or go back to browse other events.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View ref={contentRef} style={styles.container} collapsable={false}>
      <StatusBar style="light" />
      <BackShareHeader onBack={handleBack} onShare={handleShareWithShareMode}  />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios'}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          refreshControl={
            route.params.eventId ? (
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefreshDetails}
                tintColor="#2D1B69"
              />
            ) : undefined
          }
        >
          {/* Wrapper for sharing full content (not just visible viewport) */}
          <View
            ref={shareContentRef}
            collapsable={false}
            style={{ backgroundColor: '#FFFFFF', paddingVertical: 12 }}
          >
            <BrandLocationPin logoUrl={brandLogoUrl} />
            <BrandInfo brand={brand} />
            <ProductsSection products={brand.products} />
            <EventInfoSection eventInfo={brand.eventInfo} />

            {!isShareMode && checkInStatus !== 'success' && (
              <DiscountMessage
                discount={brand.discount}
                discountImageURL={brand.discountImageURL}
              />
            )}

            {!isShareMode && (checkInStatus === 'input' || checkInStatus === 'incorrect') && (
              <CheckInCodeInput
                onCodeSubmit={handleCodeSubmit}
                showError={checkInStatus === 'incorrect'}
                isSubmitting={isSubmittingCheckIn}
              />
            )}

            {!isShareMode && checkInStatus === 'success' && (
              <CheckInSuccess
                onLeaveReview={handleLeaveReview}
                pointsEarned={totalEarnedPoints}
                showReviewButton={!hasReviewed}
                discount={brand?.discount}
                discountImageURL={brand?.discountImageURL}
              />
            )}

            {!isShareMode && (
              <ActionButtons
                onAddToCalendar={handleAddToCalendar}
                onAddFavorite={handleAddFavorite}
                isFavorite={isFavorite}
                isAddedToCalendar={isAddedToCalendar}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ReviewModal
        bottomSheetRef={reviewBottomSheetRef}
        eventName={brand?.storeName}
        brandName={brand?.brandName}
        isSubmitting={isSubmittingReview}
        onClose={handleCloseReviewModal}
        onSubmit={handleSubmitReview}
      />

      <PointsEarnedModal
        visible={pointsModalVisible}
        points={pointsModalAmount}
        title={pointsModalTitle}
        onClose={handleClosePointsModal}
        onViewRewards={handleViewRewards}
      />

      <BadgeEarnedModal
        visible={badgeModalVisible}
        badgeType={badgeType}
        badgeNumber={badgeNumber}
        achievementCount={badgeAchievementCount}
        onClose={handleCloseBadgeModal}
        onShare={handleShareBadge}
      />

      <ConfirmationModal
        visible={unfavoriteConfirmVisible}
        title="Remove from favorites?"
        description={
          brand
            ? `Are you sure you want to unfavorite ${brand.brandName}? You can add this brand back anytime.`
            : ''
        }
        confirmText="Yes, Unfavorite"
        cancelText="Cancel"
        onConfirm={handleConfirmUnfavorite}
        onCancel={handleCancelUnfavorite}
        isLoading={isUnfavoriting}
        loadingText="Updating..."
      />
    </View>
  );
};

export default BrandDetailsScreen;

