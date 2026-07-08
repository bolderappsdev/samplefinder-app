import { EventRow, ClientData, CategoryData } from '@/lib/database';
import { BrandDetailsData } from '@/screens/brand-details';
import { CalendarEventDetail } from '@/screens/tabs/calendar/components';
import {
  formatEventDate,
  formatEventTime,
  parseProducts,
  formatEventDistance,
  isEventTodayOrLater,
  getEventCalendarAnchorDate,
  abbreviateState,
} from './formatters';
import { Colors } from '@/constants/Colors';
import { NewBrandData } from '@/screens/tabs/favorites/components';

/**
 * Filters events based on user's adult status and category adult flags
 * If user is not an adult, filters out events that have any category with isAdult = true
 * @param events - Array of events to filter
 * @param categories - Array of all categories (needed to check isAdult flag)
 * @param userIsAdult - Whether the current user is an adult
 * @returns Filtered array of events
 */
export const filterEventsByAdultCategories = (
  events: EventRow[],
  categories: CategoryData[],
  userIsAdult: boolean
): EventRow[] => {
  console.log('[filterEventsByAdultCategories] Starting filter:', {
    eventsCount: events.length,
    categoriesCount: categories.length,
    userIsAdult,
  });

  // If user is an adult, return all events
  if (userIsAdult) {
    console.log('[filterEventsByAdultCategories] User is adult, returning all events');
    return events;
  }

  // Create a Set of adult category IDs for quick lookup
  const adultCategories = categories.filter((cat) => cat.isAdult === true);
  const adultCategoryIds = new Set(adultCategories.map((cat) => cat.$id));
  
  console.log('[filterEventsByAdultCategories] Adult categories:', {
    count: adultCategories.length,
    names: adultCategories.map(c => c.name),
    ids: Array.from(adultCategoryIds),
  });

  // If there are no adult categories, return all events
  if (adultCategoryIds.size === 0) {
    console.log('[filterEventsByAdultCategories] No adult categories found, returning all events');
    return events;
  }

  // Log event categories for debugging
  events.forEach((event, index) => {
    console.log(`[filterEventsByAdultCategories] Event ${index} (${event.name}):`, {
      categories: event.categories,
      categoriesType: typeof event.categories,
      isArray: Array.isArray(event.categories),
    });
  });

  // Filter out events that have any adult category
  const filteredEvents = events.filter((event) => {
    // Normalize event categories to an array
    let eventCategories: any[] = [];
    
    if (Array.isArray(event.categories)) {
      eventCategories = event.categories;
    } else if (typeof event.categories === 'string') {
      // Single category ID as string
      eventCategories = [event.categories];
    } else if (event.categories && typeof event.categories === 'object') {
      // Single category object or other object format
      eventCategories = [event.categories];
    }
    
    // Handle both category ID strings and category objects
    const hasAdultCategory = eventCategories.some((cat: any) => {
      // If cat is an object with $id, use that
      const catId = typeof cat === 'object' && cat?.$id ? cat.$id : cat;
      return adultCategoryIds.has(catId);
    });
    
    if (hasAdultCategory) {
      console.log(`[filterEventsByAdultCategories] Filtering out event: ${event.name} (has adult category)`);
    }
    
    return !hasAdultCategory;
  });

  console.log('[filterEventsByAdultCategories] Filtering complete:', {
    before: events.length,
    after: filteredEvents.length,
    removed: events.length - filteredEvents.length,
  });

  return filteredEvents;
};

/**
 * Converts EventRow + ClientData to BrandDetailsData format
 */
export const convertEventToBrandDetails = (
  event: EventRow,
  client: ClientData | null
): BrandDetailsData => {
  const formattedDate = formatEventDate(event.startTime || event.date, event.timezone);
  const formattedTime = formatEventTime(event.startTime, event.endTime, event.timezone);
  
  // Parse products string to array
  const products = parseProducts(event.products);
  
  // Event name for detail subtitle
  const storeName = event.name || 'Event';
  
  // Get address components from event and client
  const address = {
    street: event.address || client?.street || '',
    city: event.city || client?.city || '',
    state: abbreviateState(event.state || client?.state || ''),
    zip: event.zipCode || client?.zip || client?.zipCode || '',
  };
  
  // Brand name should come from client
  const brandName = client?.name || client?.title || 'Brand';
  
  // Get client ID for favorites
  const clientId = client?.$id || '';
  
  // Prefer client's brand description (from clients table) over event-level brandDescription
  const brandDescription =
    (client?.description ?? client?.brandDescription) ?? event.brandDescription ?? null;

  // Create BrandDetailsData
  const locationName =
    typeof event.locationName === 'string' && event.locationName.trim()
      ? event.locationName.trim()
      : null;

  const brandDetails: BrandDetailsData = {
    id: event.$id,
    clientId, // Brand/Client ID for favorites
    brandName,
    storeName,
    date: formattedDate,
    time: formattedTime,
    locationName,
    address,
    products,
    eventInfo: event.eventInfo || '',
    discountMessage: undefined, // Will be populated from database when available
    discount: event.discount ?? null,
    discountImageURL: event.discountImageURL || null,
    brandDescription,
  };
  
  return brandDetails;
};

/**
 * Converts EventRow + ClientData to CalendarEventDetail format
 * Used for calendar and event list displays
 */
