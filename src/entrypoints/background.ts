import { TabStorage } from '../utils/element-tracker/storage';

export default defineBackground(() => {
  // Open side panel when extension icon is clicked
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Inject MAIN world script as early as possible using webNavigation
  // onCommitted fires when navigation commits (earlier than tabs.onUpdated)
  // We use file-based injection to bypass CSP restrictions (inline scripts are blocked)
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    // Only inject in main frame, skip chrome:// URLs
    if (details.frameId !== 0) return;
    if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://'))
      return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        world: 'MAIN',
        injectImmediately: true, // Inject ASAP, before document parsing
        files: ['main-world-inject.js'], // Use file-based injection to bypass CSP
      });
    } catch {
      // Ignore errors (e.g., restricted pages)
    }
  });

  // Clean up storage when a tab is closed
  browser.tabs.onRemoved.addListener((tabId) => {
    TabStorage.cleanupTab(tabId);
  });

  // Clean up orphaned storage on startup
  TabStorage.cleanupOrphanedTabs();
});
