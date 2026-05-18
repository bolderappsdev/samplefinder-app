import { ID, Query, ExecutionMethod } from 'react-native-appwrite';
import { USERNAME_TOO_LONG_MESSAGE } from '@/constants/Profile';
import { APPWRITE_EVENTS_FUNCTION_ID } from '@env';
import { tablesDB, functions, DATABASE_ID, USER_PROFILES_TABLE_ID } from './config';
import type { UserProfileData, UserProfileRow } from './types';
import type { NotificationPreferences } from '../notifications/types';

/**
 * Generate a unique referral code for a user
 * Format: 6 uppercase alphanumeric characters
 */
const generateReferralCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars: I, O, 0, 1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

/**
 * Check if a referral code already exists in the database
 */
const checkReferralCodeExists = async (code: string): Promise<boolean> => {
  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      queries: [Query.equal('referralCode', code)],
    });
    return result.rows && result.rows.length > 0;
  } catch (error) {
    console.error('[checkReferralCodeExists] Error:', error);
    return false;
  }
};

/**
 * Generate a unique referral code that doesn't exist in the database
 */
const generateUniqueReferralCode = async (): Promise<string> => {
  let code = generateReferralCode();
  let attempts = 0;
  const maxAttempts = 10;

  while (await checkReferralCodeExists(code) && attempts < maxAttempts) {
    code = generateReferralCode();
    attempts++;
  }

  if (attempts >= maxAttempts) {
    // Fallback: append timestamp to ensure uniqueness
    code = generateReferralCode() + Date.now().toString(36).slice(-2).toUpperCase();
  }

  return code;
};

/**
 * Helper function to parse savedEventIds from Appwrite (can be string or array)
 */
const parseSavedEventIds = (savedEventIds: any): Array<{ eventId: string; addedAt: string }> => {
  if (!savedEventIds) return [];
  
  try {
    // If it's a string, parse it as JSON
    if (typeof savedEventIds === 'string') {
      return JSON.parse(savedEventIds);
    }
    // If it's already an array, return it
    if (Array.isArray(savedEventIds)) {
      return savedEventIds;
    }
    return [];
  } catch (error) {
    console.error('[parseSavedEventIds] Error parsing savedEventIds:', error);
    return [];
  }
};

/**
 * Normalize phone numbers by stripping all non-digit characters.
 * Used for duplicate detection so that formatting differences
 * like "(555) 123-4567" vs "5551234567" are treated as equal.
 */
const getPhoneDigits = (phone: string): string => {
  return phone.replace(/\D/g, '');
};

/**
 * Username/phone duplicate checks can run before authentication on signup.
 * Treat auth/permission failures as expected and non-blocking.
 */
const isNonBlockingPreSignupCheckError = (error: any): boolean => {
  if (!error) return false;

  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  const code = error?.code;

  return (
    code === 401 ||
    code === 403 ||
    message.includes('not authorized') ||
    message.includes('unauthorized') ||
    message.includes('permission')
  );
};

const runPublicSignupAvailabilityCheck = async (payload: {
  username?: string;
  phoneNumber?: string;
}): Promise<{ usernameExists?: boolean; phoneExists?: boolean } | null> => {
  if (!APPWRITE_EVENTS_FUNCTION_ID) {
    return null;
  }

  try {
    const execution = await functions.createExecution({
      functionId: APPWRITE_EVENTS_FUNCTION_ID,
      body: JSON.stringify(payload),
      method: ExecutionMethod.POST,
      xpath: '/check-username-phone-availability',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });

    if (execution.status !== 'completed' || !execution.responseBody) {
      return null;
    }

    const response = JSON.parse(execution.responseBody) as {
      success?: boolean;
      usernameExists?: boolean;
      phoneExists?: boolean;
    };

    if (!response.success) {
      return null;
    }

    return {
      usernameExists:
        typeof response.usernameExists === 'boolean' ? response.usernameExists : undefined,
      phoneExists: typeof response.phoneExists === 'boolean' ? response.phoneExists : undefined,
    };
  } catch (error: any) {
    console.warn(
      '[database.runPublicSignupAvailabilityCheck] Public availability check failed, falling back to direct query:',
      error?.message || error
    );
    return null;
  }
};

/**
 * Create a user profile in the database
 */
