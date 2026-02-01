/**
 * Tree Tracker
 *
 * Unified DOM tree tracking with fingerprint-based identification,
 * grace periods, and robust re-render detection.
 *
 * Replaces the dual ElementTracker + tree sync system with a single
 * source of truth for all DOM tracking.
 */

import type {
  TreeNode,
  TrackedNode,
  DOMTree,
  TreeTrackerConfig,
  TreeTrackerEvent,
  TreeTrackerEventType,
  ActionResult,
} from './types';
import { CONFIG } from '../../config';
import type { ElementFingerprint } from '../element-tracker/types';
import {
  createFingerprint,
  updateFingerprint,
  getVisibleText,
  normalizeText,
  normalizeHref,
} from '../element-tracker/fingerprint';
import { findBestMatch, matchAll } from '../element-tracker/matcher';
import {
  buildDOMTree,
  isHidden,
  isInViewport,
  extractLabel,
  getNodeType,
  getInteractiveType,
  extractFormState,
  flattenTree,
  findNodeById,
  findParentOf,
  SKIP_TAGS,
} from './tree-builder';

// =============================================================================
// TreeTracker Class
// =============================================================================

/**
 * Build default config from centralized CONFIG
 */
function buildDefaultConfig(): TreeTrackerConfig {
  return {
    confidenceThreshold: CONFIG.tracking.confidenceThreshold,
    gracePeriodMs: CONFIG.tracking.gracePeriodMs,
    maxNodes: CONFIG.tracking.maxNodes,
    maxDepth: CONFIG.tracking.maxDepth,
    weights: CONFIG.tracking.weights,
    debugMode: false,
  };
}

/**
 * Main tree tracker class.
 * Tracks all visible DOM elements across mutations using fingerprinting.
 */
export class TreeTracker extends EventTarget {
  private config: TreeTrackerConfig;
  private tree: DOMTree | null;
  private nodeMap: Map<string, TrackedNode>;
  private elementToId: WeakMap<HTMLElement, string>; // O(1) reverse lookup
  private observer: MutationObserver | null;
  private container: HTMLElement | Document;

  // Batching state (double-RAF)
  private pendingMutations: MutationRecord[];
  private rafId: number | null;
  private timeoutId: number | null;
  private isProcessing: boolean;

  // Grace period tracking
  private pendingRemovals: Map<string, number>; // nodeId -> timestamp
  private gracePeriodTimeouts: Map<string, number>; // nodeId -> timeout handle

  constructor(config: Partial<TreeTrackerConfig> = {}) {
    super();
    this.config = { ...buildDefaultConfig(), ...config };
    this.tree = null;
    this.nodeMap = new Map();
    this.elementToId = new WeakMap();
    this.observer = null;
    this.container = document;

    this.pendingMutations = [];
    this.rafId = null;
    this.timeoutId = null;
    this.isProcessing = false;

    this.pendingRemovals = new Map();
    this.gracePeriodTimeouts = new Map();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start tracking elements in the container.
   * Performs initial scan and sets up MutationObserver.
   */
  async start(container: HTMLElement | Document = document): Promise<DOMTree> {
    this.container = container;

    // Always log startup for debugging
    console.log('[TreeTracker] Starting with debugMode:', this.config.debugMode);

    // Build initial tree
    this.tree = this.buildInitialTree();

    // Populate nodeMap with all nodes
    this.populateNodeMap(this.tree.root, null);

    // Mark ALL visible elements in DOM to prevent re-adding them later
    this.markAllVisibleElements(container instanceof Document ? container.body : container);

    // Set up mutation observer
    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.observer.observe(container instanceof Document ? container.body : container, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: [
        'data-testid',
        'aria-label',
        'role',
        'name',
        'placeholder',
        'value',
        'disabled',
        'checked',
        'id',
        'href',
        'class',
        'style',
        'hidden',
        'aria-hidden',
      ],
    });

    // Emit tree-initialized event
    this.emitEvent({
      type: 'tree-initialized',
      tree: this.tree,
    });

    return this.tree;
  }

  /**
   * Stop tracking and clean up.
   */
  stop(): void {
    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Cancel pending batches
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Cancel grace period timeouts
    for (const handle of this.gracePeriodTimeouts.values()) {
      clearTimeout(handle);
    }
    this.gracePeriodTimeouts.clear();
    this.pendingRemovals.clear();

    // Clear state
    this.tree = null;
    this.nodeMap.clear();
    this.elementToId = new WeakMap();
  }

  // ===========================================================================
  // Tree Access
  // ===========================================================================

  /**
   * Get the current tree.
   */
  getTree(): DOMTree | null {
    return this.tree;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): TreeNode | null {
    return this.nodeMap.get(id)?.node ?? null;
  }

  /**
   * Get DOM element by node ID.
   * Attempts re-identification if element is stale.
   */
  getElement(id: string): HTMLElement | null {
    const tracked = this.nodeMap.get(id);
    if (!tracked) return null;

    const element = tracked.ref.deref();

    // WeakRef returned undefined = element was garbage collected
    if (!element) {
      return this.attemptReidentification(tracked);
    }

    // Element removed from DOM but not yet GC'd
    if (!element.isConnected) {
      return this.attemptReidentification(tracked);
    }

    return element;
  }

