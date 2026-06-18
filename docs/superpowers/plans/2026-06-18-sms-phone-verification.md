# SMS Phone Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a new user to verify both their email and their phone number at signup, using Appwrite's native phone verification backed by Twilio.

**Architecture:** Phone numbers are set in E.164 on the Appwrite account during `signup()`; the phone step calls `account.createPhoneVerification()` / `account.updatePhoneVerification()` (SMS sent by Twilio, configured in the Appwrite Console). A `user_profiles.phoneVerified` flag mirrors completion and drives routing; existing users are grandfathered via a one-off backfill. A `PHONE_VERIFICATION_ENABLED` feature flag gates the whole feature so code can merge before the provider is live.

**Tech Stack:** Expo SDK 54 / RN 0.81, `react-native-appwrite@0.18` (mobile), `node-appwrite@14.1` (admin scripts), Appwrite Cloud, Twilio SMS.

## Global Constraints

- **Appwrite SDK call style:** use the **object-based** signatures for all NEW calls (e.g. `account.updatePhone({ phone, password })`), per workspace `CLAUDE.md`. `react-native-appwrite@0.18` supports them (account.d.ts:475/1087). Do NOT rewrite the existing positional calls in `auth.ts`.
- **No server API keys in the mobile client** — phone verification uses the session-based `Account` API only.
- **No test framework exists** in either repo. Per-task verification = `cd samplefinder-app && npm run typecheck` (must pass) + the manual check named in the task. The whole feature ends with `/app-check`. Do **not** add a test runner.
- **US numbers only** (`+1`), matching the existing 10-digit validation.
- **Feature flag:** every signup/verification/gate behavior added here MUST be gated behind `PHONE_VERIFICATION_ENABLED` (Task 1). Default `false`.
- **Mobile path alias:** `@/` → `src/`. Object-param Appwrite calls only.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Release sequencing (CRITICAL — read before deploying)

The code may merge in any order, but **production rollout must be**:

1. Deploy the `phoneVerified` attribute to the live DB (Task 8).
2. Run the backfill so all existing users are `phoneVerified = true` (Task 9).
3. Configure Twilio + finish A2P 10DLC registration (Task 10).
4. **Re-run the backfill** (idempotent) to grandfather anyone who signed up since step 2.
5. Flip `PHONE_VERIFICATION_ENABLED = true` and release the app (Final Task).

Releasing the flag-on app before steps 1–3 would break **all** new signups (no SMS provider → `createPhoneVerification()` fails). The flag default (`false`) makes the merged code behave exactly like today until step 5.

---

### Task 1: Feature flag constant

**Files:**
- Create: `samplefinder-app/src/constants/featureFlags.ts`

**Interfaces:**
- Produces: `export const PHONE_VERIFICATION_ENABLED: boolean` — consumed by Tasks 2 (data model write), 4, 6, 7.

- [ ] **Step 1: Create the flag**

```typescript
// samplefinder-app/src/constants/featureFlags.ts
/**
 * SMS phone-verification rollout flag.
 *
 * Keep FALSE until the Twilio SMS provider is configured in the Appwrite
 * Console AND A2P 10DLC registration is approved. While false, signup behaves
 * exactly as before (email verification only) and no phoneVerified writes or
 * phone gating occur. Flip to TRUE only in the release that ships AFTER the
 * provider is live and the backfill (grandfathering) has been re-run.
 */
export const PHONE_VERIFICATION_ENABLED = false;
```

- [ ] **Step 2: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes (no errors).

- [ ] **Step 3: Commit**

```bash
cd samplefinder-app
git add src/constants/featureFlags.ts
git commit -m "feat(auth): add PHONE_VERIFICATION_ENABLED feature flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `phoneVerified` data model (type, create default, getter, setter)

**Files:**
- Modify: `samplefinder-app/src/lib/database/types.ts` (add field to `UserProfileRow`)
- Modify: `samplefinder-app/src/lib/database/users.ts` (`createUserProfile` rowData ~line 220-232; `getUserProfile` mapping ~line 859-886; add `markPhoneVerified`)
- Modify: `samplefinder-app/src/lib/database/index.ts` (export `markPhoneVerified`)

**Interfaces:**
- Consumes: `PHONE_VERIFICATION_ENABLED` (Task 1).
- Produces: `UserProfileRow.phoneVerified?: boolean`; `markPhoneVerified(authID: string): Promise<void>` — consumed by Tasks 6, 7.

- [ ] **Step 1: Add the field to the row type**

In `src/lib/database/types.ts`, inside `interface UserProfileRow` (after the `tierLevel` line, currently line 35), add:

```typescript
  tierLevel?: string | null; // Current tier name (e.g. "SampleFan") when user achieves a tier
  /** True once SMS phone verification is complete (or grandfathered via backfill). */
  phoneVerified?: boolean;
