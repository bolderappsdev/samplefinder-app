import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  ActivityIndicator,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import WrongAnswerIcon from '../../icons/WrongAnswerIcon';
import PointsBadgeIcon from '../../icons/PointsBadgeIcon';
import type { TriviaQuestion, SubmitAnswerResult } from '../../lib/database/trivia';
import { Colors } from '../../constants/Colors';
import CloseIcon from '../shared/CloseIcon';
import SparkleIcon from '@/icons/SparkleIcon';
import { AchievementStartIcon, MediumStarIcon, SmallStarIcon, } from '@/icons';
import { captureAndShareView } from '@/utils/captureAndShare';
import { RoundedLogoImage } from '@/components';
import ModalBackdrop from '@/components/shared/ModalBackdrop';
import { APP_STORE_SHARE_SUFFIX } from '@/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Re-export the TriviaQuestion type for convenience
export type { TriviaQuestion } from '../../lib/database/trivia';

interface TriviaModalProps {
  visible: boolean;
  question: TriviaQuestion;
  onClose: () => void;
  onSubmitAnswer: (answerIndex: number) => Promise<SubmitAnswerResult>;
  onAnswerResult?: (isCorrect: boolean, pointsAwarded: number) => void;
  /**
   * Called when user closes without answering (skip or countdown missed).
   * May return `{ correctAnswerIndex }` so the modal can reveal the correct
   * answer in the "Times Up" state.
   */
  onSkipped?: () => Promise<{ correctAnswerIndex?: number } | void> | void;
}

type AnswerState = 'idle' | 'submitting' | 'correct' | 'incorrect' | 'timesUp';

