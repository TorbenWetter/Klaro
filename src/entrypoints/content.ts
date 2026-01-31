import { scanPage, clickElementById, setInputValue, checkboxToggle, setSelectValue } from '../utils/dom-scanner';
import { bindingManager, type PendingChange } from '../utils/binding-manager';
import type { ContentToSidepanelMessage, SidepanelToContentMessage } from '../utils/reactive-messages';
import type { ScannedAction } from '../utils/dom-scanner';
import { markAllText, removeMarks } from '../utils/tooltip-injector';

const pendingChanges = new Map<string, PendingChange>();

function sendMessage(message: ContentToSidepanelMessage) {
  browser.runtime.sendMessage(message).catch(() => {});
}

function initReactiveTracking(actions: ScannedAction[]) {
  bindingManager.clearBindings();
  pendingChanges.clear();
  
  bindingManager.init({
    onStatePatch: (patch) => sendMessage({ type: 'STATE_PATCH', id: patch.id, changes: patch.changes }),
    onElementRemoved: (id) => sendMessage({ type: 'ELEMENT_REMOVED', id }),
    onMinorAddition: (elements) => sendMessage({ type: 'MINOR_ADDITION', elements }),
    onPendingChange: (change) => {
      pendingChanges.set(change.id, change);
      sendMessage({ type: 'PENDING_CHANGE', change });
    },
    onInitialState: (states) => sendMessage({ type: 'INITIAL_STATE', states: Object.fromEntries(states) }),
  });
  
  bindingManager.createBindingsFromScan(actions);
  bindingManager.start();
}

function describeSubtree(change: PendingChange): string {
  if (change.classification.type !== 'new-context') return '';
  const { subtree, elements } = change.classification;
  const tag = subtree.tagName?.toLowerCase() || 'div';
  const role = subtree.getAttribute('role');
  const text = subtree.textContent?.trim().slice(0, 500) || '';
  return [
    `New UI Context: ${role || tag}`,
    text && `Content: ${text}`,
    'Elements:',
    ...elements.map(el => `- [${el.tag}] ${el.text || '(no label)'} (id: ${el.id})`)
  ].filter(Boolean).join('\n');
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Mark all text blocks after page loads
    const init = () => {
      setTimeout(() => markAllText(), 1000);
    };
    
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
    
    browser.runtime.onMessage.addListener(
      (message: SidepanelToContentMessage | Record<string, unknown>, _sender, sendResponse) => {
        
        if (message.type === 'SCAN_PAGE') {
          try { sendResponse(scanPage()); }
          catch (e) { sendResponse({ article: null, headings: [], actions: [], pageCopy: [], error: String(e) }); }
          return;
        }
        
        if (message.type === 'CLICK_ELEMENT' && message.id) {
          sendResponse({ ok: clickElementById(message.id as string) });
          return;
        }
        
        if (message.type === 'SET_INPUT_VALUE' && message.id && message.value !== undefined) {
          sendResponse({ ok: setInputValue(message.id as string, message.value as string) });
          return;
        }
        
        if (message.type === 'TOGGLE_CHECKBOX' && message.id) {
          sendResponse({ ok: checkboxToggle(message.id as string, message.checked as boolean | undefined) });
          return;
        }
        
        if (message.type === 'SET_SELECT_VALUE' && message.id && message.value !== undefined) {
          sendResponse({ ok: setSelectValue(message.id as string, message.value as string) });
          return;
        }
        
        if (message.type === 'START_TRACKING') {
          initReactiveTracking((message as { actions: ScannedAction[] }).actions);
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
        
        sendResponse(undefined);
      }
    );
  },
});
