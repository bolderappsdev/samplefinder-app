/**
 * Utility functions for formatting form inputs
 */

/**
 * Splits a tier display name into main title and optional parenthetical subtitle.
 * E.g. "VIS (Very Important Sampler)" → { main: "VIS", subtitle: "(Very Important Sampler)" }.
 * Used so the subtitle can be rendered in a smaller font per Figma.
 */
export const getTierDisplayParts = (name: string): { main: string; subtitle: string | null } => {
  const match = name.match(/^(.+?)\s+(\([^)]+\))$/);
  if (match) {
    return { main: match[1].trim(), subtitle: match[2] };
  }
  return { main: name, subtitle: null };
};

/** Headline when a tier badge is earned (not in-progress). */
export const getTierEarnedHeadline = (tierOrder: number): string =>
  tierOrder === 1 ? 'Thanks for Joining!' : "You've Leveled Up!";

/**
 * Body copy for tier-earned popups.
 * Tier 1 copy is fixed to 100 points per product requirement.
 * `requiredPoints` is the threshold for the tier reached (tiers 2–5).
 */
export const getTierEarnedPointsMessage = (
  tierOrder: number,
  requiredPoints: number,
  _displayPoints: number
): string => {
  if (tierOrder === 1) {
    return 'You earned 100 points with SampleFinder, just for signing up!';
  }
  return `You reached **${requiredPoints.toLocaleString('en-US')}** points with SampleFinder, unlocking your new tier!`;
};

/**
 * Formats a phone number as (XXX) XXX-XXXX
 */
export const formatPhoneNumber = (text: string): string => {
  // Remove all non-digits
  const cleaned = text.replace(/\D/g, '');
  
  // Format as (XXX) XXX-XXXX
  if (cleaned.length <= 3) {
    return cleaned.length > 0 ? `(${cleaned}` : '';
  } else if (cleaned.length <= 6) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  } else {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  }
};

/**
 * Formats a date as MM/DD/YYYY
 */
export const formatDate = (text: string): string => {
  // Remove all non-digits
  const cleaned = text.replace(/\D/g, '');
  
  // Format as MM/DD/YYYY
  if (cleaned.length <= 2) {
    return cleaned;
  } else if (cleaned.length <= 4) {
    return `${cleaned.slice(0, 2)}/${cleaned.slice(2)}`;
  } else {
    return `${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}/${cleaned.slice(4, 8)}`;
  }
};

/**
 * Validates email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates phone number format (10 digits)
 */
export const isValidPhoneNumber = (phone: string): boolean => {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10;
};

/**
 * Validates date format (MM/DD/YYYY) and ensures it's not a future date
 */
export const isValidDate = (date: string): boolean => {
  const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!dateRegex.test(date)) return false;
  
  const [month, day, year] = date.split('/').map(Number);
  
  // Validate month range
  if (month < 1 || month > 12) return false;
  
  // Validate year (must be reasonable, not 0000)
  if (year < 1900 || year > new Date().getFullYear()) return false;
  
  // Create date object
  const dateObj = new Date(year, month - 1, day);
  
  // Check if date is valid (handles invalid days like Feb 30)
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return false;
  }
  
  // Check if date is in the future
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dateObj.setHours(0, 0, 0, 0);
  
  if (dateObj > today) return false;

  return true;
};

/**
 * Calculates a whole-year age from a date of birth in MM/DD/YYYY format.
 * Accounts for whether the birthday has already occurred this year.
 * Returns null when the string cannot be parsed as a real calendar date,
 * so callers can distinguish "unknown" from a computed age.
 */
export const calculateAgeFromDOB = (dateOfBirth: string): number | null => {
  const parts = dateOfBirth.split('/').map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  const [month, day, year] = parts;
  const birthDate = new Date(year, month - 1, day);

  // Reject values that rolled over (e.g. month 13, Feb 30) into a different date.
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age--;
  }
  return age;
};

/**
 * Formats an ISO date string to a readable format (e.g., "April 3, 1979").
 * For date-only values stored as ISO datetimes (e.g. DOB "1988-08-07T00:00:00.000Z"),
 * parses the YYYY-MM-DD prefix so the displayed calendar day matches the stored date
 * regardless of device timezone (UTC midnight would otherwise shift back one day in
 * negative-offset zones, e.g. Aug 7 UTC → "August 6" in PDT).
 */
