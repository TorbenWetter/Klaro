/**
 * Fingerprint Generation
 *
 * Pure functions for creating stable element fingerprints that survive
 * framework re-renders. Based on Similo's 14-attribute approach with
 * extensions for isotopic (neighbor) context.
 */

import type {
  ElementFingerprint,
  AncestorInfo,
  LandmarkInfo,
  NeighborText,
  BoundingBox,
  ViewportPercent,
} from './types';
import { LANDMARK_TAGS, IMPLICIT_ROLES } from './types';

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique ID for tracking.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// =============================================================================
// Main Fingerprint Creation
// =============================================================================

/**
 * Create a complete fingerprint for an element.
 * Captures all attributes needed for fuzzy re-identification.
 */
export function createFingerprint(element: HTMLElement): ElementFingerprint {
  const rect = element.getBoundingClientRect();
  const tagName = element.tagName.toLowerCase();

  return {
    id: generateId(),

    // Priority 1: Explicit identifiers
    testId: getTestId(element),
    htmlId: hasStableId(element) ? element.id : null,

    // Priority 2: Semantic/ARIA
    role: element.getAttribute('role') || getImplicitRole(element),
    ariaLabel: element.getAttribute('aria-label'),
    name: element.getAttribute('name'),

    // Priority 3: Content
    textContent: normalizeText(getVisibleText(element), 100),
    placeholder: element.getAttribute('placeholder'),
    value: getElementValue(element),
    alt: element.getAttribute('alt'),
    title: element.getAttribute('title'),
    href: normalizeHref(element.getAttribute('href')),

    // Priority 4: Structural
    tagName,
    inputType: tagName === 'input' ? element.getAttribute('type') : null,
    ancestorPath: buildAncestorPath(element),
    siblingIndex: getSiblingIndex(element),
    childIndex: getChildIndex(element),
    nearestLandmark: findNearestLandmark(element),

    // Priority 5: Neighbor context
    neighborText: getNeighborText(element),

    // Priority 6: Visual
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    viewportPercent: getViewportPercent(rect),
    aspectRatio: rect.height > 0 ? rect.width / rect.height : 0,

    // Metadata
    timestamp: Date.now(),
    lastMatchConfidence: 1.0,
  };
}

// =============================================================================
// Attribute Extraction
// =============================================================================

/**
 * Get test ID from various common attributes.
 * Checks data-testid, data-test, data-cy, data-test-id.
 */
export function getTestId(element: HTMLElement): string | null {
  return (
    element.getAttribute('data-testid') ||
    element.getAttribute('data-test') ||
    element.getAttribute('data-cy') ||
    element.getAttribute('data-test-id') ||
    null
  );
}

/**
 * Get the current value of form elements.
 */
function getElementValue(element: HTMLElement): string | null {
  if (element instanceof HTMLInputElement) {
    // Don't capture password values
    if (element.type === 'password') return null;
    return element.value || null;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value || null;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value || null;
  }
  return null;
}

/**
 * Normalize href to remove query params and fragments for matching.
 * Keeps the path for identification purposes.
 */
function normalizeHref(href: string | null): string | null {
  if (!href) return null;
  try {
    // Handle relative URLs
    if (href.startsWith('/') || href.startsWith('#')) {
      return href.split('?')[0].split('#')[0] || href;
    }
    const url = new URL(href);
    return url.pathname;
  } catch {
    return href;
  }
}

/**
 * Get viewport-relative position as percentages.
 * More stable than absolute pixels for responsive layouts.
 */
function getViewportPercent(rect: DOMRect): ViewportPercent {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  return {
    xPercent: rect.x / vw,
    yPercent: rect.y / vh,
  };
}

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Get visible text content of an element.
 * Excludes hidden elements and normalizes whitespace.
 */
export function getVisibleText(element: HTMLElement): string {
  // For form elements, use value or placeholder
  if (element instanceof HTMLInputElement) {
    return element.placeholder || element.value || '';
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.placeholder || '';
  }

  // Get text content, excluding script/style
  const text = element.textContent || '';
  return text;
}

/**
 * Normalize text for comparison.
 * Lowercases, trims, collapses whitespace, and truncates.
 */
export function normalizeText(text: string, maxLength = 100): string {
  const normalized = text
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
  return normalized;
}

// =============================================================================
// Structural Analysis
// =============================================================================

/**
 * Build ancestor path up to a landmark or max depth.
 * Stops at landmarks for stability (they're less likely to change).
 */