export const TriviaModal: React.FC<TriviaModalProps> = ({
  visible,
  question,
  onClose,
  onSubmitAnswer,
  onAnswerResult,
  onSkipped,
}) => {
  const [selectedAnswerIndex, setSelectedAnswerIndex] = useState<number | null>(null);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState<number | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const [pointsAwarded, setPointsAwarded] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(10);
  const [closeEnabledAfterWin, setCloseEnabledAfterWin] = useState(true);
  const [isCapturingShare, setIsCapturingShare] = useState(false);
  const modalRef = useRef<View>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  React.useEffect(() => {
    if (visible) {
      setSelectedAnswerIndex(null);
      setCorrectAnswerIndex(null);
      setAnswerState('idle');
      setPointsAwarded(0);
      setCountdown(10);
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
      setIsCapturingShare(false);
    }
  }, [visible]);

  // Countdown timer
  useEffect(() => {
    if (visible && answerState === 'idle' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [visible, answerState, countdown]);

  // Show "Times Up" result when countdown reaches 0
  useEffect(() => {
    if (visible && answerState === 'idle' && countdown === 0) {
      setAnswerState('timesUp');
      void (async () => {
        try {
          const result = await onSkipped?.();
          if (
            result &&
            typeof result === 'object' &&
            'correctAnswerIndex' in result &&
            typeof result.correctAnswerIndex === 'number'
          ) {
            setCorrectAnswerIndex(result.correctAnswerIndex);
          }
        } catch (err) {
          console.warn('[TriviaModal] Failed to reveal correct answer on timeout:', err);
        }
      })();
    }
  }, [visible, answerState, countdown, onSkipped]);

  // When user wins, keep close disabled briefly then allow dismiss
  useEffect(() => {
    if (visible && answerState === 'correct') {
      setCloseEnabledAfterWin(false);
      const timer = setTimeout(() => setCloseEnabledAfterWin(true), 2500);
      return () => clearTimeout(timer);
    }
  }, [visible, answerState]);

  const handleAnswerPress = async (index: number) => {
    if (selectedAnswerIndex !== null || answerState === 'submitting') return; // Prevent multiple selections

    setSelectedAnswerIndex(index);
    setAnswerState('submitting');

    try {
      const result = await onSubmitAnswer(index);
      
      if (result.success) {
        // Trust server outcome: isCorrect and/or points awarded. correctAnswerIndex is for which option to highlight on loss.
        const points = result.pointsAwarded ?? 0;
        const apiCorrectIndex = (() => {
          if (result.correctAnswerIndex == null) return null;
          const n = Number(result.correctAnswerIndex);
          return Number.isFinite(n) ? Math.round(n) : null;
        })();
        const apiIsCorrectRaw = result.isCorrect as unknown;
        const apiIsCorrect =
          apiIsCorrectRaw === true || apiIsCorrectRaw === 'true';

        const isCorrect =
          apiIsCorrect ||
          points > 0 ||
          (apiCorrectIndex != null && apiCorrectIndex === index);

        // On a win, always highlight the option the user chose so UI never shows "correct" with a different row marked green.
        const correctIndexForHighlight = isCorrect
          ? index
          : apiCorrectIndex;

        setAnswerState(isCorrect ? 'correct' : 'incorrect');
        setPointsAwarded(points);
        setCorrectAnswerIndex(correctIndexForHighlight);
        
        if (onAnswerResult) {
          onAnswerResult(isCorrect, points);
        }
      } else {
        // Handle error - treat as incorrect
        console.error('[TriviaModal] Submit answer failed:', result.error);
        setAnswerState('incorrect');
        setPointsAwarded(0);
        
        if (onAnswerResult) {
          onAnswerResult(false, 0);
        }
      }
    } catch (error) {
      console.error('[TriviaModal] Error submitting answer:', error);
      setAnswerState('incorrect');
      setPointsAwarded(0);
      
      if (onAnswerResult) {
        onAnswerResult(false, 0);
      }
    }
  };

  const handleClose = () => {
    const wasSkipped = answerState === 'idle';
    setSelectedAnswerIndex(null);
    setCorrectAnswerIndex(null);
    setAnswerState('idle');
    setPointsAwarded(0);
    if (wasSkipped) {
      onSkipped?.();
    }
    onClose();
  };

  const handleShare = async () => {
    try {
      const message = `I just won trivia and earned ${pointsAwarded} points on SampleFinder! 🎉\n\n${APP_STORE_SHARE_SUFFIX}`;
      setIsCapturingShare(true);
      // Wait one frame so close/share controls are hidden before capture.
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      await captureAndShareView(modalRef, message);
    } catch (error) {
      console.error('Error sharing trivia win:', error);
    } finally {
      setIsCapturingShare(false);
    }
  };

  const renderLocationIcon = () => (
    <View style={styles.locationIconContainer}>
      <Image
        source={require('../../assets/locationImage.png')}
        style={styles.locationImage}
        resizeMode="contain"
      />
    </View>
  );

  const renderBrandLogo = () => {
    const logoURL = question.client?.logoURL;
    if (!logoURL) return null;
    return (
      <RoundedLogoImage
        source={{ uri: logoURL }}
        width={80}
        height={80}
        resizeMode="contain"
        backgroundColor={Colors.white}
        containerStyle={styles.brandLogoContainer}
      />
    );
  };

  const renderAnswerButton = (answer: string, index: number) => {
    const isSelected = selectedAnswerIndex === index;
    const isSubmitting = answerState === 'submitting';
    const isCorrectAnswer = correctAnswerIndex === index;
    const showCorrectState =
      (answerState === 'correct' || answerState === 'incorrect' || answerState === 'timesUp') &&
      isCorrectAnswer;
    const showIncorrectState = answerState === 'incorrect' && isSelected && !isCorrectAnswer;

    const getButtonStyle = () => {
      if (showCorrectState) {
        return [styles.answerButton, styles.answerButtonCorrect];
      } else if (showIncorrectState) {
        return [styles.answerButton, styles.answerButtonIncorrect];
      } else if (isSelected && isSubmitting) {
        return [styles.answerButton, styles.answerButtonSelected];
      }
      return styles.answerButton;
    };

    const getTextStyle = () => {
      if (showCorrectState) {
        return [styles.answerButtonText, styles.answerButtonTextCorrect];
      } else if (isSelected && isSubmitting) {
        return [styles.answerButtonText, styles.answerButtonTextSelected];
      } else if (showIncorrectState) {
        return [styles.answerButtonText, styles.answerButtonTextSelected];
      }
      return styles.answerButtonText;
    };

    const ButtonContent = () =>
      isSelected && isSubmitting ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={getTextStyle()}>
          {answer}
        </Text>
      );

    return (
      <TouchableOpacity
        key={index}
        style={getButtonStyle()}
        onPress={() => handleAnswerPress(index)}
        disabled={selectedAnswerIndex !== null || isSubmitting || answerState === 'timesUp'}
        activeOpacity={0.8}
      >
        {showCorrectState ? (
          <LinearGradient
            colors={['#95268B', '#3713DA']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.answerButtonCorrectBorder}
          >
            <View style={styles.answerButtonCorrectInner}>
              <ButtonContent />
            </View>
          </LinearGradient>
        ) : showIncorrectState ? (
          <LinearGradient
            colors={['#F51616', '#8F0D0D']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.answerButtonInner}
          >
            <ButtonContent />
          </LinearGradient>
        ) : (
          <LinearGradient
            colors={[
              '#32004B',
              '#3D1578',
              '#1D0A74',
              '#1D0A74',
              '#6C0331',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.answerButtonInner}
          >
            <ButtonContent />
          </LinearGradient>
        )}
      </TouchableOpacity>
    );
  };

  const renderResult = () => {
    if (answerState === 'submitting') {
      return (
        <View style={styles.resultContainer}>
          <ActivityIndicator size="small" color={Colors.pinDarkBlue} style={styles.checkingSpinner} />
          <Text style={styles.instructionText}>Checking your answer...</Text>
        </View>
      );
    }
    
    if (answerState === 'correct') {
      return (
        <View style={styles.resultContainer}>
          <Text style={styles.correctMessage}>That's Correct!</Text>
          <View style={styles.pointsBadgeContainer}>
            <PointsBadgeIcon size={140} points={pointsAwarded} />
          </View>
          <View style={styles.sparkleContainerTopRight}>
            <SmallStarIcon size={40} />
          </View>
          {!isCapturingShare && (
            <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.8}>
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    } else if (answerState === 'incorrect' || answerState === 'timesUp') {
      return (
        <View style={styles.resultContainer}>
          <View style={styles.incorrectIconContainer}>
            <WrongAnswerIcon size={80} />
          </View>
          <Text style={styles.incorrectMessage}>Better luck next time!</Text>
        </View>
      );
    }
    return (
      <View style={styles.instructionContainer}>
        <Text style={styles.instructionText}>
          Earn points when you answer correctly!
        </Text>
        <View style={styles.countdownContainer}>
          <View style={styles.countdownRing}>
            <Svg width={80} height={80} viewBox="0 0 80 80" style={styles.countdownRingSvg}>
              <Defs>
                <SvgLinearGradient id="countdownRingGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <Stop offset="0%" stopColor="#95268B" />
                  <Stop offset="100%" stopColor="#3713DA" />
                </SvgLinearGradient>
              </Defs>
              <Circle
                cx={40}
                cy={40}
                r={36}
                stroke="url(#countdownRingGradient)"
                strokeWidth={3}
                fill="none"
                strokeDasharray="3 6"
                strokeLinecap="round"
              />
            </Svg>
            <View style={styles.countdownNumberWrapper} pointerEvents="none">
              <MaskedView
                maskElement={
                  <View style={styles.countdownMaskWrapper}>
                    <Text style={styles.countdownValueMask}>{countdown}</Text>
                  </View>
                }
                style={styles.countdownGradientTextWrapper}
              >
                <LinearGradient
                  colors={['#95268B', '#3713DA']}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.countdownGradientTextFill}
                />
              </MaskedView>
            </View>
          </View>
        </View>
      </View>
    );
  };

  // Get brand name for title
  const brandName = question.client?.name || 'Brand';
  const title = `${brandName} Trivia!`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
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
            <TouchableOpacity
              style={[
                styles.closeButton,
                answerState === 'correct' && !closeEnabledAfterWin && styles.closeButtonDisabled,
              ]}
              onPress={handleClose}
              disabled={answerState === 'correct' && !closeEnabledAfterWin}
            >
              <CloseIcon size={24} color={Colors.pinDarkBlue} />
            </TouchableOpacity>
          )}

          {question.client?.logoURL ? renderBrandLogo() : renderLocationIcon()}

          <Text style={styles.title}>{title}</Text>

          <Text style={styles.question}>{question.question}</Text>

          <View style={styles.answersContainer}>
            {answerState === 'correct' && (
              <View style={styles.sparkleContainerRight}>
               <SmallStarIcon size={40} />
              </View>
            )}
             {answerState === 'correct' && (
              <View style={styles.sparkleContainerLeft}>
               <AchievementStartIcon width={40} height={40} />
              </View>
            )}
            {question.answers.map((answer, index) => renderAnswerButton(answer, index))}
          </View>

          {renderResult()}
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
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: SCREEN_WIDTH - 40,
    maxWidth: 400,
    // alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  closeButtonDisabled: {
    opacity: 0.4,
  },
  locationIconContainer: {
    marginTop: 8,
    marginBottom: 16,
    alignSelf: 'center',
    alignItems: 'center',
  },
  locationImage: {
    width: 80,
    height: 80,
  },
  brandLogoContainer: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Quicksand_700Bold',
    marginBottom: 12,
    textAlign: 'center',
    color: Colors.pinBlueBlack,
  },
  question: {
    fontSize: 16,
    color: Colors.pinDarkBlue,
    fontFamily: 'Quicksand_500Medium',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  answersContainer: {
    width: '100%',
    marginBottom: 20,
    alignItems: 'center',
  },
  answerButton: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    width: '60%'
  },
  answerButtonInner: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  answerButtonSelected: {
    borderColor: '#6B46C1',
    backgroundColor: '#6B46C1',
  },
  answerButtonCorrect: {},
  answerButtonCorrectBorder: {
    padding: 2,
    borderRadius: 12,
  },
  answerButtonCorrectInner: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  answerButtonIncorrect: {
    borderWidth: 0,
  },
  answerButtonText: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 24,
    includeFontPadding: false,
  },
  answerButtonTextSelected: {
    color: '#FFFFFF',
  },
  answerButtonTextCorrect: {
    color: Colors.blueColorMode,
  },
  sparkleContainer: {
    position: 'absolute',
    right: 16,
    top: '50%',
    flexDirection: 'row',
    transform: [{ translateY: -12 }],
    gap: 8,
  },
  sparkleContainerLeft: {
    position: 'absolute',
    left: 10,
    top: '70%',
    flexDirection: 'column',
    transform: [{ translateY: -24 }],
    gap: 8,
  },
  sparkleContainerRight: {
    position: 'absolute',
    right: 10,
    top: '20%',
    flexDirection: 'column',
    transform: [{ translateY: -24 }],
    gap: 8,
  },
  sparkleContainerTopRight:{
    position: 'absolute',
    right: 10,
    top: '50%',
    flexDirection: 'column',
    transform: [{ translateY: -24 }],
    gap: 8,
  },
  resultContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  correctMessage: {
    fontSize: 20,
    fontFamily: 'Quicksand_700Bold',
    color:Colors.pinBlueBlack,
    marginBottom: 20,
    textAlign: 'center',
  },
  pointsBadgeContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  checkingSpinner: {
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: Colors.pinDarkBlue,
    marginBottom: 16,
    paddingHorizontal: 12,
    fontWeight: '400',
    fontFamily: 'Quicksand_500Medium',
    textAlign: 'center',
  },
  countdownContainer: {
    width: 80,
    height: 80,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownRing: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  countdownRingSvg: {
    position: 'absolute',
    width: 80,
    height: 80,
  },
  countdownNumberWrapper: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownGradientTextWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  countdownGradientTextFill: {
    width: 56,
    height: 56,
  },
  countdownMaskWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
  },
  countdownValueMask: {
    fontSize: 40,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  incorrectIconContainer: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incorrectMessage: {
    fontSize: 16,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
  },
  shareButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.pinDarkBlue,
    borderRadius: 12,
  },
  shareButtonText: {
    fontSize: 16,
    fontFamily: 'Quicksand_600SemiBold',
    color: '#FFFFFF',
  },
});
