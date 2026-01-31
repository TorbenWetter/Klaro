/**
 * Binding Manager - Reactive element tracking without full page rescans
 * 
 * Tracks interactive elements via bindings that sync state automatically.
 * Detects structural changes (new UI contexts) and queues them for LLM processing.
 */

import type { ScannedAction } from './dom-scanner';

// ============================================================================
// TYPES
// ============================================================================

/** State we track for each element type */
export interface ElementState {
  label: string;
  value?: string;
  checked?: boolean;
  disabled: boolean;
  visible: boolean;
  /** Options for select elements */
  options?: { value: string; label: string }[];
}

/** A binding links a UI element to a real DOM element */
export interface ElementBinding {
  id: string;
  tag: string;
  element: WeakRef<HTMLElement>;
  lastState: ElementState;
}

/** Patch emitted when element state changes */
export interface StatePatch {
  id: string;
  changes: Partial<ElementState>;
}

/** Classification of structural changes */
export type ChangeClassification = 
  | { type: 'ignore' }
  | { type: 'minor'; elements: ScannedAction[] }
  | { type: 'new-context'; subtree: Element; elements: ScannedAction[]; description: string };

/** Pending change that needs user approval for LLM processing */
export interface PendingChange {
  id: string;
  timestamp: number;
  classification: ChangeClassification;
  /** Estimated tokens for LLM call */
  estimatedTokens: number;
  /** Human-readable description */
  description: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ACTION_DATA_ATTR = 'data-acc-id';
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);
const POLL_INTERVAL_MS = 250;

// ============================================================================
// BINDING MANAGER
// ============================================================================

export class BindingManager {
  private bindings = new Map<string, ElementBinding>();
  private pollIntervalId: number | null = null;
  private structuralObserver: MutationObserver | null = null;
  
  // Callbacks
  private onStatePatch: ((patch: StatePatch) => void) | null = null;
  private onElementRemoved: ((id: string) => void) | null = null;
  private onPendingChange: ((change: PendingChange) => void) | null = null;
  private onMinorAddition: ((elements: ScannedAction[]) => void) | null = null;
  private onInitialState: ((states: Map<string, ElementState>) => void) | null = null;
  
  // Debouncing for structural changes
  private pendingMutations: Element[] = [];
  private mutationDebounceTimer: number | null = null;
  
  // Visibility observer for elements that show/hide via CSS
  private visibilityObserver: MutationObserver | null = null;
  private knownVisibleElements = new Set<string>();
  
  constructor() {}
  
  /**
   * Initialize the binding manager with callbacks
   */
  init(callbacks: {
    onStatePatch?: (patch: StatePatch) => void;
    onElementRemoved?: (id: string) => void;
    onPendingChange?: (change: PendingChange) => void;
    onMinorAddition?: (elements: ScannedAction[]) => void;
    onInitialState?: (states: Map<string, ElementState>) => void;
  }) {
    this.onStatePatch = callbacks.onStatePatch ?? null;
    this.onElementRemoved = callbacks.onElementRemoved ?? null;
    this.onPendingChange = callbacks.onPendingChange ?? null;
    this.onMinorAddition = callbacks.onMinorAddition ?? null;
    this.onInitialState = callbacks.onInitialState ?? null;
  }
  
  /**
   * Start tracking - begins polling and structural observation
   */
  start() {
    this.startPolling();
    this.startStructuralObserver();
    this.startVisibilityObserver();
  }
  
  /**
   * Stop tracking
   */
  stop() {
    this.stopPolling();
    this.stopStructuralObserver();
    this.stopVisibilityObserver();
  }
  
  /**
   * Create bindings for all currently tracked elements (call after initial scan)
   * Emits initial state for all elements so UI can sync current values
   */
  createBindingsFromScan(actions: ScannedAction[]) {
    const initialStates = new Map<string, ElementState>();
    
    for (const action of actions) {
      const el = document.querySelector<HTMLElement>(`[${ACTION_DATA_ATTR}="${action.id}"]`);
      if (el) {
        const binding = this.createBinding(el, action.id, action.tag);
        initialStates.set(action.id, binding.lastState);
        
        // Track visibility for overlay detection
        if (binding.lastState.visible) {
          this.knownVisibleElements.add(action.id);
        }
      }
    }
    
    // Emit initial state for all elements
    if (initialStates.size > 0 && this.onInitialState) {
      this.onInitialState(initialStates);
    }
  }
  
