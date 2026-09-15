import { Query, ExecutionMethod } from 'react-native-appwrite';
import { tablesDB, functions, DATABASE_ID, EVENTS_TABLE_ID } from './config';
import { APPWRITE_EVENTS_FUNCTION_ID } from '@env';
import type { EventRow, EventsByLocationResponse } from './types';

/** Map a document from the Mobile API (get-events-by-location / get-events-for-location-id) to EventRow. */
function mapMobileApiEventToEventRow(raw: Record<string, unknown>): EventRow {
  let location: [number, number] | undefined;
  const loc = raw.location as unknown;
  if (loc) {
    if (Array.isArray(loc) && loc.length >= 2) {
      location = [Number(loc[0]), Number(loc[1])];
    } else if (
      typeof loc === 'object' &&
      loc !== null &&
      'coordinates' in loc &&
      Array.isArray((loc as { coordinates: number[] }).coordinates)
    ) {
      const c = (loc as { coordinates: number[] }).coordinates;
      location = [c[0], c[1]];
    }
  }

  let categories: string[] | undefined;
  const cat = raw.categories;
  if (Array.isArray(cat)) {
    categories = cat
      .map((c) => (typeof c === 'string' ? c : (c as { $id?: string })?.$id))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } else if (typeof cat === 'string' && cat) {
    categories = [cat];
  } else if (cat && typeof cat === 'object' && '$id' in (cat as object)) {
    const id = (cat as { $id?: string }).$id;
    if (id) categories = [id];
  }

  const productsRaw = raw.products;
  const products =
    typeof productsRaw === 'string'
      ? productsRaw
      : Array.isArray(productsRaw)
        ? productsRaw.join(', ')
        : '';

  return {
    $id: String(raw.$id ?? ''),
    name: String(raw.name ?? ''),
    date: String(raw.date ?? ''),
    startTime: String(raw.startTime ?? ''),
    endTime: String(raw.endTime ?? ''),
    city: String(raw.city ?? ''),
    address: String(raw.address ?? ''),
    state: String(raw.state ?? ''),
    zipCode: String(raw.zipCode ?? ''),
    products,
    client: raw.client as EventRow['client'],
    checkInCode: String(raw.checkInCode ?? ''),
    checkInPoints: Number(raw.checkInPoints ?? 0),
    reviewPoints: Number(raw.reviewPoints ?? 0),
    eventInfo: String(raw.eventInfo ?? ''),
    discount: raw.discount != null && raw.discount !== '' ? String(raw.discount) : null,
    discountImageURL: (raw.discountImageURL as string | null) ?? null,
    brandDescription: (raw.brandDescription as string | null) ?? null,
    categories,
    location,
    locationId: parseLocationIdFromRow(raw),
    locationName: String(raw.locationName ?? ''),
    timezone: (raw.timezone as string | null) ?? null,
    isArchived: Boolean(raw.isArchived),
    isHidden: Boolean(raw.isHidden),
    $createdAt: raw.$createdAt as string | undefined,
    $updatedAt: raw.$updatedAt as string | undefined,
  };
}

/** Normalize Appwrite relationship or string id for events.locationId */
export const parseLocationIdFromRow = (row: Record<string, unknown>): string | null => {
  const raw = row.locationId as unknown;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof raw === 'object' && raw !== null && '$id' in raw) {
    const id = (raw as { $id?: string }).$id;
    return id != null && String(id).trim() !== '' ? String(id) : null;
  }
  return null;
};

/**
 * Fetch events by client ID
 */
