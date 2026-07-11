import * as Notifications from 'expo-notifications';
import { NavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationData } from './types';
import { useAuthStore } from '@/stores/authStore';
import { createUserNotification } from '@/lib/database';
import type { NotificationType } from '@/lib/database/types';

let navigationRef: NavigationContainerRef<any> | null = null;

// In-memory cache backed by AsyncStorage for cross-session dedup
const persistedNotificationIds = new Set<string>();
const MAX_TRACKED_NOTIFICATIONS = 250;
const trackedNotificationQueue: string[] = [];
const PERSISTED_IDS_STORAGE_KEY = '@persisted_notification_ids';
let persistedIdsLoaded = false;

/**
 * Load persisted notification IDs from AsyncStorage into the in-memory Set.
 * Called once on first notification interaction.
 */
const ensurePersistedIdsLoaded = async (): Promise<void> => {
  if (persistedIdsLoaded) return;
  try {
    const stored = await AsyncStorage.getItem(PERSISTED_IDS_STORAGE_KEY);
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      for (const id of ids) {
        persistedNotificationIds.add(id);
        trackedNotificationQueue.push(id);
      }
    }
    persistedIdsLoaded = true;
  } catch (err) {
    console.warn('[notifications] Failed to load persisted notification IDs:', err);
    persistedIdsLoaded = true;
  }
};

/**
 * Flush the current dedup set to AsyncStorage so it survives app restarts.
 */
const flushPersistedIds = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(
      PERSISTED_IDS_STORAGE_KEY,
      JSON.stringify(trackedNotificationQueue)
    );
  } catch (err) {
    console.warn('[notifications] Failed to flush persisted notification IDs:', err);
  }
};

const KNOWN_NOTIFICATION_TYPES: NotificationType[] = [
  'checkIn',
  'review',
  'tierChanged',
  'badgeEarned',
  'eventAdded',
  'eventReminder',
  'favoriteBrandUpdate',
];

const normalizeNotificationType = (rawType: unknown): NotificationType => {
  if (typeof rawType !== 'string') {
    return 'eventAdded';
  }

  if (rawType === 'event_reminder') {
    return 'eventReminder';
  }

  if (KNOWN_NOTIFICATION_TYPES.includes(rawType as NotificationType)) {
    return rawType as NotificationType;
  }

  return 'eventAdded';
};

const markNotificationPersisted = (notificationId: string) => {
  if (persistedNotificationIds.has(notificationId)) {
    return;
  }

  persistedNotificationIds.add(notificationId);
  trackedNotificationQueue.push(notificationId);

  if (trackedNotificationQueue.length > MAX_TRACKED_NOTIFICATIONS) {
    const oldestId = trackedNotificationQueue.shift();
    if (oldestId) {
      persistedNotificationIds.delete(oldestId);
    }
  }

  // Persist to AsyncStorage (fire-and-forget)
  flushPersistedIds();
};

/**
 * Keys the OS / FCM inject into a remote notification's raw payload that are
 * not part of our application data.
 */
const isReservedPushPayloadKey = (key: string): boolean =>
  key === 'aps' || key.startsWith('gcm.') || key.startsWith('google.');

/**
 * Resolve a push notification's application data (eventId, type, screen, …).
 *
 * Android (and Expo-formatted pushes) populate `content.data`, so we use it
 * directly. iOS FCM pushes do NOT: for a REMOTE notification expo-notifications
 * only maps `userInfo["body"]` into `content.data`, but our server sends the
 * data flat (no `body` wrapper), so `content.data` comes back empty. The full
 * raw APNs `userInfo` — which still carries `eventId` etc. at the top level —
 * is exposed on the push trigger's `payload`, so we fall back to it (minus the
 * reserved APNs/FCM bookkeeping keys). Local notifications and Android are
 * unaffected because their `content.data` is already populated.
 */
const resolveNotificationData = (
  notification: Notifications.Notification
): NotificationData => {
  const contentData = (notification.request.content.data ?? {}) as NotificationData;
  if (Object.keys(contentData).length > 0) {
    return contentData;
  }

  const rawPayload = (notification.request.trigger as any)?.payload;
  if (rawPayload && typeof rawPayload === 'object') {
    const appData: NotificationData = {};
    for (const [key, value] of Object.entries(rawPayload as Record<string, unknown>)) {
      if (!isReservedPushPayloadKey(key)) {
        appData[key] = value;
      }
    }
    return appData;
  }

  return contentData;
};

/**
 * Add any push notification to the user's in-app notifications list.
 * Deduplicates by notification request identifier to avoid saving the same push twice
 * when both "received" and "response" listeners fire.
 */
