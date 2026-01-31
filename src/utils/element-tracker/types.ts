/**
 * Element Tracker Types
 *
 * Stable element fingerprinting and re-identification across framework re-renders.
 * Based on Similo's 14-attribute approach with extensions for isotopic context.
 */

// =============================================================================
// Fingerprint Types
// =============================================================================

/**
 * Stable fingerprint capturing element identity.
 * Survives DOM destruction/recreation by frameworks like React, Vue, Angular.
 */
export interface ElementFingerprint {
  // === Unique ID (assigned by us, survives in storage, not on DOM) ===
  id: string;

  // === Priority 1: Explicit identifiers (most stable, weight 1.0) ===
  /** data-testid, data-test, data-cy attributes */
  testId: string | null;
  /** HTML id attribute (if stable, not auto-generated) */
  htmlId: string | null;

  // === Priority 2: Semantic/ARIA (very stable, weight 0.85) ===
  /** Explicit or implicit ARIA role */
  role: string | null;
  /** aria-label attribute */
  ariaLabel: string | null;
  /** Form element name attribute */
  name: string | null;

  // === Priority 3: Content-based (high value, use fuzzy matching, weight 0.75) ===
  /** Normalized visible text, truncated to 100 chars */
  textContent: string;
  /** Placeholder attribute for inputs */
  placeholder: string | null;
  /** Current value for inputs */
  value: string | null;
  /** Alt text for images */
  alt: string | null;
  /** Title attribute */
  title: string | null;
  /** Href for links (normalized) */
  href: string | null;

  // === Priority 4: Structural (medium stability, weight 0.4-0.5) ===
  /** HTML tag name (lowercase) */
  tagName: string;
  /** Input type attribute (text, submit, checkbox, etc.) */
  inputType: string | null;
  /** Ancestor path (2-4 levels up, stops at landmarks) */
  ancestorPath: AncestorInfo[];
  /** Index among same-tag siblings */
  siblingIndex: number;
  /** Index among all siblings */
  childIndex: number;
  /** Closest landmark element (nav, main, section, form, etc.) */
  nearestLandmark: LandmarkInfo | null;

  // === Priority 5: Isotopic/Neighbor Context (medium stability, weight 0.3) ===
  /** Text content of surrounding elements for contextual anchoring */
  neighborText: NeighborText;

  // === Priority 6: Visual (fallback only, weight 0.15-0.2) ===
  /** Element bounding box in pixels */
  boundingBox: BoundingBox;
  /** Position as percentage of viewport (resize-resilient) */
  viewportPercent: ViewportPercent;
  /** Width / height ratio */
  aspectRatio: number;

  // === Metadata ===
  /** When fingerprint was created/updated */
  timestamp: number;
  /** Last match confidence (1.0 for newly created) */
  lastMatchConfidence: number;
}

/** Bounding box in pixels */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position as percentage of viewport */
export interface ViewportPercent {
  xPercent: number;
  yPercent: number;
}

/** Text content of neighboring elements for isotopic anchoring */
export interface NeighborText {
  /** Text of previous sibling (truncated to 50 chars) */
  previous: string | null;
  /** Text of next sibling (truncated to 50 chars) */
  next: string | null;
  /** Parent's text excluding this element (truncated to 50 chars) */
  parent: string | null;
}

/** Ancestor information for structural fingerprinting */
export interface AncestorInfo {
  /** HTML tag name (lowercase) */
  tagName: string;
  /** ARIA role if present */
  role: string | null;
  /** data-testid if present */
  testId: string | null;
  /** If this is a landmark element (main, nav, etc.) */
  landmark: string | null;
  /** Index among siblings at this level */
  index: number;
}

/** Landmark element info for anchoring */
export interface LandmarkInfo {
  /** HTML tag name (lowercase) */
  tagName: string;
  /** ARIA role if present */
  role: string | null;
  /** HTML id if present */
  id: string | null;
  /** How many levels up to reach this landmark */
  distanceUp: number;
}

// =============================================================================
// Tracking Types
// =============================================================================

