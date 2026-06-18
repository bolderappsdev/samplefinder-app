# SMS Phone Verification — Design

- **Date:** 2026-06-18
- **Status:** Approved (design); pending spec review
- **Repos touched:** `samplefinder-app/` (primary), `samplefinder-admin/appwrite/` (attribute, provider config, backfill)
- **Author:** Claude (brainstormed with @qudratillo)

## 1. Summary

Add **phone-number verification** to signup so a new user must verify **both** their email
**and** their phone before entering the app. Email verification already exists (Appwrite email
OTP). We add the phone half using **Appwrite's native account phone verification** backed by
**Twilio** as the SMS provider, configured in the Appwrite Console. No custom OTP generation or
SMS-sending code lives in our repos — Appwrite owns code generation, delivery, expiry,
rate-limiting, and the authoritative `account.phoneVerification` flag.

## 2. Current state (what exists today)

- **Signup collects a phone number already** — `samplefinder-app/src/screens/auth/SignUpScreen.tsx`
  + `useSignUpScreen.ts`: required, validated as a 10-digit US number, uniqueness-checked against
  `user_profiles` via `checkPhoneNumberExists`. Stored in `user_profiles.phoneNumber`
  (string, size 15). **Never verified.**
- **Email verification works** via Appwrite email OTP. `signup()` in `src/lib/auth.ts`:
  `account.create(...)` → `account.createEmailPasswordSession(...)` → `createUserProfile(...)`.
  Then `ConfirmAccountScreen` / `useConfirmAccountScreen.ts`: `logout()` (deletes session) →
  `sendEmailOTP` (`account.createEmailToken`) → user enters 6-digit code → `verifyEmail`
  (`account.createSession(userId, secret)`) which **both** verifies the email **and**
  re-establishes the session.
- **Phone verification: not implemented.** `auth.methods.phone: true` and `messaging: true` are
  already enabled in `appwrite.config.json`, but **no SMS provider is configured** and no
  `createPhoneVerification` / `createPhoneToken` call exists anywhere.
- **Backend:** Appwrite Cloud (`nyc.cloud.appwrite.io`). A **Mobile API** serverless function
  (`samplefinder-admin/appwrite/functions/Mobile API/`) holds a server API key
  (`users.read/write`, `databases.*`) and already exposes signup-support endpoints
  (`/get-user-by-email`, `/reset-password-after-otp`, `/delete-account`, …).
- **SDKs:** `react-native-appwrite@0.18` (mobile), `node-appwrite@14.1` (functions).
- **`User` interface** (`src/lib/auth.ts`) already exposes `phoneVerification: boolean`.

### Important code facts that shape this design

- **Appwrite calls in `auth.ts` use POSITIONAL signatures** (e.g.
  `account.create(userId, email, password, name)`, `createEmailToken(userId, email)`,
  `createSession(userId, secret)`), **not** the object-based style that the workspace `CLAUDE.md`
  prescribes. The installed `react-native-appwrite@0.18` accepts positional. **New phone calls
  will match the surrounding positional style; confirm against the installed SDK typings at
  implementation time** (see Open Questions).
- **The email-confirm screen deletes the session** before sending the OTP, then re-creates it on
  successful verify. A live, verified session therefore exists **after** the email step — which is
  what `account.createPhoneVerification()` requires. The account phone must be set earlier, in
  `signup()`, while both a session and the password are available; it persists across the logout.

## 3. Decisions (locked)

1. **Strategy:** Appwrite-native phone verification + **Twilio** SMS provider (Console-configured,
   swappable later for MSG91/Telesign/TextMagic/Vonage with no code change).
2. **Flow:** **Email → Phone, both mandatory** at signup. Email step is unchanged; a phone step is
   added immediately after it. No app entry until both are verified.
3. **Existing users:** **Grandfathered** — phone verification is enforced for **new signups only**.
4. **Gate mechanism (Approach A):** an explicit **`user_profiles.phoneVerified: boolean`** flag
   drives routing and gives the admin dashboard verified-status for free. A one-off backfill marks
   all existing users `true`.
5. **Onboarding side-effects move to after the phone step** (see §6).
6. **Scope:** **US numbers only** (`+1`), matching current 10-digit validation. Changing the phone
   in EditProfile does **not** trigger re-verification this iteration.

## 4. Goals / Non-goals

**Goals**
- New users verify email **and** phone before reaching the app.
- Reliable US SMS delivery via a managed provider, minimal custom code.
- Existing users are never locked out.
- Verified status visible to admins.

