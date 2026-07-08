import { useMemo, useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { NewBrandData } from './components';
import { fetchClients, fetchAllEvents, getUserProfile, addFavoriteBrand, removeFavoriteBrand, fetchCategories, CategoryData } from '@/lib/database';
import { convertClientsToBrands, filterEventsByAdultCategories, extractClientFromEvent } from '@/utils/brandUtils';
import { ClientData, EventRow } from '@/lib/database';
import { formatEventDate, formatEventTime, isEventTodayOrLater, abbreviateState } from '@/utils/formatters';
import type { EventData } from './components/BrandUpcomingEvents';
import { useAuthStore } from '@/stores/authStore';

export interface FavoriteBrandData {
  id: string;
  brandName: string;
  description: string;
  productTypes?: string[];
  brandPhotoURL?: string;
  events?: EventData[];
}

export const useFavoritesScreen = () => {
  const favoriteIds = useFavoritesStore((state) => state.favoriteIds);
  const isFavorite = useFavoritesStore((state) => state.isFavorite);
  const addFavoriteToStore = useFavoritesStore((state) => state.addFavorite);
  const removeFavoriteFromStore = useFavoritesStore((state) => state.removeFavorite);
  const setFavorites = useFavoritesStore((state) => state.setFavorites);
  
  const [allBrands, setAllBrands] = useState<Omit<NewBrandData, 'isFavorited'>[]>([]);
  const [allClients, setAllClients] = useState<ClientData[]>([]);
  const [allEvents, setAllEvents] = useState<EventRow[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [userIsAdult, setUserIsAdult] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingUnfavorite, setPendingUnfavorite] = useState<{
    id: string;
    brandName: string;
  } | null>(null);
  const [isUnfavoriting, setIsUnfavoriting] = useState(false);

  const loadData = async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setIsLoading(true);
      }
      
      // Get current user and their favorites from database
      const authUser = useAuthStore.getState().user;
      let isAdult = false;
      if (authUser) {
        const userProfile = await getUserProfile(authUser.$id);
        if (userProfile) {
          if (userProfile.favoriteIds) {
            // Sync favorites from database to store
            setFavorites(userProfile.favoriteIds);
          }
          isAdult = userProfile.isAdult || false;
          setUserIsAdult(isAdult);
        }
      }
      
      // Fetch clients, events, and categories in parallel
      const [clients, events, allCategories] = await Promise.all([
        fetchClients(),
        fetchAllEvents(),
        fetchCategories(true), // Get all categories including adult ones for filtering
      ]);
      
      setCategories(allCategories);
      
      // Filter events based on user's adult status and category adult flags
      const filteredEvents = filterEventsByAdultCategories(events, allCategories, isAdult);
      
      setAllClients(clients);
      setAllEvents(filteredEvents);
      
      // Convert clients to brand data with product types from filtered events
      const brands = convertClientsToBrands(clients, filteredEvents);
      
      // Format description: use brandDescription if available, otherwise fall back to product types
      const brandsWithDescription = brands.map((brand) => ({
        ...brand,
        description: brand.description 
          || (brand.productTypes.length > 0 ? brand.productTypes.join(', ') : 'No description available'),
      }));
      
      setAllBrands(brandsWithDescription);
    } catch (error) {
      console.error('[useFavoritesScreen] Error loading data:', error);
      setAllBrands([]);
      setAllClients([]);
      setAllEvents([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Load user's favorite IDs from database and fetch all brands/events
  useEffect(() => {
    loadData();
  }, [setFavorites]);

  // Refetch events when Favorites tab gains focus so admin changes appear without app restart
  useFocusEffect(
    useCallback(() => {
      loadData(true);
    }, [])
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData(true);
  };

  // Get favorite brands with their details and events
  const favoriteBrands = useMemo<FavoriteBrandData[]>(() => {
    const brands: FavoriteBrandData[] = [];
    
    for (const brandId of favoriteIds) {
      // Find the client/brand by ID (from clients list or derive from events)
      let client = allClients.find((c) => c.$id === brandId);
      if (!client) {
        // Fallback: derive from events (e.g., brand has upcoming events but wasn't in clients due to pagination)
        const firstEvent = allEvents.find((e) => {
          const cid = typeof e.client === 'string' ? e.client : e.client?.$id;
          return cid === brandId;
        });
        const extracted = firstEvent && typeof firstEvent.client === 'object'
          ? extractClientFromEvent(firstEvent)
          : null;
        if (extracted) client = extracted;
      }
      if (!client) continue;
      
      const brandName = client.name || client.title || 'Brand';
      
      // Get brand data to find product types
      const brandData = allBrands.find((b) => b.id === brandId);
      
      // Find all events for this brand to get brandDescription
      const allBrandEvents = allEvents
        .filter((event) => {
          const clientId = typeof event.client === 'string' 
            ? event.client 
            : event.client?.$id;
          return clientId === brandId;
        })
        .sort((a, b) => new Date(a.startTime || a.date).getTime() - new Date(b.startTime || b.date).getTime());
      
      // Get brandDescription from the most recent event (prioritize upcoming events, then past events)
      const upcomingEvents = allBrandEvents.filter((event) =>
        isEventTodayOrLater(event.startTime || event.date, event.timezone)
      );
      const mostRelevantEvent = upcomingEvents.length > 0 ? upcomingEvents[0] : allBrandEvents[allBrandEvents.length - 1];
      const brandDescription = mostRelevantEvent?.brandDescription || null;
      
      // Filter to only upcoming events for display
      const brandEvents = upcomingEvents
        .slice(0, 3) // Limit to 3 upcoming events
        .map((event): EventData => {
          const eventClient = typeof event.client !== 'string' ? event.client : null;
          // Store/location name for the listing line; city/state is shown as a separate segment below.
          const location = (event.locationName || '').trim() || 'Location TBD';
          
          // Get city and state from event
          const city = event.city || eventClient?.city || '';
          const state = abbreviateState(event.state || eventClient?.state || '');
          
          return {
            id: event.$id,
            name: event.name || brandName,
            brandName: brandName,
            location,
            distance: city && state ? `${city}, ${state}` : (city || state || ''), // Use distance field for city, state
            date: formatEventDate(event.startTime || event.date, event.timezone),
            time: formatEventTime(event.startTime, event.endTime, event.timezone),
            logoURL: client.logoURL || null, // Brand logo from client
          };
        });
      
      // Prefer client/brand description (from brandData), then event-level brandDescription, then product types
      const description = brandData?.description 
        || brandDescription 
        || brandData?.productTypes?.join(', ') 
        || 'No description available';
      
      brands.push({
        id: brandId,
        brandName,
        description,
        brandPhotoURL: client.logoURL || undefined,
        events: brandEvents.length > 0 ? brandEvents : undefined,
      });
    }
    
    return brands;
  }, [favoriteIds, allClients, allBrands, allEvents]);

  // Get new brands that aren't favorited yet
  const newBrands = useMemo<NewBrandData[]>(() => {
    return allBrands
      .filter((brand) => !isFavorite(brand.id))
      .map((brand) => ({
        ...brand,
        isFavorited: isFavorite(brand.id),
      }));
  }, [allBrands, isFavorite, favoriteIds]);

  const performRemoveFavorite = async (brandId: string) => {
    try {
      removeFavoriteFromStore(brandId);

      const authUser = useAuthStore.getState().user;
      if (authUser) {
        await removeFavoriteBrand(authUser.$id, brandId);
      }
    } catch (error) {
      console.error('[useFavoritesScreen] Error removing favorite:', error);
      addFavoriteToStore(brandId);
      throw error;
    }
  };

  const handleRequestUnfavorite = (brand: { id: string; brandName: string }) => {
    setPendingUnfavorite({ id: brand.id, brandName: brand.brandName });
  };

  const handleCancelUnfavorite = () => {
    setPendingUnfavorite(null);
  };

  const handleConfirmUnfavorite = async () => {
    const brandId = pendingUnfavorite?.id;
    if (!brandId) return;

    setIsUnfavoriting(true);
    try {
      await performRemoveFavorite(brandId);
      setPendingUnfavorite(null);
    } finally {
      setIsUnfavoriting(false);
    }
  };

  const handleToggleNewFavorite = async (brandId: string) => {
    try {
      const isCurrentlyFavorite = isFavorite(brandId);
      
      if (isCurrentlyFavorite) {
        // Remove favorite
        removeFavoriteFromStore(brandId);
        
        const authUser = useAuthStore.getState().user;
        if (authUser) {
          await removeFavoriteBrand(authUser.$id, brandId);
        }
      } else {
        // Add favorite
        addFavoriteToStore(brandId);
        
        const authUser = useAuthStore.getState().user;
        if (authUser) {
          await addFavoriteBrand(authUser.$id, brandId);
        }
      }
    } catch (error) {
      console.error('[useFavoritesScreen] Error toggling favorite:', error);
      // Revert optimistic update if database sync fails
      const isCurrentlyFavorite = isFavorite(brandId);
      if (isCurrentlyFavorite) {
        removeFavoriteFromStore(brandId);
      } else {
        addFavoriteToStore(brandId);
      }
    }
  };

  return {
    favorites: favoriteBrands,
    newBrands,
    isLoading,
    isRefreshing,
    pendingUnfavorite,
    isUnfavoriting,
    handleRequestUnfavorite,
    handleCancelUnfavorite,
    handleConfirmUnfavorite,
    handleToggleNewFavorite,
    handleRefresh,
  };
};