```

- [ ] **Step 2: Write `phoneVerified` on profile creation (flag-gated)**

In `src/lib/database/users.ts`, add the import at the top (after line 6):

```typescript
import { PHONE_VERIFICATION_ENABLED } from '@/constants/featureFlags';
```

Then in `createUserProfile`, change the `rowData` object (currently lines 220-232) to conditionally include the flag. Replace the closing of the object so it reads:

```typescript
    const rowData: any = {
      authID: profileData.authID,
      firstname: profileData.firstname,
      lastname: profileData.lastname,
      phoneNumber: profileData.phoneNumber,
      zipCode: profileData.zipCode,
      dob: dobISO,
      username: profileData.username,
      role: profileData.role || 'user',
      idAdult: profileData.isAdult ?? false, // Use 'idAdult' to match Appwrite column name
      referralCode: referralCode,
      totalPoints: 100, // Sign up credit points for new users
      // Only write phoneVerified once the feature (and its DB attribute) is live,
      // so the dormant build does not depend on an attribute that may not exist yet.
      ...(PHONE_VERIFICATION_ENABLED ? { phoneVerified: false } : {}),
    };
```

- [ ] **Step 3: Return `phoneVerified` from `getUserProfile`**

In `src/lib/database/users.ts`, in the object returned by `getUserProfile` (currently ending at line 885-886 with `tierLevel`), add the field:

```typescript
      tierLevel: profile.tierLevel ?? null,
      phoneVerified: Boolean(profile.phoneVerified),
    };
```

- [ ] **Step 4: Add the `markPhoneVerified` setter**

In `src/lib/database/users.ts`, add this function immediately after `getUserProfile` (after line 893):

```typescript
/**
 * Mark the user's profile as phone-verified. Called after a successful
 * Appwrite phone-verification OTP. The user has update permission on their
 * own profile row, so this runs with the user's session.
 */
export const markPhoneVerified = async (authID: string): Promise<void> => {
  console.log('[database.markPhoneVerified] Marking phone verified for authID:', authID);

  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    throw new Error('Database ID or Table ID not configured. Please check your .env file.');
  }

  const profile = await getUserProfile(authID);
  if (!profile) {
    throw new Error('User profile not found');
  }

  await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: USER_PROFILES_TABLE_ID,
    rowId: profile.$id,
    data: { phoneVerified: true },
  });

  console.log('[database.markPhoneVerified] Phone marked verified for profile:', profile.$id);
};
```

- [ ] **Step 5: Export the setter from the barrel**

In `src/lib/database/index.ts`, add `markPhoneVerified` to the `export { ... } from './users';` block (currently lines 22-36):

```typescript
  checkPhoneNumberExists,
  checkPhoneNumberExistsForDifferentUser,
  markPhoneVerified,
} from './users';
```

- [ ] **Step 6: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
cd samplefinder-app
git add src/lib/database/types.ts src/lib/database/users.ts src/lib/database/index.ts
git commit -m "feat(db): add phoneVerified field, default, getter and markPhoneVerified setter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `toE164US` phone formatter

**Files:**
- Modify: `samplefinder-app/src/utils/formatters.ts` (add after `isValidPhoneNumber`, line 86)

**Interfaces:**
- Produces: `toE164US(phone: string): string` — consumed by Task 4.

- [ ] **Step 1: Add the formatter**

In `src/utils/formatters.ts`, immediately after `isValidPhoneNumber` (after line 86), add:

```typescript
/**
 * Convert a US phone number (any common display format) to E.164 (+1XXXXXXXXXX),
 * the format Appwrite requires for account phone verification.
 * Accepts a 10-digit number, or an 11-digit number starting with 1.
 *
 * Examples:
 *   toE164US('(617) 555-1212') === '+16175551212'
 *   toE164US('6175551212')     === '+16175551212'
 *   toE164US('1 617 555 1212') === '+16175551212'
 *
 * @throws Error when the input is not a valid US phone number.
 */
