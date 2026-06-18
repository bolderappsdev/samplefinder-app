import { ID, Query } from 'react-native-appwrite';
import { tablesDB, DATABASE_ID, USER_PROFILES_TABLE_ID } from './config';
import type { ReviewData, ReviewRow } from './types';
import { createUserNotification } from './userNotifications';
import { updateUserProfile } from './users';
import { fetchTiers, getUserCurrentTier } from './tiers';
import { BADGE_THRESHOLDS, getLastAchievedBadge } from '@/constants/Badges';
import { useTierCompletionStore } from '@/stores/tierCompletionStore';
import { sendNewTierPushNotification, sendNewBadgePushNotification } from '@/lib/notifications/tierNotifications';
import type { Tier } from '@/screens/tabs/promotions/components';

export const REVIEWS_TABLE_ID = process.env.APPWRITE_REVIEWS_TABLE_ID || 'reviews';
const REVIEWS_PAGE_SIZE = 100;

export const createReview = async (reviewData: ReviewData): Promise<ReviewRow> => {
  if (!DATABASE_ID || !REVIEWS_TABLE_ID || !USER_PROFILES_TABLE_ID) {
    throw new Error('Database ID or Table ID not configured.');
  }

  try {
    const existing = await getUserReviewForEvent(reviewData.user, reviewData.event);
    if (existing) {
      throw new Error('You have already reviewed this event');
    }
    
    const userProfile = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: reviewData.user,
    });

    if (!userProfile) {
      throw new Error('User profile not found');
    }
    
    const profile = userProfile as any;
    const oldTotalPoints = Number(profile.totalPoints) || 0;
    const newTotalPoints = oldTotalPoints + (reviewData.pointsEarned || 0);

    // Use actual review row count (same source as Profile / Promotions), not profile.totalReviews.
    const oldReviewCount = await getUserReviewsCount(reviewData.user);
    const newReviewCount = oldReviewCount + 1;

    // Check if a new badge was earned
    const oldBadgeThreshold = getLastAchievedBadge(oldReviewCount);
    const newBadgeThreshold = getLastAchievedBadge(newReviewCount);
    const badgeEarned = newBadgeThreshold !== null && newBadgeThreshold !== oldBadgeThreshold;

    const authUserID = profile.authID;
    if (!authUserID) {
      throw new Error('User authentication ID not found in profile');
    }

    // Get current tier before updating points
    let oldTier = null;
    try {
      const tiers = await fetchTiers();
      oldTier = getUserCurrentTier(tiers, oldTotalPoints);
    } catch (error) {
      console.error('[reviews] Failed to fetch tiers:', error);
    }

    const rowId = ID.unique();
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: REVIEWS_TABLE_ID,
      rowId: rowId,
      data: reviewData,
      permissions: [
        `read("user:${authUserID}")`,
        `update("user:${authUserID}")`,
        `delete("user:${authUserID}")`,
      ],
    });

    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profile.$id,
      data: {
        totalReviews: newReviewCount,
        totalPoints: newTotalPoints,
      },
    });

    // Create review confirmation notification
    try {
      await createUserNotification({
        userId: authUserID,
        type: 'review',
        title: 'Thank You for Your Review! ⭐',
        message: `You earned ${reviewData.pointsEarned || 0} points! Your feedback helps others discover great products.`,
        data: {
          eventId: reviewData.event,
          pointsEarned: reviewData.pointsEarned || 0,
          rating: reviewData.rating,
        },
      });
    } catch (notificationError) {
      console.error('[reviews] Failed to create review notification:', notificationError);
      // Don't fail the review if notification creation fails
    }

    // Check if tier changed and create notification
    try {
      const tiers = await fetchTiers();
      const newTier = getUserCurrentTier(tiers, newTotalPoints);
      if (newTier && oldTier && newTier.$id !== oldTier.$id) {
        await updateUserProfile(profile.$id, { tierLevel: newTier.name });

        await createUserNotification({
          userId: authUserID,
          type: 'tierChanged',
          title: `NEW TIER: ${newTier.name}!`,
          message: `Congratulations, you've reached the ${newTier.name} tier! Keep earning points to level up!`,
          data: {
            oldTierId: oldTier.$id,
            newTierId: newTier.$id,
            oldTierName: oldTier.name,
            newTierName: newTier.name,
          },
        });

        // Send immediate device push notification for new tier
        await sendNewTierPushNotification(newTier.name);

        // Trigger global tier completion modal
        const tierForModal: Tier = {
          id: newTier.$id,
          name: newTier.name,
          currentPoints: Math.min(newTotalPoints, newTier.requiredPoints),
          requiredPoints: newTier.requiredPoints,
          badgeEarned: newTotalPoints >= newTier.requiredPoints,
          imageURL: newTier.imageURL ?? null,
          order: newTier.order,
        };
        
        useTierCompletionStore.getState().setTierCompleted(
          tierForModal,
          reviewData.pointsEarned || 0,
          'review'
        );
      }
    } catch (tierError) {
      console.error('[reviews] Failed to check tier or create tier notification:', tierError);
      // Don't fail the review if tier notification fails
    }

    // Create badge earned notification if applicable
    if (badgeEarned && newBadgeThreshold !== null) {
      try {
        // Create in-app notification (stored in database)
        await createUserNotification({
          userId: authUserID,
          type: 'badgeEarned',
          title: `NEW BADGE: SAMPLEFINDER REVIEW LEVEL ${newBadgeThreshold}`,
          message: `Congratulations, you earned the ${newBadgeThreshold} review level badge! Keep reviewing to earn more points!`,
          data: {
            badgeType: 'reviews',
            badgeThreshold: newBadgeThreshold,
            achievementCount: newReviewCount,
            screen: 'Profile',
          },
        });

        // Send push notification separately
        await sendNewBadgePushNotification('review', newBadgeThreshold);
      } catch (badgeError) {
        console.error('[reviews] Failed to create badge notification:', badgeError);
        // Don't fail the review if badge notification fails
      }
    }
    
    return {
      $id: result.$id,
      user: result.user,
      event: result.event,
      review: result.review,
      rating: result.rating,
      liked: result.liked,
      hasPurchased: result.hasPurchased,
      pointsEarned: result.pointsEarned,
      $createdAt: result.$createdAt,
      $updatedAt: result.$updatedAt,
      badgeEarned: badgeEarned ? {
        badgeType: 'reviews' as const,
        badgeNumber: newBadgeThreshold!,
        achievementCount: newReviewCount,
      } : undefined,
    };
  } catch (error: any) {
    throw new Error(error.message || 'Failed to create review');
  }
};

