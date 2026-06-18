import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/stores/authStore';
import { fetchTiers, getUnreadNotifications, getUserProfile } from '@/lib/database';
import type { UserNotification, TierRow } from '@/lib/database';
import type { Tier } from '@/screens/tabs/promotions/components';

export interface AwardedTier {
  tier: Tier;
  notificationId?: string;
  /** User total points when the award was detected (for tier 1 welcome copy). */
  userTotalPoints?: number;
}

const getLastSeenTierStorageKey = (authId: string) => `lastSeenTierLevel:${authId}`;

const normalizeTierKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const toTierForModal = (tier: TierRow): Tier => ({
  id: tier.$id,
  name: tier.name,
  currentPoints: tier.requiredPoints,
  requiredPoints: tier.requiredPoints,
  badgeEarned: true,
  imageURL: tier.imageURL ?? null,
  order: tier.order,
});

const resolveTierFromNotification = (
  tiers: TierRow[],
  notification: UserNotification
): TierRow | null => {
  const newTierId = notification.data?.newTierId;
  if (typeof newTierId === 'string' && newTierId.trim().length > 0) {
    const byId = tiers.find((tier) => tier.$id === newTierId);
    if (byId) return byId;
  }

  const newTierName = notification.data?.newTierName;
  if (typeof newTierName === 'string' && newTierName.trim().length > 0) {
    const normalizedName = normalizeTierKey(newTierName);
    const byName = tiers.find((tier) => normalizeTierKey(tier.name ?? '') === normalizedName);
    if (byName) return byName;
  }

  return null;
};

const resolveTierFromTierLevel = (tiers: TierRow[], tierLevel: string): TierRow | null => {
  const normalizedValue = normalizeTierKey(tierLevel);
  if (!normalizedValue) return null;

  const byName = tiers.find((tier) => normalizeTierKey(tier.name ?? '') === normalizedValue);
  if (byName) return byName;

  const tierNumberMatch = tierLevel.match(/\d+/);
  if (tierNumberMatch) {
    const tierOrder = Number.parseInt(tierNumberMatch[0], 10);
    if (Number.isFinite(tierOrder)) {
      const byOrder = tiers.find((tier) => (tier.order ?? 0) === tierOrder);
      if (byOrder) return byOrder;
    }
  }

  return null;
};

export const syncTierAwards = async (): Promise<AwardedTier[]> => {
  const user = useAuthStore.getState().user;
  if (!user) return [];

  const [profile, tiers, unreadNotifications] = await Promise.all([
    getUserProfile(user.$id),
    fetchTiers(),
    getUnreadNotifications(user.$id, 50),
  ]);
  if (!profile || tiers.length === 0) return [];

  const awardedTiers: AwardedTier[] = [];
  const queuedTierIds = new Set<string>();

  for (const notification of unreadNotifications) {
    if (notification.type !== 'tierChanged' || notification.isRead) {
      continue;
    }

    const tier = resolveTierFromNotification(tiers, notification);
    if (!tier || queuedTierIds.has(tier.$id)) {
      continue;
    }

    queuedTierIds.add(tier.$id);
    awardedTiers.push({
      tier: toTierForModal(tier),
      notificationId: notification.id,
      userTotalPoints: profile.totalPoints ?? 0,
    });
  }

  const currentTierLevel = profile.tierLevel?.trim() ?? '';
  const lastSeenTierLevelRaw = await AsyncStorage.getItem(getLastSeenTierStorageKey(user.$id));
  const lastSeenTierLevel = lastSeenTierLevelRaw?.trim() ?? '';

  if (!lastSeenTierLevelRaw) {
    await AsyncStorage.setItem(getLastSeenTierStorageKey(user.$id), currentTierLevel);
    return awardedTiers;
  }

  if (currentTierLevel !== lastSeenTierLevel && currentTierLevel.length > 0) {
    const currentTier = resolveTierFromTierLevel(tiers, currentTierLevel);
    if (currentTier && !queuedTierIds.has(currentTier.$id)) {
      awardedTiers.push({
        tier: toTierForModal(currentTier),
        userTotalPoints: profile.totalPoints ?? 0,
      });
    }
  }

  await AsyncStorage.setItem(getLastSeenTierStorageKey(user.$id), currentTierLevel);
  return awardedTiers;
};
