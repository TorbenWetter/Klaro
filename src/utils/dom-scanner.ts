import { Readability } from '@mozilla/readability';

/** Parsed article from Readability (main content only). */
export interface ArticleResult {
  title: string;
  textContent: string;
  byline: string;
}

/** Interactive element found on the page (button, link, input, etc.). */
export interface ScannedAction {
  id: string;
  tag: string;
  text: string;
}

/** Heading in document order for accessible outline. */
export interface ScannedHeading {
  level: number;
  text: string;
}

/** One block in reading order: a real copy of the page flow. */
export type PageBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'text'; content: string }
  | { type: 'action'; id: string; tag: string; text: string };

/** Result of scanning the current page: article, headings, actions, and pageCopy. */
export interface ScanResult {
  article: ArticleResult | null;
  headings: ScannedHeading[];
  actions: ScannedAction[];
  /** Blocks in document order for a real copy of the page. */
  pageCopy: PageBlock[];
}

/** Result of scanning page content (without actions - those come from ElementTracker). */
export interface PageContentResult {
  article: ArticleResult | null;
  headings: ScannedHeading[];
  /** Blocks in document order for a real copy of the page. */
  pageCopy: PageBlock[];
}

/** Tags that represent interactive elements */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);

/** Tags we treat as text blocks (one block per element, in document order) */
const TEXT_BLOCK_TAGS = new Set(['p', 'li', 'td', 'th', 'figcaption', 'blockquote']);

/** Data attribute used to store element IDs for interaction (legacy, used by bindingManager) */
const ACTION_DATA_ATTR = 'data-acc-id';

/**
 * Generates a unique ID for an element, or returns existing ID if already assigned.
 */
function getOrCreateElementId(el: HTMLElement): string {
  let id = el.getAttribute(ACTION_DATA_ATTR);
  if (!id) {
    id = `cmd-${Math.random().toString(36).slice(2, 11)}`;
    el.setAttribute(ACTION_DATA_ATTR, id);
  }
  return id;
}

export function getElementLabel(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const input = el as HTMLInputElement;

    // Try various label sources
    const label =
      input.placeholder ||
      el.getAttribute('aria-label') ||
      // Check for associated label element
      getLabelForInput(input) ||
      // Check parent cell text (for table layouts)
      getParentCellLabel(el) ||
      // Fall back to name attribute
      input.name ||
      input.id ||
      '';

    return label.trim();
  }
  return (el.getAttribute('aria-label') || el.innerText || '').trim();
}

/**
 * Find a label element associated with an input via 'for' attribute or wrapping
 */
function getLabelForInput(input: HTMLInputElement): string {
  // Check for label with matching 'for' attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent?.trim() || '';
  }

  // Check if input is wrapped in a label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    // Get text content excluding the input itself
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((el) => el.remove());
    return clone.textContent?.trim() || '';
  }

  return '';
}

/**
 * For table-based layouts, get label from adjacent cells
 */
function getParentCellLabel(el: HTMLElement): string {
  const cell = el.closest('td, th');
  if (!cell) return '';

  // Check previous sibling cell (common pattern: label in first column)
  const prevCell = cell.previousElementSibling;
  if (prevCell && (prevCell.tagName === 'TD' || prevCell.tagName === 'TH')) {
    const text = prevCell.textContent?.trim() || '';
    // Remove trailing colon if present
    return text.replace(/:$/, '');
  }

  return '';
}

function isInteractiveAndVisible(node: Node): boolean {
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  if (!tag || !INTERACTIVE_TAGS.has(tag)) {
    if (el.getAttribute?.('role') !== 'button') return false;
  }
  if (el.offsetParent === null) return false;

  // For inputs, always include them even without a label
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const input = el as HTMLInputElement;
    // Skip hidden inputs
    if (input.type === 'hidden') return false;
    return true;
  }

  const label = getElementLabel(el);
  return label.length > 0;
}

/**
 * Scans the current document for main article content (Readability) and
 * interactive elements (buttons, links, inputs). Assigns stable `data-acc-id`
 * to elements so the side panel can trigger clicks.
 *
 * NOTE: This is the legacy scanner used by bindingManager.
 * For ElementTracker integration, use scanPageContent() instead.
 */
