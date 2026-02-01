import { scanPage, scanPageContent, highlightElement, getElementLabel } from '../utils/dom-scanner';
import type { ScannedAction } from '../utils/dom-scanner';
import { TreeTracker, type TreeNode, type DOMTree } from '../utils/tree-tracker';
import { markAllText, removeMarks } from '../utils/tooltip-injector';

// ============================================================================
// GLOBAL STATE
// ============================================================================

// TreeTracker instance (unified fingerprint-based tracking)
let tracker: TreeTracker | null = null;

// Track which elements have input listeners attached
const inputListeners = new WeakMap<HTMLElement, boolean>();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Send a message to the sidepanel/background
 */
function sendMessage(message: Record<string, unknown>) {
  browser.runtime.sendMessage(message).catch(() => {
    // Side panel or background may not be listening
  });
}

/**
 * Get the current state of an input element
 */
function getInputState(element: HTMLElement): Record<string, unknown> {
  const tag = element.tagName.toLowerCase();
  const state: Record<string, unknown> = {
    label: getElementLabel(element),
    disabled: (element as HTMLButtonElement).disabled ?? false,
    visible: element.offsetParent !== null,
  };

  if (tag === 'input') {
    const input = element as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') {
      state.checked = input.checked;
      // For radio buttons, include the group name
      if (input.type === 'radio' && input.name) {
        state.radioGroup = input.name;
      }
    } else {
      state.value = input.value;
    }
  } else if (tag === 'textarea') {
    state.value = (element as HTMLTextAreaElement).value;
  } else if (tag === 'select') {
    const select = element as HTMLSelectElement;
    state.value = select.value;
    state.selectedIndex = select.selectedIndex;
    state.options = Array.from(select.options).map((opt) => ({
      value: opt.value,
      label: opt.text,
      selected: opt.selected,
    }));
  }

  return state;
}

/**
 * Attach input listeners to an element for real-time sync
 */
function attachInputListeners(element: HTMLElement, id: string) {
  if (inputListeners.has(element)) return;

  const tag = element.tagName.toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tag)) return;

  const handleInput = () => {
    const state = getInputState(element);
    sendMessage({
      type: 'STATE_PATCH',
      id,
      changes: state,
    });
  };

  // Listen for both input (real-time) and change (on blur) events
  element.addEventListener('input', handleInput);
  element.addEventListener('change', handleInput);

  inputListeners.set(element, true);
}

/**
 * Attach listeners to all tracked input elements
 */
function attachAllInputListeners() {
  if (!tracker) return;

  for (const node of tracker.getAllNodes()) {
    if (node.nodeType === 'interactive') {
      const element = tracker.getElement(node.id);
      if (element) {
        attachInputListeners(element, node.id);
      }
    }
  }
}

/**
 * Get neighbor element IDs for an element (for semantic grouping placement).
 * Finds tracked siblings and nearby elements that can help determine group placement.
 */
function getNeighborElementIds(element: HTMLElement): string[] {
  if (!tracker) return [];

  const neighborIds: string[] = [];

  // Check previous siblings
  let prev = element.previousElementSibling;
  while (prev && neighborIds.length < 3) {
    const id = tracker.getElementId(prev as HTMLElement);
    if (id) neighborIds.push(id);
    prev = prev.previousElementSibling;
  }

  // Check next siblings
  let next = element.nextElementSibling;
  while (next && neighborIds.length < 6) {
    const id = tracker.getElementId(next as HTMLElement);
    if (id) neighborIds.push(id);
    next = next.nextElementSibling;
  }

  // Check parent's other children if we don't have enough neighbors
  if (neighborIds.length < 3 && element.parentElement) {
    for (const sibling of element.parentElement.children) {
      if (sibling !== element && neighborIds.length < 6) {
        const id = tracker.getElementId(sibling as HTMLElement);
        if (id && !neighborIds.includes(id)) {
          neighborIds.push(id);
        }
      }
    }
  }

  return neighborIds;
}

/**
 * Get nearby text context for an element (for LLM evaluation)
 */
