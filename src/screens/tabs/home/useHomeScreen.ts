import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { PROVIDER_GOOGLE } from 'react-native-maps';
import ClusteredMapView from 'react-native-map-clustering';
import * as Location from 'expo-location';
import { fetchClients, fetchClientsWithFilters, ClientData, EventRow, fetchCategories, CategoryData, fetchAllUpcomingEvents, getUserProfile, fetchLocations, LocationRow, fetchEventsForLocationId } from '@/lib/database';
import { useAuthStore } from '@/stores/authStore';
import { MapMarkerData, FilterType, EventData, StoreData, FilterButtonLayout, MeasureCallback } from './components';
import { formatEventDate, formatEventTime, formatEventDistance, isEventUpcoming, calculateDistance, abbreviateState } from '@/utils/formatters';
import { geocodeLocation, isValidLocationInput } from '@/utils/geocoding';
import { filterEventsByAdultCategories } from '@/utils/brandUtils';

let hasAutoShownZipModalThisSession = false;
const MAX_EVENT_RADIUS_MILES = 50;
const METERS_PER_MILE = 1609.34;
/** Tight zoom so adjacent venues are visually separated before opening the store modal */
const MARKER_FOCUS_DELTA = 0.001;
const MAP_ANIMATION_DURATION_MS = 500;

