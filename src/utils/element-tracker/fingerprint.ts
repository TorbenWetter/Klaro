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
export function normalizeHref(href: string | null): string | null {
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
 * Only collects DIRECT text nodes - not text from child elements.
 * This prevents parent containers from having concatenated child text.
 *
 * Uses pure DOM API (childNodes, nodeType) - no selectors or attribute checks.
 */
export function getVisibleText(element: HTMLElement): string {
  // For form elements, use value or placeholder
  if (element instanceof HTMLInputElement) {
    return element.placeholder || element.value || '';
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.placeholder || '';
  }

  // Collect only direct text nodes (nodeType 3 = TEXT_NODE)
  const textParts: string[] = [];

  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  // If no direct text, try aria-label or title as fallback
  if (textParts.length === 0) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const title = element.getAttribute('title');
    if (title) return title;
  }

  return textParts.join(' ');
}

/**
 * Normalize text for comparison.
 * Lowercases, trims, collapses whitespace, and truncates.
 */
export function normalizeText(text: string, maxLength = 100): string {
  const normalized = text.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return normalized;
}

// =============================================================================
// Structural Analysis
// =============================================================================

/**
 * Build ancestor path up to a landmark or max depth.
 * Stops at landmarks for stability (they're less likely to change).
 */
export function buildAncestorPath(element: HTMLElement, maxDepth = 4): AncestorInfo[] {
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
 * IMPORTANT: Also updates textContent to capture label changes (e.g., CTA buttons).
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
    textContent: normalizeText(getVisibleText(element), 100), // CRITICAL: Update text for dynamic content
    ariaLabel: element.getAttribute('aria-label'),
    placeholder: element.getAttribute('placeholder'),
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
 * GENERIC ELEMENT DETECTION
 *
 * We detect interactive elements using ONLY these universal signals:
 * 1. Semantic HTML (button, a[href], input, select, textarea)
 * 2. ARIA roles (role="button", role="link", etc.)
 * 3. Event listeners (detected by MAIN world script via data-klaro-has-click-listener)
 * 4. cursor: pointer CSS (very reliable - devs set this to indicate clickability)
 * 5. Inline event handlers (onclick, onmousedown, etc.)
 * 6. Positive tabindex (indicates focusable/interactive)
 *
 * NO class name pattern matching - that's too site-specific.
 */

/**
 * Check if an element has cursor: pointer style.
 * This is a very reliable indicator of clickability.
 */
function hasCursorPointer(element: HTMLElement): boolean {
  try {
    const style = window.getComputedStyle(element);
    return style.cursor === 'pointer';
  } catch {
    return false;
  }
}

/**
 * Check if an element is visible (not hidden by CSS).
 */
function isVisible(element: HTMLElement): boolean {
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    // Check if element has dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if element has meaningful text content (not empty or just whitespace).
 */
function hasMeaningfulContent(element: HTMLElement): boolean {
  // Check direct text content
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length < 200) return true;

  // Check for aria-label
  if (element.getAttribute('aria-label')) return true;

  // Check for title
  if (element.getAttribute('title')) return true;

  // Check for images with alt text
  const img = element.querySelector('img[alt]');
  if (img) return true;

  // Check for SVG with aria-label
  const svg = element.querySelector('svg[aria-label]');
  if (svg) return true;

  return false;
}

/**
 * Get all interactive elements from a container.
 *
 * DETECTION STRATEGIES (in order of reliability):
 * 1. Semantic HTML elements (button, a[href], input, select, textarea)
 * 2. ARIA roles (role="button", role="link", etc.)
 * 3. Inline event handlers (onclick, onmousedown, etc.)
 * 4. Framework event listeners (detected by MAIN world script)
 * 5. cursor: pointer CSS (universal signal for clickability)
 *
 * NO class name pattern matching - we use only universal DOM/CSS signals.
 */
export function getInteractiveElements(
  container: HTMLElement | Document = document
): HTMLElement[] {
  const foundElements = new Set<HTMLElement>();

  // ==========================================================================
  // Strategy 1: Semantic HTML + ARIA + inline handlers
  // These are the most reliable signals
  // ==========================================================================
  const semanticSelector = [
    // Semantic HTML elements
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    // ARIA roles
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="listbox"]',
    // Inline event handlers
    '[onclick]',
    '[onmousedown]',
    '[onmouseup]',
    '[ontouchstart]',
    '[onpointerdown]',
    // Focusable elements (indicates interactivity)
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const semanticElements = container.querySelectorAll(semanticSelector);
  for (const el of semanticElements) {
    if (el instanceof HTMLElement && isVisible(el)) {
      foundElements.add(el);
    }
  }

  // ==========================================================================
  // Strategy 2: Framework event listeners (React, Vue, etc.)
  // Detected by MAIN world script which adds data-klaro-has-click-listener
  // ==========================================================================
  const listenerElements = container.querySelectorAll('[data-klaro-has-click-listener="true"]');
  for (const el of listenerElements) {
    if (el instanceof HTMLElement && isVisible(el)) {
      foundElements.add(el);
    }
  }

  // ==========================================================================
  // Strategy 3: cursor: pointer detection
  // This is a FALLBACK for pages without framework event detection.
  // If MAIN world script found elements, cursor:pointer without a listener
  // attribute is likely a FALSE POSITIVE (hover styling, not interactive).
  // ==========================================================================
  const hasFrameworkDetection = listenerElements.length > 0;

  const cursorCandidates = container.querySelectorAll(
    'div, span, li, td, th, label, img, svg, i, p, h1, h2, h3, h4, h5, h6'
  );

  // Viewport-relative size limits to filter out containers
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const minDimension = 10; // Minimum 10px to filter out tiny elements
  const maxWidth = vw * 0.9; // 90% of viewport (filter out full-width containers)
  const maxHeight = vh * 0.5; // 50% of viewport (filter out tall containers)

  for (const el of cursorCandidates) {
    if (!(el instanceof HTMLElement)) continue;
    if (foundElements.has(el)) continue; // Already found

    // Must have cursor: pointer
    if (!hasCursorPointer(el)) continue;

    // If framework detection is active, only include elements with listener attribute
    // Otherwise, cursor:pointer without onClick is likely a false positive (hover styling)
    if (hasFrameworkDetection && el.dataset.klaroHasClickListener !== 'true') {
      continue;
    }

    // Must be visible
    if (!isVisible(el)) continue;

    // Must have meaningful content (text, aria-label, etc.)
    if (!hasMeaningfulContent(el)) continue;

    // Size check - filter out containers
    const rect = el.getBoundingClientRect();
    if (rect.width < minDimension || rect.height < minDimension) continue;
    if (rect.width > maxWidth || rect.height > maxHeight) continue;

    // Avoid elements with too many interactive children (likely containers)
    const interactiveChildren = el.querySelectorAll('button, a, input, [role="button"]');
    if (interactiveChildren.length > 2) continue;

    foundElements.add(el);
  }

  return Array.from(foundElements);
}

/**
 * Check if an element is interactive (should be tracked).
 *
 * Uses only universal signals - NO class name pattern matching.
 */
export function isInteractiveElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();

  // ==========================================================================
  // Semantic HTML elements
  // ==========================================================================
  if (['button', 'select', 'textarea'].includes(tagName)) return true;

  // Links with href
  if (tagName === 'a' && element.hasAttribute('href')) return true;

  // Visible inputs
  if (tagName === 'input' && element.getAttribute('type') !== 'hidden') {
    return true;
  }

  // ==========================================================================
  // ARIA roles
  // ==========================================================================
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
      'searchbox',
      'listbox',
    ];
    if (interactiveRoles.includes(role)) return true;
  }

  // ==========================================================================
  // Inline event handlers
  // ==========================================================================
  if (
    element.hasAttribute('onclick') ||
    element.hasAttribute('onmousedown') ||
    element.hasAttribute('onmouseup') ||
    element.hasAttribute('ontouchstart') ||
    element.hasAttribute('onpointerdown')
  ) {
    return true;
  }

  // ==========================================================================
  // Focusable elements
  // ==========================================================================
  const tabindex = element.getAttribute('tabindex');
  if (tabindex && tabindex !== '-1') return true;

  // ==========================================================================
  // Framework event listeners (React, Vue, etc.)
  // Detected by MAIN world script
  // ==========================================================================
  if (element.dataset.klaroHasClickListener === 'true') return true;

  // ==========================================================================
  // cursor: pointer CSS (universal clickability signal)
  // Only for elements with meaningful content
  // ==========================================================================
  if (hasCursorPointer(element) && isVisible(element) && hasMeaningfulContent(element)) {
    return true;
  }

  return false;
}

