import { Query } from 'react-native-appwrite';
import { DATABASE_ID, TIERS_TABLE_ID, tablesDB } from './config';
import type { TierRow } from './types';

/**
 * Fetch all tiers ordered by their order field
 */
export const fetchTiers = async (): Promise<TierRow[]> => {
  if (!DATABASE_ID || !TIERS_TABLE_ID) {
    throw new Error('Database ID or Tiers Table ID not configured. Please check your .env file.');
  }

  try {
    const response = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TIERS_TABLE_ID,
      queries: [Query.orderAsc('order')]
    });

    return response.rows as unknown as TierRow[];
  } catch (error: any) {
    console.error('Error fetching tiers:', error);
    throw error;
  }
};

/**
 * Get user's current tier based on their total points
 */
export const getUserCurrentTier = (tiers: TierRow[], totalPoints: number): TierRow | null => {
  if (!tiers.length) return null;

  // Sort by requiredPoints descending to find highest achieved tier
  const sortedTiers = [...tiers].sort((a, b) => b.requiredPoints - a.requiredPoints);
  
  for (const tier of sortedTiers) {
    if (totalPoints >= tier.requiredPoints) {
      return tier;
    }
  }

  // Return first tier if user hasn't reached any
  return tiers[0];
};

const normalizeTierKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Resolve a stored `tierLevel` string to a TierRow by name (case/spacing/punctuation
 * insensitive) or by trailing number (e.g. "2", "tier 2", "level 2"). Returns null
 * when the stored value can't be matched against any known tier.
 */
export const resolveCanonicalTier = (
  tiers: TierRow[],
  tierLevelValue: string | null | undefined
): TierRow | null => {
  if (!tierLevelValue) return null;

  const normalizedValue = normalizeTierKey(tierLevelValue);
  if (!normalizedValue) return null;

  const byName = tiers.find((tier) => normalizeTierKey(tier.name ?? '') === normalizedValue);
  if (byName) return byName;

  const tierNumberMatch = tierLevelValue.match(/\d+/);
  if (tierNumberMatch) {
    const tierOrder = Number.parseInt(tierNumberMatch[0], 10);
    if (Number.isFinite(tierOrder)) {
      const byOrder = tiers.find((tier) => (tier.order ?? 0) === tierOrder);
      if (byOrder) return byOrder;
    }
  }

  return null;
};

/**
 * Pick the tier the user has earned: the higher of (a) the stored tierLevel
 * (resolved against the tier table) and (b) the tier their current points qualify
 * for. This heals legacy or out-of-sync profiles where tierLevel lags behind points.
 */
export const resolveEffectiveTier = (
  tiers: TierRow[],
  storedTierLevel: string | null | undefined,
  totalPoints: number
): TierRow | null => {
  if (!tiers.length) return null;
  const canonical = resolveCanonicalTier(tiers, storedTierLevel ?? '');
  const pointsTier = getUserCurrentTier(tiers, totalPoints);
  if (!canonical) return pointsTier;
  if (!pointsTier) return canonical;
  return (canonical.order ?? 0) >= (pointsTier.order ?? 0) ? canonical : pointsTier;
};

/**
 * Get user's next tier (the one they're working towards)
 */
export const getUserNextTier = (tiers: TierRow[], totalPoints: number): TierRow | null => {
  if (!tiers.length) return null;

  // Sort by requiredPoints ascending
  const sortedTiers = [...tiers].sort((a, b) => a.requiredPoints - b.requiredPoints);
  
  for (const tier of sortedTiers) {
    if (totalPoints < tier.requiredPoints) {
      return tier;
    }
  }

  // User has achieved all tiers
  return null;
};
