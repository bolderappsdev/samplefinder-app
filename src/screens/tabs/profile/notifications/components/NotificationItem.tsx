import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Monicon } from '@monicon/native';
import { SparkleNotificationIcon } from '@/icons/SparkleNotificationIcon';
import { Colors } from '@/constants/Colors';

const STAR_CHAR = '⭐';
const STAR_ALT = '★';

export interface Notification {
  id: string;
  title: string;
  description: string;
  icon?: string;
  timestamp?: Date;
  isRead?: boolean;
  /** Present when the notification is about an event; tapping opens its details. */
  eventId?: string;
}

interface NotificationItemProps {
  notification: Notification;
  onPress?: (id: string) => void;
}

function NotificationTitle({ title }: { title: string }) {
  const hasStar = title.includes(STAR_CHAR) || title.includes(STAR_ALT);
  if (!hasStar) {
    return (
      <View style={styles.titleWrapper}>
        <Text style={styles.title}>{title}</Text>
      </View>
    );
  }
  const starIdx = title.indexOf(STAR_CHAR) >= 0 ? title.indexOf(STAR_CHAR) : title.indexOf(STAR_ALT);
  const starLength = title.indexOf(STAR_CHAR) >= 0 ? STAR_CHAR.length : STAR_ALT.length;
  const beforeStar = title.slice(0, starIdx).trimEnd();
  const afterStar = title.slice(starIdx + starLength).trimStart();

  return (
    <View style={styles.titleRow}>
      <Text style={styles.title}>{beforeStar}</Text>
      <View style={styles.titleStarWrapper}>
        <Monicon name="mdi:star" size={18} color="#E6B800" />
      </View>
      {afterStar ? <Text style={styles.title}>{afterStar}</Text> : null}
    </View>
  );
}

export const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onPress }) => {
  const handlePress = () => {
    if (onPress) {
      onPress(notification.id);
    }
  };

  return (
    <TouchableOpacity 
      style={[styles.container, !notification.isRead && styles.unreadContainer]} 
      activeOpacity={0.7}
      onPress={handlePress}
    >
      {!notification.isRead && (
        <View style={styles.unreadDotColumn}>
          <View style={styles.unreadIndicator} />
        </View>
      )}
      <View style={styles.iconContainer}>
        <SparkleNotificationIcon size={46} />
      </View>
      <View style={styles.contentContainer}>
        <NotificationTitle title={notification.title} />
        <Text style={styles.description}>{notification.description}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
    marginHorizontal: 30,
  },
  unreadContainer: {},
  unreadDotColumn: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  unreadIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1D0A74',
  },
  iconContainer: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleWrapper: {
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  titleStarWrapper: {
    marginLeft: 2,
    marginRight: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.black,
  },
  description: {
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: '#666666',
    lineHeight: 20,
  },
});
