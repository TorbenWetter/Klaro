/**
 * Tree Builder
 *
 * Pure functions for building hierarchical tree structures from the DOM.
 * Handles visibility detection, element classification, and smart collapse logic.
 */

import type { TreeNode, DOMTree, NodeType, InteractiveType, TreeTrackerConfig } from './types';
import { DEFAULT_TREE_TRACKER_CONFIG } from './types';
import {
  createFingerprint,
  getVisibleText,
  normalizeText,
  isInteractiveElement,
} from '../element-tracker/fingerprint';

// =============================================================================
// Tag Sets
// =============================================================================

/** Tags that are considered containers */
export const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'nav',
  'aside',
  'header',
  'footer',
  'main',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dialog',
]);

/** Tags that are interactive */
export const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
]);

/** Tags that are text content */
export const TEXT_TAGS = new Set([
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'legend',
  'caption',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'mark',
  'del',
  'ins',
  'sub',
  'sup',
  'code',
  'pre',
  'blockquote',
  'q',
  'cite',
  'abbr',
  'time',
  'address',
]);

/** Tags that are media */
export const MEDIA_TAGS = new Set(['img', 'video', 'audio', 'canvas', 'svg', 'picture', 'iframe']);

/** Tags that are lists */
export const LIST_TAGS = new Set(['ul', 'ol', 'dl', 'menu']);

/** Tags that are list items */
export const LIST_ITEM_TAGS = new Set(['li', 'dt', 'dd']);

/** Tags that are tables */
export const TABLE_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
]);

/** Tags to skip entirely (never show in tree) */
export const SKIP_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'slot',
  'br',
  'wbr',
  'hr',
]);

/** Roles that indicate modals/dialogs */
export const MODAL_ROLES = new Set(['dialog', 'alertdialog', 'modal']);

/** Landmark elements that should never be skipped during flattening */
const LANDMARK_TAGS = new Set([
  'nav',
  'main',
  'header',
  'footer',
  'aside',
  'article',
  'section',
  'form',
]);

// =============================================================================
// Collapse Configuration
// =============================================================================

/** Configuration for auto-collapse behavior */
export interface CollapseConfig {
  /** Max depth before auto-collapse (default: 4) */
  maxExpandedDepth: number;
  /** Max children before auto-collapse (default: 10) */
  maxExpandedChildren: number;
  /** Min children for auto-expand (default: 3) */
  minChildrenToExpand: number;
  /** Initial expand depth (default: 2) */
  initialExpandDepth: number;
}

export const DEFAULT_COLLAPSE_CONFIG: CollapseConfig = {
  maxExpandedDepth: 4,
  maxExpandedChildren: 10,
  minChildrenToExpand: 3,
  initialExpandDepth: 2,
};

// =============================================================================
// Visibility Detection
// =============================================================================

/**
 * Check if an element is hidden via CSS or aria-hidden.
 */
