import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { NavigatorScreenParams } from '@react-navigation/native';
import { View, StyleSheet, TouchableOpacity, ImageBackground } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HomeStack, { HomeStackParamList } from '@/navigation/HomeStack';
import ProfileStack, { ProfileStackParamList } from '@/navigation/ProfileStack';
import FavoritesScreen from '@/screens/tabs/favorites/FavoritesScreen';
import CalendarStack from '@/navigation/CalendarStack';
import { PromotionsScreen } from '@/screens/tabs/promotions';
import { HomeIcon, ProfileIcon, CalendarIcon, SparkleIcon } from '@/icons';
import { Colors } from '@/constants/Colors';
import HeartOutlineIcon from '@/icons/HeartOutlineIcon';

export type TabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
  Favorites: undefined;
  Calendar: undefined;
  Promotions: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const CustomTabBar = ({ state, descriptors, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();

  const getIcon = (routeName: string, isFocused: boolean) => {
    const iconSize = 30;
    const iconColor = Colors.blueColorMode;
    const circleColor = Colors.white;

    let icon = null;

    switch (routeName) {
      case 'Home':
        icon = <HomeIcon size={iconSize} color={iconColor} circleColor={circleColor} />;
        break;
      case 'Profile':
        icon = <ProfileIcon size={iconSize} color={iconColor} circleColor={circleColor} />;
        break;
      case 'Favorites':
        icon = (
          <View style={styles.favoritesIconOffset}>
            <HeartOutlineIcon size={iconSize - 6} color={iconColor} />
          </View>
        );
        break;
      case 'Calendar':
        icon = <CalendarIcon size={iconSize} color={iconColor} circleColor={circleColor} />;
        break;
      case 'Promotions':
        icon = (
          <View style={styles.promotionsIconOffset}>
            <SparkleIcon size={iconSize} color={iconColor} circleColor={circleColor} />
          </View>
        );
        break;
    }

    return <View style={styles.iconContainer}>{icon}</View>;
  };

  return (
    <ImageBackground
      source={require('@/assets/main-footer-bg.png')}
      style={[styles.background, { paddingBottom: insets.bottom}]}
      resizeMode="cover"
    >
      <View style={styles.container}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (event.defaultPrevented) {
              return;
            }

            // Always show map/list root when opening Home (not the last nested screen).
            if (route.name === 'Home') {
              navigation.navigate('Home', { screen: 'HomeMain' });
              return;
            }

            // Re-tapping Profile resets to ProfileMain so users aren't stranded on Edit Profile / Notifications.
            if (route.name === 'Profile') {
              navigation.navigate('Profile', { screen: 'ProfileMain' });
              return;
            }

            if (!isFocused) {
              navigation.navigate(route.name as keyof TabParamList);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tab}
              activeOpacity={0.7}
            >
              {getIcon(route.name, isFocused)}
            </TouchableOpacity>
          );
        })}
      </View>
    </ImageBackground>
  );
};

const TabNavigator = () => {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Profile" component={ProfileStack} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Calendar" component={CalendarStack} />
      <Tab.Screen name="Promotions" component={PromotionsScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  background: {
    paddingBottom: 0,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  tab: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderRadius: 100,
    borderWidth: 2,
    borderColor: Colors.blueColorMode,
  },
  favoritesIconOffset: {
    marginTop: 3,
  },
  promotionsIconOffset: {
    marginLeft: 4,
  },
});

export default TabNavigator;

