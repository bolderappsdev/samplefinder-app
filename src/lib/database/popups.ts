import { ExecutionMethod } from 'react-native-appwrite';
import { functions } from './config';
import { APPWRITE_EVENTS_FUNCTION_ID } from '@env';

/**
 * Pop-up banner served by the Mobile API (SAM-5).
 * Targeting/counter fields are intentionally stripped server-side.
 */
export interface ActivePopup {
  $id: string;
  title: string | null;
  imageUrl: string;
  link: string | null;
  description: string | null;
}

interface GetActivePopupsResponse {
  success: boolean;
  popups?: ActivePopup[];
  count?: number;
  error?: string;
}

/**
 * Fetch pop-ups to show right now. The server evaluates schedule window,
 * audience and 21+ eligibility, and records the impression — anything
 * returned should be displayed.
 * @param userId - The user's profile document ID from user_profiles table
 */
export const getActivePopups = async (userId: string): Promise<ActivePopup[]> => {
  const functionId = APPWRITE_EVENTS_FUNCTION_ID || '';

  if (!functionId) {
    throw new Error('APPWRITE_EVENTS_FUNCTION_ID must be configured. Please check your .env file.');
  }

  if (!userId) {
    throw new Error('userId is required');
  }

  try {
    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify({ userId }),
      method: ExecutionMethod.POST,
      xpath: '/get-active-popups',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });

    if (execution.status === 'failed') {
      let errorMessage = 'Function execution failed';
      if (execution.responseBody) {
        try {
          const errorResponse = JSON.parse(execution.responseBody);
          errorMessage = errorResponse.error || errorResponse.message || execution.responseBody;
        } catch {
          errorMessage = execution.responseBody;
        }
      }
      console.error('[popups.getActivePopups] Function execution failed:', errorMessage);
      throw new Error(`Function execution failed: ${errorMessage}`);
    }

    if (!execution.responseBody) {
      throw new Error('Function execution returned empty response body');
    }

    let result: GetActivePopupsResponse;
    try {
      result = JSON.parse(execution.responseBody);
    } catch {
      console.error('[popups.getActivePopups] Failed to parse response body:', execution.responseBody);
      throw new Error('Invalid JSON response from function');
    }

    if (execution.responseStatusCode && execution.responseStatusCode >= 400) {
      const errorMessage = result.error || execution.responseBody || `HTTP ${execution.responseStatusCode}`;
      console.error('[popups.getActivePopups] Function returned error status:', {
        statusCode: execution.responseStatusCode,
        body: errorMessage,
      });
      throw new Error(`Function returned error: ${errorMessage}`);
    }

    if (!result.success) {
      console.error('[popups.getActivePopups] API returned error:', result);
      throw new Error(result.error || 'Failed to fetch popups');
    }

    return result.popups || [];
  } catch (error: unknown) {
    console.error('[popups.getActivePopups] Error fetching popups:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('must be') || message.includes('is required')) {
      throw error;
    }
    throw new Error(message || 'Failed to fetch active popups');
  }
};

/**
 * Record that the user tapped a pop-up banner. Fire-and-forget semantics:
 * failures are logged, never thrown — opening the link must not be blocked.
 * @param userId - The user's profile document ID
 * @param popupId - The popup document ID that was tapped
 */
export const recordPopupClick = async (userId: string, popupId: string): Promise<void> => {
  const functionId = APPWRITE_EVENTS_FUNCTION_ID || '';

  if (!functionId || !userId || !popupId) {
    return;
  }

  try {
    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify({ userId, popupId }),
      method: ExecutionMethod.POST,
      xpath: '/record-popup-click',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false,
    });

    if (execution.status === 'failed' && execution.responseBody) {
      console.warn('[popups.recordPopupClick] Execution failed:', execution.responseBody);
    }
  } catch (error) {
    console.warn('[popups.recordPopupClick] Error recording click:', error);
  }
};
