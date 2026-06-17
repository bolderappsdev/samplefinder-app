import { Account, ID, ExecutionMethod } from 'react-native-appwrite';
import appwriteClient from './appwrite';
import { createUserProfile } from './database';
import { storePendingReferralCode } from './referral';
import { functions } from './database/config';
import { calculateAgeFromDOB } from '@/utils/formatters';
import { APPWRITE_EVENTS_FUNCTION_ID } from '@env';
// Note: Push notifications are initialized after email verification completes,
// not during login/signup, to avoid race conditions with session deletion

const account = new Account(appwriteClient);

/**
 * Calculate if a user is an adult (21 years or older) based on their date of birth.
 * Used to set the `isAdult` profile flag for age-restricted (alcohol/tobacco/etc.)
 * disclaimers. Distinct from the 13+ account-eligibility gate enforced at sign-up.
 * @param dateOfBirth - Date string in MM/DD/YYYY format
 * @returns true if user is 21 or older, false otherwise (including unparseable dates)
 */
const calculateIsAdult = (dateOfBirth: string): boolean => {
  const age = calculateAgeFromDOB(dateOfBirth);
  return age !== null && age >= 21;
};

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  zipCode: string;
  dateOfBirth: string;
  username: string;
  /** Optional friend's code; stored locally until email verification, then sent to Mobile API. */
  referralCode?: string;
}

export interface User {
  $id: string;
  email: string;
  name?: string;
  emailVerification: boolean;
  phoneVerification: boolean;
}

/**
 * Check for existing session and logout if found
 */
const ensureNoActiveSession = async (): Promise<void> => {
  try {
    const hasSession = await isLoggedIn();
    if (hasSession) {
      console.log('[auth] Active session found, logging out...');
      await logout();
      console.log('[auth] Successfully logged out existing session');
    }
  } catch (error: any) {
    // If there's an error checking or logging out, it's okay - we'll proceed anyway
    // This could happen if the session is invalid or already expired
    console.log('[auth] No active session or session already expired');
  }
};

/**
 * Sign up with email and password
 */