export function isHidden(element: HTMLElement): boolean {
  try {
    // aria-hidden
    if (element.getAttribute('aria-hidden') === 'true') return true;

    // hidden attribute
    if (element.hasAttribute('hidden')) return true;

    const style = window.getComputedStyle(element);

    // display: none
    if (style.display === 'none') return true;

    // visibility: hidden
    if (style.visibility === 'hidden') return true;

    // opacity: 0 (often used for hidden elements)
    if (style.opacity === '0') return true;

    // Zero dimensions (but not for inline elements)
    if (style.display !== 'inline' && style.display !== 'inline-block') {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return true;
    }

    // Off-screen positioning (common hiding technique)
    if (style.position === 'absolute' || style.position === 'fixed') {
      const rect = element.getBoundingClientRect();
      if (rect.right < 0 || rect.bottom < 0) return true;
      if (rect.left > window.innerWidth || rect.top > window.innerHeight) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if element is in the visible viewport.
 */
export function isInViewport(element: HTMLElement): boolean {
  try {
    const rect = element.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Check if any part of the element is in viewport
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  } catch {
    return false;
  }
}

// =============================================================================
// Element Classification
// =============================================================================

/**
 * Determine the node type for rendering.
 */
export function getNodeType(element: HTMLElement): NodeType {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  // Interactive elements
  if (INTERACTIVE_TAGS.has(tag) || isInteractiveElement(element)) {
    return 'interactive';
  }

  // Media elements
  if (MEDIA_TAGS.has(tag)) {
    return 'media';
  }

  // List elements
  if (LIST_TAGS.has(tag)) {
    return 'list';
  }

  // List items
  if (LIST_ITEM_TAGS.has(tag)) {
    return 'listItem';
  }

  // Table elements
  if (TABLE_TAGS.has(tag)) {
    return 'table';
  }

  // Text elements (headings, paragraphs, etc.)
  if (TEXT_TAGS.has(tag)) {
    return 'text';
  }

  // Check for modal/dialog roles
  if (role && MODAL_ROLES.has(role)) {
    return 'container';
  }

  // Default to container for divs, sections, etc.
  return 'container';
}

/**
 * Get the interactive type for interactive elements.
 */
export function getInteractiveType(element: HTMLElement): InteractiveType | undefined {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const type = element.getAttribute('type');

  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' || role === 'link') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';

  if (tag === 'input') {
    if (type === 'checkbox' || role === 'checkbox') return 'checkbox';
    if (type === 'radio' || role === 'radio') return 'radio';
    return 'input';
  }

  // ARIA roles
  if (role === 'checkbox') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'textbox' || role === 'searchbox') return 'input';
  if (role === 'combobox' || role === 'listbox') return 'select';

  return undefined;
}

/**
 * Get heading level for heading elements.
 */
export function getHeadingLevel(element: HTMLElement): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  const tag = element.tagName.toLowerCase();
  const match = tag.match(/^h([1-6])$/);
  if (match) {
    return parseInt(match[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return undefined;
}

/**
 * Extract a display label from an element.
 */
export function extractLabel(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();

  // For form elements, use enhanced detection (Phase 4)
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return extractFormFieldLabel(element);
  }

  // For images
  if (tag === 'img') {
    return element.getAttribute('alt') || '[Image]';
  }

  // For SVGs
  if (tag === 'svg') {
    return element.getAttribute('aria-label') || '[SVG]';
  }

  // For iframes
  if (tag === 'iframe') {
    return element.getAttribute('title') || '[iframe]';
  }

  // For canvas
  if (tag === 'canvas') {
    return '[Canvas]';
  }

  // For video/audio
  if (tag === 'video' || tag === 'audio') {
    return `[${tag.charAt(0).toUpperCase() + tag.slice(1)}]`;
  }

  // Phase 2: Check aria-labelledby first (highest priority for accessibility)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = resolveAriaLabelledBy(labelledBy);
    if (labelText) return normalizeText(labelText);
  }

  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Check title attribute
  const title = element.getAttribute('title');
  if (title) return title;

  // Get visible text - only direct text nodes (not nested)
  const directText = getVisibleText(element);
  if (directText) return normalizeText(directText);

  // For containers, try to infer from landmark role or tag
  // DO NOT use textContent fallback - that would duplicate child text
  const role = element.getAttribute('role');
  if (role) return role;

  // Use tag name for common containers
  if (CONTAINER_TAGS.has(tag)) {
    const landmark = getLandmarkName(element);
    if (landmark) return landmark;
  }

  // For non-containers (text elements like span, p, etc.), use full textContent
  // No length limit - show all text content for accessibility
  if (!CONTAINER_TAGS.has(tag)) {
    const fullText = element.textContent?.trim();
    if (fullText && fullText.length > 0) {
      return normalizeText(fullText);
    }
  }

  // Last resort: use tag name
  return tag;
}

/**
 * Get direct text content (text nodes that are direct children, not nested).
 */
function getDirectTextContent(element: HTMLElement): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent?.trim();
      if (t) text += t + ' ';
    }
  }
  return text.trim();
}

