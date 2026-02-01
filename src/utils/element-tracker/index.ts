/**
 * Element Tracker Module
 *
 * Provides fingerprint-based element identification that survives DOM re-renders.
 *
 * @deprecated The ElementTracker class has been replaced by TreeTracker
 * (src/utils/tree-tracker). Import directly from submodules instead:
 *
 * - types.ts: ElementFingerprint, MatchWeights, TrackerConfig
 * - fingerprint.ts: createFingerprint, updateFingerprint
 * - matcher.ts: findBestMatch, matchAll, calculateConfidence
 * - similarity.ts: textSimilarity, positionSimilarity
 * - storage.ts: TabStorage
 */

// Re-exports for backwards compatibility
export * from './types';
export * from './fingerprint';
export * from './matcher';
export * from './similarity';
export * from './storage';
