import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AppState, type AppStateStatus, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '@/screens/auth/LoginScreen';
import SignUpScreen from '@/screens/auth/SignUpScreen';
import ConfirmAccountScreen from '@/screens/auth/ConfirmAccountScreen';
import ConfirmPhoneScreen from '@/screens/auth/ConfirmPhoneScreen';
import NotificationSetupScreen from '@/screens/auth/NotificationSetupScreen';
import ForgotPasswordScreen from '@/screens/auth/ForgotPasswordScreen';
import PasswordResetScreen from '@/screens/auth/PasswordResetScreen';
import TabNavigator from '@/navigation/TabNavigator';
import { useAuthStore } from '@/stores/authStore';
import { markNotificationAsRead, markBadgeTypeNotificationsAsRead } from '@/lib/database';
import { setNavigationRef, setupNotificationHandlers, getLastNotificationResponse } from '@/lib/notifications/handlers';
import { subscribeToDeepLinks, handleIncomingReferralLink } from '@/lib/deepLink';
import { DEEP_LINK_DOMAIN, CUSTOM_SCHEME } from '@/lib/deepLink.constants';
import { CustomSplashScreen } from '@/components';
import BadgeEarnedModal, { type BadgeType } from '@/components/shared/BadgeEarnedModal';
import { syncSpecialBadgeAwards, type AwardedSpecialBadge } from '@/lib/specialBadgeAwards';
import TierEarnedModal from '@/screens/tabs/promotions/components/TierEarnedModal';
import { syncTierAwards, type AwardedTier } from '@/lib/tierAwards';

