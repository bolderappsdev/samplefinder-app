// Re-export all types
export type {
  UserProfileData,
  UserProfileRow,
  ClientData,
  FetchClientsFilters,
  LocationRow,
  EventRow,
  EventsByLocationResponse,
  CategoryData,
  UserStatistics,
  CheckInData,
  CheckInRow,
  ReviewData,
  ReviewRow,
  TierData,
  TierRow,
  SettingRow,
} from './types';

// Re-export user functions
export {
  createUserProfile,
  updateUserProfile,
  getUserProfile,
  deleteUserProfile,
  addFavoriteBrand,
  removeFavoriteBrand,
  addEventToUserCalendar,
  removeEventFromUserCalendar,
  getUserSavedEventIds,
  checkUsernameExists,
  checkUsernameExistsForDifferentUser,
  checkPhoneNumberExists,
  checkPhoneNumberExistsForDifferentUser,
} from './users';

// Re-export client functions
export {
  fetchClients,
  fetchClientsWithFilters,
  fetchClientById,
} from './clients';

// Re-export location functions
export {
  fetchLocations,
  fetchLocationById,
} from './locations';

// Re-export event functions
export {
  fetchEventsByClient,
  fetchAllEvents,
  fetchAllUpcomingEvents,
  fetchEventById,
  fetchEventByIdForHistory,
  fetchEventsByLocation,
  fetchEventsForLocationId,
} from './events';

// Re-export category functions
export {
  fetchCategories,
} from './categories';

// Re-export settings functions
export {
  getSetting,
  getAllSettings,
} from './settings';

// Re-export check-in functions
export {
  createCheckIn,
  getUserCheckIns,
  getUserCheckInForEvent,
  getUserCheckInsCount,
} from './checkIns';

// Re-export review functions
export {
  createReview,
  getUserReviews,
  getUserReviewForEvent,
  getUserReviewsCount,
  getEventReviews,
} from './reviews';

// Re-export statistics functions
export {
  getUserStatistics,
  calculateTierStatus,
} from './statistics';

// Re-export tier functions
export {
  fetchTiers,
  getUserCurrentTier,
  getUserNextTier,
  resolveCanonicalTier,
  resolveEffectiveTier,
} from './tiers';

// Re-export trivia functions
export {
  getActiveTrivia,
  submitTriviaAnswer,
  dismissTrivia,
} from './trivia';

// Re-export trivia types
export type {
  TriviaQuestion,
  SubmitAnswerResult,
  GetActiveTriviaResponse,
} from './trivia';

// Re-export popup functions (SAM-5)
export { getActivePopups, recordPopupClick } from './popups';
export type { ActivePopup } from './popups';

// Re-export user notifications functions
export {
  createUserNotification,
  getUserNotifications,
  getUnreadNotifications,
  markNotificationAsRead,
  markNotificationsAsRead,
  markAllNotificationsAsRead,
  markBadgeTypeNotificationsAsRead,
  deleteUserNotification,
  getUnreadNotificationCount,
  clearAllNotifications,
} from './userNotifications';

// Re-export user notifications types
export type {
  NotificationType,
  UserNotification,
} from './types';

export type { UserNotificationData } from './userNotifications';

// Default export for backward compatibility
import { createUserProfile } from './users';
import { getUserProfile } from './users';
import { updateUserProfile } from './users';
import { fetchClients } from './clients';
import { fetchClientsWithFilters } from './clients';
import { fetchClientById } from './clients';
import { fetchEventsByClient } from './events';
import { fetchAllEvents } from './events';
import { fetchAllUpcomingEvents } from './events';
import { fetchEventById } from './events';
import { fetchEventsByLocation, fetchEventsForLocationId } from './events';
import { fetchCategories } from './categories';
import { getUserStatistics } from './statistics';
import { calculateTierStatus } from './statistics';
import { fetchTiers, getUserCurrentTier, getUserNextTier } from './tiers';
import { getActiveTrivia, submitTriviaAnswer, dismissTrivia } from './trivia';

export default {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  fetchClients,
  fetchClientsWithFilters,
  fetchClientById,
  fetchEventsByClient,
  fetchAllEvents,
  fetchAllUpcomingEvents,
  fetchEventById,
  fetchEventsByLocation,
  fetchEventsForLocationId,
  fetchCategories,
  getUserStatistics,
  calculateTierStatus,
  fetchTiers,
  getUserCurrentTier,
  getUserNextTier,
  getActiveTrivia,
  submitTriviaAnswer,
  dismissTrivia,
};

