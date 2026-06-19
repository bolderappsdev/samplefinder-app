# Add Event to the Phone's Native Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user taps "Add to Calendar" on an event, also present the OS-native "Add Event" sheet so they can save the event to their personal device calendar.

**Architecture:** A new self-contained helper (`src/lib/calendar/deviceCalendar.ts`) wraps `expo-calendar`'s `createEventInCalendarAsync` and never throws. The existing `handleAddToCalendar` in `useBrandDetailsScreen.ts` calls it in the add-branch only, as a fire-and-forget side effect after the in-app save. iOS gets a `NSCalendarsUsageDescription` string in `app.json`; Android needs no permission (the API uses an intent).

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript strict, `expo-calendar` v15.0.8 (already installed), Zustand.

## Global Constraints

- **TypeScript strict** — no `any`, no unchecked `as` casts.
- **No test framework exists** in this repo. Verification is `npm run typecheck` + manual QA + `/app-check`. Do **not** add a test runner.
- **Path alias** `@/` → `src/`.
- **`expo-calendar` v15.0.8 is already a dependency** — do not add, remove, or change any dependency.
- **Native config lives in `app.json`** (committed). `expo prebuild` regenerates the native projects and wipes any hand-edited `Info.plist` / `AndroidManifest.xml`, so all native config must go in `app.json`.
- **Keep Android `WRITE_CALENDAR` / `READ_CALENDAR` in `blockedPermissions`.** Do not add calendar permissions.
- The device-calendar add is **fire-and-forget**: its result must never change in-app state, and any failure must be swallowed so it can't break the primary "save event" action.

---

### Task 1: Add iOS calendar usage string to `app.json`

Defensive Info.plist string so the App Store's static analysis is satisfied (the binary links EventKit). The dialog API needs no runtime permission, so no other config changes — and explicitly **no** Android permission change.

**Files:**
- Modify: `app.json` (the `expo.ios.infoPlist` object)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks (independent config deliverable).

- [ ] **Step 1: Add the usage-description key**

In `app.json`, find the `ios.infoPlist` block and add `NSCalendarsUsageDescription` as the last entry (add a comma to the current last line):

```json
        "NSPhotoLibraryUsageDescription": "This app needs access to your photo library to upload profile pictures.",
        "NSCameraUsageDescription": "This app needs access to your camera to take profile pictures.",
        "NSCalendarsUsageDescription": "Lets you add SampleFinder events to your personal calendar."
      },
```

- [ ] **Step 2: Verify `app.json` is still valid JSON and the key is present**

Run:
```bash
node -e "const c=require('./app.json'); if(!c.expo.ios.infoPlist.NSCalendarsUsageDescription) throw new Error('missing'); console.log('OK:', c.expo.ios.infoPlist.NSCalendarsUsageDescription)"
```
Expected: `OK: Lets you add SampleFinder events to your personal calendar.`

- [ ] **Step 3: Confirm no Android calendar permission was added**

Run:
```bash
node -e "const c=require('./app.json'); const p=c.expo.android.permissions||[]; const b=c.expo.android.blockedPermissions||[]; if(p.includes('WRITE_CALENDAR')||p.includes('READ_CALENDAR')) throw new Error('calendar permission leaked into android.permissions'); console.log('blocked still:', b.filter(x=>x.includes('CALENDAR')))"
```
Expected: `blocked still: [ 'READ_CALENDAR', 'WRITE_CALENDAR' ]`

- [ ] **Step 4: Commit**

```bash
git add app.json
git commit -m "$(printf 'feat(ios): add NSCalendarsUsageDescription for device calendar\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Create the `presentAddToDeviceCalendar` helper

A new module wrapping `expo-calendar`'s dialog API. Pure input shaping (date fallback, location/notes assembly) plus the single SDK call, wrapped so it never throws.

**Files:**
- Create: `src/lib/calendar/deviceCalendar.ts`

**Interfaces:**
- Consumes: `expo-calendar` (`createEventInCalendarAsync`, `Event`, `CalendarDialogResultActions`).
- Produces (consumed by Task 3):
  - `presentAddToDeviceCalendar(input: DeviceCalendarEventInput): Promise<AddToDeviceCalendarResult>`
  - `interface DeviceCalendarEventInput { title: string; startTime: string; endTime?: string | null; address?: string | null; city?: string | null; notes?: string | null; }`
  - `type AddToDeviceCalendarResult = Calendar.CalendarDialogResultActions | 'skipped' | 'error'`

- [ ] **Step 1: Write the helper**

Create `src/lib/calendar/deviceCalendar.ts`:

```ts
import * as Calendar from 'expo-calendar';

/**
 * Outcome of presenting the device-calendar "Add Event" sheet.
 * - iOS reports the user's action (saved / canceled / deleted).
 * - Android always reports `done` — the OS can't tell us save vs cancel.
 * - `skipped`: we had no valid start time, so the sheet was never shown.
 * - `error`: an unexpected failure was caught (the sheet may not have shown).
 */
export type AddToDeviceCalendarResult =
  | Calendar.CalendarDialogResultActions
  | 'skipped'
  | 'error';