/**
 * Get a friendly landmark name for common containers.
 */
function getLandmarkName(element: HTMLElement): string | null {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  const names: Record<string, string> = {
    nav: 'Navigation',
    main: 'Main Content',
    header: 'Header',
    footer: 'Footer',
    aside: 'Sidebar',
    article: 'Article',
    section: 'Section',
    form: 'Form',
  };

  if (names[tag]) return names[tag];
  if (role && names[role]) return names[role];

  return null;
}

// =============================================================================
// ARIA Label Resolution (Phase 2)
// =============================================================================

/**
 * Resolve aria-labelledby by looking up referenced element IDs.
 * Handles space-separated list of IDs.
 */
function resolveAriaLabelledBy(ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Resolve aria-describedby for description text.
 */
function resolveAriaDescribedBy(ids: string): string | undefined {
  const text = ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

// =============================================================================
// Container Flattening (Phase 1)
// =============================================================================

/**
 * Determine if an element should be skipped (children promoted to parent level).
 * Applies to containers and text wrapper elements with no meaningful content.
 */
function shouldSkipElement(element: HTMLElement, nodeType: NodeType): boolean {
  // Never skip interactive elements - they're actionable
  if (nodeType === 'interactive') return false;

  // Never skip media elements - they're content
  if (nodeType === 'media') return false;

  // Never skip lists/tables - they're structural
  if (nodeType === 'list' || nodeType === 'listItem' || nodeType === 'table') return false;

  const tag = element.tagName.toLowerCase();

  // Never skip headings - they're important for structure
  if (/^h[1-6]$/.test(tag)) return false;

  // Never skip landmark elements
  if (LANDMARK_TAGS.has(tag)) return false;

  // Never skip if it has aria-label
  if (element.getAttribute('aria-label')) return false;

  // Never skip if it has title
  if (element.getAttribute('title')) return false;

  // Never skip if it has a role
  if (element.getAttribute('role')) return false;

  // Check for direct text content (non-whitespace)
  const hasDirectText = Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (hasDirectText) return false;

  // Skip this element - children will be promoted
  return true;
}

// =============================================================================
// Interactive Element Consolidation (Phase 3)
// =============================================================================

/**
 * Extract consolidated label from interactive element including all child text.
 * Used for buttons, links, and other interactive elements.
 */
function extractConsolidatedLabel(element: HTMLElement): string {
  // For form fields (inputs, textareas, selects), use the specialized extractor
  // This handles <label for="id">, wrapping <label>, fieldset legends, etc.
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return extractFormFieldLabel(element);
  }

  // First check aria-labelledby (highest priority)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = resolveAriaLabelledBy(labelledBy);
    if (labelText) return normalizeText(labelText);
  }

  // Then aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Collect all text content in DOM order, including SVG aria-labels
  const textParts: string[] = [];

  function collectText(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) textParts.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // For SVG, use aria-label or title
      if (tag === 'svg') {
        const svgLabel =
          el.getAttribute('aria-label') || el.querySelector('title')?.textContent?.trim();
        if (svgLabel) textParts.push(svgLabel);
        return; // Don't recurse into SVG
      }

      // Skip script, style
      if (tag === 'script' || tag === 'style') return;

      // Recurse into children
      for (const child of node.childNodes) {
        collectText(child);
      }
    }
  }

  collectText(element);

  const consolidated = textParts.join(' ').trim();
  if (consolidated) return normalizeText(consolidated);

  // Fallback to title or tag
  return element.getAttribute('title') || element.tagName.toLowerCase();
}

// =============================================================================
// Form Field Labels (Phase 4)
// =============================================================================

/**
 * Extract label for form field using multiple strategies.
 */
