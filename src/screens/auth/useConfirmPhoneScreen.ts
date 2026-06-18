// samplefinder-app/src/screens/auth/useConfirmPhoneScreen.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/AppNavigator';
import { sendPhoneVerification, verifyPhone, logout } from '@/lib/auth';
import { markPhoneVerified, getUserProfile } from '@/lib/database';
import { useAuthStore } from '@/stores/authStore';
import { completeSignupOnboarding } from '@/lib/signupOnboarding';
import { CodeInputRef } from '@/components/shared/CodeInput';

type ConfirmPhoneNavProp = NativeStackNavigationProp<RootStackParamList, 'ConfirmPhone'>;
type ConfirmPhoneRouteProp = RouteProp<RootStackParamList, 'ConfirmPhone'>;

/** Matches the email screen; reduces consecutive API calls and rate-limit errors. */
const RESEND_COOLDOWN_SECONDS = 60;

export const useConfirmPhoneScreen = () => {
  const navigation = useNavigation<ConfirmPhoneNavProp>();
  const route = useRoute<ConfirmPhoneRouteProp>();
  const [code, setCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState(route.params?.phoneNumber ?? '');
  const [userId, setUserId] = useState(useAuthStore.getState().user?.$id ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const codeInputRef = useRef<CodeInputRef>(null);
  const sentRef = useRef(false);
  const verificationCompletedRef = useRef(false);
  const allowLeaveRef = useRef(false);

  useEffect(() => {
    if (resendTimer > 0) {
      const interval = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [resendTimer]);

  // Send the SMS once on mount. The active session was (re)established by the
  // email-OTP step, and the account phone was set during signup().
  useEffect(() => {
    const init = async () => {
      try {
        const user = useAuthStore.getState().user ?? (await useAuthStore.getState().fetchUser());
        if (!user) {
          setError('Session expired. Please sign in again to verify your phone.');
          setTimeout(() => navigation.replace('Login'), 2000);
          return;
        }
        setUserId(user.$id);

        if (!phoneNumber) {
          try {
            const profile = await getUserProfile(user.$id);
            if (profile?.phoneNumber) setPhoneNumber(profile.phoneNumber);
          } catch {
            // Display-only; ignore.
          }
        }

        if (!sentRef.current) {
          sentRef.current = true;
          await sendPhoneVerification();
          setResendTimer(RESEND_COOLDOWN_SECONDS);
          setCanResend(false);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to send verification code. Please try again.');
      }
    };
    init();

    const timer = setTimeout(() => codeInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [navigation, phoneNumber]);

  const handleVerify = async () => {
    if (!userId) {
      setError('User information not available. Please try again.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await verifyPhone(userId, code);
      await markPhoneVerified(userId);

      // One-time onboarding, run after BOTH verifications. Shared with the
      // email-only path (Task 6) via completeSignupOnboarding.
      await completeSignupOnboarding(userId);

      verificationCompletedRef.current = true;
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] });
    } catch (error: any) {
      console.error('[ConfirmPhone] Verification error:', error);
      setError(error?.message || 'Failed to verify phone. Please check your code.');
      setCode('');
      codeInputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!canResend) return;
    setIsResending(true);
    setError('');
    setCode('');
    try {
      await sendPhoneVerification();
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      setCanResend(false);
    } catch (error: any) {
      setError(error?.message || 'Failed to resend verification code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  const handleCodeChange = (text: string) => {
    setCode(text);
    setError('');
  };

  const handleCodeComplete = (_completedCode: string) => {
    // User taps Verify; no auto-submit (mirrors the email screen).
  };

  // Phone is mandatory. Leaving logs the user out and returns to Login; the
  // phoneVerified gate (Tasks 6/7) re-routes them here on next login. The
  // account is email-verified and valid, so it is NOT deleted.
  const leaveToLogin = useCallback(async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      try {
        await logout();
      } catch (e: any) {
        console.warn('[ConfirmPhone] Logout during leave failed:', e?.message);
      }
      useAuthStore.getState().clearUser();
      allowLeaveRef.current = true;
      navigation.reset({ index: 0, routes: [{ name: 'Login' as never }] });
    } finally {
      setIsLeaving(false);
    }
  }, [isLeaving, navigation]);

  const handleBack = useCallback(() => {
    if (isLoading || isLeaving) return;
    Alert.alert(
      'Verify later?',
      'You must verify your phone number to use SampleFinder. You will be signed out and can finish verifying the next time you log in.',
      [
        { text: 'Keep verifying', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { void leaveToLogin(); } },
      ]
    );
  }, [isLoading, isLeaving, leaveToLogin]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (verificationCompletedRef.current || allowLeaveRef.current) return;
      e.preventDefault();
      handleBack();
    });
    return unsubscribe;
  }, [navigation, handleBack]);

  return {
    code,
    phoneNumber,
    isLoading,
    isResending,
    isLeaving,
    resendTimer,
    canResend,
    error,
    codeInputRef,
    handleCodeChange,
    handleCodeComplete,
    handleVerify,
    handleResendCode,
    handleBack,
  };
};
