import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FavoritesState {
  favoriteIds: string[]; // Just store brand IDs
  addFavorite: (brandId: string) => void;
  removeFavorite: (brandId: string) => void;
  isFavorite: (brandId: string) => boolean;
  toggleFavorite: (brandId: string) => void;
  setFavorites: (brandIds: string[]) => void; // Sync from database
  clear: () => void; // Reset on logout/account switch
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],
      
      addFavorite: (brandId) => {
        set((state) => {
          // Check if already exists
          if (state.favoriteIds.includes(brandId)) {
            return state;
          }
          return {
            favoriteIds: [...state.favoriteIds, brandId],
          };
        });
      },
      
      removeFavorite: (brandId) => {
        set((state) => ({
          favoriteIds: state.favoriteIds.filter((id) => id !== brandId),
        }));
      },
      
      isFavorite: (brandId) => {
        return get().favoriteIds.includes(brandId);
      },
      
      toggleFavorite: (brandId) => {
        const isCurrentlyFavorite = get().isFavorite(brandId);
        if (isCurrentlyFavorite) {
          get().removeFavorite(brandId);
        } else {
          get().addFavorite(brandId);
        }
      },
      
      setFavorites: (brandIds) => {
        set({ favoriteIds: brandIds });
      },

      clear: () => {
        set({ favoriteIds: [] });
      },
    }),
    {
      name: 'favorites-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

