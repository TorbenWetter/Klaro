import {
  scanPage,
  scanPageContent,
  clickElementById,
  setInputValue,
  checkboxToggle,
  setSelectValue,
  highlightElement,
} from '../utils/dom-scanner';
import { bindingManager, type PendingChange } from '../utils/binding-manager';
import { ElementTracker, type TrackedElement } from '../utils/element-tracker';
import type {
  ContentToSidepanelMessage,
  SidepanelToContentMessage,
} from '../utils/reactive-messages';
import type { ScannedAction } from '../utils/dom-scanner';
import { markAllText, removeMarks } from '../utils/tooltip-injector';

// ============================================================================
// GLOBAL STATE
// ============================================================================

// ElementTracker instance (fingerprint-based, survives DOM destruction)
let tracker: ElementTracker | null = null;

// Store pending changes for later processing (bindingManager)
const pendingChanges = new Map<string, PendingChange>();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Send a message to the sidepanel/background
 */
function sendMessage(message: ContentToSidepanelMessage) {
  browser.runtime.sendMessage(message).catch(() => {});
}

/**
 * Notify sidebar that the page has been updated (ElementTracker).
 */
function notifyPageUpdated() {
  browser.runtime.sendMessage({ type: 'PAGE_UPDATED' }).catch(() => {
    // Side panel or background may not be listening
  });
}

/**
 * Convert tracked elements to the ScannedAction format expected by the sidebar.
 */
function trackedToActions(tracked: TrackedElement[]): ScannedAction[] {
  return tracked
    .filter((t) => t.status !== 'lost')
    .map((t) => ({
      id: t.fingerprint.id,
      tag: t.fingerprint.tagName,
      text: t.fingerprint.textContent.slice(0, 50),
    }));
}

// ============================================================================
// BINDING MANAGER INTEGRATION (teammates' approach)
// ============================================================================

/**
 * Initialize reactive tracking with binding manager (polling-based).
 * Uses data-acc-id attributes for element identification.
 */
function initBindingManagerTracking(actions: ScannedAction[]) {
  // Clear any existing bindings
  bindingManager.clearBindings();
  pendingChanges.clear();

  // Initialize callbacks
  bindingManager.init({
    onStatePatch: (patch) => {
      sendMessage({
        type: 'STATE_PATCH',
        id: patch.id,
        changes: patch.changes,
      });
    },

    onElementRemoved: (id) => {
      sendMessage({
        type: 'ELEMENT_REMOVED',
        id,
      });
    },

    onMinorAddition: (elements) => {
      sendMessage({
        type: 'MINOR_ADDITION',
        elements,
      });
    },

    onPendingChange: (change) => {
      pendingChanges.set(change.id, change);

      sendMessage({
        type: 'PENDING_CHANGE',
        change,
      });
    },

    onInitialState: (states) => {
      // Send initial state for all elements so UI can sync current values
      sendMessage({
        type: 'INITIAL_STATE',
        states: Object.fromEntries(states),
      });
    },
  });

  // Create bindings from initial scan
  bindingManager.createBindingsFromScan(actions);

  // Start tracking
  bindingManager.start();
}

function describeSubtree(change: PendingChange): string {
  if (change.classification.type !== 'new-context') {
    return '';
  }

  const subtree = change.classification.subtree;
  const elements = change.classification.elements;

  // Build a description of the subtree
  const lines: string[] = [];

  // Get the role/tag of the root
  const tag = subtree.tagName?.toLowerCase() || 'div';
  const role = subtree.getAttribute('role');
  const ariaLabel = subtree.getAttribute('aria-label');

  lines.push(`New UI Context: ${role || tag}${ariaLabel ? ` (${ariaLabel})` : ''}`);
  lines.push('');

  // Get visible text content (limited)
  const textContent = subtree.textContent?.trim().slice(0, 500) || '';
  if (textContent) {
    lines.push(`Content preview: ${textContent}`);
    lines.push('');
  }

  // List interactive elements
  lines.push('Interactive elements:');
  for (const el of elements) {
    lines.push(`- [${el.tag}] ${el.text || '(no label)'} (id: ${el.id})`);
  }

  return lines.join('\n');
}

// ============================================================================
// ELEMENT TRACKER INTEGRATION (fingerprint-based)
// ============================================================================

/**
 * Initialize ElementTracker for fingerprint-based tracking.
 * Survives DOM destruction by React/Vue/Angular.
 */
async function initElementTracker() {
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

  // Initialize ElementTracker
  tracker = new ElementTracker({
    confidenceThreshold: 0.6,
    gracePeriodMs: 100,
    debugMode: false,
  });

  // Listen for element updates and notify sidebar
  tracker.on('elements-updated', () => {
    notifyPageUpdated();
  });

  // Start tracking
  await tracker.start();
}

/**
 * Try to find element by ID using both systems:
 * 1. First try ElementTracker (fingerprint-based)
 * 2. Fall back to data-acc-id query (legacy)
 */
function findElementById(id: string): HTMLElement | null {
  // Try ElementTracker first
  if (tracker) {
    const el = tracker.getElementById(id);
    if (el) return el;
  }

  // Fall back to data-acc-id query
  return document.querySelector<HTMLElement>(`[data-acc-id="${id}"]`);
}

