import { checkAIAvailable, summarizeText, simplifyText } from '../utils/chrome-ai';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Notify side panel when the active tab changes
  browser.tabs.onActivated.addListener((_activeInfo) => {
    browser.runtime.sendMessage({ type: 'TAB_CHANGED' }).catch(() => {});
  });

  // Notify side panel when a tab finishes loading (navigation)
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, _tab) => {
    if (changeInfo.status === 'complete') {
      browser.runtime.sendMessage({ type: 'TAB_CHANGED' }).catch(() => {});
    }
  });

  // Handle messages from the side panel
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CHECK_AI_AVAILABLE') {
      checkAIAvailable().then(sendResponse);
      return true;
    }

    if (message.type === 'SUMMARIZE_TEXT') {
      summarizeText(message.text as string)
        .then((result) => sendResponse({ result }))
        .catch((e) =>
          sendResponse({ error: e instanceof Error ? e.message : 'Summarization failed' })
        );
      return true;
    }

    if (message.type === 'SIMPLIFY_TEXT') {
      simplifyText(message.text as string)
        .then((result) => sendResponse({ result }))
        .catch((e) =>
          sendResponse({ error: e instanceof Error ? e.message : 'Simplification failed' })
        );
      return true;
    }
  });
});