export function buildAncestorPath(
  element: HTMLElement,
  maxDepth = 4
): AncestorInfo[] {
  const path: AncestorInfo[] = [];
  let current = element.parentElement;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tagName = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    const testId = getTestId(current);
    const isLandmark = LANDMARK_TAGS.has(tagName) || isLandmarkRole(role);

    const info: AncestorInfo = {
      tagName,
      role,
      testId,
      landmark: isLandmark ? tagName : null,
      index: getChildIndex(current),
    };

    path.push(info);

    // Stop at landmarks or stable identifiers (they're reliable anchors)
    if (isLandmark || testId || current.id) {
      break;
    }

    current = current.parentElement;
    depth++;
  }

  return path;
}

/**
 * Check if an ARIA role is a landmark role.
 */
function isLandmarkRole(role: string | null): boolean {
  if (!role) return false;
  const landmarkRoles = new Set([
    'banner',
    'complementary',
    'contentinfo',
    'form',
    'main',
    'navigation',
    'region',
    'search',
  ]);
  return landmarkRoles.has(role);
}

/**
 * Find the nearest landmark element in ancestors.
 */
export function findNearestLandmark(element: HTMLElement): LandmarkInfo | null {
  let current = element.parentElement;
  let distance = 1;

  while (current) {
    const tagName = current.tagName.toLowerCase();
    const role = current.getAttribute('role');

    if (LANDMARK_TAGS.has(tagName) || isLandmarkRole(role)) {
      return {
        tagName,
        role,
        id: current.id || null,
        distanceUp: distance,
      };
    }

    current = current.parentElement;
    distance++;
  }

  return null;
}

/**
 * Get index among same-tag siblings.
 * More stable than absolute index when elements of different types are added/removed.
 */
export function getSiblingIndex(element: HTMLElement): number {
  if (!element.parentElement) return 0;

  const siblings = Array.from(element.parentElement.children).filter(
    (child) => child.tagName === element.tagName
  );

  return siblings.indexOf(element);
}

/**
 * Get index among all siblings (absolute position).
 */
export function getChildIndex(element: HTMLElement | Element): number {
  if (!element.parentElement) return 0;
  return Array.from(element.parentElement.children).indexOf(element);
}

// =============================================================================
// Neighbor/Isotopic Context
// =============================================================================

/**
 * Get text from adjacent elements for isotopic anchoring.
 * Elements are often identifiable by their neighbors even when their own
 * attributes change.
 */
export function getNeighborText(element: HTMLElement): NeighborText {
  const maxLength = 50;

  // Previous sibling text
  let previous: string | null = null;
  const prevSibling = element.previousElementSibling;
  if (prevSibling instanceof HTMLElement) {
    previous = normalizeText(getVisibleText(prevSibling), maxLength) || null;
  }

  // Next sibling text
  let next: string | null = null;
  const nextSibling = element.nextElementSibling;
  if (nextSibling instanceof HTMLElement) {
    next = normalizeText(getVisibleText(nextSibling), maxLength) || null;
  }

  // Parent text (excluding this element's text)
  let parent: string | null = null;
  if (element.parentElement) {
    const parentText = element.parentElement.textContent || '';
    const elementText = element.textContent || '';
    const remainingText = parentText.replace(elementText, '').trim();
    parent = normalizeText(remainingText, maxLength) || null;
  }

  return { previous, next, parent };
}

// =============================================================================
// ARIA Role Detection
// =============================================================================

/**
 * Get implicit ARIA role from element tag.
 */
export function getImplicitRole(element: HTMLElement): string | null {
  const tagName = element.tagName.toLowerCase();

  // Special case for input types
  if (tagName === 'input') {
    const type = element.getAttribute('type') || 'text';
    const inputRoles: Record<string, string> = {
      checkbox: 'checkbox',
      radio: 'radio',
      range: 'slider',
      button: 'button',
      submit: 'button',
      reset: 'button',
      image: 'button',
      search: 'searchbox',
      email: 'textbox',
      tel: 'textbox',
      url: 'textbox',
      text: 'textbox',
      password: 'textbox',
      number: 'spinbutton',
    };
    return inputRoles[type] || 'textbox';
  }

  // Special case for links - only links WITH href get the link role
  if (tagName === 'a') {
    return element.hasAttribute('href') ? 'link' : null;
  }

  return IMPLICIT_ROLES[tagName] || null;
}

// =============================================================================
// ID Stability Detection
// =============================================================================

/**
 * Check if an element has a stable (non-generated) ID.
 * Generated IDs often have patterns like: r:1, :r0:, react-123, etc.
 */
export function hasStableId(element: HTMLElement): boolean {
  const id = element.id;
  if (!id) return false;

  // Empty or whitespace-only
  if (!id.trim()) return false;

  // React-style IDs (r:1, :r0:, :ra:, r:abc)
  if (/^:?r[a-z0-9]*:?$/i.test(id)) return false;
  if (/^r:[a-z0-9]+$/i.test(id)) return false;

  // Numeric or mostly numeric IDs (often auto-generated)
  if (/^\d+$/.test(id)) return false;

  // Common auto-generated patterns
  if (/^(react|angular|vue|ember|svelte)-/.test(id)) return false;
  if (/^(id|el|element|node)[-_]?\d+$/i.test(id)) return false;

  // Short random-looking IDs
  if (id.length < 4 && /^[a-z0-9]+$/i.test(id)) return false;

  // Contains hash-like patterns
  if (/[a-z]{1,2}[0-9]{2,}[a-z0-9]*/i.test(id)) return false;

  return true;
}

