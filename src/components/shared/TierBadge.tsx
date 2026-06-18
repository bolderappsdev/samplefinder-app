import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Monicon } from '@monicon/native';
import { Colors } from '@/constants/Colors';
import { getTierDisplayParts } from '@/utils/formatters';

interface TierBadgeProps {
  /** Tier to render. Only the name and image are needed. */
  tier: { name: string; imageURL?: string | null };
  /** Width/height of the badge image and fallback seal. Defaults to the
   *  Achievements-screen size. */
  size?: number;
}

/**
 * The canonical tier badge: the remote tier image (which already includes the
 * tier number/ribbon) with a seal fallback, and the tier name beneath it.
 * Shared by the Achievements/Promotions "earned" card and the Profile screen
 * so both surfaces render an identical badge.
 */
const TierBadge: React.FC<TierBadgeProps> = ({ tier, size = 100 }) => {
  const [imageError, setImageError] = useState(false);

  // Reset on image change so a newly-resolved tier re-attempts its image
  // instead of being stuck on a previous load failure.
  useEffect(() => {
    setImageError(false);
  }, [tier.imageURL]);

  const { main, subtitle } = getTierDisplayParts(tier.name);

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        {tier.imageURL && !imageError ? (
          <Image
            source={{ uri: tier.imageURL }}
            style={{ width: size, height: size }}
            resizeMode="contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <Monicon name="ph:seal-fill" size={size} color={Colors.pinDarkBlue} />
        )}
      </View>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{main}</Text>
        {subtitle ? <Text style={styles.nameSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'baseline',
    gap: 4,
  },
  name: {
    fontSize: 22,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
  },
  nameSubtitle: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinDarkBlue,
    textAlign: 'center',
  },
});

export default TierBadge;