export const signup = async (credentials: SignUpCredentials): Promise<User> => {
  console.log('[auth.signup] Starting signup process');
  console.log('[auth.signup] Credentials received:', {
    email: credentials.email,
    firstName: credentials.firstName,
    lastName: credentials.lastName,
    phoneNumber: credentials.phoneNumber,
    zipCode: credentials.zipCode,
    dateOfBirth: credentials.dateOfBirth,
    username: credentials.username,
    passwordLength: credentials.password.length,
  });

  // Check for existing session and logout if found
  await ensureNoActiveSession();

  try {
    // Create account with email, password, and name
    // Generate a valid userId (max 36 chars, alphanumeric + period, hyphen, underscore)
    const name = `${credentials.firstName} ${credentials.lastName}`.trim();
    console.log('[auth.signup] Creating account with name:', name);
    
    // Trim email to ensure no whitespace issues
    const trimmedEmail = credentials.email.trim();
    console.log('[auth.signup] Email before trim:', JSON.stringify(credentials.email));
    console.log('[auth.signup] Email after trim:', JSON.stringify(trimmedEmail));
    
    const userId = ID.unique();
    console.log('[auth.signup] Account data (without password):', {
      userId: userId,
      email: trimmedEmail,
      name: name,
    });

    console.log('[auth.signup] Calling account.create with positional parameters...');
    const user = await account.create(userId, trimmedEmail, credentials.password, name);
    console.log('[auth.signup] Account created successfully:', {
      id: user.$id,
      email: user.email,
      name: user.name,
      emailVerification: user.emailVerification,
      phoneVerification: user.phoneVerification,
    });

    // Create a session explicitly after account creation
    // account.create might not always create a session automatically
    console.log('[auth.signup] Creating email/password session...');
    try {
      await account.createEmailPasswordSession(trimmedEmail, credentials.password);
      console.log('[auth.signup] Session created successfully');
    } catch (sessionError: any) {
      console.warn('[auth.signup] Session creation failed:', sessionError?.message);
      // If session creation fails, try to continue anyway - might already have a session
    }

    // Verify session exists before proceeding
    console.log('[auth.signup] Verifying session exists...');
    try {
      const sessionUser = await account.get();
      console.log('[auth.signup] Session verified, user:', {
        id: sessionUser.$id,
        email: sessionUser.email,
      });
    } catch (sessionError: any) {
      console.warn('[auth.signup] Session verification failed:', sessionError?.message);
      // If verification fails, we still need to create the profile, so continue
    }

    const updatedUser = user;

    // OTP will be sent on ConfirmAccountScreen after session is deleted
    // No need to send it here (same as login flow)
    console.log('[auth.signup] Verification email will be sent on ConfirmAccountScreen');

    // Create user profile in database
    console.log('[auth.signup] Creating user profile in database...');
    try {
      // Calculate if user is an adult (21+)
      const isAdult = calculateIsAdult(credentials.dateOfBirth.trim());
      console.log('[auth.signup] User age verification:', {
        dateOfBirth: credentials.dateOfBirth.trim(),
        isAdult: isAdult,
      });
      
      await createUserProfile({
        authID: updatedUser.$id,
        firstname: credentials.firstName.trim(),
        lastname: credentials.lastName.trim(),
        phoneNumber: credentials.phoneNumber.trim(),
        zipCode: credentials.zipCode.trim(),
        dob: credentials.dateOfBirth.trim(),
        username: credentials.username.trim(),
        role: 'user',
        isAdult: isAdult,
      });
      console.log('[auth.signup] User profile created successfully');

      await storePendingReferralCode(credentials.referralCode);
    } catch (profileError: any) {
      console.error('[auth.signup] Error creating user profile:', profileError);
      console.error('[auth.signup] Profile error message:', profileError?.message);
      console.error('[auth.signup] Profile error code:', profileError?.code);
      // Re-throw the error so it's visible to the user
      // The signup should fail if profile creation fails
      throw new Error(`Failed to create user profile: ${profileError?.message || 'Unknown error'}`);
    }

    const result = {
      $id: updatedUser.$id,
      email: updatedUser.email,
      name: updatedUser.name,
      emailVerification: updatedUser.emailVerification,
      phoneVerification: updatedUser.phoneVerification,
    };
    console.log('[auth.signup] Signup completed successfully, returning user:', result);
    
    // Note: Push notifications will be initialized after email verification completes
    // This avoids race condition where session is deleted for OTP flow
    
    return result;
  } catch (error: any) {
    console.error('[auth.signup] Signup error occurred:', error);
    console.error('[auth.signup] Error type:', error?.constructor?.name);
    console.error('[auth.signup] Error message:', error?.message);
    console.error('[auth.signup] Error code:', error?.code);
    console.error('[auth.signup] Error response:', error?.response);
    console.error('[auth.signup] Error stack:', error?.stack);
    
    // Handle duplicate account errors (409 Conflict)
    if (error?.code === 409 || error?.message?.toLowerCase().includes('already exists') || 
        error?.message?.toLowerCase().includes('user with the same email')) {
      console.log('[auth.signup] Account already exists (409 error)');
      
      // Check if error message specifies what's duplicate
      const errorMsg = error?.message?.toLowerCase() || '';
      
      if (errorMsg.includes('email')) {
        throw new Error('An account with this email already exists. Please use the login page to sign in.');
      }
      
      if (errorMsg.includes('phone')) {
        throw new Error('An account with this phone number already exists. Please use the login page to sign in.');
      }
      
      // Generic message if we can't determine what's duplicate
      throw new Error('An account with these details already exists. Please use the login page to sign in.');
    }
    
    // For other errors, throw the original error message
    throw new Error(error.message || 'Sign up failed. Please try again.');
  }
};

/**
 * Login with email and password
 */
export const login = async (credentials: LoginCredentials): Promise<User> => {
  console.log('[auth.login] Starting login process');
  
  // Check for existing session and logout if found
  await ensureNoActiveSession();

  try {
    const trimmedEmail = credentials.email.trim();
    console.log('[auth.login] Creating email/password session...');
    const session = await account.createEmailPasswordSession(
      trimmedEmail,
      credentials.password
    );
    console.log('[auth.login] Session created successfully');
    
    // Get user details
    console.log('[auth.login] Fetching user details...');
    const user = await account.get();
    console.log('[auth.login] User details retrieved:', {
      id: user.$id,
      email: user.email,
      emailVerification: user.emailVerification,
    });
    
    // OTP will be sent on ConfirmAccountScreen after session is deleted
    // No need to send it here
    
    const result = {
      $id: user.$id,
      email: user.email,
      name: user.name,
      emailVerification: user.emailVerification,
      phoneVerification: user.phoneVerification,
    };
    
    // Note: Push notifications will be initialized after email verification completes
    // This avoids race condition where session is deleted for OTP flow
    
    return result;
  } catch (error: any) {
    console.error('[auth.login] Login error occurred:', error);
    console.error('[auth.login] Error message:', error?.message);
    console.error('[auth.login] Error code:', error?.code);
    throw new Error(error.message || 'Login failed. Please check your credentials.');
  }
};

