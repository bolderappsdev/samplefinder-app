import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Colors } from '@/constants/Colors';
import RoundedLogoImage from './RoundedLogoImage';

const locationPin = require('@/assets/locationImage.png');

/**
 * Unified event interface that can represent events from different sources
 */
export interface UnifiedEvent {
  id: string;
  name?: string; // Event name/title
  product?: string; // For EventData (home screen)
  brandName?: string;
  location: string;
  distance: string;
  time: string;
  date: Date | string; // Can be Date object or formatted string
  logoURL?: string | null;
}

interface EventCardProps {
  event: UnifiedEvent;
  onPress: (event: UnifiedEvent) => void;
  showDate?: boolean; // Whether to show the date in the right column
}

const EventCard: React.FC<EventCardProps> = ({ event, onPress, showDate = true }) => {
  // Format date - handle both Date objects and strings
  let formattedDate: string;
  if (event.date instanceof Date) {
    formattedDate = event.date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } else {
    // If it's already a formatted string, use it as is
    formattedDate = event.date;
  }
  
  // Line 1 is always the brand name.
  const displayBrandName = event.brandName || 'Brand';

  // Line 2 is the store/location name (populated from event.locationName upstream).
  // Skip it when empty, or when it merely repeats the brand name.
  const locationTrimmed = (event.location || '').trim();
  const brandTrimmed = (event.brandName || '').trim();
  const showLocationLine =
    locationTrimmed.length > 0 &&
    locationTrimmed.toLowerCase() !== brandTrimmed.toLowerCase();

  return (
    <TouchableOpacity
      onPress={() => onPress(event)}
      activeOpacity={0.7}
    >
      <View style={styles.eventItem}>
        <View style={styles.eventLeft}>
          <RoundedLogoImage
            source={event.logoURL ? { uri: event.logoURL } : locationPin}
            width={70}
            height={70}
            backgroundColor={event.logoURL ? Colors.white : undefined}
            resizeMode={event.logoURL ? 'cover' : 'contain'}
            containerStyle={styles.logoContainer}
            onError={
              event.logoURL
                ? (e) =>
                    console.log(
                      '[EventCard] Image load error:',
                      e.nativeEvent.error,
                      'URL:',
                      event.logoURL
                    )
                : undefined
            }
            onLoad={
              event.logoURL
                ? () => console.log('[EventCard] Image loaded successfully:', event.logoURL?.substring(0, 50))
                : undefined
            }
          />
          <View style={styles.eventDetails}>
            <Text
              style={styles.brandName}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {displayBrandName}
            </Text>
            {showLocationLine ? (
              <Text
                style={styles.locationText}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {locationTrimmed}
              </Text>
            ) : null}
            <Text style={styles.distanceText}>{event.distance}</Text>
          </View>
        </View>
        {showDate && (
          <View style={styles.eventRight}>
            <Text style={styles.dateText}>{formattedDate}</Text>
            <Text style={styles.timeText} numberOfLines={3}>
              {event.time}
            </Text>
          </View>
        )}
        {!showDate && (
          <View style={styles.eventRight}>
            <Text style={styles.timeText} numberOfLines={3}>
              {event.time}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  eventItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.brandBlueBright + '20', // 20 is alpha for 12% opacity
  },
  eventLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    minHeight: 70,
  },
  logoContainer: {
    marginRight: 12,
    flexShrink: 0,
  },
  eventDetails: {
    flex: 1,
    flexShrink: 1,
    justifyContent: 'center',
    gap: 4,
    paddingRight: 8,
  },
  brandName: {
    fontSize: 17,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.brandBlueBright,
    flexShrink: 1,
  },
  locationText: {
    fontSize: 15,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.brandBlueBright,
    flexShrink: 1,
  },
  distanceText: {
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: Colors.brandBlueBright,
  },
  eventRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
    flexShrink: 1,
    maxWidth: '38%',
    gap: 4,
  },
  dateText: {
    fontSize: 12,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.brandBlueBright,
    textAlign: 'right',
  },
  timeText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.brandBlueBright,
    textAlign: 'right',
  },
});

export default EventCard;

