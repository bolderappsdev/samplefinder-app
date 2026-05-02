import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigation, useFocusEffect, CommonActions } from '@react-navigation/native';
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { deleteAccount } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { getUserProfile, updateUserProfile, UserProfileRow, checkUsernameExistsForDifferentUser, checkPhoneNumberExistsForDifferentUser } from '@/lib/database';
import { updateEmail, updatePassword } from '@/lib/auth';
import { uploadAvatar, deleteAvatar, extractFileIdFromUrl } from '@/lib/storage';
import { USERNAME_MAX_LENGTH, USERNAME_TOO_LONG_MESSAGE } from '@/constants/Profile';

export const useEditProfileScreen = () => {
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [error, setError] = useState<string>('');
  
  const [profile, setProfile] = useState<UserProfileRow | null>(null);
  const [authUser, setAuthUser] = useState<{ email: string; name?: string } | null>(null);
  
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [hasChanges, setHasChanges] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pendingAvatarLocalUri, setPendingAvatarLocalUri] = useState<string | null>(null);
  const [pendingAvatarRemoval, setPendingAvatarRemoval] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState('');
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{
    password?: string;
    phoneNumber?: string;
    username?: string;
  }>({});
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const usernameCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadProfile = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Get current authenticated user
      const user = useAuthStore.getState().user;
      if (!user) {
        setError('Not authenticated. Please log in again.');
        setIsLoading(false);
        return;
      }

      setAuthUser({ email: user.email, name: user.name });

      // Fetch user profile from database
      const userProfile = await getUserProfile(user.$id);
      if (!userProfile) {
        setError('Profile not found. Please contact support.');
        setIsLoading(false);
        return;
      }

      setProfile(userProfile);
      setUsername(userProfile.username || '');
      setPhoneNumber(userProfile.phoneNumber || '');
      setEmail(user.email || '');
      setAvatarUri(userProfile.avatarURL || null);
      setPendingAvatarLocalUri(null);
      setPendingAvatarRemoval(false);
      
      console.log('[EditProfileScreen] Profile loaded:', {
        username: userProfile.username,
        phoneNumber: userProfile.phoneNumber,
        email: user.email,
        hasAvatar: !!userProfile.avatarURL,
      });
    } catch (err: any) {
      console.error('[EditProfileScreen] Error loading profile:', err);
      setError(err?.message || 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  // Load profile when screen is focused
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  // Check username uniqueness with debouncing
  useEffect(() => {
    if (!profile) return;

    // Clear any existing timeout
    if (usernameCheckTimeoutRef.current) {
      clearTimeout(usernameCheckTimeoutRef.current);
    }

    const trimmedUsername = username.trim();
    
    // Skip check if username hasn't changed or is empty
    if (!trimmedUsername || trimmedUsername === (profile.username || '')) {
      setValidationErrors((prev) => {
        const { username: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    if (trimmedUsername.length > USERNAME_MAX_LENGTH) {
      setValidationErrors((prev) => ({
        ...prev,
        username: USERNAME_TOO_LONG_MESSAGE,
      }));
      return;
    }

    setValidationErrors((prev) => {
      if (prev.username === USERNAME_TOO_LONG_MESSAGE) {
        const { username: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });

    // Debounce the username check
    usernameCheckTimeoutRef.current = setTimeout(async () => {
      try {
        if (username.trim().length > USERNAME_MAX_LENGTH) {
          return;
        }
        setIsCheckingUsername(true);
        const exists = await checkUsernameExistsForDifferentUser(trimmedUsername, profile.$id);
        
        if (exists) {
          setValidationErrors((prev) => ({
            ...prev,
            username: 'This username is already taken',
          }));
        } else {
          setValidationErrors((prev) => {
            const { username: _, ...rest } = prev;
            return rest;
          });
        }
      } catch (error) {
        console.error('[EditProfileScreen] Error checking username:', error);
        // Clear username error on check failure to avoid blocking legitimate updates
        setValidationErrors((prev) => {
          const { username: _, ...rest } = prev;
          return rest;
        });
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500); // 500ms debounce

    return () => {
      if (usernameCheckTimeoutRef.current) {
        clearTimeout(usernameCheckTimeoutRef.current);
      }
    };
  }, [username, profile]);

  // Track changes
  useEffect(() => {
    if (profile && authUser) {
      const hasUsernameChange = username !== (profile.username || '');
      const hasPhoneChange = phoneNumber !== (profile.phoneNumber || '');
      const hasEmailChange = email !== (authUser.email || '');
      const hasPasswordChange = currentPassword.length > 0 || password.length > 0;
      const hasAvatarChange = pendingAvatarLocalUri !== null || pendingAvatarRemoval;

      setHasChanges(
        hasUsernameChange || hasPhoneChange || hasEmailChange || hasPasswordChange || hasAvatarChange
      );
    }
  }, [username, phoneNumber, email, currentPassword, password, profile, authUser, pendingAvatarLocalUri, pendingAvatarRemoval]);

  const handleBackPress = () => {
    if (hasChanges) {
      setShowUnsavedChangesModal(true);
    } else {
      navigation.goBack();
    }
  };

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesModal(false);
    navigation.goBack();
  };

  const handleCancelDiscard = () => {
    setShowUnsavedChangesModal(false);
  };

  // Helper function to extract digits from phone number
  const getPhoneDigits = (phone: string): string => {
    return phone.replace(/\D/g, '');
  };

  // Helper function to validate password requirements
  const validatePassword = (pwd: string): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    // Check for spaces
    if (/\s/.test(pwd)) {
      errors.push('No spaces allowed');
    }
    if (pwd.length < 8) {
      errors.push('At least 8 characters');
    }
    if (!/[A-Z]/.test(pwd)) {
      errors.push('At least one uppercase letter');
    }
    if (!/[a-z]/.test(pwd)) {
      errors.push('At least one lowercase letter');
    }
    if (!/[0-9]/.test(pwd)) {
      errors.push('At least one number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) {
      errors.push('At least one special character (!@#$%^&*...)');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  };

  const validateForm = (): string | null => {
    const newValidationErrors: { password?: string; phoneNumber?: string; username?: string } = {};
    
    if (!username.trim()) {
      return 'Username is required';
    }

    if (username.trim().length > USERNAME_MAX_LENGTH) {
      newValidationErrors.username = USERNAME_TOO_LONG_MESSAGE;
      setValidationErrors((prev) => ({ ...prev, ...newValidationErrors }));
      return USERNAME_TOO_LONG_MESSAGE;
    }
    
    // Check if username is taken
    if (validationErrors.username) {
      return validationErrors.username;
    }
    
    if (!phoneNumber.trim()) {
      return 'Phone number is required';
    }
    
    // Phone number validation - at least 10 digits
    const phoneDigits = getPhoneDigits(phoneNumber);
    if (phoneDigits.length < 10) {
      newValidationErrors.phoneNumber = 'Phone number must be at least 10 digits';
      setValidationErrors(newValidationErrors);
      return 'Phone number must be at least 10 digits';
    }
    
    if (!email.trim()) {
      return 'Email is required';
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return 'Please enter a valid email address';
    }
    
    // Check if email is changing
    const emailChanged = authUser && email !== authUser.email;
    
    // If email is changing, current password is required
    if (emailChanged && !currentPassword) {
      return 'Current password is required to update email';
    }
    
    // Password validation - validate the new password field if user is updating password
    if (password) {
      // Require current password when setting new password
      if (!currentPassword) {
        return 'Current password is required to update password';
      }

      if (username.trim() && password.trim().toLowerCase() === username.trim().toLowerCase()) {
        return 'New password must not be the same as your username.';
      }

      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        const errorMessage = `New password must contain:\n• ${passwordValidation.errors.join('\n• ')}`;
        newValidationErrors.password = errorMessage;
        setValidationErrors(newValidationErrors);
        return errorMessage;
      }
    }
    
    setValidationErrors({});
    return null;
  };

  const handleSaveUpdates = async () => {
    // Wait for username check to complete if in progress
    if (isCheckingUsername) {
      setErrorModalMessage('Please wait while we verify the username availability');
      setShowErrorModal(true);
      return;
    }

    try {
      setIsSaving(true);
      setError('');

      if (!profile || !authUser) {
        throw new Error('Profile data not loaded');
      }

      const user = useAuthStore.getState().user;
      if (!user) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // Update profile in database (username, phone)
      const profileUpdates: any = {};
      if (username !== (profile.username || '')) {
        profileUpdates.username = username.trim();
      }
      if (phoneNumber !== (profile.phoneNumber || '')) {
        profileUpdates.phoneNumber = phoneNumber.trim();

        // Check for duplicate phone number before attempting update
        const phoneExistsForOtherUser = await checkPhoneNumberExistsForDifferentUser(
          phoneNumber.trim(),
          profile.$id
        );

        if (phoneExistsForOtherUser) {
          const message = 'This phone number is already associated with another account. Please enter a different phone number.';
          setValidationErrors((prev) => ({
            ...prev,
            phoneNumber: message,
          }));
          setErrorModalMessage(message);
          setShowErrorModal(true);
          return;
        } else {
          // Clear any previous phone validation error if the new number is valid and unique
          setValidationErrors((prev) => {
            const { phoneNumber: _phone, ...rest } = prev;
            return rest;
          });
        }
      }

      const validationError = validateForm();
      if (validationError) {
        setErrorModalMessage(validationError);
        setShowErrorModal(true);
        return;
      }

      if (Object.keys(profileUpdates).length > 0) {
        console.log('[EditProfileScreen] Updating profile:', profileUpdates);
        await updateUserProfile(profile.$id, profileUpdates);
      }

      // Update email if changed
      if (email !== authUser.email) {
        console.log('[EditProfileScreen] Updating email');
        if (!currentPassword) {
          throw new Error('Current password is required to update email');
        }
        await updateEmail(email.trim(), currentPassword);
      }

      // Update password if provided
      if (password && currentPassword) {
        console.log('[EditProfileScreen] Updating password');
        await updatePassword(currentPassword, password, password);
        // Clear password fields after successful update
        setCurrentPassword('');
        setPassword('');
      }

      // Persist avatar changes only after the rest of the save succeeds
      if (pendingAvatarLocalUri || pendingAvatarRemoval) {
        try {
          setIsUploadingAvatar(true);

          if (profile.avatarURL) {
            const oldFileId = extractFileIdFromUrl(profile.avatarURL);
            if (oldFileId) {
              try {
                await deleteAvatar(oldFileId);
              } catch (deleteError) {
                console.warn('[EditProfileScreen] Failed to delete old avatar:', deleteError);
              }
            }
          }

          if (pendingAvatarLocalUri) {
            const avatarUrl = await uploadAvatar(pendingAvatarLocalUri, user.$id);
            await updateUserProfile(profile.$id, { avatarURL: avatarUrl });
            setAvatarUri(avatarUrl);
          } else {
            await updateUserProfile(profile.$id, { avatarURL: null });
            setAvatarUri(null);
          }

          setPendingAvatarLocalUri(null);
          setPendingAvatarRemoval(false);
        } finally {
          setIsUploadingAvatar(false);
        }
      }

      // Show custom success modal instead of generic Alert
      setShowSuccessModal(true);
    } catch (err: any) {
      console.error('[EditProfileScreen] Error saving profile:', err);
      const errorMessage = err?.message || 'Failed to update profile. Please try again.';
      setError(errorMessage);
      Alert.alert('Update Failed', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const requestImagePickerPermissions = async (): Promise<boolean> => {
    // First check current permission status
    const { status: currentStatus } = await ImagePicker.getMediaLibraryPermissionsAsync();
    
    // If already granted, return true
    if (currentStatus === 'granted') {
      return true;
    }
    
    // If denied, guide user to settings
    if (currentStatus === 'denied') {
      Alert.alert(
        'Permission Required',
        'We need access to your photo library to upload a profile picture. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Open Settings', 
            onPress: () => Linking.openSettings() 
          }
        ]
      );
      return false;
    }
    
    // If undetermined, request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'We need access to your photo library to upload a profile picture.',
        [{ text: 'OK' }]
      );
      return false;
    }
    return true;
  };

  const handleChangeProfilePicture = async () => {
    try {
      // Request permissions
      const hasPermission = await requestImagePickerPermissions();
      if (!hasPermission) {
        return;
      }

      // Show action sheet for image source
      Alert.alert(
        'Select Photo',
        'Choose an option',
        [
          { text: 'Camera', onPress: () => pickImage('camera') },
          { text: 'Photo Library', onPress: () => pickImage('library') },
          { text: 'Cancel', style: 'cancel' },
          ...(avatarUri ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: handleRemovePhoto }] : []),
        ],
        { cancelable: true }
      );
    } catch (error: any) {
      console.error('[EditProfileScreen] Error in handleChangeProfilePicture:', error);
      Alert.alert('Error', 'Failed to open image picker. Please try again.');
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        // First check current camera permission status
        const { status: currentCameraStatus } = await ImagePicker.getCameraPermissionsAsync();
        
        // If already granted, proceed
        if (currentCameraStatus === 'granted') {
          // Permission already granted, continue with camera
        } else if (currentCameraStatus === 'denied') {
          // If denied, guide user to settings
          Alert.alert(
            'Permission Required',
            'We need access to your camera to take a photo. Please enable it in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Open Settings', 
                onPress: () => Linking.openSettings() 
              }
            ]
          );
          return;
        } else {
          // If undetermined, request permission
          const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
          if (cameraStatus !== 'granted') {
            Alert.alert(
              'Permission Required',
              'We need access to your camera to take a photo.',
              [{ text: 'OK' }]
            );
            return;
          }
        }

        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        setAvatarUri(imageUri);
        setPendingAvatarLocalUri(imageUri);
        setPendingAvatarRemoval(false);
      }
    } catch (error: any) {
      console.error('[EditProfileScreen] Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleRemovePhoto = () => {
    if (!profile) {
      return;
    }

    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile picture? Your changes will be applied when you tap Save Updates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setAvatarUri(null);
            setPendingAvatarLocalUri(null);
            setPendingAvatarRemoval(true);
          },
        },
      ]
    );
  };

  const handleDeleteAccountPress = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      
      console.log('[EditProfileScreen] Deleting account...');
      await deleteAccount();
      
      // Navigate to Login screen and reset navigation stack
      const rootNavigation = navigation.getParent()?.getParent() || navigation.getParent() || navigation;
      rootNavigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        })
      );
    } catch (error: any) {
      console.error('[EditProfileScreen] Delete account error:', error);
      setIsDeleting(false);
      setShowDeleteModal(false);
      Alert.alert(
        'Delete Failed',
        error.message || 'Failed to delete account. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
  };

  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
    navigation.goBack();
  };

  const handleCloseErrorModal = () => {
    setShowErrorModal(false);
    setErrorModalMessage('');
  };

  return {
    isLoading,
    isSaving,
    isDeleting,
    showDeleteModal,
    showSuccessModal,
    showErrorModal,
    errorModalMessage,
    showUnsavedChangesModal,
    error,
    validationErrors,
    isCheckingUsername,
    profile,
    username,
    phoneNumber,
    email,
    currentPassword,
    password,
    hasChanges,
    avatarUri,
    isUploadingAvatar,
    setUsername,
    setPhoneNumber,
    setEmail,
    setCurrentPassword,
    setPassword,
    handleBackPress,
    handleSaveUpdates,
    handleChangeProfilePicture,
    handleDeleteAccountPress,
    handleConfirmDelete,
    handleCancelDelete,
    handleCloseSuccessModal,
    handleCloseErrorModal,
    handleConfirmDiscard,
    handleCancelDiscard,
    loadProfile,
  };
};