export const fetchEventsByClient = async (clientId: string): Promise<EventRow[]> => {
  console.log('[database.fetchEventsByClient] Fetching events for client:', clientId);

  console.log('[database.fetchEventsByClient] DATABASE_ID:', DATABASE_ID);
  console.log('[database.fetchEventsByClient] EVENTS_TABLE_ID:', EVENTS_TABLE_ID);
  // Validate environment variables
  if (!DATABASE_ID || !EVENTS_TABLE_ID) {
    const errorMsg = 'Database ID or Events Table ID not configured. Please check your .env file.';
    console.error('[database.fetchEventsByClient]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Fetch all events and filter in JavaScript
    // This avoids query syntax issues with relationship columns
    // TODO: Optimize with proper query syntax once relationship query format is confirmed
    // Use a high limit to ensure we get all events (Appwrite default is 25)
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: EVENTS_TABLE_ID,
      queries: [Query.limit(1000)], // Fetch up to 1000 events to ensure we get all
    });

    console.log('[database.fetchEventsByClient] Query result:', {
      total: result.total,
      rowsCount: result.rows?.length || 0,
    });

    if (!result.rows || result.rows.length === 0) {
      console.log('[database.fetchEventsByClient] No events found for client:', clientId);
      return [];
    }

    // Map the rows to EventRow format and filter by client ID and exclude archived/hidden events
    const events: EventRow[] = result.rows
      .filter((row: any) => {
        // Filter by client ID - check if client matches (could be a relationship object or string ID)
        const rowClientId = row.client?.$id || row.client || '';
        const clientMatches = rowClientId === clientId || String(rowClientId) === String(clientId);
        
        // Filter out archived and hidden events
        const isArchived = row.isArchived === true || row.isArchived === 'true';
        const isHidden = row.isHidden === true || row.isHidden === 'true';
        
        return clientMatches && !isArchived && !isHidden;
      })
      .map((row: any) => {
        // Extract location from point field - format: [longitude, latitude]
        let location: [number, number] | undefined;
        if (row.location) {
          if (Array.isArray(row.location) && row.location.length >= 2) {
            location = [row.location[0], row.location[1]];
          } else if (row.location?.coordinates && Array.isArray(row.location.coordinates)) {
            location = [row.location.coordinates[0], row.location.coordinates[1]];
          }
        }

        return {
          $id: row.$id,
          name: row.name || '',
          date: row.date || '',
          startTime: row.startTime || '',
          endTime: row.endTime || '',
          city: row.city || '',
          address: row.address || '',
          state: row.state || '',
          zipCode: row.zipCode || '',
          products: row.products || '',
          client: row.client,
          checkInCode: row.checkInCode || '',
          checkInPoints: row.checkInPoints || 0,
          reviewPoints: row.reviewPoints || 0,
          eventInfo: row.eventInfo || '',
          discount: row.discount ?? null,
          discountImageURL: row.discountImageURL || null,
          brandDescription: row.brandDescription ?? null,
          categories: row.categories || [], // Include categories for adult filtering
          location,
          locationId: parseLocationIdFromRow(row),
          locationName: row.locationName || '',
          timezone: row.timezone ?? null,
          isArchived: row.isArchived || false,
          isHidden: row.isHidden || false,
          $createdAt: row.$createdAt,
          $updatedAt: row.$updatedAt,
        };
      });

    console.log('[database.fetchEventsByClient] Events fetched successfully:', events);
    return events;
  } catch (error: any) {
    console.error('[database.fetchEventsByClient] Error fetching events:', error);
    console.error('[database.fetchEventsByClient] Error message:', error?.message);
    console.error('[database.fetchEventsByClient] Error code:', error?.code);
    throw new Error(error.message || 'Failed to fetch events');
  }
};

/**
 * Fetch all events (not filtered by date or client)
 * Returns events that are not archived and not hidden
 * Useful for calendar views where we want to show all events
 */