export const toE164US = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  throw new Error('Invalid US phone number; expected 10 digits.');
};
```

- [ ] **Step 2: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 3: Verify behavior manually**

Confirm by inspection that the three documented examples above hold (10-digit → `+1` prefixed; 11-digit leading-1 → `+` prefixed; anything else throws). The signup form already restricts input to 10 digits via `isValidPhoneNumber`, so the 10-digit branch is the normal path.

- [ ] **Step 4: Commit**

```bash
cd samplefinder-app
git add src/utils/formatters.ts
git commit -m "feat(utils): add toE164US phone formatter for Appwrite phone verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Appwrite phone-verification calls in `auth.ts` + set account phone at signup

**Files:**
- Modify: `samplefinder-app/src/lib/auth.ts` (imports; `signup()` ~after line 169; append three functions)

**Interfaces:**
- Consumes: `toE164US` (Task 3), `PHONE_VERIFICATION_ENABLED` (Task 1). `account` is already instantiated (auth.ts:11).
- Produces:
  - `sendPhoneVerification(): Promise<void>`
  - `verifyPhone(userId: string, secret: string): Promise<void>`
  - `ensureAccountPhoneForVerification(phoneNumber: string, password: string): Promise<void>`
  Consumed by Tasks 6, 7.

- [ ] **Step 1: Add imports**

In `src/lib/auth.ts`, after the existing imports (after line 7), add:

```typescript
import { toE164US } from '@/utils/formatters';
import { PHONE_VERIFICATION_ENABLED } from '@/constants/featureFlags';
```

- [ ] **Step 2: Set the account phone during signup (flag-gated)**

In `signup()`, immediately after `await storePendingReferralCode(credentials.referralCode);` (line 169), inside the same `try`, add:

```typescript
      // Set the phone number on the Appwrite account (E.164) so Appwrite can
      // later send the verification SMS. Requires the active session + password,
      // both available here. A duplicate phone throws 409 and is handled by the
      // outer catch (mapped to the "phone already exists" message).
      if (PHONE_VERIFICATION_ENABLED) {
        await account.updatePhone({
          phone: toE164US(credentials.phoneNumber),
          password: credentials.password,
        });
        console.log('[auth.signup] Account phone set for verification');
      }
```

- [ ] **Step 3: Append the three phone-verification functions**

At the end of `src/lib/auth.ts`, after `resendVerificationEmail` (or anywhere after the email helpers; before `getUserIdFromEmail` is fine), add:

```typescript
/**
 * Send the phone-verification SMS to the account's current phone number.
 * The phone must already be set on the account (done in signup() or repaired
 * via ensureAccountPhoneForVerification). Requires an active session.
 */
export const sendPhoneVerification = async (): Promise<void> => {
  console.log('[auth.sendPhoneVerification] Sending phone verification SMS');
  try {
    await account.createPhoneVerification();
    console.log('[auth.sendPhoneVerification] Verification SMS sent');
  } catch (error: any) {
    console.error('[auth.sendPhoneVerification] Error:', error?.message);
    throw new Error(error.message || 'Failed to send verification SMS. Please try again.');
  }
};

/**
 * Complete phone verification with the OTP the user received via SMS.
 * Sets the native account.phoneVerification flag to true.
 */
export const verifyPhone = async (userId: string, secret: string): Promise<void> => {
  console.log('[auth.verifyPhone] Verifying phone OTP for user:', userId);
  try {
    await account.updatePhoneVerification({ userId, secret });
    console.log('[auth.verifyPhone] Phone verified successfully');
  } catch (error: any) {
    console.error('[auth.verifyPhone] Error:', error?.message);
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('invalid') || msg.includes('token') || msg.includes('expired')) {
      throw new Error('Invalid or expired code. Please check your code and try again.');
    }
    throw new Error(error.message || 'Failed to verify phone. Please check your code.');
  }
};

/**
 * Repair path: ensure the account has a phone number set before phone
 * verification. Used at login (where the password is available) to recover
 * accounts whose phone was never set (e.g. a signup that failed mid-way).
 * No-op if the account already has a phone.
 */
export const ensureAccountPhoneForVerification = async (
  phoneNumber: string,
  password: string
): Promise<void> => {
  try {
    const acct = await account.get();
    if (!acct.phone) {
      await account.updatePhone({ phone: toE164US(phoneNumber), password });
      console.log('[auth.ensureAccountPhoneForVerification] Account phone set (repair)');
    }
  } catch (error: any) {
    console.warn(
      '[auth.ensureAccountPhoneForVerification] Could not ensure account phone:',
      error?.message
    );
    // Non-fatal: sendPhoneVerification will surface a clear error if the phone is missing.
  }
};
```