export const useHomeScreen = () => {
  const [selectedFilter, setSelectedFilter] = useState<FilterType | null>(null);
  const [filterButtonLayout, setFilterButtonLayout] = useState<FilterButtonLayout | undefined>(undefined);
  const pendingFilterRef = useRef<{ filter: FilterType; measureFn: MeasureCallback } | null>(null);
  const [radiusValues, setRadiusValues] = useState<string[]>([]);
  const [datesValues, setDatesValues] = useState<string[]>([]);
  const [categoriesValues, setCategoriesValues] = useState<string[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]); // Categories for UI filter (filtered by user's adult status)
  const [allCategoriesForFilter, setAllCategoriesForFilter] = useState<CategoryData[] | null>(null); // null = not loaded yet, All categories for adult event filtering
  const [isLoadingCategories, setIsLoadingCategories] = useState(true); // Start as true since we load on mount
  const [selectedStore, setSelectedStore] = useState<StoreData | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [events, setEvents] = useState<EventData[]>([]);
  const [isShowingNearbySuggestions, setIsShowingNearbySuggestions] = useState(false);
  const [isLoadingUpcomingEvents, setIsLoadingUpcomingEvents] = useState(false);
  const [isRefreshingEvents, setIsRefreshingEvents] = useState(false);
  const [refreshEventsTrigger, setRefreshEventsTrigger] = useState(0);
  const [allClients, setAllClients] = useState<ClientData[]>([]);
  const [markers, setMarkers] = useState<MapMarkerData[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [isMapWithoutLocation, setIsMapWithoutLocation] = useState(false);
  const [showZipCodeModal, setShowZipCodeModal] = useState(false);
  const [isGeocodingZip, setIsGeocodingZip] = useState(false);
  const [zipCodeError, setZipCodeError] = useState<string | null>(null);
  const [bottomSheetIndex, setBottomSheetIndex] = useState(1);
  const [activeView, setActiveView] = useState<'map' | 'list'>('list');
  const [isMapInitialized, setIsMapInitialized] = useState(false);
  const [userIsAdult, setUserIsAdult] = useState<boolean>(false);
  const bottomSheetRef = useRef<any>(null);
  const mapRef = useRef<ClusteredMapView>(null);
  /** Supersedes stale async work when the user taps another pin before zoom/fetch finishes */
  const markerPressGenerationRef = useRef(0);

  const showZipModalOncePerSession = useCallback(() => {
    if (hasAutoShownZipModalThisSession) return;
    hasAutoShownZipModalThisSession = true;
    setShowZipCodeModal(true);
  }, []);

  const openZipCodeModalManually = useCallback(() => {
    setShowZipCodeModal(true);
  }, []);

  // Snap points for the bottom sheet - collapsed shows only filters, expanded shows events + filters
  const snapPoints = useMemo(() => ['12%', '76%'], []);

  // Ensure bottom sheet opens at index 1 (expanded) on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (bottomSheetRef.current) {
        bottomSheetRef.current.snapToIndex(1);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Helper function to convert date filter values to date ranges
  const convertDateFilterToRange = (dateValue: string): { start: string; end: string } | null => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (dateValue) {
      case 'today':
        return {
          start: new Date(today.getTime()).toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
        };
      case '3days':
        return {
          start: new Date(today.getTime()).toISOString(),
          end: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        };
      case '5days':
        return {
          start: new Date(today.getTime()).toISOString(),
          end: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        };
      case 'week':
        // Calculate next week: start from next Monday (or the Monday after today)
        const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const daysUntilNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
        const nextMonday = new Date(today.getTime() + daysUntilNextMonday * 24 * 60 * 60 * 1000);
        const nextSunday = new Date(nextMonday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
        
        return {
          start: nextMonday.toISOString(),
          end: nextSunday.toISOString(),
        };
      case 'all':
        return null; // No date filter
      default:
        return null;
    }
  };

  const resolveLocation = useCallback(async () => {
    try {
      // Check current status first
      const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();

      // On iOS, denied + cannot ask again means the system prompt will not reappear.
      // On Android, this combination can still occur in "ask every time" style flows,
      // so we still attempt a request below to let the OS decide.
      const shouldFallbackToZipImmediately =
        Platform.OS === 'ios' && status === 'denied' && canAskAgain === false;

      if (shouldFallbackToZipImmediately) {
        setHasLocationPermission(false);
        showZipModalOncePerSession();
        return;
      }

      // Android "Ask every time" may report transient granted/denied states across app resumes.
      // Always request on Android to let the OS decide whether to show the permission prompt.
      // On iOS, request only when not currently granted.
      const shouldRequestPermission = Platform.OS === 'android' || status !== 'granted';
      if (shouldRequestPermission) {
        const { status: requestedStatus } = await Location.requestForegroundPermissionsAsync();

        if (requestedStatus !== 'granted') {
          setHasLocationPermission(false);
          showZipModalOncePerSession();
          return;
        }
      }

      setHasLocationPermission(true);
      setIsMapWithoutLocation(false);

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10000,
        distanceInterval: 10,
      });

      const userCoords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setUserLocation(userCoords);

      setTimeout(() => {
        if (mapRef.current && userCoords) {
          (mapRef.current as any).animateToRegion(
            {
              ...userCoords,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            },
            1000
          );
        }
      }, 500);
    } catch (error) {
      console.error('Error getting location:', error);
      setHasLocationPermission(false);
      showZipModalOncePerSession();
    }
  }, [showZipModalOncePerSession]);

  useEffect(() => {
    resolveLocation();
  }, [resolveLocation]);

  // Re-check when Home gains focus - ensures permission dialog/ZIP modal logic is reapplied if needed
  useFocusEffect(
    useCallback(() => {
      resolveLocation();
    }, [resolveLocation])
  );

  // Refetch events when Home tab gains focus so admin changes (create/edit/hide/archive) appear without app restart
  useFocusEffect(
    useCallback(() => {
      setRefreshEventsTrigger((prev) => prev + 1);
    }, [])
  );

  const handleZipCodeChange = () => {
    if (zipCodeError) {
      setZipCodeError(null);
    }
  };

  const handleZipCodeDismiss = useCallback(() => {
    setShowZipCodeModal(false);
    setZipCodeError(null);
    setIsMapWithoutLocation(true);
  }, []);

  const handleZipCodeSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!isValidLocationInput(trimmed)) {
      setZipCodeError('Please enter a city, address, or ZIP code.');
      return;
    }

    setIsGeocodingZip(true);
    setZipCodeError(null);

    try {
      const result = await geocodeLocation(trimmed);
      
      const userCoords = {
        latitude: result.latitude,
        longitude: result.longitude,
      };

      setUserLocation(userCoords);
      setIsMapWithoutLocation(false);
      setHasLocationPermission(false); // Still false since we don't have actual permission
      setShowZipCodeModal(false);

      // Animate map to the ZIP code location
      setTimeout(() => {
        if (mapRef.current && userCoords) {
          (mapRef.current as any).animateToRegion(
            {
              ...userCoords,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            },
            1000
          );
        }
      }, 500);
    } catch (error: any) {
      console.error('Error geocoding ZIP code:', error);
      setZipCodeError(error.message || 'Failed to find location. Please try again.');
    } finally {
      setIsGeocodingZip(false);
    }
  };

  useEffect(() => {
    const loadClients = async () => {
      try {
        if (!isMapInitialized) {
          setIsLoadingClients(true);
        }

        const hasFilters = radiusValues.length > 0 || datesValues.length > 0 || categoriesValues.length > 0;

        if (hasFilters) {
          const filters: any = {};

          if (radiusValues.length > 0 && userLocation) {
            const maxRadius = Math.max(...radiusValues.map(v => parseFloat(v)));
            filters.radiusMiles = maxRadius;
            filters.userLocation = userLocation;
          }

          if (datesValues.length > 0) {
            // Convert all selected date filters to ranges
            const dateRanges = datesValues
              .map(value => convertDateFilterToRange(value))
              .filter((range): range is { start: string; end: string } => range !== null);
            
            if (dateRanges.length > 0) {
              // Find the earliest start and latest end to create a combined range
              const allStarts = dateRanges.map(r => new Date(r.start).getTime());
              const allEnds = dateRanges.map(r => new Date(r.end).getTime());
              filters.dateRange = {
                start: new Date(Math.min(...allStarts)).toISOString(),
                end: new Date(Math.max(...allEnds)).toISOString(),
              };
            }
          }

          if (categoriesValues.length > 0 && categories.length > 0) {
            const selectedCategoryIds = categories
              .filter((cat) => {
                const catValue = cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-');
                return categoriesValues.includes(catValue);
              })
              .map((cat) => cat.$id);

            if (selectedCategoryIds.length > 0) {
              filters.categoryIds = selectedCategoryIds;
            }
          }

          const clients = await fetchClientsWithFilters(filters);
          setAllClients(clients);
        } else {
          const clients = await fetchClients();
          setAllClients(clients);
        }
      } catch (error) {
        console.error('Error loading clients:', error);
        setAllClients([]);
      } finally {
        setIsLoadingClients(false);
        setIsMapInitialized(true);
      }
    };

    const timeoutId = setTimeout(() => {
      loadClients();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [radiusValues, datesValues, categoriesValues, categories, userLocation, isMapInitialized]);

  // State for all upcoming events (for counting events at locations)
  const [allUpcomingEvents, setAllUpcomingEvents] = useState<EventRow[]>([]);

  // State for all locations
  const [allLocations, setAllLocations] = useState<LocationRow[]>([]);

  /** Prefer event.location; if missing, resolve from locations table via event.locationId (for distance / radius). */
  const getEventMapCoordinates = useCallback((event: EventRow): { latitude: number; longitude: number } | null => {
    if (event.location && event.location.length >= 2) {
      return { latitude: event.location[1], longitude: event.location[0] };
    }
    const lid = event.locationId?.trim();
    if (!lid) return null;
    const loc = allLocations.find((l) => l.$id === lid);
    if (loc?.location && loc.location.length >= 2) {
      return { latitude: loc.location[1], longitude: loc.location[0] };
    }
    return null;
  }, [allLocations]);

  // Fetch all locations for map markers (refetch on focus/refresh so new locations appear without app restart)
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const locations = await fetchLocations();
        console.log('[HomeScreen] Locations fetched:', locations.length);
        setAllLocations(locations);
      } catch (error) {
        console.error('Error loading locations:', error);
        setAllLocations([]);
      }
    };

    loadLocations();
  }, [refreshEventsTrigger]);

  // Fetch all upcoming events for map pins (filtered by adult categories); refetch on focus/refresh so pins update in real time
  useEffect(() => {
    // Only load events after all categories are loaded
    if (allCategoriesForFilter === null) {
      return;
    }

    const loadUpcomingEventsForMap = async () => {
      try {
        const eventRows = await fetchAllUpcomingEvents();
        // Filter events based on user's adult status and category adult flags
        const filteredByAdult = filterEventsByAdultCategories(eventRows, allCategoriesForFilter, userIsAdult);
        // Only keep upcoming events (not past dates, and not today's events that have already ended)
        const activeEvents = filteredByAdult.filter(isEventUpcoming);
        console.log('[HomeScreen] Events for map filtered:', {
          before: eventRows.length,
          afterAdultFilter: filteredByAdult.length,
          afterScheduleFilter: activeEvents.length,
          userIsAdult,
        });
        setAllUpcomingEvents(activeEvents);
      } catch (error) {
        console.error('Error loading events for map:', error);
        setAllUpcomingEvents([]);
      }
    };

    loadUpcomingEventsForMap();
  }, [allCategoriesForFilter, userIsAdult, refreshEventsTrigger]);

  // Create map markers from locations (only locations with Active/Scheduled events)
  useEffect(() => {
    const locationMarkers: MapMarkerData[] = allLocations
      .filter((location) => {
        // Filter locations with valid coordinates
        return (
          location.location &&
          Array.isArray(location.location) &&
          location.location.length >= 2 &&
          !isNaN(location.location[0]) &&
          !isNaN(location.location[1]) &&
          location.location[0] !== 0 &&
          location.location[1] !== 0
        );
      })
      .map((location) => {
        // Count upcoming events linked to this location row via event.locationId
        const eventsAtLocation = allUpcomingEvents.filter((event) =>
          isEventAtLocation(event, location)
        );

        return {
          id: location.$id,
          latitude: location.location[1],
          longitude: location.location[0],
          title: location.name,
          icon: 'oi:map-marker',
          address: {
            street: location.address || '',
            city: location.city || '',
            state: abbreviateState(location.state || ''),
            zip: location.zipCode || '',
          },
          events: eventsAtLocation.map(e => e.$id), // Store event IDs for lookup
        };
      })
      .filter((marker) => marker.events.length > 0); // Only show pins for locations with Active/Scheduled events

    setMarkers(locationMarkers);
  }, [allLocations, allUpcomingEvents]);

  const visibleMarkers = useMemo(
    () => (isMapWithoutLocation ? [] : markers),
    [isMapWithoutLocation, markers]
  );

  // Fetch user profile to check isAdult field
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const user = useAuthStore.getState().user;
        console.log('[HomeScreen] Current user:', user?.$id);
        if (user?.$id) {
          const profile = await getUserProfile(user.$id);
          console.log('[HomeScreen] User profile fetched:', {
            profileId: profile?.$id,
            isAdult: profile?.isAdult,
            username: profile?.username
          });
          setUserIsAdult(profile?.isAdult || false);
        } else {
          console.log('[HomeScreen] No current user found');
          setUserIsAdult(false);
        }
      } catch (error) {
        console.error('[HomeScreen] Error loading user profile:', error);
        setUserIsAdult(false);
      }
    };

    loadUserProfile();
  }, []);

  // Load categories based on user's isAdult status
  useEffect(() => {
    const loadCategories = async () => {
      try {
        setIsLoadingCategories(true);
        console.log('[HomeScreen] Loading categories with userIsAdult:', userIsAdult);
        
        // Load ALL categories for adult event filtering (pass true to include adult categories)
        const allCategories = await fetchCategories(true);
        setAllCategoriesForFilter(allCategories);
        console.log('[HomeScreen] All categories for filter:', {
          count: allCategories.length,
          adultCategories: allCategories.filter(c => c.isAdult).map(c => c.name)
        });
        
        // Filter categories for UI based on user's adult status
        const uiCategories = userIsAdult 
          ? allCategories 
          : allCategories.filter(c => !c.isAdult);
        
        console.log('[HomeScreen] Categories for UI:', {
          count: uiCategories.length,
          categories: uiCategories.map(c => ({ name: c.name, isAdult: c.isAdult }))
        });
        setCategories(uiCategories);
      } catch (error) {
        console.error('[HomeScreen] Error loading categories:', error);
        setCategories([]);
        setAllCategoriesForFilter([]);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, [userIsAdult]);

  useEffect(() => {
    const loadEvents = async () => {
      // Wait until categories are loaded for adult filtering
      if (allCategoriesForFilter === null) {
        return;
      }

      // Wait for clients to finish loading if filters are active
      const hasCategoryFilter = categoriesValues.length > 0;
      const hasRadiusFilter = radiusValues.length > 0 && !!userLocation;
      const hasActiveFilters = hasCategoryFilter || hasRadiusFilter;
      
      if (hasActiveFilters && isLoadingClients) {
        return;
      }

      try {
        if (!isRefreshingEvents) {
          setIsLoadingUpcomingEvents(true);
        }

        // Fetch all upcoming events and clients in parallel
        const [eventRows, allClientsData] = await Promise.all([
          fetchAllUpcomingEvents(),
          fetchClients(),
        ]);

        if (!eventRows || eventRows.length === 0) {
          setEvents([]);
          setIsShowingNearbySuggestions(false);
          return;
        }

        // Filter events based on user's adult status and category adult flags
        const eventsFilteredByAdult = filterEventsByAdultCategories(eventRows, allCategoriesForFilter, userIsAdult);
        // Only keep upcoming events (not past dates, and not today's events that have already ended)
        const eventsActiveNow = eventsFilteredByAdult.filter(isEventUpcoming);
        console.log('[HomeScreen] Events list filtered by adult:', {
          before: eventRows.length,
          afterAdultFilter: eventsFilteredByAdult.length,
          afterScheduleFilter: eventsActiveNow.length,
          userIsAdult,
          adultCategoriesCount: allCategoriesForFilter.filter(c => c.isAdult).length
        });

        // Create a map for quick client lookup by ID
        const clientsMap = new Map(allClientsData.map(client => [client.$id, client]));
        
        // Debug: Log client data to check if logoURL exists
        console.log('[HomeScreen] Loaded clients:', allClientsData.length);
        if (allClientsData.length > 0) {
          console.log('[HomeScreen] Sample client data:', {
            id: allClientsData[0].$id,
            name: allClientsData[0].name,
            hasLogoURL: !!allClientsData[0].logoURL,
            logoURL: allClientsData[0].logoURL,
          });
        }

        let filteredEvents = eventsActiveNow;

        // Apply date filter to events - event must fall within ANY of the selected date ranges
        if (datesValues.length > 0) {
          const dateRanges = datesValues
            .map(value => convertDateFilterToRange(value))
            .filter((range): range is { start: string; end: string } => range !== null);
          
          if (dateRanges.length > 0) {
            filteredEvents = filteredEvents.filter((event) => {
              const eventDate = new Date(event.startTime || event.date);
              // Event passes filter if it falls within ANY of the selected date ranges
              return dateRanges.some(dateRange => {
                const startDate = new Date(dateRange.start);
                const endDate = new Date(dateRange.end);
                return eventDate >= startDate && eventDate <= endDate;
              });
            });
          }
        }

        // Apply radius filter using event geo or locationId-resolved coords
        if (hasRadiusFilter && radiusValues.length > 0 && userLocation) {
          const maxRadiusMiles = Math.min(
            Math.max(...radiusValues.map(v => parseFloat(v))),
            MAX_EVENT_RADIUS_MILES
          );
          const maxRadiusMeters = maxRadiusMiles * METERS_PER_MILE;
          
          filteredEvents = filteredEvents.filter((event) => {
            const coords = getEventMapCoordinates(event);
            if (!coords) return false;
            const distance = calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              coords.latitude,
              coords.longitude
            );
            return distance <= maxRadiusMeters;
          });
        }

        // Apply category filter
        if (hasCategoryFilter && categories.length > 0) {
          const selectedCategoryIds = categories
            .filter((cat) => {
              const catValue = cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-');
              return categoriesValues.includes(catValue);
            })
            .map((cat) => cat.$id);
          
          if (selectedCategoryIds.length > 0) {
            filteredEvents = filteredEvents.filter((event) => {
              // Check if event has any of the selected categories
              const eventCategories = event.categories || [];
              return selectedCategoryIds.some(catId => eventCategories.includes(catId));
            });
          }
        }

        const mapAndSortEventRows = (rows: EventRow[]): EventData[] => {
          const parseDistance = (distanceStr: string): number => {
            if (distanceStr === 'Distance unknown') return 999999;
            const numericValue = parseFloat(distanceStr.replace(/[^\d.]/g, '')) || 999999;
            if (distanceStr.includes('ft')) return numericValue / 5280;
            return numericValue;
          };
          const distanceForRow = (ev: EventRow): string => {
            const coords = getEventMapCoordinates(ev);
            return userLocation && coords
              ? formatEventDistance({
                  userLocation,
                  eventCoordinates: coords,
                })
              : 'Distance unknown';
          };

          // Default list ordering: closest event first so new users see nearby events
          // before they touch the filters (client request: avoid showing hundreds-of-miles
          // events on first load). parseDistance returns 999999 for "Distance unknown",
          // which naturally pushes location-less events (or all events when the device
          // has no userLocation yet) to the end and falls back to date ordering between
          // ties — same date-asc behaviour we had before within a single distance band.
          const sortedRows = [...rows].sort((a, b) => {
            const distA = parseDistance(distanceForRow(a));
            const distB = parseDistance(distanceForRow(b));
            if (distA !== distB) return distA - distB;
            const dateA = new Date(a.startTime || a.date).getTime();
            const dateB = new Date(b.startTime || b.date).getTime();
            return dateA - dateB;
          });

          return sortedRows.map((event) => {
            const formattedTime = formatEventTime(event.startTime, event.endTime, event.timezone);
            const formattedDate = formatEventDate(event.startTime || event.date, event.timezone);
            const formattedDistance = distanceForRow(event);
            const clientId = typeof event.client === 'string' ? event.client : event.client?.$id;
            const clientObj = clientId ? clientsMap.get(clientId) : (typeof event.client === 'object' ? event.client : null);
            const location = clientObj?.name || clientObj?.title || event.city || 'Location';
            const brandName = clientObj?.name || clientObj?.title || 'Brand';
            const eventName = event.name || 'Event';
            return {
              id: event.$id,
              name: eventName,
              brandName: brandName,
              location,
              distance: formattedDistance,
              date: formattedDate,
              time: formattedTime,
              logoURL: clientObj?.logoURL || null,
            };
          });
        };

        const transformedEvents = mapAndSortEventRows(filteredEvents);
        const hasDatesFilter = datesValues.length > 0;
        const hasAnyFilterForFallback = hasCategoryFilter || hasRadiusFilter || hasDatesFilter;

        // When any filter (category, dates, radius) is active but no events match, suggest other upcoming
        // events in the user's area only (50 mi), not the full global list.
        const eventsInAreaForFallback: EventRow[] =
          userLocation != null
            ? eventsActiveNow.filter((event) => {
                const coords = getEventMapCoordinates(event);
                if (!coords) return false;
                const distance = calculateDistance(
                  userLocation.latitude,
                  userLocation.longitude,
                  coords.latitude,
                  coords.longitude
                );
                return distance <= MAX_EVENT_RADIUS_MILES * METERS_PER_MILE;
              })
            : [];

        if (hasAnyFilterForFallback && transformedEvents.length === 0 && eventsInAreaForFallback.length > 0) {
          const nearbyEvents = mapAndSortEventRows(eventsInAreaForFallback);
          setEvents(nearbyEvents);
          setIsShowingNearbySuggestions(true);
        } else {
          setEvents(transformedEvents);
          setIsShowingNearbySuggestions(false);
        }
      } catch (error) {
        console.error('Error loading events:', error);
        setEvents([]);
        setIsShowingNearbySuggestions(false);
      } finally {
        setIsLoadingUpcomingEvents(false);
        setIsRefreshingEvents(false);
      }
    };

    loadEvents();
  }, [userLocation, datesValues, categoriesValues, radiusValues, categories, allCategoriesForFilter, isLoadingClients, refreshEventsTrigger, userIsAdult, getEventMapCoordinates]);

  /** Map pins only include events linked via `locationId` (same locations row). No name or geo matching. */
  const isEventAtLocation = (event: EventRow, location: LocationRow): boolean => {
    const linkedId = event.locationId?.trim();
    return !!linkedId && linkedId === location.$id;
  };

  const initialRegion = useMemo(() => {
    return {
      latitude: 39.9526,
      longitude: -75.1652,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }, []);

  const handleFilterPress = (filter: FilterType, measureFn: MeasureCallback) => {
    if (filter === 'reset') {
      handleResetFilters();
    } else {
      // If bottom sheet is collapsed (index 0), expand it first
      if (bottomSheetIndex === 0) {
        // Store the pending filter and measurement function
        pendingFilterRef.current = { filter, measureFn };
        // Expand the bottom sheet first
        bottomSheetRef.current?.snapToIndex(1);
        // Wait for bottom sheet animation to complete, then measure and show modal
        setTimeout(() => {
          if (pendingFilterRef.current && pendingFilterRef.current.filter === filter) {
            pendingFilterRef.current.measureFn((layout) => {
              setSelectedFilter(filter);
              setFilterButtonLayout(layout);
              pendingFilterRef.current = null;
            });
          }
        }, 350); // Match bottom sheet animation duration + buffer
      } else {
        // Bottom sheet is already expanded, measure and show modal immediately
        measureFn((layout) => {
          // Toggle filter modal - if same filter is pressed, close it
          setSelectedFilter(selectedFilter === filter ? null : filter);
          setFilterButtonLayout(layout);
        });
      }
    }
  };

  const handleCloseFilter = () => {
    setSelectedFilter(null);
  };

  const handleRadiusToggle = (value: string) => {
    // Single-select behavior: only one radius can be selected at a time
    setRadiusValues((prev) =>
      prev.includes(value) ? [] : [value]
    );
    // Keep modal open for user to review selection
  };

  const handleDatesToggle = (value: string) => {
    // "View All" means no filter, so clear all selections
    if (value === 'all') {
      setDatesValues([]);
    } else {
      // Single-select behavior: only one date range can be selected at a time
      setDatesValues((prev) =>
        prev.includes(value) ? [] : [value]
      );
    }
    // Keep modal open for user to review selection
  };

  const handleCategoriesToggle = (value: string) => {
    // "View All" means no filter, so clear all selections
    if (value === 'all') {
      setCategoriesValues([]);
    } else {
      // Multi-select behavior for categories
      setCategoriesValues((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
      );
    }
    // Keep modal open for multi-select
  };

  const handleResetFilters = () => {
    setRadiusValues([]);
    setDatesValues([]);
    setCategoriesValues([]);
    setSelectedFilter(null);
  };

  const focusMapOnMarker = useCallback(
    (latitude: number, longitude: number) =>
      new Promise<void>((resolve) => {
        const map = mapRef.current as { animateToRegion?: (r: object, duration?: number) => void } | null;
        if (map?.animateToRegion) {
          map.animateToRegion(
            {
              latitude,
              longitude,
              latitudeDelta: MARKER_FOCUS_DELTA,
              longitudeDelta: MARKER_FOCUS_DELTA,
            },
            MAP_ANIMATION_DURATION_MS
          );
          setTimeout(resolve, MAP_ANIMATION_DURATION_MS + 50);
        } else {
          resolve();
        }
      }),
    []
  );

  const handleMarkerPress = async (marker: MapMarkerData) => {
    if (!marker.address) {
      return;
    }

    const generation = ++markerPressGenerationRef.current;
    const locationForImmediateModal = allLocations.find((loc) => loc.$id === marker.id);
    const immediateStoreData: StoreData = {
      id: marker.id,
      name: locationForImmediateModal?.name || marker.title || 'Store',
      address: marker.address,
      events: [],
    };

    // Open the modal immediately so taps feel responsive while events load.
    setSelectedStore(immediateStoreData);
    setIsModalVisible(true);
    setIsLoadingEvents(true);

    try {
      await focusMapOnMarker(marker.latitude, marker.longitude);
      if (generation !== markerPressGenerationRef.current) {
        return;
      }

      // Find the location by marker ID
      const location = allLocations.find((loc) => loc.$id === marker.id);

      if (!location) {
        console.log('[handleMarkerPress] Location not found for marker:', marker.id);
        return;
      }

      // Prefer server-side list by locationId (POST /get-events-for-location-id); fallback to local cache
      let locationEvents: EventRow[] = [];
      const cachedLocationEvents = allUpcomingEvents.filter((event) => isEventAtLocation(event, location));
      try {
        const fromApi = await fetchEventsForLocationId(location.$id);
        if (generation !== markerPressGenerationRef.current) {
          return;
        }
        const categoriesForAdult = allCategoriesForFilter ?? [];
        const filteredApiEvents = filterEventsByAdultCategories(fromApi, categoriesForAdult, userIsAdult).filter(
          isEventUpcoming
        );
        // Merge API + cached events to avoid partial API responses hiding valid events at this location.
        const mergedById = new Map<string, EventRow>();
        [...filteredApiEvents, ...cachedLocationEvents].forEach((event) => {
          mergedById.set(event.$id, event);
        });
        locationEvents = Array.from(mergedById.values());
      } catch (err) {
        console.warn('[handleMarkerPress] fetchEventsForLocationId failed, using cached events:', err);
        if (generation !== markerPressGenerationRef.current) {
          return;
        }
        locationEvents = cachedLocationEvents;
      }

      if (generation !== markerPressGenerationRef.current) {
        return;
      }

      // Apply date filter if active
      if (datesValues.length > 0) {
        const dateRanges = datesValues
          .map(value => convertDateFilterToRange(value))
          .filter((range): range is { start: string; end: string } => range !== null);
        
        if (dateRanges.length > 0) {
          locationEvents = locationEvents.filter((event) => {
            const eventDate = new Date(event.startTime || event.date);
            // Event passes filter if it falls within ANY of the selected date ranges
            return dateRanges.some(dateRange => {
              const startDate = new Date(dateRange.start);
              const endDate = new Date(dateRange.end);
              return eventDate >= startDate && eventDate <= endDate;
            });
          });
        }
      }

      // Apply radius filter if active
      if (radiusValues.length > 0 && userLocation) {
          const maxRadiusMiles = Math.min(
            Math.max(...radiusValues.map(v => parseFloat(v))),
            MAX_EVENT_RADIUS_MILES
          );
          const maxRadiusMeters = maxRadiusMiles * METERS_PER_MILE;
        
        locationEvents = locationEvents.filter((event) => {
          const coords = getEventMapCoordinates(event);
          if (!coords) return false;
          const distance = calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            coords.latitude,
            coords.longitude
          );
          return distance <= maxRadiusMeters;
        });
      }

      // Apply category filter if active
      if (categoriesValues.length > 0 && categories.length > 0) {
        const selectedCategoryIds = categories
          .filter((cat) => {
            const catValue = cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-');
            return categoriesValues.includes(catValue);
          })
          .map((cat) => cat.$id);
        
        if (selectedCategoryIds.length > 0) {
          locationEvents = locationEvents.filter((event) => {
            // Check if event has any of the selected categories
            const eventCategories = event.categories || [];
            return selectedCategoryIds.some(catId => eventCategories.includes(catId));
          });
        }
      }
      
      if (locationEvents.length > 0) {
        const sortedLocationEvents = [...locationEvents].sort(
          (a, b) =>
            new Date(a.startTime || a.date).getTime() - new Date(b.startTime || b.date).getTime()
        );
        const eventsData: EventData[] = sortedLocationEvents.map((event) => {
          const formattedTime = formatEventTime(event.startTime, event.endTime, event.timezone);
          const formattedDate = formatEventDate(event.startTime || event.date, event.timezone);

          // Look up client from allClients
          const clientId = typeof event.client === 'string' ? event.client : event.client?.$id;
          const clientObj = clientId ? allClients.find(c => c.$id === clientId) : (typeof event.client === 'object' ? event.client : null);
          const brandName = clientObj?.name || clientObj?.title || 'Brand';
          const eventName = event.name || 'Event';
          
          const coords = getEventMapCoordinates(event);
          const formattedDistance =
            userLocation && coords
              ? formatEventDistance({
                  userLocation,
                  eventCoordinates: coords,
                })
              : 'Distance unknown';

          // Get product types from client
          const productTypes = clientObj?.productType || [];
          
          return {
            id: event.$id,
            name: eventName,
            brandName: brandName,
            location: clientObj?.name || clientObj?.title || event.city || 'Location',
            distance: formattedDistance,
            date: formattedDate,
            time: formattedTime,
            logoURL: clientObj?.logoURL || null,
            productTypes: Array.isArray(productTypes) ? productTypes : [],
          };
        });

        const storeData: StoreData = {
          id: marker.id,
          name: location.name,
          address: marker.address,
          events: eventsData,
        };

        setSelectedStore(storeData);
        setIsModalVisible(true);
      } else {
        // Keep modal open and show the empty events state
        const storeData: StoreData = {
          id: marker.id,
          name: location.name,
          address: marker.address,
          events: [],
        };

        setSelectedStore(storeData);
        setIsModalVisible(true);
      }
    } finally {
      if (generation === markerPressGenerationRef.current) {
        setIsLoadingEvents(false);
      }
    }
  };

  const handleClusterPress = useCallback((cluster: any) => {
    const { geometry } = cluster;
    const coordinate = {
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
    if (mapRef.current) {
      (mapRef.current as any).animateToRegion(
        {
          ...coordinate,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    }
  }, []);

  const renderCluster = useCallback((cluster: any) => {
    const { id, geometry, properties } = cluster;
    const pointCount = properties?.point_count || 0;
    const coordinate = {
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
    return {
      id,
      coordinate,
      pointCount,
    };
  }, [handleClusterPress]);

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setSelectedStore(null);
    setIsLoadingEvents(false);
  };

  const handleListPress = () => {
    setActiveView('list');
    bottomSheetRef.current?.snapToIndex(1);
  };

  const handleMapPress = () => {
    setActiveView('map');
    bottomSheetRef.current?.snapToIndex(0);
  };

  const handleRefreshEvents = () => {
    setIsRefreshingEvents(true);
    setRefreshEventsTrigger((prev) => prev + 1);
  };

  const hasAnyFilters = radiusValues.length > 0 || datesValues.length > 0 || categoriesValues.length > 0;

  return {
    selectedFilter,
    radiusValues,
    datesValues,
    categoriesValues,
    categories,
    allCategoriesForFilter,
    userIsAdult,
    isLoadingCategories,
    selectedStore,
    isModalVisible,
    isLoadingEvents,
    markers: visibleMarkers,
    isLoadingClients,
    userLocation,
    hasLocationPermission,
    showZipCodeModal,
    isGeocodingZip,
    zipCodeError,
    bottomSheetIndex,
    bottomSheetRef,
    mapRef,
    snapPoints,
    initialRegion,
    events,
    isShowingNearbySuggestions,
    hasAnyFilters,
    activeView,
    isRefreshingEvents,
    filterButtonLayout,
    setBottomSheetIndex,
    handleFilterPress,
    handleCloseFilter,
    handleRadiusToggle,
    handleDatesToggle,
    handleCategoriesToggle,
    handleResetFilters,
    handleMarkerPress,
    handleClusterPress,
    renderCluster,
    handleCloseModal,
    handleListPress,
    handleMapPress,
    handleRefreshEvents,
    handleZipCodeSubmit,
    handleZipCodeChange,
    handleZipCodeDismiss,
    openZipCodeModalManually,
  };
};

