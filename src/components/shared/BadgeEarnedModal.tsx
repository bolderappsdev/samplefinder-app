import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  ImageBackground,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { SmallBlueStarIcon } from '@/icons';
import CertifiedBrandAmbassadorIcon from '@/icons/CertifiedBrandAmbassadorIcon';
import CertifiedInfluencerIcon from '@/icons/CertifiedInfluencerIcon';
import BadgeEarnedPopupIcon from '@/icons/BadgeEarnedPopupIcon';
import { CloseIcon } from '@/components';
import { captureAndShareView } from '@/utils/captureAndShare';
import ModalBackdrop from '@/components/shared/ModalBackdrop';
import { APP_STORE_SHARE_SUFFIX } from '@/constants';
import radialBg from '@/assets/radial-bg.png';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type BadgeType = 'events' | 'reviews' | 'ambassador' | 'influencer';

interface BadgeEarnedModalProps {
  visible: boolean;
  badgeType: BadgeType;
  badgeNumber?: number;
  achievementCount?: number;
  onClose: () => void;
  onShare?: () => void;
}

const BadgeEarnedModal: React.FC<BadgeEarnedModalProps> = ({
  visible,
  badgeType,
  badgeNumber = 0,
  achievementCount = 0,
  onClose,
  onShare,
}) => {
  const modalRef = useRef<View>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible]);

  const handleShare = async () => {
    try {
      const badgeName = getBadgeName();
      const headline = badgeType === 'events' || badgeType === 'reviews'
        ? `I just earned the ${badgeNumber} ${badgeName} on SampleFinder! 🎉`
        : `I just earned the ${badgeName} on SampleFinder! 🎉`;
      const message = `${headline}\n\n${APP_STORE_SHARE_SUFFIX}`;
      if (modalRef.current) {
        await captureAndShareView(modalRef, message);
      }
      onShare?.();
      onClose();
    } catch (error) {
      console.error('Error in handleShare:', error);
      onClose();
    }
  };

  const getBadgeName = (): string => {
    if (badgeType === 'events') return 'Events Badge';
    if (badgeType === 'reviews') return 'Review Badge';
    if (badgeType === 'ambassador') return 'Certified Brand Ambassador';
    return 'Certified Influencer';
  };

  const getAchievementMessage = (): string => {
    if (badgeType === 'ambassador') {
      return 'You earned your Certified Brand Ambassador badge on SampleFinder!';
    }
    if (badgeType === 'influencer') {
      return 'You earned your Certified Influencer badge on SampleFinder!';
    }

    const activity = badgeType === 'events' ? 'events' : 'reviews';
    return `You made it to ${achievementCount} ${activity} using SampleFinder!`;
  };

  const getEarnedIndicatorText = (): string => {
    if (badgeType === 'ambassador') {
      return 'You earned 100 points';
    }
    if (badgeType === 'influencer') {
      return 'You earned 100 points';
    }
    return 'You earned points!';
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <ModalBackdrop containerStyle={styles.backdropContainer}>
        <Animated.View
          ref={modalRef}
          collapsable={false}
          style={[
            styles.modalContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <ImageBackground source={radialBg} resizeMode="cover" style={styles.gradientContainer}>
            {/* Close Button */}
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <View style={styles.closeButtonCircle}>
                <CloseIcon color={Colors.white} />
              </View>
            </TouchableOpacity>

            {/* Badge Icon */}
            <View style={styles.badgeContainer}>
              {badgeType === 'events' || badgeType === 'reviews' ? (
                <BadgeEarnedPopupIcon value={badgeNumber} size={165} />
              ) : badgeType === 'ambassador' ? (
                <CertifiedBrandAmbassadorIcon size={165} color={Colors.white} transparentBackground />
              ) : (
                <CertifiedInfluencerIcon size={165} color={Colors.white} transparentBackground />
              )}
            </View>
            <Text style={styles.badgeName}>{getBadgeName()}</Text>
          </ImageBackground>

            {/* Badge Name */}
            <View style={styles.badgeInfoContainer}>
              {/* Congratulations Message */}
              <Text style={styles.congratulationsText}>Congratulations!</Text>

              {/* Achievement Description */}
              <Text style={styles.achievementMessage}>{getAchievementMessage()}</Text>

              {/* Points Earned Indicator */}
              <View style={styles.pointsIndicatorContainer}>
                <SmallBlueStarIcon />
                <Text style={styles.pointsIndicatorText}>{getEarnedIndicatorText()}</Text>
              </View>
            </View>

            {/* Share Button */}
            <View style={styles.shareButtonContainer}>
              <TouchableOpacity
                style={styles.shareButton}
                onPress={handleShare}
                activeOpacity={0.8}
              >
                <Text style={styles.shareButtonText}>Share</Text>
              </TouchableOpacity>
            </View>
        </Animated.View>
      </ModalBackdrop>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdropContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    width: SCREEN_WIDTH - 40,
    maxWidth: 400,
    alignItems: 'center',
    backgroundColor: Colors.white,
  },
  gradientContainer: {
    width: '100%',
    minHeight: 240,
    paddingVertical: 24,
    alignItems: 'center',
    paddingTop: 40,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  closeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeContainer: {
    marginTop: 8,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeInfoContainer:{
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  badgeName: {
    fontSize: 20,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  congratulationsText: {
    fontSize: 28,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    marginBottom: 16,
    textAlign: 'center',
  },
  achievementMessage: {
    fontSize: 16,
    fontFamily: 'Quicksand_400Regular',
    color: Colors.pinBlueBlack,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  pointsIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pointsIndicatorText: {
    fontSize: 14,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.blueColorMode,
  },
  shareButtonContainer: {
    width: '100%',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  shareButton: {
    width: '100%',
    backgroundColor: '#090188',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
  },
});

export default BadgeEarnedModal;
