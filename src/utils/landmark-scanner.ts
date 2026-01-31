/**
 * Landmark Scanner
 *
 * Extracts page content organized by landmark regions (nav, main, form, etc.)
 * for display in the sidebar with collapsible sections.
 */

import type { TrackedElement, ElementFingerprint, LandmarkInfo } from './element-tracker';
import type { UINode } from '$lib/schemas/accessible-ui';

// =============================================================================
// Types
// =============================================================================

/** Content block within a landmark section */
export type ContentBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'text'; content: string }
  | { type: 'element'; elementId: string; fingerprint: ElementFingerprint };

/** A scanned landmark region with its content */
export interface ScannedLandmark {
  /** Unique ID for this landmark instance */
  id: string;
  /** Landmark type (nav, main, form, etc.) */
  type: LandmarkType;
  /** Raw title from aria-label, heading, or tag name */
  rawTitle: string;
  /** Content blocks in DOM order */
  blocks: ContentBlock[];
  /** Reference to the landmark element (for debugging) */
  element?: HTMLElement;
}

/** Supported landmark types */
export type LandmarkType =
  | 'nav'
  | 'main'
  | 'aside'
  | 'header'
  | 'footer'
  | 'section'
  | 'article'
  | 'form'
  | 'search'
  | 'region'
  | 'page'; // Fallback for content outside landmarks

// =============================================================================
// Constants
// =============================================================================

/** Landmark selectors in priority order */
const LANDMARK_SELECTORS = [
  // HTML5 semantic elements
  'nav',
  'main',
  'aside',
  'header',
  'footer',
  'section[aria-label]',
  'section[aria-labelledby]',
  'article',
  'form',
  // ARIA role-based
  '[role="navigation"]',
  '[role="main"]',
  '[role="complementary"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="region"][aria-label]',
  '[role="region"][aria-labelledby]',
  '[role="form"]',
  '[role="search"]',
];

/**
 * Heuristic selectors for pages without proper semantic structure.
 *
 * NOTE: These are CONSERVATIVE patterns used as a FALLBACK only when
 * semantic HTML landmarks (nav, main, aside, header, footer) and
 * ARIA roles are not present.
 *
 * We intentionally keep this list minimal to avoid false positives.
 * Sites should use proper semantic HTML - these help with legacy pages.
 */
const HEURISTIC_LANDMARK_PATTERNS = [
  // Only the most unambiguous patterns - these rarely produce false positives
  { pattern: '[id="nav"]', type: 'nav' as LandmarkType },
  { pattern: '[id="navigation"]', type: 'nav' as LandmarkType },
  { pattern: '[id="header"]', type: 'header' as LandmarkType },
  { pattern: '[id="main"]', type: 'main' as LandmarkType },
  { pattern: '[id="main-content"]', type: 'main' as LandmarkType },
  { pattern: '[id="content"]', type: 'main' as LandmarkType },
  { pattern: '[id="footer"]', type: 'footer' as LandmarkType },
  { pattern: '[id="sidebar"]', type: 'aside' as LandmarkType },
];

/** Map from tag/role to landmark type */
const LANDMARK_TYPE_MAP: Record<string, LandmarkType> = {
  nav: 'nav',
  navigation: 'nav',
  main: 'main',
  aside: 'aside',
  complementary: 'aside',
  header: 'header',
  banner: 'header',
  footer: 'footer',
  contentinfo: 'footer',
  section: 'section',
  region: 'region',
  article: 'article',
  form: 'form',
  search: 'search',
};

/** Tags that contain text content we want to extract */
const TEXT_CONTENT_TAGS = new Set([
  'p',
  'li',
  'td',
  'th',
  'figcaption',
  'blockquote',
  'dt',
  'dd',
  'label',
  'legend',
  'summary',
]);

/** Maximum text content length */
const MAX_TEXT_LENGTH = 500;

/** Maximum heading text length */
const MAX_HEADING_LENGTH = 200;

/** Minimum text length to include */
const MIN_TEXT_LENGTH = 10;

/** Elements to skip during scanning (boilerplate) */
/**
 * Selectors for elements to skip during scanning.
 *
 * NOTE: We ONLY skip elements that are definitively not user content.
 * We intentionally do NOT skip cookie banners, chat widgets, etc. because:
 * 1. These may contain interactive elements users want to use
 * 2. The LLM can decide if they're important
 * 3. Users should see all available interactions on the page
 */
const SKIP_SELECTORS = [
  // Truly hidden elements (accessibility hidden)
  '[hidden]',
  '[aria-hidden="true"]',
  // Screen reader only (invisible but accessible) - these are not interactive for visual users
  '.sr-only',
  '.visually-hidden',
  '[class*="screen-reader"]',
];