function getNearbyTextContext(element: HTMLElement): string {
  const parts: string[] = [];

  // Previous sibling text
  const prev = element.previousElementSibling;
  if (prev?.textContent) {
    parts.push(prev.textContent.trim().slice(0, 100));
  }

  // Parent text (excluding this element)
  const parent = element.parentElement;
  if (parent) {
    const clone = parent.cloneNode(true) as HTMLElement;
    // Remove the target element from clone
    const selfInClone = clone.querySelector(
      `[data-klaro-id="${element.getAttribute('data-klaro-id')}"]`
    );
    if (selfInClone) selfInClone.remove();

    const parentText = clone.textContent?.trim().slice(0, 100);
    if (parentText) parts.push(parentText);
  }

  // Next sibling text
  const next = element.nextElementSibling;
  if (next?.textContent) {
    parts.push(next.textContent.trim().slice(0, 100));
  }

  return parts.join(' ');
}

/**
 * Send initial state for all tracked input elements
 */
function sendInitialStates() {
  if (!tracker) return;

  const states: Record<string, Record<string, unknown>> = {};

  for (const node of tracker.getAllNodes()) {
    if (node.nodeType === 'interactive') {
      const element = tracker.getElement(node.id);
      if (element) {
        const tag = element.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) {
          states[node.id] = getInputState(element);
        }
      }
    }
  }

  if (Object.keys(states).length > 0) {
    sendMessage({
      type: 'INITIAL_STATE',
      states,
    });
  }
}

/**
 * Convert tree nodes to legacy ScannedAction format for backwards compatibility
 */
function treeNodesToActions(nodes: TreeNode[]): ScannedAction[] {
  return nodes
    .filter((n) => n.nodeType === 'interactive')
    .map((n) => ({
      id: n.id,
      tag: n.tagName,
      text: n.label.slice(0, 50),
    }));
}

// ============================================================================
// TREE TRACKER INITIALIZATION
// ============================================================================

/**
 * Initialize TreeTracker for unified DOM tracking.
 * Handles both interactive element tracking and full tree mirroring.
 */
async function initTreeTracker() {
  // Wait for document.body to be available
  if (!document.body) {
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver((_mutations, obs) => {
        if (document.body) {
          obs.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    });
  }

  // Initialize TreeTracker
  tracker = new TreeTracker({
    confidenceThreshold: 0.4, // Lower threshold for better matching
    gracePeriodMs: 300, // Longer grace period for React re-renders
    debugMode: false,
  });

  // Forward tree-initialized event
  tracker.on('tree-initialized', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'TREE_SCANNED',
      tree: detail.tree,
    });

    // Attach listeners to form elements
    setTimeout(() => {
      attachAllInputListeners();
      sendInitialStates();
    }, 100);
  });

  // Forward node-added event
  tracker.on('node-added', (event) => {
    const detail = (event as CustomEvent).detail;
    const element = tracker?.getElement(detail.node.id);

    // Get neighbor IDs for semantic grouping placement
    const neighborIds = element ? getNeighborElementIds(element) : [];

    // Send node-added message with neighbor info for semantic grouping
    sendMessage({
      type: 'NODE_ADDED',
      parentId: detail.parentId,
      node: detail.node,
      index: detail.index,
      neighborIds,
    });

    // Attach input listeners for interactive elements
    if (detail.node.nodeType === 'interactive' && element) {
      attachInputListeners(element, detail.node.id);
    }
  });

  // Forward node-removed event
  tracker.on('node-removed', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'NODE_REMOVED',
      nodeId: detail.nodeId,
    });
  });

  // Forward node-updated event
  tracker.on('node-updated', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'NODE_UPDATED',
      nodeId: detail.nodeId,
      changes: detail.changes,
    });
  });

  // Forward node-matched event (re-render detected)
  tracker.on('node-matched', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'NODE_MATCHED',
      nodeId: detail.nodeId,
      confidence: detail.confidence,
      changes: detail.changes,
    });

    // Also send ELEMENT_MATCHED for backwards compatibility
    const node = tracker?.getNode(detail.nodeId);
    if (node && node.nodeType === 'interactive') {
      sendMessage({
        type: 'ELEMENT_MATCHED',
        fingerprint: node.fingerprint,
        confidence: detail.confidence,
      });
    }
  });

  // Forward modal-opened event
  tracker.on('modal-opened', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'MODAL_OPENED',
      modalId: detail.modalId,
    });
  });

  // Forward modal-closed event
  tracker.on('modal-closed', (event) => {
    const detail = (event as CustomEvent).detail;
    sendMessage({
      type: 'MODAL_CLOSED',
      modalId: detail.modalId,
    });
  });

  // Handle errors
  tracker.on('tree-error', (event) => {
    const detail = (event as CustomEvent).detail;
    console.error('[Klaro] TreeTracker error:', detail.error);
  });

  // Start tracking (this will emit tree-initialized)
  await tracker.start();
}

