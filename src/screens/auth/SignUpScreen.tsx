import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import ScreenWrapper from '@/components/wrappers/ScreenWrapper';
import CustomInput from '@/components/shared/CustomInput';
import CustomButton from '@/components/shared/CustomButton';
import { useSignUpScreen } from './useSignUpScreen';
import { AgeVerificationModal, TermsModal, PrivacyModal, PushNotificationModal } from './signup/components';
import styles from './signup/styles';
import { Colors } from '@/constants/Colors';
import { Monicon } from '@monicon/native';

const signUpFieldProps = {
  labelColor: Colors.pinBlueBlack,
  inputBorderColor: Colors.brandBlueBright,
  inputTextColor: Colors.blueColorMode,
  placeholderTextColor: Colors.grayText,
  inputBorderWidth: 2,
} as const;

const SignUpScreen = () => {
  const {
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
    isCheckingUsername,
    showError,
    showPushNotificationModal,
    showAgeVerificationModal,
    showTermsModal,
    showPrivacyModal,
    isLoading,
    errorMessage,
    isFormValid,
    setFirstName,
    setLastName,
    setPhoneNumber,
    setZipCode,
    setDateOfBirth,
    setUsername,
    setEmail,
    setPassword,
    setReferralCode,
    setShowPushNotificationModal,
    setShowAgeVerificationModal,
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
  } = useSignUpScreen();

  return (
    <ScreenWrapper
      contentBackgroundColor={Colors.white}
      contentContainerStyle={styles.contentContainer}
      footerPaddingBottom={40}
      headerLeft={
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBackButton}
          activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Monicon name="mdi:arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      }
    >
      <StatusBar style="light" />
      <Text style={styles.title}>GET STARTED!</Text>

      <View style={styles.formContainer}>
        <View style={styles.nameRow}>
          <CustomInput
            label="First Name"
            value={firstName}
            onChangeText={setFirstName}
            type="text"
            {...signUpFieldProps}
            error={!!fieldErrors.firstName}
            containerStyle={styles.nameInput}
          />

          <CustomInput
            label="Last Name"
            value={lastName}
            onChangeText={setLastName}
            type="text"
            {...signUpFieldProps}
            error={!!fieldErrors.lastName}
            containerStyle={styles.nameInput}
          />
        </View>

        <CustomInput
          label="Phone Number"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          type="phone"
          {...signUpFieldProps}
          error={!!fieldErrors.phoneNumber}
          errorMessage={fieldErrors.phoneNumber}
        />

        <CustomInput
          label="Date Of Birth"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          type="date"
          {...signUpFieldProps}
          helpIcon={true}
          helpIconVariant="outlined"
          onHelpPress={() => setShowAgeVerificationModal(true)}
          error={!!fieldErrors.dateOfBirth}
  
        />

        <CustomInput
          label="Username"
          value={username}
          onChangeText={setUsername}
          type="text"
          {...signUpFieldProps}
          error={!!fieldErrors.username}
          errorMessage={fieldErrors.username}
        />

        <CustomInput
          label="Zip Code"
          value={zipCode}
          onChangeText={setZipCode}
          type="numeric"
          {...signUpFieldProps}
          error={!!fieldErrors.zipCode}
          placeholder="#####"
          maxLength={5}
          containerStyle={styles.zipCodeContainer}
        />

        <CustomInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          type="email"
          {...signUpFieldProps}
          error={!!fieldErrors.email}
        />

        <CustomInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          type="password"
          {...signUpFieldProps}
          error={!!fieldErrors.password}
          errorMessage={fieldErrors.password}
        />

        <CustomInput
          label="Referral code (optional)"
          value={referralCode}
          onChangeText={setReferralCode}
          type="text"
          {...signUpFieldProps}
          error={!!fieldErrors.referralCode}
          errorMessage={fieldErrors.referralCode}
          placeholder="6 characters"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {showError && !errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Please fill all fields.</Text>
          </View>
        )}
        
        {errorMessage ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.buttonContainer}>
          <CustomButton
            title={isLoading ? 'Signing Up...' : 'Sign Up'}
            onPress={handleSignUp}
            variant="dark"
            disabled={!isFormValid || isLoading}
          />
          {isLoading && (
            <ActivityIndicator
              size="small"
              color="#fff"
              style={styles.loader}
            />
          )}
        </View>

        <View style={styles.signInContainer}>
          <Text style={styles.signInPrompt}>Have an account? </Text>
          <TouchableOpacity onPress={handleSignIn}>
            <Text style={styles.signInLink}>Sign In</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            By signing up, you acknowledge & agree to the{' '}
          </Text>
          <TouchableOpacity onPress={handleTermsLinkPress}>
            <Text style={[styles.termsText, styles.termsLinkText]}>
              Terms & Conditions
            </Text>
          </TouchableOpacity>
          <Text style={styles.termsText}>{' '}and{' '}</Text>
          <TouchableOpacity onPress={handlePrivacyLinkPress}>
            <Text style={[styles.termsText, styles.termsLinkText]}>
              Privacy Policy
            </Text>
          </TouchableOpacity>
          <Text style={styles.termsText}>
            {' '}of SampleFinder by Polaris Brand Promotions.
          </Text>
        </View>
      </View>

      <PushNotificationModal
        visible={showPushNotificationModal}
        onClose={() => setShowPushNotificationModal(false)}
        onEnable={handlePushNotificationEnable}
        onNotNow={handlePushNotificationNotNow}
      />

      <AgeVerificationModal
        visible={showAgeVerificationModal}
        onClose={handleAgeVerificationDismiss}
        onAccept={handleAgeVerificationAccept}
      />

      <TermsModal
        visible={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        onAccept={handleTermsAccept}
      />

      <PrivacyModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        onAccept={handlePrivacyAccept}
      />
    </ScreenWrapper>
  );
};

export default SignUpScreen;