export const fetchAllEvents = async (): Promise<EventRow[]> => {
  console.log('[database.fetchAllEvents] Fetching all events');

  // Validate environment variables
  if (!DATABASE_ID || !EVENTS_TABLE_ID) {
    const errorMsg = 'Database ID or Events Table ID not configured. Please check your .env file.';
    console.error('[database.fetchAllEvents]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // Build queries to filter events (exclude archived and hidden)
    const queries: any[] = [
      Query.equal('isArchived', false),
      Query.equal('isHidden', false),
      Query.limit(1000), // Fetch up to 1000 events
    ];

    console.log('[database.fetchAllEvents] Querying events with filters:', {
      isArchived: false,
    isHidden: false,
  });

  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: EVENTS_TABLE_ID,
    // Order by date ascending
    queries: [...queries, Query.orderAsc('date')],
  });

  console.log('[database.fetchAllEvents] Query result:', {
      total: result.total,
      rowsCount: result.rows?.length || 0,
    });

    if (!result.rows || result.rows.length === 0) {
      console.log('[database.fetchAllEvents] No events found');
      return [];
    }

    // Map the rows to EventRow format
    const events: EventRow[] = result.rows.map((row: any) => {
      // Extract location from point field - format: [longitude, latitude]
      let location: [number, number] | undefined;
      if (row.location) {
        if (Array.isArray(row.location) && row.location.length >= 2) {
          location = [row.location[0], row.location[1]];
        } else if (row.location?.coordinates && Array.isArray(row.location.coordinates)) {
          location = [row.location.coordinates[0], row.location.coordinates[1]];
        }
      }

      return {
        $id: row.$id,
        name: row.name || '',
        date: row.date || '',
        startTime: row.startTime || '',
        endTime: row.endTime || '',
        city: row.city || '',
        address: row.address || '',
        state: row.state || '',
        zipCode: row.zipCode || '',
        products: row.products || '',
        client: row.client,
        checkInCode: row.checkInCode || '',
        checkInPoints: row.checkInPoints || 0,
        reviewPoints: row.reviewPoints || 0,
        eventInfo: row.eventInfo || '',
        discount: row.discount ?? null,
        discountImageURL: row.discountImageURL || null,
        brandDescription: row.brandDescription ?? null,
        categories: row.categories || [], // Include categories for adult filtering
        location,
        locationId: parseLocationIdFromRow(row),
        locationName: row.locationName || '',
        timezone: row.timezone ?? null,
        isArchived: row.isArchived || false,
        isHidden: row.isHidden || false,
        $createdAt: row.$createdAt,
        $updatedAt: row.$updatedAt,
      };
    });

    console.log('[database.fetchAllEvents] Events fetched successfully:', events.length);
    return events;
  } catch (error: any) {
    console.error('[database.fetchAllEvents] Error fetching events:', error);
    console.error('[database.fetchAllEvents] Error message:', error?.message);
    console.error('[database.fetchAllEvents] Error code:', error?.code);
    throw new Error(error.message || 'Failed to fetch events');
  }
};

/**
 * Fetch all upcoming events (not filtered by client)
 * Returns events that are not archived, not hidden, and have a date in the future
 */
