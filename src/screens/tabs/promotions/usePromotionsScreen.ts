import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { View, Share } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { captureAndShareView } from '@/utils/captureAndShare';
import BottomSheet from '@gorhom/bottom-sheet';
import { Badge, Tier, HistoryItemData } from './components';
import { useAuthStore } from '@/stores/authStore';
import { Query } from 'react-native-appwrite';
import {
  getUserCheckIns,
  getUserReviews,
  fetchEventByIdForHistory,
  getUserProfile,
  fetchTiers,
  getSetting,
  resolveCanonicalTier,
  CheckInRow,
  ReviewRow,
  TierRow,
} from '@/lib/database';
import { tablesDB, DATABASE_ID, USER_PROFILES_TABLE_ID } from '@/lib/database/config';
import { APP_STORE_SHARE_SUFFIX } from '@/constants';

export type TabType = 'inProgress' | 'earned';

interface UsePromotionsScreenOptions {
  contentRef?: RefObject<View | null>;
  shareContentRef?: RefObject<View | null>;
}

export const usePromotionsScreen = (options: UsePromotionsScreenOptions = {}) => {
  const { contentRef, shareContentRef } = options;
  const achievementShareMessage = `Check out my achievements on the SampleFinder app! Start earning your own rewards.\n\n${APP_STORE_SHARE_SUFFIX}`;
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<TabType>('inProgress');
  const referFriendBottomSheetRef = useRef<BottomSheet>(null);
  const referFriendSuccessBottomSheetRef = useRef<BottomSheet>(null);
  const [achievementModalVisible, setAchievementModalVisible] = useState(false);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<number>(100);
  const [nextTierRequiredPoints, setNextTierRequiredPoints] = useState<number | undefined>(undefined);
  
  // State for live data
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [totalPoints, setTotalPoints] = useState(0);
  // Used for tier progress UI only (keeps progress consistent with tierLevel overrides)
  const [pointsForProgress, setPointsForProgress] = useState(0);
  // Canonical tier rank derived from `userProfile.tierLevel` (when available)
  const [canonicalTierOrder, setCanonicalTierOrder] = useState<number | null>(null);
  const [eventCheckInsCount, setEventCheckInsCount] = useState(0);
  const [reviewsCount, setReviewsCount] = useState(0);
  const [historyItems, setHistoryItems] = useState<HistoryItemData[]>([]);
  const [tiersData, setTiersData] = useState<TierRow[]>([]);
  const [isAmbassador, setIsAmbassador] = useState(false);
  const [isInfluencer, setIsInfluencer] = useState(false);

  const getPointsTierOrder = (tiers: TierRow[], points: number): number | null => {
    if (!tiers.length) return null;
    const achieved = tiers
      .filter((tier) => points >= (tier.requiredPoints ?? 0))
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
    return achieved?.order ?? null;
  };

  // Fetch user statistics and history on mount and when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadUserData();
    }, [])
  );

  const loadUserData = async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setIsLoading(true);
      }
      
      const authUser = useAuthStore.getState().user;
      
      if (!authUser) {
        setIsLoading(false);
        return;
      }

      const userProfile = await getUserProfile(authUser.$id);
      if (!userProfile) {
        setIsLoading(false);
        return;
      }

      // Fetch tiers, check-ins, and reviews in parallel for better performance
      const [tiers, profileCheckIns, profileReviews, authCheckIns, authReviews] = await Promise.all([
        fetchTiers(),
        getUserCheckIns(userProfile.$id),
        getUserReviews(userProfile.$id),
        getUserCheckIns(authUser.$id),
        getUserReviews(authUser.$id),
      ]);

      const rawTotalPoints = userProfile.totalPoints ?? 0;
      const profileTierLevel = userProfile.tierLevel?.trim() ?? '';

      // If admin manually updated tierLevel, treat it as the canonical truth for "earned" tier state.
      const canonicalTier = resolveCanonicalTier(tiers, profileTierLevel);
      const pointsTierOrder = getPointsTierOrder(tiers, rawTotalPoints);

      // Canonical tier order drives which tier is shown as "earned".
      // Progress bars should always reflect the user's real points (no clamping).
      const derivedCanonicalTierOrder: number | null = canonicalTier?.order ?? null;
      const effectiveTierOrder =
        derivedCanonicalTierOrder === null
          ? pointsTierOrder
          : pointsTierOrder === null
            ? derivedCanonicalTierOrder
            : Math.max(derivedCanonicalTierOrder, pointsTierOrder);

      // Legacy users can have stale tierLevel values that lag behind real points.
      // Use the higher of tierLevel and points-derived order for earned/in-progress UI state.
      const mergedCheckInsMap = new Map<string, CheckInRow>();
      [...profileCheckIns, ...authCheckIns].forEach((item) => {
        if (!item?.$id) return;
        mergedCheckInsMap.set(item.$id, item);
      });
      const mergedReviewsMap = new Map<string, ReviewRow>();
      [...profileReviews, ...authReviews].forEach((item) => {
        if (!item?.$id) return;
        mergedReviewsMap.set(item.$id, item);
      });
      const checkIns = Array.from(mergedCheckInsMap.values());
      const reviews = Array.from(mergedReviewsMap.values());

      // Set data from profile and fetched arrays (avoid redundant API calls)
      setTiersData(tiers);
      setIsAmbassador(userProfile.isAmbassador || false);
      setIsInfluencer(userProfile.isInfluencer || false);
      setCanonicalTierOrder(effectiveTierOrder);
      setTotalPoints(rawTotalPoints);
      setPointsForProgress(rawTotalPoints);
      setEventCheckInsCount(checkIns.length);
      setReviewsCount(reviews.length);

      // Build history items (now optimized with parallel event fetching)
      const history = await buildHistoryItems(checkIns, reviews, userProfile);
      setHistoryItems(history);
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadUserData(true);
  };

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  /**
   * Fetch system-awarded history entries that are derivable from
   * the user profile and Settings table (no extra collection needed).
   */
  const buildSystemHistoryItems = async (
    profile: { $id: string; $createdAt: string; referralCode?: string | null; usedReferralCode?: string | null }
  ): Promise<{ item: HistoryItemData; timestamp: number }[]> => {
    const items: { item: HistoryItemData; timestamp: number }[] = [];

    // --- Join bonus (every user starts with points at sign-up) ---
    const joinBonusSetting = await getSetting('join_bonus_points').catch(() => null);
    const joinBonusPts = joinBonusSetting?.value ? parseInt(joinBonusSetting.value, 10) : 100;
    const signupTimestamp = new Date(profile.$createdAt).getTime();

    items.push({
      item: {
        id: `system-join-${profile.$id}`,
        eventId: '',
        brandProduct: 'Welcome Bonus',
        storeName: 'Joined SampleFinder',
        date: formatDate(profile.$createdAt),
        points: isNaN(joinBonusPts) ? 100 : joinBonusPts,
        brandPhotoURL: null,
      },
      timestamp: signupTimestamp,
    });

    // --- Referral received (this user signed up with someone's code) ---
    if (profile.usedReferralCode) {
      const refereeSetting = await getSetting('referral_points_referee').catch(() => null);
      const refereePts = refereeSetting?.value ? parseInt(refereeSetting.value, 10) : 0;

      if (refereePts > 0) {
        items.push({
          item: {
            id: `system-referral-received-${profile.$id}`,
            eventId: '',
            brandProduct: 'Referral Bonus',
            storeName: 'Signed up with a referral code',
            date: formatDate(profile.$createdAt),
            points: refereePts,
            brandPhotoURL: null,
          },
          timestamp: signupTimestamp + 1, // slightly after join bonus
        });
      }
    }

    // --- Referral earned (other users signed up with this user's code) ---
    if (profile.referralCode) {
      try {
        const referralsResult = await tablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId: USER_PROFILES_TABLE_ID,
          queries: [
            Query.equal('usedReferralCode', profile.referralCode),
            Query.orderDesc('$createdAt'),
            Query.limit(100),
          ],
        });

        if (referralsResult.rows && referralsResult.rows.length > 0) {
          const referrerSetting = await getSetting('referral_points_referrer').catch(() => null);
          const referrerPts = referrerSetting?.value ? parseInt(referrerSetting.value, 10) : 0;

          if (referrerPts > 0) {
            for (const referred of referralsResult.rows) {
              const referredProfile = referred as any;
              const referredName = [referredProfile.firstname, referredProfile.lastname]
                .filter(Boolean)
                .join(' ')
                .trim() || 'A friend';
              const referredTimestamp = new Date(referredProfile.$createdAt).getTime();

              items.push({
                item: {
                  id: `system-referral-earned-${referredProfile.$id}`,
                  eventId: '',
                  brandProduct: 'Referral Reward',
                  storeName: `${referredName} joined with your code`,
                  date: formatDate(referredProfile.$createdAt),
                  points: referrerPts,
                  brandPhotoURL: null,
                },
                timestamp: referredTimestamp,
              });
            }
          }
        }
      } catch (err) {
        console.warn('[buildSystemHistoryItems] Failed to fetch referral earns:', err);
      }
    }

    return items;
  };

  const buildHistoryItems = async (
    checkIns: CheckInRow[],
    reviews: ReviewRow[],
    profile: { $id: string; $createdAt: string; referralCode?: string | null; usedReferralCode?: string | null }
  ): Promise<HistoryItemData[]> => {
    // Extract unique event IDs from both sources so we can render history
    // even if a user only reviewed (or if check-ins and reviews are out of sync).
    const uniqueEventIds = [
      ...new Set([
        ...checkIns.map(checkIn => checkIn.eventID),
        ...reviews.map(review => (typeof review.event === 'string' ? review.event : (review.event as any)?.$id)),
      ].filter(Boolean)),
    ];

    // Fetch all events in parallel instead of sequentially
    // Use fetchEventByIdForHistory to include archived/hidden events for history display
    const eventPromises = uniqueEventIds.map(eventId =>
      fetchEventByIdForHistory(eventId).catch(error => {
        console.error(`Error fetching event ${eventId} for history:`, error);
        return null;
      })
    );

    const [events, systemItems] = await Promise.all([
      Promise.all(eventPromises),
      buildSystemHistoryItems(profile),
    ]);

    // Create a map for quick event lookup
    const eventMap = new Map(
      events
        .filter(event => event !== null)
        .map(event => [event!.$id, event!])
    );

    const reviewByEventId = new Map<string, ReviewRow[]>();
    for (const review of reviews) {
      const eventId =
        typeof review.event === 'string' ? review.event : (review.event as any)?.$id;
      if (!eventId) continue;
      const list = reviewByEventId.get(eventId) ?? [];
      list.push(review);
      reviewByEventId.set(eventId, list);
    }

    const checkInEventIds = new Set(checkIns.map(c => c.eventID));

    // Build history items using the event map.
    // Important: if the event no longer exists (deleted from admin),
    // we still show the history row with a fallback label.
    const items: { item: HistoryItemData; timestamp: number }[] = [...systemItems];

    for (const checkIn of checkIns) {
      const event = eventMap.get(checkIn.eventID);

      const reviewsForEvent = reviewByEventId.get(checkIn.eventID) ?? [];
      const reviewForEvent = reviewsForEvent[0];
      const timestamp = new Date(checkIn.$createdAt).getTime();

      items.push({
        item: {
          id: checkIn.$id,
          eventId: checkIn.eventID,
          brandProduct: event?.client?.name || 'Deleted event',
          storeName: event?.name || 'Deleted event',
          date: formatDate(checkIn.$createdAt),
          points: checkIn.pointsEarned + (reviewForEvent?.pointsEarned || 0),
          review: reviewForEvent?.review,
          brandPhotoURL: event?.client?.logoURL || null,
        },
        timestamp,
      });
    }

    // Add review-only entries (when a review exists but no check-in row is present)
    for (const review of reviews) {
      const eventId =
        typeof review.event === 'string' ? review.event : (review.event as any)?.$id;
      if (!eventId) continue;
      if (checkInEventIds.has(eventId)) continue;

      const event = eventMap.get(eventId);
      const timestamp = new Date(review.$createdAt).getTime();

      items.push({
        item: {
          id: review.$id,
          eventId,
          brandProduct: event?.client?.name || 'Deleted event',
          storeName: event?.name || 'Deleted event',
          date: formatDate(review.$createdAt),
          points: review.pointsEarned || 0,
          review: review.review,
          brandPhotoURL: event?.client?.logoURL || null,
        },
        timestamp,
      });
    }

    // Sort by timestamp (newest first) then extract just the items
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items.map(({ item }) => item);
  };

  const handleBackPress = () => {
    // Navigate back to Home tab
    navigation.goBack();
  };

  const handleSharePress = async () => {
    try {
      const message = achievementShareMessage;
      if (shareContentRef?.current) {
        try {
          await captureAndShareView(shareContentRef, message);
          return;
        } catch (e) {
          console.warn('[Achievements] Full-content share capture failed, falling back to viewport capture.', e);
        }
      }
      if (contentRef?.current) {
        await captureAndShareView(contentRef, message);
      } else {
        await Share.share({ message });
      }
    } catch (error) {
      console.error('Error sharing achievements:', error);
    }
  };

  const handleCloseReferFriend = () => {
    referFriendBottomSheetRef.current?.close();
  };

  const handleReferSuccess = () => {
    referFriendSuccessBottomSheetRef.current?.expand();
  };

  const handleCloseReferSuccess = () => {
    referFriendSuccessBottomSheetRef.current?.close();
  };

  const handleViewRewards = () => {
    // Already on Promotions screen, just close the modal
    handleCloseReferSuccess();
  };

  const handleTierPress = (tier: Tier, points: number) => {
    setSelectedTier(tier);
    setSelectedPoints(points);
    
    // Find the next tier's required points
    const currentTierIndex = tiers.findIndex(t => t.id === tier.id);
    const nextTier = currentTierIndex >= 0 && currentTierIndex < tiers.length - 1 
      ? tiers[currentTierIndex + 1] 
      : null;
    setNextTierRequiredPoints(nextTier?.requiredPoints);
    
    setAchievementModalVisible(true);
  };

  const handlePointsPress = (points: number, tier?: Tier) => {
    setSelectedTier(tier || null);
    setSelectedPoints(points);
    
    // Find the next tier's required points
    if (tier) {
      const currentTierIndex = tiers.findIndex(t => t.id === tier.id);
      const nextTier = currentTierIndex >= 0 && currentTierIndex < tiers.length - 1 
        ? tiers[currentTierIndex + 1] 
        : null;
      setNextTierRequiredPoints(nextTier?.requiredPoints);
    } else {
      setNextTierRequiredPoints(undefined);
    }
    
    setAchievementModalVisible(true);
  };

  const handleCloseAchievementModal = () => {
    setAchievementModalVisible(false);
    setSelectedTier(null);
  };

  const handleShareAchievement = async () => {
    try {
      await Share.share({
        message: achievementShareMessage,
      });
    } catch (error) {
      console.error('Error sharing achievement:', error);
    }
  };

  const handleViewMoreEvents = () => {
    // Navigate to Home tab
    (navigation as any).navigate('Home');
  };

  const eventBadges: Badge[] = [
    { id: '1', label: 'EVENTS', achieved: eventCheckInsCount >= 10, count: 10 },
    { id: '2', label: 'EVENTS', achieved: eventCheckInsCount >= 25, count: 25 },
    { id: '3', label: 'EVENTS', achieved: eventCheckInsCount >= 50, count: 50 },
    { id: '4', label: 'EVENTS', achieved: eventCheckInsCount >= 100, count: 100 },
    { id: '5', label: 'EVENTS', achieved: eventCheckInsCount >= 250, count: 250 },
  ];

  const reviewBadges: Badge[] = [
    { id: '1', label: 'REVIEWS', achieved: reviewsCount >= 10, count: 10 },
    { id: '2', label: 'REVIEWS', achieved: reviewsCount >= 25, count: 25 },
    { id: '3', label: 'REVIEWS', achieved: reviewsCount >= 50, count: 50 },
    { id: '4', label: 'REVIEWS', achieved: reviewsCount >= 100, count: 100 },
    { id: '5', label: 'REVIEWS', achieved: reviewsCount >= 250, count: 250 },
  ];

  // Map Appwrite tiers to UI Tier format
  const tiers: Tier[] = tiersData.map((tier) => {
    // Remove mode=admin from URL to allow public access
    const cleanImageURL = tier.imageURL?.replace('&mode=admin', '') ?? null;

    const earnedByTierLevel =
      canonicalTierOrder !== null ? (tier.order ?? 0) <= canonicalTierOrder : null;

    const badgeEarned =
      earnedByTierLevel !== null
        ? earnedByTierLevel
        : pointsForProgress >= tier.requiredPoints;
    
    return {
      id: tier.$id,
      name: tier.name,
      // If the tier is marked as achieved via admin `tierLevel`,
      // show the tier as completed (100%) even if real points are lower.
      currentPoints: badgeEarned ? tier.requiredPoints : Math.min(pointsForProgress, tier.requiredPoints),
      requiredPoints: tier.requiredPoints,
      badgeEarned,
      imageURL: cleanImageURL,
      order: tier.order,
    };
  });

  return {
    activeTab,
    eventBadges,
    reviewBadges,
    tiers,
    eventCheckIns: eventCheckInsCount,
    reviews: reviewsCount,
    historyItems,
    selectedTier,
    selectedPoints,
    nextTierRequiredPoints,
    achievementModalVisible,
    referFriendBottomSheetRef,
    referFriendSuccessBottomSheetRef,
    isLoading,
    isRefreshing,
    totalPoints,
    pointsForProgress,
    isAmbassador,
    isInfluencer,
    handleRefresh,
    setActiveTab,
    handleBackPress,
    handleSharePress,
    handleCloseReferFriend,
    handleReferSuccess,
    handleCloseReferSuccess,
    handleViewRewards,
    handleTierPress,
    handlePointsPress,
    handleCloseAchievementModal,
    handleShareAchievement,
    handleViewMoreEvents,
  };
};