export const createUserProfile = async (profileData: UserProfileData): Promise<void> => {
  console.log('[database.createUserProfile] Starting user profile creation');
  console.log('[database.createUserProfile] Profile data:', {
    authID: profileData.authID,
    firstname: profileData.firstname,
    lastname: profileData.lastname,
    phoneNumber: profileData.phoneNumber,
    username: profileData.username,
    role: profileData.role || 'user',
  });

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.createUserProfile]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Before creating the profile, enforce unique phone number (normalized by digits)
    if (profileData.phoneNumber && profileData.phoneNumber.trim()) {
      const phoneExists = await checkPhoneNumberExists(profileData.phoneNumber);
      if (phoneExists) {
        throw new Error('An account with this phone number already exists. Please use the login page to sign in.');
      }
    }

    // Convert date string to ISO 8601 format if needed
    let dobISO = profileData.dob;
    console.log('[database.createUserProfile] Original DOB:', dobISO);
    
    // DOB is a calendar date, not an instant: anchor it to UTC midnight of the entered
    // day so admin (UTC-pinned writes) and mobile read back the same wall-clock date.
    // Using new Date(...).toISOString() on a local-time Date would shift the UTC day
    // in non-UTC zones (e.g. PDT 1988-08-07 00:00 → 1988-08-07T07:00:00.000Z).
    if (dobISO && !dobISO.includes('T')) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dobISO)) {
        dobISO = `${dobISO}T00:00:00.000Z`;
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dobISO)) {
        const [month, day, year] = dobISO.split('/');
        dobISO = `${year}-${month}-${day}T00:00:00.000Z`;
      } else {
        const parsed = new Date(dobISO);
        if (isNaN(parsed.getTime())) {
          throw new Error(`Invalid date format: ${dobISO}`);
        }
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        dobISO = `${y}-${m}-${d}T00:00:00.000Z`;
      }
    }
    
    console.log('[database.createUserProfile] Converted DOB to ISO:', dobISO);

    // Generate a unique referral code for the new user
    console.log('[database.createUserProfile] Generating unique referral code...');
    const referralCode = await generateUniqueReferralCode();
    console.log('[database.createUserProfile] Generated referral code:', referralCode);

    const rowData: any = {
      authID: profileData.authID,
      firstname: profileData.firstname,
      lastname: profileData.lastname,
      phoneNumber: profileData.phoneNumber,
      zipCode: profileData.zipCode,
      dob: dobISO,
      username: profileData.username,
      role: profileData.role || 'user',
      idAdult: profileData.isAdult ?? false, // Use 'idAdult' to match Appwrite column name
      referralCode: referralCode,
      totalPoints: 100, // Sign up credit points for new users
    };

    console.log('[database.createUserProfile] Creating row with data:', {
      ...rowData,
      dob: dobISO,
    });
    console.log('[database.createUserProfile] Database ID:', DATABASE_ID);
    console.log('[database.createUserProfile] Table ID:', USER_PROFILES_TABLE_ID);

    const rowId = ID.unique();
    console.log('[database.createUserProfile] Generated row ID:', rowId);
    
    console.log('[database.createUserProfile] Calling tablesDB.createRow with:', {
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: rowId,
      dataKeys: Object.keys(rowData),
    });
    
    // Note: If profile creation fails with permission error, ensure your Appwrite
    // database table has "Create" permission enabled for "Users" role
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: rowId,
      data: rowData,
      // Set permissions so the user can read/update/delete their own profile
      permissions: [
        `read("user:${profileData.authID}")`,
        `update("user:${profileData.authID}")`,
        `delete("user:${profileData.authID}")`,
      ],
    });

    console.log('[database.createUserProfile] createRow response:', JSON.stringify(result, null, 2));
    console.log('[database.createUserProfile] Response type:', typeof result);
    console.log('[database.createUserProfile] Response keys:', result ? Object.keys(result) : 'null');
    
    if (!result || !result.$id) {
      throw new Error('createRow returned invalid response - no row ID in result');
    }

    console.log('[database.createUserProfile] User profile created successfully:', {
      rowId: result.$id,
      authID: profileData.authID,
      referralCode: referralCode,
      fullResult: result,
    });
    
    // Verify the row was actually created by trying to read it back
    console.log('[database.createUserProfile] Verifying row was created...');
    try {
      const verifyResult = await tablesDB.getRow({
        databaseId: DATABASE_ID,
        tableId: USER_PROFILES_TABLE_ID,
        rowId: result.$id,
      });
      console.log('[database.createUserProfile] Row verification successful:', {
        rowId: verifyResult.$id,
        authID: verifyResult.authID,
      });
    } catch (verifyError: any) {
      console.error('[database.createUserProfile] Row verification failed:', verifyError);
      throw new Error(`Row was not created successfully. Verification failed: ${verifyError?.message || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error('[database.createUserProfile] Error creating user profile:', error);
    console.error('[database.createUserProfile] Error message:', error?.message);
    console.error('[database.createUserProfile] Error code:', error?.code);
    console.error('[database.createUserProfile] Error response:', error?.response);
    console.error('[database.createUserProfile] Full error:', JSON.stringify(error, null, 2));
    
    // Check for specific error types
    if (error?.code === 401 || error?.message?.includes('Unauthorized') || error?.message?.includes('authentication')) {
      throw new Error('Authentication failed. Please ensure you are logged in.');
    }
    if (error?.code === 403 || error?.message?.includes('permission') || error?.message?.includes('Permission')) {
      throw new Error('Permission denied. Please ensure your Appwrite database table has "Create" permission enabled for the "Users" role in the Appwrite Console.');
    }
    if (error?.code === 404 || error?.message?.includes('not found')) {
      throw new Error('Database or table not found. Please check your environment variables.');
    }
    
    throw new Error(error.message || 'Failed to create user profile');
  }
};

/**
 * Update user profile in the database
 */
export const updateUserProfile = async (
  profileId: string,
  updates: Partial<Pick<UserProfileData, 'firstname' | 'lastname' | 'phoneNumber' | 'username' | 'dob'>> & {
    avatarURL?: string | null;
    zipCode?: string | null;
    totalEvents?: number;
    totalReviews?: number;
    totalPoints?: number;
    favoriteIds?: string[];
    tierLevel?: string | null;
  }
): Promise<UserProfileRow> => {
  console.log('[database.updateUserProfile] Updating user profile:', {
    profileId,
    updates: Object.keys(updates),
  });

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.updateUserProfile]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Prepare update data
    const updateData: any = {};

    if (updates.firstname !== undefined) {
      updateData.firstname = updates.firstname.trim();
    }
    if (updates.lastname !== undefined) {
      updateData.lastname = updates.lastname.trim();
    }
    if (updates.phoneNumber !== undefined) {
      const trimmedPhone = updates.phoneNumber.trim();

      if (trimmedPhone) {
        // Enforce unique phone number for other users (normalized by digits)
        const profile = await tablesDB.getRow({
          databaseId: DATABASE_ID,
          tableId: USER_PROFILES_TABLE_ID,
          rowId: profileId,
        });

        const currentProfileId = profile.$id;
        const existsForDifferentUser = await checkPhoneNumberExistsForDifferentUser(trimmedPhone, currentProfileId);
        if (existsForDifferentUser) {
          throw new Error('This phone number is already associated with another account. Please enter a different phone number.');
        }
      }

      updateData.phoneNumber = trimmedPhone;
    }
    if (updates.username !== undefined) {
      updateData.username = updates.username.trim();
    }
    if (updates.avatarURL !== undefined) {
      updateData.avatarURL = updates.avatarURL;
    }
    if (updates.zipCode !== undefined) {
      updateData.zipCode = updates.zipCode;
    }
    if (updates.totalEvents !== undefined) {
      updateData.totalEvents = updates.totalEvents;
    }
    if (updates.totalReviews !== undefined) {
      updateData.totalReviews = updates.totalReviews;
    }
    if (updates.totalPoints !== undefined) {
      updateData.totalPoints = updates.totalPoints;
    }
    if (updates.favoriteIds !== undefined) {
      updateData.favoriteIds = updates.favoriteIds;
    }
    if (updates.tierLevel !== undefined) {
      updateData.tierLevel = updates.tierLevel;
    }
    if ((updates as any).savedEventIds !== undefined) {
      updateData.savedEventIds = (updates as any).savedEventIds;
    }
    if (updates.dob !== undefined) {
      // Convert date to ISO format if needed
      let dobISO = updates.dob;
      if (dobISO && !dobISO.includes('T')) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dobISO)) {
          dobISO = `${dobISO}T00:00:00.000Z`;
        } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dobISO)) {
          const [month, day, year] = dobISO.split('/');
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          if (!isNaN(date.getTime())) {
            dobISO = date.toISOString();
          }
        }
      }
      updateData.dob = dobISO;
    }

    console.log('[database.updateUserProfile] Update data:', updateData);

    // Update the row
    const result = await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profileId,
      data: updateData,
    });

    console.log('[database.updateUserProfile] Profile updated successfully:', {
      rowId: result.$id,
    });

    // Return updated profile
    const updatedProfile = result as any;
    return {
      $id: updatedProfile.$id,
      authID: updatedProfile.authID,
      firstname: updatedProfile.firstname || '',
      lastname: updatedProfile.lastname || '',
      phoneNumber: updatedProfile.phoneNumber || '',
      dob: updatedProfile.dob || '',
      username: updatedProfile.username || '',
      role: updatedProfile.role || 'user',
      $createdAt: updatedProfile.$createdAt,
      $updatedAt: updatedProfile.$updatedAt,
      avatarURL: updatedProfile.avatarURL,
      zipCode: updatedProfile.zipCode,
      referralCode: updatedProfile.referralCode,
      usedReferralCode: updatedProfile.usedReferralCode,
      isBlocked: Boolean(updatedProfile.isBlocked),
      isAdult: Boolean(updatedProfile.isAdult ?? updatedProfile.idAdult),
      totalEvents: updatedProfile.totalEvents || 0,
      totalReviews: updatedProfile.totalReviews || 0,
      totalPoints: updatedProfile.totalPoints || 0,
      isAmbassador: updatedProfile.isAmbassador || false,
      isInfluencer: updatedProfile.isInfluencer || false,
      favoriteIds: updatedProfile.favoriteIds || [],
      savedEventIds: parseSavedEventIds(updatedProfile.savedEventIds),
      notifications: updatedProfile.notifications || [],
      notificationPreferences: updatedProfile.notificationPreferences,
      tierLevel: updatedProfile.tierLevel ?? null,
    };
  } catch (error: any) {
    console.error('[database.updateUserProfile] Error updating user profile:', error);
    console.error('[database.updateUserProfile] Error message:', error?.message);
    console.error('[database.updateUserProfile] Error code:', error?.code);
    const rawMessage = typeof error?.message === 'string' ? error.message : '';
    const friendly = mapUsernameLengthValidationError(rawMessage);
    throw new Error((friendly ?? rawMessage) || 'Failed to update user profile');
  }
};

/** Appwrite returns long validation payloads; map username max-length failures to a short message. */
function mapUsernameLengthValidationError(message: string): string | null {
  const m = message.toLowerCase();
  if (!m.includes('username')) {
    return null;
  }
  if (
    m.includes('32') ||
    m.includes('no longer than') ||
    m.includes('longer than') ||
    m.includes('max length') ||
    m.includes('maximum length') ||
    m.includes('exceed') ||
    m.includes('too long') ||
    m.includes('attribute_size')
  ) {
    return USERNAME_TOO_LONG_MESSAGE;
  }
  return null;
}

/**
 * Check if username already exists (case-insensitive)
 */
export const checkUsernameExists = async (username: string): Promise<boolean> => {
  console.log('[database.checkUsernameExists] Checking if username exists:', username);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.checkUsernameExists]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!username || !username.trim()) {
    return false;
  }

  const trimmedUsername = username.trim();
  const lowerUsername = trimmedUsername.toLowerCase();

  try {
    const functionCheck = await runPublicSignupAvailabilityCheck({
      username: trimmedUsername,
    });
    if (typeof functionCheck?.usernameExists === 'boolean') {
      return functionCheck.usernameExists;
    }

    // Query for profiles - we'll check both exact match and case-insensitive
    // First try exact match (most common case)
    let exactResult;
    let exactQueryHadBlobError = false;
    try {
      exactResult = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: USER_PROFILES_TABLE_ID,
        queries: [Query.equal('username', trimmedUsername)],
      });

      if (exactResult.rows && exactResult.rows.length > 0) {
        console.log('[database.checkUsernameExists] Username exists (exact match)');
        return true;
      }
    } catch (exactError: any) {
      // Handle blob resolution errors gracefully
      if (exactError?.message?.includes('blob') || exactError?.message?.includes('Unable to resolve data')) {
        exactQueryHadBlobError = true;
        // If exact match query fails with blob error, it likely means a row with this username exists
        // but has an invalid blob reference. We should treat this as "username exists" to be safe.
        // However, it's also possible the error is from a different row. Let's try case-insensitive check first.
        console.warn('[database.checkUsernameExists] Blob resolution error in exact match query. Will try case-insensitive check:', exactError?.message);
        // Don't return yet - try case-insensitive check first
      } else {
        // Re-throw non-blob errors
        throw exactError;
      }
    }

    // If exact match not found, check case-insensitive by querying a range
    // and filtering in JavaScript (for case-insensitive comparison)
    // Note: This is a fallback - ideally usernames should be stored in lowercase
    let allResults;
    try {
      // Try with smaller batches to potentially avoid problematic rows
      allResults = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: USER_PROFILES_TABLE_ID,
        queries: [
          Query.limit(1000), // Reasonable limit for username checking
        ],
      });

      // Do case-insensitive comparison
      if (allResults.rows && allResults.rows.length > 0) {
        const exists = allResults.rows.some((row: any) => 
          row.username && row.username.toLowerCase() === lowerUsername
        );
        console.log('[database.checkUsernameExists] Username exists (case-insensitive):', exists);
        return exists;
      }
    } catch (caseInsensitiveError: any) {
      // Handle blob resolution errors gracefully
      if (caseInsensitiveError?.message?.includes('blob') || caseInsensitiveError?.message?.includes('Unable to resolve data')) {
        console.warn('[database.checkUsernameExists] Blob resolution error in case-insensitive query. Some rows may have invalid blob references:', caseInsensitiveError?.message);
        
        // If exact match query succeeded with no results, we can be reasonably confident username doesn't exist
        if (!exactQueryHadBlobError && exactResult && exactResult.rows && exactResult.rows.length === 0) {
          console.log('[database.checkUsernameExists] Exact match found no results, case-insensitive check failed due to blob error. Username likely available.');
          return false;
        }
        
        // If exact match query also had blob error, we can't verify properly
        // In this case, we'll allow signup - if username is duplicate, the createUserProfile will fail
        // This is better than blocking legitimate signups due to data integrity issues
        if (exactQueryHadBlobError) {
          console.warn('[database.checkUsernameExists] Both queries failed due to blob errors. Cannot verify username. Allowing signup (will fail if duplicate).');
          return false; // Allow signup - duplicate check will happen during profile creation
        }
        
        // If exact match succeeded but case-insensitive failed, and exact found no results, username is available
        return false;
      } else {
        // Re-throw non-blob errors
        throw caseInsensitiveError;
      }
    }

    console.log('[database.checkUsernameExists] Username does not exist');
    return false;
  } catch (error: any) {
    if (isNonBlockingPreSignupCheckError(error)) {
      console.warn(
        '[database.checkUsernameExists] Username check skipped due to auth/permission constraints before signup:',
        error?.message
      );
      return false;
    }

    console.warn('[database.checkUsernameExists] Error checking username:', error?.message || error);
    // If there's an error, return false to avoid blocking signup
    // The actual signup will fail if username is truly duplicate during profile creation
    // This prevents blocking legitimate signups due to transient errors
    console.warn('[database.checkUsernameExists] Error occurred, allowing signup (will fail if duplicate).');
    return false;
  }
};

/**
 * Check if a phone number already exists (normalized by digits)
 */
export const checkPhoneNumberExists = async (phoneNumber: string): Promise<boolean> => {
  console.log('[database.checkPhoneNumberExists] Checking if phone number exists:', phoneNumber);

  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.checkPhoneNumberExists]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!phoneNumber || !phoneNumber.trim()) {
    return false;
  }

  const trimmedPhone = phoneNumber.trim();
  const targetDigits = getPhoneDigits(trimmedPhone);
  if (!targetDigits) {
    return false;
  }

  try {
    const functionCheck = await runPublicSignupAvailabilityCheck({
      phoneNumber: trimmedPhone,
    });
    if (typeof functionCheck?.phoneExists === 'boolean') {
      return functionCheck.phoneExists;
    }

    // Fetch a reasonable batch of profiles and compare by digits
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      queries: [Query.limit(1000)],
    });

    const exists =
      !!result.rows &&
      result.rows.some((row: any) => {
        const rowDigits = row.phoneNumber ? getPhoneDigits(String(row.phoneNumber)) : '';
        return rowDigits && rowDigits === targetDigits;
      });

    console.log('[database.checkPhoneNumberExists] Phone number exists (normalized):', exists);
    return exists;
  } catch (error: any) {
    if (isNonBlockingPreSignupCheckError(error)) {
      console.warn(
        '[database.checkPhoneNumberExists] Phone check skipped due to auth/permission constraints before signup:',
        error?.message
      );
      return false;
    }

    console.warn('[database.checkPhoneNumberExists] Error checking phone number:', error?.message || error);
    // Do not block signup on transient errors – let backend enforce any hard constraints
    console.warn('[database.checkPhoneNumberExists] Error occurred, allowing signup (backend will fail if duplicate).');
    return false;
  }
};

/**
 * Check if a phone number exists for a different user (used in edit profile)
 * Returns true if the normalized phone exists and belongs to a different profile.
 */
export const checkPhoneNumberExistsForDifferentUser = async (
  phoneNumber: string,
  currentUserProfileId: string
): Promise<boolean> => {
  console.log('[database.checkPhoneNumberExistsForDifferentUser] Checking phone:', phoneNumber, 'excluding profile:', currentUserProfileId);

  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.checkPhoneNumberExistsForDifferentUser]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!phoneNumber || !phoneNumber.trim()) {
    return false;
  }

  const targetDigits = getPhoneDigits(phoneNumber.trim());
  if (!targetDigits) {
    return false;
  }

  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      queries: [Query.limit(1000)],
    });

    if (result.rows && result.rows.length > 0) {
      const existsForDifferentUser = result.rows.some((row: any) => {
        if (!row.phoneNumber || row.$id === currentUserProfileId) {
          return false;
        }
        const rowDigits = getPhoneDigits(String(row.phoneNumber));
        return rowDigits && rowDigits === targetDigits && row.$id !== currentUserProfileId;
      });

      console.log('[database.checkPhoneNumberExistsForDifferentUser] Result:', existsForDifferentUser);
      return existsForDifferentUser;
    }

    console.log('[database.checkPhoneNumberExistsForDifferentUser] Phone does not exist for other users');
    return false;
  } catch (error: any) {
    console.error('[database.checkPhoneNumberExistsForDifferentUser] Error:', error);
    console.warn('[database.checkPhoneNumberExistsForDifferentUser] Error occurred, allowing update.');
    return false;
  }
};

/**
 * Check if a username exists for a different user (used in edit profile)
 * Returns true if username exists and belongs to a different user
 */
export const checkUsernameExistsForDifferentUser = async (
  username: string, 
  currentUserProfileId: string
): Promise<boolean> => {
  console.log('[database.checkUsernameExistsForDifferentUser] Checking username:', username, 'excluding profile:', currentUserProfileId);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.checkUsernameExistsForDifferentUser]', errorMsg);
    throw new Error(errorMsg);
  }

  if (!username || !username.trim()) {
    return false;
  }

  const trimmedUsername = username.trim();
  const lowerUsername = trimmedUsername.toLowerCase();

  try {
    // Query for profiles with matching username
    let allResults;
    try {
      allResults = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: USER_PROFILES_TABLE_ID,
        queries: [
          Query.limit(1000),
        ],
      });

      // Check if username exists for a different user (case-insensitive)
      if (allResults.rows && allResults.rows.length > 0) {
        const existsForDifferentUser = allResults.rows.some((row: any) => 
          row.username && 
          row.username.toLowerCase() === lowerUsername && 
          row.$id !== currentUserProfileId
        );
        console.log('[database.checkUsernameExistsForDifferentUser] Result:', existsForDifferentUser);
        return existsForDifferentUser;
      }
    } catch (queryError: any) {
      // Handle blob resolution errors gracefully
      if (queryError?.message?.includes('blob') || queryError?.message?.includes('Unable to resolve data')) {
        console.warn('[database.checkUsernameExistsForDifferentUser] Blob resolution error:', queryError?.message);
        // Allow update - if username is duplicate, the update will fail
        return false;
      } else {
        throw queryError;
      }
    }

    console.log('[database.checkUsernameExistsForDifferentUser] Username does not exist for other users');
    return false;
  } catch (error: any) {
    console.error('[database.checkUsernameExistsForDifferentUser] Error:', error);
    console.warn('[database.checkUsernameExistsForDifferentUser] Error occurred, allowing update.');
    return false;
  }
};

/**
 * Get user profile by authID
 */
export const getUserProfile = async (authID: string): Promise<UserProfileRow | null> => {
  console.log('[database.getUserProfile] Fetching user profile for authID:', authID);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.getUserProfile]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Query for the profile by authID
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      queries: [Query.equal('authID', authID)],
    });

    console.log('[database.getUserProfile] Query result:', {
      total: result.total,
      rowsCount: result.rows?.length || 0,
    });

    if (!result.rows || result.rows.length === 0) {
      console.log('[database.getUserProfile] No profile found for authID:', authID);
      return null;
    }

    const profile = result.rows[0] as any;
    
    // Log RAW value from database
    console.log('[database.getUserProfile] RAW Profile Data:', {
      rowId: profile.$id,
      authID: profile.authID,
      username: profile.username,
      isAdult_RAW: profile.isAdult,
      idAdult_RAW: profile.idAdult,
      ALL_KEYS: Object.keys(profile),
    });

    // Convert isAdult - handle both 'isAdult' and 'idAdult' field names
    // Check both possible field names (isAdult or idAdult - Appwrite column name)
    const rawAdultValue = profile.isAdult ?? profile.idAdult;
    const isAdultValue = rawAdultValue === true || 
                        rawAdultValue === 'true' || 
                        rawAdultValue === 1 || 
                        rawAdultValue === '1';
    console.log('[database.getUserProfile] Converted isAdult:', {
      raw: rawAdultValue,
      converted: isAdultValue
    });

    return {
      $id: profile.$id,
      authID: profile.authID,
      firstname: profile.firstname || '',
      lastname: profile.lastname || '',
      phoneNumber: profile.phoneNumber || '',
      dob: profile.dob || '',
      username: profile.username || '',
      role: profile.role || 'user',
      $createdAt: profile.$createdAt,
      $updatedAt: profile.$updatedAt,
      avatarURL: profile.avatarURL,
      zipCode: profile.zipCode,
      referralCode: profile.referralCode,
      usedReferralCode: profile.usedReferralCode,
      isBlocked: Boolean(profile.isBlocked),
      isAdult: isAdultValue,
      totalEvents: profile.totalEvents || 0,
      totalReviews: profile.totalReviews || 0,
      totalPoints: profile.totalPoints || 0,
      isAmbassador: profile.isAmbassador || false,
      isInfluencer: profile.isInfluencer || false,
      favoriteIds: profile.favoriteIds || [],
      savedEventIds: parseSavedEventIds(profile.savedEventIds),
      notifications: profile.notifications || [],
      notificationPreferences: profile.notificationPreferences,
      tierLevel: profile.tierLevel ?? null,
    };
  } catch (error: any) {
    console.error('[database.getUserProfile] Error fetching user profile:', error);
    console.error('[database.getUserProfile] Error message:', error?.message);
    console.error('[database.getUserProfile] Error code:', error?.code);
    throw new Error(error.message || 'Failed to fetch user profile');
  }
};

/**
 * Get notification preferences for a user
 */
export const getNotificationPreferences = async (authID: string): Promise<NotificationPreferences | null> => {
  console.log('[database.getNotificationPreferences] Fetching notification preferences for authID:', authID);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.getNotificationPreferences]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Get user profile first
    const profile = await getUserProfile(authID);
    if (!profile) {
      console.log('[database.getNotificationPreferences] No profile found, returning default preferences');
      return null;
    }

    // Extract notification preferences from profile
    // Parse JSON string if it exists, otherwise use defaults
    let parsedPreferences: any = null;
    if ((profile as any).notificationPreferences) {
      try {
        // If it's a string, parse it; if already an object, use it directly
        parsedPreferences = typeof (profile as any).notificationPreferences === 'string' 
          ? JSON.parse((profile as any).notificationPreferences)
          : (profile as any).notificationPreferences;
      } catch (error) {
        console.warn('[database.getNotificationPreferences] Error parsing preferences, using defaults:', error);
      }
    }

    const preferences: NotificationPreferences = {
      enablePushNotifications: parsedPreferences?.enablePushNotifications ?? true,
    };

    console.log('[database.getNotificationPreferences] Preferences retrieved:', preferences);
    return preferences;
  } catch (error: any) {
    console.error('[database.getNotificationPreferences] Error fetching preferences:', error);
    console.error('[database.getNotificationPreferences] Error message:', error?.message);
    throw new Error(error.message || 'Failed to fetch notification preferences');
  }
};

/**
 * Add a brand to user's favorites
 */
export const addFavoriteBrand = async (authID: string, brandId: string): Promise<void> => {
  console.log('[database.addFavoriteBrand] Adding favorite brand:', { authID, brandId });

  try {
    const profile = await getUserProfile(authID);
    if (!profile) {
      throw new Error('User profile not found');
    }

    const currentFavorites = profile.favoriteIds || [];
    
    // Check if already favorited
    if (currentFavorites.includes(brandId)) {
      console.log('[database.addFavoriteBrand] Brand already in favorites');
      return;
    }

    // Add new favorite
    const updatedFavorites = [...currentFavorites, brandId];

    await updateUserProfile(profile.$id, { favoriteIds: updatedFavorites });
    console.log('[database.addFavoriteBrand] Brand added to favorites successfully');
  } catch (error: any) {
    console.error('[database.addFavoriteBrand] Error adding favorite brand:', error);
    throw new Error(error.message || 'Failed to add favorite brand');
  }
};

/**
 * Remove a brand from user's favorites
 */
export const removeFavoriteBrand = async (authID: string, brandId: string): Promise<void> => {
  console.log('[database.removeFavoriteBrand] Removing favorite brand:', { authID, brandId });

  try {
    const profile = await getUserProfile(authID);
    if (!profile) {
      throw new Error('User profile not found');
    }

    const currentFavorites = profile.favoriteIds || [];
    
    // Remove the favorite
    const updatedFavorites = currentFavorites.filter((id) => id !== brandId);

    await updateUserProfile(profile.$id, { favoriteIds: updatedFavorites });
    console.log('[database.removeFavoriteBrand] Brand removed from favorites successfully');
  } catch (error: any) {
    console.error('[database.removeFavoriteBrand] Error removing favorite brand:', error);
    throw new Error(error.message || 'Failed to remove favorite brand');
  }
};

/**
 * Add an event to user's calendar
 */
export const addEventToUserCalendar = async (authID: string, eventId: string): Promise<void> => {
  console.log('[database.addEventToUserCalendar] Adding event to calendar:', { authID, eventId });

  try {
    const profile = await getUserProfile(authID);
    if (!profile) {
      throw new Error('User profile not found');
    }

    const currentSavedEvents = profile.savedEventIds || [];
    
    // Check if already saved
    if (currentSavedEvents.some((e) => e.eventId === eventId)) {
      console.log('[database.addEventToUserCalendar] Event already in calendar');
      return;
    }

    // Add new saved event with timestamp
    const updatedSavedEvents = [
      ...currentSavedEvents,
      { eventId, addedAt: new Date().toISOString() }
    ];

    // Store as JSON string for Appwrite
    const savedEventIdsJson = JSON.stringify(updatedSavedEvents);
    
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profile.$id,
      data: {
        savedEventIds: savedEventIdsJson,
      },
    });
    console.log('[database.addEventToUserCalendar] Event added to calendar successfully');
  } catch (error: any) {
    console.error('[database.addEventToUserCalendar] Error adding event to calendar:', error);
    throw new Error(error.message || 'Failed to add event to calendar');
  }
};

/**
 * Remove an event from user's calendar
 */
export const removeEventFromUserCalendar = async (authID: string, eventId: string): Promise<void> => {
  console.log('[database.removeEventFromUserCalendar] Removing event from calendar:', { authID, eventId });

  try {
    const profile = await getUserProfile(authID);
    if (!profile) {
      throw new Error('User profile not found');
    }

    const currentSavedEvents = profile.savedEventIds || [];
    
    // Remove the event
    const updatedSavedEvents = currentSavedEvents.filter((e) => e.eventId !== eventId);

    // Store as JSON string for Appwrite
    const savedEventIdsJson = JSON.stringify(updatedSavedEvents);
    
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profile.$id,
      data: {
        savedEventIds: savedEventIdsJson,
      },
    });
    console.log('[database.removeEventFromUserCalendar] Event removed from calendar successfully');
  } catch (error: any) {
    console.error('[database.removeEventFromUserCalendar] Error removing event from calendar:', error);
    throw new Error(error.message || 'Failed to remove event from calendar');
  }
};

/**
 * Get user's saved event IDs
 */
export const getUserSavedEventIds = async (authID: string): Promise<string[]> => {
  console.log('[database.getUserSavedEventIds] Fetching saved event IDs for authID:', authID);

  try {
    const profile = await getUserProfile(authID);
    if (!profile) {
      console.log('[database.getUserSavedEventIds] No profile found, returning empty array');
      return [];
    }

    const savedEvents = profile.savedEventIds || [];
    const eventIds = savedEvents.map((e) => e.eventId);
    
    console.log('[database.getUserSavedEventIds] Found saved events:', eventIds.length);
    return eventIds;
  } catch (error: any) {
    console.error('[database.getUserSavedEventIds] Error fetching saved event IDs:', error);
    throw new Error(error.message || 'Failed to fetch saved event IDs');
  }
};

/**
 * Update notification preferences for a user
 */
export const updateNotificationPreferences = async (
  authID: string,
  preferences: Partial<NotificationPreferences>
): Promise<void> => {
  console.log('[database.updateNotificationPreferences] Updating preferences for authID:', authID);
  console.log('[database.updateNotificationPreferences] New preferences:', preferences);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.updateNotificationPreferences]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Get current profile
    const profile = await getUserProfile(authID);
    if (!profile) {
      throw new Error('User profile not found');
    }

    // Get current preferences or use defaults
    // Parse JSON string if it exists
    let parsedPreferences: any = null;
    if ((profile as any).notificationPreferences) {
      try {
        // If it's a string, parse it; if already an object, use it directly
        parsedPreferences = typeof (profile as any).notificationPreferences === 'string' 
          ? JSON.parse((profile as any).notificationPreferences)
          : (profile as any).notificationPreferences;
      } catch (error) {
        console.warn('[database.updateNotificationPreferences] Error parsing existing preferences, using defaults:', error);
      }
    }

    const currentPreferences: NotificationPreferences = {
      enablePushNotifications: parsedPreferences?.enablePushNotifications ?? true,
    };

    // Merge with new preferences
    const updatedPreferences: NotificationPreferences = {
      ...currentPreferences,
      ...preferences,
    };

    console.log('[database.updateNotificationPreferences] Merged preferences:', updatedPreferences);

    // Update the profile with new preferences
    // Convert to JSON string since Appwrite expects a string type
    await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profile.$id,
      data: {
        notificationPreferences: JSON.stringify(updatedPreferences),
      },
    });

    console.log('[database.updateNotificationPreferences] Preferences updated successfully');
  } catch (error: any) {
    console.error('[database.updateNotificationPreferences] Error updating preferences:', error);
    console.error('[database.updateNotificationPreferences] Error message:', error?.message);
    throw new Error(error.message || 'Failed to update notification preferences');
  }
};

/**
 * Delete user profile from the database
 */
export const deleteUserProfile = async (authID: string): Promise<void> => {
  console.log('[database.deleteUserProfile] Deleting user profile for authID:', authID);

  // Validate environment variables
  if (!DATABASE_ID || !USER_PROFILES_TABLE_ID) {
    const errorMsg = 'Database ID or Table ID not configured. Please check your .env file.';
    console.error('[database.deleteUserProfile]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Get user profile first
    const profile = await getUserProfile(authID);
    if (!profile) {
      console.log('[database.deleteUserProfile] No profile found for authID:', authID);
      return;
    }

    // Delete the profile row
    await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: USER_PROFILES_TABLE_ID,
      rowId: profile.$id,
    });

    console.log('[database.deleteUserProfile] User profile deleted successfully:', profile.$id);
  } catch (error: any) {
    console.error('[database.deleteUserProfile] Error deleting user profile:', error);
    console.error('[database.deleteUserProfile] Error message:', error?.message);
    console.error('[database.deleteUserProfile] Error code:', error?.code);
    throw new Error(error.message || 'Failed to delete user profile');
  }
};