export interface DeviceCalendarEventInput {
  title: string;
  startTime: string; // ISO datetime
  endTime?: string | null; // ISO datetime
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Presents the OS-native "Add Event" sheet, pre-filled with the given event,
 * so the user can save it to a calendar of their choice.
 *
 * Fire-and-forget: this never throws. On any problem it returns 'error' or
 * 'skipped' so callers can keep their primary flow intact. Requires no runtime
 * calendar permission — `createEventInCalendarAsync` uses the system UI
 * (EKEventEditViewController on iOS, ACTION_INSERT intent on Android).
 */
export async function presentAddToDeviceCalendar(
  input: DeviceCalendarEventInput,
): Promise<AddToDeviceCalendarResult> {
  const startDate = new Date(input.startTime);
  if (isNaN(startDate.getTime())) {
    console.warn('[deviceCalendar] Invalid startTime, skipping sheet:', input.startTime);
    return 'skipped';
  }

  let endDate = input.endTime ? new Date(input.endTime) : null;
  if (!endDate || isNaN(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
    endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MS);
  }

  const location = [input.address, input.city]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(', ');

  const notes = input.notes?.trim();

  const eventData: Omit<Partial<Calendar.Event>, 'id'> = {
    title: input.title,
    startDate,
    endDate,
    allDay: false,
  };
  if (location) {
    eventData.location = location;
  }
  if (notes) {
    eventData.notes = notes;
  }

  try {
    const result = await Calendar.createEventInCalendarAsync(eventData);
    return result.action;
  } catch (error) {
    console.warn('[deviceCalendar] Failed to present add-to-calendar sheet:', error);
    return 'error';
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: completes with no errors. (If `result.action` is rejected, confirm the return type is the union `Calendar.CalendarDialogResultActions | 'skipped' | 'error'` — `action` is a subset of that enum and must be assignable to it.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar/deviceCalendar.ts
git commit -m "$(printf 'feat: add presentAddToDeviceCalendar helper\n\nWraps expo-calendar createEventInCalendarAsync to present the\nnative add-event sheet. Never throws; defaults a 2h duration when\nendTime is missing or invalid.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Wire the helper into `handleAddToCalendar`

Call the helper in the **add branch only**, after the existing in-app save and reminder scheduling. Fire-and-forget; no UI gating on the result; no confirmation toast.

**Files:**
- Modify: `src/screens/brand-details/useBrandDetailsScreen.ts` (import near line 30; new block inside `handleAddToCalendar`'s add path, before its closing `catch`)

**Interfaces:**
- Consumes from Task 2: `presentAddToDeviceCalendar`, `DeviceCalendarEventInput`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the import**

After the existing reminders import (line ~30):

```ts
import { scheduleEventReminders, cancelEventReminders } from '@/lib/notifications/eventReminders';
```

add:

```ts
import { presentAddToDeviceCalendar } from '@/lib/calendar/deviceCalendar';
```

- [ ] **Step 2: Insert the device-calendar block**

In `handleAddToCalendar`, the add path currently ends like this (the reminders `if` block, then the function-level `catch`):

```ts
        } catch (reminderErr) {
          console.warn('[handleAddToCalendar] Failed to schedule reminders:', reminderErr);
        }
      }
    } catch (error) {
      console.error('Error updating calendar:', error);
```

Insert the new block between the end of the reminders `if` block and the `} catch (error) {` so it reads:

```ts
        } catch (reminderErr) {
          console.warn('[handleAddToCalendar] Failed to schedule reminders:', reminderErr);
        }
      }

      // Offer to add the event to the phone's native calendar via the OS sheet.
      // Fire-and-forget: the result never affects the in-app "added" state, and any
      // failure is swallowed so it cannot break the primary save above. The helper
      // also returns 'skipped' on a missing/invalid start time.
      if (eventData?.startTime) {
        try {
          const calendarNotes = [eventData.discount, eventData.brandDescription]
            .map((part) => part?.trim())
            .filter((part): part is string => !!part)
            .join('\n\n');

          await presentAddToDeviceCalendar({
            title: eventTitle,
            startTime: eventData.startTime,
            endTime: eventData.endTime,
            address: eventData.address,
            city: eventData.city,
            notes: calendarNotes || null,
          });
        } catch (deviceCalErr) {
          console.warn('[handleAddToCalendar] Device calendar sheet failed:', deviceCalErr);
        }
      }
    } catch (error) {
      console.error('Error updating calendar:', error);
```

(`eventTitle` is already declared earlier in this same add branch as `eventData?.name || brand.brandName`; reuse it.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/brand-details/useBrandDetailsScreen.ts
git commit -m "$(printf 'feat: present device-calendar sheet when adding an event\n\nBundles the native add-event sheet into the existing Add to\nCalendar action. Fire-and-forget; no in-app state depends on it.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 5: Manual QA (human/QA — requires a device or simulator)**

Run `npm run ios` and `npm run android`, then on **each** platform verify:

1. Open an event's details, tap **Add to Calendar** → the native "New Event" sheet appears, pre-filled with the correct **title**, **start**, **end**, and **location**.
2. Confirm/Save in the sheet → the event appears in the chosen device calendar.
3. Repeat, but **Cancel** the sheet → nothing is added to the device calendar.
4. In **all** of the above, the in-app calendar entry and the 24h/1h push reminders still behave exactly as before (the button shows "Added to Calendar").
5. Find or create an event with a missing/blank `endTime` → the device event defaults to a 2-hour duration.
6. Tap **Added to Calendar** to remove → still works, with no device-calendar side effect.
7. Toggle airplane mode → the in-app add still works and the sheet still opens (it's local OS UI).

- [ ] **Step 6: Run the pre-merge gate**

Run `/app-check` (typecheck → `senior-react-native` + `senior-typescript` + `senior-qa`) and address any findings before opening the PR.

---

## Notes for the executor

- The `NSCalendarsUsageDescription` from Task 1 only lands in a built binary after the next `expo prebuild` + native build; it is **not** required for the dialog to work in development. Do **not** run `expo prebuild` as part of this plan — per the repo's release notes, prebuild regenerates native projects and wipes signing/manifest fixes that are reapplied only at release time.
- `CalendarAlertModal.tsx` is dead code (unused) and is **out of scope** — do not wire it up or delete it here.
