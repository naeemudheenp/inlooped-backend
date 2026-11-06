import {
  MIN_SURFACE_SCORE,
  ScorableItem,
  ageLabel,
  computeSurfaceScore,
  isStale,
  metaLabel,
} from './surface.scoring';
import { SURFACE_KIND_WEIGHT, SURFACE_SCORING } from './surface.config';

const DAY = 86_400_000;
const NOW = new Date('2026-08-09T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function item(over: Partial<ScorableItem> = {}): ScorableItem {
  return {
    kind: 'TASK',
    status: 'OPEN',
    importance: 0.5,
    messageCount: 1,
    occurredAt: daysAgo(1),
    lastSurfacedAt: null,
    personName: null,
    ...over,
  };
}

describe('surface scoring — age vs importance', () => {
  it('uses the centralized kind weights for Today ranking', () => {
    expect(SURFACE_KIND_WEIGHT).toEqual({
      WAITING: 1.0,
      REMEMBER: 0.9,
      TASK: 0.7,
      REFERENCE: 0.2,
    });
    expect(computeSurfaceScore(item({ kind: 'WAITING' }), NOW)).toBeGreaterThan(
      computeSurfaceScore(item({ kind: 'TASK' }), NOW),
    );
    expect(SURFACE_SCORING.minScore).toBe(MIN_SURFACE_SCORE);
  });

  it('ranks a fresh item above an equally important old one', () => {
    const fresh = computeSurfaceScore(item({ occurredAt: daysAgo(1) }), NOW);
    const old = computeSurfaceScore(item({ occurredAt: daysAgo(30) }), NOW);
    expect(fresh).toBeGreaterThan(old);
  });

  /**
   * The regression this whole design exists to prevent. With a fixed half-life,
   * exp(-60/5) is ~6e-6 and importance cannot separate these two — both round
   * to zero and a release blocker vanishes alongside a throwaway link.
   */
  it('separates two identically-aged items by importance alone', () => {
    const blocker = computeSurfaceScore(
      item({ occurredAt: daysAgo(60), importance: 0.9 }),
      NOW,
    );
    const trivia = computeSurfaceScore(
      item({ occurredAt: daysAgo(60), importance: 0.15, kind: 'REFERENCE' }),
      NOW,
    );

    expect(blocker).toBeGreaterThan(MIN_SURFACE_SCORE);
    expect(trivia).toBeLessThan(MIN_SURFACE_SCORE);
    expect(blocker).toBeGreaterThan(trivia * 50);
  });

  it('lets a two-month-old blocker outrank a fresh trivial reference', () => {
    const blocker = computeSurfaceScore(
      item({ occurredAt: daysAgo(60), importance: 0.95 }),
      NOW,
    );
    const fresh = computeSurfaceScore(
      item({ occurredAt: daysAgo(2), importance: 0.05, kind: 'REFERENCE' }),
      NOW,
    );
    expect(blocker).toBeGreaterThan(fresh);
  });

  it('counts only additional messages as heat', () => {
    const one = computeSurfaceScore(item({ messageCount: 1 }), NOW);
    const four = computeSurfaceScore(item({ messageCount: 4 }), NOW);
    expect(four).toBeGreaterThan(one);
  });

  it('scores resolved items at zero so they leave the list', () => {
    expect(computeSurfaceScore(item({ status: 'RESOLVED' }), NOW)).toBe(0);
    expect(computeSurfaceScore(item({ status: 'DISMISSED' }), NOW)).toBe(0);
  });

  it('demotes something already shown today so the list rotates', () => {
    const unseen = computeSurfaceScore(item(), NOW);
    const seen = computeSurfaceScore(item({ lastSurfacedAt: daysAgo(0.1) }), NOW);
    expect(seen).toBeLessThan(unseen);
  });

  it('never returns a negative score', () => {
    const score = computeSurfaceScore(
      item({ importance: 0, occurredAt: daysAgo(400), lastSurfacedAt: NOW }),
      NOW,
    );
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('tolerates a nonsense importance from the model', () => {
    for (const bad of [NaN, -5, 99, Infinity]) {
      const score = computeSurfaceScore(item({ importance: bad }), NOW);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('labels', () => {
  it('prefers waiting-on over every other meta', () => {
    const label = metaLabel(
      item({ kind: 'WAITING', personName: 'Ravi', messageCount: 3 }),
      NOW,
    );
    expect(label).toBe('waiting on Ravi');
  });

  it('shows a message count when a thread is hot', () => {
    expect(metaLabel(item({ messageCount: 4 }), NOW)).toBe('4 messages');
  });

  it('says an item may have gone away once it goes quiet', () => {
    expect(metaLabel(item({ occurredAt: daysAgo(24) }), NOW)).toBe('may have gone away');
  });

  it('falls back to a relative time', () => {
    expect(metaLabel(item({ occurredAt: NOW }), NOW)).toBe('today');
    expect(metaLabel(item({ occurredAt: daysAgo(1) }), NOW)).toBe('yesterday');
  });

  /** The model must be able to hedge, so ages reach it bluntly. */
  it('gives the model a blunt age and a staleness flag', () => {
    expect(ageLabel(daysAgo(3), NOW)).toBe('3 days ago');
    expect(ageLabel(daysAgo(60), NOW)).toBe('2 months ago');
    expect(isStale(daysAgo(3), NOW)).toBe(false);
    expect(isStale(daysAgo(60), NOW)).toBe(true);
  });
});
