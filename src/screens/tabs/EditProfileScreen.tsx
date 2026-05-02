import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Monicon } from '@monicon/native';
import { Colors } from '@/constants/Colors';
import { USERNAME_MAX_LENGTH } from '@/constants/Profile';
import CustomInput from '@/components/shared/CustomInput';
import CustomButton from '@/components/shared/CustomButton';
import { useEditProfileScreen } from './profile/edit-profile/useEditProfileScreen';
import { ProfilePictureSection, PasswordSection } from './profile/edit-profile/components';
import styles from './profile/edit-profile/styles';
import SampleFinderIcon from '@/icons/SampleFinderIcon';
import TopLinks from './profile/components/TopLinks';
import { useProfileScreen } from './profile/useProfileScreen';
import ConfirmationModal from '@/components/shared/ConfirmationModal';
import SuccessModal from '@/components/shared/SuccessModal';
import ErrorModal from '@/components/shared/ErrorModal';

const EditProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const {handleLogOutPress, showLogoutModal, handleConfirmLogout, handleCancelLogout, isLoggingOut } = useProfileScreen();
  const appVersion =
    Constants.nativeAppVersion ||
    Constants.expoConfig?.version ||
    'Unknown';
  const appBuildNumber =
    Constants.nativeBuildVersion ||
    // @ts-expect-error expoConfig platform-specific fields
    (Constants.expoConfig as any)?.ios?.buildNumber ||
    // @ts-expect-error expoConfig platform-specific fields
    (Constants.expoConfig as any)?.android?.versionCode ||
    'Unknown';

  const {
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
  } = useEditProfileScreen();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={require('@/assets/main-header-bg.png')}
          style={[styles.headerBackground, { paddingTop: insets.top + 10 }]}
          resizeMode="cover"
        >
          <View style={styles.header}>
            <View style={styles.leftSection}>
              <TouchableOpacity onPress={handleBackPress} style={styles.iconButton}>
                <Monicon name="mdi:arrow-left" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.rightSection}>
              <Monicon name="mdi:map-marker" size={20} color="#FFFFFF" />
              <Text style={styles.appTitle}>SampleFinder</Text>
            </View>
          </View>
        </ImageBackground>
        <View style={styles.loadingContainer}>
          <SampleFinderIcon width={160} color="#FFFFFF" />
        </View>
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <ImageBackground
          source={require('@/assets/main-header-bg.png')}
          style={[styles.headerBackground, { paddingTop: insets.top + 10 }]}
          resizeMode="cover"
        >
          <View style={styles.header}>
            <View style={styles.leftSection}>
              <TouchableOpacity onPress={handleBackPress} style={styles.iconButton}>
                <Monicon name="mdi:arrow-left" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.rightSection}>
              <Monicon name="mdi:map-marker" size={20} color="#FFFFFF" />
              <Text style={styles.appTitle}>SampleFinder</Text>
            </View>
          </View>
        </ImageBackground>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <CustomButton
            title="Retry"
            onPress={loadProfile}
            variant="dark"
            size="medium"
            style={styles.retryButton}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ImageBackground
        source={require('@/assets/main-header-bg.png')}
        style={[styles.headerBackground, { paddingTop: insets.top + 10 }]}
        resizeMode="cover"
      >
        <View style={styles.header}>
          <View style={styles.leftSection}>
            <TouchableOpacity onPress={handleBackPress} style={styles.iconButton}>
              <Monicon name="mdi:arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={styles.rightSection}>
          <SampleFinderIcon width={160} color="#FFFFFF" />
          </View>
        </View>
      </ImageBackground>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity onPress={handleLogOutPress} style={styles.logOutButton}>
            <Text style={styles.logOutText}>Log Out</Text>
          </TouchableOpacity>
          <ProfilePictureSection
            username={username}
            avatarUri={avatarUri}
            isUploadingAvatar={isUploadingAvatar}
            disabled={isSaving}
            onChangePicture={handleChangeProfilePicture}
          />

          {error ? (
            <View style={styles.errorMessageContainer}>
              <Text style={styles.errorMessageText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.inputsContainer}>
            <CustomInput
              label="Update Username"
              value={username}
              onChangeText={setUsername}
              type="text"
              placeholder="Enter username"
              maxLength={USERNAME_MAX_LENGTH}
              labelColor={Colors.blueColorMode}
              inputBorderColor={Colors.blueColorMode}
              error={!!validationErrors.username}
              errorMessage={validationErrors.username || (isCheckingUsername ? 'Checking availability...' : '')}
            />

            <CustomInput
              label="Update Phone Number"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              type="phone"
              placeholder="( )"
              labelColor={Colors.blueColorMode}
              inputBorderColor={Colors.blueColorMode}
              autoFormat={true}
              error={!!validationErrors.phoneNumber}
              errorMessage={validationErrors.phoneNumber}
            />

            <CustomInput
              label="Update Email"
              value={email}
              onChangeText={setEmail}
              type="email"
              placeholder="name@gmail.com"
              labelColor={Colors.blueColorMode}
              inputBorderColor={Colors.blueColorMode}
            />
            <CustomInput
              label="Current Password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              type="password"
              placeholder="Enter current password"
              labelColor={Colors.blueColorMode}
              inputBorderColor={Colors.blueColorMode}
              showPasswordToggle={true}
            />
            <CustomInput
              label="Update Password"
              value={password}
              onChangeText={setPassword}
              type="password"
              placeholder="Enter new password"
              labelColor={Colors.blueColorMode}
              inputBorderColor={Colors.blueColorMode}
              showPasswordToggle={true}
            />
          </View>

          <View style={styles.buttonContainer}>
            <CustomButton
              title="Save Updates"
              onPress={handleSaveUpdates}
              variant="dark"
              size="medium"
              style={styles.saveButton}
              textStyle={styles.saveButtonText}
              loading={isSaving}
              disabled={!hasChanges}
            />
            <CustomButton
              title="Delete Account"
              onPress={handleDeleteAccountPress}
              variant="outline"
              size="small"
              style={styles.deleteButton}
              textStyle={styles.deleteButtonText}
              disabled={isDeleting}
            />
          </View>
      <View style={styles.appVersionContainer}>
        <Text style={styles.appVersionText}>
          App version {appVersion} ({appBuildNumber})
        </Text>
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Logout Confirmation Modal */}
      <ConfirmationModal
        visible={showLogoutModal}
        title="Are you sure you want to logout?"
        description="You will need to sign in again to access your account."
        confirmText="Yes, Logout"
        cancelText="No, Stay Logged In"
        onConfirm={handleConfirmLogout}
        onCancel={handleCancelLogout}
        isLoading={isLoggingOut}
        loadingText="Logging out..."
      />

      {/* Delete Account Confirmation Modal */}
      <ConfirmationModal
        visible={showDeleteModal}
        title="Are you sure you want to delete your account?"
        description="All of your account information, progress and history will be lost."
        confirmText="Yes, Delete Account"
        cancelText="No, Keep Account"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isLoading={isDeleting}
        loadingText="Deleting account..."
      />

      {/* Profile Update Success Modal */}
      <SuccessModal
        visible={showSuccessModal}
        title="Profile Updated"
        message="Your profile has been updated successfully!"
        onClose={handleCloseSuccessModal}
      />

      {/* Validation Error Modal */}
      <ErrorModal
        visible={showErrorModal}
        title="Validation Error"
        message={errorModalMessage}
        onClose={handleCloseErrorModal}
      />

      {/* Unsaved Changes Confirmation Modal */}
      <ConfirmationModal
        visible={showUnsavedChangesModal}
        title="Unsaved Changes"
        description="You have unsaved changes. Are you sure you want to go back?"
        confirmText="Discard Changes"
        cancelText="Keep Editing"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
      />
    </View>
  );
};

export default EditProfileScreen;