// =============================================================================
// Class Entropy Detection (CSS-in-JS)
// =============================================================================

/**
 * Detect high-entropy (likely hashed) class names.
 * CSS-in-JS libraries generate classes like: sc-1a2b3c, css-x9z, emotion-123
 *
 * High entropy = useless for identification, should be ignored.
 * Low entropy = meaningful class names that might be stable.
 */
export function isHighEntropyClass(className: string): boolean {
  // Very short strings are often hashes
  if (className.length < 3) return true;

  // Common CSS-in-JS prefixes
  const cssInJsPatterns = [
    /^sc-/, // styled-components
    /^css-/, // emotion, vanilla-extract
    /^emotion-/,
    /^styled-/,
    /^_[a-z]+_[a-z0-9]+/i, // CSS modules pattern
    /^css_[a-z0-9]+/i,
    /^styles_[a-z0-9]+/i,
  ];

  for (const pattern of cssInJsPatterns) {
    if (pattern.test(className)) return true;
  }

  // Hash-like patterns: mixed letters and numbers in ways that look random
  // e.g., "a1b2c3", "x7d5"
  if (/^[a-z]{1,3}[0-9]+[a-z0-9]*$/i.test(className)) return true;

  // CamelCase with multiple humps that look generated (e.g., "kLhOui", "bdVaJa")
  // Note: NO 'i' flag - we specifically look for mixed case patterns
  if (/^[a-z]+[A-Z][a-z]+[A-Z]/.test(className)) return true;

  // Pure hex-like strings
  if (/^[a-f0-9]{6,}$/i.test(className)) return true;

  // Ends with hash-like suffix
  if (/[-_][a-z0-9]{4,8}$/i.test(className)) {
    const suffix = className.split(/[-_]/).pop() || '';
    // If suffix looks like a hash (mixed alphanumeric)
    if (/^[a-z]+\d+|^\d+[a-z]+/i.test(suffix)) return true;
  }

  return false;
}

/**
 * Filter class list to only include stable (low-entropy) classes.
 */
export function filterStableClasses(classList: DOMTokenList): string[] {
  return Array.from(classList).filter((cls) => !isHighEntropyClass(cls));
}

/**
 * Get stable classes as a space-separated string.
 */
export function getStableClassString(element: HTMLElement): string {
  return filterStableClasses(element.classList).join(' ');
}

// =============================================================================
// Fingerprint Updates
// =============================================================================

/**
 * Update a fingerprint with current element state.
 * Used after re-identification to refresh volatile attributes.
 */
export function updateFingerprint(
  fingerprint: ElementFingerprint,
  element: HTMLElement,
  confidence: number
): ElementFingerprint {
  const rect = element.getBoundingClientRect();

  return {
    ...fingerprint,
    // Update volatile attributes
    value: getElementValue(element),
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    viewportPercent: getViewportPercent(rect),
    // Update metadata
    timestamp: Date.now(),
    lastMatchConfidence: confidence,
  };
}

// =============================================================================
// Candidate Selection
// =============================================================================

/**
 * Get all interactive elements from a container.
 */
export function getInteractiveElements(
  container: HTMLElement | Document = document
): HTMLElement[] {
  const selector = [
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

  return Array.from(container.querySelectorAll(selector)) as HTMLElement[];
}

/**
 * Check if an element is interactive (should be tracked).
 */
export function isInteractiveElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();

  // Common interactive tags
  if (['button', 'select', 'textarea'].includes(tagName)) return true;

  // Links with href
  if (tagName === 'a' && element.hasAttribute('href')) return true;

  // Visible inputs
  if (tagName === 'input' && element.getAttribute('type') !== 'hidden') {
    return true;
  }

  // Interactive ARIA roles
  const role = element.getAttribute('role');
  if (role) {
    const interactiveRoles = [
      'button',
      'link',
      'checkbox',
      'radio',
      'switch',
      'tab',
      'menuitem',
      'option',
      'slider',
      'spinbutton',
      'textbox',
      'combobox',
    ];
    if (interactiveRoles.includes(role)) return true;
  }

  // Has click handler
  if (element.hasAttribute('onclick')) return true;

  // Has positive tabindex
  const tabindex = element.getAttribute('tabindex');
  if (tabindex && tabindex !== '-1') return true;

  return false;
}
