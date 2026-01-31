import { scanPage, clickElementById, setInputValue, checkboxToggle, setSelectValue } from '../utils/dom-scanner';
import { bindingManager, type PendingChange, type ElementState } from '../utils/binding-manager';
import type { 
  ContentToSidepanelMessage, 
  SidepanelToContentMessage 
} from '../utils/reactive-messages';
import type { ScannedAction } from '../utils/dom-scanner';

// Store pending changes for later processing
const pendingChanges = new Map<string, PendingChange>();

/**
 * Send a message to the sidepanel/background
 */
function sendMessage(message: ContentToSidepanelMessage) {
  browser.runtime.sendMessage(message).catch(() => {
    // Side panel or background may not be listening
  });
}

/**
 * Initialize reactive tracking with binding manager
 */
function initReactiveTracking(actions: ScannedAction[]) {
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
      // Store for later processing
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

/**
 * Describe a subtree for LLM processing
 */
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

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Handle messages from sidepanel
    browser.runtime.onMessage.addListener(
      (
        message: SidepanelToContentMessage | { type: string; id?: string; value?: string; checked?: boolean },
        _sender: unknown,
        sendResponse: (r: unknown) => void,
      ) => {
        // ===== EXISTING MESSAGE HANDLERS =====
        
        if (message.type === 'SCAN_PAGE') {
          try {
            const data = scanPage();
            sendResponse(data);
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
        
        if (message.type === 'CLICK_ELEMENT' && 'id' in message && message.id) {
          const ok = clickElementById(message.id);
          sendResponse({ ok });
          return;
        }
        
        if (message.type === 'SET_INPUT_VALUE' && 'id' in message && message.id && 'value' in message && message.value !== undefined) {
          const ok = setInputValue(message.id, message.value);
          sendResponse({ ok });
          return;
        }
        
        if (message.type === 'TOGGLE_CHECKBOX' && 'id' in message && message.id) {
          const ok = checkboxToggle(message.id, 'checked' in message ? message.checked : undefined);
          sendResponse({ ok });
          return;
        }
        
        if (message.type === 'SET_SELECT_VALUE' && 'id' in message && message.id && 'value' in message) {
          const ok = setSelectValue(message.id, message.value as string);
          sendResponse({ ok });
          return;
        }
        
        // ===== REACTIVE TRACKING MESSAGE HANDLERS =====
        
        if (message.type === 'START_TRACKING') {
          const msg = message as { type: 'START_TRACKING'; actions: ScannedAction[] };
          initReactiveTracking(msg.actions);
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
          const msg = message as { type: 'GET_SUBTREE_DESCRIPTION'; changeId: string };
          const change = pendingChanges.get(msg.changeId);
          if (change) {
            const description = describeSubtree(change);
            sendResponse({ description, elements: change.classification.type === 'new-context' ? change.classification.elements : [] });
          } else {
            sendResponse({ description: '', elements: [] });
          }
          return;
        }
        
        if (message.type === 'DISMISS_CHANGE') {
          const msg = message as { type: 'DISMISS_CHANGE'; changeId: string };
          pendingChanges.delete(msg.changeId);
          sendResponse({ ok: true });
          return;
        }
        
        sendResponse(undefined);
      },
    );
  },
});
