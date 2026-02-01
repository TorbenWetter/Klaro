/**
 * Centralized Configuration
 *
 * Single source of truth for all constants, thresholds, and configuration values.
 * Import from here instead of scattered across multiple files.
 */

import type { MatchWeights } from './utils/element-tracker/types';

// =============================================================================
// Match Weights (shared between ElementTracker and TreeTracker)
// =============================================================================

/**
 * Default weights for element matching.
 *
 * DESIGN RATIONALE:
 * - DOM structure (tag, ancestors, position) is most reliable for re-identification
 * - Text content is deprioritized because dynamic sites frequently change text
 * - Identity attributes (testId, htmlId) are highest when present
 * - Visual position is used as a strong signal when structure matches
 */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  // Identity (exact match when present)
  testId: 1.0,
  htmlId: 0.9,

  // Structural - HIGHEST PRIORITY
  tagName: 0.95,
  ancestorPath: 0.9,
  siblingIndex: 0.85,

  // Position - HIGH PRIORITY
  boundingBox: 0.8,

  // Semantic (ARIA/accessibility attributes)
  role: 0.7,
  ariaLabel: 0.6,
  name: 0.7,

  // Content - LOWER PRIORITY (changes frequently)
  textContent: 0.3,
  placeholder: 0.5,
  alt: 0.4,
  href: 0.6,

  // Contextual
  neighborText: 0.4,

  // Deprioritized
  className: 0.1,
};

// =============================================================================
// Main Configuration Object
// =============================================================================

export const CONFIG = {
  /**
   * Element and tree tracking configuration
   */
  tracking: {
    /** Minimum confidence to accept a fingerprint match (0-1) */
    confidenceThreshold: 0.4,
    /** Time to wait before declaring element lost, in ms */
    gracePeriodMs: 300,
    /** Maximum nodes to track in the tree */
    maxNodes: 5000,
    /** Maximum tree nesting depth */
    maxDepth: 50,
    /** Weights for matching algorithm */
    weights: DEFAULT_MATCH_WEIGHTS,
  },

  /**
   * Semantic tree store configuration
   */
  store: {
    /** Maximum elements to keep in memory (LRU eviction) */
    maxElements: 500,
    /** Maximum URLs to store expand state for */
    maxStoredUrls: 100,
    /** Storage key for expand states */
    expandStateKey: 'klaro_expand_states',
  },

  /**
   * LLM service configuration
   */
  llm: {
    /** Debounce delay for per-element enhancement, in ms */
    debounceMs: 500,
    /** Length of short IDs sent to LLM (to reduce tokens) */
    shortIdLength: 12,
    /** Max tokens for single label enhancement */
    maxTokensLabel: 256,
    /** Max tokens for batch label enhancement */
    maxTokensBatch: 4096,
    /** Temperature for deterministic responses */
    temperature: 0.2,
  },

  /**
   * UI timing configuration
   */
  ui: {
    /** Debounce delay for input changes, in ms */
    inputDebounceMs: 300,
    /** Cooldown between manual scans, in ms */
    cooldownMs: 10000,
    /** Debounce delay for URL change detection, in ms */
    urlChangeDebounceMs: 500,
    /** Interval for cooldown timer updates, in ms */
    cooldownUpdateIntervalMs: 100,
    /** Lockout time after user starts editing, in ms */
    editingLockoutMs: 2000,
  },

  /**
   * Modal detection configuration
   */
  modal: {
    /** CSS selectors for modal detection */
    selectors:
      '[role="dialog"], [aria-modal="true"], [data-modal], .modal, [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="popup"], [class*="Popup"], [class*="overlay"][class*="content"], [data-state="open"]',
  },
} as const;

// =============================================================================
// Type Exports
// =============================================================================

export type Config = typeof CONFIG;
export type TrackingConfig = typeof CONFIG.tracking;
export type StoreConfig = typeof CONFIG.store;
export type LLMConfig = typeof CONFIG.llm;
export type UIConfig = typeof CONFIG.ui;
