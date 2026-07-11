import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Alert, Linking, Platform, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NotificationSetting, Notification } from './components';
import { useAuthStore } from '@/stores/authStore';
import { updateNotificationPreferences } from '@/lib/database/users';
import { getUserNotifications, markNotificationsAsRead } from '@/lib/database';
import { navigateToEventDetails } from '@/lib/notifications/handlers';

export const useNotificationsScreen = () => {
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Notification settings - synced with system permission
  const [enablePushNotifications, setEnablePushNotifications] = useState(false);
  
  // Current notifications (unread)
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Previously seen notifications (read)
  const [previousNotifications, setPreviousNotifications] = useState<Notification[]>([]);

  // We don't need individual notification settings anymore
  const [notificationSettings] = useState<NotificationSetting[]>([]);

  const pendingReadIdsRef = useRef<Set<string>>(new Set());
  const isFlushingReadIdsRef = useRef(false);

  const mapNotificationToItem = useCallback(
    (notif: {
      id: string;
      title: string;
      message: string;
      isRead: boolean;
      data?: Record<string, any>;
    }): Notification => ({
      id: notif.id,
      title: notif.title,
      description: notif.message,
      isRead: notif.isRead,
      eventId: typeof notif.data?.eventId === 'string' ? notif.data.eventId : undefined,
    }),
    []
  );

  const loadNotifications = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      const user = useAuthStore.getState().user;
      if (!user) {
        console.warn('[notifications] No user logged in');
        return;
      }

      const allNotifs = await getUserNotifications(user.$id, 100);
      const unreadNotifs = allNotifs.filter((notif) => !notif.isRead);
      const readNotifs = allNotifs.filter((notif) => notif.isRead);

      setNotifications(unreadNotifs.map(mapNotificationToItem));
      setPreviousNotifications(readNotifs.map(mapNotificationToItem));
    } catch (error: any) {
      console.error('[notifications] Error loading notifications:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [mapNotificationToItem]);

  const flushPendingReadNotifications = useCallback(async () => {
    if (isFlushingReadIdsRef.current) {
      return;
    }

    isFlushingReadIdsRef.current = true;

    try {
      const user = useAuthStore.getState().user;
      if (!user) {
        console.warn('[notifications] No user logged in, cannot mark notifications as read');
        pendingReadIdsRef.current.clear();
        await loadNotifications();
        return;
      }

      while (pendingReadIdsRef.current.size > 0) {
        const notificationIds = Array.from(pendingReadIdsRef.current);
        pendingReadIdsRef.current.clear();
        await markNotificationsAsRead(user.$id, notificationIds);
      }
    } catch (error: any) {
      console.error('[notifications] Error marking notifications as read:', error);
      pendingReadIdsRef.current.clear();
      await loadNotifications();
    } finally {
      isFlushingReadIdsRef.current = false;

      if (pendingReadIdsRef.current.size > 0) {
        void flushPendingReadNotifications();
      }
    }
  }, [loadNotifications]);

  // Sync with system permission status when screen is focused or app returns from background
  useEffect(() => {
    const checkAndSyncPermissions = async () => {
      try {
        // Always check system permission first
        const { status } = await Notifications.getPermissionsAsync();
        const systemEnabled = status === 'granted';
        
        console.log('[notifications] System permission status:', status, 'systemEnabled:', systemEnabled);
        
        // Update UI to match system permission
        setEnablePushNotifications(systemEnabled);
        
        // Update database to match system permission
        const user = useAuthStore.getState().user;
        if (user) {
          await updateNotificationPreferences(user.$id, {
            enablePushNotifications: systemEnabled,
          });
        }
      } catch (error) {
        console.error('[notifications] Error checking system permissions:', error);
      }
    };

    // Check immediately when screen is focused and refetch notifications (e.g. so onboarding list updates)
    const unsubscribeFocus = navigation.addListener('focus', () => {
      checkAndSyncPermissions();
      loadNotifications();
    });

    // Check when app comes back from background (e.g., returning from system settings)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[notifications] App became active, checking permissions');
        checkAndSyncPermissions();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Also check on mount
    checkAndSyncPermissions();

    return () => {
      unsubscribeFocus();
      appStateSubscription.remove();
    };
  }, [loadNotifications, navigation]);

  // Load notifications from database on mount
  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const handleBackPress = () => {
    navigation.goBack();
  };

  const handleNotificationToggle = async (id: string) => {
    // No longer needed - we removed individual notification settings
    console.log('[notifications] Individual notification settings are no longer used');
  };

  const handlePushNotificationsChange = async (value: boolean) => {
    // If user is trying to disable notifications, guide them to system settings
    if (!value) {
      Alert.alert(
        'Disable Notifications',
        'To completely turn off notifications, you need to disable them in your device settings. Would you like to open settings now?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Open Settings',
            onPress: async () => {
              // Open system settings for the app
              if (Platform.OS === 'ios') {
                await Linking.openURL('app-settings:');
              } else {
                await Linking.openSettings();
              }
            },
          },
        ]
      );
    } else {
      // If enabling, check current permission status
      const { status: currentStatus } = await Notifications.getPermissionsAsync();
      
      if (currentStatus === 'granted') {
        // Already granted, just update preferences
        await updatePreferences(value);
        return;
      }
      
      // If permission was never asked or denied, request it
      if (currentStatus === 'undetermined' || currentStatus === 'denied') {
        console.log('[notifications] Requesting notification permissions...');
        
        // Request permissions - this will show the native system dialog
        const { status: newStatus } = await Notifications.requestPermissionsAsync();
        
        if (newStatus === 'granted') {
          console.log('[notifications] Permission granted');
          await updatePreferences(true);
        } else {
          console.log('[notifications] Permission denied:', newStatus);
          // Permission was denied, guide user to settings
          Alert.alert(
            'Permission Required',
            'Notifications are required to keep you updated. Please enable them in your device settings.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Open Settings',
                onPress: async () => {
                  if (Platform.OS === 'ios') {
                    await Linking.openURL('app-settings:');
                  } else {
                    await Linking.openSettings();
                  }
                },
              },
            ]
          );
        }
        return;
      }
    }
  };

  const updatePreferences = async (value: boolean) => {
    setEnablePushNotifications(value);

    // Save to database
    try {
      const user = useAuthStore.getState().user;
      if (!user) {
        console.warn('[notifications] No user logged in, cannot save preferences');
        return;
      }

      await updateNotificationPreferences(user.$id, {
        enablePushNotifications: value,
      });
    } catch (error: any) {
      console.error('[notifications] Error saving push notifications preference:', error);
      // Revert on error
      setEnablePushNotifications(!value);
    }
  };

  const handleNotificationPress = (notificationId: string) => {
    // Look up the tapped notification in either list (it may already be read) so we
    // know whether it's about an event before we optimistically mutate the lists.
    const tapped =
      notifications.find((n) => n.id === notificationId) ??
      previousNotifications.find((n) => n.id === notificationId);

    // Optimistically move notification to "Previously Seen" for snappy UI
    setNotifications((currentNotifications) => {
      const tappedNotification = currentNotifications.find((n) => n.id === notificationId);

      if (tappedNotification) {
        setPreviousNotifications((currentPrevious) => [
          { ...tappedNotification, isRead: true },
          ...currentPrevious.filter((n) => n.id !== notificationId),
        ]);
      }

      return currentNotifications.filter((n) => n.id !== notificationId);
    });

    pendingReadIdsRef.current.add(notificationId);
    void flushPendingReadNotifications();

    // If this notification is about an event, open its details screen.
    if (tapped?.eventId) {
      navigateToEventDetails(tapped.eventId);
    }
  };

  const handleRefresh = useCallback(() => {
    loadNotifications(true);
  }, [loadNotifications]);

  return {
    enablePushNotifications,
    notifications,
    previousNotifications,
    notificationSettings,
    isLoading,
    isRefreshing,
    handleBackPress,
    handleNotificationToggle,
    handlePushNotificationsChange,
    handleNotificationPress,
    handleRefresh,
  };
};