  /**
   * Create a binding for an element
   */
  private createBinding(el: HTMLElement, id: string, tag: string): ElementBinding {
    const binding: ElementBinding = {
      id,
      tag,
      element: new WeakRef(el),
      lastState: this.readElementState(el),
    };
    this.bindings.set(id, binding);
    return binding;
  }
  
  /**
   * Read the current state of an element
   */
  private readElementState(el: HTMLElement): ElementState {
    const tag = el.tagName.toLowerCase();
    const state: ElementState = {
      label: this.getElementLabel(el),
      disabled: (el as HTMLInputElement).disabled ?? el.getAttribute('aria-disabled') === 'true',
      visible: el.offsetParent !== null,
    };
    
    if (tag === 'input') {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') {
        state.checked = input.checked;
      } else {
        state.value = input.value;
      }
    } else if (tag === 'textarea') {
      state.value = (el as HTMLTextAreaElement).value;
    } else if (tag === 'select') {
      const select = el as HTMLSelectElement;
      state.value = select.value;
      state.options = Array.from(select.options).map(opt => ({
        value: opt.value,
        label: opt.text,
      }));
    }
    
    return state;
  }
  
  /**
   * Get the label for an element
   */
  private getElementLabel(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const input = el as HTMLInputElement;
      return (
        input.placeholder ||
        el.getAttribute('aria-label') ||
        this.getLabelForInput(input) ||
        input.name ||
        input.id ||
        ''
      ).trim();
    }
    return (el.getAttribute('aria-label') || el.innerText || '').trim();
  }
  
  private getLabelForInput(input: HTMLInputElement): string {
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent?.trim() || '';
    }
    const parentLabel = input.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, select, textarea').forEach(el => el.remove());
      return clone.textContent?.trim() || '';
    }
    return '';
  }
  
  // ============================================================================
  // STATE POLLING (handles value/checked/disabled changes)
  // ============================================================================
  
  private startPolling() {
    if (this.pollIntervalId) return;
    
    this.pollIntervalId = window.setInterval(() => {
      this.tick();
    }, POLL_INTERVAL_MS);
  }
  
  private stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }
  
  /**
   * One tick of state polling - check all bindings for changes
   */
  private tick() {
    for (const [id, binding] of this.bindings) {
      const el = binding.element.deref();
      
      // Element was garbage collected or removed from DOM
      if (!el || !el.isConnected) {
        this.bindings.delete(id);
        this.onElementRemoved?.(id);
        continue;
      }
      
      const current = this.readElementState(el);
      const patch = this.computeDiff(binding.lastState, current);
      
      if (patch) {
        binding.lastState = current;
        this.onStatePatch?.({ id, changes: patch });
      }
    }
  }
  
  /**
   * Compute the difference between two states
   */
  private computeDiff(prev: ElementState, curr: ElementState): Partial<ElementState> | null {
    const changes: Partial<ElementState> = {};
    let hasChanges = false;
    
    if (prev.label !== curr.label) {
      changes.label = curr.label;
      hasChanges = true;
    }
    if (prev.value !== curr.value) {
      changes.value = curr.value;
      hasChanges = true;
    }
    if (prev.checked !== curr.checked) {
      changes.checked = curr.checked;
      hasChanges = true;
    }
    if (prev.disabled !== curr.disabled) {
      changes.disabled = curr.disabled;
      hasChanges = true;
    }
    if (prev.visible !== curr.visible) {
      changes.visible = curr.visible;
      hasChanges = true;
    }
    // For options, do a simple JSON comparison
    if (JSON.stringify(prev.options) !== JSON.stringify(curr.options)) {
      changes.options = curr.options;
      hasChanges = true;
    }
    
    return hasChanges ? changes : null;
  }
  
  // ============================================================================
  // STRUCTURAL OBSERVATION (handles new elements appearing)
  // ============================================================================
  
  private startStructuralObserver() {
    if (this.structuralObserver) return;
    
    this.structuralObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            this.pendingMutations.push(node);
          }
        }
      }
      
      // Debounce processing
      if (this.mutationDebounceTimer) {
        clearTimeout(this.mutationDebounceTimer);
      }
      this.mutationDebounceTimer = window.setTimeout(() => {
        this.processPendingMutations();
      }, 500);
    });
    
    if (document.body) {
      this.structuralObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }
  
  private stopStructuralObserver() {
    if (this.structuralObserver) {
      this.structuralObserver.disconnect();
      this.structuralObserver = null;
    }
    if (this.mutationDebounceTimer) {
      clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = null;
    }
  }
  
  // ============================================================================
  // VISIBILITY OBSERVATION (handles elements that show/hide via CSS)
  // ============================================================================
  
  private startVisibilityObserver() {
    if (this.visibilityObserver) return;
    
    // Watch for class/style attribute changes that might affect visibility
    this.visibilityObserver = new MutationObserver((mutations) => {
      const elementsToCheck = new Set<Element>();
      
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const el = mutation.target as Element;
          // Check if this element or its parents might be a modal/overlay
          if (el.matches('[role="dialog"], [role="alertdialog"], dialog, .modal, .modal-overlay, [aria-modal="true"]') ||
              el.closest('[role="dialog"], [role="alertdialog"], dialog, .modal, .modal-overlay, [aria-modal="true"]')) {
            elementsToCheck.add(el.closest('[role="dialog"], [role="alertdialog"], dialog, .modal, .modal-overlay, [aria-modal="true"]') || el);
          }
        }
      }
      
      // Check if any of these elements became visible
      for (const el of elementsToCheck) {
        this.checkElementVisibility(el);
      }
    });
    
    if (document.body) {
      this.visibilityObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
        subtree: true,
      });
    }
  }
  
  private stopVisibilityObserver() {
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
  }
  
  /**
   * Check if an element became visible and should be treated as new context
   */
  private checkElementVisibility(el: Element) {
    const htmlEl = el as HTMLElement;
    const isVisible = htmlEl.offsetParent !== null || 
      window.getComputedStyle(htmlEl).display !== 'none';
    
    // Create a unique key for this element
    const key = this.getElementKey(el);
    const wasVisible = this.knownVisibleElements.has(key);
    
    if (isVisible && !wasVisible) {
      // Element became visible - treat as new content
      this.knownVisibleElements.add(key);
      this.handleNewContent(el);
    } else if (!isVisible && wasVisible) {
      // Element became hidden
      this.knownVisibleElements.delete(key);
    }
  }
  
  private getElementKey(el: Element): string {
    // Use data-acc-id if available, otherwise generate from attributes
    const accId = el.getAttribute(ACTION_DATA_ATTR);
    if (accId) return accId;
    
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    const id = el.id;
    return `visibility-${role || 'element'}-${id || ariaLabel || Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * Process accumulated mutations
   */
  private processPendingMutations() {
    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    
    // Deduplicate - only process the root of each subtree
    const roots = this.deduplicateRoots(mutations);
    
    for (const root of roots) {
      this.handleNewContent(root);
    }
  }
  
  /**
   * Remove elements that are children of other elements in the list
   */
  private deduplicateRoots(elements: Element[]): Element[] {
    const roots: Element[] = [];
    for (const el of elements) {
      // Check if any existing root contains this element
      const isContained = roots.some(root => root.contains(el));
      if (isContained) continue;
      
      // Remove any roots that this element contains
      for (let i = roots.length - 1; i >= 0; i--) {
        if (el.contains(roots[i])) {
          roots.splice(i, 1);
        }
      }
      
      roots.push(el);
    }
    return roots;
  }
  
  /**
   * Handle newly added content
   */
  private handleNewContent(root: Element) {
    // Find interactive elements in the new content
    const interactive = this.findInteractiveElements(root);
    
    // Filter out elements we're already tracking
    const newElements = interactive.filter(el => {
      const id = el.getAttribute(ACTION_DATA_ATTR);
      return !id || !this.bindings.has(id);
    });
    
    if (newElements.length === 0) return;
    
    // Classify the change
    const classification = this.classifyAddition(root, newElements);
    
    if (classification.type === 'ignore') {
      return;
    }
    
    if (classification.type === 'minor') {
      // Create bindings and notify
      const scannedActions = this.scanElements(newElements);
      for (let i = 0; i < newElements.length; i++) {
        const el = newElements[i];
        const action = scannedActions[i];
        this.createBinding(el, action.id, action.tag);
      }
      this.onMinorAddition?.(scannedActions);
      return;
    }
    
    // New context - queue for user approval
    const scannedActions = this.scanElements(newElements);
    const pendingChange: PendingChange = {
      id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      classification: {
        type: 'new-context',
        subtree: root,
        elements: scannedActions,
        description: classification.description,
      },
      estimatedTokens: this.estimateTokens(root, scannedActions),
      description: classification.description,
    };
    
    this.onPendingChange?.(pendingChange);
  }
  
  /**
   * Find all interactive elements within a subtree
   */
  private findInteractiveElements(root: Element): HTMLElement[] {
    const elements: HTMLElement[] = [];
    
    // Check if root itself is interactive
    if (this.isInteractive(root as HTMLElement)) {
      elements.push(root as HTMLElement);
    }
    
    // Find descendants
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as HTMLElement;
          const tag = el.tagName?.toLowerCase();
          if (!tag) return NodeFilter.FILTER_SKIP;
          
          // Check if interactive
          if (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.('role') === 'button') {
            if (el.offsetParent !== null) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        },
      },
    );
    
    while (walker.nextNode()) {
      elements.push(walker.currentNode as HTMLElement);
    }
    
    return elements;
  }
  
  private isInteractive(el: HTMLElement): boolean {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return false;
    return (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.('role') === 'button') 
      && el.offsetParent !== null;
  }
  
  /**
   * Classify an addition as ignore, minor, or new-context
   */
  private classifyAddition(root: Element, elements: HTMLElement[]): ChangeClassification {
    const count = elements.length;
    
    // No interactive elements = ignore
    if (count === 0) {
      return { type: 'ignore' };
    }
    
    // Check for overlay/modal signals
    const isOverlay = this.isOverlayElement(root);
    const isDialog = root.matches('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]');
    const hasMultiple = count > 2;
    const isContainer = root.matches('form, section, [role="region"], aside, nav, header, footer, main');
    
    // Signals that suggest a new UI context
    if (isDialog || isOverlay) {
      return {
        type: 'new-context',
        subtree: root,
        elements: [],
        description: isDialog ? 'Dialog/modal opened' : 'Overlay appeared',
      };
    }
    
    if (hasMultiple && isContainer) {
      return {
        type: 'new-context',
        subtree: root,
        elements: [],
        description: `New section with ${count} interactive elements`,
      };
    }
    
    // Large number of elements suggests significant UI change
    if (count >= 5) {
      return {
        type: 'new-context',
        subtree: root,
        elements: [],
        description: `${count} new interactive elements appeared`,
      };
    }
    
    // Otherwise, minor addition
    return {
      type: 'minor',
      elements: [],
    };
  }
  
  /**
   * Check if an element appears to be an overlay
   */
  private isOverlayElement(el: Element): boolean {
    const style = window.getComputedStyle(el as HTMLElement);
    const position = style.position;
    const zIndex = parseInt(style.zIndex, 10);
    
    // Fixed/absolute positioning with high z-index suggests overlay
    if ((position === 'fixed' || position === 'absolute') && zIndex > 100) {
      return true;
    }
    
    // Check for backdrop-style elements
    if (el.matches('[class*="modal"], [class*="overlay"], [class*="dialog"], [class*="popup"]')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Scan elements and assign IDs
   */
  private scanElements(elements: HTMLElement[]): ScannedAction[] {
    return elements.map(el => {
      let id = el.getAttribute(ACTION_DATA_ATTR);
      if (!id) {
        id = `cmd-${Math.random().toString(36).slice(2, 11)}`;
        el.setAttribute(ACTION_DATA_ATTR, id);
      }
      return {
        id,
        tag: el.tagName.toLowerCase(),
        text: this.getElementLabel(el).slice(0, 50),
      };
    });
  }
  
  /**
   * Estimate tokens for LLM call
   */
  private estimateTokens(root: Element, elements: ScannedAction[]): number {
    // Rough estimation: ~4 chars per token
    const textLength = (root.textContent?.length ?? 0);
    const elementsJson = JSON.stringify(elements).length;
    const basePrompt = 500; // Base prompt tokens
    
    return Math.ceil((textLength + elementsJson) / 4) + basePrompt;
  }
  
  /**
   * Get a binding by ID
   */
  getBinding(id: string): ElementBinding | undefined {
    return this.bindings.get(id);
  }
  
  /**
   * Get all bindings
   */
  getAllBindings(): Map<string, ElementBinding> {
    return new Map(this.bindings);
  }
  
  /**
   * Clear all bindings (for full rescan)
   */
  clearBindings() {
    this.bindings.clear();
  }
}

// Singleton instance
export const bindingManager = new BindingManager();