/**
 * Get current user session
 */
export const getCurrentUser = async (): Promise<User | null> => {
  try {
    console.log('[auth.getCurrentUser] Attempting to get current user...');
    const user = await account.get();
    console.log('[auth.getCurrentUser] User retrieved successfully:', {
      id: user.$id,
      email: user.email,
    });
    return {
      $id: user.$id,
      email: user.email,
      name: user.name,
      emailVerification: user.emailVerification,
      phoneVerification: user.phoneVerification,
    };
  } catch (error: any) {
    const errorMessage = error?.message ?? '';
    const errorCode = error?.code;
    const errorType = error?.type;
    const isExpectedLoggedOutState =
      errorCode === 401 &&
      (errorType === 'general_unauthorized_scope' ||
        errorMessage.includes('missing scopes (["account"])') ||
        errorMessage.toLowerCase().includes('user (role: guests)'));

    if (isExpectedLoggedOutState) {
      // Logged-out guest state is expected in many places that check session.
      return null;
    }

    console.error('[auth.getCurrentUser] Error getting current user:', error);
    console.error('[auth.getCurrentUser] Error message:', error?.message);
    console.error('[auth.getCurrentUser] Error code:', error?.code);
    return null;
  }
};

/**
 * Logout current user
 */
export const logout = async (): Promise<void> => {
  try {
    // Clear locally scheduled event reminders first, so a new account on the same
    // device does not inherit reminder notifications from the previous user.
    const { cancelAllEventReminders } = await import('./notifications/eventReminders');
    await cancelAllEventReminders().catch((error) => {
      console.warn('[auth.logout] Failed to cancel local event reminders:', error);
      // Don't throw - continue with logout cleanup even if reminder cancellation fails
    });

    // Delete push target before logging out
    const { deletePushTarget } = await import('./notifications');
    await deletePushTarget().catch((error) => {
      console.warn('[auth.logout] Failed to delete push target:', error);
      // Don't throw - continue with logout even if push target deletion fails
    });

    // Clear cached per-user state so the next account on this device starts clean.
    try {
      const { useFavoritesStore } = await import('@/stores/favoritesStore');
      useFavoritesStore.getState().clear();
    } catch (error) {
      console.warn('[auth.logout] Failed to clear favorites store:', error);
    }

    await account.deleteSession('current');
  } catch (error: any) {
    throw new Error(error.message || 'Logout failed');
  }
};

/**
 * Check if user is logged in
 */