export const fetchAllUpcomingEvents = async (): Promise<EventRow[]> => {
  console.log('[database.fetchAllUpcomingEvents] Fetching all upcoming events');

  // Validate environment variables
  if (!DATABASE_ID || !EVENTS_TABLE_ID) {
    const errorMsg = 'Database ID or Events Table ID not configured. Please check your .env file.';
    console.error('[database.fetchAllUpcomingEvents]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Build queries to filter events
    const queries: any[] = [
      Query.equal('isArchived', false),
      Query.equal('isHidden', false),
      Query.greaterThanEqual('date', todayISO),
      Query.limit(1000), // Fetch up to 1000 events to avoid default page cap
    ];

    console.log('[database.fetchAllUpcomingEvents] Querying events with filters:', {
      isArchived: false,
      isHidden: false,
    dateMin: todayISO,
  });

  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: EVENTS_TABLE_ID,
    // Order by date ascending
    queries: [...queries, Query.orderAsc('date')],
  });

  console.log('[database.fetchAllUpcomingEvents] Query result:', {
      total: result.total,
      rowsCount: result.rows?.length || 0,
    });

    if (!result.rows || result.rows.length === 0) {
      console.log('[database.fetchAllUpcomingEvents] No upcoming events found');
      return [];
    }

    // Map the rows to EventRow format
    const events: EventRow[] = result.rows.map((row: any) => {
      // Extract location from point field - format: [longitude, latitude]
      let location: [number, number] | undefined;
      if (row.location) {
        if (Array.isArray(row.location) && row.location.length >= 2) {
          location = [row.location[0], row.location[1]];
        } else if (row.location?.coordinates && Array.isArray(row.location.coordinates)) {
          location = [row.location.coordinates[0], row.location.coordinates[1]];
        }
      }

      return {
        $id: row.$id,
        name: row.name || '',
        date: row.date || '',
        startTime: row.startTime || '',
        endTime: row.endTime || '',
        city: row.city || '',
        address: row.address || '',
        state: row.state || '',
        zipCode: row.zipCode || '',
        products: row.products || '',
        client: row.client,
        checkInCode: row.checkInCode || '',
        checkInPoints: row.checkInPoints || 0,
        reviewPoints: row.reviewPoints || 0,
        eventInfo: row.eventInfo || '',
        discount: row.discount ?? null,
        discountImageURL: row.discountImageURL || null,
        brandDescription: row.brandDescription ?? null,
        categories: row.categories || [], // Include categories for adult filtering
        location,
        locationId: parseLocationIdFromRow(row),
        locationName: row.locationName || '',
        timezone: row.timezone ?? null,
        isArchived: row.isArchived || false,
        isHidden: row.isHidden || false,
        $createdAt: row.$createdAt,
        $updatedAt: row.$updatedAt,
      };
    });

    console.log('[database.fetchAllUpcomingEvents] Events fetched successfully:', events.length);
    return events;
  } catch (error: any) {
    console.error('[database.fetchAllUpcomingEvents] Error fetching events:', error);
    console.error('[database.fetchAllUpcomingEvents] Error message:', error?.message);
    console.error('[database.fetchAllUpcomingEvents] Error code:', error?.code);
    throw new Error(error.message || 'Failed to fetch upcoming events');
  }
};

/**
 * Why a lookup produced no event. The distinction matters to the UI: 'unavailable' is a
 * decision the app made on purpose and will never change on retry, while a thrown error is
 * a genuine failure worth offering a retry for.
 */
export type EventLookup =
  | { status: 'ok'; event: EventRow }
  /** No such row — deleted, or an ID that never existed. */
  | { status: 'missing' }
  /** The row exists but is archived or hidden, so the app deliberately does not show it. */
  | { status: 'unavailable' };

/**
 * Fetch a single event by ID with client relationship, reporting *why* nothing came back.
 *
 * `fetchEventById` below collapses all three outcomes into null, which left callers unable to
 * tell "this event was taken down" from "the request failed" — a pop-up banner pointing at an
 * archived event showed a "try again later" screen for something no retry can fix.
 *
 * Throws only for real failures: missing config, or a network/permission error.
 */