/** Tracked element with current DOM reference */
export interface TrackedElement {
  /** The stable fingerprint */
  fingerprint: ElementFingerprint;
  /** Weak reference to DOM element (allows GC) */
  ref: WeakRef<HTMLElement>;
  /** Current tracking status */
  status: TrackedElementStatus;
  /** Timestamp when element was detected as missing (for grace period) */
  lostAt: number | null;
}

/** Tracking status for an element */
export type TrackedElementStatus = 'active' | 'searching' | 'lost';

// =============================================================================
// Matching Types
// =============================================================================

/** Result from fuzzy matching a fingerprint to a DOM element */
export interface MatchResult {
  /** The fingerprint that was matched */
  fingerprint: ElementFingerprint;
  /** The matched DOM element */
  element: HTMLElement;
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Detailed breakdown of each attribute's contribution */
  matchDetails: MatchDetails;
  /** Which algorithm produced this match */
  algorithm: MatchAlgorithm;
}

/** Detailed breakdown of match scores by category */
export interface MatchDetails {
  /** Score from testId, htmlId matches */
  identityScore: number;
  /** Score from aria-label, role, name */
  semanticScore: number;
  /** Score from textContent, placeholder, etc. */
  contentScore: number;
  /** Score from ancestorPath, siblingIndex */
  structureScore: number;
  /** Score from neighbor text (isotopic context) */
  neighborScore: number;
  /** Score from bounding box position */
  positionScore: number;
}

/** Algorithm used to produce a match */
export type MatchAlgorithm = 'exact' | 'fuzzy' | 'position-fallback';

// =============================================================================
// Event Types
// =============================================================================

/** Base event interface */
interface BaseTrackerEvent {
  type: string;
}

/** Emitted when a new interactive element is discovered */
export interface ElementFoundEvent extends BaseTrackerEvent {
  type: 'element-found';
  fingerprint: ElementFingerprint;
  element: HTMLElement;
}

/** Emitted when a tracked element cannot be re-identified */
export interface ElementLostEvent extends BaseTrackerEvent {
  type: 'element-lost';
  fingerprint: ElementFingerprint;
  lastKnownText: string;
}

/** Emitted when a lost element is successfully re-identified */
export interface ElementMatchedEvent extends BaseTrackerEvent {
  type: 'element-matched';
  fingerprint: ElementFingerprint;
  element: HTMLElement;
  confidence: number;
}

/** Emitted when an element's match confidence changes significantly */
export interface ConfidenceChangedEvent extends BaseTrackerEvent {
  type: 'confidence-changed';
  fingerprint: ElementFingerprint;
  oldConfidence: number;
  newConfidence: number;
}

/** Emitted after processing a batch of DOM mutations */
export interface ElementsUpdatedEvent extends BaseTrackerEvent {
  type: 'elements-updated';
  added: ElementFingerprint[];
  removed: ElementFingerprint[];
  updated: ElementFingerprint[];
}

/** Union of all tracker events */
export type TrackerEvent =
  | ElementFoundEvent
  | ElementLostEvent
  | ElementMatchedEvent
  | ConfidenceChangedEvent
  | ElementsUpdatedEvent;

/** Event type strings for addEventListener */
export type TrackerEventType = TrackerEvent['type'];

// =============================================================================
// Configuration Types
// =============================================================================

/** Configuration for the ElementTracker */
export interface TrackerConfig {
  /** Minimum confidence to accept a match (default: 0.6) */
  confidenceThreshold: number;
  /** Time to wait before declaring element lost, in ms (default: 100) */
  gracePeriodMs: number;
  /** Enable debug overlay (default: false) */
  debugMode: boolean;
  /** Weights for matching algorithm */
  weights: MatchWeights;
}

/**
 * Configurable weights for matching algorithm.
 * Based on research consensus: Playwright, Healenium, Similo.
 * Stable attributes get higher weights.
 */
export interface MatchWeights {
  // Identity (highest - exact match or nothing)
  /** data-testid weight (default: 1.0) */
  testId: number;
  /** HTML id weight (default: 0.9) */
  htmlId: number;