/** Check if an element should be skipped during scanning */
function shouldSkipElement(element: Element): boolean {
  // Skip script, style, etc.
  const tag = element.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'svg', 'template'].includes(tag)) {
    return true;
  }

  // Check against skip selectors
  for (const selector of SKIP_SELECTORS) {
    try {
      if (element.matches(selector)) {
        return true;
      }
    } catch {
      // Invalid selector, skip check
    }
  }

  // Skip invisible elements
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
  }

  return false;
}

// =============================================================================
// Main Scanner Function
// =============================================================================

/**
 * Scan a DOM tree for landmarks and extract content organized by region.
 *
 * @param root - The root element to scan (should be cleaned first)
 * @param trackedElements - Map of fingerprint ID to tracked element
 * @returns Array of scanned landmarks with their content
 */
export function scanLandmarks(
  root: HTMLElement,
  trackedElements: Map<string, TrackedElement>
): ScannedLandmark[] {
  const landmarks: ScannedLandmark[] = [];
  const processedElements = new Set<Element>();
  let landmarkCounter = 0;

  // First try semantic landmarks
  const selector = LANDMARK_SELECTORS.join(', ');
  const landmarkElements = root.querySelectorAll(selector);

  for (const element of landmarkElements) {
    if (processedElements.has(element)) continue;

    const nestedLandmarks = element.querySelectorAll(selector);
    for (const nested of nestedLandmarks) {
      if (nested !== element) {
        processedElements.add(nested);
      }
    }

    const landmark = extractLandmarkContent(
      element as HTMLElement,
      trackedElements,
      processedElements,
      `landmark-${landmarkCounter++}`
    );

    if (landmark.blocks.length > 0) {
      landmarks.push(landmark);
    }

    processedElements.add(element);
  }

  // If no semantic landmarks found, try heuristic patterns
  if (landmarks.length === 0) {
    const heuristicLandmarks = scanHeuristicLandmarks(root, trackedElements, processedElements);
    landmarks.push(...heuristicLandmarks);
    landmarkCounter += heuristicLandmarks.length;
  }

  // Handle content outside any landmark (orphaned content)
  const orphanedContent = extractOrphanedContent(root, processedElements, trackedElements);
  if (orphanedContent.blocks.length > 0) {
    const firstBlock = orphanedContent.blocks[0];
    const isLikelyHeader =
      firstBlock.type === 'heading' && (firstBlock.level === 1 || firstBlock.level === 2);

    if (isLikelyHeader) {
      landmarks.unshift(orphanedContent);
    } else {
      landmarks.push(orphanedContent);
    }
  }

  // If still no meaningful content, create a single "Page" section with all interactive elements
  if (landmarks.length === 0 || (landmarks.length === 1 && landmarks[0].blocks.length === 0)) {
    const allElements = extractAllInteractiveElements(root, trackedElements);
    if (allElements.blocks.length > 0) {
      return [allElements];
    }
  }

  return landmarks;
}

/**
 * Scan using heuristic class/id patterns for pages without semantic structure.
 */
