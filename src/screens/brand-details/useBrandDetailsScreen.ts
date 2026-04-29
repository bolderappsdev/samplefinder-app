import { useState, useEffect, useMemo, useRef, useCallback, type RefObject } from 'react';
import { View } from 'react-native';
import { CommonActions, CompositeNavigationProp, useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Share, Alert } from 'react-native';
import { captureAndShareView } from '@/utils/captureAndShare';
import BottomSheet from '@gorhom/bottom-sheet';
import { useAuthStore } from '@/stores/authStore';
import {
  fetchEventById,
  fetchClients,
  EventRow,
  ClientData,
  createCheckIn,
  createReview,
  getUserCheckInForEvent,
  getUserProfile,
  addFavoriteBrand,
  removeFavoriteBrand,
  getUserReviewForEvent,
  createUserNotification,
} from '@/lib/database';
import { HomeStackParamList } from '@/navigation/HomeStack';
import { TabParamList } from '@/navigation/TabNavigator';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useCalendarEventsStore } from '@/stores/calendarEventsStore';
import { useTierCompletionStore } from '@/stores/tierCompletionStore';
import { convertEventToBrandDetails, extractClientFromEvent } from '@/utils/brandUtils';
import { scheduleEventReminders, cancelEventReminders } from '@/lib/notifications/eventReminders';
import { getNavigationRef } from '@/lib/notifications/handlers';

export interface BrandDetailsData {
  id: string; // Event ID
  clientId: string; // Brand/Client ID (for favorites)
  brandName: string;
  storeName: string;
  date: string; // e.g., "Aug 1, 2025"
  time: string; // e.g., "3 - 5 pm"
  /** Venue / location display name from events (locations table) */
  locationName?: string | null;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  products: string[];
  eventInfo: string;
  discountMessage?: string;
  discount?: string | null; // Discount text/description
  discountImageURL?: string | null; // Discount barcode/coupon image
  brandDescription?: string | null; // Brand description text field
}

// BrandDetailsScreen can be accessed from either HomeStack or CalendarStack
// Use CompositeNavigationProp to combine stack and tab navigation
type BrandDetailsScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'BrandDetails'>,
  BottomTabNavigationProp<TabParamList>
>;

export type CheckInStatus = 'none' | 'input' | 'incorrect' | 'success';

interface BrandDetailsScreenProps {
  route: {
    params: { eventId?: string; brand?: BrandDetailsData; fromFavorites?: boolean };
  };
  contentRef?: RefObject<View | null>;
  shareContentRef?: RefObject<View | null>;
}