export const isLoggedIn = async (): Promise<boolean> => {
  try {
    await account.get();
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Send email verification OTP
 */
export const sendVerificationEmail = async (): Promise<void> => {
  console.log('[auth.sendVerificationEmail] Starting verification email process');
  try {
    // Get current user to get userId and email
    console.log('[auth.sendVerificationEmail] Getting current user...');
    const user = await account.get();
    console.log('[auth.sendVerificationEmail] Current user:', {
      id: user.$id,
      email: user.email,
    });
    
    // Appwrite sends verification email with OTP
    // createEmailToken requires userId and email
    console.log('[auth.sendVerificationEmail] Creating email token...');
    await account.createEmailToken(user.$id, user.email);
    console.log('[auth.sendVerificationEmail] Verification email sent successfully');
  } catch (error: any) {
    console.error('[auth.sendVerificationEmail] Error sending verification email:', error);
    console.error('[auth.sendVerificationEmail] Error message:', error?.message);
    console.error('[auth.sendVerificationEmail] Error code:', error?.code);
    console.error('[auth.sendVerificationEmail] Error stack:', error?.stack);
    throw new Error(error.message || 'Failed to send verification email');
  }
};

/**
 * Verify email OTP and create session
 * Uses createSession with userId and secret (OTP code) to verify and create session
 */
export const verifyEmail = async (userId: string, secret: string): Promise<void> => {
  console.log('[auth.verifyEmail] Starting email OTP verification');
  console.log('[auth.verifyEmail] UserId:', userId);
  console.log('[auth.verifyEmail] Secret/OTP:', secret);
  console.log('[auth.verifyEmail] Secret/OTP length:', secret.length);
  
  try {
    // Use createSession to verify the OTP and create a new session
    // This is the Email OTP login flow - session should already be deleted
    console.log('[auth.verifyEmail] Calling createSession with userId and OTP secret...');
    await account.createSession(userId, secret);
    console.log('[auth.verifyEmail] Email OTP verified successfully and session created');
  } catch (error: any) {
    console.error('[auth.verifyEmail] Verification error:', error);
    console.error('[auth.verifyEmail] Error message:', error?.message);
    console.error('[auth.verifyEmail] Error code:', error?.code);
    console.error('[auth.verifyEmail] Error response:', error?.response);
    console.error('[auth.verifyEmail] Full error object:', JSON.stringify(error, null, 2));
    
    // Provide more specific error messages
    if (error?.message?.includes('Invalid token') || error?.message?.includes('invalid')) {
      throw new Error('Invalid verification code. Please check your code and try again.');
    }
    
    throw new Error(error.message || 'Failed to verify email. Please check your code.');
  }
};

/**
 * Send Email OTP for verification
 * This is called on ConfirmAccountScreen after deleting the session
 */
export const sendEmailOTP = async (userId: string, email: string): Promise<void> => {
  console.log('[auth.sendEmailOTP] Sending Email OTP');
  console.log('[auth.sendEmailOTP] UserId:', userId);
  console.log('[auth.sendEmailOTP] Email:', email);
  
  try {
    await account.createEmailToken(userId, email);
    console.log('[auth.sendEmailOTP] Email OTP sent successfully');
  } catch (error: any) {
    console.error('[auth.sendEmailOTP] Error sending OTP:', error);
    console.error('[auth.sendEmailOTP] Error message:', error?.message);
    throw new Error(error.message || 'Failed to send verification email');
  }
};

/**
 * Resend email verification OTP
 * This requires userId and email since we don't have a session
 */
export const resendVerificationEmail = async (userId: string, email: string): Promise<void> => {
  console.log('[auth.resendVerificationEmail] Resending Email OTP');
  try {
    await account.createEmailToken(userId, email);
    console.log('[auth.resendVerificationEmail] Email OTP resent successfully');
  } catch (error: any) {
    console.error('[auth.resendVerificationEmail] Error:', error);
    throw new Error(error.message || 'Failed to resend verification email');
  }
};

/**
 * Get user ID from email using the Appwrite function
 * This uses the server-side function to look up a user by their email address
 */
export const getUserIdFromEmail = async (email: string): Promise<string> => {
  console.log('[auth.getUserIdFromEmail] Looking up userId for email:', email);
  
  try {
    const trimmedEmail = email.trim();
    const functionId = APPWRITE_EVENTS_FUNCTION_ID;
    
    if (!functionId) {
      throw new Error('Function ID not configured');
    }
    
    const requestBody = {
      email: trimmedEmail,
    };
    
    console.log('[auth.getUserIdFromEmail] Calling get-user-by-email function...');
    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify(requestBody),
      method: ExecutionMethod.POST,
      xpath: '/get-user-by-email',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });
    
    console.log('[auth.getUserIdFromEmail] Function execution status:', execution.status);
    
    if (execution.status === 'failed') {
      let errorMessage = 'Failed to look up user';
      if (execution.responseBody) {
        try {
          const errorResponse = JSON.parse(execution.responseBody);
          errorMessage = errorResponse.error || errorResponse.message || execution.responseBody;
        } catch {
          errorMessage = execution.responseBody;
        }
      }
      throw new Error(errorMessage);
    }
    
    if (execution.responseBody) {
      const result = JSON.parse(execution.responseBody);
      if (!result.success) {
        throw new Error(result.error || 'User not found');
      }
      console.log('[auth.getUserIdFromEmail] User found:', result.userId);
      return result.userId;
    }
    
    throw new Error('No response from function');
  } catch (error: any) {
    console.error('[auth.getUserIdFromEmail] Error:', error);
    console.error('[auth.getUserIdFromEmail] Error message:', error?.message);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('not found') || error?.message?.includes('User not found')) {
      throw new Error('No account found with this email address.');
    }
    
    throw new Error(error.message || 'Failed to look up user. Please try again.');
  }
};

