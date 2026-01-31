/**
 * DOM Cleaner
 *
 * Prepares a cloned DOM tree for LLM processing by removing
 * elements that are definitively not user content.
 *
 * DESIGN PRINCIPLE: Be CONSERVATIVE. Only remove elements that are:
 * 1. Truly invisible/hidden
 * 2. Non-interactive technical elements (scripts, styles)
 * 3. Tracking pixels (1x1 images)
 *
 * We intentionally do NOT remove:
 * - Cookie banners (users may want to interact)
 * - Chat widgets (users may want to use)
 * - Modals/popups (may contain important content)
 * - Social share buttons (may be desired)
 * - Notifications/toasts (may be important)
 *
 * The LLM will decide what's important from the remaining content.
 */

/** Tags that never contain user-interactive content */
const REMOVE_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'link', // stylesheet/preload links
  'meta', // metadata
];

/**
 * Elements to remove - ONLY definitively non-content elements.
 * We err on the side of keeping content rather than removing it.
 */
const REMOVE_SELECTORS = [
  // Explicitly hidden elements
  '[hidden]',
  '[aria-hidden="true"]',

  // Screen reader only content (invisible to visual users)
  '.sr-only',
  '.visually-hidden',
  '.screen-reader-text',
  '[class*="screen-reader-only"]',

  // Tracking pixels (1x1 invisible images)
  'img[width="1"][height="1"]',
  'img[src*="pixel."]',
  'img[src*="/pixel?"]',
  'img[src*="beacon."]',

  // iframes that are known ad/tracking networks (very specific patterns)
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
];

/**
 * Clean a cloned DOM tree by removing non-content elements.
 * NOTE: This modifies the passed element in place.
 * NOTE: Only pass CLONED elements - this is destructive.
 *
 * @param root - The root element to clean (should be a clone)
 */
export function cleanDOM(root: Element): void {
  // Remove non-content tags first
  for (const tag of REMOVE_TAGS) {
    const elements = root.querySelectorAll(tag);
    for (const el of elements) {
      el.remove();
    }
  }

  // Remove by selector (conservative list)
  for (const selector of REMOVE_SELECTORS) {
    try {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Remove SVG elements that are purely decorative (no interactive content)
  // Keep SVGs that have aria-label or role="img" as they may be meaningful icons
  const svgs = root.querySelectorAll('svg:not([aria-label]):not([role])');
  for (const svg of svgs) {
    svg.remove();
  }
}

/**
 * Check if an element is likely a container without semantic meaning
 * (e.g., wrapper divs created by frameworks)
 *
 * This is used for unwrapping, not removal.
 */
export function isWrapperElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();

  // Only consider divs and spans as potential wrappers
  if (tag !== 'div' && tag !== 'span') {
    return false;
  }

  // Has role? Not a wrapper
  if (element.getAttribute('role')) {
    return false;
  }

  // Has aria attributes? Not a wrapper
  for (const attr of element.attributes) {
    if (attr.name.startsWith('aria-')) {
      return false;
    }
  }

  // Has ID? Probably meaningful
  if (element.id) {
    return false;
  }

  // Has only one child and no direct text? Likely a wrapper
  if (element.children.length === 1) {
    // Check for direct text nodes
    let hasDirectText = false;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        hasDirectText = true;
        break;
      }
    }
    if (!hasDirectText) {
      return true;
    }
  }

  return false;
}

/**
 * Get a cleaned clone of the document body.
 * Original DOM is not modified.
 */
export function getCleanedBody(): HTMLElement {
  const clone = document.body.cloneNode(true) as HTMLElement;
  cleanDOM(clone);
  return clone;
}