function extractFormFieldLabel(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): string {
  // 1. aria-labelledby (highest priority)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = resolveAriaLabelledBy(labelledBy);
    if (text) return text;
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 3. Associated <label for="id"> element
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }

  // 4. Wrapping <label> element
  const parentLabel = element.closest('label');
  if (parentLabel) {
    // Clone and remove form elements to get just the label text
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button').forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 5. Previous sibling (common pattern: "Label: [input]")
  const prevSibling = element.previousElementSibling;
  if (prevSibling) {
    const tag = prevSibling.tagName.toLowerCase();
    if (tag === 'label' || tag === 'span' || tag === 'div') {
      const text = prevSibling.textContent?.trim()?.replace(/:$/, '');
      if (text && text.length < 100) return text;
    }
  }

  // 6. Fieldset legend
  const fieldset = element.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = legend.textContent?.trim();
      if (text) return text;
    }
  }

  // 7. Placeholder
  if ('placeholder' in element && element.placeholder) {
    return element.placeholder;
  }

  // 8. name attribute (last resort, often technical)
  if (element.name) {
    // Convert "first_name" to "First Name"
    return element.name.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Fallback
  if (element instanceof HTMLInputElement) {
    return element.type || 'input';
  }
  if (element instanceof HTMLSelectElement) {
    return 'dropdown';
  }
  return 'text area';
}

// =============================================================================
// Smart Collapse Logic
// =============================================================================

/**
 * Determine if a node should be auto-expanded based on collapse rules.
 */
export function shouldAutoExpand(
  depth: number,
  childCount: number,
  hasInteractiveChild: boolean,
  config: CollapseConfig = DEFAULT_COLLAPSE_CONFIG
): boolean {
  // Always expand if has direct interactive element
  if (hasInteractiveChild) return true;

  // Expand first N levels by default
  if (depth < config.initialExpandDepth) return true;

  // Collapse if too deep
  if (depth >= config.maxExpandedDepth) return false;

  // Collapse if too many children
  if (childCount > config.maxExpandedChildren) return false;

  // Expand small groups
  if (childCount <= config.minChildrenToExpand) return true;

  return false;
}

/**
 * Check if any child is interactive.
 */
function hasInteractiveChild(children: TreeNode[]): boolean {
  return children.some((child) => child.nodeType === 'interactive');
}

// =============================================================================
// Modal Detection
// =============================================================================

/**
 * Check if an element is a modal/overlay covering the viewport.
 */
export function isModalElement(element: HTMLElement): boolean {
  const role = element.getAttribute('role');

  // Check for dialog role
  if (role && MODAL_ROLES.has(role)) {
    return !isHidden(element);
  }

  // Check for common modal patterns
  const style = window.getComputedStyle(element);

  // Must be fixed or absolute positioned
  if (style.position !== 'fixed' && style.position !== 'absolute') {
    return false;
  }

  // Must cover significant viewport area
  return coversViewport(element, 0.3);
}

/**
 * Check if element covers a threshold percentage of viewport.
 */
function coversViewport(element: HTMLElement, threshold: number): boolean {
  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = rect.width * rect.height;
  return elementArea / viewportArea >= threshold;
}

/**
 * Detect the currently active modal on the page.
 */
export function detectActiveModal(): HTMLElement | null {
  // Strategy 1: Check for elements with role="dialog" that are visible
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const dialog of dialogs) {
    if (dialog instanceof HTMLElement && !isHidden(dialog) && coversViewport(dialog, 0.3)) {
      return dialog;
    }
  }

  // Strategy 2: Check for fixed/absolute positioned elements covering viewport
  const potentialModals = document.querySelectorAll(
    '[class*="modal"], [class*="dialog"], [class*="overlay"], [class*="popup"]'
  );

  for (const el of potentialModals) {
    if (el instanceof HTMLElement && !isHidden(el)) {
      const style = window.getComputedStyle(el);
      if (
        (style.position === 'fixed' || style.position === 'absolute') &&
        coversViewport(el, 0.3) &&
        hasInteractiveContent(el)
      ) {
        return el;
      }
    }
  }

  return null;
}