/**
 * Send password recovery OTP via email
 * This is the new flow that:
 * 1. Gets userId from email using the function
 * 2. Sends Email OTP using createEmailToken (no link needed)
 * Returns the userId for use in the password reset flow
 */
export const sendPasswordRecoveryOTP = async (email: string): Promise<string> => {
  console.log('[auth.sendPasswordRecoveryOTP] Starting password recovery OTP flow');
  console.log('[auth.sendPasswordRecoveryOTP] Email:', email);
  
  try {
    const trimmedEmail = email.trim();
    
    // Step 1: Get userId from email using the function
    console.log('[auth.sendPasswordRecoveryOTP] Step 1: Getting userId from email...');
    const userId = await getUserIdFromEmail(trimmedEmail);
    console.log('[auth.sendPasswordRecoveryOTP] UserId retrieved:', userId);
    
    // Step 2: Send Email OTP using createEmailToken (reusing sendEmailOTP logic)
    console.log('[auth.sendPasswordRecoveryOTP] Step 2: Sending Email OTP...');
    await account.createEmailToken(userId, trimmedEmail);
    console.log('[auth.sendPasswordRecoveryOTP] Email OTP sent successfully');
    
    return userId;
  } catch (error: any) {
    console.error('[auth.sendPasswordRecoveryOTP] Error:', error);
    console.error('[auth.sendPasswordRecoveryOTP] Error message:', error?.message);
    console.error('[auth.sendPasswordRecoveryOTP] Error code:', error?.code);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('not found') || error?.message?.includes('No account found')) {
      throw new Error('No account found with this email address.');
    }
    
    throw new Error(error.message || 'Failed to send password recovery email. Please try again.');
  }
};

/**
 * Create password recovery token (DEPRECATED - Use sendPasswordRecoveryOTP instead)
 * Sends a recovery email to the user with a secret code
 * Returns the userId if available (Appwrite may include it in the response)
 */
export const createPasswordRecovery = async (email: string, url?: string): Promise<string | null> => {
  console.log('[auth.createPasswordRecovery] Creating password recovery token');
  console.log('[auth.createPasswordRecovery] Email:', email);
  
  try {
    const trimmedEmail = email.trim();
    // Appwrite's createRecovery requires both email and url parameters
    // For React Native apps, we provide a valid HTTPS URL (required by Appwrite)
    // The recovery email will contain the secret code that users enter in the app
    // The URL is required by Appwrite's API but the code is what users actually use
    const recoveryUrl = url || 'https://samplefinder.app/reset-password';
    const result = await account.createRecovery(trimmedEmail, recoveryUrl);
    console.log('[auth.createPasswordRecovery] Password recovery email sent successfully');
    console.log('[auth.createPasswordRecovery] Recovery result:', result);
    
    // Appwrite's createRecovery might return userId in the response
    // If not, we'll need to handle it differently in updatePasswordRecovery
    const userId = (result as any)?.userId || (result as any)?.$id || null;
    if (userId) {
      console.log('[auth.createPasswordRecovery] UserId from response:', userId);
    }
    
    return userId;
  } catch (error: any) {
    console.error('[auth.createPasswordRecovery] Error:', error);
    console.error('[auth.createPasswordRecovery] Error message:', error?.message);
    console.error('[auth.createPasswordRecovery] Error code:', error?.code);
    
    // Provide user-friendly error messages
    if (error?.code === 404 || error?.message?.includes('not found')) {
      throw new Error('No account found with this email address.');
    }
    
    throw new Error(error.message || 'Failed to send password recovery email. Please try again.');
  }
};

/**
 * Update user email
 */
export const updateEmail = async (email: string, password: string): Promise<void> => {
  console.log('[auth.updateEmail] Updating user email');
  
  try {
    const trimmedEmail = email.trim();
    await account.updateEmail(trimmedEmail, password);
    console.log('[auth.updateEmail] Email updated successfully');
  } catch (error: any) {
    console.error('[auth.updateEmail] Error updating email:', error);
    console.error('[auth.updateEmail] Error message:', error?.message);
    console.error('[auth.updateEmail] Error code:', error?.code);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('password') || error?.message?.includes('credentials')) {
      throw new Error('Current password is incorrect. Please try again.');
    }
    if (error?.code === 409 || error?.message?.includes('already exists')) {
      throw new Error('This email is already in use. Please use a different email.');
    }
    
    throw new Error(error.message || 'Failed to update email. Please try again.');
  }
};

