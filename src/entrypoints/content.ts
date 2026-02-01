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
    confidenceThreshold: 0.6,
    gracePeriodMs: 150, // Slightly longer than ElementTracker's 100ms for React
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
    sendMessage({
      type: 'NODE_ADDED',
      parentId: detail.parentId,
      node: detail.node,
      index: detail.index,
    });

    // Attach input listeners for interactive elements
    if (detail.node.nodeType === 'interactive') {
      const element = tracker?.getElement(detail.node.id);
      if (element) {
        attachInputListeners(element, detail.node.id);
      }
    }

    // Notify for LLM evaluation (interactive elements only)
    if (detail.node.nodeType === 'interactive') {
      const element = tracker?.getElement(detail.node.id);
      if (element) {
        const nearbyText = getNearbyTextContext(element);
        sendMessage({
          type: 'ELEMENT_FOUND',
          fingerprint: detail.node.fingerprint,
          nearbyText,
        });
      }
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

  // Handle errors
  tracker.on('tree-error', (event) => {
    const detail = (event as CustomEvent).detail;
    console.error('[Klaro] TreeTracker error:', detail.error);
  });

  // Start tracking (this will emit tree-initialized)
  await tracker.start();

  console.debug('[Klaro] TreeTracker initialized');
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

    // Handle messages from sidepanel
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
        // ===== PAGE SCANNING =====

        // Legacy scan (with data-acc-id) - kept for backwards compatibility
        if (message.type === 'SCAN_PAGE') {
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
          return;
        }

        // Fingerprint-based scan (stable IDs that survive DOM destruction)
        if (message.type === 'SCAN_PAGE_TRACKED') {
          try {
            // Get page content (article, headings, pageCopy) from dom-scanner
            const content = scanPageContent();

            // Get tracked actions from TreeTracker
            const actions = tracker ? treeNodesToActions(tracker.getAllNodes()) : [];

            // Send initial states for form elements
            setTimeout(() => sendInitialStates(), 100);

            sendResponse({
              ...content,
              actions,
            });
          } catch (e) {
            sendResponse({
              article: null,
              headings: [],
              actions: [],
              pageCopy: [],
              error: e instanceof Error ? e.message : 'Scan failed',
            });
          }
          return;
        }

        // Hierarchical tree scan (full DOM tree mirroring)
        if (message.type === 'SCAN_TREE') {
          try {
            // If tracker already has a tree, return it
            // Otherwise, restart tracking to get a fresh tree
            if (tracker) {
              const tree = tracker.getTree();
              if (tree) {
                // Send initial states for form elements
                setTimeout(() => sendInitialStates(), 100);

                sendResponse({
                  type: 'TREE_SCANNED',
                  tree,
                });
                return;
              }

              // Restart tracking to get fresh tree
              tracker.stop();
              tracker.start().then((newTree) => {
                sendResponse({
                  type: 'TREE_SCANNED',
                  tree: newTree,
                });
              });
            } else {
              sendResponse({
                type: 'TREE_SCANNED',
                tree: null,
                error: 'Tracker not initialized',
              });
            }
          } catch (e) {
            console.error('[Klaro] SCAN_TREE error:', e);
            sendResponse({
              type: 'TREE_SCANNED',
              tree: null,
              error: e instanceof Error ? e.message : 'Scan failed',
            });
          }
          return true; // Indicate async response
        }

        // Scroll to element and highlight it
        if (message.type === 'SCROLL_TO_ELEMENT' && message.id) {
          if (tracker) {
            tracker.scrollToElement(message.id).then((result) => {
              sendResponse({
                type: 'SCROLL_COMPLETE',
                success: result.success,
                error: result.error,
              });
            });
          } else {
            sendResponse({
              type: 'SCROLL_COMPLETE',
              success: false,
              error: 'Tracker not initialized',
            });
          }
          return true; // Indicate async response
        }

        // ===== ELEMENT INTERACTIONS =====

        if (message.type === 'CLICK_ELEMENT' && message.id) {
          if (tracker) {
            tracker.clickElement(message.id).then((result) => {
              if (result.success) {
                const element = tracker?.getElement(message.id!);
                if (element) highlightElement(element);
              }
              sendResponse({ ok: result.success, error: result.error });
            });
          } else {
            sendResponse({ ok: false, error: 'Tracker not initialized' });
          }
          return true; // Indicate async response
        }

        if (message.type === 'SET_INPUT_VALUE' && message.id && message.value !== undefined) {
          if (tracker) {
            tracker.setInputValue(message.id, message.value).then((result) => {
              if (result.success) {
                const element = tracker?.getElement(message.id!);
                if (element) highlightElement(element);
              }
              sendResponse({ ok: result.success, error: result.error });
            });
          } else {
            sendResponse({ ok: false, error: 'Tracker not initialized' });
          }
          return true; // Indicate async response
        }

        if (message.type === 'TOGGLE_CHECKBOX' && message.id) {
          if (tracker) {
            tracker.toggleCheckbox(message.id, message.checked).then((result) => {
              if (result.success) {
                const element = tracker?.getElement(message.id!);
                if (element) highlightElement(element);
              }
              sendResponse({ ok: result.success, error: result.error });
            });
          } else {
            sendResponse({ ok: false, error: 'Tracker not initialized' });
          }
          return true; // Indicate async response
        }

        if (message.type === 'SET_SELECT_VALUE' && message.id && message.value !== undefined) {
          if (tracker) {
            tracker.setSelectValue(message.id, message.value).then((result) => {
              if (result.success) {
                const element = tracker?.getElement(message.id!);
                if (element) highlightElement(element);
              }
              sendResponse({ ok: result.success, error: result.error });
            });
          } else {
            sendResponse({ ok: false, error: 'Tracker not initialized' });
          }
          return true; // Indicate async response
        }

        // ===== TOOLTIP MANAGEMENT =====

        if (message.type === 'REMOVE_TOOLTIPS') {
          removeMarks();
          sendResponse({ ok: true });
          return;
        }

        // ===== DEBUG MODE =====

        if (message.type === 'SET_DEBUG_MODE' && tracker) {
          tracker.setConfig({ debugMode: message.enabled ?? false });
          sendResponse({ ok: true });
          return;
        }

        // ===== TRACKER STATUS =====

        if (message.type === 'GET_TRACKER_STATUS') {
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
          return;
        }

        sendResponse(undefined);
      }
    );
  },
});