export const formatDateForDisplay = (isoDate: string): string => {
  if (!isoDate) return '';

  try {
    const isoPrefix = isoDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoPrefix) {
      const year = parseInt(isoPrefix[1]!, 10);
      const month = parseInt(isoPrefix[2]!, 10) - 1;
      const day = parseInt(isoPrefix[3]!, 10);
      const calendarDate = new Date(year, month, day);
      if (!isNaN(calendarDate.getTime())) {
        return calendarDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    }

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoDate)) {
      const [month, day, year] = isoDate.split('/').map(Number);
      return new Date(year, month - 1, day).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (error) {
    console.error('[formatters.formatDateForDisplay] Error formatting date:', error);
    return isoDate;
  }
};

/**
 * Parses event date and time strings into start and end Date objects
 * @param dateString - Date in format "Aug 1, 2025"
 * @param timeString - Time in format "3 - 5 pm" or "10 - 11 am"
 * @returns Object with start and end Date objects
 */
export const parseEventDateTime = (
  dateString: string,
  timeString: string
): { start: Date; end: Date } => {
  // Parse date string (e.g., "Aug 1, 2025")
  const dateParts = dateString.trim().split(' ');
  if (dateParts.length < 3) {
    throw new Error(`Invalid date format: ${dateString}`);
  }

  const monthAbbr = dateParts[0]; // "Aug"
  const day = parseInt(dateParts[1].replace(',', ''), 10); // "1"
  const year = parseInt(dateParts[2], 10); // "2025"

  // Map month abbreviations to month numbers (0-indexed)
  const monthMap: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const month = monthMap[monthAbbr];
  if (month === undefined) {
    throw new Error(`Invalid month abbreviation: ${monthAbbr}`);
  }

  // Parse time string - supports four formats:
  // 1. "3 - 5 pm" or "10 - 11 am" (period at the end, no minutes)
  // 2. "3 pm - 11 pm" or "10 am - 11 am" (period after each hour, no minutes)
  // 3. "7:06 - 2:06 pm" (period at the end, with minutes)
  // 4. "7:06 am - 2:06 pm" (period after each hour, with minutes)
  let startHour: number;
  let endHour: number;
  let startMinute: number = 0;
  let endMinute: number = 0;
  let startPeriod: string;
  let endPeriod: string;

  // Try format 1: "3 - 5 pm" (period at the end, no minutes)
  const timeMatch1 = timeString.trim().match(/^(\d+)\s*-\s*(\d+)\s*(am|pm)$/i);
  if (timeMatch1) {
    startHour = parseInt(timeMatch1[1], 10);
    endHour = parseInt(timeMatch1[2], 10);
    startPeriod = timeMatch1[3].toLowerCase();
    endPeriod = timeMatch1[3].toLowerCase();
  } else {
    // Try format 2: "3 pm - 11 pm" (period after each hour, no minutes)
    const timeMatch2 = timeString.trim().match(/^(\d+)\s*(am|pm)\s*-\s*(\d+)\s*(am|pm)$/i);
    if (timeMatch2) {
      startHour = parseInt(timeMatch2[1], 10);
      endHour = parseInt(timeMatch2[3], 10);
      startPeriod = timeMatch2[2].toLowerCase();
      endPeriod = timeMatch2[4].toLowerCase();
    } else {
      // Try format 3: "7:06 - 2:06 pm" (period at the end, with minutes)
      const timeMatch3 = timeString.trim().match(/^(\d+):(\d+)\s*-\s*(\d+):(\d+)\s*(am|pm)$/i);
      if (timeMatch3) {
        startHour = parseInt(timeMatch3[1], 10);
        startMinute = parseInt(timeMatch3[2], 10);
        endHour = parseInt(timeMatch3[3], 10);
        endMinute = parseInt(timeMatch3[4], 10);
        startPeriod = timeMatch3[5].toLowerCase();
        endPeriod = timeMatch3[5].toLowerCase();
      } else {
        // Try format 4: "7:06 am - 2:06 pm" (period after each hour, with minutes)
        const timeMatch4 = timeString.trim().match(/^(\d+):(\d+)\s*(am|pm)\s*-\s*(\d+):(\d+)\s*(am|pm)$/i);
        if (timeMatch4) {
          startHour = parseInt(timeMatch4[1], 10);
          startMinute = parseInt(timeMatch4[2], 10);
          endHour = parseInt(timeMatch4[4], 10);
          endMinute = parseInt(timeMatch4[5], 10);
          startPeriod = timeMatch4[3].toLowerCase();
          endPeriod = timeMatch4[6].toLowerCase();
        } else {
          throw new Error(`Invalid time format: ${timeString}`);
        }
      }
    }
  }

  // Convert to 24-hour format
  if (startPeriod === 'pm') {
    if (startHour !== 12) startHour += 12;
  } else if (startPeriod === 'am') {
    if (startHour === 12) startHour = 0;
  }

  if (endPeriod === 'pm') {
    if (endHour !== 12) endHour += 12;
  } else if (endPeriod === 'am') {
    if (endHour === 12) endHour = 0;
  }

  // Create start and end Date objects with minutes
  let start = new Date(year, month, day, startHour, startMinute, 0, 0);
  let end = new Date(year, month, day, endHour, endMinute, 0, 0);

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date/time values: ${dateString} ${timeString}`);
  }

  // If end time is before or equal to start time, assume the event spans to the next day
  if (end <= start) {
    end = new Date(year, month, day + 1, endHour, endMinute, 0, 0);
  }

  // If end is still before start (shouldn't happen with above logic, but being defensive),
  // swap them so the event can still be added to calendar
  if (end < start) {
    [start, end] = [end, start];
  }

  return { start, end };
};

/** Returns IANA zone if valid for Intl, otherwise undefined (fall back to device local). */
export const resolveEventTimeZone = (timeZone?: string | null): string | undefined => {
  if (timeZone == null || typeof timeZone !== 'string') return undefined;
  let trimmed = timeZone.trim();
  if (!trimmed) return undefined;
  // Common CMS/API typos and legacy aliases so Newfoundland resolves to America/St_Johns (NT display).
  const lower = trimmed.toLowerCase();
  if (lower === 'canada/newfoundland' || /^america\/st[\s_]johns$/i.test(trimmed)) {
    trimmed = 'America/St_Johns';
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return undefined;
  }
};

const getYmdInTimeZone = (date: Date, timeZone: string): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? 'NaN', 10);
  const month = parseInt(parts.find((p) => p.type === 'month')?.value ?? 'NaN', 10);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? 'NaN', 10);
  return { year, month, day };
};

/**
 * Calendar anchor in the device's local Date for grid/list matching: Y-M-D is taken from the event's
 * wall-clock day in `timeZone` when set, otherwise from the instant in the device local zone.
 */
export const getEventCalendarAnchorDate = (isoDate: string, timeZone?: string | null): Date => {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return date;
  const tz = resolveEventTimeZone(timeZone);
  if (!tz) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  }
  const { year, month, day } = getYmdInTimeZone(date, tz);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

/** Negative if event calendar day is before "today" in the comparison zone, 0 if same day, positive if after. */
export const compareEventDayToToday = (isoDate: string, timeZone?: string | null): number => {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return 0;
  const tz = resolveEventTimeZone(timeZone);
  const now = new Date();
  if (!tz) {
    const ev = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const td = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return ev.getTime() - td.getTime();
  }
  const evYmd = getYmdInTimeZone(d, tz);
  const tdYmd = getYmdInTimeZone(now, tz);
  if (evYmd.year !== tdYmd.year) return evYmd.year - tdYmd.year;
  if (evYmd.month !== tdYmd.month) return evYmd.month - tdYmd.month;
  return evYmd.day - tdYmd.day;
};

function formatWallClockInZone(date: Date, timeZone?: string): string {
  const tz = resolveEventTimeZone(timeZone);
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
    ...(tz ? { timeZone: tz } : {}),
  };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
  let hour = '';
  let minute = '';
  let dayPeriod = '';
  for (const p of parts) {
    if (p.type === 'hour') hour = p.value;
    if (p.type === 'minute') minute = p.value;
    if (p.type === 'dayPeriod') dayPeriod = p.value.toLowerCase();
  }
  if (minute === '00') return `${hour} ${dayPeriod}`;
  return `${hour}:${minute} ${dayPeriod}`;
}

/**
 * IANA zones where Intl `short`/`shortGeneric` do not match product copy (stable abbreviations, not offsets).
 * e.g. Newfoundland uses GMT-2:30 with `short`; `shortGeneric` is a long label, not "NT".
 */
const EVENT_TIMEZONE_DISPLAY_ABBR: Record<string, string> = {
  'America/St_Johns': 'NT',
};

/** True when Intl emits an offset label (e.g. GMT-2:30 or GMT -2:30) instead of a zone tag. */
function isIntlTimeZoneOffsetStyle(value: string): boolean {
  const v = value.trim();
  if (/^GMT[+-]/i.test(v)) return true;
  // Some ICU builds insert a space: "GMT -2:30" — must not treat as a display abbreviation.
  if (/^GMT\s*[-+]\s*\d/.test(v)) return true;
  return false;
}

/** True when `shortGeneric` looks like a compact zone tag (ET, CT, HST), not a phrase or offset. */
function isCompactTimeZoneAbbrev(value: string): boolean {
  if (!value || isIntlTimeZoneOffsetStyle(value)) return false;
  if (value.includes(' ')) return false;
  return value.length <= 6;
}

/**
 * Stable display abbreviations: ET not EDT, CT not CDT, NT not GMT-2:30.
 * Prefers `shortGeneric` (Eastern Time → "ET"); falls back to `short` when generic is unusable.
 */
function shortTimeZoneName(date: Date, iana: string): string {
  const fixed = EVENT_TIMEZONE_DISPLAY_ABBR[iana];
  if (fixed) return fixed;

  const shortGenericOpts: Intl.DateTimeFormatOptions = {
    timeZone: iana,
    timeZoneName: 'shortGeneric',
  };

  try {
    const genericParts = new Intl.DateTimeFormat('en-US', shortGenericOpts).formatToParts(date);
    const generic = genericParts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (generic && isCompactTimeZoneAbbrev(generic)) {
      return generic;
    }
  } catch {
    // Hermes / older ICU: fall through
  }

  try {
    const shortParts = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'short',
    }).formatToParts(date);
    const shortName = shortParts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (shortName && !isIntlTimeZoneOffsetStyle(shortName)) {
      return shortName;
    }
  } catch {
    // ignore
  }

  return '';
}

/**
 * Formats an ISO datetime string to date format "Aug 1, 2025" in the event zone when provided.
 */
export const formatEventDate = (isoDate: string, timeZone?: string | null): string => {
  if (!isoDate) return '';

  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      return isoDate;
    }
    const tz = resolveEventTimeZone(timeZone);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch (error) {
    console.error('[formatters.formatEventDate] Error formatting date:', error);
    return isoDate;
  }
};

/**
 * Formats ISO datetimes to a wall-clock range in the event zone, e.g. "3 - 5 pm CT" when timeZone is set (generic abbreviations: ET, CT, not EDT/CDT).
 */
export const formatEventTime = (startTime: string, endTime: string, timeZone?: string | null): string => {
  if (!startTime || !endTime) return '';

  try {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return '';
    }

    const tz = resolveEventTimeZone(timeZone);
    if (!tz) {
      const formatHour = (date: Date) => {
        const hour = date.getHours();
        const period = hour >= 12 ? 'pm' : 'am';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        const minutes = date.getMinutes();
        return minutes > 0
          ? `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`
          : `${displayHour} ${period}`;
      };
      return `${formatHour(start)} - ${formatHour(end)}`;
    }

    const startStr = formatWallClockInZone(start, tz);
    const endStr = formatWallClockInZone(end, tz);
    const abbr = shortTimeZoneName(start, tz);
    return abbr ? `${startStr} - ${endStr} ${abbr}` : `${startStr} - ${endStr}`;
  } catch (error) {
    console.error('[formatters.formatEventTime] Error formatting time:', error);
    return '';
  }
};

/**
 * Returns true if event date is today or later (compares by calendar date only).
 * Use for "upcoming" so today's events still display even if their start time has passed.
 */
export const isEventTodayOrLater = (eventDate: string | Date, timeZone?: string | null): boolean => {
  const iso = typeof eventDate === 'string' ? eventDate : eventDate.toISOString();
  return compareEventDayToToday(iso, timeZone) >= 0;
};

/**
 * Event-like object with date and optional start/end times (ISO strings or Date).
 */
export interface EventWithDateAndTimes {
  date: string | Date;
  startTime?: string | Date;
  endTime?: string | Date;
  /** IANA timezone from Appwrite when set */
  timezone?: string | null;
}

/**
 * Returns true if the event is "upcoming": not in the past and not ended.
 * - Excludes events with date before today.
 * - Excludes events with date === today when endTime is already past.
 * Use this for "Upcoming Events" lists so only future dates and today's not-yet-ended events show.
 */
const toIso = (v: string | Date | undefined): string => {
  if (v == null) return '';
  return typeof v === 'string' ? v : v.toISOString();
};

export const isEventUpcoming = (event: EventWithDateAndTimes): boolean => {
  const primaryIso = toIso(event.startTime) || toIso(event.date);
  if (!primaryIso) return false;
  const dayCmp = compareEventDayToToday(primaryIso, event.timezone);
  if (dayCmp < 0) return false;
  if (dayCmp > 0) return true;
  if (event.endTime) {
    const end = new Date(toIso(event.endTime));
    return !isNaN(end.getTime()) && end > new Date();
  }
  return true;
};

/**
 * US state/territory full name → 2-letter postal abbreviation.
 */
const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
  'puerto rico': 'PR',
  guam: 'GU',
  'us virgin islands': 'VI',
  'american samoa': 'AS',
  'northern mariana islands': 'MP',
};

/**
 * Abbreviates a US state name to its 2-letter postal code.
 * Returns the original value if already abbreviated or not a recognized US state.
 */
export const abbreviateState = (state: string): string => {
  if (!state) return state;
  const trimmed = state.trim();
  if (!trimmed) return trimmed;
  const abbr = STATE_ABBREVIATIONS[trimmed.toLowerCase()];
  return abbr ?? trimmed;
};

/**
 * Parses products string (comma-separated or single string) into array
 */
export const parseProducts = (products: string): string[] => {
  if (!products) return [];
  
  // Split by comma and trim each product
  const productArray = products
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  
  // If no commas found, return as single item array
  return productArray.length > 0 ? productArray : [products.trim()];
};

/**
 * Calculates the distance between two coordinates using the Haversine formula
 * @param lat1 - Latitude of first point
 * @param lon1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lon2 - Longitude of second point
 * @returns Distance in meters
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Formats event distance for display
 * Supports three modes:
 * 1. Pass distanceKm to convert from kilometers (from database)
 * 2. Pass distanceMeters to convert from meters (from database) 
 * 3. Pass userLocation and eventCoordinates to calculate distance
 * 
 * @param options - Object containing either distanceKm, distanceMeters, OR both userLocation and eventCoordinates
 * @returns Formatted distance string (e.g., "2.5 mi away", "450 ft away", "Distance unknown")
 */
export const formatEventDistance = (options: {
  distanceKm?: number;
  distanceMeters?: number;
  userLocation?: { latitude: number; longitude: number };
  eventCoordinates?: { latitude: number; longitude: number };
}): string => {
  const { distanceKm, distanceMeters, userLocation, eventCoordinates } = options;

  let distanceInMeters: number;

  // Calculate distance from coordinates if provided
  if (userLocation && eventCoordinates) {
    distanceInMeters = calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      eventCoordinates.latitude,
      eventCoordinates.longitude
    );
  } 
  // Use meters if provided directly
  else if (distanceMeters !== undefined && distanceMeters !== null) {
    distanceInMeters = distanceMeters;
  }
  // Convert from kilometers if provided
  else if (distanceKm !== undefined && distanceKm !== null) {
    distanceInMeters = distanceKm * 1000;
  } 
  // No distance information available
  else {
    return 'Distance unknown';
  }

  // Convert meters to miles
  const distanceMiles = distanceInMeters / 1609.34;

  // Format as feet if less than 0.1 miles (528 feet)
  if (distanceMiles < 0.1) {
    return `${(distanceMiles * 5280).toFixed(0)} ft away`;
  }

  // Format as miles
  return `${distanceMiles.toFixed(1)} mi away`;
};

