import React, { useRef } from 'react';
import { View, ScrollView, ActivityIndicator, Text, RefreshControl } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import BottomSheet from '@gorhom/bottom-sheet';
import { Colors } from '@/constants/Colors';
import { TierBadge } from '@/components';
import BackShareHeader from '@/components/wrappers/BackShareHeader';
import ReferFriendBottomSheet from '@/components/shared/ReferFriendBottomSheet';
import ReferFriendSuccessBottomSheet from '@/components/shared/ReferFriendSuccessBottomSheet';
import ConfirmationModal from '@/components/shared/ConfirmationModal';
import { useReferralSettings } from '@/lib/useReferralSettings';
import {
  TopLinks,
  ProfileOverview,
  PointsDisplay,
  ActivityMetrics,
  RewardsProgressButton,
  PersonalInfoSection,
  NotificationsButton,
  BrandAmbassadorSection,
} from './components';
import { useProfileScreen } from './useProfileScreen';
import styles from './styles';

const ProfileScreen = () => {
  const contentRef = useRef<View>(null);
  const shareContentRef = useRef<View>(null);
  const { refereePts, referrerPts } = useReferralSettings();
  const {
    profile,
    authUser,
    statistics,
    tierStatus,
    currentTier,
    isLoading,
    isRefreshing,
    error,
    isLoggingOut,
    showLogoutModal,
    referralCode,
    referFriendBottomSheetRef,
    referFriendSuccessBottomSheetRef,
    handleBackPress,
    handleSharePress,
    handleReferFriendPress,
    handleReferFriendClose,
    handleReferSuccess,
    handleReferSuccessClose,
    handleViewRewardsFromSuccess,
    handleLogOutPress,
    handleConfirmLogout,
    handleCancelLogout,
    handleEditProfilePress,
    handleViewRewardsPress,
    handleNotificationsPress,
    handleApplyHerePress,
    handleRefresh,
    hasUnreadNotifications,
  } = useProfileScreen({ contentRef, shareContentRef });

  if (isLoading) {
    return (
      <View ref={contentRef} style={styles.container} collapsable={false}>
        <StatusBar style="light" />
        <BackShareHeader onBack={handleBackPress} onShare={handleSharePress} onNotifications={handleNotificationsPress} hasUnreadNotifications={hasUnreadNotifications} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.brandPurpleDeep} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View ref={contentRef} style={styles.container} collapsable={false}>
        <StatusBar style="light" />
        <BackShareHeader onBack={handleBackPress} onShare={handleSharePress} onNotifications={handleNotificationsPress} hasUnreadNotifications={hasUnreadNotifications} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View ref={contentRef} style={styles.container} collapsable={false}>
      <StatusBar style="light" />
      <BackShareHeader onBack={handleBackPress} onShare={handleSharePress} onNotifications={handleNotificationsPress} hasUnreadNotifications={hasUnreadNotifications} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[Colors.brandPurpleDeep]}
            tintColor={Colors.brandPurpleDeep}
          />
        }
      >
        <View
          ref={shareContentRef}
          collapsable={false}
          style={{ backgroundColor: '#FFFFFF' }}
        >
          <TopLinks
            onReferFriendPress={handleReferFriendPress}
            onLogOutPress={handleLogOutPress}
          />
          <ProfileOverview
            username={profile?.username || authUser?.name || 'User'}
            avatarUri={profile?.avatarURL || null}
            onEditProfilePress={handleEditProfilePress}
            isAmbassador={profile?.isAmbassador || false}
            isInfluencer={profile?.isInfluencer || false}
            eventCheckIns={statistics.eventCheckIns}
            samplingReviews={statistics.samplingReviews}
          />
          <PointsDisplay points={statistics.totalPoints} />
          <ActivityMetrics
            data={{
              eventCheckIns: statistics.eventCheckIns,
              samplingReviews: statistics.samplingReviews,
              badgeAchievements: statistics.badgeAchievements,
            }}
          />
          <RewardsProgressButton onPress={handleViewRewardsPress} />
          <PersonalInfoSection
            data={{
              tierStatus,
            }}
          />
          {currentTier && (
            <View
              style={styles.tierBadge}
              collapsable={false}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${currentTier.name} tier badge`}
            >
              <TierBadge tier={currentTier} />
            </View>
          )}
          <BrandAmbassadorSection
            onApplyHerePress={handleApplyHerePress}
            isAmbassador={profile?.isAmbassador || false}
          />
        </View>
      </ScrollView>

      {/* Refer Friend Bottom Sheet */}
      <ReferFriendBottomSheet
        bottomSheetRef={referFriendBottomSheetRef}
        referralCode={referralCode}
        refereePts={refereePts}
        referrerPts={referrerPts}
        onClose={handleReferFriendClose}
        onReferSuccess={handleReferSuccess}
      />

      {/* Refer Friend Success Bottom Sheet */}
      <ReferFriendSuccessBottomSheet
        bottomSheetRef={referFriendSuccessBottomSheetRef}
        points={referrerPts ?? undefined}
        onClose={handleReferSuccessClose}
        onViewRewards={handleViewRewardsFromSuccess}
      />

      {/* Logout Confirmation Modal */}
      <ConfirmationModal
        visible={showLogoutModal}
        title="Are you sure you want to logout?"
        description="You will need to sign in again to access your account."
        confirmText="Yes, Logout"
        cancelText="No, Stay Logged In"
        onConfirm={handleConfirmLogout}
        onCancel={handleCancelLogout}
        isLoading={isLoggingOut}
        loadingText="Logging out..."
      />
    </View>
  );
};

export default ProfileScreen;