/**
 * Update user password
 */
export const updatePassword = async (oldPassword: string, newPassword: string, newPasswordAgain: string): Promise<void> => {
  console.log('[auth.updatePassword] Updating user password');
  
  if (newPassword !== newPasswordAgain) {
    throw new Error('New passwords do not match. Please try again.');
  }
  
  try {
    await account.updatePassword(newPassword, oldPassword);
    console.log('[auth.updatePassword] Password updated successfully');
  } catch (error: any) {
    console.error('[auth.updatePassword] Error updating password:', error);
    console.error('[auth.updatePassword] Error message:', error?.message);
    console.error('[auth.updatePassword] Error code:', error?.code);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('password') || error?.message?.includes('credentials') || error?.message?.includes('old')) {
      throw new Error('Current password is incorrect. Please try again.');
    }
    if (error?.message?.includes('weak') || error?.message?.includes('requirements')) {
      throw new Error('New password does not meet security requirements. Please choose a stronger password.');
    }
    
    throw new Error(error.message || 'Failed to update password. Please try again.');
  }
};

/**
 * Verify Email OTP and reset password using backend function
 * The backend verifies the OTP and updates the password using server-side permissions
 * This approach doesn't create a client-side session, avoiding permission issues
 */
export const verifyEmailAndResetPassword = async (userId: string, otp: string, newPassword: string): Promise<void> => {
  console.log('[auth.verifyEmailAndResetPassword] Starting OTP verification and password reset');
  console.log('[auth.verifyEmailAndResetPassword] UserId:', userId);
  console.log('[auth.verifyEmailAndResetPassword] OTP length:', otp.length);
  
  try {
    // Call backend function to verify OTP and update password using server-side permissions
    // This doesn't create a client-side session, avoiding permission issues
    const requestBody = {
      userId,
      otp,
      newPassword,
    };
    
    console.log('[auth.verifyEmailAndResetPassword] Calling backend to verify OTP and reset password...');
    const execution = await functions.createExecution({
      functionId: APPWRITE_EVENTS_FUNCTION_ID,
      body: JSON.stringify(requestBody),
      method: ExecutionMethod.POST,
      xpath: '/reset-password-after-otp',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });

    console.log('[auth.verifyEmailAndResetPassword] Function execution status:', execution.status);
    console.log('[auth.verifyEmailAndResetPassword] Function response:', execution.responseBody);

    // Check if function execution was successful
    if (execution.status !== 'completed') {
      throw new Error('Function execution failed');
    }

    // Parse response
    const response = JSON.parse(execution.responseBody);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset password');
    }

    console.log('[auth.verifyEmailAndResetPassword] Password reset successfully');
  } catch (error: any) {
    console.error('[auth.verifyEmailAndResetPassword] Error:', error);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('Invalid') || error?.message?.includes('invalid') || error?.message?.includes('expired')) {
      throw new Error('Invalid or expired code. Please request a new password reset.');
    }
    
    if (error?.message?.includes('weak') || error?.message?.includes('requirements') || error?.message?.includes('8 characters')) {
      throw new Error('Password does not meet security requirements. Please choose a stronger password.');
    }

    const msg = error?.message ?? '';
    if (/same as.*username|username.*same as/i.test(msg)) {
      throw new Error('Password Cannot be same as Username');
    }
    
    throw new Error(error.message || 'Failed to reset password. Please try again.');
  }
};

/**
 * Reset password after Email OTP verification
 * This is used in the password reset flow where the user is authenticated via Email OTP
 * and doesn't have their old password
 * Uses a backend function to update the password with server-side permissions
 */
