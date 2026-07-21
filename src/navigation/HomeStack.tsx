import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '@/screens/tabs/home/HomeScreen';
import { BrandDetailsScreen, BrandDetailsData } from '@/screens/brand-details';

export type HomeStackParamList = {
  HomeMain: undefined;
  BrandDetails:
    | { eventId: string; fromFavorites?: boolean; fromNotifications?: boolean }
    | { brand: BrandDetailsData; fromFavorites?: boolean; fromNotifications?: boolean };
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

const HomeStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="BrandDetails" component={BrandDetailsScreen} />
    </Stack.Navigator>
  );
};

export default HomeStack;

