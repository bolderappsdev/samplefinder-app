# Add event to the phone's native calendar

- **Date:** 2026-06-19
- **Repo:** `samplefinder-app` (Expo SDK 54 / RN 0.81, TypeScript strict)
- **Status:** Approved design — ready for implementation planning

## Summary

When a user taps **Add to Calendar** on an event, the app currently only saves the
event to the in-app calendar (their Appwrite profile) and schedules push reminders.
It never reaches the phone's own calendar. This feature adds that: after the existing
in-app save, we present the operating system's native **"Add Event" sheet**,
pre-filled with the event's details, so the user can save it to their personal
device calendar with one confirm tap.

This is **in addition to** the existing in-app Calendar feature — it does not replace it.

## Goals

- Tapping **Add to Calendar** also offers to put the event on the user's personal
  device calendar.
- As automated as possible with **no file download** (no `.ics`).
- A native "Add to Calendar?" confirmation, where the user can pick which calendar
  (work / personal) and review the details before saving.
- No new app permissions on Android; no Play Store data-safety disclosure change.

## Non-goals (YAGNI)

- Silently writing to the default calendar without confirmation.
- Tracking the created device-calendar event or removing it when the user un-adds
  the event in-app.
- Calendar alarms on the device event (the app already sends 24h/1h push reminders;
  adding device alarms would double-notify).
- Recurring events, time-zone pickers, or an attached URL (kept out of v1).
- Surfacing this anywhere beyond the event-details screen.

## Chosen approach

Use **`Calendar.createEventInCalendarAsync(eventData)`** from `expo-calendar`
(already a dependency, v15.0.8), bundled into the existing add action.

`createEventInCalendarAsync` presents a system dialog and requires **no runtime
calendar permission**:

- **iOS** — presents the native event editor (`EKEventEditViewController`). Returns
  an `action` of `saved` / `canceled` / `deleted`.
- **Android** — fires `Intent(ACTION_INSERT)`, launching the system calendar app to
  handle the insert. **No `WRITE_CALENDAR` permission needed.** The returned `action`
  is **always `done`** — Android cannot report whether the user saved or canceled.

### Alternatives considered and rejected

| Option | Why rejected |
|---|---|
| Silent write via `createEventAsync` | Requires re-enabling `WRITE_CALENDAR`, which `app.json` deliberately blocks, plus a Play Store data-safety disclosure. |
| `.ics` file via `expo-sharing` | User explicitly does not want a file download. |
| Separate dedicated "Add to phone calendar" control | User chose to bundle it into the existing button. |

## Architecture

### New helper — `src/lib/calendar/deviceCalendar.ts`

Mirrors the existing side-effect-helper pattern in
`src/lib/notifications/eventReminders.ts`. Self-contained, depends only on
`expo-calendar`, and **never throws** — device-calendar problems must never break the
primary in-app "save event" action.

```ts
export type AddToDeviceCalendarResult =
  | 'saved'     // iOS: user saved
  | 'canceled'  // iOS: user dismissed
  | 'done'      // Android: completed (save/cancel indistinguishable)
  | 'deleted'   // iOS edge case
  | 'skipped'   // invalid/missing start time — sheet not shown
  | 'error';    // unexpected failure (caught)

export interface DeviceCalendarEventInput {
  title: string;
  startTime: string;        // ISO datetime
  endTime?: string | null;  // ISO datetime
  address?: string | null;
  city?: string | null;
  notes?: string | null;
}

export async function presentAddToDeviceCalendar(
  input: DeviceCalendarEventInput,
): Promise<AddToDeviceCalendarResult>;
```

**Logic:**

1. `start = new Date(input.startTime)`. If invalid → log a warning, return `'skipped'`.
2. `end = input.endTime ? new Date(input.endTime) : null`. If invalid or `<= start`,
   set `end = start + 2h`.
3. `location = [address, city].filter(Boolean).join(', ')` → `undefined` if empty.
4. Build details: `{ title, startDate: start, endDate: end, location, notes, allDay: false }`
   (omit `notes`/`location` when empty).
5. `try { const r = await Calendar.createEventInCalendarAsync(details); return r.action }`
   `catch (e) { log; return 'error' }`.

### Wiring — `src/screens/brand-details/useBrandDetailsScreen.ts`

In `handleAddToCalendar`, **add-branch only** (the `else`/remove branch is untouched),
after the existing in-app save + reminder scheduling:

- Build the input from `eventData` (title `eventData.name` → fallback
  `brand.brandName`; `startTime`, `endTime`, `address`, `city`) and a `notes` string
  (see below).
- `await presentAddToDeviceCalendar(input)` inside its own `try/catch`; log the result.
  Do **not** gate any in-app state on the outcome and do **not** show a confirmation
  toast (Android can't report save vs cancel, so a toast would be misleading).
- If `eventData` is not loaded or `startTime` is invalid, the helper returns
  `'skipped'` and the in-app add still succeeds.

**Notes content:** join the event's discount text (`eventData.discount`) and brand
description (`eventData.brandDescription`) when present, separated by a blank line;
omit entirely if both are empty.

### Config — `app.json`

- **iOS:** add to `ios.infoPlist`:
  `"NSCalendarsUsageDescription": "Lets you add SampleFinder events to your personal calendar."`.
  Defensive — the binary links EventKit, so App Store static analysis expects the
  string even though the dialog API needs no runtime grant.
- **Android:** **no change.** `WRITE_CALENDAR` / `READ_CALENDAR` stay in
  `blockedPermissions`; the intent path needs no permission.
- This config must live in `app.json` (committed), because `expo prebuild`
  regenerates the native projects and wipes any hand-edited `Info.plist` /
  `AndroidManifest.xml`.

## Behavior & edge cases

- **Bundled, fire-and-forget:** in-app save + reminders + in-app notification run
  first (unchanged), then the sheet appears. Whether the user saves or cancels, the
  in-app "Added to Calendar" state is unaffected.
- The device-calendar entry is **not tracked, not reflected in the button, and not
  removed** when the user un-adds the event in-app.
- Events that were added **before** this ships won't trigger the sheet unless the user
  removes and re-adds them (accepted, per the bundle decision).
- Errors and the `'skipped'` path never surface an error to the user; the in-app add
  remains the source of truth.

## Verification

There is no test framework in this repo, so verification is typecheck + manual QA +
review agents.

1. `npm run typecheck` — clean.
2. **Manual matrix, iOS and Android:**
   - Add a new event → sheet appears pre-filled with correct title, start, end,
     location.
   - Confirm/Add → event appears in the chosen device calendar.
   - Cancel → nothing added to device calendar.
   - In **all** of the above, the in-app calendar entry + push reminders are
     unaffected.
   - Event with missing/blank `endTime` → device event defaults to a 2-hour duration.
   - Remove (un-add) → still works, no device-calendar side effect.
   - Offline → in-app add still works; sheet behaves gracefully.
3. `/app-check` (typecheck, then `senior-react-native` + `senior-typescript` +
   `senior-qa`) before opening the PR.

## Files touched

| File | Change |
|---|---|
| `src/lib/calendar/deviceCalendar.ts` | **New** helper wrapping `createEventInCalendarAsync`. |
| `src/screens/brand-details/useBrandDetailsScreen.ts` | Call the helper in the add branch of `handleAddToCalendar`. |
| `app.json` | Add iOS `NSCalendarsUsageDescription`. |
