import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Image,
} from 'react-native';
import { Monicon } from '@monicon/native';
import { Colors } from '@/constants/Colors';
import { getTierDisplayParts, getTierEarnedHeadline, getTierEarnedPointsMessage } from '@/utils/formatters';
import { captureAndShareView } from '@/utils/captureAndShare';
import { SmallBlueStarIcon } from '@/icons';
import CustomButton from '@/components/shared/CustomButton';
import { Tier } from './TierItem';
import { CloseIcon } from '@/components';
import ModalBackdrop from '@/components/shared/ModalBackdrop';
import { APP_STORE_SHARE_SUFFIX } from '@/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TierEarnedModalProps {
  visible: boolean;
  tier?: Tier | null;
  points?: number;
  message?: string;
  onClose: () => void;
  onShare?: () => void;
}

const TierEarnedModal: React.FC<TierEarnedModalProps> = ({
  visible,
  tier,
  points = 100,
  message,
  onClose,
  onShare,
}) => {
  const modalRef = useRef<View>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));
  const [imageError, setImageError] = useState(false);
  const [isCapturingShare, setIsCapturingShare] = useState(false);

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
      setImageError(false);
      setIsCapturingShare(false);
    }
  }, [visible]);

  const tierNumber = tier?.order ?? 1;

  const handleShare = async () => {
    try {
      if (onShare) {
        await onShare();
      } else {
        const tierLabel = tier?.name ?? 'a new tier';
        const shareMessage =
          tierNumber === 1
            ? `I just joined SampleFinder and earned ${points} points! Discover samples near you.\n\n${APP_STORE_SHARE_SUFFIX}`
            : `I just reached ${tierLabel} on SampleFinder! Join me in discovering amazing samples.\n\n${APP_STORE_SHARE_SUFFIX}`;
        setIsCapturingShare(true);
        // Wait one frame so close/share are not included in capture.
        await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        if (modalRef.current) {
          await captureAndShareView(modalRef, shareMessage);
        }
      }
      onClose();
    } catch (error) {
      console.error('Error in handleShare:', error);
      onClose();
    } finally {
      setIsCapturingShare(false);
    }
  };

  const tierDisplayParts = getTierDisplayParts(tier?.name ?? 'NewbieSampler');
  const requiredPoints = tier?.requiredPoints ?? 100;

  const getTierBadgeColors = (tierNum: number) => {
    switch (tierNum) {
      case 1:
        return { primary: '#1E3A5F', secondary: '#4A5F7F' };
      case 2:
        return { primary: '#E91E63', secondary: '#F06292' };
      case 3:
        return { primary: '#FF9800', secondary: '#FFB74D' };
      case 4:
        return { primary: '#9C27B0', secondary: '#BA68C8' };
      case 5:
        return { primary: '#4CAF50', secondary: '#81C784' };
      default:
        return { primary: Colors.pinDarkBlue, secondary: Colors.blueColorMode };
    }
  };

  const badgeColors = getTierBadgeColors(tierNumber);

  const getPointsMessage = () => {
    if (message) return message;
    return getTierEarnedPointsMessage(tierNumber, requiredPoints, points);
  };

  const mainMessage = getTierEarnedHeadline(tierNumber);
  const pointsMessage = getPointsMessage();

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
          {!isCapturingShare && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <View style={styles.closeButtonCircle}>
                <CloseIcon />
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.badgeContainer}>
            {tier?.imageURL && !imageError ? (
              <Image
                source={{ uri: tier.imageURL }}
                style={styles.tierImage}
                resizeMode="contain"
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={[styles.fallbackBadge, { backgroundColor: badgeColors.primary }]}>
                <Monicon name="ph:seal-fill" size={120} color={Colors.white} />
              </View>
            )}
          </View>

          <View style={styles.tierNameRow}>
            <Text style={styles.tierName}>{tierDisplayParts.main}</Text>
            {tierDisplayParts.subtitle ? (
              <Text style={styles.tierNameSubtitle}>{tierDisplayParts.subtitle}</Text>
            ) : null}
          </View>

          <Text style={styles.mainMessage}>{mainMessage}</Text>

          <Text style={styles.pointsMessage}>
            {pointsMessage.split('**').map((part, index) => 
              index % 2 === 1 ? (
                <Text key={index} style={styles.boldText}>{part}</Text>
              ) : (
                part
              )
            )}
          </Text>

          <View style={styles.pointsIndicatorContainer}>
            <SmallBlueStarIcon />
            <Text style={styles.pointsIndicatorText}>
              You earned points!
            </Text>
          </View>

          {!isCapturingShare && (
            <CustomButton
              title="Share"
              onPress={handleShare}
              variant="dark"
              size="medium"
              style={styles.actionButton}
            />
          )}
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
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 24,
    width: SCREEN_WIDTH - 40,
    maxWidth: 400,
    alignItems: 'center',
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
  tierImage: {
    width: 200,
    height: 200,
  },
  fallbackBadge: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierNameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 12,
  },
  tierName: {
    fontSize: 20,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
  },
  tierNameSubtitle: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
  },
  mainMessage: {
    fontSize: 28,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
    marginBottom: 16,
    textAlign: 'center',
  },
  pointsMessage: {
    fontSize: 16,
    fontFamily: 'Quicksand_400Regular',
    color: Colors.black,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  boldText: {
    fontFamily: 'Quicksand_700Bold',
  },
  pointsIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  pointsIndicatorText: {
    fontSize: 14,
    fontFamily: 'Quicksand_600SemiBold',
    color: Colors.pinDarkBlue,
  },
  actionButton: {
    width: '100%',
    marginTop: 8,
  },
});

export default TierEarnedModal;
