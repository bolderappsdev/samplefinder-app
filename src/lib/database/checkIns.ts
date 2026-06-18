import { ID, Query } from 'react-native-appwrite';
import { tablesDB, DATABASE_ID, USER_PROFILES_TABLE_ID } from './config';
import type { CheckInData, CheckInRow } from './types';
import { createUserNotification } from './userNotifications';
import { updateUserProfile } from './users';
import { fetchTiers, getUserCurrentTier } from './tiers';
import { BADGE_THRESHOLDS, getLastAchievedBadge } from '@/constants/Badges';
import { useTierCompletionStore } from '@/stores/tierCompletionStore';
import { sendNewTierPushNotification, sendNewBadgePushNotification } from '@/lib/notifications/tierNotifications';
import type { Tier } from '@/screens/tabs/promotions/components';

export const CHECK_INS_TABLE_ID = process.env.APPWRITE_CHECK_INS_TABLE_ID || 'checkins';
const CHECK_INS_PAGE_SIZE = 100;

export const createCheckIn = async (checkInData: CheckInData): Promise<CheckInRow> => {
  if (!DATABASE_ID || !CHECK_INS_TABLE_ID || !USER_PROFILES_TABLE_ID) {
    throw new Error('Database ID or Table ID not configured.');
  }

  try {
    const existing = await getUserCheckInForEvent(checkInData.userID, checkInData.eventID);
    if (existing) {
      throw new Error('You have already checked in to this event');
    }
    
    const userProfile = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: checkInData.userID,
    });

    if (!userProfile) {
      throw new Error('User profile not found');
    }
    
    const profile = userProfile as any;
    const oldTotalPoints = Number(profile.totalPoints) || 0;
    const newTotalPoints = oldTotalPoints + checkInData.pointsEarned;

    // Use actual check-in row count (same source as Profile / Promotions), not profile.totalEvents,
    // so badge popups and pushes stay aligned when totals drift.
    const oldEventCount = await getUserCheckInsCount(checkInData.userID);
    const newEventCount = oldEventCount + 1;

    // Check if a new badge was earned
    const oldBadgeThreshold = getLastAchievedBadge(oldEventCount);
    const newBadgeThreshold = getLastAchievedBadge(newEventCount);
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
      console.error('[checkIns] Failed to fetch tiers:', error);
    }

    const rowId = ID.unique();
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: CHECK_INS_TABLE_ID,
      rowId: rowId,
      data: {
        user: checkInData.userID,
        event: checkInData.eventID,
        points: checkInData.pointsEarned,
      },
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
        totalEvents: newEventCount,
        totalPoints: newTotalPoints,
      },
    });

    // Create check-in confirmation notification
    try {
      await createUserNotification({
        userId: authUserID,
        type: 'checkIn',
        title: 'Check-in Confirmed!',
        message: `You earned ${checkInData.pointsEarned} points! Keep exploring and earning rewards.`,
        data: {
          eventId: checkInData.eventID,
          pointsEarned: checkInData.pointsEarned,
        },
      });
    } catch (notificationError) {
      console.error('[checkIns] Failed to create check-in notification:', notificationError);
      // Don't fail the check-in if notification creation fails
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
          checkInData.pointsEarned,
          'checkin'
        );
      }
    } catch (tierError) {
      console.error('[checkIns] Failed to check tier or create tier notification:', tierError);
      // Don't fail the check-in if tier notification fails
    }

    // Create badge earned notification if applicable
    if (badgeEarned && newBadgeThreshold !== null) {
      try {
        // Create in-app notification (stored in database)
        await createUserNotification({
          userId: authUserID,
          type: 'badgeEarned',
          title: `NEW BADGE: SAMPLEFINDER CHECK-IN LEVEL ${newBadgeThreshold}`,
          message: `Congratulations, you earned the ${newBadgeThreshold} check-in level badge! Keep sampling to earn more points!`,
          data: {
            badgeType: 'events',
            badgeThreshold: newBadgeThreshold,
            achievementCount: newEventCount,
            screen: 'Profile',
          },
        });

        // Send push notification separately
        await sendNewBadgePushNotification('checkIn', newBadgeThreshold);
      } catch (badgeError) {
        console.error('[checkIns] Failed to create badge notification:', badgeError);
        // Don't fail the check-in if badge notification fails
      }
    }
    
    return {
      $id: result.$id,
      userID: checkInData.userID,
      eventID: checkInData.eventID,
      checkInCode: checkInData.checkInCode,
      pointsEarned: result.points ?? checkInData.pointsEarned,
      $createdAt: result.$createdAt,
      $updatedAt: result.$updatedAt,
      badgeEarned: badgeEarned ? {
        badgeType: 'events' as const,
        badgeNumber: newBadgeThreshold!,
        achievementCount: newEventCount,
      } : undefined,
    };
  } catch (error: any) {
    throw new Error(error.message || 'Failed to create check-in');
  }
};

export const getUserCheckIns = async (userID: string): Promise<CheckInRow[]> => {
  if (!DATABASE_ID || !CHECK_INS_TABLE_ID) {
    throw new Error('Database ID or Check-ins Table ID not configured.');
  }

  try {
    const allRows: any[] = [];
    let cursorAfter: string | null = null;

    while (true) {
      const queries = [Query.equal('user', userID), Query.limit(CHECK_INS_PAGE_SIZE)];
      if (cursorAfter) {
        queries.push(Query.cursorAfter(cursorAfter));
      }

      const result = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: CHECK_INS_TABLE_ID,
        queries,
      });

      if (!result.rows || result.rows.length === 0) {
        break;
      }

      allRows.push(...result.rows);
      cursorAfter = result.rows[result.rows.length - 1].$id;

      if (result.rows.length < CHECK_INS_PAGE_SIZE) {
        break;
      }
    }

    return allRows.map((row: any) => ({
      $id: row.$id,
      userID: typeof row.user === 'string' ? row.user : row.user?.$id ?? '',
      eventID: typeof row.event === 'string' ? row.event : row.event?.$id ?? '',
      checkInCode: '',
      pointsEarned: row.points ?? 0,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
    }));
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return [];
    }
    throw new Error(error.message || 'Failed to fetch check-ins');
  }
};

export const getUserCheckInForEvent = async (
  userID: string,
  eventID: string
): Promise<CheckInRow | null> => {
  if (!DATABASE_ID || !CHECK_INS_TABLE_ID) {
    throw new Error('Database ID or Check-ins Table ID not configured.');
  }

  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: CHECK_INS_TABLE_ID,
      queries: [Query.equal('user', userID), Query.equal('event', eventID)],
    });

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      $id: row.$id,
      userID: typeof row.user === 'string' ? row.user : row.user?.$id ?? '',
      eventID: typeof row.event === 'string' ? row.event : row.event?.$id ?? '',
      checkInCode: '',
      pointsEarned: row.points ?? 0,
      $createdAt: row.$createdAt,
      $updatedAt: row.$updatedAt,
    };
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return null;
    }
    throw new Error(error.message || 'Failed to check check-in status');
  }
};

export const getUserCheckInsCount = async (userID: string): Promise<number> => {
  try {
    const checkIns = await getUserCheckIns(userID);
    return checkIns.length;
  } catch (error: any) {
    return 0;
  }
};

