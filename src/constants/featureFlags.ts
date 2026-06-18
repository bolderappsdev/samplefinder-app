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