- [ ] **Step 4: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
cd samplefinder-app
git add src/lib/auth.ts
git commit -m "feat(auth): add phone verification calls and set account phone at signup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ConfirmPhoneScreen` + `useConfirmPhoneScreen` + route registration

**Files:**
- Create: `samplefinder-app/src/lib/signupOnboarding.ts`
- Create: `samplefinder-app/src/screens/auth/ConfirmPhoneScreen.tsx`
- Create: `samplefinder-app/src/screens/auth/useConfirmPhoneScreen.ts`
- Modify: `samplefinder-app/src/navigation/AppNavigator.tsx` (import, `RootStackParamList`, `<Stack.Screen>`)

**Interfaces:**
- Consumes: `sendPhoneVerification`, `verifyPhone` (Task 4); `markPhoneVerified` (Task 2); existing `logout` (auth.ts), `useAuthStore`, `getUserProfile`, `applyReferralAfterVerification`, `initializePushNotifications`, `createUserNotification`, `useTier1ModalStore`, `CodeInput`/`CodeInputRef`, `ScreenWrapper`, `CustomButton`, and the existing `./confirm-account/styles`.
- Produces: `completeSignupOnboarding(userId: string): Promise<void>` (shared onboarding helper — also consumed by Task 6); route `ConfirmPhone` in `RootStackParamList` with params `{ phoneNumber?: string }`.

> **Note on onboarding side-effects:** The post-signup onboarding (referral apply, push init, welcome notification, Tier 1 modal) is extracted into a single shared `completeSignupOnboarding(userId)` helper so it is defined once. The phone hook calls it on success; Task 6 makes the email hook's flag-off path call the same helper. This avoids duplicating the logic block across the two hooks.

- [ ] **Step 1: Register the route in `AppNavigator.tsx`**

Add the import (after line 8):

```typescript
import ConfirmPhoneScreen from '@/screens/auth/ConfirmPhoneScreen';
```

Add to `RootStackParamList` (after the `ConfirmAccount` line, line 28):

```typescript
  ConfirmPhone: { phoneNumber?: string };
```

Add the screen inside `<Stack.Navigator>` (after the `ConfirmAccount` screen, line 328):

```typescript
          <Stack.Screen name="ConfirmPhone" component={ConfirmPhoneScreen} />
```

- [ ] **Step 2: Create the shared onboarding helper, then the hook**

First create `src/lib/signupOnboarding.ts` (the one-time post-signup side-effects, extracted so both the phone hook and the email hook call the same code):