export const resetPasswordAfterOTPVerification = async (userId: string, newPassword: string): Promise<void> => {
  console.log('[auth.resetPasswordAfterOTPVerification] Resetting password after OTP verification');
  console.log('[auth.resetPasswordAfterOTPVerification] UserId:', userId);
  
  try {
    // Call backend function to update password using server-side permissions
    // This doesn't require the old password
    const requestBody = {
      userId,
      newPassword,
    };
    
    const execution = await functions.createExecution({
      functionId: APPWRITE_EVENTS_FUNCTION_ID,
      body: JSON.stringify(requestBody),
      method: ExecutionMethod.POST,
      xpath: '/reset-password-after-otp',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });

    console.log('[auth.resetPasswordAfterOTPVerification] Function execution status:', execution.status);
    console.log('[auth.resetPasswordAfterOTPVerification] Function response:', execution.responseBody);

    // Check if function execution was successful
    if (execution.status !== 'completed') {
      throw new Error('Function execution failed');
    }

    // Parse response
    const response = JSON.parse(execution.responseBody);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset password');
    }

    console.log('[auth.resetPasswordAfterOTPVerification] Password reset successfully');
  } catch (error: any) {
    console.error('[auth.resetPasswordAfterOTPVerification] Error resetting password:', error);
    console.error('[auth.resetPasswordAfterOTPVerification] Error message:', error?.message);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('weak') || error?.message?.includes('requirements') || error?.message?.includes('8 characters')) {
      throw new Error('Password does not meet security requirements. Please choose a stronger password.');
    }

    const msg = error?.message ?? '';
    if (/same as.*username|username.*same as/i.test(msg)) {
      throw new Error('Password Cannot be same as Username');
    }
    
    throw new Error(error.message || 'Failed to reset password. Please try again.');
  }
};

/**
 * Update password using recovery secret
 * This is called after the user verifies the recovery code
 * Note: If userId is not provided, Appwrite might extract it from the secret
 */
export const updatePasswordRecovery = async (
  secret: string,
  password: string,
  passwordAgain: string,
  userId?: string
): Promise<void> => {
  console.log('[auth.updatePasswordRecovery] Updating password with recovery secret');
  if (userId) {
    console.log('[auth.updatePasswordRecovery] UserId:', userId);
  } else {
    console.log('[auth.updatePasswordRecovery] No userId provided - Appwrite will extract from secret');
  }
  
  if (password !== passwordAgain) {
    throw new Error('Passwords do not match. Please try again.');
  }
  
  try {
    // Appwrite's updateRecovery requires userId and secret
    // If userId is not provided, we might need to try a different approach
    // For now, we'll require userId - it should be passed from the recovery response or stored
    if (!userId) {
      throw new Error('User ID is required for password recovery. Please request a new password reset.');
    }
    
    // Appwrite updateRecovery only takes userId, secret, and password (no passwordAgain)
    await account.updateRecovery(userId, secret, password);
    console.log('[auth.updatePasswordRecovery] Password updated successfully');
  } catch (error: any) {
    console.error('[auth.updatePasswordRecovery] Error:', error);
    console.error('[auth.updatePasswordRecovery] Error message:', error?.message);
    console.error('[auth.updatePasswordRecovery] Error code:', error?.code);
    
    // Provide user-friendly error messages
    if (error?.message?.includes('Invalid token') || error?.message?.includes('invalid') || error?.message?.includes('expired')) {
      throw new Error('Invalid or expired recovery code. Please request a new password reset.');
    }
    
    if (error?.message?.includes('password') && error?.message?.includes('weak')) {
      throw new Error('Password does not meet security requirements. Please choose a stronger password.');
    }
    
    throw new Error(error.message || 'Failed to reset password. Please try again.');
  }
};

/**
 * Delete user account
 * This will delete both the Appwrite account and the user profile from the database
 * Uses the Appwrite Function to perform server-side deletion of the auth account
 */