export function scanPage(): ScanResult {
  // Article via Readability (mutates the clone)
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const parsed = reader.parse();
  const article: ArticleResult | null = parsed
    ? {
        title: parsed.title ?? '',
        textContent: parsed.textContent ?? '',
        byline: parsed.byline ?? '',
      }
    : null;

  const headings: ScannedHeading[] = [];
  const headingWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      const level = tag?.match(/^h([1-6])$/)?.[1];
      if (!level || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
      const text = (el.textContent ?? '').trim();
      if (text.length === 0) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (headingWalker.nextNode()) {
    const el = headingWalker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag.slice(1), 10);
    headings.push({
      level,
      text: (el.textContent ?? '').trim().slice(0, 120),
    });
  }

  const actions: ScannedAction[] = [];
  const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return isInteractiveAndVisible(node as HTMLElement)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  while (treeWalker.nextNode()) {
    const el = treeWalker.currentNode as HTMLElement;
    actions.push({
      id: getOrCreateElementId(el),
      tag: el.tagName.toLowerCase(),
      text: getElementLabel(el).slice(0, 50),
    });
  }

  // Build page copy in document order: headings, text blocks, actions interleaved
  const pageCopy: PageBlock[] = [];
  const copyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      if (!tag || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
      if (tag.match(/^h[1-6]$/)) {
        const t = (el.textContent ?? '').trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      // Always include visible inputs, textareas, selects
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const input = el as HTMLInputElement;
        if (input.type === 'hidden') return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
      if (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.('role') === 'button') {
        return getElementLabel(el).length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      if (TEXT_BLOCK_TAGS.has(tag)) {
        const t = (el.textContent ?? '').trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  while (copyWalker.nextNode()) {
    const el = copyWalker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag.match(/^h[1-6]$/)) {
      pageCopy.push({
        type: 'heading',
        level: parseInt(tag.slice(1), 10),
        text: (el.textContent ?? '').trim().slice(0, 200),
      });
      continue;
    }
    if (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.('role') === 'button') {
      pageCopy.push({
        type: 'action',
        id: getOrCreateElementId(el),
        tag,
        text: getElementLabel(el).slice(0, 80),
      });
      continue;
    }
    if (TEXT_BLOCK_TAGS.has(tag)) {
      pageCopy.push({
        type: 'text',
        content: (el.textContent ?? '').trim().slice(0, 2000),
      });
    }
  }

  return { article, headings, actions, pageCopy };
}

/**
 * Briefly highlights an element to show it was interacted with.
 */
export function highlightElement(el: HTMLElement): void {
  const originalBorder = el.style.border;
  el.style.border = '4px solid #FFEB3B';
  setTimeout(() => {
    el.style.border = originalBorder;
  }, 1000);
}

/**
 * Scans page content (article, headings, pageCopy) without action tracking.
 * Action tracking is handled separately by ElementTracker.
 *
 * Use this with ElementTracker for stable fingerprint-based element IDs
 * that survive DOM destruction by React/Vue/Angular.
 */
export function scanPageContent(): PageContentResult {
  // Article via Readability (mutates the clone)
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const parsed = reader.parse();
  const article: ArticleResult | null = parsed
    ? {
        title: parsed.title ?? '',
        textContent: parsed.textContent ?? '',
        byline: parsed.byline ?? '',
      }
    : null;

  const headings: ScannedHeading[] = [];
  const headingWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      const level = tag?.match(/^h([1-6])$/)?.[1];
      if (!level || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
      const text = (el.textContent ?? '').trim();
      if (text.length === 0) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (headingWalker.nextNode()) {
    const el = headingWalker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag.slice(1), 10);
    headings.push({
      level,
      text: (el.textContent ?? '').trim().slice(0, 120),
    });
  }

  // Build page copy in document order: headings and text blocks
  // (actions will be added by the caller from ElementTracker)
  const pageCopy: PageBlock[] = [];
  const copyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      if (!tag || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
      if (tag.match(/^h[1-6]$/)) {
        const t = (el.textContent ?? '').trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      if (TEXT_BLOCK_TAGS.has(tag)) {
        const t = (el.textContent ?? '').trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  while (copyWalker.nextNode()) {
    const el = copyWalker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag.match(/^h[1-6]$/)) {
      pageCopy.push({
        type: 'heading',
        level: parseInt(tag.slice(1), 10),
        text: (el.textContent ?? '').trim().slice(0, 200),
      });
      continue;
    }
    if (TEXT_BLOCK_TAGS.has(tag)) {
      pageCopy.push({
        type: 'text',
        content: (el.textContent ?? '').trim().slice(0, 2000),
      });
    }
  }

  return { article, headings, pageCopy };
}
