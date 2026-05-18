import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Monicon } from '@monicon/native';
import ScreenWrapper from '@/components/wrappers/ScreenWrapper';
import CustomButton from '@/components/shared/CustomButton';
import CodeInput from '@/components/shared/CodeInput';
import { useConfirmAccountScreen } from './useConfirmAccountScreen';
import styles from './confirm-account/styles';

const ConfirmAccountScreen = () => {
  const {
    code,
    email,
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
  } = useConfirmAccountScreen();

  const backDisabled = isLoading || isAbandoning;

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
          {isAbandoning ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Monicon name="mdi:arrow-left" size={22} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      }
    >
      <StatusBar style="light" />
      <View style={styles.contentContainer}>
        <Text style={styles.title}>CONFIRM ACCOUNT</Text>
        
        {email ? (
          <>
            <Text style={styles.instruction}>
              We've sent your verification code to:
            </Text>
            <Text style={styles.emailText}>{email}</Text>
            <Text style={styles.instruction}>
              Enter your code below:
            </Text>
          </>
        ) : (
          <Text style={styles.instruction}>
            Loading your email address...
          </Text>
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
            disabled={code.length !== 6 || isLoading || !email}
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
            <Text
              style={[
                styles.resendText,
                !canResend && styles.resendTextDisabled,
              ]}
            >
              {resendTimer > 0 ? `Resend code (${resendTimer}s)` : 'Resend code'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
};

export default ConfirmAccountScreen;