export const deleteAccount = async (): Promise<void> => {
  console.log('[auth.deleteAccount] Starting account deletion process');
  
  try {
    // Get current user first
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('No user is currently logged in');
    }
    
    console.log('[auth.deleteAccount] Deleting push target...');
    // Delete push target before deleting account
    try {
      const { deletePushTarget } = await import('./notifications');
      await deletePushTarget();
      console.log('[auth.deleteAccount] Push target deleted successfully');
    } catch (pushError: any) {
      console.warn('[auth.deleteAccount] Failed to delete push target:', pushError);
      // Continue with account deletion even if push target deletion fails
    }
    
    console.log('[auth.deleteAccount] Calling server function to delete account...');
    // Call the Appwrite Function to delete the user account from Auth
    // The function will also handle database profile deletion
    try {
      const functionId = APPWRITE_EVENTS_FUNCTION_ID;
      if (!functionId) {
        throw new Error('Function ID not configured');
      }
      
      const requestBody = {
        userId: user.$id,
      };
      
      const execution = await functions.createExecution({
        functionId,
        body: JSON.stringify(requestBody),
        method: ExecutionMethod.POST,
        xpath: '/delete-account',
        headers: {
          'Content-Type': 'application/json',
        },
        async: false,
      });
      
      console.log('[auth.deleteAccount] Function execution status:', execution.status);
      
      if (execution.status === 'failed') {
        let errorMessage = 'Failed to delete account';
        if (execution.responseBody) {
          try {
            const errorResponse = JSON.parse(execution.responseBody);
            errorMessage = errorResponse.error || errorResponse.message || execution.responseBody;
          } catch {
            errorMessage = execution.responseBody;
          }
        }
        throw new Error(errorMessage);
      }
      
      if (execution.responseBody) {
        const result = JSON.parse(execution.responseBody);
        if (!result.success) {
          throw new Error(result.error || 'Failed to delete account');
        }
        console.log('[auth.deleteAccount] Account deleted successfully:', result.message);
      }
    } catch (functionError: any) {
      console.error('[auth.deleteAccount] Function execution failed:', functionError);
      throw new Error(functionError.message || 'Failed to delete account from server');
    }
    
    // Try to delete local sessions, but don't fail if it errors
    // (the account is already deleted, so sessions are gone)
    console.log('[auth.deleteAccount] Cleaning up local sessions...');
    try {
      await account.deleteSessions();
      console.log('[auth.deleteAccount] Local sessions deleted');
    } catch (sessionError: any) {
      // Ignore errors - if account was deleted, sessions are already gone
      // This is expected to fail with "missing scopes" since the user no longer exists
      console.log('[auth.deleteAccount] Session cleanup skipped (account already deleted)');
    }

    // Clear cached per-user state so a different account on this device starts clean.
    try {
      const { useFavoritesStore } = await import('@/stores/favoritesStore');
      useFavoritesStore.getState().clear();
    } catch (error) {
      console.warn('[auth.deleteAccount] Failed to clear favorites store:', error);
    }

    console.log('[auth.deleteAccount] Account deletion completed successfully');
  } catch (error: any) {
    console.error('[auth.deleteAccount] Error deleting account:', error);
    console.error('[auth.deleteAccount] Error message:', error?.message);
    console.error('[auth.deleteAccount] Error code:', error?.code);
    throw new Error(error.message || 'Failed to delete account. Please try again.');
  }
};

/**
 * Delete an account by userId without requiring an active session.
 * Used to discard an unverified account from the OTP confirmation screen,
 * where the session has already been cleared as part of the OTP send flow.
 * Frees the email/username/phone for a clean re-signup with corrections.
 */
export const deleteAccountById = async (userId: string): Promise<void> => {
  console.log('[auth.deleteAccountById] Deleting unverified account', userId);
  if (!userId) {
    throw new Error('userId is required');
  }

  const functionId = APPWRITE_EVENTS_FUNCTION_ID;
  if (!functionId) {
    throw new Error('Function ID not configured');
  }

  const execution = await functions.createExecution({
    functionId,
    body: JSON.stringify({ userId }),
    method: ExecutionMethod.POST,
    xpath: '/delete-account',
    headers: { 'Content-Type': 'application/json' },
    async: false,
  });

  if (execution.status === 'failed') {
    let errorMessage = 'Failed to delete account';
    if (execution.responseBody) {
      try {
        const errorResponse = JSON.parse(execution.responseBody);
        errorMessage = errorResponse.error || errorResponse.message || execution.responseBody;
      } catch {
        errorMessage = execution.responseBody;
      }
    }
    throw new Error(errorMessage);
  }

  if (execution.responseBody) {
    const result = JSON.parse(execution.responseBody);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete account');
    }
  }
};

export default {
  signup,
  login,
  getCurrentUser,
  logout,
  isLoggedIn,
  sendVerificationEmail,
  sendEmailOTP,
  verifyEmail,
  verifyEmailAndResetPassword,
  resendVerificationEmail,
  getUserIdFromEmail,
  sendPasswordRecoveryOTP,
  resetPasswordAfterOTPVerification,
  createPasswordRecovery,
  updatePasswordRecovery,
  updateEmail,
  updatePassword,
  deleteAccount,
  deleteAccountById,
};