```typescript
// samplefinder-app/src/lib/signupOnboarding.ts
import { useAuthStore } from '@/stores/authStore';
import { initializePushNotifications } from '@/lib/notifications';
import { applyReferralAfterVerification } from '@/lib/referral';
import { createUserNotification } from '@/lib/database';
import { useTier1ModalStore } from '@/stores/tier1ModalStore';

/** Tracks welcome-notification attempts per user to avoid duplicates on retry. */
const welcomeAttempted = new Set<string>();

/**
 * Run the one-time post-signup onboarding side-effects. Called exactly once,
 * after the user has completed ALL required verifications (email, and phone
 * when enabled). Safe to retry: the welcome notification is attempted at most
 * once per user per app session.
 */
export const completeSignupOnboarding = async (userId: string): Promise<void> => {
  // Apply any pending referral code now that the account is fully verified.
  await applyReferralAfterVerification(userId);

  // Small delay so the backend has updated the profile with usedReferralCode.
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Populate the auth store before App.tsx's Tier 1 modal effect reads `user`.
  await useAuthStore.getState().fetchUser();

  // Register the FCM + Appwrite push target BEFORE the welcome notification:
  // createUserNotification triggers sendPushNotification, which needs a target.
  try {
    await initializePushNotifications();
  } catch (error) {
    console.warn('[signupOnboarding] Push init failed (welcome still attempted):', error);
  }

  if (!welcomeAttempted.has(userId)) {
    welcomeAttempted.add(userId);
    try {
      await createUserNotification({
        userId,
        type: 'tierChanged',
        title: 'Welcome to SampleFinder!',
        message: "You've joined! Start discovering samples and earning rewards.",
        data: { source: 'signup', tierWelcome: 'true' },
      });
    } catch (notifErr) {
      console.warn('[signupOnboarding] Failed to create welcome notification:', notifErr);
      welcomeAttempted.delete(userId); // Allow retry on a later verification attempt.
    }
  }

  // Trigger the Tier 1 modal for newly signed-up users (auth user must be set).
  useTier1ModalStore.getState().setShouldShowTier1Modal(true);
};
```

Then create the hook `src/screens/auth/useConfirmPhoneScreen.ts`:

```typescript
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
```

- [ ] **Step 3: Create the screen `ConfirmPhoneScreen.tsx`** (clones `ConfirmAccountScreen`, reuses its styles)

```typescript
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
```

- [ ] **Step 4: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes. (If `tier1ModalStore` path differs, confirm the import used by `useConfirmAccountScreen.ts` line 12 and match it exactly.)

- [ ] **Step 5: Commit**

```bash
cd samplefinder-app
git add src/lib/signupOnboarding.ts src/screens/auth/ConfirmPhoneScreen.tsx src/screens/auth/useConfirmPhoneScreen.ts src/navigation/AppNavigator.tsx
git commit -m "feat(auth): add shared signup-onboarding helper, ConfirmPhone screen, hook and route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Route email step → phone step; email path uses the shared onboarding helper

**Files:**
- Modify: `samplefinder-app/src/screens/auth/useConfirmAccountScreen.ts` (`handleVerify`, lines 113-181; imports)

**Interfaces:**
- Consumes: `PHONE_VERIFICATION_ENABLED` (Task 1); `completeSignupOnboarding` (Task 5); `getUserProfile` (`@/lib/database`); route `ConfirmPhone` (Task 5).
- Behavior: after email verify — flag ON → navigate to `ConfirmPhone` (onboarding runs there); flag OFF → run `completeSignupOnboarding(userId)` then go to `MainTabs` (same observable behavior as today, now via the shared helper).

- [ ] **Step 1: Update imports**

In `src/screens/auth/useConfirmAccountScreen.ts`, replace the import block (lines 1-12) so the inline onboarding imports are dropped in favor of the shared helper. The new top-of-file imports are:

```typescript
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
```

(Removed: `initializePushNotifications`, `createUserNotification`, `applyReferralAfterVerification`, `useTier1ModalStore` — now encapsulated in `completeSignupOnboarding`.)

- [ ] **Step 2: Replace `handleVerify` and remove the now-unused ref**

Delete the `const welcomeNotificationAttempted = useRef(false);` line (currently line 31 — its logic now lives in the helper). Then replace the entire `handleVerify` function (currently lines 113-181) with:

```typescript
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
```

- [ ] **Step 3: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification (flag OFF)**

With `PHONE_VERIFICATION_ENABLED = false`, confirm by reading the code path that signup → email OTP → `MainTabs` is observably identical to today: the phone branch is skipped and `completeSignupOnboarding(userId)` runs the same referral/push/welcome/Tier-1 side-effects the inline block used to. No SMS, no ConfirmPhone.

- [ ] **Step 5: Commit**

```bash
cd samplefinder-app
git add src/screens/auth/useConfirmAccountScreen.ts
git commit -m "feat(auth): hand off to phone step after email verify when enabled

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `phoneVerified` routing gate (login + session-restore)

**Files:**
- Modify: `samplefinder-app/src/screens/auth/useLoginScreen.ts` (`handleLogin` success block, lines 144-178; imports)
- Modify: `samplefinder-app/src/navigation/AppNavigator.tsx` (`checkAuthSession`, lines 263-279; imports)

