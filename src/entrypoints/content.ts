import { extractReaderContent } from '../utils/reader-extract';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener(
      (message: Record<string, unknown>, _sender, sendResponse) => {
        switch (message.type) {
          case 'GET_READER_CONTENT': {
            const content = extractReaderContent();
            sendResponse({ content });
            break;
          }

          case 'GET_PAGE_TEXT': {
            const content = extractReaderContent();
            const text = content?.textContent?.slice(0, 15_000) ?? '';
            sendResponse({ text });
            break;
          }

          case 'GET_SELECTED_TEXT': {
            const selection = window.getSelection()?.toString().trim() || '';
            sendResponse({ text: selection });
            break;
          }

          default:
            sendResponse(undefined);
        }
      }
    );
  },
});
