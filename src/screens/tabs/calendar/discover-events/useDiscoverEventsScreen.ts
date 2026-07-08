import { useState, useEffect, useCallback } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import * as Location from 'expo-location';
import { fetchAllUpcomingEvents, EventRow, fetchClients, ClientData, fetchCategories, CategoryData, getUserProfile } from '@/lib/database';
import { convertEventToCalendarEventDetail, extractClientFromEvent, filterEventsByAdultCategories } from '@/utils/brandUtils';
import { formatEventTime, formatEventDate, formatEventDistance, isEventUpcoming } from '@/utils/formatters';
import { TabParamList } from '@/navigation/TabNavigator';
import { CalendarStackParamList } from '@/navigation/CalendarStack';
import { UnifiedEvent } from '@/components';
import { useCalendarEventsStore } from '@/stores/calendarEventsStore';
import { useAuthStore } from '@/stores/authStore';

interface EventWithClient {
  event: EventRow;
  client: ClientData | null;
  eventName: string;
  brandName: string;
  location: string;
  distance: string;
  time: string;
  date: Date;
  logoURL: string | null;
}

type DiscoverEventsNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CalendarStackParamList, 'CalendarMain'>,
  BottomTabNavigationProp<TabParamList, 'Calendar'>
>;

export const useDiscoverEventsScreen = () => {
  const navigation = useNavigation<DiscoverEventsNavigationProp>();
  const [events, setEvents] = useState<EventWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [categories, setCategories] = useState<CategoryData[] | null>(null); // null = not loaded yet
  const [userIsAdult, setUserIsAdult] = useState<boolean>(false);
  
  // Subscribe to saved events from store to trigger re-renders
  const savedEvents = useCalendarEventsStore((state) => state.savedEvents);

  // Load user profile and categories for adult filtering
  useEffect(() => {
    const loadUserAndCategories = async () => {
      try {
        // Load user profile to check isAdult status
        const user = useAuthStore.getState().user;
        if (user?.$id) {
          const profile = await getUserProfile(user.$id);
          setUserIsAdult(profile?.isAdult || false);
        }
        
        // Load all categories (we need all to check which are adult)
        const allCategories = await fetchCategories(true); // Pass true to get all categories including adult ones
        setCategories(allCategories);
      } catch (error) {
        console.error('Error loading user profile or categories:', error);
        setUserIsAdult(false);
        setCategories([]); // Empty array means loaded but no categories
      }
    };

    loadUserAndCategories();
  }, []);

  useEffect(() => {
    const getCurrentLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch (error) {
        console.error('Error getting location:', error);
      }
    };

    getCurrentLocation();
  }, []);

  // Refetch events when Discover screen gains focus so admin changes appear without app restart
  useFocusEffect(
    useCallback(() => {
      setRefreshTrigger((prev) => prev + 1);
    }, [])
  );

  useEffect(() => {
    // Wait until categories are loaded before fetching events
    if (categories === null) {
      return;
    }

    const loadEvents = async () => {
      try {
        if (!isRefreshing) {
          setIsLoading(true);
        }
        setError(null);

        const [eventRows, allClients] = await Promise.all([
          fetchAllUpcomingEvents(),
          fetchClients(),
        ]);

        // Filter events based on user's adult status and category adult flags
        const eventsFilteredByAdult = filterEventsByAdultCategories(eventRows, categories, userIsAdult);

        // Only show upcoming events (not past dates, and not today's events that have already ended)
        const upcomingEventRows = eventsFilteredByAdult.filter(isEventUpcoming);

        // Get user's saved event IDs from store to filter them out
        const savedEventIds = useCalendarEventsStore.getState().savedEvents.map((e) => e.eventId);

        // Filter out events that user has already added to their calendar
        const availableEventRows = upcomingEventRows.filter((event) => !savedEventIds.includes(event.$id));

        const eventsWithClient: EventWithClient[] = availableEventRows.map((event: EventRow) => {
          let client: ClientData | null = extractClientFromEvent(event);

          if (!client && event.client) {
            const clientId = typeof event.client === 'string' ? event.client : event.client.$id;
            if (clientId) {
              client = allClients.find((c) => c.$id === clientId) || null;
            }
          }

          // Brand name should come from client
          const brandName = client?.name || client?.title || 'Brand';
          // Event name should come from event.name
          const eventName = event.name || 'Event';
          // Second listing line is the store/location name, not the brand or event title.
          const location = (event.locationName || '').trim() || (event.city || '').trim();

          // Use event.location for distance calculation (location moved from brand to event)
          const distance = formatEventDistance({
            userLocation: userLocation || undefined,
            eventCoordinates: event.location 
              ? { latitude: event.location[1], longitude: event.location[0] }
              : undefined
          });

          const time = formatEventTime(event.startTime, event.endTime, event.timezone);
          const logoURL = client?.logoURL || null; // Brand logo from client

          return {
            event,
            client,
            eventName,
            brandName,
            location,
            distance,
            time,
            date: new Date(event.startTime || event.date),
            logoURL,
          };
        });

        eventsWithClient.sort((a, b) => {
          return a.date.getTime() - b.date.getTime();
        });

        setEvents(eventsWithClient);
      } catch (err: any) {
        console.error('Error loading events:', err);
        setError(err.message || 'Failed to load events');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    loadEvents();
  }, [userLocation, savedEvents, refreshTrigger, categories, userIsAdult]);

  const handleEventPress = (eventId: string) => {
    navigation.navigate('BrandDetails', { eventId });
  };

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshTrigger((prev) => prev + 1);
  };

  const calendarEvents: UnifiedEvent[] = events.map((eventWithClient) => ({
    id: eventWithClient.event.$id,
    date: formatEventDate(
      eventWithClient.event.startTime || eventWithClient.event.date,
      eventWithClient.event.timezone
    ),
    name: eventWithClient.eventName,
    brandName: eventWithClient.brandName,
    location: eventWithClient.location,
    distance: eventWithClient.distance,
    time: eventWithClient.time,
    logoURL: eventWithClient.logoURL,
  }));

  const handleGoBack = () => {
    navigation.goBack();
  };

  return {
    calendarEvents,
    isLoading,
    isRefreshing,
    error,
    handleEventPress,
    handleRetry,
    handleRefresh,
    handleGoBack,
  };
};