**Non-goals (YAGNI)**
- International phone support.
- Phone-based login or phone-based password recovery.
- Re-verification when a grandfathered user edits their phone.
- Custom OTP generation / our own SMS gateway.

## 5. Architecture

Phone verification rides entirely on Appwrite's **account phone verification**:

- `account.updatePhone(phone, password)` — sets the E.164 phone on the **account** (done in
  `signup()`). Required before Appwrite can send an OTP. Enforces account-level phone uniqueness.
- `account.createPhoneVerification()` — sends the SMS OTP via the configured Twilio provider.
  Requires an active session and a phone on the account.
- `account.updatePhoneVerification(userId, secret)` — completes verification; sets the native
  `account.phoneVerification = true`.

Phone numbers live in **E.164** (`+1XXXXXXXXXX`) on the Appwrite account.
`user_profiles.phoneNumber` keeps its current display format **unchanged**. A new
`user_profiles.phoneVerified` boolean mirrors completion for **routing + admin visibility**; the
native `account.phoneVerification` remains the security-backed truth that gates the transition
(you cannot set `phoneVerified = true` without completing a real OTP).

## 6. Component changes

### 6.1 Mobile app (`samplefinder-app/`)

**`src/lib/auth.ts`**
- In `signup()`, after `createUserProfile(...)` succeeds and while the email/password session +
  `credentials.password` are still in hand, set the account phone:
  `account.updatePhone(toE164US(credentials.phoneNumber), credentials.password)`.
  Treat failure as a hard signup error with a friendly message (catch Appwrite's account-level
  uniqueness 409 as a backstop to the pre-`account.create` `checkPhoneNumberExists`).
- Add `sendPhoneVerification()` → `account.createPhoneVerification()`.
- Add `verifyPhone(userId, secret)` → `account.updatePhoneVerification(userId, secret)`, then flip
  `user_profiles.phoneVerified = true` for that user.
- Add a **login repair path**: in `login()` (password available), if the user's
  `phoneVerified === false` **and** `account.phone === ''`, re-run
  `account.updatePhone(e164, password)` so a partially-failed signup can recover.

**`src/utils/`** (next to existing `isValidPhoneNumber` / `getPhoneDigits`)
- Add `toE164US(phone): string` → `'+1' + getPhoneDigits(phone)`, guarding that the result is a
  valid 10-digit (or `1`-prefixed 11-digit) US number; throw/return a clear error otherwise.

**`src/screens/auth/ConfirmPhoneScreen.tsx` + `useConfirmPhoneScreen.ts`** (new)
- Clone the `ConfirmAccountScreen` UX: 6-digit `CodeInput`, `RESEND_COOLDOWN_SECONDS` (60s) resend
  timer, inline error display.
- On mount: send the OTP **once** (guard against double-send on re-mount) via
  `sendPhoneVerification()`. The session is already live (re-created by the email step).
- On verify: `verifyPhone(userId, code)` → on success run the relocated onboarding side-effects
  (below) → `navigation.reset` to `MainTabs`.
- **Abandon/back behavior** (differs from the email screen): the account is now email-verified and
  valid, so **do not delete it**. A back/cancel **logs the user out and returns to `Login`**; the
  `phoneVerified === false` gate re-routes them to this screen on next login. There is **no skip**.

**Onboarding side-effects relocation**
- Move the block currently in `useConfirmAccountScreen.ts` **lines 125–171**
  (`applyReferralAfterVerification`, `fetchUser`, `initializePushNotifications`,
  welcome `createUserNotification`, `useTier1ModalStore...setShouldShowTier1Modal`, and the
  `navigation.reset` to `MainTabs`) **out of the email handler and into `useConfirmPhoneScreen`'s
  success handler**, so onboarding completes exactly once, after both verifications.
- The email handler's `handleVerify` instead navigates to `ConfirmPhone` after `verifyEmail`.

**Navigation / routing gate**
- Register `ConfirmPhone` in the auth stack (`src/navigation/AppNavigator.tsx`, `RootStackParamList`).
- Add the gate where post-login / session-restore routing happens (inspect `AppNavigator` +
  `authStore` at planning time): any logged-in user whose profile `phoneVerified === false` is
  routed to `ConfirmPhone` before `MainTabs`. Grandfathered users are `true`, so unaffected.

### 6.2 Backend (`samplefinder-admin/appwrite/`)

