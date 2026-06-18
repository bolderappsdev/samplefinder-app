// samplefinder-app/src/screens/auth/ConfirmPhoneScreen.tsx
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Monicon } from '@monicon/native';
import ScreenWrapper from '@/components/wrappers/ScreenWrapper';
import CustomButton from '@/components/shared/CustomButton';
import CodeInput from '@/components/shared/CodeInput';
import { useConfirmPhoneScreen } from './useConfirmPhoneScreen';
import styles from './confirm-account/styles';

/** Show only the last 4 digits, e.g. "(•••) •••-1212". */
const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `(•••) •••-${digits.slice(-4)}`;
};

const ConfirmPhoneScreen = () => {
  const {
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
  } = useConfirmPhoneScreen();

  const backDisabled = isLoading || isLeaving;

  return (
    <ScreenWrapper
      contentBackgroundColor="#fff"
      contentContainerStyle={styles.wrapperContent}
      expandMainContent
      headerLeft={
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBackButton}
          activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={backDisabled}
        >
          {isLeaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Monicon name="mdi:arrow-left" size={22} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      }
    >
      <StatusBar style="light" />
      <View style={styles.contentContainer}>
        <Text style={styles.title}>VERIFY PHONE</Text>

        {phoneNumber ? (
          <>
            <Text style={styles.instruction}>We've sent a verification code by text to:</Text>
            <Text style={styles.emailText}>{maskPhone(phoneNumber)}</Text>
            <Text style={styles.instruction}>Enter your code below:</Text>
          </>
        ) : (
          <Text style={styles.instruction}>Sending your verification code...</Text>
        )}

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <CodeInput
          ref={codeInputRef}
          length={6}
          value={code}
          onChangeText={handleCodeChange}
          onCodeComplete={handleCodeComplete}
          editable={!isLoading}
        />

        <View style={styles.buttonContainer}>
          <CustomButton
            title={isLoading ? 'Verifying...' : 'Verify'}
            onPress={handleVerify}
            variant="dark"
            disabled={code.length !== 6 || isLoading}
          />
        </View>

        <TouchableOpacity
          onPress={handleResendCode}
          style={styles.resendContainer}
          disabled={!canResend || isResending || isLoading}
        >
          {isResending ? (
            <View style={styles.resendLoadingContainer}>
              <ActivityIndicator size="small" color="#999" />
              <Text style={[styles.resendText, styles.resendLoadingText]}>Sending...</Text>
            </View>
          ) : (
            <Text style={[styles.resendText, !canResend && styles.resendTextDisabled]}>
              {resendTimer > 0 ? `Resend code (${resendTimer}s)` : 'Resend code'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
};

export default ConfirmPhoneScreen;