  /**
   * Get all nodes as flat array.
   */
  getAllNodes(): TreeNode[] {
    if (!this.tree) return [];
    return flattenTree(this.tree.root);
  }

  /**
   * Get node ID for a DOM element.
   * Returns null if element is not tracked.
   * Uses WeakMap for O(1) lookup.
   */
  getElementId(element: HTMLElement): string | null {
    return this.elementToId.get(element) ?? null;
  }

  // ===========================================================================
  // Element Actions
  // ===========================================================================

  /**
   * Click an element by node ID.
   */
  async clickElement(id: string): Promise<ActionResult> {
    const element = this.getElement(id);

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    try {
      // Scroll into view first
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Wait for scroll
      await new Promise((r) => setTimeout(r, 100));

      // Click
      element.click();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Click failed',
      };
    }
  }

  /**
   * Set input value by node ID.
   */
  async setInputValue(id: string, value: string): Promise<ActionResult> {
    const element = this.getElement(id);

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return { success: false, error: 'Element is not an input' };
    }

    try {
      // Focus first
      element.focus();

      // Set value
      element.value = value;

      // Dispatch events for React/Vue/Angular compatibility
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      // Update tracked state
      this.updateNodeFormState(id, { value });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Set value failed',
      };
    }
  }

  /**
   * Toggle checkbox by node ID.
   */
  async toggleCheckbox(id: string, checked?: boolean): Promise<ActionResult> {
    const element = this.getElement(id);

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    if (!(element instanceof HTMLInputElement)) {
      return { success: false, error: 'Element is not a checkbox' };
    }

    try {
      // Set checked state
      const newChecked = checked !== undefined ? checked : !element.checked;
      element.checked = newChecked;

      // Dispatch events
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('click', { bubbles: true }));

      // Update tracked state
      this.updateNodeFormState(id, { checked: newChecked });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Toggle failed',
      };
    }
  }

  /**
   * Set select value by node ID.
   */
  async setSelectValue(id: string, value: string): Promise<ActionResult> {
    const element = this.getElement(id);

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    if (!(element instanceof HTMLSelectElement)) {
      return { success: false, error: 'Element is not a select' };
    }

    try {
      // Set value
      element.value = value;

      // Dispatch events
      element.dispatchEvent(new Event('change', { bubbles: true }));

      // Update tracked state
      this.updateNodeFormState(id, {
        value,
        options: Array.from(element.options).map((opt) => ({
          value: opt.value,
          label: opt.text,
          selected: opt.selected,
        })),
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Set select failed',
      };
    }
  }

  /**
   * Scroll to element by node ID.
   */
  async scrollToElement(id: string): Promise<ActionResult> {
    const element = this.getElement(id);

    if (!element) {
      return { success: false, error: 'Element not found' };
    }

    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Add temporary highlight
      const originalOutline = element.style.outline;
      element.style.outline = '3px solid #3b82f6';
      setTimeout(() => {
        element.style.outline = originalOutline;
      }, 2000);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scroll failed',
      };
    }
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Add event listener with proper typing.
   */
  on<T extends TreeTrackerEventType>(
    type: T,
    handler: (event: CustomEvent<Extract<TreeTrackerEvent, { type: T }>>) => void
  ): void {
    this.addEventListener(type, handler as EventListener);
  }

  /**
   * Remove event listener.
   */
  off<T extends TreeTrackerEventType>(
    type: T,
    handler: (event: CustomEvent<Extract<TreeTrackerEvent, { type: T }>>) => void
  ): void {
    this.removeEventListener(type, handler as EventListener);
  }

  /**
   * Emit a tracker event.
   */
  private emitEvent(event: TreeTrackerEvent): void {
    this.dispatchEvent(new CustomEvent(event.type, { detail: event }));
  }

  // ===========================================================================
  // MutationObserver Handling
  // ===========================================================================

  /**
   * Handle incoming mutations (batched via double-RAF).
   */
  private handleMutations(mutations: MutationRecord[]): void {
    this.pendingMutations.push(...mutations);

    // Cancel any pending processing
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.timeoutId) clearTimeout(this.timeoutId);

    // Double-RAF: wait for framework batch + browser render
    this.rafId = requestAnimationFrame(() => {
      this.rafId = requestAnimationFrame(() => {
        // Clear timeout when RAF fires to prevent double processing
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = null;
        }
        this.processMutationBatch();
      });
    });

    // Fallback timeout (100ms) - only fires if RAF is blocked
    this.timeoutId = window.setTimeout(() => {
      // Clear RAF if timeout fires first
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.processMutationBatch();
    }, 100);
  }

  /**
   * Process accumulated mutations.
   */
  private async processMutationBatch(): Promise<void> {
    if (this.isProcessing || this.pendingMutations.length === 0) return;
    if (!this.tree) return;

    this.isProcessing = true;

    // Clear timers
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Take current batch
    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    try {
      // 1. Collect removed and added elements
      const removedElements = new Set<HTMLElement>();
      const addedElements = new Set<HTMLElement>();
      const updatedElements = new Set<HTMLElement>();

      for (const mutation of mutations) {
        // Character data changes (text content)
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          const parent = mutation.target.parentElement;
          if (parent instanceof HTMLElement && !isHidden(parent)) {
            updatedElements.add(parent);
          }
        }

        // Attribute changes
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          if (!isHidden(mutation.target)) {
            updatedElements.add(mutation.target);
          }
        }

        // Child list changes
        if (mutation.type === 'childList') {
          let hasTextNodeChanges = false;

          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              removedElements.add(node);
              // Also track descendants
              for (const descendant of node.querySelectorAll('*')) {
                if (descendant instanceof HTMLElement) {
                  removedElements.add(descendant);
                }
              }
            } else if (node.nodeType === Node.TEXT_NODE) {
              // Text node removed - parent's content changed
              hasTextNodeChanges = true;
            }
          }

          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && !isHidden(node)) {
              addedElements.add(node);
              // Also track descendants
              for (const descendant of node.querySelectorAll('*')) {
                if (descendant instanceof HTMLElement && !isHidden(descendant)) {
                  addedElements.add(descendant);
                }
              }
            } else if (node.nodeType === Node.TEXT_NODE) {
              // Text node added - parent's content changed
              hasTextNodeChanges = true;
            }
          }

          // If text nodes changed, mark the parent element as updated
          if (hasTextNodeChanges && mutation.target instanceof HTMLElement) {
            if (!isHidden(mutation.target)) {
              updatedElements.add(mutation.target);
            }
          }
        }
      }

      // 2. Find tracked nodes that were removed
      const removedNodeIds = new Set<string>();
      for (const [id, tracked] of this.nodeMap) {
        const element = tracked.ref.deref();

        // Element GC'd or disconnected
        if (!element || !element.isConnected) {
          removedNodeIds.add(id);
          continue;
        }

        // Element was in removed set
        if (removedElements.has(element)) {
          // But if it was also added (moved), skip
          if (!addedElements.has(element)) {
            removedNodeIds.add(id);
          }
        }
      }

      // 3. Match added elements against removed fingerprints (detect re-renders)
      const reRenderedMatches = this.detectReRenderedNodes(removedNodeIds, addedElements);

      // DEBUG: Log matching statistics
      if (this.config.debugMode && (removedNodeIds.size > 0 || addedElements.size > 0)) {
        console.log('[TreeTracker] Mutation batch:', {
          removed: removedNodeIds.size,
          added: addedElements.size,
          matched: reRenderedMatches.size,
          unmatched: {
            removed: removedNodeIds.size - reRenderedMatches.size,
            added: addedElements.size - reRenderedMatches.size,
          },
        });
      }

      // 4. Process re-rendered nodes (update reference, emit node-matched)
      for (const [nodeId, matchedElement] of reRenderedMatches) {
        removedNodeIds.delete(nodeId);
        addedElements.delete(matchedElement);

        const tracked = this.nodeMap.get(nodeId);
        if (tracked) {
          // Update reference and reverse lookup
          tracked.ref = new WeakRef(matchedElement);
          tracked.status = 'active';
          tracked.lostAt = null;
          this.elementToId.set(matchedElement, nodeId);

          // CRITICAL: Mark new DOM element as tracked (survives future mutations)
          this.markElementTracked(matchedElement);

          // Cancel any pending grace period
          this.cancelGracePeriod(nodeId);

          // Update fingerprint and node properties
          const newFingerprint = updateFingerprint(
            tracked.node.fingerprint,
            matchedElement,
            1.0 // High confidence since we matched
          );
          tracked.node.fingerprint = newFingerprint;

          // Update label
          const newLabel = extractLabel(matchedElement);
          const changes: Partial<TreeNode> = {};

          if (newLabel !== tracked.node.label) {
            tracked.node.label = newLabel;
            tracked.node.originalLabel = newLabel;
            changes.label = newLabel;
          }

          // Update form state
          const formState = extractFormState(matchedElement);
          Object.assign(tracked.node, formState);
          Object.assign(changes, formState);

          // Update visibility
          const isVisible = isInViewport(matchedElement);
          if (isVisible !== tracked.node.isVisible) {
            tracked.node.isVisible = isVisible;
            changes.isVisible = isVisible;
          }

          if (Object.keys(changes).length > 0) {
            this.emitEvent({
              type: 'node-matched',
              nodeId,
              confidence: 1.0,
              changes,
            });
          }
        }
      }

      // 5. Start grace period for truly removed nodes (don't emit yet)
      for (const nodeId of removedNodeIds) {
        this.startGracePeriod(nodeId);
      }

      // 6. Process truly new nodes (add to tree, emit node-added)
      let newNodeCount = 0;
      let skippedTrackedCount = 0;
      for (const element of addedElements) {
        // Skip if shouldn't be in tree
        const tag = element.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        if (isHidden(element)) continue;

        // Skip if already tracked (use both WeakMap and attribute check)
        if (this.elementToId.has(element) || this.isElementTracked(element)) {
          skippedTrackedCount++;
          continue;
        }

        // Find parent in our tree
        const parentId = this.findParentNodeId(element);
        if (parentId) {
          this.addNodeToTree(element, parentId);
          newNodeCount++;
        }
      }

      // Modal detection: check if any added elements are modals
      this.detectModalChanges(addedElements, removedElements);

      // 7. Process updated nodes (emit node-updated)
      for (const element of updatedElements) {
        const nodeId = this.findNodeIdByElement(element);
        if (nodeId) {
          const tracked = this.nodeMap.get(nodeId);
          if (tracked && tracked.status === 'active') {
            const changes: Partial<TreeNode> = {};

            // Check label change
            const newLabel = extractLabel(element);
            if (newLabel !== tracked.node.label) {
              tracked.node.label = newLabel;
              tracked.node.originalLabel = newLabel;
              changes.label = newLabel;
            }

            // Check form state changes
            const formState = extractFormState(element);
            if (formState.value !== tracked.node.value) {
              tracked.node.value = formState.value;
              changes.value = formState.value;
            }
            if (formState.checked !== tracked.node.checked) {
              tracked.node.checked = formState.checked;
              changes.checked = formState.checked;
            }
            if (formState.disabled !== tracked.node.disabled) {
              tracked.node.disabled = formState.disabled;
              changes.disabled = formState.disabled;
            }

            // Check visibility change
            const isVisible = isInViewport(element);
            if (isVisible !== tracked.node.isVisible) {
              tracked.node.isVisible = isVisible;
              changes.isVisible = isVisible;
            }

            // Update fingerprint
            if (Object.keys(changes).length > 0) {
              tracked.node.fingerprint = updateFingerprint(tracked.node.fingerprint, element, 1.0);

              this.emitEvent({
                type: 'node-updated',
                nodeId,
                changes,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[TreeTracker] Error processing mutations:', error);
      this.emitEvent({
        type: 'tree-error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isProcessing = false;
    }
  }

  // ===========================================================================
  // Re-render Detection
  // ===========================================================================

  /**
   * Detect re-rendered nodes by matching removed fingerprints to added elements.
   * Uses two strategies:
   * 1. Full fingerprint matching (for high-confidence matches)
   * 2. Structure-only matching (fallback for dynamic content)
   */
  private detectReRenderedNodes(
    removedNodeIds: Set<string>,
    addedElements: Set<HTMLElement>
  ): Map<string, HTMLElement> {
    const matches = new Map<string, HTMLElement>();

    if (removedNodeIds.size === 0 || addedElements.size === 0) {
      return matches;
    }

    // Collect info from removed nodes
    const removedNodes: Array<{ nodeId: string; tracked: TrackedNode }> = [];
    const removedFingerprints: ElementFingerprint[] = [];
    const fingerprintToId = new Map<string, string>();

    for (const nodeId of removedNodeIds) {
      const tracked = this.nodeMap.get(nodeId);
      if (tracked) {
        removedNodes.push({ nodeId, tracked });
        removedFingerprints.push(tracked.node.fingerprint);
        fingerprintToId.set(tracked.node.fingerprint.id, nodeId);
      }
    }

    const candidateElements = Array.from(addedElements);
    const usedElements = new Set<HTMLElement>();
    const usedNodeIds = new Set<string>();

    // Strategy 1: Full fingerprint matching (for high-confidence matches)
    const matchResults = matchAll(
      removedFingerprints,
      candidateElements,
      this.config.weights,
      this.config.confidenceThreshold
    );

    const sortedMatches = Array.from(matchResults.entries())
      .filter(([, result]) => result !== null)
      .sort((a, b) => (b[1]?.confidence ?? 0) - (a[1]?.confidence ?? 0));

    for (const [fpId, result] of sortedMatches) {
      if (result && !usedElements.has(result.element)) {
        const nodeId = fingerprintToId.get(fpId);
        if (nodeId && !usedNodeIds.has(nodeId)) {
          matches.set(nodeId, result.element);
          usedElements.add(result.element);
          usedNodeIds.add(nodeId);
        }
      }
    }

    // Strategy 2: Identifier-based matching (href, testId, name, ariaLabel)
    // More reliable than structure for links and form elements
    for (const { nodeId, tracked } of removedNodes) {
      if (usedNodeIds.has(nodeId)) continue;

      const fp = tracked.node.fingerprint;

      for (const candidate of candidateElements) {
        if (usedElements.has(candidate)) continue;
        if (candidate.tagName.toLowerCase() !== fp.tagName) continue;

        // Check stable identifiers
        let matched = false;

        // href for links (most reliable) - normalize before comparing
        if (fp.href) {
          const candidateHref = normalizeHref(candidate.getAttribute('href'));
          if (candidateHref === fp.href) {
            matched = true;
          }
        }
        // data-testid
        else if (fp.testId) {
          const candidateTestId =
            candidate.getAttribute('data-testid') ||
            candidate.getAttribute('data-test') ||
            candidate.getAttribute('data-cy');
          if (candidateTestId === fp.testId) {
            matched = true;
          }
        }
        // name attribute for form elements
        else if (fp.name && candidate.getAttribute('name') === fp.name) {
          matched = true;
        }
        // aria-label
        else if (fp.ariaLabel && candidate.getAttribute('aria-label') === fp.ariaLabel) {
          matched = true;
        }

        if (matched) {
          matches.set(nodeId, candidate);
          usedElements.add(candidate);
          usedNodeIds.add(nodeId);
          break;
        }
      }
    }

    // Strategy 3: Structure-only matching for remaining unmatched nodes
    // Only for elements without stable identifiers
    for (const { nodeId, tracked } of removedNodes) {
      if (usedNodeIds.has(nodeId)) continue;

      const fp = tracked.node.fingerprint;

      // Skip if element has stable identifiers (should have matched above)
      if (fp.href || fp.testId || fp.name || fp.ariaLabel) continue;

      // Find candidate with EXACT same position
      for (const candidate of candidateElements) {
        if (usedElements.has(candidate)) continue;
        if (candidate.tagName.toLowerCase() !== fp.tagName) continue;

        // Must have same sibling index
        const candidateSiblingIndex = this.getSiblingIndex(candidate);
        if (candidateSiblingIndex !== fp.siblingIndex) continue;

        // Must have same child index
        const candidateChildIndex = this.getChildIndex(candidate);
        if (candidateChildIndex !== fp.childIndex) continue;

        // Check ancestor path - tags AND indices must match
        const fpAncestorPath = fp.ancestorPath.slice(0, 2);
        if (fpAncestorPath.length < 1) continue;

        let ancestorMatch = true;
        let current: HTMLElement | null = candidate.parentElement;

        for (let i = 0; i < fpAncestorPath.length && current; i++) {
          const fpAncestor = fpAncestorPath[i];
          const currentTag = current.tagName.toLowerCase();
          const currentIndex = this.getSiblingIndex(current);

          if (currentTag !== fpAncestor.tagName || currentIndex !== fpAncestor.index) {
            ancestorMatch = false;
            break;
          }

          current = current.parentElement;
        }

        if (ancestorMatch) {
          matches.set(nodeId, candidate);
          usedElements.add(candidate);
          usedNodeIds.add(nodeId);
          break;
        }
      }
    }

    return matches;
  }

  /**
   * Get sibling index (position among same-tag siblings).
   */
  private getSiblingIndex(element: HTMLElement): number {
    if (!element.parentElement) return 0;
    const siblings = Array.from(element.parentElement.children).filter(
      (el) => el.tagName === element.tagName
    );
    return siblings.indexOf(element);
  }

  /**
   * Get child index (position among ALL siblings).
   */
  private getChildIndex(element: HTMLElement): number {
    if (!element.parentElement) return 0;
    return Array.from(element.parentElement.children).indexOf(element);
  }

  // ===========================================================================
  // Grace Period Handling
  // ===========================================================================

  /**
   * Start grace period for a potentially lost node.
   */
  private startGracePeriod(nodeId: string): void {
    const tracked = this.nodeMap.get(nodeId);
    if (!tracked || tracked.status === 'searching') return;

    tracked.status = 'searching';
    tracked.lostAt = Date.now();
    this.pendingRemovals.set(nodeId, Date.now());

    // Set timeout to finalize removal after grace period
    const handle = window.setTimeout(() => {
      this.gracePeriodTimeouts.delete(nodeId);

      if (this.pendingRemovals.has(nodeId)) {
        this.pendingRemovals.delete(nodeId);

        // Check one more time if element reappeared
        const element = this.findElementByFingerprint(tracked.node.fingerprint);

        // CRITICAL: Check if found element is already tracked by a DIFFERENT node
        // This prevents the bug where a new element (already added with new ID)
        // is mistaken for the old element "reappearing"
        const existingId = element ? this.elementToId.get(element) : undefined;
        const isAlreadyTrackedByOther = existingId && existingId !== nodeId;

        if (!element || !element.isConnected || isAlreadyTrackedByOther) {
          // Truly gone (or replaced by new element) - emit removal
          tracked.status = 'lost';
          this.removeNodeFromTree(nodeId);
          this.emitEvent({ type: 'node-removed', nodeId });
        } else {
          // Reappeared - restore with updated reverse lookup
          tracked.ref = new WeakRef(element);
          tracked.status = 'active';
          tracked.lostAt = null;
          this.elementToId.set(element, nodeId);
          // CRITICAL: Mark as tracked to prevent re-adding in future mutations
          this.markElementTracked(element);
        }
      }
    }, this.config.gracePeriodMs);

    this.gracePeriodTimeouts.set(nodeId, handle);
  }

  /**
   * Cancel a pending grace period.
   */
  private cancelGracePeriod(nodeId: string): void {
    const handle = this.gracePeriodTimeouts.get(nodeId);
    if (handle) {
      clearTimeout(handle);
      this.gracePeriodTimeouts.delete(nodeId);
    }
    this.pendingRemovals.delete(nodeId);
  }

  // ===========================================================================
  // Re-identification
  // ===========================================================================

  /**
   * Attempt to re-identify a lost element.
   */
  private attemptReidentification(tracked: TrackedNode): HTMLElement | null {
    const body = this.container instanceof Document ? this.container.body : this.container;
    const candidates = Array.from(body.querySelectorAll(tracked.node.tagName)) as HTMLElement[];

    const match = findBestMatch(
      tracked.node.fingerprint,
      candidates,
      this.config.weights,
      this.config.confidenceThreshold
    );

    if (match) {
      // Update reference and reverse lookup
      tracked.ref = new WeakRef(match.element);
      tracked.status = 'active';
      tracked.lostAt = null;
      this.elementToId.set(match.element, tracked.node.id);

      // Update fingerprint
      tracked.node.fingerprint = updateFingerprint(
        tracked.node.fingerprint,
        match.element,
        match.confidence
      );

      return match.element;
    }

    return null;
  }

  /**
   * Find element by fingerprint (last resort search).
   */
  private findElementByFingerprint(fingerprint: ElementFingerprint): HTMLElement | null {
    const body = this.container instanceof Document ? this.container.body : this.container;
    const candidates = Array.from(body.querySelectorAll(fingerprint.tagName)) as HTMLElement[];

    const match = findBestMatch(
      fingerprint,
      candidates,
      this.config.weights,
      this.config.confidenceThreshold
    );

    return match?.element ?? null;
  }

  // ===========================================================================
  // Tree Management
  // ===========================================================================

  /**
   * Build the initial tree.
   */
  private buildInitialTree(): DOMTree {
    const body = this.container instanceof Document ? this.container.body : this.container;
    return buildDOMTree(body as HTMLElement, this.config);
  }

  /**
   * Populate the nodeMap from the tree.
   */
  private populateNodeMap(node: TreeNode, parentId: string | null): void {
    // Find the corresponding DOM element
    const element = this.findElementByFingerprint(node.fingerprint);

    // Mark element as tracked and add to reverse lookup
    if (element) {
      this.markElementTracked(element);
      this.elementToId.set(element, node.id);
    }

    const tracked: TrackedNode = {
      node,
      ref: element ? new WeakRef(element) : new WeakRef(document.createElement('div')),
      status: element ? 'active' : 'searching',
      lostAt: element ? null : Date.now(),
      parentId,
    };

    this.nodeMap.set(node.id, tracked);

    // Recurse to children
    for (const child of node.children) {
      this.populateNodeMap(child, node.id);
    }
  }

  /**
   * Add a new node to the tree.
   * Applies the same flattening logic as initial tree build.
   */
  private addNodeToTree(element: HTMLElement, parentId: string): void {
    const parentTracked = this.nodeMap.get(parentId);
    if (!parentTracked || !this.tree) return;

    const tag = element.tagName.toLowerCase();
    const nodeType = getNodeType(element);

    // Skip meaningless containers (same logic as tree-builder)
    const label = extractLabel(element);
    const labelLower = label.toLowerCase();

    // Check if this is a meaningless element that should be skipped
    const meaninglessLabels = new Set([
      'div',
      'span',
      'section',
      'article',
      'aside',
      'figure',
      'figcaption',
      'header',
      'footer',
      'main',
      'nav',
      'container',
      'wrapper',
      'content',
    ]);
    const isMeaningless = meaninglessLabels.has(labelLower) || labelLower === tag;

    // For meaningless containers, add children directly instead
    if (isMeaningless && nodeType !== 'interactive' && nodeType !== 'media') {
      // Process children directly under parent
      for (const child of element.children) {
        if (child instanceof HTMLElement && !isHidden(child)) {
          this.addNodeToTree(child, parentId);
        }
      }
      return; // Don't add this node
    }

    // Create fingerprint
    const fingerprint = createFingerprint(element);

    // DUPLICATE PREVENTION: Check if any existing node has the same stable identifier
    // This catches cases where our re-render matching missed an element
    const existingDuplicate = this.findExistingNodeByIdentifiers(fingerprint);
    if (existingDuplicate) {
      if (this.config.debugMode) {
        console.log('[TreeTracker] Prevented duplicate via identifier:', {
          label,
          href: fingerprint.href,
          testId: fingerprint.testId,
          existingId: existingDuplicate.node.id,
        });
      }
      // Update existing node's reference instead of adding duplicate
      existingDuplicate.ref = new WeakRef(element);
      existingDuplicate.status = 'active';
      existingDuplicate.lostAt = null;
      this.elementToId.set(element, existingDuplicate.node.id);
      this.markElementTracked(element);
      // Update label and fingerprint
      existingDuplicate.node.label = label;
      existingDuplicate.node.fingerprint = fingerprint;
      this.cancelGracePeriod(existingDuplicate.node.id);
      return; // Don't add a new node
    }

    // Create tree node
    const interactiveType = nodeType === 'interactive' ? getInteractiveType(element) : undefined;
    const formState = extractFormState(element);

    const newNode: TreeNode = {
      id: fingerprint.id,
      fingerprint,
      tagName: tag,
      nodeType,
      label,
      originalLabel: label,
      depth: parentTracked.node.depth + 1,
      isExpanded: true,
      isVisible: isInViewport(element),
      isModal: false,
      children: [],
      interactiveType,
      ...formState,
    };

    // Find insertion index (based on DOM order)
    const index = this.findInsertionIndex(element, parentTracked.node);

    // Add to parent's children
    parentTracked.node.children.splice(index, 0, newNode);

    // Mark element as tracked and add to reverse lookup
    this.markElementTracked(element);
    this.elementToId.set(element, newNode.id);

    // Add to nodeMap
    const tracked: TrackedNode = {
      node: newNode,
      ref: new WeakRef(element),
      status: 'active',
      lostAt: null,
      parentId,
    };
    this.nodeMap.set(newNode.id, tracked);

    // Update tree metadata
    this.tree.nodeCount++;

    // DEBUG: Log new node additions
    if (this.config.debugMode) {
      console.log('[TreeTracker] Added NEW node:', {
        id: newNode.id.slice(0, 8),
        label: label.slice(0, 50),
        tag,
        href: fingerprint.href,
        testId: fingerprint.testId,
        totalNodes: this.tree.nodeCount,
      });
    }

    // Emit event
    this.emitEvent({
      type: 'node-added',
      node: newNode,
      parentId,
      index,
    });
  }

  /**
   * Remove a node from the tree.
   */
  private removeNodeFromTree(nodeId: string): void {
    const tracked = this.nodeMap.get(nodeId);
    if (!tracked || !this.tree) return;

    // Remove from parent's children
    if (tracked.parentId) {
      const parentTracked = this.nodeMap.get(tracked.parentId);
      if (parentTracked) {
        const index = parentTracked.node.children.findIndex((c) => c.id === nodeId);
        if (index !== -1) {
          parentTracked.node.children.splice(index, 1);
        }
      }
    }

    // Remove this node and all descendants from nodeMap
    this.removeNodeRecursive(nodeId);

    // Update tree metadata
    this.tree.nodeCount = this.nodeMap.size;
  }

  /**
   * Recursively remove a node and its descendants from nodeMap.
   */
  private removeNodeRecursive(nodeId: string): void {
    const tracked = this.nodeMap.get(nodeId);
    if (!tracked) return;

    // Remove children first
    for (const child of tracked.node.children) {
      this.removeNodeRecursive(child.id);
    }

    // Remove this node
    this.nodeMap.delete(nodeId);
    this.cancelGracePeriod(nodeId);
  }

  // ===========================================================================
  // Modal Detection
  // ===========================================================================

  /** Track currently active modal element */
  private activeModal: HTMLElement | null = null;

  /**
   * Check if an element is a modal dialog.
   */
  private isModalElement(el: HTMLElement): boolean {
    return (
      el.getAttribute('role') === 'dialog' ||
      el.getAttribute('aria-modal') === 'true' ||
      el.matches(CONFIG.modal.selectors)
    );
  }

  /**
   * Detect modal changes in added/removed elements.
   */
  private detectModalChanges(
    addedElements: Set<HTMLElement>,
    removedElements: Set<HTMLElement>
  ): void {
    // Check for modal closures first
    if (this.activeModal) {
      // Modal closed if it was removed OR is no longer connected to DOM
      if (removedElements.has(this.activeModal) || !this.activeModal.isConnected) {
        this.emitEvent({ type: 'modal-closed', modalId: this.getElementId(this.activeModal) });
        this.activeModal = null;
      }
    }

    // Check for new modals - both direct and descendants
    if (!this.activeModal) {
      for (const el of addedElements) {
        // Check if the added element itself is a modal
        if (this.isModalElement(el)) {
          this.activeModal = el;
          const modalId = this.getElementId(el);
          this.emitEvent({ type: 'modal-opened', modalId, element: el });
          break;
        }

        // Check descendants for modals (modal might be inside added container)
        const modalDescendant = el.querySelector(CONFIG.modal.selectors) as HTMLElement | null;
        if (modalDescendant) {
          this.activeModal = modalDescendant;
          const modalId = this.getElementId(modalDescendant);
          this.emitEvent({ type: 'modal-opened', modalId, element: modalDescendant });
          break;
        }
      }
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Check if an element is already tracked.
   * Uses data attribute as primary check (survives GC), falls back to nodeMap.
   */
  private isElementTracked(element: HTMLElement): boolean {
    // Fast path: check data attribute
    if (element.hasAttribute('data-klaro-tracked')) {
      return true;
    }

    // Fallback: check nodeMap (for elements tracked before this fix)
    for (const tracked of this.nodeMap.values()) {
      const el = tracked.ref.deref();
      if (el === element) return true;
    }
    return false;
  }

  /**
   * Mark an element as tracked.
   */
  private markElementTracked(element: HTMLElement): void {
    element.setAttribute('data-klaro-tracked', 'true');
  }

  /**
   * Mark all visible elements in a container as tracked.
   * This prevents the mutation observer from re-adding existing elements.
   */
  private markAllVisibleElements(container: HTMLElement): void {
    // Mark the container itself
    if (!isHidden(container)) {
      this.markElementTracked(container);
    }

    // Mark all descendants
    const allElements = container.querySelectorAll('*');
    for (const el of allElements) {
      if (el instanceof HTMLElement && !isHidden(el)) {
        this.markElementTracked(el);
      }
    }
  }

  /**
   * Find node ID by element.
   */
  private findNodeIdByElement(element: HTMLElement): string | null {
    for (const [id, tracked] of this.nodeMap) {
      const el = tracked.ref.deref();
      if (el === element) return id;
    }
    return null;
  }

  /**
   * Find an existing node by stable identifiers (href, testId, name, ariaLabel).
   * Used to prevent duplicates when re-render matching misses an element.
   *
   * AGGRESSIVE MODE: Matches ANY node with same identifier, regardless of element state.
   * This prevents duplicates even when the old element hasn't been GC'd yet.
   */
  private findExistingNodeByIdentifiers(fingerprint: ElementFingerprint): TrackedNode | null {
    // Only check if we have a stable identifier to match
    const hasStableId =
      fingerprint.href || fingerprint.testId || fingerprint.name || fingerprint.ariaLabel;
    if (!hasStableId) return null;

    for (const tracked of this.nodeMap.values()) {
      // Must be same tag
      if (tracked.node.tagName !== fingerprint.tagName) continue;

      const existingFp = tracked.node.fingerprint;
      const existingEl = tracked.ref.deref();

      // Check if this is a candidate for update (stale element or in grace period)
      const isStale = !existingEl || !existingEl.isConnected;
      const isSearching = tracked.status === 'searching';
      const canUpdate = isStale || isSearching;

      // Check stable identifiers - if match found, either update or skip
      let identifierMatch = false;

      if (fingerprint.href && existingFp.href === fingerprint.href) {
        identifierMatch = true;
      } else if (fingerprint.testId && existingFp.testId === fingerprint.testId) {
        identifierMatch = true;
      } else if (fingerprint.name && existingFp.name === fingerprint.name) {
        identifierMatch = true;
      } else if (fingerprint.ariaLabel && existingFp.ariaLabel === fingerprint.ariaLabel) {
        identifierMatch = true;
      }

      if (identifierMatch) {
        // If element is stale or searching, we can update it
        if (canUpdate) {
          return tracked;
        }
        // If element is active with same identifier, it's a TRUE duplicate in the DOM
        // Return null to allow adding (the DOM actually has two elements with same id)
        // But log this unusual case
        if (this.config.debugMode) {
          console.warn(
            '[TreeTracker] True DOM duplicate detected:',
            fingerprint.href || fingerprint.testId
          );
        }
      }
    }

    return null;
  }

  /**
   * Find the parent node ID for an element.
   */
  private findParentNodeId(element: HTMLElement): string | null {
    let parent = element.parentElement;

    while (parent) {
      const nodeId = this.findNodeIdByElement(parent);
      if (nodeId) return nodeId;
      parent = parent.parentElement;
    }

    // If no parent found in tree, return root
    if (this.tree) {
      return this.tree.root.id;
    }

    return null;
  }

  /**
   * Find insertion index for a new element in parent's children.
   */
  private findInsertionIndex(element: HTMLElement, parentNode: TreeNode): number {
    const siblings = parentNode.children;
    if (siblings.length === 0) return 0;

    // Get DOM order
    for (let i = 0; i < siblings.length; i++) {
      const siblingTracked = this.nodeMap.get(siblings[i].id);
      const siblingEl = siblingTracked?.ref.deref();

      if (
        siblingEl &&
        element.compareDocumentPosition(siblingEl) & Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        return i;
      }
    }

    return siblings.length;
  }

  /**
   * Update node form state.
   */
  private updateNodeFormState(nodeId: string, changes: Partial<TreeNode>): void {
    const tracked = this.nodeMap.get(nodeId);
    if (tracked) {
      Object.assign(tracked.node, changes);

      this.emitEvent({
        type: 'node-updated',
        nodeId,
        changes,
      });
    }
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update configuration.
   */
  setConfig(config: Partial<TreeTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): TreeTrackerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Exports
// =============================================================================

export { buildDOMTree } from './tree-builder';
export type {
  TreeNode,
  TrackedNode,
  DOMTree,
  TreeTrackerConfig,
  TreeTrackerEvent,
  TreeTrackerEventType,
  NodeType,
  InteractiveType,
  ActionResult,
  ModalOpenedEvent,
  ModalClosedEvent,
} from './types';