// ============================================================================
// CONTENT SCRIPT MAIN
// ============================================================================

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    // Initialize ElementTracker
    await initElementTracker();

    // Mark all text blocks after page loads (tooltip feature)
    const initTooltips = () => {
      setTimeout(() => markAllText(), 1000);
    };

    if (document.readyState === 'complete') initTooltips();
    else window.addEventListener('load', initTooltips);

    // Handle messages from sidepanel
    browser.runtime.onMessage.addListener(
      (
        message: SidepanelToContentMessage | { type: string; id?: string; value?: string; checked?: boolean; enabled?: boolean; actions?: ScannedAction[] },
        _sender: unknown,
        sendResponse: (r: unknown) => void,
      ) => {
        // ===== PAGE SCANNING =====

        if (message.type === 'SCAN_PAGE') {
          try {
            // Use legacy scanPage which includes actions with data-acc-id
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

        // Scan with ElementTracker (fingerprint-based IDs)
        if (message.type === 'SCAN_PAGE_TRACKED') {
          try {
            // Get page content (article, headings, pageCopy) from dom-scanner
            const content = scanPageContent();

            // Get tracked actions from ElementTracker
            const actions = tracker
              ? trackedToActions(tracker.getTrackedElements())
              : [];

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

        // ===== ELEMENT INTERACTIONS =====

        if (message.type === 'CLICK_ELEMENT' && 'id' in message && message.id) {
          // Try ElementTracker first (async click with visual feedback)
          if (tracker) {
            tracker.clickElement(message.id).then((result) => {
              if (result.success) {
                sendResponse({ ok: true, ...result });
              } else {
                // Fall back to legacy click
                const ok = clickElementById(message.id!);
                sendResponse({ ok });
              }
            });
            return true; // Keep channel open for async response
          }

          // Fall back to legacy click
          const ok = clickElementById(message.id);
          sendResponse({ ok });
          return;
        }

        if (message.type === 'SET_INPUT_VALUE' && 'id' in message && message.id && 'value' in message && message.value !== undefined) {
          // Try to find element with both systems
          const el = findElementById(message.id) as HTMLInputElement | HTMLTextAreaElement | null;
          if (el) {
            el.focus();
            el.value = message.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            highlightElement(el);
            sendResponse({ ok: true });
          } else {
            // Legacy fallback
            const ok = setInputValue(message.id, message.value);
            sendResponse({ ok });
          }
          return;
        }

        if (message.type === 'TOGGLE_CHECKBOX' && 'id' in message && message.id) {
          // Try to find element with both systems
          const el = findElementById(message.id) as HTMLInputElement | null;
          if (el) {
            if ('checked' in message && message.checked !== undefined) {
              el.checked = message.checked;
            } else {
              el.checked = !el.checked;
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            highlightElement(el);
            sendResponse({ ok: true });
          } else {
            // Legacy fallback
            const ok = checkboxToggle(message.id, 'checked' in message ? message.checked : undefined);
            sendResponse({ ok });
          }
          return;
        }

        if (message.type === 'SET_SELECT_VALUE' && 'id' in message && message.id && 'value' in message) {
          // Try to find element with both systems
          const el = findElementById(message.id) as HTMLSelectElement | null;
          if (el) {
            el.value = message.value as string;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            highlightElement(el);
            sendResponse({ ok: true });
          } else {
            // Legacy fallback
            const ok = setSelectValue(message.id, message.value as string);
            sendResponse({ ok });
          }
          return;
        }

        // ===== BINDING MANAGER TRACKING (legacy) =====

        if (message.type === 'START_TRACKING') {
          const msg = message as { type: 'START_TRACKING'; actions: ScannedAction[] };
          initBindingManagerTracking(msg.actions);
          sendResponse({ ok: true });
          return;
        }

        if (message.type === 'STOP_TRACKING') {
          bindingManager.stop();
          bindingManager.clearBindings();
          pendingChanges.clear();
          sendResponse({ ok: true });
          return;
        }

        if (message.type === 'GET_SUBTREE_DESCRIPTION') {
          const change = pendingChanges.get(message.changeId as string);
          sendResponse(change ? {
            description: describeSubtree(change),
            elements: change.classification.type === 'new-context' ? change.classification.elements : []
          } : { description: '', elements: [] });
          return;
        }

        if (message.type === 'DISMISS_CHANGE') {
          pendingChanges.delete(message.changeId as string);
          sendResponse({ ok: true });
          return;
        }

        if (message.type === 'REMOVE_TOOLTIPS') {
          removeMarks();
          sendResponse({ ok: true });
          return;
        }

        // ===== ELEMENT TRACKER DEBUG =====

        if (message.type === 'SET_DEBUG_MODE' && tracker) {
          tracker.setDebugMode(message.enabled ?? false);
          sendResponse({ ok: true });
          return;
        }

        // ===== GET TRACKER STATUS =====

        if (message.type === 'GET_TRACKER_STATUS') {
          if (tracker) {
            const elements = tracker.getTrackedElements();
            sendResponse({
              ok: true,
              trackerActive: true,
              elementCount: elements.length,
              elements: trackedToActions(elements),
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
