import { TabStorage } from '../utils/element-tracker/storage';

export default defineBackground(() => {
  // Open side panel when extension icon is clicked
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Clean up storage when a tab is closed
  browser.tabs.onRemoved.addListener((tabId) => {
    TabStorage.cleanupTab(tabId);
  });

  // Clean up orphaned storage on startup (tabs closed while browser was closed)
  TabStorage.cleanupOrphanedTabs();
});
