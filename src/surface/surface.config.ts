import type { ItemKind } from './surface.scoring';

export const SURFACE_KIND_WEIGHT: Record<ItemKind, number> = {
  WAITING: 1.0,
  REMEMBER: 0.9,
  TASK: 0.7,
  REFERENCE: 0.2,
};

export const SURFACE_SCORING = {
  halfLifeMinDays: 5,
  halfLifeRangeDays: 25,
  contextHalfLifeMinDays: 14,
  contextHalfLifeRangeDays: 30,
  minScore: 0.02,
  dormantAfterDays: 14,
  staleAfterDays: 30,
  dormancyRampDays: 30,
  dormancyMaxPenalty: 0.35,
  messageHeatPerAdditional: 0.18,
  maxHeatMessages: 5,
  recentlyShownWithinMs: 86_400_000,
  recentlyShownPenalty: 0.4,
} as const;
