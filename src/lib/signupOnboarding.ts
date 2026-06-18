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