const addPushToInAppNotifications = async (
  notification: Notifications.Notification,
  source: 'foreground' | 'response' | 'cold_start'
) => {
  const notificationId = notification.request.identifier;
  const traceId = `${notificationId}-${Date.now()}`;

  // Load persisted IDs from disk if first time
  await ensurePersistedIdsLoaded();

  if (notificationId && persistedNotificationIds.has(notificationId)) {
    console.log(`[notifications][${traceId}] Skipped duplicate (source=${source}, id=${notificationId})`);
    return;
  }

  // Mark immediately to prevent concurrent calls from duplicating
  if (notificationId) {
    markNotificationPersisted(notificationId);
  }

  try {
    const user = useAuthStore.getState().user;
    if (!user) return;

    // Prefer content.data; fall back to the raw push payload on iOS (see
    // resolveNotificationData) so eventId/type survive into the stored record.
    const data = resolveNotificationData(notification) as NotificationData & {
      type?: string;
      eventId?: string;
      reminderType?: string;
    };

    // Skip regular badge-earned notifications (events/reviews milestones) as they're already persisted
    // by their dedicated code paths (createCheckIn, createReview).
    // BUT allow ambassador/influencer badges through as they may come from admin while app is closed.
    const normalizedType = normalizeNotificationType(data?.type);
    if (normalizedType === 'badgeEarned') {
      const badgeType = data?.badgeType as string;
      // Only skip regular milestone badges (events/reviews), not special badges (ambassador/influencer)
      if (badgeType === 'events' || badgeType === 'reviews') {
        console.log(`[notifications][${traceId}] Skipped milestone badge push persistence (source=${source}, type=${badgeType})`);
        return;
      }
      // Allow ambassador/influencer badges to be persisted so popup can show on app launch
      console.log(`[notifications][${traceId}] Allowing special badge push persistence (source=${source}, type=${badgeType})`);
    }

    const title = notification.request.content.title || 'Notification';
    const body = notification.request.content.body || 'You have a new notification.';

    const payloadData: Record<string, unknown> = {};
    Object.entries(data || {}).forEach(([key, value]) => {
      payloadData[key] = value;
    });

    // For badge notifications, infer badgeType from title if not explicitly provided
    if (normalizedType === 'badgeEarned' && !payloadData.badgeType) {
      if (title.toLowerCase().includes('ambassador')) {
        payloadData.badgeType = 'ambassador';
        payloadData.isSpecialBadge = true;
        payloadData.screen = 'Profile';
      } else if (title.toLowerCase().includes('influencer')) {
        payloadData.badgeType = 'influencer';
        payloadData.isSpecialBadge = true;
        payloadData.screen = 'Profile';
      }
    }

    console.log(`[notifications][${traceId}] Persisting in-app notification (source=${source}, type=${data?.type}, badgeType=${payloadData.badgeType}, title="${title}")`);

    await createUserNotification({
      userId: user.$id,
      type: normalizedType,
      title,
      message: body,
      data: payloadData,
      skipPush: true,
      isRead: false, // Ensure notifications are created as unread for proper display
    });

    console.log(`[notifications][${traceId}] Successfully persisted`);
  } catch (err) {
    console.warn(`[notifications][${traceId}] Failed to add push notification to in-app list:`, err);
  }
};

/**
 * Set navigation reference for deep linking
 */
export const setNavigationRef = (ref: NavigationContainerRef<any> | null) => {
  navigationRef = ref;
};

/**
 * Get navigation reference for navigation from anywhere in the app
 */
export const getNavigationRef = (): NavigationContainerRef<any> | null => {
  return navigationRef;
};

/**
 * Navigate to an event's details screen from anywhere, including outside React
 * (push notification handlers, the in-app notification list). The event details
 * screen is registered as "BrandDetails" inside HomeStack, so we route through
 * MainTabs → Home → BrandDetails (the same nav-ref pattern used elsewhere, e.g.
 * FavoriteBrandItem). Returns false if the navigator isn't ready yet.
 */
export const navigateToEventDetails = (eventId: string): boolean => {
  if (!navigationRef) {
    console.warn('[notifications] No navigation ref available to open event details');
    return false;
  }

  (navigationRef as any).navigate('MainTabs', {
    screen: 'Home',
    params: {
      screen: 'BrandDetails',
      params: { eventId },
    },
  });
  return true;
};

/**
 * Handle notification tap and navigate to appropriate screen
 */