export type RootStackParamList = {
  Login: undefined;
  SignUp: { referralCode?: string } | undefined;
  NotificationSetup: { phoneNumber?: string };
  ConfirmAccount: { phoneNumber?: string };
  ConfirmPhone: { phoneNumber?: string };
  ForgotPassword: { email?: string };
  PasswordReset: { email: string; userId?: string };
  MainTabs: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const SPECIAL_BADGE_SYNC_INTERVAL_MS = 3000;

const AppNavigator = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [initialRouteName, setInitialRouteName] = useState<keyof RootStackParamList>('Login');
  const navigationRef = useRef<any>(null);
  const isSyncingSpecialBadgesRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const activeSpecialBadgeAwardRef = useRef<AwardedSpecialBadge | null>(null);
  const activeTierAwardRef = useRef<AwardedTier | null>(null);
  const [pendingSpecialBadgeAwards, setPendingSpecialBadgeAwards] = useState<AwardedSpecialBadge[]>([]);
  const [activeSpecialBadgeAward, setActiveSpecialBadgeAward] = useState<AwardedSpecialBadge | null>(null);
  const [pendingTierAwards, setPendingTierAwards] = useState<AwardedTier[]>([]);
  const [activeTierAward, setActiveTierAward] = useState<AwardedTier | null>(null);

  useEffect(() => {
    activeSpecialBadgeAwardRef.current = activeSpecialBadgeAward;
  }, [activeSpecialBadgeAward]);

  useEffect(() => {
    activeTierAwardRef.current = activeTierAward;
  }, [activeTierAward]);

  const linking = useMemo<LinkingOptions<RootStackParamList>>(() => ({
    prefixes: [
      `https://${DEEP_LINK_DOMAIN}`,
      `${CUSTOM_SCHEME}://`,
    ],
    config: {
      screens: {
        SignUp: 'referral/:referralCode',
      },
    },
    async getInitialURL() {
      // Always read the cold-start URL first. Previously we bailed out when
      // getLastNotificationResponseAsync() was truthy, which skipped calling
      // Linking.getInitialURL() entirely — so referral links (e.g. WhatsApp)
      // were never stored and SignUp did not open with the code.
      const url = await Linking.getInitialURL();
      const lastNotification = await Notifications.getLastNotificationResponseAsync();

      if (url) {
        await handleIncomingReferralLink(url);
      }

      // Notification tap: prefer in-app navigation for this launch; do not also
      // route React Navigation to SignUp from the same URL.
      if (lastNotification) {
        return null;
      }

      if (!url) return null;

      try {
        const user = useAuthStore.getState().user;
        if (user) return null;
      } catch {
        // not signed in — let the linking config route to SignUp
      }

      return url;
    },
    subscribe(listener) {
      // Subscribe to deep links (warm/hot start).
      // For signed-in users, intercept and show alert instead of navigating.
      const linkingSub = Linking.addEventListener('url', async ({ url }) => {
        try {
          const user = useAuthStore.getState().user;
          if (user) {
            await handleIncomingReferralLink(url);
            return;
          }
        } catch {
          // not signed in
        }
        // Persist referral before React Navigation navigates so SignUp can read storage on mount.
        await handleIncomingReferralLink(url);
        listener(url);
      });

      return () => linkingSub.remove();
    },
  }), []);

  useEffect(() => {
    checkAuthSession();
    const cleanupHandlers = setupNotificationHandlers();

    // Check for notification that opened the app
    getLastNotificationResponse();

    return () => {
      cleanupHandlers();
    };
  }, []);

  // Handle deep links when user is already authenticated (warm start)
  useEffect(() => {
    const unsubscribe = subscribeToDeepLinks((code) => {
      // If user is logged in, the alert is shown by handleIncomingReferralLink.
      // If user is not logged in, React Navigation linking config handles routing to SignUp.
      console.log('[AppNavigator] Deep link referral code received:', code);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runSpecialBadgeSync = async () => {
      if (appStateRef.current !== 'active') {
        return;
      }
      if (isSyncingSpecialBadgesRef.current) {
        return;
      }

      isSyncingSpecialBadgesRef.current = true;
      try {
        const newlyAwardedBadges = await syncSpecialBadgeAwards();
        const newlyAwardedTiers = await syncTierAwards();

        if (newlyAwardedBadges.length > 0) {
          setPendingSpecialBadgeAwards((current) => {
            const queuedIds = new Set(
              current.map((badge) => badge.notificationId).filter(Boolean)
            );
            const activeNotificationId = activeSpecialBadgeAwardRef.current?.notificationId;
            const filteredNewBadges = newlyAwardedBadges.filter((badge) => {
              const nid = badge.notificationId;
              if (nid && activeNotificationId && nid === activeNotificationId) {
                return false;
              }
              if (nid && queuedIds.has(nid)) {
                return false;
              }
              if (nid) {
                queuedIds.add(nid);
              }
              return true;
            });

            if (filteredNewBadges.length === 0) {
              return current;
            }

            return [...current, ...filteredNewBadges];
          });
        }

        if (newlyAwardedTiers.length > 0) {
          setPendingTierAwards((current) => {
            const queuedTierIds = new Set(current.map((award) => award.tier.id));
            const activeTierId = activeTierAwardRef.current?.tier.id;
            const filteredNewTierAwards = newlyAwardedTiers.filter((award) => {
              if (activeTierId && award.tier.id === activeTierId) {
                return false;
              }
              if (queuedTierIds.has(award.tier.id)) {
                return false;
              }
              queuedTierIds.add(award.tier.id);
              return true;
            });

            if (filteredNewTierAwards.length === 0) {
              return current;
            }

            return [...current, ...filteredNewTierAwards];
          });
        }
      } catch (error) {
        console.error('[AppNavigator] Failed syncing awards:', error);
      } finally {
        isSyncingSpecialBadgesRef.current = false;
      }
    };

    runSpecialBadgeSync();
    intervalId = setInterval(runSpecialBadgeSync, SPECIAL_BADGE_SYNC_INTERVAL_MS);

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (nextState === 'active' && wasBackground) {
        runSpecialBadgeSync();
      }
    });

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (activeSpecialBadgeAward || pendingSpecialBadgeAwards.length === 0) {
      return;
    }

    const [nextBadgeAward, ...rest] = pendingSpecialBadgeAwards;
    setActiveSpecialBadgeAward(nextBadgeAward);
    setPendingSpecialBadgeAwards(rest);

    // Mark as read immediately so the polling loop won't re-queue this notification
    // while the modal is still open, and clears any old orphaned unread entries
    // for the same badge type so they never resurface as duplicate popups.
    const user = useAuthStore.getState().user;
    if (user) {
      markBadgeTypeNotificationsAsRead(user.$id, nextBadgeAward.type).catch((err) => {
        console.warn('[AppNavigator] Failed to pre-mark badge notifications as read:', err);
      });
    }
  }, [activeSpecialBadgeAward, pendingSpecialBadgeAwards]);

  useEffect(() => {
    if (activeTierAward || pendingTierAwards.length === 0) {
      return;
    }

    const [nextTierAward, ...rest] = pendingTierAwards;
    setActiveTierAward(nextTierAward);
    setPendingTierAwards(rest);
  }, [activeTierAward, pendingTierAwards]);

  const checkAuthSession = async () => {
    try {
      const user = await useAuthStore.getState().fetchUser();

      if (user) {
        setInitialRouteName('MainTabs');
      } else {
        setInitialRouteName('Login');
      }
    } catch (error: any) {
      console.error('[AppNavigator] Error checking session:', error);
      // On error, default to Login screen
      setInitialRouteName('Login');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <CustomSplashScreen />;
  }

  const activeSpecialBadgeType: BadgeType = activeSpecialBadgeAward?.type ?? 'events';
  const handleCloseSpecialBadgeModal = () => {
    setActiveSpecialBadgeAward(null);
  };

  const handleCloseTierModal = async () => {
    const notificationId = activeTierAward?.notificationId;
    setActiveTierAward(null);

    if (!notificationId) {
      return;
    }

    try {
      const user = useAuthStore.getState().user;
      if (!user) {
        return;
      }
      await markNotificationAsRead(user.$id, notificationId);
    } catch (error) {
      console.warn('[AppNavigator] Failed to mark tier notification as read:', error);
    }
  };

  return (
    <>
      <NavigationContainer
        linking={linking}
        ref={(ref) => {
          navigationRef.current = ref;
          setNavigationRef(ref);
        }}
      >
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#2D1B69' },
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
          <Stack.Screen name="NotificationSetup" component={NotificationSetupScreen} />
          <Stack.Screen name="ConfirmAccount" component={ConfirmAccountScreen} />
          <Stack.Screen name="ConfirmPhone" component={ConfirmPhoneScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="PasswordReset" component={PasswordResetScreen} />
          <Stack.Screen name="MainTabs" component={TabNavigator} />
        </Stack.Navigator>
      </NavigationContainer>

      {/*
        Render award modals outside NavigationContainer so RN Modal sits above the native stack
        (inside the container they can be hidden behind react-native-screens on device).
      */}
      <BadgeEarnedModal
        visible={Boolean(activeSpecialBadgeAward)}
        badgeType={activeSpecialBadgeType}
        onClose={handleCloseSpecialBadgeModal}
      />

      <TierEarnedModal
        visible={Boolean(activeTierAward)}
        tier={activeTierAward?.tier}
        points={
          (activeTierAward?.tier.order ?? 1) === 1
            ? 100
            : (activeTierAward?.tier.requiredPoints ?? 0)
        }
        onClose={handleCloseTierModal}
      />
    </>
  );
};

export default AppNavigator;

