# Staging Mobile App (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a side-by-side **SampleFinder (Staging)** mobile app (distinct id `com.samplefinder.app.staging`, both platforms, push working) that runs against the staging Appwrite project, installable alongside the prod app.

**Architecture:** The app has **two config layers**. (1) The **JS/Expo-config layer** (`app.config.js`, `babel.config.js`, `@env`) selects which `.env` file is bundled and declares variant identity — this drives `expo start` dev and is the declarative mirror of the native project. (2) The **native layer** (Android product flavor + iOS build configuration/scheme) produces the actual signed release artifacts. Per the decision on 2026-07-06, **we never run `expo prebuild`** (native dirs are gitignored; prebuild wipes the release skill's hand-applied signing/manifest fixes). The native flavor/scheme is therefore the authoritative build path; `app.config.js` does **not** generate release artifacts.

**Tech Stack:** Expo SDK 54, React Native 0.81 (New Architecture), TypeScript strict, `react-native-appwrite`, `@react-native-firebase/messaging` (FCM), `react-native-dotenv` (`@env`), Gradle product flavors, Xcode build configurations.

**Design spec:** `../samplefinder-admin/docs/superpowers/specs/2026-07-03-staging-environment-design.md` (Phase 3). Backend + admin (Plan A) are already verified working; this plan is Phase 3 only.

## Global Constraints

Copied verbatim from the spec + `release` skill; every task's requirements implicitly include these.

- **Only the Appwrite project id differs prod→staging.** Prod `691d4a54003b21bf0136` → staging `6a0ad92e0001d5e515ce`. Endpoint `https://nyc.cloud.appwrite.io/v1`, DB `69217af50038b9005a61`, bucket `6921b4ae002feef4b15e`, all table slugs, and all 3 function ids (Mobile API `69308117000e7a96bcbb`, Notification `695d55bb002bc6b75430`, Statistics `69341ffa001a4ebd28c2`) are **identical** in staging.
- **Mobile identity:** prod bundle/package `com.samplefinder.app`, name "SampleFinder"; staging `com.samplefinder.app.staging`, name "SampleFinder (Staging)". Side-by-side installable.
- **NEVER run `expo prebuild`** (with or without `--clean`) and **NEVER `eas build`**. `android/` and `ios/` are gitignored (`.gitignore` lines 45–46); prebuild regenerates them from `app.json` + plugins and wipes every hand-applied native edit (signing config, Firebase manifest fix, Info.plist, and the staging flavor/scheme this plan adds). All native edits live in the working tree and are re-applied after any rare bootstrap prebuild — see the `release` skill Step 0.
- **Push:** reuse the existing Firebase project `simplefinder-29ed7` (sender `569742468290`). Staging Appwrite FCM provider uses the **same provider id** as prod, `69cac0a30038ed1a7b92`, so the app's `DEFAULT_FCM_PROVIDER_ID` code default works with no env change.
- **iOS distribution:** TestFlight (team `AYNR8DRWG3`). **Android distribution:** direct signed APK via Google Drive link (Appwrite bucket caps at 50 MB; APK ~94 MB).
- **Versioning:** staging shares prod version/build numbers (no independent bumping).
- **Deep links:** staging uses a **custom scheme only** (`samplefinderstaging://`), **no universal links** — staging must never register `applinks:samplefinder.com` / the `samplefinder.com` autoVerify App Link, so it never competes with the prod app.
- **Never** put a server Appwrite API key in the client; session-based access only (unchanged).
- **After non-trivial TS changes run `npm run typecheck`** (`tsc --noEmit`) before considering a task done.

---

## File Structure

**Created (in-repo, committed unless noted):**
- `app.config.js` — dynamic Expo config; receives static `app.json` and applies staging overrides when `APP_VARIANT=staging`. Declarative mirror + dev-client identity. Does **not** produce release artifacts.
- `.env.staging` — **gitignored**; prod `.env` values with the 3 staging deltas. User creates locally.
- `.env.staging.example` — committed template (non-secret identifiers only).
- `google-services.staging.json` — Firebase Android config for `com.samplefinder.app.staging` (client config, committed; same class as the committed prod `google-services.json`). User downloads from Firebase.
- `GoogleService-Info.staging.plist` — Firebase iOS config for the staging bundle. User downloads.
- `docs/staging-build-runbook.md` — the staging build/distribute sequence.
- `android/app/src/staging/res/values/strings.xml` — staging app name (native, gitignored working-tree edit).
- `android/app/src/staging/AndroidManifest.xml` — staging custom-scheme intent-filter (native, gitignored).
- `android/app/src/production/AndroidManifest.xml` — relocated prod `samplefinder.com` App Link filter (native, gitignored).
- `android/app/src/staging/google-services.json` — copy/symlink of the staging Firebase config for the staging flavor (native, gitignored).
- `ios/SampleFinder/SampleFinderStaging.entitlements` — push-only entitlements, no associated domains (native, gitignored).

**Modified:**
- `babel.config.js` — select `.env.staging` when `APP_VARIANT=staging`; cache-key on variant + active file; `allowUndefined: true`.
- `src/lib/appwrite.ts` — `setPlatform` reads `APPWRITE_PLATFORM` from `@env` (prod default preserved).
- `src/lib/deepLink.constants.ts` — `CUSTOM_SCHEME` reads `DEEP_LINK_SCHEME` from `@env` (prod default preserved).
- `app.deeplink-plugin.js` — variant-aware: no-op associated domains + autoVerify App Link when `APP_VARIANT=staging` (keeps Expo config honest for dev/bootstrap).
- `.gitignore` — add `.env.staging`.
- `package.json` — add `start:staging` script (dev only; no `expo run:*` for staging — it prebuilds).
- `android/app/build.gradle` — add `flavorDimensions "env"` + `production`/`staging` product flavors (native, gitignored).
- `android/app/src/main/AndroidManifest.xml` — remove the `samplefinder.com` App Link filter (relocated to `src/production/`) (native, gitignored).
- `ios/SampleFinder.xcodeproj` — add `Release-Staging` build config, `SampleFinder-Staging` scheme, GoogleService plist copy build phase (native, gitignored, via Xcode).
- `.claude/skills/release/SKILL.md` (workspace root) — add a "Staging variant" section.

**Note on native-dir bootstrapping:** All `android/`/`ios/` edits are applied on top of the **existing prod native dirs** that the `release` skill maintains. If a machine has no native dirs, generate them **once** with a prod-variant prebuild (`expo prebuild` with `APP_VARIANT` unset), reapply the release skill Step 0, then apply this plan's flavor/scheme edits and **never prebuild again**.

---

## Group A — JS / config layer (drives dev + what gets bundled into every build)

### Task 1: Staging env files + gitignore

**Files:**
- Create: `.env.staging.example` (committed)
- Create: `.env.staging` (gitignored; created locally by the user)
- Modify: `.gitignore` (add `.env.staging`)

**Interfaces:**
- Produces: `.env.staging` with keys `APPWRITE_PROJECT_ID=6a0ad92e0001d5e515ce`, `APPWRITE_PLATFORM=com.samplefinder.app.staging`, `DEEP_LINK_SCHEME=samplefinderstaging`; all other keys identical to prod `.env`. Consumed by Tasks 2–4 via `@env`.

- [ ] **Step 1: Add `.env.staging` to `.gitignore`**

The gitignore currently ignores literal `.env` (line 49) and `.env*.local`, but **not** `.env.staging`. Add it under the existing env block:

```gitignore
# local env files
.env*.local
.env
.env.staging
```

- [ ] **Step 2: Create the committed template `.env.staging.example`**

All values are non-secret identifiers (same class the admin repo commits in its `.env.staging.example`). Deltas vs prod are the last 3 lines.

```dotenv
APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=6a0ad92e0001d5e515ce
APPWRITE_DATABASE_ID=69217af50038b9005a61
APPWRITE_USER_PROFILES_TABLE_ID=user_profiles
APPWRITE_CLIENTS_TABLE_ID=clients
APPWRITE_EVENTS_TABLE_ID=events
APPWRITE_TRIVIA_TABLE_ID=trivia
APPWRITE_TRIVIA_RESPONSES_TABLE_ID=trivia_responses
APPWRITE_LOCATIONS_TABLE_ID=locations
APPWRITE_CATEGORIES_TABLE_ID=categories
APPWRITE_CHECKINS_TABLE_ID=checkins
APPWRITE_REVIEWS_TABLE_ID=reviews
APPWRITE_TIERS_TABLE_ID=tiers
APPWRITE_SETTINGS_TABLE_ID=settings
APPWRITE_EVENTS_FUNCTION_ID=69308117000e7a96bcbb
EXPO_PUBLIC_APPWRITE_NOTIFICATION_FUNCTION_ID=695d55bb002bc6b75430
APPWRITE_BUCKET_ID=6921b4ae002feef4b15e
EXPO_PUBLIC_TRIVIA_DAILY=true

# --- staging variant deltas (only these differ from prod .env) ---
APPWRITE_PLATFORM=com.samplefinder.app.staging
DEEP_LINK_SCHEME=samplefinderstaging
```

- [ ] **Step 3: User creates the real `.env.staging`**

Instruct the user (it's gitignored; identical to their prod `.env` except the 3 deltas):
```bash
cd samplefinder-app
cp .env.staging.example .env.staging
# .env.staging.example already carries the correct staging values — no secret edits needed.
```

- [ ] **Step 4: Verify**

```bash
cd samplefinder-app
grep -c '^APPWRITE_PROJECT_ID=6a0ad92e0001d5e515ce' .env.staging   # expect 1
git check-ignore .env.staging                                      # expect: .env.staging (it is ignored)
git status --porcelain .env.staging.example                        # expect: ?? .env.staging.example (tracked-to-be)
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.staging.example
git commit -m "feat(staging): add staging env template + gitignore .env.staging"
```

---

### Task 2: Variant-aware env selection in Babel

**Files:**
- Modify: `babel.config.js`

**Interfaces:**
- Consumes: `process.env.APP_VARIANT` (`staging` | unset).
- Produces: `@env` resolves against `.env.staging` when `APP_VARIANT=staging`, else `.env`. `allowUndefined: true` so new keys absent from prod `.env` resolve to `undefined` (Tasks 3–4 supply code defaults).

- [ ] **Step 1: Replace `babel.config.js` with the variant-aware version**

```js
module.exports = function (api) {
  const variant = process.env.APP_VARIANT === 'staging' ? 'staging' : 'production';
  const envFile = variant === 'staging' ? '.env.staging' : '.env';

  // Invalidate the Babel cache when the ACTIVE env file (or the variant) changes,
  // so react-native-dotenv picks up new values without a manual cache wipe.
  api.cache.using(() => {
    try {
      return variant + ':' + require('fs').readFileSync(require('path').join(__dirname, envFile), 'utf8');
    } catch {
      return variant + ':';
    }
  });

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@/components': './src/components',
            '@/screens': './src/screens',
            '@/navigation': './src/navigation',
            '@/utils': './src/utils',
            '@/assets': './src/assets',
          },
          extensions: [
            '.ios.ts', '.android.ts', '.ts',
            '.ios.tsx', '.android.tsx', '.tsx',
            '.jsx', '.js', '.json',
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
          ],
        },
      ],
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: envFile,
          allowUndefined: true,
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
```

- [ ] **Step 2: Verify the prod path is unchanged and staging resolves the staging id**

```bash
cd samplefinder-app
# Prod (APP_VARIANT unset) — should print the PROD project id:
node -e "process.env.BABEL_ENV='production'; const b=require('./babel.config.js'); const cfg=b({cache:{using:()=>{}}}); const dot=cfg.plugins.find(p=>Array.isArray(p)&&p[0]==='module:react-native-dotenv'); console.log('prod env path =', dot[1].path);"
# expect: prod env path = .env

APP_VARIANT=staging node -e "const b=require('./babel.config.js'); const cfg=b({cache:{using:()=>{}}}); const dot=cfg.plugins.find(p=>Array.isArray(p)&&p[0]==='module:react-native-dotenv'); console.log('staging env path =', dot[1].path);"
# expect: staging env path = .env.staging
```

- [ ] **Step 3: Commit**

```bash
git add babel.config.js
git commit -m "feat(staging): APP_VARIANT selects .env.staging in babel"
```

---

### Task 3: Variant-correct Appwrite platform id

**Files:**
- Modify: `src/lib/appwrite.ts`
- Test: runtime smoke (Task 12)

**Interfaces:**
- Consumes: `APPWRITE_PLATFORM` from `@env` (prod default `com.samplefinder.app`).
- Produces: `client.setPlatform()` sends the actual bundle id so it matches the native platform registered in staging Appwrite (Task 7).

- [ ] **Step 1: Import `APPWRITE_PLATFORM` and use it**

Change the import line:
```ts
import { APPWRITE_PROJECT_ID, APPWRITE_ENDPOINT, APPWRITE_PLATFORM } from '@env';
```

Replace the hardcoded platform block:
```ts
  // Appwrite platform identifier — must match a registered platform on the
  // Appwrite project. Prod default; .env.staging sets com.samplefinder.app.staging.
  const platform = (APPWRITE_PLATFORM || 'com.samplefinder.app').trim();

  client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setPlatform(platform);
```

Leave the `catch` dummy-client fallback's `.setPlatform('com.samplefinder.app')` as-is (safe default).

- [ ] **Step 2: Verify types**

```bash
cd samplefinder-app && npm run typecheck   # expect: no errors
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/appwrite.ts
git commit -m "feat(staging): variant-aware Appwrite setPlatform"
```

---

### Task 4: Variant-aware deep-link custom scheme (runtime)

**Files:**
- Modify: `src/lib/deepLink.constants.ts`
- Test: runtime (Task 12, optional referral check)

**Interfaces:**
- Consumes: `DEEP_LINK_SCHEME` from `@env` (prod default `com.samplefinder.app`).
- Produces: `CUSTOM_SCHEME` = `samplefinderstaging` on staging, so `samplefinderstaging://referral/<code>` routes via `AppNavigator` linking `prefixes`. `DEEP_LINK_DOMAIN` stays `samplefinder.com` for both — on staging the `https://` prefix is inert because no associated domain is registered (Tasks 5, 8, 9).

- [ ] **Step 1: Read the scheme from `@env` with a prod default**

```ts
import { DEEP_LINK_SCHEME } from '@env';

export const DEEP_LINK_DOMAIN = 'samplefinder.com';
export const REFERRAL_PATH_PREFIX = '/referral/';
// Custom URL scheme for deep links. Prod default; .env.staging sets samplefinderstaging.
export const CUSTOM_SCHEME = (DEEP_LINK_SCHEME || 'com.samplefinder.app').trim();
export const REFERRAL_CODE_PATTERN = /^[A-Z2-9]{6}$/;
```

- [ ] **Step 2: Verify types and existing consumers still compile**

```bash
cd samplefinder-app && npm run typecheck   # expect: no errors
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/deepLink.constants.ts
git commit -m "feat(staging): variant-aware deep-link custom scheme"
```

---

## Group B — Expo config (dev-client identity + declarative mirror)

### Task 5: `app.config.js` dynamic config + variant-aware deep-link plugin

**Files:**
- Create: `app.config.js`
- Modify: `app.deeplink-plugin.js`
- Keep: `app.json` (becomes the base static config `app.config.js` receives)

**Interfaces:**
- Consumes: `process.env.APP_VARIANT`, the static `app.json` (via the dynamic-config `config` argument).
- Produces: on `APP_VARIANT=staging` — `name` "SampleFinder (Staging)", ios.bundleIdentifier / android.package `com.samplefinder.app.staging`, top-level `scheme: 'samplefinderstaging'`, staging google-services file paths, and **no** `ios.associatedDomains`. This governs `expo start` dev and is the source a (forbidden-in-normal-flow) prebuild would use; it does not build release artifacts.

- [ ] **Step 1: Create `app.config.js`**

Expo reads the static `app.json` first, then passes it to `app.config.js` as `config`. We override only for staging.

```js
// Dynamic Expo config. Reads static app.json (as `config`) and applies staging
// overrides when APP_VARIANT=staging. NOTE: under the "never prebuild" release
// model, this drives `expo start` dev + is the declarative mirror of the native
// project; the signed release artifacts come from the Android flavor / iOS scheme.
const IS_STAGING = process.env.APP_VARIANT === 'staging';

module.exports = ({ config }) => {
  if (!IS_STAGING) {
    return config; // production: unchanged
  }

  return {
    ...config,
    name: 'SampleFinder (Staging)',
    scheme: 'samplefinderstaging',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.samplefinder.app.staging',
      googleServicesFile: './GoogleService-Info.staging.plist',
      // Staging uses a custom scheme only — drop universal links so it never
      // competes with the prod app for samplefinder.com.
      associatedDomains: undefined,
    },
    android: {
      ...config.android,
      package: 'com.samplefinder.app.staging',
      googleServicesFile: './google-services.staging.json',
    },
  };
};
```

- [ ] **Step 2: Make the deep-link plugin variant-aware**

In `app.deeplink-plugin.js`, short-circuit the universal-link / App-Link wiring for staging so a dev build or bootstrap prebuild never claims `samplefinder.com`:

```js
const withDeepLinking = (config) => {
  // Staging is custom-scheme only (see app.config.js `scheme`). Skip Associated
  // Domains (iOS) and the autoVerify App Link (Android) so staging never competes
  // with the prod app for samplefinder.com links.
  if (process.env.APP_VARIANT === 'staging') {
    return config;
  }
  config = withAssociatedDomains(config);
  config = withDeepLinkIntentFilter(config);
  return config;
};
```

- [ ] **Step 3: Verify the resolved config for both variants**

```bash
cd samplefinder-app
npx expo config --type public --json | node -e "const c=JSON.parse(require('fs').readFileSync(0)); console.log('prod:', c.name, c.ios.bundleIdentifier, c.android.package, c.scheme);"
# expect: prod: SampleFinder com.samplefinder.app com.samplefinder.app undefined
APP_VARIANT=staging npx expo config --type public --json | node -e "const c=JSON.parse(require('fs').readFileSync(0)); console.log('staging:', c.name, c.ios.bundleIdentifier, c.android.package, c.scheme, 'assocDomains=', c.ios.associatedDomains);"
# expect: staging: SampleFinder (Staging) com.samplefinder.app.staging com.samplefinder.app.staging samplefinderstaging assocDomains= undefined
```

- [ ] **Step 4: Commit**

```bash
git add app.config.js app.deeplink-plugin.js
git commit -m "feat(staging): dynamic app.config.js variant + variant-aware deep-link plugin"
```

---

## Group C — Consoles (user does; Claude gives exact steps)

> These tasks are **not scriptable here** — they require Firebase / Apple / Appwrite console access. Each lists exact click-paths. Claude verifies via pasted output where possible. Task 6 blocks push (Tasks 12 push check); Tasks 7–8 block staging connectivity / iOS archive.

### Task 6: Firebase — register staging apps + download config files

**Files:**
- Create (from downloads): `google-services.staging.json`, `GoogleService-Info.staging.plist` at repo root.

- [ ] **Step 1 (user): Register the Android staging app**

Firebase Console → project **`simplefinder-29ed7`** → ⚙️ → Project settings → **Your apps** → **Add app → Android**:
- Package name: `com.samplefinder.app.staging`
- Nickname: `SampleFinder Staging (Android)`
- (SHA-1 optional; not needed for FCM. Add later if Google Sign-In/Dynamic Links are ever used.)
- **Download `google-services.json`**.

- [ ] **Step 2 (user): Register the iOS staging app**

Same project → Add app → **iOS**:
- Bundle ID: `com.samplefinder.app.staging`
- Nickname: `SampleFinder Staging (iOS)`
- **Download `GoogleService-Info.plist`**.

- [ ] **Step 3 (user): Place the files with staging names**

```bash
cd samplefinder-app
cp ~/Downloads/google-services.json      ./google-services.staging.json
cp ~/Downloads/GoogleService-Info.plist  ./GoogleService-Info.staging.plist
```

- [ ] **Step 4: Verify the files carry the staging bundle id (Claude checks pasted output)**

```bash
cd samplefinder-app
node -e "const j=require('./google-services.staging.json'); console.log('android pkgs:', j.client.map(c=>c.client_info.android_client_info.package_name));"
# expect array containing com.samplefinder.app.staging
/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' GoogleService-Info.staging.plist
# expect: com.samplefinder.app.staging
```

- [ ] **Step 5: Commit the client config files**

These are client (non-secret) config, same class as the committed prod `google-services.json` / `GoogleService-Info.plist`.
```bash
git add google-services.staging.json GoogleService-Info.staging.plist
git commit -m "feat(staging): Firebase staging app config files"
```

- [ ] **Step 6 (user, ⛔ blocked on Firebase access): create the staging Appwrite FCM provider**

*(This is the deferred Task 8 from Plan A / the setup tracker. Do it now that the staging Firebase apps exist.)* Firebase Console → project settings → **Service accounts** → **Generate new private key** (does not revoke prod's key) → downloads a JSON (secret). Then **staging** Appwrite console → **Messaging → Providers → Create provider → Push → FCM** → set **Provider ID** to `69cac0a30038ed1a7b92` (same as prod, so the app default works), paste the service-account JSON, **Enable**.

---

### Task 7: Appwrite (staging) — register native platforms

- [ ] **Step 1 (user): Add the iOS + Android native platforms in staging**

Staging Appwrite console (project `6a0ad92e0001d5e515ce`) → **Overview → Add platform** (or Settings → Platforms):
- **Apple / iOS app** — Bundle ID `com.samplefinder.app.staging`, name "SampleFinder Staging iOS".
- **Android app** — Package name `com.samplefinder.app.staging`, name "SampleFinder Staging Android".

Rationale: a fresh Appwrite project has no platforms (the admin dashboard needed a `localhost` Web platform for the same reason). `client.setPlatform('com.samplefinder.app.staging')` (Task 3) must match a registered platform.

- [ ] **Step 2: Verify (during Task 12 smoke)** — the staging app makes an authenticated request without an "Invalid Origin"/platform rejection.

---

### Task 8: Apple — register the staging App ID + App Store Connect record

- [ ] **Step 1 (user): Register the App ID**

developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App:
- Bundle ID (explicit): `com.samplefinder.app.staging`
- Description: `SampleFinder Staging`
- Capabilities: **Push Notifications** ON. **Do NOT** enable Associated Domains (staging is custom-scheme only). Team `AYNR8DRWG3`.

- [ ] **Step 2 (user): Create the App Store Connect record (for TestFlight)**

App Store Connect → Apps → **+ New App**:
- Platform iOS, Name "SampleFinder Staging", Bundle ID `com.samplefinder.app.staging`, SKU `samplefinder-staging`.

- [ ] **Step 3: Verify** — the App ID appears in the developer portal and the ASC record exists (user confirms). Needed before the iOS archive/upload (Task 9 / runbook).

---

## Group D — Android native flavor (authoritative build path)

> These edit the **existing prod native dirs** (gitignored working tree). If `android/` is absent, bootstrap once per the "native-dir bootstrapping" note above, then proceed. Apply the release skill Step 0 (signing config, `local.properties`) first.

### Task 9a: Android product flavors

**Files:**
- Modify: `android/app/build.gradle`
- Create: `android/app/src/staging/res/values/strings.xml`
- Create: `android/app/src/staging/AndroidManifest.xml`
- Create: `android/app/src/production/AndroidManifest.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/staging/google-services.json`

**Interfaces:**
- Produces: gradle tasks `assembleProductionRelease` and `assembleStagingRelease`; staging applicationId `com.samplefinder.app.staging`, staging app name "SampleFinder (Staging)", staging custom-scheme deep link, staging Firebase config.

- [ ] **Step 1: Add flavors to `android/app/build.gradle`**

Inside `android { ... }` (after `defaultConfig { ... }`):
```gradle
    flavorDimensions "env"
    productFlavors {
        production {
            dimension "env"
            // applicationId stays com.samplefinder.app (from defaultConfig)
        }
        staging {
            dimension "env"
            applicationIdSuffix ".staging"
        }
    }
```
The release `signingConfig` (release skill Step 0b) applies to both flavors via the `release` buildType — no per-flavor signing needed (same keystore).

- [ ] **Step 2: Staging app name via flavor source set**

`android/app/src/staging/res/values/strings.xml`:
```xml
<resources>
    <string name="app_name">SampleFinder (Staging)</string>
</resources>
```
(Leave `android/app/src/main/res/values/strings.xml` `app_name` = "SampleFinder" for the production flavor. Do **not** add a `resValue "string","app_name",...` — it would collide with the strings.xml resource.)

- [ ] **Step 3: Relocate the prod App Link filter, add the staging custom-scheme filter**

The `samplefinder.com` autoVerify App Link intent-filter currently lives in `android/app/src/main/AndroidManifest.xml` (added by `app.deeplink-plugin.js` at the last prod prebuild). Manifest merge can't easily *remove* it per-flavor, so move it out of `main` into the `production` flavor, and give `staging` a custom-scheme filter instead.

First inspect and note the exact filter block:
```bash
cd samplefinder-app
sed -n '/<intent-filter[^>]*autoVerify/,/<\/intent-filter>/p' android/app/src/main/AndroidManifest.xml
```
Then **delete** that `<intent-filter android:autoVerify="true"> … samplefinder.com … </intent-filter>` block from `android/app/src/main/AndroidManifest.xml`.

Create `android/app/src/production/AndroidManifest.xml` (App Link filter belongs to prod only):
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".MainActivity">
      <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="samplefinder.com" android:pathPrefix="/referral/" />
      </intent-filter>
    </activity>
  </application>
</manifest>
```

Create `android/app/src/staging/AndroidManifest.xml` (custom scheme, **no** autoVerify, **no** https host):
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="samplefinderstaging" />
      </intent-filter>
    </activity>
  </application>
</manifest>
```

- [ ] **Step 4: Staging Firebase config for the flavor**

The Google Services gradle plugin resolves `src/<flavor>/google-services.json` before `app/google-services.json`. Put the staging config in the staging source set (prod keeps `android/app/google-services.json`):
```bash
cd samplefinder-app
cp google-services.staging.json android/app/src/staging/google-services.json
```

- [ ] **Step 5: Verify the two flavors assemble distinct ids (no prebuild)**

```bash
cd samplefinder-app/android
./gradlew :app:assembleStagingRelease   # if you just cleared ~/.gradle/caches: ./gradlew --stop first
BT="$HOME/Library/Android/sdk/build-tools/36.0.0"
"$BT/aapt2" dump badging app/build/outputs/apk/staging/release/app-staging-release.apk | grep -E "^package:|application-label:"
# expect: package name='com.samplefinder.app.staging' ... application-label:'SampleFinder (Staging)'
"$BT/apksigner" verify --print-certs app/build/outputs/apk/staging/release/app-staging-release.apk | grep "DN"   # CN=SampleFinder (not Android Debug)
```

- [ ] **Step 6: Confirm the staging JS bundle points at staging Appwrite**

The APK's JS must be bundled with `APP_VARIANT=staging` so `@env` = `.env.staging`. Rebuild with the variant exported and grep the bundled JS for the staging project id:
```bash
cd samplefinder-app
APP_VARIANT=staging ./android/gradlew -p android :app:assembleStagingRelease
BT="$HOME/Library/Android/sdk/build-tools/36.0.0"
unzip -p android/app/build/outputs/apk/staging/release/app-staging-release.apk assets/index.android.bundle | grep -c "6a0ad92e0001d5e515ce"   # expect >= 1
# and ensure the PROD id is NOT bundled:
unzip -p android/app/build/outputs/apk/staging/release/app-staging-release.apk assets/index.android.bundle | grep -c "691d4a54003b21bf0136"   # expect 0
```
*(The runbook, Task 11, codifies always exporting `APP_VARIANT=staging` for staging builds.)*

- [ ] **Step 7: Commit the tracked change (native dirs are gitignored — only the plan/runbook capture them)**

No committable repo files change in this task (native dirs are gitignored). Record the native edits in the runbook (Task 11) so they can be re-applied. No commit here.

---

## Group E — iOS staging build config + scheme (authoritative build path)

### Task 10: iOS `Release-Staging` configuration, entitlements, scheme, plist wiring

**Files:**
- Modify: `ios/SampleFinder.xcodeproj` (via Xcode)
- Create: `ios/SampleFinder/SampleFinderStaging.entitlements`

**Interfaces:**
- Produces: scheme `SampleFinder-Staging` archiving with bundle id `com.samplefinder.app.staging`, display name "SampleFinder Staging", the staging GoogleService plist, push-only entitlements (no associated domains).

- [ ] **Step 1: Duplicate the Release configuration**

Xcode → open `ios/SampleFinder.xcworkspace` → project **SampleFinder** → **Info** tab → **Configurations** → select **Release** → the **+** → **Duplicate "Release" Configuration** → name it **`Release-Staging`**.

- [ ] **Step 2: Per-configuration build settings (target SampleFinder)**

Target **SampleFinder** → **Build Settings** → for the **Release-Staging** column only:
- `PRODUCT_BUNDLE_IDENTIFIER` = `com.samplefinder.app.staging`
- `INFOPLIST_KEY_CFBundleDisplayName` = `SampleFinder Staging` (or add `CFBundleDisplayName` to Info.plist gated by config if that key isn't present)
- `CODE_SIGN_ENTITLEMENTS` = `SampleFinder/SampleFinderStaging.entitlements`
- `PRODUCT_NAME` — leave as `$(TARGET_NAME)` (keep `SampleFinder` so paths in build phases stay stable).

- [ ] **Step 3: Create the staging entitlements (push only, no associated domains)**

`ios/SampleFinder/SampleFinderStaging.entitlements`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>production</string>
</dict>
</plist>
```
(Prod keeps its existing entitlements incl. `com.apple.developer.associated-domains`.)

- [ ] **Step 4: Select the staging GoogleService plist at build time**

Both plists live in `ios/SampleFinder/`. Add `GoogleService-Info.staging.plist` to the project (target membership: SampleFinder). Add a **Run Script** build phase **after** "Copy Bundle Resources" that swaps the plist inside the built app for the staging config — non-destructive to source:
```bash
if [ "${CONFIGURATION}" = "Release-Staging" ]; then
  cp "${SRCROOT}/SampleFinder/GoogleService-Info.staging.plist" \
     "${BUILT_PRODUCTS_DIR}/${WRAPPER_NAME}/GoogleService-Info.plist"
fi
```

- [ ] **Step 5: Add a URL scheme for the custom deep link**

Info.plist needs `samplefinderstaging` in `CFBundleURLTypes` for the staging build. Since Info.plist is shared, add the scheme unconditionally (an unused URL scheme in the prod build is harmless) **or** gate via a config-specific Info.plist. Simplest: add a second `CFBundleURLTypes` entry with `CFBundleURLSchemes = [samplefinderstaging]` — prod ignores it (prod uses universal links). Confirm the existing prod scheme entry (if any) is untouched.

- [ ] **Step 6: Create the shared scheme**

Xcode → Product → Scheme → **Manage Schemes** → duplicate `SampleFinder` → name **`SampleFinder-Staging`** → **Edit Scheme** → set **Run**, **Test**, **Profile**, **Analyze**, **Archive** to the **Release-Staging** build configuration → mark **Shared**.

- [ ] **Step 7: Verify build settings resolve for staging (no prebuild)**

```bash
cd samplefinder-app
xcodebuild -workspace ios/SampleFinder.xcworkspace -scheme SampleFinder-Staging \
  -configuration Release-Staging -showBuildSettings 2>/dev/null \
  | grep -E "PRODUCT_BUNDLE_IDENTIFIER|CODE_SIGN_ENTITLEMENTS" | head
# expect: PRODUCT_BUNDLE_IDENTIFIER = com.samplefinder.app.staging
#         CODE_SIGN_ENTITLEMENTS = SampleFinder/SampleFinderStaging.entitlements
```

- [ ] **Step 8: Record edits in the runbook**

Native dirs are gitignored; capture all Xcode edits (config, entitlements file, build phase, scheme) in the runbook (Task 11). The only committable file here is `SampleFinderStaging.entitlements` **if** you choose to keep a copy under version control alongside the runbook — otherwise it lives only in `ios/` (gitignored). Recommended: paste its contents into the runbook so it can be recreated. No commit of `ios/` files.

---

## Group F — Runbook, scripts, and end-to-end QA

### Task 11: Staging build runbook + `release` skill section + `start:staging` script

**Files:**
- Create: `docs/staging-build-runbook.md`
- Modify: `.claude/skills/release/SKILL.md` (workspace root)
- Modify: `package.json`

**Interfaces:**
- Produces: a repeatable staging build/distribute sequence and a dev script.

- [ ] **Step 1: Add the dev script (no `expo run:*` — it prebuilds)**

`package.json` `scripts`:
```json
    "start:staging": "APP_VARIANT=staging expo start",
```

- [ ] **Step 2: Write `docs/staging-build-runbook.md`**

Codify, with the exact native edits from Tasks 9–10 (so they can be re-applied after any bootstrap prebuild):
- **Preflight:** release skill Step 0 (keystore, release signingConfig, `local.properties`, disk, pods) **plus** the staging flavor edits (Task 9) and the iOS Release-Staging config/scheme/entitlements/build-phase (Task 10). Paste the `SampleFinderStaging.entitlements` contents and the staging manifest/strings snippets.
- **Never** `expo prebuild` / `eas build`.
- **Android staging:** `APP_VARIANT=staging` exported → `cd android && ./gradlew assembleStagingRelease` → APK at `android/app/build/outputs/apk/staging/release/app-staging-release.apk` → verify id/label/signer (Task 9 Step 5–6) → Drive link. Handoff: `Android (Staging): <ver> build <n> — <drive link>`.
- **iOS staging:** `APP_VARIANT=staging` exported → `xcodebuild -workspace ios/SampleFinder.xcworkspace -scheme SampleFinder-Staging -configuration Release-Staging -destination 'generic/platform=iOS' -archivePath <path> -allowProvisioningUpdates archive` → open Organizer → Distribute → App Store Connect → TestFlight (staging app record from Task 8).
- **Env sanity gate:** the staging bundle must contain `6a0ad92e…` and **not** `691d4a54…` (Task 9 Step 6 equivalent for iOS: grep `ios/main.jsbundle` after archive, or verify at runtime).
- Version/build numbers = prod's (shared), per Global Constraints.

- [ ] **Step 3: Add a "Staging variant" section to the `release` skill**

In `.claude/skills/release/SKILL.md`, add a short section pointing to the runbook and stating: staging builds use `APP_VARIANT=staging` + the `staging` gradle flavor / `SampleFinder-Staging` scheme; **still never prebuild**; staging shares prod version numbers; staging iOS goes to the staging ASC record, Android to a Drive link labeled "(Staging)".

- [ ] **Step 4: Verify**

```bash
cd samplefinder-app && node -e "console.log(require('./package.json').scripts['start:staging'])"
# expect: APP_VARIANT=staging expo start
test -f docs/staging-build-runbook.md && echo runbook-ok
grep -qi "staging" ../.claude/skills/release/SKILL.md && echo release-skill-updated
```

- [ ] **Step 5: Commit**

```bash
git add package.json docs/staging-build-runbook.md
git commit -m "docs(staging): build runbook + start:staging script"
# release skill lives at the workspace root (separate location); commit per that repo's conventions if tracked.
```

---

### Task 12: End-to-end staging QA (acceptance)

**Files:** none (verification task).

**Interfaces:**
- Consumes: everything above + backend/admin (Plan A, already verified).
- Produces: sign-off that the staging app runs against staging on both platforms with push.

- [ ] **Step 1: Dev runtime against staging**

```bash
cd samplefinder-app && npm run start:staging
```
On a device/simulator running the dev client: log in with the seeded staging admin (`tillo@bolderapps.com`) or a test user; confirm events/locations/categories load **from staging** (create a distinctive test event in the admin `dev:staging` first so it's identifiable). Confirms `.env.staging` selection + `setPlatform` + the registered staging platform (Task 7).

- [ ] **Step 2: Side-by-side install**

Install the signed **staging** APK (Task 9) on a device that also has the prod app — both must coexist (distinct package ids) with the staging app showing name "SampleFinder (Staging)".

- [ ] **Step 3: Push end-to-end (requires Task 6 Step 6 FCM provider)**

In the staging app, grant notifications → confirm an Appwrite **push target** is registered on the staging project (provider `69cac0a…`). From the admin `dev:staging` Notifications page, send a test push to that user → arrives on the staging device.

- [ ] **Step 4: Deep link (optional)**

Open `samplefinderstaging://referral/ABC123` on the staging device → app opens the SignUp screen with the code (custom scheme, Task 4 + Task 9/10 scheme registration). Confirm the prod app does **not** intercept it.

- [ ] **Step 5: Sign-off**

Update the setup tracker (`../samplefinder-admin/docs/staging-env-setup.md`) Phase 3 rows to ✅ and note the build/push results. Run `/app-check` (typecheck + senior-react-native + senior-typescript + senior-qa; + senior-appwrite since staging touches Appwrite) before declaring Phase 3 done.

---

## Self-Review (completed)

- **Spec coverage:** app.config.js variant (Task 5) ✓; babel env selection (Task 2) ✓; deep-link isolation (Tasks 4, 5, 9, 10) ✓; Firebase staging apps + config files (Task 6) ✓; FCM provider (Task 6 Step 6) ✓; build/distribute both platforms (Tasks 9–11) ✓; runbook / release-skill extension (Task 11) ✓; `.env.staging` (Task 1) ✓; TestFlight + Android Drive (Tasks 8, 11) ✓; Appwrite native platforms — added beyond the spec because a fresh project has no platforms (Task 7) ✓.
- **Divergences from the spec (flag at review):** (1) build strategy is **native flavor / iOS scheme, no prebuild** (decided 2026-07-06) instead of the spec's `prebuild --clean`, to honor the `release` skill; (2) added Task 7 (Appwrite native platforms) and the variant-aware `setPlatform`/`CUSTOM_SCHEME` runtime changes (Tasks 3–4), which the spec didn't detail.
- **Type consistency:** new `@env` keys `APPWRITE_PLATFORM`, `DEEP_LINK_SCHEME` are declared in `.env.staging(.example)` and read with `|| default`; `allowUndefined: true` covers their absence from prod `.env`. Names match across Tasks 1–4.
- **Placeholder scan:** none — every code/config step shows the actual content; console steps give exact click-paths.