export const convertEventToCalendarEventDetail = (
  event: EventRow,
  client: ClientData | null,
  userLocation?: { latitude: number; longitude: number }
): CalendarEventDetail => {
  const formattedTime = formatEventTime(event.startTime, event.endTime, event.timezone);

  // Second listing line is the store/location name, not the brand or event title.
  const location = (event.locationName || '').trim() || (event.city || '').trim();
  
  // Calculate distance if user location is provided (location is now on event, not client)
  const distance = formatEventDistance({
    userLocation,
    eventCoordinates: event.location 
      ? { 
          latitude: event.location[1],
          longitude: event.location[0]
        }
      : undefined
  });
  
  // Brand name should come from client
  const brandName = client?.name || client?.title || 'Brand';
  
  // Generate logo from brand name
  const logoText = brandName
    .split(' ')
    .map((word) => word.substring(0, 4).toUpperCase())
    .slice(0, 2)
    .join('\n');
  
  // Generate a color based on brand name hash (consistent color per brand)
  const hash = brandName.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const colors = [
    Colors.orangeBA,
    Colors.brandBlueBright,
    '#8B4513', // Brown
    Colors.black,
    '#228B22', // Green
    Colors.brandPurpleDeep,
  ];
  const backgroundColor = colors[Math.abs(hash) % colors.length];
  
  // Determine text color based on background
  const isLightColor = backgroundColor === Colors.white || backgroundColor === '#FFD700';
  const textColor = isLightColor ? Colors.brandBlueBright : Colors.white;
  
  const logo = {
    backgroundColor,
    text: logoText,
    textColor: backgroundColor === Colors.white ? Colors.brandBlueBright : undefined,
  };
  
  // Get logo URL - use brand logo from client
  const logoURL = client?.logoURL || null;

  return {
    id: event.$id,
    date: getEventCalendarAnchorDate(event.startTime || event.date, event.timezone),
    name: event.name || 'Event',
    brandName: brandName,
    location,             // Store/location name (event.locationName), falls back to city
    distance,
    time: formattedTime,
    timezone: event.timezone ?? null,
    startTime: event.startTime ? new Date(event.startTime) : undefined,
    endTime: event.endTime ? new Date(event.endTime) : undefined,
    logoURL,
    logo,
  };
};

/**
 * Fetches client data from event's client relationship
 * Helper function to extract ClientData from event.client
 */
export const extractClientFromEvent = (event: EventRow): ClientData | null => {
  if (!event.client) return null;
  
  // Handle both relationship object format and direct client data
  const clientObj = typeof event.client === 'string' 
    ? null 
    : event.client;
  
  if (!clientObj) return null;
  
  // Extract location from point field
  let location: [number, number] | undefined;
  if (clientObj.location) {
    if (Array.isArray(clientObj.location) && clientObj.location.length >= 2) {
      location = [clientObj.location[0], clientObj.location[1]];
    } else if (clientObj.location.coordinates && Array.isArray(clientObj.location.coordinates) && clientObj.location.coordinates.length >= 2) {
      location = [clientObj.location.coordinates[0], clientObj.location.coordinates[1]];
    }
  }
  
  return {
    $id: clientObj.$id || '',
    name: clientObj.name || clientObj.title || '',
    title: clientObj.title || clientObj.name || '',
    location,
    street: clientObj.address || clientObj.street || clientObj.address?.street || '',
    city: clientObj.city || clientObj.address?.city || '',
    state: clientObj.state || clientObj.address?.state || '',
    zip: clientObj.zip || clientObj.zipCode || clientObj.address?.zip || '',
    $createdAt: clientObj.$createdAt,
    $updatedAt: clientObj.$updatedAt,
    ...clientObj,
  };
};

/**
 * Converts clients to brand data with product types from their events
 * Returns brands sorted by creation date (oldest first)
 * Each brand includes all unique product types from its events
 */
export const convertClientsToBrands = (
  clients: ClientData[],
  events: EventRow[]
): Omit<NewBrandData, 'isFavorited'>[] => {
  // Group events by client ID to efficiently get product types per client
  const eventsByClientId = new Map<string, EventRow[]>();
  
  events.forEach((event) => {
    const clientId = typeof event.client === 'string' 
      ? event.client 
      : event.client?.$id;
    
    if (clientId) {
      if (!eventsByClientId.has(clientId)) {
        eventsByClientId.set(clientId, []);
      }
      eventsByClientId.get(clientId)!.push(event);
    }
  });

  // Convert clients to brand data format
  const brands: Omit<NewBrandData, 'isFavorited'>[] = clients
    .map((client) => {
      const clientName = client.name || client.title || 'Brand';
      const clientId = client.$id;
      
      // Get all events from this client
      const clientEvents = eventsByClientId.get(clientId) || [];
      const productTypesSet = new Set<string>();
      
      // Prefer client's brand description (from clients table), then event-level brandDescription
      const sortedEvents = clientEvents.sort((a, b) => new Date(a.startTime || a.date).getTime() - new Date(b.startTime || b.date).getTime());
      const upcomingEvents = sortedEvents.filter((event) =>
        isEventTodayOrLater(event.startTime || event.date, event.timezone)
      );
      const mostRelevantEvent = upcomingEvents.length > 0 ? upcomingEvents[0] : sortedEvents[sortedEvents.length - 1];
      const eventBrandDescription = mostRelevantEvent?.brandDescription || null;
      const description =
        (client.description ?? client.brandDescription) ?? eventBrandDescription ?? '';

      clientEvents.forEach((event) => {
        const products = parseProducts(event.products || '');
        products.forEach((product) => {
          if (product && product.trim()) {
            productTypesSet.add(product.trim());
          }
        });
      });

      return {
        id: clientId, // Use client ID as brand ID
        brandName: clientName,
        description,
        productTypes: Array.from(productTypesSet).sort(),
        createdAt: client.$createdAt || new Date().toISOString(),
        logoURL: client.logoURL || null, // Get logoURL from client
      };
    })
    .sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateA - dateB; // Sort ascending (oldest first)
    });

  return brands;
};