/**
 * Check if element has interactive content (not just an overlay backdrop).
 */
function hasInteractiveContent(element: HTMLElement): boolean {
  const interactiveChildren = element.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [role="link"]'
  );
  return interactiveChildren.length > 0;
}

// =============================================================================
// Form State Extraction
// =============================================================================

/**
 * Extract form state from an element.
 */
export function extractFormState(element: HTMLElement): {
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  options?: { value: string; label: string; selected: boolean }[];
} {
  const state: {
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    options?: { value: string; label: string; selected: boolean }[];
  } = {};

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    } else if (element.type !== 'password') {
      state.value = element.value;
    }
    state.disabled = element.disabled;
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
    state.disabled = element.disabled;
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.disabled = element.disabled;
    state.options = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.text,
      selected: opt.selected,
    }));
  } else if (element instanceof HTMLButtonElement) {
    state.disabled = element.disabled;
  }

  return state;
}

// =============================================================================
// Tree Building
// =============================================================================

/**
 * Build a DOM tree from a container element.
 */
export function buildDOMTree(
  root: HTMLElement = document.body,
  config: Partial<TreeTrackerConfig> = {}
): DOMTree {
  const mergedConfig = { ...DEFAULT_TREE_TRACKER_CONFIG, ...config };
  let nodeCount = 0;
  let maxDepth = 0;

  // Detect modal first
  const activeModal = detectActiveModal();
  let modalNode: TreeNode | null = null;

  /**
   * Process a single element and its children recursively.
   * Returns TreeNode, array of TreeNodes (when container is skipped), or null.
   */
  function processNode(element: HTMLElement, depth: number): TreeNode | TreeNode[] | null {
    // Enforce limits
    if (nodeCount >= mergedConfig.maxNodes) return null;
    if (depth > mergedConfig.maxDepth) return null;

    // Skip hidden elements
    if (isHidden(element)) return null;

    // Skip boilerplate tags
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;

    // Skip elements with no content and no children
    const hasChildren = element.children.length > 0;
    const hasText = element.textContent?.trim();
    if (!hasChildren && !hasText && !isInteractiveElement(element)) {
      // Allow media elements without text
      if (!MEDIA_TAGS.has(tag)) return null;
    }

    nodeCount++;
    maxDepth = Math.max(maxDepth, depth);

    // Create fingerprint
    const fingerprint = createFingerprint(element);

    // Determine node type and properties
    const nodeType = getNodeType(element);
    const interactiveType = nodeType === 'interactive' ? getInteractiveType(element) : undefined;
    const headingLevel = getHeadingLevel(element);
    const isModal = activeModal ? element === activeModal || activeModal.contains(element) : false;

    // Phase 3: For interactive elements, use consolidated label and DON'T process children
    if (nodeType === 'interactive') {
      const label = extractConsolidatedLabel(element);
      const formState = extractFormState(element);

      // Get aria-describedby for description
      const describedBy = element.getAttribute('aria-describedby');
      const description = describedBy ? resolveAriaDescribedBy(describedBy) : undefined;

      const node: TreeNode = {
        id: fingerprint.id,
        fingerprint,
        tagName: tag,
        nodeType,
        label,
        originalLabel: label,
        description,
        depth,
        isExpanded: false, // Interactive elements don't expand
        isVisible: isInViewport(element),
        isModal,
        interactiveType,
        headingLevel,
        altText: tag === 'img' ? element.getAttribute('alt') || undefined : undefined,
        placeholder:
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.placeholder || undefined
            : undefined,
        children: [], // NO CHILDREN for interactive elements
        ...formState,
      };

      // Track modal node
      if (element === activeModal) {
        modalNode = node;
      }

      return node;
    }

    // Process children for non-interactive elements
    const children: TreeNode[] = [];
    for (const child of element.children) {
      if (child instanceof HTMLElement) {
        const result = processNode(child, depth + 1);
        if (result) {
          // Handle both single nodes and arrays (from skipped containers)
          if (Array.isArray(result)) {
            children.push(...result);
          } else {
            children.push(result);
          }
        }
      }
    }

    // Phase 1: Check if this element should be skipped (flattened)
    // Applies to containers AND text wrapper elements without meaningful content
    if (shouldSkipElement(element, nodeType)) {
      if (children.length > 0) {
        // Update depths of promoted children
        for (const child of children) {
          child.depth = depth;
        }
        return children;
      } else {
        // Empty element with no meaningful attributes - skip entirely
        return null;
      }
    }

    // Get label for non-interactive elements
    const label = extractLabel(element);

    // NOTE: Meaningless label filtering has been removed to show ALL text content
    // per spec: specs/show-all-text-content.md

    // Get aria-describedby for description
    const describedBy = element.getAttribute('aria-describedby');
    const description = describedBy ? resolveAriaDescribedBy(describedBy) : undefined;

    // Determine expand state
    const shouldExpand = shouldAutoExpand(depth, children.length, hasInteractiveChild(children));

    // Extract form state
    const formState = extractFormState(element);

    const node: TreeNode = {
      id: fingerprint.id,
      fingerprint,
      tagName: tag,
      nodeType,
      label,
      originalLabel: label,
      description,
      depth,
      isExpanded: shouldExpand,
      isVisible: isInViewport(element),
      isModal,
      interactiveType,
      headingLevel,
      altText: tag === 'img' ? element.getAttribute('alt') || undefined : undefined,
      placeholder:
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.placeholder || undefined
          : undefined,
      children,
      ...formState,
    };

    // Track modal node
    if (element === activeModal) {
      modalNode = node;
    }

    return node;
  }

  // Build tree from root
  const result = processNode(root, 0);

  // Handle case where root returns an array (shouldn't happen for body, but be safe)
  let rootNode: TreeNode;
  if (!result) {
    // Return empty tree if nothing visible
    return {
      root: {
        id: 'empty-root',
        fingerprint: createFingerprint(root),
        tagName: 'body',
        nodeType: 'container',
        label: 'Page',
        originalLabel: 'Page',
        depth: 0,
        isExpanded: true,
        isVisible: true,
        isModal: false,
        children: [],
      },
      nodeCount: 0,
      maxDepth: 0,
      modalNode: null,
      url: window.location.href,
      title: document.title,
    };
  } else if (Array.isArray(result)) {
    // Wrap multiple root nodes in a container
    rootNode = {
      id: 'root-container',
      fingerprint: createFingerprint(root),
      tagName: 'body',
      nodeType: 'container',
      label: 'Page',
      originalLabel: 'Page',
      depth: 0,
      isExpanded: true,
      isVisible: true,
      isModal: false,
      children: result,
    };
  } else {
    rootNode = result;
  }

  return {
    root: rootNode,
    nodeCount,
    maxDepth,
    modalNode,
    url: window.location.href,
    title: document.title,
  };
}

// =============================================================================
// Node Lookup
// =============================================================================

/**
 * Find a node by ID in the tree.
 */
export function findNodeById(tree: TreeNode, id: string): TreeNode | null {
  if (tree.id === id) return tree;

  for (const child of tree.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }

  return null;
}

/**
 * Find parent of a node by ID.
 */
export function findParentOf(
  tree: TreeNode,
  id: string,
  parent: TreeNode | null = null
): TreeNode | null {
  if (tree.id === id) return parent;

  for (const child of tree.children) {
    const found = findParentOf(child, id, tree);
    if (found) return found;
  }

  return null;
}

/**
 * Get all nodes as flat array.
 */
export function flattenTree(node: TreeNode): TreeNode[] {
  const nodes: TreeNode[] = [node];
  for (const child of node.children) {
    nodes.push(...flattenTree(child));
  }
  return nodes;
}

/**
 * Count total nodes in tree.
 */
export function countNodes(node: TreeNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}