  // Semantic/ARIA (very high)
  /** ARIA role weight (default: 0.85) */
  role: number;
  /** aria-label weight (default: 0.85) */
  ariaLabel: number;
  /** Form name attribute weight (default: 0.8) */
  name: number;

  // Content (high, use fuzzy matching)
  /** Visible text weight (default: 0.75) */
  textContent: number;
  /** Placeholder weight (default: 0.65) */
  placeholder: number;
  /** Image alt text weight (default: 0.6) */
  alt: number;

  // Structural (medium)
  /** Tag name weight - must match as prerequisite (default: 0.5) */
  tagName: number;
  /** Link href weight (default: 0.45) */
  href: number;
  /** Ancestor path weight (default: 0.4) */
  ancestorPath: number;
  /** Sibling index weight (default: 0.3) */
  siblingIndex: number;

  // Isotopic/Neighbor (medium-low)
  /** Neighbor text weight (default: 0.3) */
  neighborText: number;

  // Positional (low - fallback only)
  /** Bounding box weight (default: 0.2) */
  boundingBox: number;

  // Explicitly deprioritized
  /** Class name weight - CSS-in-JS unreliable (default: 0.1) */
  className: number;
}

/**
 * Default weights for element matching.
 *
 * DESIGN RATIONALE:
 * - DOM structure (tag, ancestors, position) is most reliable for re-identification
 * - Text content is deprioritized because dynamic sites frequently change text
 * - Identity attributes (testId, htmlId) are highest when present
 * - Visual position is used as a strong signal when structure matches
 *
 * These weights were tuned for React/Vue/Angular SPAs where text
 * changes frequently but DOM structure remains relatively stable.
 */
export const DEFAULT_WEIGHTS: MatchWeights = {
  // Identity (exact match when present)
  testId: 1.0, // data-testid is explicitly stable
  htmlId: 0.9, // IDs are usually stable (filtered for auto-generated)

  // Structural - HIGHEST PRIORITY
  tagName: 0.95, // Must be same tag type
  ancestorPath: 0.9, // DOM path is very stable across re-renders
  siblingIndex: 0.85, // Position among siblings rarely changes

  // Position - HIGH PRIORITY
  boundingBox: 0.8, // Visual position is reliable for static layouts

  // Semantic (ARIA/accessibility attributes)
  role: 0.7, // ARIA roles are usually stable
  ariaLabel: 0.6, // May change for dynamic content
  name: 0.7, // Form field names are stable

  // Content - LOWER PRIORITY (changes frequently)
  textContent: 0.3, // Button text, labels often change (CTAs, i18n)
  placeholder: 0.5, // Usually stable
  alt: 0.4, // May change for dynamic images
  href: 0.6, // Links usually have stable hrefs

  // Contextual
  neighborText: 0.4, // Surrounding content may change

  // Deprioritized
  className: 0.1, // CSS-in-JS generates random class names
};

/**
 * Default tracker configuration.
 *
 * TUNING NOTES:
 * - confidenceThreshold: 0.6 (60%) balances precision vs recall. Lower values
 *   may cause false matches, higher values may lose valid elements.
 * - gracePeriodMs: 100ms accounts for React's batched updates and double-RAF
 *   timing. Most framework re-renders complete within 2 animation frames (~33ms)
 *   plus a safety margin.
 */
export const DEFAULT_CONFIG: TrackerConfig = {
  confidenceThreshold: 0.6,
  gracePeriodMs: 100,
  debugMode: false,
  weights: DEFAULT_WEIGHTS,
};

// =============================================================================
// Constants
// =============================================================================

/** HTML tags that serve as stable landmark anchors */
export const LANDMARK_TAGS = new Set([
  'main',
  'nav',
  'header',
  'footer',
  'aside',
  'article',
  'section',
  'form',
  'dialog',
]);

/** Implicit ARIA roles by HTML tag */
export const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  a: 'link',
  input: 'textbox',
  select: 'combobox',
  textarea: 'textbox',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  article: 'article',
  section: 'region',
  form: 'form',
  dialog: 'dialog',
  img: 'img',
  table: 'table',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
};

/** Interactive element selectors for tracking */
export const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');
