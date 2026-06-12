import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Keyboard } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@/navigation/AppNavigator';
import * as Notifications from 'expo-notifications';
import { signup } from '@/lib/auth';
import { isValidEmail, isValidPhoneNumber, isValidDate, calculateAgeFromDOB } from '@/utils/formatters';
import { checkUsernameExists, checkPhoneNumberExists } from '@/lib/database/users';
import {
  normalizeReferralCodeInput,
  validateOptionalReferralCode,
  takePendingReferralCode,
} from '@/lib/referral';
import { REFERRAL_CODE_PATTERN } from '@/lib/deepLink.constants';

type SignUpScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SignUp'>;

/** Minimum age required to create an account. Applicants under this age are blocked (COPPA). */
const MINIMUM_SIGNUP_AGE = 13;
/** Inline (red, under-field) message shown when the entered DOB is under the minimum age. */
const UNDER_AGE_FIELD_ERROR = `You must be at least ${MINIMUM_SIGNUP_AGE} years old to create an account`;
/** Body copy for the blocking age-requirement popup. */
const UNDER_AGE_MODAL_MESSAGE = `You must be at least ${MINIMUM_SIGNUP_AGE} years old to create a SampleFinder account.`;

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  zipCode?: string;
  dateOfBirth?: string;
  username?: string;
  email?: string;
  password?: string;
  referralCode?: string;
}

type SignUpScreenRouteProp = RouteProp<RootStackParamList, 'SignUp'>;