export const useBrandDetailsScreen = ({ route, contentRef, shareContentRef }: BrandDetailsScreenProps) => {
  const navigation = useNavigation<BrandDetailsScreenNavigationProp>();
  const { eventId, brand: brandParam, fromFavorites } = route.params;
  
  // State for brand data and loading
  const [brand, setBrand] = useState<BrandDetailsData | null>(brandParam || null);
  const [eventData, setEventData] = useState<EventRow | null>(null); // Store full event data for points
  const [isLoading, setIsLoading] = useState(!!eventId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailsRefreshTrigger, setDetailsRefreshTrigger] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const isPullToRefreshRef = useRef(false);
  const [checkInCode, setCheckInCode] = useState<string>('');
  
  // State for event timing data (for check-in validation)
  const [eventStartTime, setEventStartTime] = useState<Date | null>(null);
  const [eventEndTime, setEventEndTime] = useState<Date | null>(null);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  
  // Zustand favorites store
  const favoriteIds = useFavoritesStore((state) => state.favoriteIds);
  const isFavoriteInStore = useFavoritesStore((state) => state.isFavorite);
  const addFavoriteToStore = useFavoritesStore((state) => state.addFavorite);
  const removeFavoriteFromStore = useFavoritesStore((state) => state.removeFavorite);
  
  // Zustand calendar events store
  const addSavedEventToStore = useCalendarEventsStore((state) => state.addSavedEvent);
  const removeSavedEventFromStore = useCalendarEventsStore((state) => state.removeSavedEvent);
  const isSavedToCalendarInStore = useCalendarEventsStore((state) => state.isSavedToCalendar);
  
  const [isAddedToCalendar, setIsAddedToCalendar] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>('none');
  const [hasSubmittedCode, setHasSubmittedCode] = useState(false);
  const [isSubmittingCheckIn, setIsSubmittingCheckIn] = useState(false); // Prevent duplicate submissions
  const [isSubmittingReview, setIsSubmittingReview] = useState(false); // Prevent duplicate review submissions
  const reviewBottomSheetRef = useRef<BottomSheet>(null);
  const [pointsModalVisible, setPointsModalVisible] = useState(false);
  const [pointsModalTitle, setPointsModalTitle] = useState('Nice Work!');
  const [pointsModalAmount, setPointsModalAmount] = useState(0);
  const [hasReviewed, setHasReviewed] = useState(false);
  const [checkInPoints, setCheckInPoints] = useState(0);
  const [reviewPoints, setReviewPoints] = useState(0);
  
  // Badge earned modal state
  const [badgeModalVisible, setBadgeModalVisible] = useState(false);
  const [badgeType, setBadgeType] = useState<'events' | 'reviews'>('events');
  const [badgeNumber, setBadgeNumber] = useState(0);
  const [badgeAchievementCount, setBadgeAchievementCount] = useState(0);

  const [unfavoriteConfirmVisible, setUnfavoriteConfirmVisible] = useState(false);
  const [isUnfavoriting, setIsUnfavoriting] = useState(false);
  
  
  // Initialize calendar state from store
  useEffect(() => {
    if (brand?.id) {
      const isSaved = isSavedToCalendarInStore(brand.id);
      setIsAddedToCalendar(isSaved);
    }
  }, [brand?.id]);

  // Refetch event details when screen gains focus after navigating away (e.g. user swipes back)
  const isFirstDetailsFocus = useRef(true);
  const lastEventIdRef = useRef<string | undefined>(eventId);
  if (lastEventIdRef.current !== eventId) {
    lastEventIdRef.current = eventId;
    isFirstDetailsFocus.current = true;
  }
  useFocusEffect(
    useCallback(() => {
      if (!eventId) return;
      if (isFirstDetailsFocus.current) {
        isFirstDetailsFocus.current = false;
        return;
      }
      setDetailsRefreshTrigger((prev) => prev + 1);
    }, [eventId])
  );

  useEffect(() => {
    const loadEventData = async () => {
      if (!eventId) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      const isPullToRefresh = isPullToRefreshRef.current;

      try {
        if (!isPullToRefresh) {
          setIsLoading(true);
        }
        setError(null);

        const event = await fetchEventById(eventId);
        if (!event) {
          setError('Event not found');
          setIsLoading(false);
          setIsRefreshing(false);
          isPullToRefreshRef.current = false;
          return;
        }
        
        let client = extractClientFromEvent(event);
        
        if (!client && event.client) {
          const clientId = typeof event.client === 'string' ? event.client : event.client.$id;
          if (clientId) {
            const allClients = await fetchClients();
            client = allClients.find((c) => c.$id === clientId) || null;
          }
        }
        
        // Set event timing for check-in validation
        if (event.startTime) {
          setEventStartTime(new Date(event.startTime));
        }
        if (event.endTime) {
          setEventEndTime(new Date(event.endTime));
        }
        
        const logoUrl = client?.logoURL || null;
        setBrandLogoUrl(logoUrl);
        
        setEventData(event);
        const brandData = convertEventToBrandDetails(event, client);
        setBrand(brandData);
        setCheckInCode(String(event.checkInCode ?? ''));
        
        const authUser = useAuthStore.getState().user;
        if (authUser) {
          const userProfile = await getUserProfile(authUser.$id);
          if (userProfile) {
            const existingCheckIn = await getUserCheckInForEvent(userProfile.$id, eventId);
            if (existingCheckIn) {
              setCheckInStatus('success');
              setCheckInPoints(existingCheckIn.pointsEarned || event.checkInPoints || 0);
            }
            
            // Check for existing review
            const existingReview = await getUserReviewForEvent(userProfile.$id, eventId);
            if (existingReview) {
              setHasReviewed(true);
              setReviewPoints(existingReview.pointsEarned || event.reviewPoints || 0);
            }
          }
        }
      } catch (err: any) {
        console.error('Error loading event:', err);
        setError(err.message || 'Failed to load event details');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        isPullToRefreshRef.current = false;
      }
    };

    loadEventData();
  }, [eventId, detailsRefreshTrigger]);

  const handleRefreshDetails = useCallback(() => {
    if (!eventId) return;
    isPullToRefreshRef.current = true;
    setIsRefreshing(true);
    setDetailsRefreshTrigger((prev) => prev + 1);
  }, [eventId]);

  const isFavorite = useMemo(() => {
    if (!brand || !brand.clientId) return false;
    // Check by clientId (brand ID), not event ID
    return isFavoriteInStore(brand.clientId);
  }, [favoriteIds, brand, isFavoriteInStore]);

  const handleTabPress = (tab: string) => {
    const tabMap: Record<string, keyof TabParamList> = {
      home: 'Home',
      profile: 'Profile',
      favorites: 'Favorites',
      calendar: 'Calendar',
      promotions: 'Promotions',
    };
    const tabName = tabMap[tab];
    if (tabName) {
      const parent = navigation.getParent();
      if (parent) {
        parent.navigate('MainTabs', { screen: tabName });
      }
    }
  };

  const navigateBackToFavorites = useCallback(() => {
    const rootNav = getNavigationRef();
    const rootState = rootNav?.getRootState();
    if (rootNav?.isReady() && rootState?.routes?.length) {
      const mainTabsRoute = rootState.routes.find((r: { name: string }) => r.name === 'MainTabs');
      const tabsState = mainTabsRoute?.state;
      if (tabsState?.routes?.length) {
        const existingTabRoutes = tabsState.routes as Array<{ name: string; key?: string; state?: unknown }>;
        const updatedTabRoutes = existingTabRoutes.map((route, i) =>
          i === 0
            ? { ...route, state: { index: 0, routes: [{ name: 'HomeMain' }] } }
            : route
        );
        const resetState = {
          index: 0,
          routes: [
            {
              ...mainTabsRoute,
              state: {
                ...tabsState,
                index: 2, // Favorites tab
                routes: updatedTabRoutes,
              },
            },
          ],
        };
        rootNav.dispatch(CommonActions.reset(resetState as Parameters<typeof CommonActions.reset>[0]));
        return;
      }
    }
    const parent = navigation.getParent();
    if (parent) {
      (parent as any).navigate('MainTabs', { screen: 'Favorites' });
    } else {
      navigation.goBack();
    }
  }, [navigation]);

  // When fromFavorites is true, intercept back gesture (swipe) so we go to Favorites tab instead of Home stack
  useEffect(() => {
    if (!fromFavorites) return;
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      const action = e.data.action;
      const isBackGesture = action.type === 'POP' || action.type === 'GO_BACK';
      if (isBackGesture) {
        e.preventDefault();
        navigateBackToFavorites();
      }
    });
    return unsubscribe;
  }, [navigation, fromFavorites, navigateBackToFavorites]);

  const handleBack = () => {
    if (fromFavorites) {
      navigateBackToFavorites();
    } else {
      navigation.goBack();
    }
  };

  const handleShare = async () => {
    if (!brand) return;
    try {
      const message = `Check out ${brand.brandName} at ${brand.storeName} on ${brand.date} from ${brand.time}`;
      if (shareContentRef?.current) {
        try {
          // Capture full event details content (not just the visible viewport).
          await captureAndShareView(shareContentRef, message, { useRenderInContext: true });
          return;
        } catch (e) {
          console.warn('[BrandDetails] Full-content share capture failed, falling back to viewport capture.', e);
        }
      }

      if (contentRef?.current) {
        await captureAndShareView(contentRef, message);
        return;
      }

      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleAddToCalendar = async () => {
    if (!brand?.id) return;

    try {
      // If already added, remove directly (no confirmation)
      if (isAddedToCalendar) {
        await removeSavedEventFromStore(brand.id);
        setIsAddedToCalendar(false);
        await cancelEventReminders(brand.id);
        return;
      }

      // Add to user's calendar via store (which syncs with database)
      await addSavedEventToStore(brand.id);
      setIsAddedToCalendar(true);
      
      const eventTitle = eventData?.name || brand.brandName;
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        try {
          await createUserNotification({
            userId: authUser.$id,
            type: 'eventAdded',
            title: 'Event Added to Calendar',
            message: `You added "${eventTitle}" to your calendar. We'll remind you 24h and 1h before!`,
            data: { eventId: brand.id, eventTitle },
          });
        } catch (notifErr) {
          console.warn('[handleAddToCalendar] Failed to create event-added notification:', notifErr);
        }
      }
      
      // Schedule push reminder side-effects without failing the primary "save event" action.
      if (eventData?.startTime) {
        try {
          const eventStartDate = new Date(eventData.startTime);
          if (isNaN(eventStartDate.getTime())) {
            console.warn('[handleAddToCalendar] Skipping reminders due to invalid event start time:', eventData.startTime);
          } else {
            const eventLocation = eventData.city ? `${eventData.address}, ${eventData.city}` : undefined;

            const scheduledReminders = await scheduleEventReminders(
              brand.id,
              eventStartDate,
              eventTitle,
              eventLocation
            );

            if (scheduledReminders && Object.keys(scheduledReminders).length > 0) {
              console.log('[handleAddToCalendar] Scheduled reminders:', scheduledReminders);
            }
          }
        } catch (reminderErr) {
          console.warn('[handleAddToCalendar] Failed to schedule reminders:', reminderErr);
        }
      }
    } catch (error) {
      console.error('Error updating calendar:', error);
      Alert.alert(
        'Error',
        'Failed to update calendar. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleAddFavorite = async () => {
    if (!brand?.clientId) return;

    if (isFavorite) {
      setUnfavoriteConfirmVisible(true);
      return;
    }

    try {
      addFavoriteToStore(brand.clientId);
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        await addFavoriteBrand(authUser.$id, brand.clientId);
      }
    } catch (error) {
      console.error('Error syncing favorite with user profile:', error);
      removeFavoriteFromStore(brand.clientId);
    }
  };

  const handleCancelUnfavorite = () => {
    if (isUnfavoriting) return;
    setUnfavoriteConfirmVisible(false);
  };

  const handleConfirmUnfavorite = async () => {
    if (!brand?.clientId) return;

    setIsUnfavoriting(true);
    try {
      removeFavoriteFromStore(brand.clientId);
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        await removeFavoriteBrand(authUser.$id, brand.clientId);
      }
      setUnfavoriteConfirmVisible(false);
    } catch (error) {
      console.error('Error syncing favorite with user profile:', error);
      addFavoriteToStore(brand.clientId);
    } finally {
      setIsUnfavoriting(false);
    }
  };

  // Check-in validation based on date and time only
  const canCheckIn = useMemo(() => {
    if (!eventStartTime || !eventEndTime) {
      return false;
    }

    const now = new Date();
    const isWithinTimeRange = now >= eventStartTime && now <= eventEndTime;
    
    return isWithinTimeRange;
  }, [eventStartTime, eventEndTime]);

  useEffect(() => {
    if (checkInStatus === 'success') {
      return;
    }

    if (canCheckIn && checkInStatus === 'none') {
      setCheckInStatus('input');
    } else if (!canCheckIn && (checkInStatus === 'input' || checkInStatus === 'incorrect')) {
      setCheckInStatus('none');
    }
  }, [canCheckIn, checkInStatus]);

  const handleCodeSubmit = async (code: string) => {
    if (isSubmittingCheckIn) {
      return;
    }

    if (code.length === 6) {
      if (String(code).toUpperCase() === String(checkInCode).toUpperCase()) {
        try {
          setIsSubmittingCheckIn(true);
          
          const authUser = useAuthStore.getState().user;
          if (!authUser) {
            Alert.alert('Error', 'You must be logged in to check in');
            setIsSubmittingCheckIn(false);
            return;
          }

          const { getUserProfile } = await import('@/lib/database');
          const userProfile = await getUserProfile(authUser.$id);
          if (!userProfile) {
            Alert.alert('Error', 'User profile not found');
            setIsSubmittingCheckIn(false);
            return;
          }

          const existingCheckIn = await getUserCheckInForEvent(userProfile.$id, eventId || '');
          if (existingCheckIn) {
            Alert.alert('Already Checked In', 'You have already checked in to this event');
            setCheckInStatus('success');
            setIsSubmittingCheckIn(false);
            return;
          }

          const checkInData = {
            userID: userProfile.$id,
            eventID: eventId || '',
            checkInCode: code,
            pointsEarned: eventData?.checkInPoints || 0,
          };

          const checkInResult = await createCheckIn(checkInData);

          const earnedPoints = eventData?.checkInPoints || 0;
          setCheckInPoints(earnedPoints);
          setCheckInStatus('success');
          
          // Check if a badge was earned
          if (checkInResult.badgeEarned) {
            setBadgeType('events');
            setBadgeNumber(checkInResult.badgeEarned.badgeNumber);
            setBadgeAchievementCount(checkInResult.badgeEarned.achievementCount);
            setBadgeModalVisible(true);
          } else {
            // Show points earned modal only if no badge was earned
            setPointsModalAmount(earnedPoints);
            setPointsModalTitle('Nice Work!');
            setPointsModalVisible(true);
          }
        } catch (error: any) {
          console.error('Error during check-in:', error);
          Alert.alert('Error', error.message || 'Failed to complete check-in');
          setCheckInStatus('incorrect');
        } finally {
          setIsSubmittingCheckIn(false);
        }
      } else {
        setHasSubmittedCode(true);
        setCheckInStatus('incorrect');
      }
    }
  };

  const handleLeaveReview = () => {
    reviewBottomSheetRef.current?.expand();
  };

  const handleCloseReviewModal = () => {
    reviewBottomSheetRef.current?.close();
  };

  const handleClosePointsModal = () => {
    setPointsModalVisible(false);
    // Show tier completion modal after earned modal closes (if user completed a tier)
    useTierCompletionStore.getState().showPendingTierModal();
  };

  const handleCloseBadgeModal = () => {
    setBadgeModalVisible(false);
    // Show tier completion modal after earned modal closes (if user completed a tier)
    useTierCompletionStore.getState().showPendingTierModal();
  };

  const handleShareBadge = async () => {
    if (!brand) return;
    try {
      const badgeName = badgeType === 'events' ? 'Events Badge' : 'Review Badge';
      await Share.share({
        message: `I just earned the ${badgeNumber} ${badgeName} on SampleFinder! 🎉`,
      });
    } catch (error) {
      console.error('Error sharing badge:', error);
    }
  };

  const handleViewRewards = () => {
    setPointsModalVisible(false);
    // Show tier completion modal after earned modal closes (if user completed a tier)
    useTierCompletionStore.getState().showPendingTierModal();
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate('MainTabs', { screen: 'Promotions' });
    }
  };

  const handleSubmitReview = async (
    reviewText: string,
    rating: number,
    tags?: string[],
    purchased?: boolean
  ) => {
    if (isSubmittingReview) {
      return;
    }

    try {
      setIsSubmittingReview(true);

      const authUser = useAuthStore.getState().user;
      if (!authUser) {
        Alert.alert('Error', 'You must be logged in to leave a review');
        setIsSubmittingReview(false);
        return;
      }

      const { getUserProfile } = await import('@/lib/database');
      const userProfile = await getUserProfile(authUser.$id);
      if (!userProfile) {
        Alert.alert('Error', 'User profile not found');
        setIsSubmittingReview(false);
        return;
      }

      const existingReview = await getUserReviewForEvent(userProfile.$id, eventId || '');
      if (existingReview) {
        Alert.alert('Already Reviewed', 'You have already reviewed this event');
        setIsSubmittingReview(false);
        reviewBottomSheetRef.current?.close();
        return;
      }

      // Map all selected "What Did You Like?" tags to liked (backend enum array, lowercase)
      const liked =
        tags && tags.length > 0
          ? tags.map((t) => t.toLowerCase())
          : undefined;

      const reviewData = {
        user: userProfile.$id,
        event: eventId || '',
        review: reviewText || undefined,
        rating: rating,
        pointsEarned: eventData?.reviewPoints || 0,
        liked,
        hasPurchased: purchased,
      };

      const reviewResult = await createReview(reviewData);

      setHasReviewed(true);
      reviewBottomSheetRef.current?.close();
      
      // Check if a badge was earned
      if (reviewResult.badgeEarned) {
        setBadgeType('reviews');
        setBadgeNumber(reviewResult.badgeEarned.badgeNumber);
        setBadgeAchievementCount(reviewResult.badgeEarned.achievementCount);
        setBadgeModalVisible(true);
      } else {
        // Show points earned modal only if no badge was earned
        const earnedPoints = eventData?.reviewPoints || 0;
        setReviewPoints(earnedPoints);
        setPointsModalAmount(earnedPoints);
        setPointsModalTitle('Review Submitted');
        setPointsModalVisible(true);
      }
    } catch (error: any) {
      console.error('Error submitting review:', error);
      Alert.alert('Error', error.message || 'Failed to submit review');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const totalEarnedPoints = checkInPoints + reviewPoints;

  return {
    brand,
    isLoading,
    error,
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
  };
};