- **Schema:** add `phoneVerified` boolean to the `user_profiles` collection in
  `appwrite.config.json` (`required: false`, `default: false`), then deploy via the Appwrite CLI.
- **Provider:** configure **Twilio** as an SMS provider in the Console
  (`Messaging → Providers`) — Account SID, Auth Token, sender number / Messaging Service SID.
  Secrets stay **out of the repo**. `messaging: true` is already set.
- **Backfill:** one-off script mirroring `backfill:event-location-ids` (admin repo) to set
  `phoneVerified = true` for every existing `user_profiles` row (grandfathering). Run once at
  release.
- *(Optional)* surface `phoneVerified` read-only in the admin user view.

## 7. Data flow

**New signup (happy path)**
1. `SignUpScreen` collects fields (unchanged, incl. 10-digit phone).
2. `signup()`: `account.create` → `createEmailPasswordSession` → `createUserProfile`
   (`phoneVerified` defaults `false`) → `account.updatePhone(e164, password)` sets the account phone.
3. `ConfirmAccountScreen`: email OTP (unchanged) → on success navigate to **`ConfirmPhone`**.
4. `ConfirmPhoneScreen`: on mount `createPhoneVerification()` sends SMS → user enters code →
   `updatePhoneVerification()` flips the native flag → set `phoneVerified = true` → run onboarding
   side-effects → `reset` to `MainTabs`.

**App launch / session restore & login**
- `account.phoneVerification` truth aside, routing reads `user_profiles.phoneVerified`:
  `false` → `ConfirmPhone`; `true` → `MainTabs`. Email-unverified users continue to hit the
  existing email path first.

## 8. Error handling

- **Duplicate phone:** caught pre-`account.create` by `checkPhoneNumberExists`; `account.updatePhone`
  409 is a backstop → friendly "phone already in use" message.
- **`updatePhone` failure in `signup()`:** hard error; account exists but `login()` repair path
  re-attempts. Surface a clear message.
- **SMS send failure / invalid number:** inline error + retry; resend gated by the 60s timer
  (Appwrite also rate-limits server-side).
- **Wrong / expired code:** inline error, clear the field, allow resend.

## 9. Operational prerequisites (affect real-world reliability)

- **Twilio A2P 10DLC registration:** US application-to-person SMS over a standard long code requires
  registering a brand + campaign in Twilio (or using a verified toll-free / short code). Without it,
  US deliverability is throttled or blocked. This is procurement/config, not code, but it gates
  reliability and approval can take days — **start early.**
- **Twilio credentials** plug into the Appwrite Console when provided; nothing in the repos changes.

## 10. Security notes

- No SMS provider secrets in the mobile client or the repos — they live in the Appwrite Console
  (provider config) only.
- Phone uniqueness enforced both app-side (`checkPhoneNumberExists`) and account-side (Appwrite).
- `phoneVerified = true` can only be set after a real OTP completes (`updatePhoneVerification`);
  the flag is a mirror, not the authority.

## 11. Open questions / verify during planning

1. **SDK call style:** confirm `react-native-appwrite@0.18` typings for `updatePhone`,
   `createPhoneVerification`, `updatePhoneVerification` — match the existing positional style unless
   the typings require objects (workspace `CLAUDE.md` says object-based; `auth.ts` is positional).
2. **Gate location:** identify exactly where post-login/session-restore routing decides
   `MainTabs` vs the email path (`AppNavigator` + `authStore` + `login()`), to slot the
   `phoneVerified` check cleanly.
3. **`account.createPhoneVerification` default OTP expiry / message template** under Appwrite Cloud —
   confirm defaults are acceptable or set in Console.

## 12. Testing / QA

No test framework in either repo. Verification = `senior-qa` / `senior-react-native` /
`senior-appwrite` review agents (via `/app-check`) + a manual matrix:

- New signup happy path (email then phone) → lands in app, `phoneVerified = true`.
- Wrong code, expired code, resend (timer + rate-limit).
- SMS send failure path.
- App killed mid-phone-step → reopen must re-gate to `ConfirmPhone`.
- Back/cancel on phone screen → logged out to `Login`, re-gated on next login, account **not** deleted.
- Grandfathered existing user logs in → **not** gated.
- Duplicate phone at signup → blocked with a clear message.
- Onboarding side-effects (referral, push target, welcome notification, Tier 1 modal) fire **once**,
  after phone verification — not after email.