export const getUserReviews = async (userID: string): Promise<ReviewRow[]> => {
  if (!DATABASE_ID || !REVIEWS_TABLE_ID) {
    throw new Error('Database ID or Reviews Table ID not configured.');
  }

  try {
    const allRows: any[] = [];
    let cursorAfter: string | null = null;

    while (true) {
      const queries = [Query.equal('user', userID), Query.limit(REVIEWS_PAGE_SIZE)];
      if (cursorAfter) {
        queries.push(Query.cursorAfter(cursorAfter));
      }

      const result = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: REVIEWS_TABLE_ID,
        queries,
      });

      if (!result.rows || result.rows.length === 0) {
        break;
      }

      allRows.push(...result.rows);
      cursorAfter = result.rows[result.rows.length - 1].$id;

      if (result.rows.length < REVIEWS_PAGE_SIZE) {
        break;
      }
    }

    return allRows.map((row: any) => ({
      $id: row.$id,
      user: row.user,
      event: row.event,
      review: row.review,
      rating: row.rating,
      liked: row.liked,
      hasPurchased: row.hasPurchased,
      pointsEarned: row.pointsEarned,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
    }));
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return [];
    }
    throw new Error(error.message || 'Failed to fetch reviews');
  }
};

export const getUserReviewForEvent = async (
  userID: string,
  eventID: string
): Promise<ReviewRow | null> => {
  if (!DATABASE_ID || !REVIEWS_TABLE_ID) {
    throw new Error('Database ID or Reviews Table ID not configured.');
  }

  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: REVIEWS_TABLE_ID,
      queries: [Query.equal('user', userID), Query.equal('event', eventID)],
    });

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      $id: row.$id,
      user: row.user,
      event: row.event,
      review: row.review,
      rating: row.rating,
      liked: row.liked,
      hasPurchased: row.hasPurchased,
      pointsEarned: row.pointsEarned,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
    };
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return null;
    }
    throw new Error(error.message || 'Failed to check review status');
  }
};

export const getUserReviewsCount = async (userID: string): Promise<number> => {
  try {
    const reviews = await getUserReviews(userID);
    return reviews.length;
  } catch (error: any) {
    return 0;
  }
};

export const getEventReviews = async (eventID: string): Promise<ReviewRow[]> => {
  if (!DATABASE_ID || !REVIEWS_TABLE_ID) {
    throw new Error('Database ID or Reviews Table ID not configured.');
  }

  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: REVIEWS_TABLE_ID,
      queries: [Query.equal('event', eventID)],
    });

    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    return result.rows.map((row: any) => ({
      $id: row.$id,
      user: row.user,
      event: row.event,
      review: row.review,
      rating: row.rating,
      liked: row.liked,
      hasPurchased: row.hasPurchased,
      pointsEarned: row.pointsEarned,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
    }));
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return [];
    }
    throw new Error(error.message || 'Failed to fetch event reviews');
  }
};

