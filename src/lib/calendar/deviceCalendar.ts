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