**Interfaces:**
- Consumes: `PHONE_VERIFICATION_ENABLED` (Task 1); `ensureAccountPhoneForVerification` (Task 4); `getUserProfile` (already imported in `useLoginScreen.ts:9`); `UserProfileRow.phoneVerified` (Task 2).

- [ ] **Step 1: Login-time gate + repair**

In `src/screens/auth/useLoginScreen.ts`, add imports:

```typescript
import { login, ensureAccountPhoneForVerification } from '@/lib/auth';
import { PHONE_VERIFICATION_ENABLED } from '@/constants/featureFlags';
```

(The first replaces the existing `import { login } from '@/lib/auth';` on line 5.)

Then refactor the success block. Replace the current favorites-hydration + verification routing (lines 144-178) with:

```typescript
      // Sync Zustand with the new Appwrite session (logout/login does not run AppNavigator's initial fetchUser)
      const authedUser = await useAuthStore.getState().fetchUser();

      // Hydrate favorites + read phoneVerified from the same profile fetch.
      let profile: Awaited<ReturnType<typeof getUserProfile>> = null;
      if (authedUser) {
        try {
          profile = await getUserProfile(authedUser.$id);
          useFavoritesStore.getState().setFavorites(profile?.favoriteIds ?? []);
        } catch (favoritesError) {
          console.warn('[LoginScreen] Failed to hydrate favorites store:', favoritesError);
          useFavoritesStore.getState().clear();
        }
      }

      // 1) Email not verified → existing email OTP flow.
      if (!user.emailVerification) {
        console.log('[LoginScreen] Email not verified, navigating to ConfirmAccount');
        navigation.navigate('ConfirmAccount', {});
        return;
      }

      // 2) Phone not verified (new, non-grandfathered users) → phone step.
      if (PHONE_VERIFICATION_ENABLED && profile && profile.phoneVerified === false) {
        console.log('[LoginScreen] Phone not verified, navigating to ConfirmPhone');
        await ensureAccountPhoneForVerification(profile.phoneNumber, password);
        navigation.reset({
          index: 0,
          routes: [{ name: 'ConfirmPhone', params: { phoneNumber: profile.phoneNumber } }],
        });
        return;
      }

      // 3) Fully verified → main app.
      console.log('[LoginScreen] Verified, navigating to MainTabs');
      initializePushNotifications().catch((error) => {
        console.warn('[LoginScreen] Failed to initialize push notifications:', error);
      });
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
```

- [ ] **Step 2: Session-restore gate**

In `src/navigation/AppNavigator.tsx`, add imports (after line 13 `useAuthStore`):

```typescript
import { getUserProfile } from '@/lib/database';
import { PHONE_VERIFICATION_ENABLED } from '@/constants/featureFlags';
```

Replace `checkAuthSession` (lines 263-279) with:

```typescript
  const checkAuthSession = async () => {
    try {
      const user = await useAuthStore.getState().fetchUser();

      if (!user) {
        setInitialRouteName('Login');
        return;
      }

      if (PHONE_VERIFICATION_ENABLED) {
        try {
          const profile = await getUserProfile(user.$id);
          if (profile && profile.phoneVerified === false) {
            setInitialRouteName('ConfirmPhone');
            return;
          }
        } catch (profileError) {
          console.warn('[AppNavigator] phoneVerified gate check failed:', profileError);
          // Fall through to MainTabs rather than locking a returning user out.
        }
      }

      setInitialRouteName('MainTabs');
    } catch (error: any) {
      console.error('[AppNavigator] Error checking session:', error);
      setInitialRouteName('Login');
    } finally {
      setIsLoading(false);
    }
  };
```

- [ ] **Step 3: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification (flag OFF)**

Confirm that with the flag OFF, both gates skip the phone branch: login routes by `emailVerification` exactly as before, and `checkAuthSession` routes `user ? MainTabs : Login` exactly as before.

- [ ] **Step 5: Commit**