export const lookupEventById = async (eventId: string): Promise<EventLookup> => {
  console.log('[database.lookupEventById] Fetching event:', eventId);

  // Validate environment variables
  if (!DATABASE_ID || !EVENTS_TABLE_ID) {
    const errorMsg = 'Database ID or Events Table ID not configured. Please check your .env file.';
    console.error('[database.lookupEventById]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const result = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: EVENTS_TABLE_ID,
      rowId: eventId,
    });

    if (!result) {
      console.log('[database.lookupEventById] Event not found:', eventId);
      return { status: 'missing' };
    }

    // Check if event is archived or hidden
    const isArchived = result.isArchived === true || result.isArchived === 'true';
    const isHidden = result.isHidden === true || result.isHidden === 'true';

    if (isArchived || isHidden) {
      console.log('[database.lookupEventById] Event is archived or hidden:', eventId);
      return { status: 'unavailable' };
    }

    // Fetch full client data if client is just an ID string
    let clientData = result.client;
    if (typeof result.client === 'string') {
      console.log('[database.lookupEventById] Client is ID string, fetching full client data:', result.client);
      const { fetchClientById } = await import('./clients');
      clientData = await fetchClientById(result.client);
    }

    // Extract location from point field - format: [longitude, latitude]
    let location: [number, number] | undefined;
    if (result.location) {
      if (Array.isArray(result.location) && result.location.length >= 2) {
        location = [result.location[0], result.location[1]];
      } else if (result.location?.coordinates && Array.isArray(result.location.coordinates)) {
        location = [result.location.coordinates[0], result.location.coordinates[1]];
      }
    }

    const event: EventRow = {
      $id: result.$id,
      name: result.name || '',
      date: result.date || '',
      startTime: result.startTime || '',
      endTime: result.endTime || '',
      city: result.city || '',
      address: result.address || '',
      state: result.state || '',
      zipCode: result.zipCode || '',
      products: result.products || '',
      client: clientData,
      checkInCode: result.checkInCode || '',
      checkInPoints: result.checkInPoints || 0,
      reviewPoints: result.reviewPoints || 0,
      eventInfo: result.eventInfo || '',
      discount: result.discount ?? null,
      discountImageURL: result.discountImageURL || null,
      brandDescription: result.brandDescription ?? null,
      categories: result.categories || [], // Include categories for adult filtering
      location,
      locationId: parseLocationIdFromRow(result as Record<string, unknown>),
      locationName: result.locationName || '',
      timezone: result.timezone ?? null,
      isArchived: result.isArchived || false,
      isHidden: result.isHidden || false,
      $createdAt: result.$createdAt,
      $updatedAt: result.$updatedAt,
    };

    console.log('[database.lookupEventById] Event fetched successfully:', event.$id);
    console.log('[database.lookupEventById] Client data:', JSON.stringify(clientData, null, 2));
    return { status: 'ok', event };
  } catch (error: any) {
    // A deleted event is a 404 from getRow, not a falsy result. Treated as an outcome rather
    // than an error, so callers do not surface Appwrite's raw "Document with the requested ID
    // could not be found" to a user who simply tapped a stale link.
    if (error?.code === 404) {
      console.log('[database.lookupEventById] Event no longer exists:', eventId);
      return { status: 'missing' };
    }
    console.error('[database.lookupEventById] Error fetching event:', error);
    console.error('[database.lookupEventById] Error message:', error?.message);
    console.error('[database.lookupEventById] Error code:', error?.code);
    throw new Error(error.message || 'Failed to fetch event');
  }
};

/**
 * Fetch a single event by ID, or null if it is missing or not shown in the app.
 * Kept for callers that only need "usable event or nothing" — see `lookupEventById`
 * when the reason matters.
 */
export const fetchEventById = async (eventId: string): Promise<EventRow | null> => {
  const result = await lookupEventById(eventId);
  return result.status === 'ok' ? result.event : null;
};

/**
 * Fetch a single event by ID for history display (includes archived/hidden events)
 * This function is specifically for displaying historical data and will return
 * event information even if the event is archived or hidden.
 */