function scanHeuristicLandmarks(
  root: HTMLElement,
  trackedElements: Map<string, TrackedElement>,
  processedElements: Set<Element>
): ScannedLandmark[] {
  const landmarks: ScannedLandmark[] = [];
  let counter = 0;

  for (const { pattern, type } of HEURISTIC_LANDMARK_PATTERNS) {
    try {
      const elements = root.querySelectorAll(pattern);

      for (const element of elements) {
        if (processedElements.has(element)) continue;

        // Skip if this element is inside an already processed landmark
        let isNested = false;
        let parent = element.parentElement;
        while (parent) {
          if (processedElements.has(parent)) {
            isNested = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (isNested) continue;

        // Skip small elements (likely not actual landmarks)
        const rect = (element as HTMLElement).getBoundingClientRect?.();
        if (rect && (rect.width < 100 || rect.height < 50)) continue;

        const landmark = extractLandmarkContent(
          element as HTMLElement,
          trackedElements,
          processedElements,
          `heuristic-${counter++}`,
          type
        );

        if (landmark.blocks.length > 0) {
          landmarks.push(landmark);
          processedElements.add(element);
        }
      }
    } catch {
      // Invalid selector, skip
    }
  }

  return landmarks;
}

/**
 * Extract ALL interactive elements from the page as a single section.
 * Fallback for pages with no detectable structure.
 */
function extractAllInteractiveElements(
  root: HTMLElement,
  trackedElements: Map<string, TrackedElement>
): ScannedLandmark {
  const blocks: ContentBlock[] = [];

  // First add any headings for context
  const headings = root.querySelectorAll('h1, h2, h3');
  for (const heading of headings) {
    const text = heading.textContent?.trim();
    if (text && text.length >= 2) {
      const level = parseInt(heading.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: 'heading',
        level,
        text: text.slice(0, MAX_HEADING_LENGTH),
      });
    }
  }

  // Then add all tracked interactive elements
  for (const tracked of trackedElements.values()) {
    if (tracked.status === 'lost') continue;

    blocks.push({
      type: 'element',
      elementId: tracked.fingerprint.id,
      fingerprint: tracked.fingerprint,
    });
  }

  return {
    id: 'all-content',
    type: 'page',
    rawTitle: 'Page Actions',
    blocks,
  };
}

// =============================================================================
// Extraction Helpers
// =============================================================================

/**
 * Extract content from a single landmark element.
 */
function extractLandmarkContent(
  landmark: HTMLElement,
  trackedElements: Map<string, TrackedElement>,
  excludeElements: Set<Element>,
  id: string,
  overrideType?: LandmarkType
): ScannedLandmark {
  const blocks: ContentBlock[] = [];
  const seenTexts = new Set<string>(); // Deduplicate text blocks

  // TreeWalker for DOM-order traversal
  const walker = document.createTreeWalker(landmark, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;

      // Skip excluded elements (nested landmarks)
      if (excludeElements.has(el) && el !== landmark) {
        return NodeFilter.FILTER_REJECT;
      }

      // Skip boilerplate elements
      if (shouldSkipElement(el)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Process all elements in DOM order
  let currentNode: Node | null = landmark;
  while (currentNode) {
    const el = currentNode as HTMLElement;
    const tag = el.tagName?.toLowerCase();

    if (tag) {
      // Check for headings
      if (/^h[1-6]$/.test(tag)) {
        const text = el.textContent?.trim();
        if (text && text.length >= 2) {
          blocks.push({
            type: 'heading',
            level: parseInt(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
            text: text.slice(0, MAX_HEADING_LENGTH),
          });
        }
        currentNode = walker.nextNode();
        continue;
      }

      // Check for tracked interactive elements
      const trackedElement = findTrackedElementByDOM(el, trackedElements);
      if (trackedElement) {
        blocks.push({
          type: 'element',
          elementId: trackedElement.fingerprint.id,
          fingerprint: trackedElement.fingerprint,
        });
        currentNode = walker.nextNode();
        continue;
      }

      // Check for text content containers
      if (TEXT_CONTENT_TAGS.has(tag)) {
        const text = getDirectTextContent(el);
        if (text && text.length >= MIN_TEXT_LENGTH && !seenTexts.has(text)) {
          seenTexts.add(text);
          blocks.push({
            type: 'text',
            content: text.slice(0, MAX_TEXT_LENGTH),
          });
        }
      }
    }

    currentNode = walker.nextNode();
  }

  return {
    id,
    type: overrideType || getLandmarkType(landmark),
    rawTitle: getLandmarkTitle(landmark, overrideType),
    blocks,
    element: landmark,
  };
}

/**
 * Extract content that's outside any landmark region.
 */
function extractOrphanedContent(
  root: HTMLElement,
  excludeElements: Set<Element>,
  trackedElements: Map<string, TrackedElement>
): ScannedLandmark {
  const blocks: ContentBlock[] = [];
  const seenTexts = new Set<string>();

  // Walk the entire tree, skipping landmarks and boilerplate
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;

      // Skip landmark elements and their children
      if (excludeElements.has(el)) {
        return NodeFilter.FILTER_REJECT;
      }

      // Skip boilerplate elements
      if (shouldSkipElement(el)) {
        return NodeFilter.FILTER_REJECT;
      }

      // Check if any parent is excluded
      let parent = el.parentElement;
      while (parent) {
        if (excludeElements.has(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentElement;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const text = el.textContent?.trim();
      if (text && text.length >= 2) {
        blocks.push({
          type: 'heading',
          level: parseInt(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
          text: text.slice(0, MAX_HEADING_LENGTH),
        });
      }
      continue;
    }

    // Tracked elements
    const trackedElement = findTrackedElementByDOM(el, trackedElements);
    if (trackedElement) {
      blocks.push({
        type: 'element',
        elementId: trackedElement.fingerprint.id,
        fingerprint: trackedElement.fingerprint,
      });
      continue;
    }

    // Text content
    if (TEXT_CONTENT_TAGS.has(tag)) {
      const text = getDirectTextContent(el);
      if (text && text.length >= MIN_TEXT_LENGTH && !seenTexts.has(text)) {
        seenTexts.add(text);
        blocks.push({
          type: 'text',
          content: text.slice(0, MAX_TEXT_LENGTH),
        });
      }
    }
  }

  return {
    id: 'page-content',
    type: 'page',
    rawTitle: 'Page Content',
    blocks,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Find a tracked element by its DOM element reference.
 */
function findTrackedElementByDOM(
  element: HTMLElement,
  trackedElements: Map<string, TrackedElement>
): TrackedElement | null {
  for (const tracked of trackedElements.values()) {
    if (tracked.status === 'lost') continue;

    const trackedEl = tracked.ref.deref();
    if (trackedEl === element) {
      return tracked;
    }
  }
  return null;
}

/**
 * Get the landmark type from an element.
 */
function getLandmarkType(element: HTMLElement): LandmarkType {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role')?.toLowerCase();

  // Check role first
  if (role && LANDMARK_TYPE_MAP[role]) {
    return LANDMARK_TYPE_MAP[role];
  }

  // Fall back to tag name
  if (LANDMARK_TYPE_MAP[tag]) {
    return LANDMARK_TYPE_MAP[tag];
  }

  return 'region';
}

/**
 * Get a title for the landmark from available sources.
 */
function getLandmarkTitle(element: HTMLElement, overrideType?: LandmarkType): string {
  // 1. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) {
    return ariaLabel.trim();
  }

  // 2. aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent?.trim()) {
      return labelEl.textContent.trim();
    }
  }

  // 3. First heading inside
  const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading?.textContent?.trim()) {
    return heading.textContent.trim().slice(0, 100);
  }

  // 4. Form title/legend (for form-like elements)
  const tag = element.tagName.toLowerCase();
  if (tag === 'form' || overrideType === 'form') {
    const legend = element.querySelector('legend');
    if (legend?.textContent?.trim()) {
      return legend.textContent.trim();
    }

    // Check for title attribute
    const title = element.getAttribute('title');
    if (title?.trim()) {
      return title.trim();
    }

    // For heuristic forms, try to find a title-like element
    const modalTitle = element.querySelector('[class*="title"], [class*="header"]');
    if (modalTitle?.textContent?.trim()) {
      return modalTitle.textContent.trim().slice(0, 100);
    }
  }

  // 5. Try to infer from class/id names
  const className = element.className?.toString() || '';
  const id = element.id || '';
  const combinedName = `${className} ${id}`.toLowerCase();

  // Extract meaningful words from class/id
  const meaningfulPatterns: Record<string, string> = {
    hero: 'Hero Section',
    banner: 'Banner',
    sponsor: 'Sponsors',
    footer: 'Footer',
    header: 'Header',
    nav: 'Navigation',
    menu: 'Menu',
    form: 'Form',
    dialog: 'Dialog',
    modal: 'Form',
    tab: 'Tabs',
    content: 'Content',
  };

  for (const [pattern, label] of Object.entries(meaningfulPatterns)) {
    if (combinedName.includes(pattern)) {
      return label;
    }
  }

  // 6. Default based on type
  const type = overrideType || getLandmarkType(element);
  const typeLabels: Record<LandmarkType, string> = {
    nav: 'Navigation',
    main: 'Main Content',
    aside: 'Sidebar',
    header: 'Header',
    footer: 'Footer',
    section: 'Section',
    article: 'Article',
    form: 'Form',
    search: 'Search',
    region: 'Content',
    page: 'Page Content',
  };

  return typeLabels[type] || 'Content';
}

/**
 * Get the direct text content of an element, excluding nested interactive elements.
 */
function getDirectTextContent(element: HTMLElement): string {
  // Clone to avoid modifying the original
  const clone = element.cloneNode(true) as HTMLElement;

  // Remove interactive children (they're handled separately)
  const interactiveSelectors = 'button, a, input, select, textarea, [role="button"], [role="link"]';
  clone.querySelectorAll(interactiveSelectors).forEach((el) => el.remove());

  // Get remaining text
  const text = clone.textContent?.trim() || '';

  // Normalize whitespace
  return text.replace(/\s+/g, ' ');
}

/**
 * Convert a ScannedLandmark to a format suitable for LLM prompt.
 */
export function landmarkToPromptText(landmark: ScannedLandmark): string {
  const lines: string[] = [];

  lines.push(`SECTION: ${landmark.rawTitle} (${landmark.type})`);

  for (const block of landmark.blocks) {
    switch (block.type) {
      case 'heading':
        lines.push(`  [h${block.level}] ${block.text}`);
        break;
      case 'text':
        lines.push(`  [text] ${block.content.slice(0, 100)}...`);
        break;
      case 'element': {
        const fp = block.fingerprint;
        const label = fp.ariaLabel || fp.textContent || fp.placeholder || fp.name || 'unlabeled';
        lines.push(`  [${fp.tagName} id="${fp.id}"] ${label.slice(0, 50)}`);
        break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Convert all landmarks to a single prompt string.
 */
export function landmarksToPrompt(landmarks: ScannedLandmark[]): string {
  return landmarks.map(landmarkToPromptText).join('\n\n');
}
