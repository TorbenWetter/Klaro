import { scanPage, clickElementById, setInputValue, checkboxToggle } from '../utils/dom-scanner';

const PAGE_UPDATED_DEBOUNCE_MS = 600;

function notifyPageUpdated() {
  browser.runtime.sendMessage({ type: 'PAGE_UPDATED' }).catch(() => {
    // Side panel or background may not be listening
  });
}

function setupDomReactivity() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      notifyPageUpdated();
    }, PAGE_UPDATED_DEBOUNCE_MS);
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } else {
    const bodyObserver = new MutationObserver((_mutations, obs) => {
      if (document.body) {
        obs.disconnect();
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    setupDomReactivity();

    browser.runtime.onMessage.addListener(
      (
        message: { type: string; id?: string; value?: string; checked?: boolean },
        _sender: unknown,
        sendResponse: (r: unknown) => void,
      ) => {
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
        if (message.type === 'CLICK_ELEMENT' && message.id) {
          const ok = clickElementById(message.id);
          sendResponse({ ok });
          return;
        }
        if (message.type === 'SET_INPUT_VALUE' && message.id && message.value !== undefined) {
          const ok = setInputValue(message.id, message.value);
          sendResponse({ ok });
          return;
        }
        if (message.type === 'TOGGLE_CHECKBOX' && message.id) {
          const ok = checkboxToggle(message.id, message.checked);
          sendResponse({ ok });
          return;
        }
        sendResponse(undefined);
      },
    );
  },
});
