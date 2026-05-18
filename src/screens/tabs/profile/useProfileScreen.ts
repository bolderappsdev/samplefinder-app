import { useState, useCallback, useRef, type RefObject } from 'react';
import { View } from 'react-native';
import { useNavigation, useFocusEffect, CommonActions } from '@react-navigation/native';
import { Alert, Linking, Share } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { logout } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { captureAndShareView } from '@/utils/captureAndShare';
import { getUserProfile, calculateTierStatus, fetchTiers, getUserCurrentTier, UserProfileRow, getUserCheckInsCount, getUserReviewsCount, getUnreadNotificationCount } from '@/lib/database';
import { formatDateForDisplay } from '@/utils/formatters';
import { countAchievedBadges, APP_STORE_SHARE_SUFFIX } from '@/constants';

interface UseProfileScreenOptions {
  contentRef?: RefObject<View | null>;
  shareContentRef?: RefObject<View | null>;
}

export const useProfileScreen = (options: UseProfileScreenOptions = {}) => {
  const { contentRef, shareContentRef } = options;
  const profileShareMessage = `Check out my Profile on the SampleFinder app! Make your own profile.\n\n${APP_STORE_SHARE_SUFFIX}`;
  const navigation = useNavigation();
  const referFriendBottomSheetRef = useRef<BottomSheet>(null);
  const referFriendSuccessBottomSheetRef = useRef<BottomSheet>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [authUser, setAuthUser] = useState<{ email: string; name?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [statistics, setStatistics] = useState({
    totalPoints: 0,
    eventCheckIns: 0,
    samplingReviews: 0,
    badgeAchievements: 0,
  });
  const [tierStatus, setTierStatus] = useState<string>('NewbieSampler');
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadProfile = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError('');
      
      const user = useAuthStore.getState().user;
      if (!user) {
        setError('Not authenticated. Please log in again.');
        setHasUnreadNotifications(false);
        setIsLoading(false);
        return;
      }

      setAuthUser({ email: user.email, name: user.name });

      const userProfile = await getUserProfile(user.$id);
      setProfile(userProfile);
      
        // Use actual counts from database instead of cached profile fields
        // This ensures consistency with the Achievements screen
        if (userProfile) {
          // Fetch actual counts from database in parallel. Use user.$id (authID) for unread count - notifications API looks up profile by authID.
          const [eventCheckIns, samplingReviews, unreadCount] = await Promise.all([
            getUserCheckInsCount(userProfile.$id),
            getUserReviewsCount(userProfile.$id),
            getUnreadNotificationCount(user.$id),
          ]);
          setHasUnreadNotifications(unreadCount > 0);
        
        // Calculate badge achievements based on thresholds (includes influencer and ambassador badges)
        const eventBadges = countAchievedBadges(eventCheckIns);
        const reviewBadges = countAchievedBadges(samplingReviews);
        const ambassadorBadge = userProfile.isAmbassador ? 1 : 0;
        const influencerBadge = userProfile.isInfluencer ? 1 : 0;
        const totalBadges = eventBadges + reviewBadges + ambassadorBadge + influencerBadge;
        
        const totalPoints = userProfile.totalPoints ?? 0;
        setStatistics({
          totalPoints,
          eventCheckIns,
          samplingReviews,
          badgeAchievements: totalBadges,
        });

        // Prefer stored tierLevel from profile as the canonical tier,
        // falling back to points-based calculation for legacy profiles.
        if (userProfile.tierLevel && userProfile.tierLevel.trim().length > 0) {
          setTierStatus(userProfile.tierLevel);
        } else {
          try {
            const tiers = await fetchTiers();
            const currentTier = getUserCurrentTier(tiers, totalPoints);
            setTierStatus(currentTier?.name ?? 'NewbieSampler');
          } catch (tierErr) {
            setTierStatus(calculateTierStatus(totalPoints));
          }
        }
      } else {
        setTierStatus('NewbieSampler');
        setHasUnreadNotifications(false);
      }
    } catch (err: any) {
      console.error('Error loading profile:', err);
      setError(err?.message || 'Failed to load profile');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Load profile when screen is focused; unread count is set once when loadProfile completes to avoid icon flashing
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleRefresh = useCallback(() => {
    loadProfile(true);
  }, [loadProfile]);

  const handleBackPress = () => {
    // Navigate back to Home tab
    navigation.goBack();
  };

  const handleSharePress = async () => {
    try {
      if (isLoading) {
        Alert.alert('Please wait', 'Your profile is still loading. Try sharing again in a moment.');
        return;
      }
      if (error) {
        Alert.alert('Unable to Share', 'Your profile is not ready to share right now. Please try again.');
        return;
      }
      const message = profileShareMessage;
      if (shareContentRef?.current) {
        try {
          await captureAndShareView(shareContentRef, message);
          return;
        } catch (e) {
          console.warn('[Profile] Full-content share capture failed, falling back to viewport capture.', e);
        }
      }
      if (contentRef?.current) {
        await captureAndShareView(contentRef, message);
      } else {
        await Share.share({ message });
      }
    } catch (error) {
      console.error('Error sharing profile:', error);
    }
  };

  const handleReferFriendPress = () => {
    referFriendBottomSheetRef.current?.expand();
  };

  const handleReferFriendClose = () => {
    referFriendBottomSheetRef.current?.close();
  };

  const handleReferSuccess = () => {
    referFriendSuccessBottomSheetRef.current?.snapToIndex(0);
  };

  const handleReferSuccessClose = () => {
    referFriendSuccessBottomSheetRef.current?.close();
  };

  const handleViewRewardsFromSuccess = () => {
    referFriendSuccessBottomSheetRef.current?.close();
    navigation.navigate('Promotions' as never);
  };

  const handleLogOutPress = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      useAuthStore.getState().clearUser();
      // Navigate to Login screen and reset navigation stack
      // Get root navigator by traversing up the navigation tree
      const rootNavigation = navigation.getParent()?.getParent() || navigation.getParent() || navigation;
      rootNavigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        })
      );
    } catch (error: any) {
      console.error('Logout error:', error);
      setIsLoggingOut(false);
      setShowLogoutModal(false);
      Alert.alert(
        'Logout Failed',
        error.message || 'Failed to log out. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleCancelLogout = () => {
    setShowLogoutModal(false);
  };

  const handleEditProfilePress = () => {
    navigation.navigate('EditProfile' as never);
  };

  const handleViewRewardsPress = () => {
    navigation.navigate('Promotions' as never);
  };

  const handleNotificationsPress = () => {
    navigation.navigate('Notifications' as never);
  };

  const handleApplyHerePress = async () => {
    const url = 'https://app.popbookings.com/vip/polarisbrandpromotions';
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Unable to Open Link',
          'Unable to open the application form. Please check your internet connection.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('Error opening brand ambassador form:', error);
      Alert.alert(
        'Error',
        'Failed to open the application form. Please try again later.',
        [{ text: 'OK' }]
      );
    }
  };

  const formattedDOB = profile?.dob ? formatDateForDisplay(profile.dob) : '';
  const referralCode = profile?.referralCode || 'N/A';

  return {
    profile,
    authUser,
    statistics,
    tierStatus,
    hasUnreadNotifications,
    isLoading,
    isRefreshing,
    error,
    isLoggingOut,
    showLogoutModal,
    formattedDOB,
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
  };
};