export const fetchEventByIdForHistory = async (eventId: string): Promise<EventRow | null> => {
  console.log('[database.fetchEventByIdForHistory] Fetching event for history:', eventId);

  // Validate environment variables
  if (!DATABASE_ID || !EVENTS_TABLE_ID) {
    const errorMsg = 'Database ID or Events Table ID not configured. Please check your .env file.';
    console.error('[database.fetchEventByIdForHistory]', errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const result = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: EVENTS_TABLE_ID,
      rowId: eventId,
    });

    if (!result) {
      console.log('[database.fetchEventByIdForHistory] Event not found:', eventId);
      return null;
    }

    // For history, we DON'T filter out archived or hidden events
    // We want to show the user's historical activities

    // Fetch full client data if client is just an ID string
    let clientData = result.client;
    if (typeof result.client === 'string') {
      console.log('[database.fetchEventByIdForHistory] Client is ID string, fetching full client data:', result.client);
      const { fetchClientById } = await import('./clients');
      clientData = await fetchClientById(result.client);
    }

    // Extract location from point field - format: [longitude, latitude]
    let location: [number, number] | undefined;
    if (result.location) {
      if (Array.isArray(result.location) && result.location.length >= 2) {
        location = [result.location[0], result.location[1]];
      } else if (result.location?.coordinates && Array.isArray(result.location.coordinates)) {
        location = [result.location.coordinates[0], result.location.coordinates[1]];
      }
    }

    const event: EventRow = {
      $id: result.$id,
      name: result.name || '',
      date: result.date || '',
      startTime: result.startTime || '',
      endTime: result.endTime || '',
      city: result.city || '',
      address: result.address || '',
      state: result.state || '',
      zipCode: result.zipCode || '',
      products: result.products || '',
      client: clientData,
      checkInCode: result.checkInCode || '',
      checkInPoints: result.checkInPoints || 0,
      reviewPoints: result.reviewPoints || 0,
      eventInfo: result.eventInfo || '',
      discount: result.discount ?? null,
      discountImageURL: result.discountImageURL || null,
      brandDescription: result.brandDescription ?? null,
      categories: result.categories || [],
      location,
      locationId: parseLocationIdFromRow(result as Record<string, unknown>),
      locationName: result.locationName || '',
      timezone: result.timezone ?? null,
      isArchived: result.isArchived || false,
      isHidden: result.isHidden || false,
      $createdAt: result.$createdAt,
      $updatedAt: result.$updatedAt,
    };

    console.log('[database.fetchEventByIdForHistory] Event fetched successfully (including archived/hidden):', event.$id);
    return event;
  } catch (error: any) {
    console.error('[database.fetchEventByIdForHistory] Error fetching event:', error);
    console.error('[database.fetchEventByIdForHistory] Error message:', error?.message);
    console.error('[database.fetchEventByIdForHistory] Error code:', error?.code);
    // Return null instead of throwing for history display
    return null;
  }
};

/**
 * Fetch events by location using the Appwrite Cloud Function
 * Uses the Appwrite Functions service to execute the get-events-by-location function
 */
export const fetchEventsByLocation = async (
  latitude: number,
  longitude: number,
  page: number = 1,
  pageSize: number = 10
): Promise<EventsByLocationResponse> => {
  console.log('[database.fetchEventsByLocation] Fetching events by location:', {
    latitude,
    longitude,
    page,
    pageSize,
  });

  // Validate required parameters
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
    throw new Error('latitude must be a valid number between -90 and 90');
  }
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    throw new Error('longitude must be a valid number between -180 and 180');
  }
  if (typeof page !== 'number' || page < 1) {
    throw new Error('page must be a number greater than or equal to 1');
  }
  if (typeof pageSize !== 'number' || pageSize < 1 || pageSize > 100) {
    throw new Error('pageSize must be a number between 1 and 100');
  }

  const functionId = APPWRITE_EVENTS_FUNCTION_ID || '';


  if (!functionId) {
    throw new Error('APPWRITE_EVENTS_FUNCTION_ID must be configured. Please check your .env file.');
  }

  try {
    // Prepare request body
    const requestBody = {
      latitude,
      longitude,
      page,
      pageSize,
    };

    console.log('[database.fetchEventsByLocation] Executing function:', functionId);

    // Execute the function using Appwrite Functions service
    // async: false means we wait for the response synchronously
    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify(requestBody),
      method: ExecutionMethod.POST,
      xpath: '/get-events-by-location',
      headers: {
        'Content-Type': 'application/json',
      },
      async: false, // Synchronous execution to get response immediately

    });

    console.log('[database.fetchEventsByLocation] Execution status:', execution.status);
    console.log('[database.fetchEventsByLocation] Response status code:', execution.responseStatusCode);

    // Check if execution was successful
    if (execution.status === 'failed') {
      let errorMessage = 'Function execution failed';
      // Try to parse error message from response body if available
      if (execution.responseBody) {
        try {
          const errorResponse = JSON.parse(execution.responseBody);
          errorMessage = errorResponse.error || errorResponse.message || execution.responseBody;
        } catch {
          errorMessage = execution.responseBody;
        }
      }
      console.error('[database.fetchEventsByLocation] Function execution failed:', errorMessage);
      throw new Error(`Function execution failed: ${errorMessage}`);
    }

    // Parse the response body
    if (!execution.responseBody) {
      throw new Error('Function execution returned empty response body');
    }

    let result: EventsByLocationResponse;
    try {
      result = JSON.parse(execution.responseBody);
    } catch (parseError) {
      console.error('[database.fetchEventsByLocation] Failed to parse response body:', execution.responseBody);
      throw new Error('Invalid JSON response from function');
    }

    // Check HTTP status code after parsing (in case response body contains error details)
    if (execution.responseStatusCode && execution.responseStatusCode >= 400) {
      const errorMessage = result.error || execution.responseBody || `HTTP ${execution.responseStatusCode}`;
      console.error('[database.fetchEventsByLocation] Function returned error status:', {
        statusCode: execution.responseStatusCode,
        body: errorMessage,
      });
      throw new Error(`Function returned error: ${errorMessage}`);
    }

    // Validate response structure
    if (!result.success) {
      console.error('[database.fetchEventsByLocation] API returned error:', result);
      throw new Error(result.error || 'Failed to fetch events');
    }

    if (!result.events || !result.pagination) {
      throw new Error('Invalid API response: missing events or pagination data');
    }

    console.log('[database.fetchEventsByLocation] Events fetched successfully:', {
      count: result.events.length,
      total: result.pagination.total,
      page: result.pagination.page,
      totalPages: result.pagination.totalPages,
    });

    return result;
  } catch (error: any) {
    console.error('[database.fetchEventsByLocation] Error fetching events:', error);
    console.error('[database.fetchEventsByLocation] Error message:', error?.message);
    console.error('[database.fetchEventsByLocation] Error code:', error?.code);
    
    // Re-throw validation errors as-is
    if (error.message?.includes('must be') || error.message?.includes('must be configured')) {
      throw error;
    }
    
    throw new Error(error.message || 'Failed to fetch events by location');
  }
};