// ============================================================================
// CONTENT SCRIPT MAIN
// ============================================================================

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    // Initialize TreeTracker (waits for body)
    // Note: Event listener tracking is injected by background.ts via chrome.scripting.executeScript
    await initTreeTracker();

    // Mark all text blocks after page loads (tooltip feature)
    const initTooltips = () => {
      setTimeout(() => markAllText(), 1000);
    };

    if (document.readyState === 'complete') initTooltips();
    else window.addEventListener('load', initTooltips);

    // Handle messages from sidepanel using async wrapper pattern
    browser.runtime.onMessage.addListener(
      (
        message: {
          type: string;
          id?: string;
          value?: string;
          checked?: boolean;
          enabled?: boolean;
        },
        _sender: unknown,
        sendResponse: (r: unknown) => void
      ) => {
        // Use async wrapper for clean async/await handling
        handleMessage(message, sendResponse);
        // Always return true to indicate async response will be sent
        return true;
      }
    );
  },
});

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

interface ContentMessage {
  type: string;
  id?: string;
  value?: string;
  checked?: boolean;
  enabled?: boolean;
}

/**
 * Main message handler with proper async/await pattern.
 * All responses are sent via sendResponse callback.
 */
async function handleMessage(
  message: ContentMessage,
  sendResponse: (r: unknown) => void
): Promise<void> {
  try {
    switch (message.type) {
      // ===== PAGE SCANNING =====

      case 'SCAN_PAGE':
        handleScanPage(sendResponse);
        break;

      case 'SCAN_PAGE_TRACKED':
        handleScanPageTracked(sendResponse);
        break;

      case 'SCAN_TREE':
        await handleScanTree(sendResponse);
        break;

      case 'SCROLL_TO_ELEMENT':
        await handleScrollToElement(message.id, sendResponse);
        break;

      // ===== ELEMENT INTERACTIONS =====

      case 'CLICK_ELEMENT':
        await handleClickElement(message.id, sendResponse);
        break;

      case 'SET_INPUT_VALUE':
        await handleSetInputValue(message.id, message.value, sendResponse);
        break;

      case 'TOGGLE_CHECKBOX':
        await handleToggleCheckbox(message.id, message.checked, sendResponse);
        break;

      case 'SET_SELECT_VALUE':
        await handleSetSelectValue(message.id, message.value, sendResponse);
        break;

      // ===== TOOLTIP MANAGEMENT =====

      case 'REMOVE_TOOLTIPS':
        handleRemoveTooltips(sendResponse);
        break;

      // ===== DEBUG MODE =====

      case 'SET_DEBUG_MODE':
        handleSetDebugMode(message.enabled, sendResponse);
        break;

      // ===== TRACKER STATUS =====

      case 'GET_TRACKER_STATUS':
        handleGetTrackerStatus(sendResponse);
        break;

      default:
        sendResponse(undefined);
    }
  } catch (e) {
    console.error('[Klaro] Message handler error:', e);
    sendResponse({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
}

function handleScanPage(sendResponse: (r: unknown) => void): void {
  try {
    const result = scanPage();
    sendResponse(result);
  } catch (e) {
    sendResponse({
      article: null,
      headings: [],
      actions: [],
      pageCopy: [],
      error: e instanceof Error ? e.message : 'Scan failed',
    });
  }
}

function handleScanPageTracked(sendResponse: (r: unknown) => void): void {
  try {
    const content = scanPageContent();
    const actions = tracker ? treeNodesToActions(tracker.getAllNodes()) : [];
    setTimeout(() => sendInitialStates(), 100);
    sendResponse({ ...content, actions });
  } catch (e) {
    sendResponse({
      article: null,
      headings: [],
      actions: [],
      pageCopy: [],
      error: e instanceof Error ? e.message : 'Scan failed',
    });
  }
}

async function handleScanTree(sendResponse: (r: unknown) => void): Promise<void> {
  if (!tracker) {
    sendResponse({ type: 'TREE_SCANNED', tree: null, error: 'Tracker not initialized' });
    return;
  }

  try {
    let tree = tracker.getTree();

    if (!tree) {
      // Restart tracking to get fresh tree
      tracker.stop();
      tree = await tracker.start();
    }

    setTimeout(() => sendInitialStates(), 100);
    sendResponse({ type: 'TREE_SCANNED', tree });
  } catch (e) {
    sendResponse({
      type: 'TREE_SCANNED',
      tree: null,
      error: e instanceof Error ? e.message : 'Scan failed',
    });
  }
}

async function handleScrollToElement(
  id: string | undefined,
  sendResponse: (r: unknown) => void
): Promise<void> {
  if (!id) {
    sendResponse({ type: 'SCROLL_COMPLETE', success: false, error: 'No element ID provided' });
    return;
  }

  if (!tracker) {
    sendResponse({ type: 'SCROLL_COMPLETE', success: false, error: 'Tracker not initialized' });
    return;
  }

  const result = await tracker.scrollToElement(id);
  sendResponse({ type: 'SCROLL_COMPLETE', success: result.success, error: result.error });
}

async function handleClickElement(
  id: string | undefined,
  sendResponse: (r: unknown) => void
): Promise<void> {
  if (!id) {
    sendResponse({ ok: false, error: 'No element ID provided' });
    return;
  }

  if (!tracker) {
    sendResponse({ ok: false, error: 'Tracker not initialized' });
    return;
  }

  const result = await tracker.clickElement(id);
  if (result.success) {
    const element = tracker.getElement(id);
    if (element) highlightElement(element);
  }
  sendResponse({ ok: result.success, error: result.error });
}

async function handleSetInputValue(
  id: string | undefined,
  value: string | undefined,
  sendResponse: (r: unknown) => void
): Promise<void> {
  if (!id || value === undefined) {
    sendResponse({ ok: false, error: 'Missing element ID or value' });
    return;
  }

  if (!tracker) {
    sendResponse({ ok: false, error: 'Tracker not initialized' });
    return;
  }

  const result = await tracker.setInputValue(id, value);
  if (result.success) {
    const element = tracker.getElement(id);
    if (element) highlightElement(element);
  }
  sendResponse({ ok: result.success, error: result.error });
}

async function handleToggleCheckbox(
  id: string | undefined,
  checked: boolean | undefined,
  sendResponse: (r: unknown) => void
): Promise<void> {
  if (!id) {
    sendResponse({ ok: false, error: 'No element ID provided' });
    return;
  }

  if (!tracker) {
    sendResponse({ ok: false, error: 'Tracker not initialized' });
    return;
  }

  const result = await tracker.toggleCheckbox(id, checked);
  if (result.success) {
    const element = tracker.getElement(id);
    if (element) highlightElement(element);
  }
  sendResponse({ ok: result.success, error: result.error });
}

async function handleSetSelectValue(
  id: string | undefined,
  value: string | undefined,
  sendResponse: (r: unknown) => void
): Promise<void> {
  if (!id || value === undefined) {
    sendResponse({ ok: false, error: 'Missing element ID or value' });
    return;
  }

  if (!tracker) {
    sendResponse({ ok: false, error: 'Tracker not initialized' });
    return;
  }

  const result = await tracker.setSelectValue(id, value);
  if (result.success) {
    const element = tracker.getElement(id);
    if (element) highlightElement(element);
  }
  sendResponse({ ok: result.success, error: result.error });
}

function handleRemoveTooltips(sendResponse: (r: unknown) => void): void {
  removeMarks();
  sendResponse({ ok: true });
}

function handleSetDebugMode(
  enabled: boolean | undefined,
  sendResponse: (r: unknown) => void
): void {
  if (tracker) {
    tracker.setConfig({ debugMode: enabled ?? false });
  }
  sendResponse({ ok: true });
}

function handleGetTrackerStatus(sendResponse: (r: unknown) => void): void {
  if (tracker) {
    const nodes = tracker.getAllNodes();
    sendResponse({
      ok: true,
      trackerActive: true,
      elementCount: nodes.length,
      elements: treeNodesToActions(nodes),
    });
  } else {
    sendResponse({
      ok: true,
      trackerActive: false,
      elementCount: 0,
      elements: [],
    });
  }
}
