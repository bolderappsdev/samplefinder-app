import { useState, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/AppNavigator';
import { login } from '@/lib/auth';
import { initializePushNotifications } from '@/lib/notifications';
import { useAuthStore } from '@/stores/authStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { getUserProfile } from '@/lib/database';
import { getRememberedEmail, saveRememberedEmail, clearRememberedEmail } from '@/lib/rememberedLogin';

type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

export const useLoginScreen = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    getRememberedEmail().then((savedEmail) => {
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    });
  }, []);

  const validateForm = (): boolean => {
    let isValid = true;

    // Clear previous errors
    setEmailError('');
    setPasswordError('');
    setAuthError('');

    // Validate email
    if (!email.trim()) {
      setEmailError('Please enter your email address');
      isValid = false;
    } else {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setEmailError('Please enter a valid email address.');
        isValid = false;
      }
    }

    // Validate password
    if (!password) {
      setPasswordError('Please enter your password');
      isValid = false;
    } else if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      isValid = false;
    }

    return isValid;
  };

  const handleLoginError = (error: any): void => {
    const errorMessage = error?.message || '';
    
    // Clear previous errors
    setEmailError('');
    setPasswordError('');
    setAuthError('');

    // Check for invalid credentials - show in central location
    if (errorMessage.includes('Invalid credentials')) {
      setAuthError("Your information doesn't match our records.");
      return;
    }
    
    // Check for authentication failed - show in central location
    if (errorMessage.toLowerCase().includes('authentication failed')) {
      setAuthError("Your information doesn't match our records.");
      return;
    }
    
    // Check for account not found - show in central location
    if (errorMessage.toLowerCase().includes('user') && 
        (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('does not exist'))) {
      setAuthError("Your information doesn't match our records.");
      return;
    }
    
    // Check for email validation errors - show under email field
    if (errorMessage.toLowerCase().includes('email') && 
        (errorMessage.toLowerCase().includes('valid') || errorMessage.toLowerCase().includes('invalid'))) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    
    // Check for password errors - show under password field
    if (errorMessage.toLowerCase().includes('password')) {
      setPasswordError(errorMessage);
      return;
    }
    
    // Network or server errors - show in central location
    if (errorMessage.toLowerCase().includes('network') || 
        errorMessage.toLowerCase().includes('fetch') || 
        errorMessage.toLowerCase().includes('timeout')) {
      setAuthError('Network error. Please check your connection.');
      return;
    }
    
    // Default fallback - show in central location
    setAuthError(errorMessage || "Your information doesn't match our records.");
  };

  const handleLogin = async () => {
    // Clear errors before validation
    setEmailError('');
    setPasswordError('');
    setAuthError('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const user = await login({
        email: email.trim(),
        password: password,
      });

      // Persist or clear remembered email based on checkbox
      if (rememberMe) {
        await saveRememberedEmail(email.trim());
      } else {
        await clearRememberedEmail();
      }

      // Sync Zustand with the new Appwrite session (logout/login does not run AppNavigator's initial fetchUser)
      const authedUser = await useAuthStore.getState().fetchUser();

      // Hydrate favorites for this account so brand/event details show the correct
      // favorite state immediately — without waiting for the user to open the
      // Favourites tab.
      if (authedUser) {
        try {
          const profile = await getUserProfile(authedUser.$id);
          useFavoritesStore.getState().setFavorites(profile?.favoriteIds ?? []);
        } catch (favoritesError) {
          console.warn('[LoginScreen] Failed to hydrate favorites store:', favoritesError);
          useFavoritesStore.getState().clear();
        }
      }

      // Check if email is already verified
      if (user.emailVerification) {
        // Email already verified - go straight to main app
        console.log('[LoginScreen] Email already verified, navigating to MainTabs');
        
        // Initialize push notifications for returning verified users
        initializePushNotifications().catch((error) => {
          console.warn('[LoginScreen] Failed to initialize push notifications:', error);
          // Don't block navigation - push notifications are not critical
        });
        
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } else {
        // Email not verified - require OTP verification
        console.log('[LoginScreen] Email not verified, navigating to ConfirmAccount');
        navigation.navigate('ConfirmAccount', {});
      }
    } catch (error: any) {
      console.error('[LoginScreen] Login error:', error);
      handleLoginError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = () => {
    navigation.navigate('SignUp');
  };

  const handleForgotPassword = () => {
    // Pass email if it's entered
    navigation.navigate('ForgotPassword', {
      email: email.trim() || undefined,
    });
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError(''); // Clear email error when user types
    setAuthError(''); // Clear auth error when user types
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordError(''); // Clear password error when user types
    setAuthError(''); // Clear auth error when user types
  };

  const handleRememberMeToggle = () => {
    setRememberMe(!rememberMe);
  };

  return {
    email,
    password,
    rememberMe,
    isLoading,
    emailError,
    passwordError,
    authError,
    handleEmailChange,
    handlePasswordChange,
    handleRememberMeToggle,
    handleLogin,
    handleSignUp,
    handleForgotPassword,
  };
};