// =============================================================================
// Fingerprint-to-Fingerprint Comparison
// =============================================================================

/**
 * Calculate similarity between two fingerprints WITHOUT needing DOM elements.
 * Useful for sidebar deduplication when matching new elements against existing ones.
 *
 * Returns a confidence score from 0 to 1.
 * Uses same weights as production matcher but compares fingerprint data directly.
 *
 * @param fp1 First fingerprint
 * @param fp2 Second fingerprint
 * @param threshold Minimum similarity to consider a match (default: 0.5, lower than element matcher)
 * @returns Similarity score (0-1), or 0 if basic criteria don't match
 */
export function calculateFingerprintSimilarity(
  fp1: ElementFingerprint,
  fp2: ElementFingerprint,
  threshold = 0.5
): number {
  // PREREQUISITE: Tag must match exactly
  if (fp1.tagName !== fp2.tagName) {
    return 0;
  }

  // TestId exact match = perfect similarity
  if (fp1.testId && fp2.testId) {
    return fp1.testId === fp2.testId ? 1.0 : 0;
  }

  // Calculate component scores
  let totalWeight = 0;
  let weightedScore = 0;

  // 1. Identity score (htmlId)
  if (fp1.htmlId || fp2.htmlId) {
    const weight = 0.9;
    totalWeight += weight;
    if (fp1.htmlId && fp2.htmlId && fp1.htmlId === fp2.htmlId) {
      weightedScore += weight;
    }
  }

  // 2. Structural score (ancestorPath, siblingIndex)
  const structureWeight = 0.85;
  totalWeight += structureWeight;
  const ancestorSim = fpAncestorPathSimilarity(fp1.ancestorPath, fp2.ancestorPath);
  const siblingBonus =
    fp1.siblingIndex === fp2.siblingIndex
      ? 0.3
      : Math.abs(fp1.siblingIndex - fp2.siblingIndex) <= 2
        ? 0.15
        : 0;
  weightedScore += structureWeight * (ancestorSim * 0.7 + siblingBonus);

  // 3. Landmark score (nearestLandmark) - CRITICAL for semantic matching
  const landmarkWeight = 0.8;
  totalWeight += landmarkWeight;
  if (fp1.nearestLandmark && fp2.nearestLandmark) {
    const landmarkMatch =
      fp1.nearestLandmark.tagName === fp2.nearestLandmark.tagName &&
      fp1.nearestLandmark.role === fp2.nearestLandmark.role;
    if (landmarkMatch) {
      weightedScore += landmarkWeight;
    }
  } else if (!fp1.nearestLandmark && !fp2.nearestLandmark) {
    // Both have no landmark - neutral
    weightedScore += landmarkWeight * 0.5;
  }

  // 4. Semantic score (role, name)
  if (fp1.role || fp2.role) {
    const weight = 0.7;
    totalWeight += weight;
    if (fp1.role && fp2.role && fp1.role === fp2.role) {
      weightedScore += weight;
    }
  }

  if (fp1.name || fp2.name) {
    const weight = 0.7;
    totalWeight += weight;
    if (fp1.name && fp2.name && fp1.name === fp2.name) {
      weightedScore += weight;
    }
  }

  // 5. Input type (for form elements)
  if (fp1.inputType || fp2.inputType) {
    const weight = 0.8;
    totalWeight += weight;
    if (fp1.inputType && fp2.inputType && fp1.inputType === fp2.inputType) {
      weightedScore += weight;
    }
  }

  // 6. Position score (bounding box similarity)
  const positionWeight = 0.6;
  totalWeight += positionWeight;
  const positionSim = fpBoundingBoxSimilarity(fp1.boundingBox, fp2.boundingBox);
  weightedScore += positionWeight * positionSim;

  // 7. Content score (lower weight - text changes frequently)
  // Only use for differentiation, not as primary signal
  if (
    fp1.textContent &&
    fp2.textContent &&
    fp1.textContent.length > 5 &&
    fp2.textContent.length > 5
  ) {
    const weight = 0.2;
    totalWeight += weight;
    // Simple overlap check
    const sim = fpTextOverlapSimilarity(fp1.textContent, fp2.textContent);
    weightedScore += weight * sim;
  }

  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  return finalScore >= threshold ? finalScore : 0;
}