```bash
cd samplefinder-app
git add src/screens/auth/useLoginScreen.ts src/navigation/AppNavigator.tsx
git commit -m "feat(auth): gate login and session restore on phoneVerified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add `phoneVerified` attribute to Appwrite (`samplefinder-admin/`)

**Files:**
- Modify: `samplefinder-admin/appwrite/appwrite.config.json` (`user_profiles` → `columns`)

**Interfaces:**
- Produces: a `phoneVerified` boolean attribute (default `false`) on the live `user_profiles` collection.

- [ ] **Step 1: Add the column to config**

In `samplefinder-admin/appwrite/appwrite.config.json`, in the `user_profiles` collection's `columns` array (after the `phoneNumber` column, line 170), add:

```json
                {
                    "key": "phoneVerified",
                    "type": "boolean",
                    "required": false,
                    "array": false,
                    "default": false
                },
```

- [ ] **Step 2: Deploy the attribute to the live project**

Preferred (reliable on Appwrite Cloud): add the attribute **in the Appwrite Console** — `Databases → Sample Finder DB → user_profiles → Create attribute → Boolean`, key `phoneVerified`, default `false`, not required. This keeps the live DB and `appwrite.config.json` in sync.

If the team uses the Appwrite CLI for schema, run their existing push command from `samplefinder-admin/appwrite/` (verify the verb for the installed CLI version, e.g. `appwrite push collections`). Do not guess — confirm the CLI version first.

- [ ] **Step 3: Verify**

In the Appwrite Console, confirm `user_profiles` now lists a `phoneVerified` boolean attribute with status **available**.

- [ ] **Step 4: Commit**

```bash
cd samplefinder-admin
git add appwrite/appwrite.config.json
git commit -m "feat(appwrite): add phoneVerified attribute to user_profiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Backfill existing users to `phoneVerified = true` (grandfather)

**Files:**
- Create: `samplefinder-admin/scripts/backfill-phone-verified.mjs`
- Modify: `samplefinder-admin/package.json` (add script)

**Interfaces:**
- Consumes: the `phoneVerified` attribute (Task 8 must be live first).
- Produces: all existing `user_profiles` rows set to `phoneVerified = true`.

- [ ] **Step 1: Create the backfill script** (mirrors `backfill-event-location-ids.mjs`)

```javascript
// samplefinder-admin/scripts/backfill-phone-verified.mjs
/**
 * Grandfather existing users: set user_profiles.phoneVerified = true for every
 * row that is not already true. Idempotent — safe to run multiple times.
 * Requires a server API key with rows.read and rows.write on user_profiles.
 *
 * Usage (from samplefinder-admin):
 *   APPWRITE_API_KEY=... node scripts/backfill-phone-verified.mjs --dry-run
 *   APPWRITE_API_KEY=... node scripts/backfill-phone-verified.mjs
 */
import { Client, TablesDB, Query } from 'node-appwrite';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv();

const endpoint = process.env.VITE_APPWRITE_ENDPOINT || process.env.APPWRITE_ENDPOINT;
const projectId = process.env.VITE_APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || '69217af50038b9005a61';
const userProfilesTable = process.env.VITE_APPWRITE_COLLECTION_USER_PROFILES || 'user_profiles';

const DRY_RUN = process.argv.includes('--dry-run');

if (!endpoint || !projectId || !apiKey) {
  console.error(
    'Set VITE_APPWRITE_ENDPOINT, VITE_APPWRITE_PROJECT_ID, and APPWRITE_API_KEY (optionally in .env).'
  );
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tablesDB = new TablesDB(client);

async function main() {
  let offset = 0;
  const page = 100;
  let updated = 0;

  for (;;) {
    const res = await tablesDB.listRows({
      databaseId,
      tableId: userProfilesTable,
      queries: [Query.limit(page), Query.offset(offset)],
    });
    const rows = res.rows || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.phoneVerified === true) continue;

      if (DRY_RUN) {
        console.log(`[dry-run] ${row.$id} -> phoneVerified = true`);
        updated++;
        continue;
      }

      await tablesDB.updateRow({
        databaseId,
        tableId: userProfilesTable,
        rowId: row.$id,
        data: { phoneVerified: true },
      });
      console.log(`Updated ${row.$id} -> phoneVerified = true`);
      updated++;
    }

    if (rows.length < page) break;
    offset += page;
  }

  console.log(
    DRY_RUN ? `Dry run: would update ${updated} profile(s).` : `Done. Updated ${updated} profile(s).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `samplefinder-admin/package.json` `scripts`, next to `backfill:event-location-ids`, add:

