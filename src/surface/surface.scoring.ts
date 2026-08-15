/**
 * Pure scoring + labelling. No Nest, no Prisma — so the seed script, the
 * service and the unit tests all share one definition of the formula and it
 * cannot drift between them.
 *
 * Nothing in this file calls an LLM. "Things for today" is arithmetic over
 * columns that are already on the row, which is why the home screen costs
 * zero tokens no matter how often it is loaded.
 */

export type ItemKind = 'TASK' | 'REFERENCE' | 'WAITING' | 'REMEMBER';
export type ItemStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface ScorableItem {
  kind: ItemKind;
  status: ItemStatus;
  importance: number;
  messageCount: number;
  occurredAt: Date;
  lastSurfacedAt?: Date | null;
  personName?: string | null;
}

const DAY_MS = 86_400_000;

/** How intrinsically loud a kind is before time is taken into account. */
const KIND_WEIGHT: Record<ItemKind, number> = {
  WAITING: 1.0, // someone else is blocking you — the most useful thing to see
  REMEMBER: 0.9, // you explicitly asked to be reminded
  TASK: 0.7,
  REFERENCE: 0.2, // context, not a call to action
};

/**
 * Importance does not scale the decay — it extends the *half-life*. That
 * distinction matters: a fixed 5-day constant drives exp(-60/5) to ~6e-6, at
 * which point multiplying by importance cannot separate a release blocker from
 * a throwaway link (both round to zero). Scaling the half-life instead encodes
 * the real claim — important things stay relevant for longer.
 *
 *   importance 0.15 -> ~9 day half-life   (a stale link disappears)
 *   importance 0.90 -> ~28 day half-life  (a stale blocker persists)
 */
const SURFACE_HALF_LIFE_MIN_DAYS = 5;
const SURFACE_HALF_LIFE_RANGE_DAYS = 25;

/** Gentler across the board: a direct question should still find old things. */
const CONTEXT_HALF_LIFE_MIN_DAYS = 14;
const CONTEXT_HALF_LIFE_RANGE_DAYS = 30;

/** Below this a row is not worth anyone's attention; it drops off the home list. */
export const MIN_SURFACE_SCORE = 0.02;

/** An OPEN item nobody has touched in this long reads as "may have gone away". */
export const DORMANT_AFTER_DAYS = 14;

/** Past this, an item is labelled "may be stale" before it reaches the model. */
export const STALE_AFTER_DAYS = 30;

export function ageInDays(occurredAt: Date, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - occurredAt.getTime()) / DAY_MS);
}

export function surfaceRecencyDecay(occurredAt: Date, importance: number, now?: Date): number {
  const halfLife =
    SURFACE_HALF_LIFE_MIN_DAYS + SURFACE_HALF_LIFE_RANGE_DAYS * clamp01(importance);
  return Math.exp(-ageInDays(occurredAt, now) / halfLife);
}

export function contextRecencyDecay(occurredAt: Date, importance: number, now?: Date): number {
  const halfLife =
    CONTEXT_HALF_LIFE_MIN_DAYS + CONTEXT_HALF_LIFE_RANGE_DAYS * clamp01(importance);
  return Math.exp(-ageInDays(occurredAt, now) / halfLife);
}

export function isDormant(item: ScorableItem, now?: Date): boolean {
  return (
    item.status === 'OPEN' &&
    item.messageCount <= 1 &&
    ageInDays(item.occurredAt, now) > DORMANT_AFTER_DAYS
  );
}

/**
 * Importance multiplies rather than adds. That is the whole point: a stale
 * *minor* item decays toward zero, while a stale *major* one ("RTL support
 * before release") keeps earning its place. The 0.4 floor stops a
 * low-importance item from being erased outright.
 */
export function computeSurfaceScore(item: ScorableItem, now: Date = new Date()): number {
  if (item.status !== 'OPEN') return 0;

  const importance = clamp01(item.importance);

  const base =
    KIND_WEIGHT[item.kind] *
    (0.4 + 0.6 * importance) *
    surfaceRecencyDecay(item.occurredAt, importance, now) *
    dormancyFactor(item, now);

  // Only *additional* messages count as heat — otherwise every single-message
  // item gets the same flat bonus, which is just noise added to every row.
  const heat = (Math.min(item.messageCount, 5) - 1) * 0.18;

  // Rotation, so the same four rows don't sit there every day.
  const recentlyShown =
    item.lastSurfacedAt && now.getTime() - item.lastSurfacedAt.getTime() < DAY_MS ? 0.4 : 0;

  return round4(Math.max(0, base + heat - recentlyShown));
}

/**
 * Going quiet is weak evidence a thing resolved itself — but only weak, and
 * less so the more it mattered. Applied as a multiplier scaled by (1 -
 * importance) so a quiet release blocker is barely touched while a quiet
 * nice-to-have fades. A flat subtraction here would wipe out low-scoring rows
 * outright regardless of importance.
 */
function dormancyFactor(item: ScorableItem, now?: Date): number {
  if (!isDormant(item, now)) return 1;
  const ramp = Math.min((ageInDays(item.occurredAt, now) - DORMANT_AFTER_DAYS) / 30, 1);
  return 1 - 0.35 * (1 - clamp01(item.importance)) * ramp;
}

/**
 * The right-hand text on a row — "4 messages", "waiting on Ravi". Derived, never
 * generated: the user should not be able to tell that a model was involved.
 */
export function metaLabel(item: ScorableItem, now: Date = new Date()): string {
  if (item.kind === 'WAITING' && item.personName) return `waiting on ${item.personName}`;
  if (item.messageCount > 1) return `${item.messageCount} messages`;
  if (isDormant(item, now)) return 'may have gone away';
  return sinceLabel(item.occurredAt, now);
}

/** "today" · "yesterday" · "since Thursday" · "3 weeks ago" · "12 March" */
export function sinceLabel(occurredAt: Date, now: Date = new Date()): string {
  const days = Math.floor(ageInDays(occurredAt, now));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) {
    return `since ${occurredAt.toLocaleDateString('en-GB', { weekday: 'long' })}`;
  }
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return occurredAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

/**
 * Age as the *model* sees it. Deliberately blunter than `sinceLabel` so the
 * answer can hedge — an item tagged "may be stale" should not be reported as
 * current status.
 */
export function ageLabel(occurredAt: Date, now: Date = new Date()): string {
  const days = Math.floor(ageInDays(occurredAt, now));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'about a month ago' : `${months} months ago`;
}

export function isStale(occurredAt: Date, now: Date = new Date()): boolean {
  return ageInDays(occurredAt, now) > STALE_AFTER_DAYS;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