/**
 * Calculate ancestor path similarity between two fingerprints.
 */
function fpAncestorPathSimilarity(path1: AncestorInfo[], path2: AncestorInfo[]): number {
  if (path1.length === 0 && path2.length === 0) return 1;
  if (path1.length === 0 || path2.length === 0) return 0;

  const minLen = Math.min(path1.length, path2.length);
  let matches = 0;

  for (let i = 0; i < minLen; i++) {
    if (path1[i].tagName === path2[i].tagName) {
      matches += 0.6;
      if (path1[i].landmark && path1[i].landmark === path2[i].landmark) {
        matches += 0.4;
      }
    }
  }

  return matches / minLen;
}

/**
 * Calculate bounding box similarity (IoU-like metric).
 */
function fpBoundingBoxSimilarity(box1: BoundingBox, box2: BoundingBox): number {
  // Check for similar position (within 100px)
  const xDiff = Math.abs(box1.x - box2.x);
  const yDiff = Math.abs(box1.y - box2.y);

  if (xDiff > 200 || yDiff > 200) return 0;

  const positionScore = 1 - (xDiff + yDiff) / 400;

  // Check for similar size
  const widthRatio = Math.min(box1.width, box2.width) / Math.max(box1.width, box2.width || 1);
  const heightRatio = Math.min(box1.height, box2.height) / Math.max(box1.height, box2.height || 1);
  const sizeScore = (widthRatio + heightRatio) / 2;

  return positionScore * 0.7 + sizeScore * 0.3;
}

/**
 * Simple text overlap similarity.
 */
function fpTextOverlapSimilarity(text1: string, text2: string): number {
  if (text1 === text2) return 1;

  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? overlap / union : 0;
}
