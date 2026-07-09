import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ModalBackdrop from '@/components/shared/ModalBackdrop';
import CloseIcon from '@/components/shared/CloseIcon';
import { Colors } from '@/constants/Colors';
import type { ActivePopup } from '@/lib/database/popups';

interface PopupImageModalProps {
  visible: boolean;
  popup: ActivePopup;
  onClose: () => void;
  onPress: () => void;
}

const SCREEN = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN.width * 0.85, 400);
const MAX_IMAGE_HEIGHT = SCREEN.height * 0.55;
const DEFAULT_ASPECT_RATIO = 4 / 5;
// Fixed height for the loading placeholder, shown until the real aspect ratio
// is known — stable, so nothing shifts when the image itself arrives.
const PLACEHOLDER_IMAGE_HEIGHT = Math.min(CARD_WIDTH * 0.66, MAX_IMAGE_HEIGHT);
// Fixed chrome around the description: panel paddingTop (14) + paddingBottom (18)
// + title line (~20) + two 10px gaps + CTA button (~48) + a little slack.
const CHROME_HEIGHT = 150;

/**
 * Pop-up banner (SAM-5) — adaptive stacked card. Image on top; an optional
 * white panel below shows title, description, and a "Learn More" button when
 * present. Only the ✕ dismisses (Android back is ignored). Tapping the banner
 * or button opens the link (handled by the parent) and then closes. A broken
 * image URL closes the modal instead of showing an empty card.
 */
export const PopupImageModal = ({ visible, popup, onClose, onPress }: PopupImageModalProps) => {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [sized, setSized] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const closedRef = useRef(false);

  const closeOnce = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  };

  // Reset the one-shot close guard when a different popup is shown.
  useEffect(() => {
    closedRef.current = false;
    setSized(false);
    setLoadFailed(false);
  }, [popup.$id]);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (mounted) setLoadFailed(true);
    }, 6000);
    Image.getSize(
      popup.imageUrl,
      (width, height) => {
        clearTimeout(timer);
        if (!mounted) return;
        if (width > 0 && height > 0) setAspectRatio(width / height);
        setSized(true);
      },
      () => {
        clearTimeout(timer);
        if (mounted) setLoadFailed(true);
      }
    );
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [popup.imageUrl]);

  useEffect(() => {
    if (visible && loadFailed) closeOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loadFailed]);

  if (loadFailed) return null;

  const title = popup.title?.trim() ?? '';
  const description = popup.description?.trim() ?? '';
  const hasLink = !!popup.link;
  const hasTitle = title.length > 0;
  const hasDescription = description.length > 0;
  const hasPanel = hasTitle || hasDescription || hasLink;

  const imageHeight = Math.min(CARD_WIDTH / aspectRatio, MAX_IMAGE_HEIGHT);
  // Keep the image and ✕ fixed; let the description scroll within whatever
  // space remains under the ~85%-of-screen card cap, so title + description +
  // CTA are always on-screen regardless of image aspect ratio or text length.
  const descMaxHeight = Math.max(72, SCREEN.height * 0.85 - imageHeight - CHROME_HEIGHT);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        /* ✕-only: swallow Android hardware-back so it can't dismiss the ad. */
      }}
    >
      <ModalBackdrop containerStyle={styles.backdrop}>
        <View style={styles.card}>
          <Pressable
            accessibilityRole={hasLink ? 'link' : 'image'}
            accessibilityLabel={title || 'Promotion'}
            onPress={hasLink ? onPress : undefined}
            disabled={!hasLink}
          >
            {sized ? (
              <Image
                source={{ uri: popup.imageUrl }}
                style={[
                  styles.image,
                  { width: CARD_WIDTH, height: imageHeight },
                  hasPanel ? styles.imageTopRadius : styles.imageAllRadius,
                ]}
                resizeMode="contain"
                onError={() => setLoadFailed(true)}
              />
            ) : (
              <View
                style={[
                  styles.image,
                  styles.imagePlaceholder,
                  { width: CARD_WIDTH, height: PLACEHOLDER_IMAGE_HEIGHT },
                  hasPanel ? styles.imageTopRadius : styles.imageAllRadius,
                ]}
              >
                <ActivityIndicator size="large" color={Colors.blueColorMode} />
              </View>
            )}
          </Pressable>

          {sized && hasPanel && (
            <View style={styles.panel}>
              {hasTitle && <Text style={styles.title} numberOfLines={2}>{title}</Text>}
              {hasDescription && (
                <ScrollView
                  style={{ maxHeight: descMaxHeight }}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <Text style={styles.description}>{description}</Text>
                </ScrollView>
              )}
              {hasLink && (
                <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Learn more">
                  <LinearGradient
                    colors={['#3D1578', '#1D0A74', '#6C0331']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.cta}
                  >
                    <Text style={styles.ctaText}>Learn More</Text>
                  </LinearGradient>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            style={styles.closeButton}
            onPress={closeOnce}
            accessibilityRole="button"
            accessibilityLabel="Close pop-up"
            hitSlop={12}
          >
            <CloseIcon size={22} color={Colors.blueColorMode} />
          </Pressable>
        </View>
      </ModalBackdrop>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: CARD_WIDTH,
    maxHeight: SCREEN.height * 0.85,
    backgroundColor: Colors.white,
    borderRadius: 20,
  },
  image: { backgroundColor: 'rgba(0, 0, 0, 0.06)' },
  imageTopRadius: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  imageAllRadius: { borderRadius: 20 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  panel: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 10 },
  title: { fontFamily: 'Quicksand_700Bold', fontSize: 18, color: Colors.blueColorMode },
  description: {
    fontFamily: 'Quicksand_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.grayText,
  },
  cta: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: 'Quicksand_600SemiBold', fontSize: 15, color: Colors.white },
  closeButton: {
    position: 'absolute',
    top: -12,
    right: -12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});