const handleNotificationTap = (notification: Notifications.Notification): boolean => {
  console.log('[notifications] Notification tapped:', notification);
  
  const data = resolveNotificationData(notification);
  const title = notification.request.content.title || '';

  if (!data || Object.keys(data).length === 0) {
    console.warn('[notifications] No notification data available');
    return true; // nothing to act on — treat as handled
  }
  if (!navigationRef) {
    // Navigator not mounted yet (possible on a slow cold start). Report "not handled"
    // so the caller leaves the stored response in place and retries on the next launch.
    console.warn('[notifications] Navigation not ready; deferring notification tap');
    return false;
  }
  
  // For special badge notifications (ambassador/influencer), don't navigate immediately
  // Let the badge sync system show the popup modal first
  const isSpecialBadgeNotification = data.type === 'badgeEarned' && 
    (data.badgeType === 'ambassador' || data.badgeType === 'influencer' ||
     title.toLowerCase().includes('ambassador') || title.toLowerCase().includes('influencer'));
  
  if (isSpecialBadgeNotification) {
    console.log('[notifications] Special badge notification - skipping navigation to let popup show');
    return true; // handled: intentionally no navigation (badge modal shows instead)
  }
  
  try {
    // Event notifications carry an eventId (server-sent reminders, "sampling today",
    // "nearby event", and the client "added to calendar" push). Open the event directly.
    // We key off eventId rather than `data.screen` because server-sent event pushes
    // historically omit `screen`, which previously made tapping them do nothing.
    if (data.eventId) {
      console.log('[notifications] Opening event details from tap, eventId:', data.eventId);
      return navigateToEventDetails(data.eventId);
    }

    // Non-event notifications route by their `screen` field.
    if (data.screen) {
      const screenName = data.screen;
      const params: any = {};
      
      if (data.clientId) {
        params.clientId = data.clientId;
      }
      
      // Merge any additional params from notification data
      Object.keys(data).forEach((key) => {
        if (key !== 'screen' && key !== 'type') {
          params[key] = data[key];
        }
      });
      
      console.log('[notifications] Navigating to:', screenName, params);
      
      // Navigate to the screen
      // Use type assertion to handle nested navigation
      const nav = navigationRef as any;
      
      if (screenName === 'BrandDetails' && params.clientId) {
        // Legacy path: some pushes reference the event by clientId instead of eventId
        nav.navigate('MainTabs', {
          screen: 'Home',
          params: {
            screen: 'BrandDetails',
            params: { eventId: params.clientId },
          },
        });
      } else if (screenName === 'Profile') {
        nav.navigate('MainTabs', {
          screen: 'Profile',
        });
      } else if (screenName === 'Notifications') {
        nav.navigate('MainTabs', {
          screen: 'Profile',
          params: {
            screen: 'Notifications',
          },
        });
      } else {
        // Default navigation
        nav.navigate(screenName, params);
      }
    }
    return true; // handled (routed by screen, or no actionable route present)
  } catch (error: any) {
    console.error('[notifications] Error navigating from notification:', error);
    return true; // consumed — avoid retrying a hard failure on every launch
  }
};

/**
 * Clear the OS-stored "last notification response" once we've handled it. Without
 * this, expo-notifications keeps returning the same response on every subsequent
 * cold start, which would re-open the last event's details every time the app is
 * launched from quit. Safe no-op if the native module doesn't support clearing.
 */
const clearLastNotificationResponseSafely = () => {
  try {
    Notifications.clearLastNotificationResponse();
  } catch (err) {
    console.warn('[notifications] Failed to clear last notification response:', err);
  }
};

/**
 * Set up notification handlers.
 * Returns a cleanup function that removes the listeners — call it in your
 * useEffect cleanup to prevent listener accumulation on component remount.
 */
export const setupNotificationHandlers = (): (() => void) => {
  console.log('[notifications] Setting up notification handlers...');

  // Handle notifications received while app is in foreground
  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    console.log('[notifications] Notification received (foreground):', notification.request.identifier);
    addPushToInAppNotifications(notification, 'foreground');
  });

  // Handle notification taps — dedup already handled inside addPushToInAppNotifications
  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('[notifications] Notification response received:', response.notification.request.identifier);
    addPushToInAppNotifications(response.notification, 'response');
    const handled = handleNotificationTap(response.notification);
    if (handled) {
      // Consume the response so it isn't replayed on the next cold start.
      clearLastNotificationResponseSafely();
    }
  });

  console.log('[notifications] Notification handlers set up');

  return () => {
    console.log('[notifications] Removing notification handlers');
    receivedSub.remove();
    responseSub.remove();
  };
};

/**
 * Get last notification response (for handling notifications when app opens from quit state)
 */
export const getLastNotificationResponse = async (): Promise<Notifications.NotificationResponse | null> => {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response) {
      console.log('[notifications] Last notification response found:', response.notification.request.identifier);
      addPushToInAppNotifications(response.notification, 'cold_start');
      // Handle the notification after a short delay to give the navigator time to mount.
      // Only clear the stored response once it was actually handled; if navigation wasn't
      // ready yet, leave it in place so the next launch retries instead of dropping it.
      setTimeout(() => {
        const handled = handleNotificationTap(response.notification);
        if (handled) {
          clearLastNotificationResponseSafely();
        }
      }, 1000);
    }
    return response;
  } catch (error: any) {
    console.error('[notifications] Error getting last notification response:', error);
    return null;
  }
};

