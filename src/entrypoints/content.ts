import { scanPage, scanPageContent, highlightElement, getElementLabel } from '../utils/dom-scanner';
import { ElementTracker, type TrackedElement } from '../utils/element-tracker';
import type { ScannedAction } from '../utils/dom-scanner';
import { scanLandmarks, type ScannedLandmark } from '../utils/landmark-scanner';
import { markAllText, removeMarks } from '../utils/tooltip-injector';

// ============================================================================
// GLOBAL STATE
// ============================================================================

// ElementTracker instance (fingerprint-based, survives DOM destruction)
let tracker: ElementTracker | null = null;

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
 * Attach input listeners to a tracked element for real-time sync
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

  for (const tracked of tracker.getTrackedElements()) {
    if (tracked.status === 'lost') continue;
    const element = tracker.getElementById(tracked.fingerprint.id);
    if (element) {
      attachInputListeners(element, tracked.fingerprint.id);
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

  for (const tracked of tracker.getTrackedElements()) {
    if (tracked.status === 'lost') continue;
    const element = tracker.getElementById(tracked.fingerprint.id);
    if (element) {
      const tag = element.tagName.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) {
        states[tracked.fingerprint.id] = getInputState(element);
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

// ============================================================================
// ELEMENT TRACKER INITIALIZATION
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

  // When elements are updated, notify sidebar and attach listeners
  tracker.on('elements-updated', () => {
    sendMessage({ type: 'PAGE_UPDATED' });
    attachAllInputListeners();
  });

  // When a new element is found, notify sidebar with fingerprint for LLM evaluation
  tracker.on('element-found', (event) => {
    const element = (event as CustomEvent).detail.element;
    const fingerprint = (event as CustomEvent).detail.fingerprint;
    attachInputListeners(element, fingerprint.id);

    // Get nearby text context for LLM evaluation
    const nearbyText = getNearbyTextContext(element);

    sendMessage({
      type: 'ELEMENT_FOUND',
      fingerprint,
      nearbyText,
    });
  });

  // When an element is re-matched, re-attach listeners and update sidebar
  tracker.on('element-matched', (event) => {
    const element = (event as CustomEvent).detail.element;
    const fingerprint = (event as CustomEvent).detail.fingerprint;
    const confidence = (event as CustomEvent).detail.confidence;
    attachInputListeners(element, fingerprint.id);

    // Notify sidebar of the re-match (text may have changed)
    sendMessage({
      type: 'ELEMENT_MATCHED',
      fingerprint,
      confidence,
    });
  });

  // When an element is lost, notify sidebar
  tracker.on('element-lost', (event) => {
    const fingerprint = (event as CustomEvent).detail.fingerprint;
    sendMessage({
      type: 'ELEMENT_REMOVED',
      id: fingerprint.id,
    });
  });

  // Start tracking
  await tracker.start();

  // Attach listeners to existing elements
  attachAllInputListeners();
}

// ============================================================================
// CONTENT SCRIPT MAIN
// ============================================================================

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    // Initialize ElementTracker (waits for body)
    // Note: Event listener tracking is injected by background.ts via chrome.scripting.executeScript
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

            // Get tracked actions from ElementTracker
            const actions = tracker ? trackedToActions(tracker.getTrackedElements()) : [];

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

        // Landmark-based scan (new architecture: content organized by landmarks)
        if (message.type === 'SCAN_LANDMARKS') {
          try {
            // Get tracked elements from ElementTracker
            const trackedElements = tracker?.getTrackedElements() || [];
            const trackedMap = new Map(
              trackedElements.filter((t) => t.status !== 'lost').map((t) => [t.fingerprint.id, t])
            );

            // Scan the REAL DOM for landmarks (not a clone, so element refs match)
            // The scanner will skip boilerplate elements internally
            const landmarks = scanLandmarks(document.body, trackedMap);

            // Convert to serializable format (remove element references)
            const serializableLandmarks = landmarks.map((l) => ({
              id: l.id,
              type: l.type,
              rawTitle: l.rawTitle,
              blocks: l.blocks.map((b) => {
                if (b.type === 'element') {
                  // Keep fingerprint but make it serializable
                  return {
                    type: 'element' as const,
                    elementId: b.elementId,
                    fingerprint: b.fingerprint,
                  };
                }
                return b;
              }),
            }));

            // Send initial states for form elements
            setTimeout(() => sendInitialStates(), 100);

            sendResponse({
              url: window.location.href,
              title: document.title,
              landmarks: serializableLandmarks,
            });
          } catch (e) {
            console.error('[Klaro] SCAN_LANDMARKS error:', e);
            sendResponse({
              url: window.location.href,
              title: document.title,
              landmarks: [],
              error: e instanceof Error ? e.message : 'Scan failed',
            });
          }
          return;
        }

        // ===== ELEMENT INTERACTIONS =====

        if (message.type === 'CLICK_ELEMENT' && message.id) {
          const element = tracker?.getElementById(message.id);

          if (element) {
            element.click();
            if (typeof element.focus === 'function') element.focus();
            highlightElement(element);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Element not found' });
          }
          return;
        }

        if (message.type === 'SET_INPUT_VALUE' && message.id && message.value !== undefined) {
          const element = tracker?.getElementById(message.id) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;

          if (element) {
            element.focus();
            element.value = message.value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            highlightElement(element);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Element not found' });
          }
          return;
        }

        if (message.type === 'TOGGLE_CHECKBOX' && message.id) {
          const element = tracker?.getElementById(message.id) as HTMLInputElement | null;

          if (element) {
            if (message.checked !== undefined) {
              element.checked = message.checked;
            } else {
              element.checked = !element.checked;
            }
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            highlightElement(element);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Element not found' });
          }
          return;
        }

        if (message.type === 'SET_SELECT_VALUE' && message.id && message.value !== undefined) {
          const element = tracker?.getElementById(message.id) as HTMLSelectElement | null;

          if (element) {
            element.value = message.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            highlightElement(element);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Element not found' });
          }
          return;
        }

        // ===== TOOLTIP MANAGEMENT =====

        if (message.type === 'REMOVE_TOOLTIPS') {
          removeMarks();
          sendResponse({ ok: true });
          return;
        }

        // ===== DEBUG MODE =====

        if (message.type === 'SET_DEBUG_MODE' && tracker) {
          tracker.setDebugMode(message.enabled ?? false);
          sendResponse({ ok: true });
          return;
        }

        // ===== TRACKER STATUS =====

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
