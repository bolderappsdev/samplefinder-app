/**
 * App store URLs for share/refer flows.
 *
 * Client request: every "join" or "make your own" share link should send people
 * to the live apps, not to samplefinder.com. The Android URL is derivable from
 * the package name; the iOS URL needs the numeric App Store ID from App Store
 * Connect (TODO).
 *
 * Format of share text: a short banner with both URLs so a recipient on either
 * platform can install. Newlines render in iOS/Android share sheets and in
 * Messages, WhatsApp, Mail, etc.
 */

export const IOS_APP_STORE_URL = 'https://apps.apple.com/app/samplefinder/id6755688743';

export const ANDROID_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.samplefinder.app';

/**
 * One-line suffix appended to share messages. Keep it compact so it does not
 * dominate the share text on platforms with character limits (e.g. SMS, X).
 */
export const APP_STORE_SHARE_SUFFIX =
  `📱 Get SampleFinder:\niOS: ${IOS_APP_STORE_URL}\nAndroid: ${ANDROID_PLAY_STORE_URL}`;