```json
    "backfill:phone-verified": "node scripts/backfill-phone-verified.mjs",
```

- [ ] **Step 3: Dry-run, then run**

```bash
cd samplefinder-admin
APPWRITE_API_KEY=<server key> npm run backfill:phone-verified -- --dry-run
# Review the count, then:
APPWRITE_API_KEY=<server key> npm run backfill:phone-verified
```
Expected: dry-run prints the number of profiles it would update; the real run updates them and prints `Done. Updated N profile(s).`

- [ ] **Step 4: Commit**

```bash
cd samplefinder-admin
git add scripts/backfill-phone-verified.mjs package.json
git commit -m "chore(scripts): backfill phoneVerified=true for existing users

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Configure Twilio SMS provider + A2P 10DLC (operational — no code)

**Files:** none (Appwrite Console + Twilio Console).

**Blocked on:** Twilio credentials (provided later).

- [ ] **Step 1: Add Twilio as an SMS provider** — Appwrite Console → `Messaging → Providers → Add provider → Twilio`. Enter Account SID, Auth Token, and the sender phone number (or Messaging Service SID). Enable the provider. `messaging: true` is already set in the project.

- [ ] **Step 2: A2P 10DLC registration** — In Twilio, register the brand + campaign for US application-to-person SMS (or provision a verified toll-free number). Without this, US deliverability is throttled/blocked. Start early — approval can take several days.

- [ ] **Step 3: Verify end-to-end on a dev build** — temporarily set `PHONE_VERIFICATION_ENABLED = true` locally, sign up with a real US number, and confirm the SMS arrives and the code verifies. Revert the local flag change afterward (the real flip happens in the Final Task).

---

### Task 11 (OPTIONAL): Show `phoneVerified` in the admin dashboard

**Files:**
- Modify: `samplefinder-admin/` user detail view (locate the user-profile display component).

This is the spec's optional admin-visibility item. Only do it if desired; it is not required for the feature to function.

- [ ] **Step 1:** In the admin user detail view, read `phoneVerified` from the profile row and render a read-only "Phone verified: Yes/No" badge.
- [ ] **Step 2:** `cd samplefinder-admin && npm run build` (typechecks) — expected: passes.
- [ ] **Step 3:** Commit with the trailer.

---

### Final Task: Enable the feature and run the pre-merge gate

**Blocked on:** Tasks 8, 9, and 10 complete in production.

- [ ] **Step 1: Re-run the backfill** (idempotent) to grandfather anyone who signed up since the first run:

```bash
cd samplefinder-admin
APPWRITE_API_KEY=<server key> npm run backfill:phone-verified
```

- [ ] **Step 2: Flip the flag**

In `samplefinder-app/src/constants/featureFlags.ts`, set:

```typescript
export const PHONE_VERIFICATION_ENABLED = true;
```

- [ ] **Step 3: Typecheck**

Run: `cd samplefinder-app && npm run typecheck`
Expected: passes.

- [ ] **Step 4: Run `/app-check`** (typecheck + `senior-react-native` + `senior-typescript` + `senior-qa` + `senior-appwrite`, since this diff touches Appwrite).

- [ ] **Step 5: Manual QA matrix** (with the flag ON, provider live):
  - New signup → email OTP → phone OTP → lands in app; `user_profiles.phoneVerified === true`.
  - Wrong code → inline error; expired code → inline error; resend respects the 60s timer.
  - SMS send failure → clear inline error.
  - Kill the app mid-phone-step → relaunch re-gates to `ConfirmPhone`.
  - "Sign out" on the phone screen → returns to Login; next login re-gates to `ConfirmPhone`; the account is NOT deleted.
  - Grandfathered existing user logs in → goes straight to the app (NOT gated).
  - Duplicate phone at signup → blocked with a clear message.
  - Onboarding side-effects (referral, push target, welcome notification, Tier 1 modal) fire exactly once, after phone verification.

- [ ] **Step 6: Commit**

```bash
cd samplefinder-app
git add src/constants/featureFlags.ts
git commit -m "feat(auth): enable phone verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
