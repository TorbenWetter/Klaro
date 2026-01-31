/**
 * MAIN World Script - Event Listener Detection
 *
 * This script runs in the page's JavaScript context (MAIN world) at document_start,
 * BEFORE any other scripts run. It detects which elements have click handlers.
 *
 * DETECTION METHODS:
 * 1. Monkey-patch addEventListener to catch native event listeners
 * 2. Monkey-patch onclick/onmousedown setters for inline handlers
 * 3. Scan for React/Preact/Vue internal properties
 * 4. Watch for DOM mutations to detect dynamically added elements
 */
(function () {
  'use strict';

  // Skip if already initialized
  if (window.__klaro_initialized) {
    return;
  }
  window.__klaro_initialized = true;

  // Click-related event types that indicate interactivity
  const CLICK_EVENTS = new Set([
    'click',
    'mousedown',
    'mouseup',
    'touchstart',
    'touchend',
    'pointerdown',
    'pointerup',
  ]);

  // Track marked elements to avoid re-scanning
  const markedElements = new WeakSet();

  /**
   * Mark an element as having a click listener.
   */
  function markElement(element, source) {
    if (!element || !(element instanceof HTMLElement)) return;
    if (markedElements.has(element)) return;

    element.dataset.klaroHasClickListener = 'true';
    markedElements.add(element);
  }

  // ==========================================================================
  // Strategy 1: Monkey-patch addEventListener
  // ==========================================================================
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (CLICK_EVENTS.has(type) && this instanceof HTMLElement) {
      markElement(this, 'addEventListener:' + type);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // ==========================================================================
  // Strategy 2: Monkey-patch onclick property setters
  // ==========================================================================
  const clickProperties = [
    'onclick',
    'onmousedown',
    'onmouseup',
    'ontouchstart',
    'ontouchend',
    'onpointerdown',
    'onpointerup',
  ];

  clickProperties.forEach(function (prop) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    if (originalDescriptor && originalDescriptor.set) {
      Object.defineProperty(HTMLElement.prototype, prop, {
        get: originalDescriptor.get,
        set: function (handler) {
          if (handler) {
            markElement(this, 'property:' + prop);
          }
          return originalDescriptor.set.call(this, handler);
        },
        configurable: true,
        enumerable: originalDescriptor.enumerable,
      });
    }
  });

  // ==========================================================================
  // Strategy 3: Detect React/Preact/Vue event handlers
  // ==========================================================================

  /**
   * Check if an element has React event handlers.
   * React 16+ stores props in __reactProps$ or memoizedProps in __reactFiber$
   */
  function hasReactClickHandler(element) {
    const keys = Object.keys(element);

    for (const key of keys) {
      // React 17+ uses __reactProps$
      if (key.startsWith('__reactProps$')) {
        const props = element[key];
        if (
          props &&
          (props.onClick ||
            props.onMouseDown ||
            props.onMouseUp ||
            props.onPointerDown ||
            props.onTouchStart)
        ) {
          return true;
        }
      }

      // React 16+ uses __reactFiber$ with memoizedProps
      if (key.startsWith('__reactFiber$')) {
        const fiber = element[key];
        if (fiber) {
          // Check memoizedProps directly
          if (fiber.memoizedProps) {
            const props = fiber.memoizedProps;
            if (
              props &&
              (props.onClick ||
                props.onMouseDown ||
                props.onMouseUp ||
                props.onPointerDown ||
                props.onTouchStart)
            ) {
              return true;
            }
          }
          // Also check pendingProps (for elements being updated)
          if (fiber.pendingProps) {
            const props = fiber.pendingProps;
            if (
              props &&
              (props.onClick ||
                props.onMouseDown ||
                props.onMouseUp ||
                props.onPointerDown ||
                props.onTouchStart)
            ) {
              return true;
            }
          }
        }
      }

      // React 15 uses __reactInternalInstance$
      if (key.startsWith('__reactInternalInstance$')) {
        const instance = element[key];
        if (instance && instance._currentElement && instance._currentElement.props) {
          const props = instance._currentElement.props;
          if (props && (props.onClick || props.onMouseDown || props.onPointerDown)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if an element has Preact event handlers.
   */
  function hasPreactClickHandler(element) {
    const keys = Object.keys(element);

    for (const key of keys) {
      if (key.startsWith('__preactProps_')) {
        const props = element[key];
        if (
          props &&
          (props.onClick || props.onMouseDown || props.onPointerDown || props.onTouchStart)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if an element has Vue event handlers.
   */
  function hasVueClickHandler(element) {
    // Vue 3 uses __vnode
    if (element.__vnode) {
      const props = element.__vnode.props;
      if (
        props &&
        (props.onClick || props.onMousedown || props.onPointerdown || props.onTouchstart)
      ) {
        return true;
      }
    }

    // Vue 2 uses __vue__ with $listeners
    if (element.__vue__) {
      const listeners = element.__vue__.$listeners;
      if (
        listeners &&
        (listeners.click || listeners.mousedown || listeners.pointerdown || listeners.touchstart)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an element has Angular event handlers.
   * Angular uses __ngContext__ and ng-reflect-* attributes
   */
  function hasAngularClickHandler(element) {
    // Angular 2+ uses __ngContext__
    if (element.__ngContext__) {
      // Check for click event binding via attributes
      const attrs = element.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const name = attrs[i].name.toLowerCase();
        if (
          name === '(click)' ||
          name === '(mousedown)' ||
          name === '(pointerdown)' ||
          (name.startsWith('ng-reflect-') && name.includes('click'))
        ) {
          return true;
        }
      }
      // Angular compiles (click) to event listeners, so check for bound events
      // The presence of __ngContext__ with specific listener patterns
      return false;
    }

    // AngularJS (1.x) uses ng-click attribute
    if (element.hasAttribute('ng-click') || element.hasAttribute('data-ng-click')) {
      return true;
    }

    return false;
  }

  /**
   * Check if an element has Svelte event handlers.
   * Svelte compiles away but leaves markers for event delegation
   */
  function hasSvelteClickHandler(element) {
    const keys = Object.keys(element);

    for (const key of keys) {
      // Svelte 3/4 uses __svelte_meta or similar internal properties
      if (key.startsWith('__svelte')) {
        return true; // Svelte elements with internal state likely have handlers
      }
      // Svelte 5 uses $$ prefix for internal state
      if (key === '$$' || key.startsWith('$$')) {
        const internal = element[key];
        if (internal && (internal.events || internal.callbacks)) {
          return true;
        }
      }
    }

    // Svelte also uses on:click directive which compiles to addEventListener
    // Those are caught by our addEventListener patch
    return false;
  }

  /**
   * Check if an element has SolidJS event handlers.
   * Solid uses event delegation and $$click properties
   */
  function hasSolidClickHandler(element) {
    // SolidJS stores handlers as $$eventname properties
    if (element.$$click || element.$$mousedown || element.$$pointerdown || element.$$touchstart) {
      return true;
    }

    // Check for Solid's internal markers
    const keys = Object.keys(element);
    for (const key of keys) {
      if (key.startsWith('__solid')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an element has Lit/Web Component event handlers.
   */
  function hasLitClickHandler(element) {
    // Lit elements extend HTMLElement and use @event decorators
    // Check for Lit's internal properties
    if (element._$litPart$ || element.__litElement) {
      return true;
    }

    // Check for @click binding in Lit templates (compiled to event listeners)
    // These are caught by addEventListener patch
    return false;
  }

  /**
   * Check if an element has Alpine.js event handlers.
   */
  function hasAlpineClickHandler(element) {
    // Alpine.js uses x-on:click or @click attributes
    if (
      element.hasAttribute('x-on:click') ||
      element.hasAttribute('@click') ||
      element.hasAttribute('x-on:mousedown') ||
      element.hasAttribute('@mousedown')
    ) {
      return true;
    }

    // Alpine 3 uses __x for internal state
    if (element.__x) {
      return true;
    }

    return false;
  }

  /**
   * Check if an element has HTMX click handlers.
   */
  function hasHtmxClickHandler(element) {
    // HTMX uses hx-* attributes for interactions
    if (
      element.hasAttribute('hx-get') ||
      element.hasAttribute('hx-post') ||
      element.hasAttribute('hx-put') ||
      element.hasAttribute('hx-delete') ||
      element.hasAttribute('hx-patch')
    ) {
      // Check if it's triggered on click (default for buttons/links)
      const trigger = element.getAttribute('hx-trigger');
      if (!trigger || trigger.includes('click')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if element has framework event handlers.
   */
  function hasFrameworkClickHandler(element) {
    return (
      hasReactClickHandler(element) ||
      hasPreactClickHandler(element) ||
      hasVueClickHandler(element) ||
      hasAngularClickHandler(element) ||
      hasSvelteClickHandler(element) ||
      hasSolidClickHandler(element) ||
      hasLitClickHandler(element) ||
      hasAlpineClickHandler(element) ||
      hasHtmxClickHandler(element)
    );
  }

  /**
   * Scan an element and its descendants for framework handlers.
   */
  function scanElement(element) {
    if (!element || !(element instanceof HTMLElement)) return;
    if (markedElements.has(element)) return;

    if (hasFrameworkClickHandler(element)) {
      markElement(element, 'framework');
    }
  }

  /**
   * Scan the entire DOM for framework handlers.
   */
  function scanDocument() {
    // Scan common interactive element types
    const candidates = document.querySelectorAll(
      'div, span, a, button, li, td, label, img, svg, p, h1, h2, h3, h4, h5, h6, [role]'
    );

    for (const element of candidates) {
      scanElement(element);
    }
  }

  // ==========================================================================
  // Strategy 4: MutationObserver for dynamic content
  // ==========================================================================

  let scanTimeout = null;
  let observer = null;

  function debouncedScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(scanDocument, 50);
  }

  function startObserver() {
    if (observer) return;
    if (!document.body) return;

    observer = new MutationObserver(function (mutations) {
      // Check if any mutations added nodes
      let hasAdditions = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasAdditions = true;
          break;
        }
      }

      if (hasAdditions) {
        debouncedScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Run initial scans at various times to catch framework rendering
  function init() {
    // Immediate scan
    if (document.body) {
      scanDocument();
      startObserver();
    }

    // Scan again after frameworks have likely rendered
    setTimeout(scanDocument, 0);
    setTimeout(scanDocument, 100);
    setTimeout(scanDocument, 300);
    setTimeout(scanDocument, 500);
    setTimeout(scanDocument, 1000);
    setTimeout(scanDocument, 2000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also handle late document.body availability
  if (!document.body) {
    const bodyObserver = new MutationObserver(function (mutations, obs) {
      if (document.body) {
        obs.disconnect();
        init();
      }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
})();
