/**
 * Content Script - MAIN World
 *
 * Runs in the page's JavaScript context (not isolated) to intercept
 * addEventListener calls and track which elements have event listeners.
 *
 * This allows us to detect interactive elements that don't use semantic HTML
 * (e.g., divs with click handlers in React apps).
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // Set of elements with click-related event listeners
    const elementsWithClickListeners = new WeakSet<EventTarget>();

    // Click-related event types we care about
    const CLICK_EVENTS = new Set([
      'click',
      'mousedown',
      'mouseup',
      'touchstart',
      'touchend',
      'pointerdown',
      'pointerup',
    ]);

    // Store original addEventListener
    const originalAddEventListener = EventTarget.prototype.addEventListener;

    // Monkey-patch addEventListener
    EventTarget.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      // Track elements with click-related listeners
      if (CLICK_EVENTS.has(type) && this instanceof Element) {
        elementsWithClickListeners.add(this);

        // Mark the element with a data attribute for easy detection
        // from the isolated content script
        if (this instanceof HTMLElement) {
          this.dataset.klaroHasClickListener = 'true';
        }
      }

      // Call original
      return originalAddEventListener.call(this, type, listener, options);
    };

    // Also patch removeEventListener to potentially unmark elements
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ) {
      // Note: We don't remove the marker because:
      // 1. An element might have multiple click listeners
      // 2. Tracking removal accurately is complex
      // 3. False positives (thinking something is interactive) are better than false negatives

      return originalRemoveEventListener.call(this, type, listener, options);
    };

    // Expose a function to check if an element has click listeners
    // This can be called from the isolated content script via window messaging
    (window as any).__klaro_hasClickListener = (element: Element): boolean => {
      return elementsWithClickListeners.has(element);
    };

    // Also expose a function to get all elements with click listeners
    (window as any).__klaro_getClickableElements = (): Element[] => {
      // Query all elements with our marker
      return Array.from(document.querySelectorAll('[data-klaro-has-click-listener="true"]'));
    };

    console.debug('[Klaro] Main world script initialized - tracking event listeners');
  },
});
