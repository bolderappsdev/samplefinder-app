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
import { SmallBlueStarIcon } from '@/icons';
import CustomButton from '@/components/shared/CustomButton';
import { Tier } from './TierItem';
import { CloseIcon } from '@/components';
import { captureAndShareView } from '@/utils/captureAndShare';
import ModalBackdrop from '@/components/shared/ModalBackdrop';
import { APP_STORE_SHARE_SUFFIX } from '@/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TierProgressModalProps {
  visible: boolean;
  tier?: Tier | null;
  totalPoints?: number;
  // Points used for progress bar calculation only.
  // This may differ from totalPoints when tierLevel is manually overridden.
  progressTotalPoints?: number;
  nextTierRequiredPoints?: number;
  onClose: () => void;
  onViewMoreEvents?: () => void;
}

const TierProgressModal: React.FC<TierProgressModalProps> = ({
  visible,
  tier,
  totalPoints,
  progressTotalPoints,
  nextTierRequiredPoints,
  onClose,
  onViewMoreEvents,
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
    }
  }, [visible]);

  const handleViewMoreEvents = () => {
    if (onViewMoreEvents) {
      onViewMoreEvents();
    }
    onClose();
  };

  const tierNumber = tier?.order ?? 1;
  const tierDisplayParts = getTierDisplayParts(tier?.name ?? 'NewbieSampler');
  /** Points required to complete the selected tier (denominator for progress). */
  const tierGoalPoints = tier?.requiredPoints ?? 100;
  const userTotalPoints = totalPoints ?? tier?.currentPoints ?? 0;
  const isMaxTier = !nextTierRequiredPoints && tier?.badgeEarned;
  /** Earned tier with a higher tier still available — show tier-earned popup, not progress. */
  const isEarnedMidTier = Boolean(tier?.badgeEarned && nextTierRequiredPoints != null);
  const progressPoints = progressTotalPoints ?? userTotalPoints;
  const progress = tier?.badgeEarned
    ? 100
    : Math.min((progressPoints / tierGoalPoints) * 100, 100);

  const getShareMessage = () => {
    const tierName = tier?.name ?? 'a new tier';
    if (isEarnedMidTier) {
      if (tierNumber === 1) {
        return `I just earned the ${tierName} tier on SampleFinder! Join me in discovering amazing samples and earning rewards.\n\n${APP_STORE_SHARE_SUFFIX}`;
      }
      return `I just leveled up to the ${tierName} tier on SampleFinder! Join me in discovering amazing samples and earning rewards.\n\n${APP_STORE_SHARE_SUFFIX}`;
    }
    return `I'm earning the ${tierName} tier on SampleFinder! Join me in discovering amazing samples.\n\n${APP_STORE_SHARE_SUFFIX}`;
  };

  const handleShare = async () => {
    try {
      setIsCapturingShare(true);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await captureAndShareView(modalRef, getShareMessage());
    } catch (error) {
      console.error('Error sharing tier achievement:', error);
    } finally {
      setIsCapturingShare(false);
    }
  };

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
               <CloseIcon/>
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
            <Text
              style={[
                styles.tierName,
                (isEarnedMidTier || isMaxTier) && styles.tierNameEarnedPalette,
              ]}
            >
              {tierDisplayParts.main}
            </Text>
            {tierDisplayParts.subtitle ? (
              <Text
                style={[
                  styles.tierNameSubtitle,
                  (isEarnedMidTier || isMaxTier) && styles.tierNameSubtitleEarnedPalette,
                ]}
              >
                {tierDisplayParts.subtitle}
              </Text>
            ) : null}
          </View>

          {isEarnedMidTier ? (
            <>
              <Text style={[styles.mainMessage, styles.mainMessageEarnedPalette]}>
                {getTierEarnedHeadline(tierNumber)}
              </Text>
              <Text style={[styles.pointsMessage, styles.pointsMessageEarnedPalette]}>
                {getTierEarnedPointsMessage(tierNumber, tierGoalPoints, userTotalPoints)
                  .split('**')
                  .map((part, index) =>
                    index % 2 === 1 ? (
                      <Text key={index} style={styles.boldText}>
                        {part}
                      </Text>
                    ) : (
                      part
                    )
                  )}
              </Text>
              <View style={styles.pointsIndicatorContainer}>
                <SmallBlueStarIcon />
                <Text style={[styles.pointsIndicatorText, styles.pointsIndicatorEarnedPalette]}>
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
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.mainMessage,
                  isMaxTier && styles.mainMessageEarnedPalette,
                ]}
              >
                {isMaxTier ? "You're at the Top!" : "You're On Your Way!"}
              </Text>

              <Text
                style={[
                  styles.pointsMessage,
                  isMaxTier && styles.pointsMessageEarnedPalette,
                ]}
              >
                {isMaxTier
                  ? `${userTotalPoints.toLocaleString()} points earned`
                  : `${userTotalPoints.toLocaleString()} / ${tierGoalPoints.toLocaleString()} points`}
              </Text>

              <View style={styles.progressContainer}>
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, { width: `${progress}%` }]} />
                </View>
              </View>

              <View style={styles.pointsIndicatorContainer}>
                <SmallBlueStarIcon />
                <Text style={styles.pointsIndicatorText}>
                  {isMaxTier ? 'Keep exploring new events!' : 'Keep earning points!'}
                </Text>
              </View>

              {!isCapturingShare && (
                <>
                  <CustomButton
                    title="Share"
                    onPress={handleShare}
                    variant="dark"
                    size="medium"
                    style={styles.actionButton}
                  />
                  <CustomButton
                    title="View More Events"
                    onPress={handleViewMoreEvents}
                    variant="dark"
                    size="medium"
                    style={styles.actionButton}
                  />
                </>
              )}
            </>
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
    color: Colors.blueColorMode,
    textAlign: 'center',
  },
  tierNameSubtitle: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.blueColorMode,
    textAlign: 'center',
  },
  mainMessage: {
    fontSize: 28,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    marginBottom: 16,
    textAlign: 'center',
  },
  pointsMessage: {
    fontSize: 16,
    fontFamily: 'Quicksand_400Regular',
    color: Colors.pinBlueBlack,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: '#E8E8E8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#D0D0D0',
    borderRadius: 4,
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
    color: Colors.black,
  },
  actionButton: {
    width: '100%',
    marginTop: 8,
  },
  tierNameEarnedPalette: {
    color: Colors.pinDarkBlue,
  },
  tierNameSubtitleEarnedPalette: {
    color: Colors.pinDarkBlue,
  },
  mainMessageEarnedPalette: {
    color: Colors.pinDarkBlue,
  },
  pointsMessageEarnedPalette: {
    color: Colors.black,
  },
  pointsIndicatorEarnedPalette: {
    color: Colors.pinDarkBlue,
  },
  boldText: {
    fontFamily: 'Quicksand_700Bold',
  },
});

export default TierProgressModal;