export const useSignUpScreen = () => {
  const navigation = useNavigation<SignUpScreenNavigationProp>();
  const route = useRoute<SignUpScreenRouteProp>();
  const routeReferralCode = route.params?.referralCode;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(
    routeReferralCode ? normalizeReferralCodeInput(routeReferralCode).slice(0, 6) : '',
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showPushNotificationModal, setShowPushNotificationModal] = useState(false);
  const [showAgeVerificationModal, setShowAgeVerificationModal] = useState(false);
  const [showAgeRestrictionModal, setShowAgeRestrictionModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Login');
  };
  
  // Debounce timer for username checking
  const usernameCheckTimer = useRef<NodeJS.Timeout | null>(null);
  const phoneCheckTimer = useRef<NodeJS.Timeout | null>(null);
  // Tracks whether the age-requirement popup has already been shown for the current
  // under-13 entry, so it does not re-open on every keystroke after the user dismisses
  // it. Reset once a valid date of at least the minimum age is entered.
  const ageRestrictionShownRef = useRef(false);
  
  // Store original signup data to allow re-submission with same credentials
  // This is set after initial signup attempt and cleared on unmount
  const originalSignupData = useRef<{
    username: string;
    email: string;
    phoneNumber: string;
  } | null>(null);

  // Validation functions
  const validateFirstName = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'First Name is required';
    }
    // Only alphabetic characters and spaces (for names like "Mary Jane")
    if (!/^[A-Za-z\s]+$/.test(value.trim())) {
      return 'First Name must contain only letters';
    }
    return undefined;
  };

  const validateLastName = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Last Name is required';
    }
    // Only alphabetic characters and spaces
    if (!/^[A-Za-z\s]+$/.test(value.trim())) {
      return 'Last Name must contain only letters';
    }
    return undefined;
  };

  const validatePhoneNumber = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Phone Number is required';
    }
    if (!isValidPhoneNumber(value)) {
      return 'Please enter a valid 10-digit phone number';
    }
    return undefined;
  };

  const validateZipCode = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Zip Code is required';
    }
    // US Zip code validation (5 digits or 5+4 format)
    if (!/^\d{5}(-\d{4})?$/.test(value.trim())) {
      return 'Please enter a valid 5-digit zip code';
    }
    return undefined;
  };

  const validateDateOfBirth = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Date of Birth is required';
    }
    if (!isValidDate(value)) {
      // Check if it's a format issue or invalid date
      const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
      if (!dateRegex.test(value)) {
        return 'Date must be in MM/DD/YYYY format';
      }
      const [month, day, year] = value.split('/').map(Number);
      if (month < 1 || month > 12) {
        return 'Invalid month. Please enter a valid date';
      }
      if (year < 1900 || year > new Date().getFullYear()) {
        return 'Date cannot be in the future or before 1900';
      }
      return 'Please enter a valid date';
    }
    // Date is valid: enforce the minimum age for account creation.
    const age = calculateAgeFromDOB(value);
    if (age !== null && age < MINIMUM_SIGNUP_AGE) {
      return UNDER_AGE_FIELD_ERROR;
    }
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Email is required';
    }
    if (!isValidEmail(value.trim())) {
      return 'Please enter a valid email address';
    }
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Password is required';
    }
    if (value.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    // Password must have at least 1 digit, 1 uppercase, 1 lowercase, and 1 special character
    const hasDigit = /\d/.test(value);
    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value);

    if (!hasDigit || !hasUpperCase || !hasLowerCase || !hasSpecialChar) {
      return 'Password must be at least 8 characters and contain at least 1 digit, 1 uppercase letter, 1 lowercase letter, and 1 special character';
    }
    
    // Password should not be the same as the username (case-insensitive, trimmed)
    if (
      username.trim() &&
      value.trim().toLowerCase() === username.trim().toLowerCase()
    ) {
      return 'Password cannot be the same as your username';
    }

    return undefined;
  };

  const validateUsername = async (value: string): Promise<string | undefined> => {
    if (!value.trim()) {
      return 'Username is required';
    }
    // Check if username exists (debounced)
    try {
      const trimmedValue = value.trim();
      
      // Only skip the "already exists" check if ALL key fields match the original signup
      // (username + email + phone). This allows re-submission with same credentials,
      // but prevents creating duplicate usernames with different email/phone.
      const isExactOriginalSignup = 
        originalSignupData.current?.username === trimmedValue &&
        originalSignupData.current?.email === email.trim() &&
        originalSignupData.current?.phoneNumber === phoneNumber.trim();
      
      if (isExactOriginalSignup) {
        console.log('[validateUsername] All credentials match original signup data, skipping duplicate check');
        return undefined;
      }
      
      const exists = await checkUsernameExists(trimmedValue);
      if (exists) {
        return 'Username already taken';
      }
    } catch (error) {
      console.error('Error checking username:', error);
      // Don't block signup if check fails, but show warning
    }
    return undefined;
  };

  const validatePhoneUniqueness = async (value: string): Promise<string | undefined> => {
    if (!value.trim() || !isValidPhoneNumber(value)) {
      return undefined;
    }

    try {
      const trimmedPhone = value.trim();

      // Only skip the "already exists" check if ALL key fields match the original signup
      // (username + email + phone). This allows re-submission with same credentials,
      // but prevents creating duplicate accounts with the same phone number.
      const isExactOriginalSignup =
        originalSignupData.current?.username === username.trim() &&
        originalSignupData.current?.email === email.trim() &&
        originalSignupData.current?.phoneNumber === trimmedPhone;

      if (!isExactOriginalSignup) {
        const phoneExists = await checkPhoneNumberExists(trimmedPhone);
        if (phoneExists) {
          return 'Phone number already exists.';
        }
      }
    } catch (error) {
      console.error('Error checking phone number:', error);
      // Do not block signup if phone uniqueness check fails.
    }

    return undefined;
  };

  // Update field errors
  const updateFieldError = (field: keyof FieldErrors, error: string | undefined) => {
    setFieldErrors(prev => {
      if (error) {
        return { ...prev, [field]: error };
      } else {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      }
    });
  };

  // Validate all fields
  const validateAllFields = async (): Promise<boolean> => {
    const errors: FieldErrors = {};
    
    const firstNameError = validateFirstName(firstName);
    if (firstNameError) errors.firstName = firstNameError;
    
    const lastNameError = validateLastName(lastName);
    if (lastNameError) errors.lastName = lastNameError;
    
    const phoneError = validatePhoneNumber(phoneNumber);
    if (phoneError) {
      errors.phoneNumber = phoneError;
    } else if (phoneNumber.trim()) {
      const phoneUniqueError = await validatePhoneUniqueness(phoneNumber);
      if (phoneUniqueError) {
        errors.phoneNumber = phoneUniqueError;
      }
    }
    
    const zipCodeError = validateZipCode(zipCode);
    if (zipCodeError) errors.zipCode = zipCodeError;
    
    const dobError = validateDateOfBirth(dateOfBirth);
    if (dobError) errors.dateOfBirth = dobError;
    
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    
    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;

    const referralErr = validateOptionalReferralCode(referralCode);
    if (referralErr) errors.referralCode = referralErr;

    // Check username if it's not empty
    if (username.trim()) {
      const usernameError = await validateUsername(username);
      if (usernameError) errors.username = usernameError;
    } else {
      errors.username = 'Username is required';
    }

    // Decide which high-level error message to show
    const hasErrors = Object.keys(errors).length > 0;
    if (hasErrors) {
      if (errors.phoneNumber) {
        setErrorMessage(errors.phoneNumber);
      } else if (errors.email) {
        setErrorMessage(errors.email);
      } else if (errors.username) {
        setErrorMessage(errors.username);
      } else {
        setErrorMessage('Please fill all fields.');
      }
    } else {
      setErrorMessage('');
    }
    
    setFieldErrors(errors);
    return !hasErrors;
  };

  // Debounced username check
  useEffect(() => {
    if (usernameCheckTimer.current) {
      clearTimeout(usernameCheckTimer.current);
    }

    if (!username.trim()) {
      updateFieldError('username', undefined);
      return;
    }

    // Only check if username looks valid (at least 3 characters)
    if (username.trim().length < 3) {
      updateFieldError('username', undefined);
      return;
    }

    setIsCheckingUsername(true);
    usernameCheckTimer.current = setTimeout(async () => {
      try {
        const error = await validateUsername(username);
        updateFieldError('username', error);
      } catch (error) {
        console.error('Error checking username:', error);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500); // 500ms debounce

    return () => {
      if (usernameCheckTimer.current) {
        clearTimeout(usernameCheckTimer.current);
      }
    };
  }, [username]);

  // Debounced phone uniqueness check
  useEffect(() => {
    if (phoneCheckTimer.current) {
      clearTimeout(phoneCheckTimer.current);
    }

    if (!phoneNumber.trim()) {
      return;
    }

    // Run uniqueness check only when format is valid
    if (!isValidPhoneNumber(phoneNumber)) {
      return;
    }

    phoneCheckTimer.current = setTimeout(async () => {
      const error = await validatePhoneUniqueness(phoneNumber);
      updateFieldError('phoneNumber', error);
    }, 500);

    return () => {
      if (phoneCheckTimer.current) {
        clearTimeout(phoneCheckTimer.current);
      }
    };
  }, [phoneNumber, username, email]);

  const showPushOrAgeModal = useCallback(async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      // Only show our custom explainer modal when permission has never been requested (undetermined).
      // Once the user has seen the native iOS dialog (granted or denied), we must not show our custom
      // modal again—Apple may reject the app for replacing the system permission experience.
      if (status === 'undetermined') {
        setShowPushNotificationModal(true);
      }
      // When status is 'denied' or 'granted': do nothing. Native dialog was already shown.
    } catch (error) {
      console.error('Error checking notification permissions:', error);
      // On error, do not show custom modal to avoid risking App Store rejection.
    }
  }, []);

  // On mount: show Age Verification modal first
  useEffect(() => {
    setShowAgeVerificationModal(true);

    // Cleanup: clear original signup data when component unmounts
    return () => {
      originalSignupData.current = null;
    };
  }, []);

  // Load pending referral code from AsyncStorage (e.g. from a deep link before app install)
  useEffect(() => {
    if (referralCode) return; // already set from route params

    const loadPendingReferral = async () => {
      try {
        const pending = await takePendingReferralCode();
        if (pending && REFERRAL_CODE_PATTERN.test(pending)) {
          setReferralCode(pending);
        }
      } catch {
        // Ignore storage errors
      }
    };
    loadPendingReferral();
  }, []);

  // Linking params can arrive after the first render; keep the field in sync.
  useEffect(() => {
    const paramCode = route.params?.referralCode;
    if (!paramCode) return;
    const normalized = normalizeReferralCodeInput(paramCode).slice(0, 6);
    if (normalized) {
      setReferralCode(normalized);
    }
  }, [route.params?.referralCode]);

  // Real-time validation for fields (except username which is debounced)
  const handleFirstNameChange = (text: string) => {
    setFirstName(text);
    const error = validateFirstName(text);
    updateFieldError('firstName', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handleLastNameChange = (text: string) => {
    setLastName(text);
    const error = validateLastName(text);
    updateFieldError('lastName', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handlePhoneNumberChange = (text: string) => {
    setPhoneNumber(text);
    const error = validatePhoneNumber(text);
    updateFieldError('phoneNumber', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handleZipCodeChange = (text: string) => {
    setZipCode(text);
    const error = validateZipCode(text);
    updateFieldError('zipCode', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handleDateOfBirthChange = (text: string) => {
    setDateOfBirth(text);
    const error = validateDateOfBirth(text);
    updateFieldError('dateOfBirth', error);
    setShowError(false);
    setErrorMessage('');

    // Surface the blocking age-requirement popup the moment a complete, valid,
    // under-13 birthdate is entered. The inline error disables the Sign Up button,
    // so the popup is triggered here rather than on submit. The ref guard shows it
    // once per under-13 entry (not on every keystroke) and resets when the date
    // becomes a valid, eligible age.
    if (isValidDate(text)) {
      const age = calculateAgeFromDOB(text);
      if (age !== null && age < MINIMUM_SIGNUP_AGE) {
        if (!ageRestrictionShownRef.current) {
          ageRestrictionShownRef.current = true;
          Keyboard.dismiss();
          setShowAgeRestrictionModal(true);
        }
      } else {
        ageRestrictionShownRef.current = false;
      }
    }
  };

  const handleUsernameChange = (text: string) => {
    setUsername(text);
    setShowError(false);
    setErrorMessage('');
    // Username validation is handled by useEffect with debounce

    // Re-validate password when username changes, since password
    // is not allowed to be the same as the username
    if (password.trim()) {
      const passwordError = validatePassword(password);
      updateFieldError('password', passwordError);
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    const error = validateEmail(text);
    updateFieldError('email', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    const error = validatePassword(text);
    updateFieldError('password', error);
    setShowError(false);
    setErrorMessage('');
  };

  const handleReferralCodeChange = (text: string) => {
    const n = normalizeReferralCodeInput(text).slice(0, 6);
    setReferralCode(n);
    updateFieldError('referralCode', validateOptionalReferralCode(n));
    setShowError(false);
    setErrorMessage('');
  };

  // Live per-rule indicators for the password requirements list.
  // Mirrors validatePassword so the UI checkmarks stay in sync with submit validation.
  const passwordChecks = useMemo(() => {
    if (!password) {
      return {
        minLength: false,
        noUsername: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecial: false,
      };
    }
    const trimmedUsername = username.trim();
    return {
      minLength: password.length >= 8,
      noUsername:
        trimmedUsername.length === 0 ||
        password.trim().toLowerCase() !== trimmedUsername.toLowerCase(),
      hasUppercase: /[A-Z]/.test(password),
      hasLowercase: /[a-z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };
  }, [password, username]);

// Check if form is valid (all fields filled and no errors)
  const isFormValid =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    phoneNumber.trim() !== '' &&
    zipCode.trim() !== '' &&
    dateOfBirth.trim() !== '' &&
    username.trim() !== '' &&
    email.trim() !== '' &&
    password.trim() !== '' &&
    Object.keys(fieldErrors).length === 0;

  const handleSignIn = () => {
    navigation.navigate('Login');
  };

  const submitSignUp = async () => {
    // Hard age gate: applicants under the minimum age cannot create an account.
    // The inline error normally disables the Sign Up button before this runs, but
    // this guard guarantees signup() is never reached for an under-age applicant.
    if (isValidDate(dateOfBirth)) {
      const age = calculateAgeFromDOB(dateOfBirth);
      if (age !== null && age < MINIMUM_SIGNUP_AGE) {
        updateFieldError('dateOfBirth', UNDER_AGE_FIELD_ERROR);
        setShowAgeRestrictionModal(true);
        return;
      }
    }

    const isValid = await validateAllFields();
    if (!isValid) {
      setShowError(true);
      return;
    }

    const emailError = validateEmail(email);
    if (emailError) {
      updateFieldError('email', emailError);
      setShowError(true);
      return;
    }

    setShowError(false);
    setErrorMessage('');
    setIsLoading(true);

    try {
      // Store the signup data before attempting signup
      // This allows re-submission if user navigates back from OTP page
      originalSignupData.current = {
        username: username.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber.trim(),
      };
      
      await signup({
        email: email.trim(),
        password: password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phoneNumber: phoneNumber.trim(),
        zipCode: zipCode.trim(),
        dateOfBirth: dateOfBirth.trim(),
        username: username.trim(),
        referralCode: referralCode.trim() || undefined,
      });

      navigation.navigate('ConfirmAccount', { phoneNumber: phoneNumber.trim() });
    } catch (error: any) {
      console.error('Sign up error:', error);
      const errorMsg = getUserFriendlyErrorMessage(error);
      setErrorMessage(errorMsg);
      
      // Clear original signup data on error since signup failed
      originalSignupData.current = null;
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushNotificationEnable = () => {
    setShowPushNotificationModal(false);
  };

  const handlePushNotificationNotNow = () => {
    setShowPushNotificationModal(false);
  };

  const handleAgeVerificationAccept = () => {
    setShowAgeVerificationModal(false);
    setAgeVerified(true);
    setShowTermsModal(true);
  };

  const handleAgeVerificationDismiss = () => {
    setShowAgeVerificationModal(false);
    setAgeVerified(false);
  };

  const handleTermsAccept = () => {
    setShowTermsModal(false);
    setTermsAccepted(true);
    showPushOrAgeModal();
  };

  const handleTermsLinkPress = () => {
    setShowTermsModal(true);
  };

  const handlePrivacyLinkPress = () => {
    setShowPrivacyModal(true);
  };

  const handlePrivacyAccept = () => {
    setShowPrivacyModal(false);
  };

  const getUserFriendlyErrorMessage = (error: any): string => {
    const errorMessage = error?.message || '';
    
    // Check for email validation errors
    if (errorMessage.toLowerCase().includes('email') && 
        (errorMessage.toLowerCase().includes('valid') || errorMessage.toLowerCase().includes('invalid'))) {
      // Return the actual backend message if it's clear, otherwise use custom message
      return errorMessage.includes('email') && errorMessage.length < 100 
        ? errorMessage 
        : 'Please enter a valid email address.';
    }
    
    // Check for duplicate email/username/phone (409 / user_already_exists)
    // Always stay on sign-up and show error — never redirect to OTP, since there is no session.
    if (errorMessage.toLowerCase().includes('already exists') || 
        errorMessage.toLowerCase().includes('duplicate') ||
        errorMessage.toLowerCase().includes('already registered') ||
        error?.code === 409) {
      
      if (errorMessage.toLowerCase().includes('email')) {
        return 'An account with this email already exists. Please use the login page to sign in.';
      }
      
      if (errorMessage.toLowerCase().includes('username')) {
        return 'This username is already taken. Please choose a different username.';
      }
      
      if (errorMessage.toLowerCase().includes('phone')) {
        return 'An account with this phone number already exists. Please use the login page to sign in.';
      }
      
      return 'An account with these details already exists. Please use the login page to sign in.';
    }
    
    // Check for password errors
    if (errorMessage.toLowerCase().includes('password')) {
      // Return the actual backend message if it's clear, otherwise use custom message
      return errorMessage.includes('password') && errorMessage.length < 100 
        ? errorMessage 
        : 'Password does not meet requirements. Please check and try again.';
    }
    
    // Check for phone number errors
    if (errorMessage.toLowerCase().includes('phone')) {
      return errorMessage.includes('phone') && errorMessage.length < 100 
        ? errorMessage 
        : 'Please enter a valid phone number.';
    }
    
    // Network or server errors
    if (errorMessage.toLowerCase().includes('network') || 
        errorMessage.toLowerCase().includes('fetch') || 
        errorMessage.toLowerCase().includes('timeout')) {
      return 'Network error. Please check your connection and try again.';
    }
    
    // Default - return actual error message if available and reasonable length
    return errorMessage && errorMessage.length < 100 
      ? errorMessage 
      : 'Sign up failed. Please try again.';
  };

  const handleSignUp = async () => {
    if (!ageVerified) {
      setShowAgeVerificationModal(true);
      return;
    }

    if (!termsAccepted) {
      setErrorMessage('Please accept the Terms & Conditions to continue.');
      setShowTermsModal(true);
      return;
    }

    await submitSignUp();
  };

  return {
    firstName,
    lastName,
    phoneNumber,
    zipCode,
    dateOfBirth,
    username,
    email,
    password,
    referralCode,
    fieldErrors,
    passwordChecks,
    isCheckingUsername,
    showError,
    showPushNotificationModal,
    showAgeVerificationModal,
    showAgeRestrictionModal,
    ageRestrictionMessage: UNDER_AGE_MODAL_MESSAGE,
    showTermsModal,
    showPrivacyModal,
    ageVerified,
    isLoading,
    errorMessage,
    isFormValid,
    setFirstName: handleFirstNameChange,
    setLastName: handleLastNameChange,
    setPhoneNumber: handlePhoneNumberChange,
    setZipCode: handleZipCodeChange,
    setDateOfBirth: handleDateOfBirthChange,
    setUsername: handleUsernameChange,
    setEmail: handleEmailChange,
    setPassword: handlePasswordChange,
    setReferralCode: handleReferralCodeChange,
    setShowPushNotificationModal,
    setShowAgeVerificationModal,
    setShowAgeRestrictionModal,
    setShowTermsModal,
    setShowPrivacyModal,
    handleSignIn,
    handlePushNotificationEnable,
    handlePushNotificationNotNow,
    handleAgeVerificationAccept,
    handleAgeVerificationDismiss,
    handleTermsAccept,
    handleTermsLinkPress,
    handlePrivacyLinkPress,
    handlePrivacyAccept,
    handleSignUp,
    handleBack,
  };
};
