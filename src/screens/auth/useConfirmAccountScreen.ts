import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/AppNavigator';
import { verifyEmail, sendEmailOTP, resendVerificationEmail, logout, deleteAccountById } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { getUserProfile } from '@/lib/database';
import { completeSignupOnboarding } from '@/lib/signupOnboarding';
import { CodeInputRef } from '@/components/shared/CodeInput';
import { PHONE_VERIFICATION_ENABLED } from '@/constants/featureFlags';

type ConfirmAccountScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ConfirmAccount'>;

/** Matches password reset; reduces consecutive API calls and rate-limit errors. */
const RESEND_COOLDOWN_SECONDS = 60;

export const useConfirmAccountScreen = () => {
  const navigation = useNavigation<ConfirmAccountScreenNavigationProp>();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);
  const codeInputRef = useRef<CodeInputRef>(null);
  /** Set after a successful verify so the beforeRemove listener does not block onward navigation. */
  const verificationCompletedRef = useRef(false);
  /** Set while abandonment is in progress so beforeRemove allows the actual goBack. */
  const allowLeaveRef = useRef(false);
  // Seed synchronously from the auth store so an early Back tap (before initializeOTP
  // finishes) still has the userId needed to delete the unverified account.
  const userIdRef = useRef(useAuthStore.getState().user?.$id ?? '');

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

  useEffect(() => {
    // Get current user, delete session, and send OTP
    const initializeOTP = async () => {
      try {
        // Step 1: Get current user from session
        // Add a small delay to ensure session is available after navigation
        await new Promise(resolve => setTimeout(resolve, 100));
        const user = await useAuthStore.getState().fetchUser();
        if (!user) {
          console.error('[ConfirmAccount] No user found in session');
          setError('Session expired. Please sign in again to verify your account.');
          setTimeout(() => {
            navigation.replace('Login');
          }, 2000);
          return;
        }

        const userEmail = user.email;
        const userUserId = user.$id;

        // Step 2: Delete the current session
        try {
          await logout();
        } catch (logoutError: any) {
          console.warn('[ConfirmAccount] Error deleting session (may not exist):', logoutError?.message);
          // Continue anyway
        }
        useAuthStore.getState().clearUser();

        // Step 3: Send Email OTP using createEmailToken
        await sendEmailOTP(userUserId, userEmail);

        // Set state and cooldown (initial OTP was just sent)
        setEmail(userEmail);
        setUserId(userUserId);
        userIdRef.current = userUserId;
        setResendTimer(RESEND_COOLDOWN_SECONDS);
        setCanResend(false);
      } catch (error: any) {
        console.error('[ConfirmAccount] Error initializing OTP:', error);
        const errorMsg = error?.message || 'Failed to send verification code. Please try again.';
        setError(errorMsg);
        setTimeout(() => {
          navigation.replace('Login');
        }, 3000);
      }
    };

    initializeOTP();

    // Focus the code input when the screen mounts
    const timer = setTimeout(() => {
      codeInputRef.current?.focus();
    }, 100); // Small delay to ensure the component is fully rendered

    return () => clearTimeout(timer);
  }, [navigation]);

  const handleVerify = async () => {
    if (!userId) {
      setError('User information not available. Please try again.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await verifyEmail(userId, code);

      // Phone verification enabled: hand off to the phone step, which runs the
      // shared onboarding after BOTH verifications.
      if (PHONE_VERIFICATION_ENABLED) {
        let phoneNumber: string | undefined;
        try {
          const profile = await getUserProfile(userId);
          phoneNumber = profile?.phoneNumber || undefined;
        } catch {
          // Display-only; ConfirmPhone re-fetches if needed.
        }
        await useAuthStore.getState().fetchUser();
        verificationCompletedRef.current = true;
        navigation.reset({
          index: 0,
          routes: [{ name: 'ConfirmPhone' as never, params: { phoneNumber } as never }],
        });
        return;
      }

      // Phone verification disabled: complete onboarding now (same behavior as
      // before this feature, via the shared helper).
      await completeSignupOnboarding(userId);

      verificationCompletedRef.current = true;
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' as never }],
      });
    } catch (error: any) {
      console.error('[ConfirmAccount] Verification error:', error);
      const errorMsg = error?.message || 'Failed to verify email. Please check your code.';
      setError(errorMsg);
      setCode(''); // Clear the code on error
      codeInputRef.current?.focus(); // Refocus the input
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!userId || !email) {
      setError('User information not available. Please try again.');
      return;
    }

    if (!canResend) {
      return;
    }

    setIsResending(true);
    setError('');
    setCode(''); // Clear current code

    try {
      await resendVerificationEmail(userId, email);
      setError(''); // Clear any previous errors
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      setCanResend(false);
    } catch (error: any) {
      console.error('[ConfirmAccount] Resend error:', error);
      const errorMsg = error?.message || 'Failed to resend verification code. Please try again.';
      setError(errorMsg);
    } finally {
      setIsResending(false);
    }
  };

  const handleCodeChange = (text: string) => {
    setCode(text);
    setError(''); // Clear error when user types
  };

  const handleCodeComplete = (completedCode: string) => {
    // Code completion is handled - user can now click verify button
  };

  /**
   * Delete the just-created (unverified) account and return to Sign Up so the user
   * can correct mistakes like a wrong email. Without this the email/username/phone
   * remain "taken" in Appwrite and the user is stranded.
   */
  const abandonAndGoBack = useCallback(async () => {
    if (isAbandoning) return;
    setIsAbandoning(true);
    setError('');
    try {
      if (userIdRef.current) {
        try {
          await deleteAccountById(userIdRef.current);
        } catch (deleteError: any) {
          console.warn('[ConfirmAccount] Failed to delete unverified account:', deleteError?.message);
          // Surface the failure but still let the user leave — staying on this dead-end
          // screen is worse than an orphan account they can clean up via support.
          setError(
            'We could not fully discard the unverified account. You may need to contact support if you cannot sign up again.'
          );
        }
      }
      allowLeaveRef.current = true;
      // Pop this OTP frame off the stack instead of navigate('SignUp'), which can leave
      // ConfirmAccount in history — then tapping back from SignUp returns here instead
      // of going to Login. goBack() is unambiguous: SignUp is always the previous frame
      // because we got here via navigation.navigate('ConfirmAccount') from SignUp.
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate('SignUp' as never);
      }
    } finally {
      setIsAbandoning(false);
    }
  }, [isAbandoning, navigation]);

  const handleBack = useCallback(() => {
    if (isLoading || isAbandoning) return;
    Alert.alert(
      'Go back to sign up?',
      'Your unverified account will be discarded so you can fix any mistakes (like a wrong email) and sign up again.',
      [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Go back', style: 'destructive', onPress: () => { void abandonAndGoBack(); } },
      ]
    );
  }, [isLoading, isAbandoning, abandonAndGoBack]);

  // Catch hardware back (Android) and swipe-back (iOS) so users can't strand orphan
  // accounts by gesturing past the screen. Skip when verification already succeeded
  // (we're navigating to MainTabs) or when we're already doing the cleanup.
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
    email,
    userId,
    isLoading,
    isResending,
    isAbandoning,
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