/**
 * Upcoming events for a single map pin / store — uses `locationId` only (Mobile API
 * POST /get-events-for-location-id). Paginates until all pages are loaded.
 */
export const fetchEventsForLocationId = async (locationId: string): Promise<EventRow[]> => {
  const trimmed = locationId?.trim();
  if (!trimmed) {
    throw new Error('locationId is required');
  }

  const functionId = APPWRITE_EVENTS_FUNCTION_ID || '';
  if (!functionId) {
    throw new Error('APPWRITE_EVENTS_FUNCTION_ID must be configured. Please check your .env file.');
  }

  const allRows: EventRow[] = [];
  let page = 1;
  const pageSize = 100;

  for (;;) {
    const requestBody = {
      locationId: trimmed,
      page,
      pageSize,
    };

    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify(requestBody),
      method: ExecutionMethod.POST,
      xpath: '/get-events-for-location-id',
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
      throw new Error(`Function execution failed: ${errorMessage}`);
    }

    if (!execution.responseBody) {
      throw new Error('Function execution returned empty response body');
    }

    let result: EventsByLocationResponse;
    try {
      result = JSON.parse(execution.responseBody);
    } catch {
      throw new Error('Invalid JSON response from function');
    }

    if (execution.responseStatusCode && execution.responseStatusCode >= 400) {
      const errorMessage = result.error || execution.responseBody || `HTTP ${execution.responseStatusCode}`;
      throw new Error(`Function returned error: ${errorMessage}`);
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch events for location');
    }

    const docs = result.events || [];
    for (const ev of docs) {
      allRows.push(mapMobileApiEventToEventRow(ev as unknown as Record<string, unknown>));
    }

    const totalPages = result.pagination?.totalPages ?? 1;
    if (page >= totalPages) {
      break;
    }
    page += 1;
  }

  console.log('[database.fetchEventsForLocationId] Loaded events:', {
    locationId: trimmed,
    count: allRows.length,
  });

  return allRows;
};

