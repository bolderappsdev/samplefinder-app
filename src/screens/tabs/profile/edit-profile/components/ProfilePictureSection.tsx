import React from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Monicon } from '@monicon/native';
import { Colors } from '@/constants/Colors';

interface ProfilePictureSectionProps {
  username: string;
  avatarUri: string | null;
  isUploadingAvatar: boolean;
  disabled?: boolean;
  onChangePicture: () => void;
}

export const ProfilePictureSection: React.FC<ProfilePictureSectionProps> = ({
  username,
  avatarUri,
  isUploadingAvatar,
  disabled = false,
  onChangePicture,
}) => {
  const isInteractionDisabled = isUploadingAvatar || disabled;
  return (
    <View style={styles.profileSection}>
      <TouchableOpacity
        onPress={onChangePicture}
        disabled={isInteractionDisabled}
        style={styles.avatarContainer}
      >
        <View style={styles.avatarBorder}>
          {isUploadingAvatar ? (
            <ActivityIndicator size="large" color={Colors.blueColorMode} />
          ) : avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Monicon name="mdi:account" size={60} color={Colors.blueColorMode} />
            </View>
          )}
        </View>
        <View style={styles.cameraIconContainer}>
          <View style={styles.cameraIconBackground}>
            <Monicon name="mdi:camera" size={24} color={Colors.white} />
          </View>
        </View>
      </TouchableOpacity>
      <Text style={styles.username}>{username || 'User'}</Text>
      <TouchableOpacity onPress={onChangePicture} disabled={isInteractionDisabled}>
        <Text style={styles.changePictureText}>
          {isUploadingAvatar ? 'Uploading...' : 'Add / Change Profile Picture'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  profileSection: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  avatarContainer: {
    marginBottom: 16,
    position: 'relative',
    width: 120,
    height: 120,
  },
  avatarBorder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: Colors.blueColorMode,
    overflow: 'hidden',
    backgroundColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraIconBackground: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.blueColorMode,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  username: {
    fontSize: 24,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinBlueBlack,
  },
  changePictureText: {
    fontSize: 14,
    fontFamily: 'Quicksand_500Regular',
    color: Colors.grayText,
  },
});

