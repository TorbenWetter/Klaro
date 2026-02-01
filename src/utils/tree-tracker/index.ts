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
import { DEFAULT_TREE_TRACKER_CONFIG } from './types';
import type { ElementFingerprint } from '../element-tracker/types';
import {
  createFingerprint,
  updateFingerprint,
  getVisibleText,
  normalizeText,
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
 * Main tree tracker class.
 * Tracks all visible DOM elements across mutations using fingerprinting.
 */
export class TreeTracker extends EventTarget {
  private config: TreeTrackerConfig;
  private tree: DOMTree | null;
  private nodeMap: Map<string, TrackedNode>;
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
    this.config = { ...DEFAULT_TREE_TRACKER_CONFIG, ...config };
    this.tree = null;
    this.nodeMap = new Map();
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

    // Build initial tree
    this.tree = this.buildInitialTree();

    // Populate nodeMap with all nodes
    this.populateNodeMap(this.tree.root, null);

    if (this.config.debugMode) {
      console.log('[TreeTracker] Started with', this.nodeMap.size, 'nodes');
    }

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

    if (this.config.debugMode) {
      console.log('[TreeTracker] Stopped');
    }
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
        this.processMutationBatch();
      });
    });

    // Fallback timeout (100ms)
    this.timeoutId = window.setTimeout(() => {
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
          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              removedElements.add(node);
              // Also track descendants
              for (const descendant of node.querySelectorAll('*')) {
                if (descendant instanceof HTMLElement) {
                  removedElements.add(descendant);
                }
              }
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

      // 4. Process re-rendered nodes (update reference, emit node-matched)
      for (const [nodeId, matchedElement] of reRenderedMatches) {
        removedNodeIds.delete(nodeId);
        addedElements.delete(matchedElement);

        const tracked = this.nodeMap.get(nodeId);
        if (tracked) {
          // Update reference
          tracked.ref = new WeakRef(matchedElement);
          tracked.status = 'active';
          tracked.lostAt = null;

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

          if (this.config.debugMode) {
            console.log('[TreeTracker] Node re-matched:', nodeId, newLabel);
          }
        }
      }

      // 5. Start grace period for truly removed nodes (don't emit yet)
      for (const nodeId of removedNodeIds) {
        this.startGracePeriod(nodeId);
      }

      // 6. Process truly new nodes (add to tree, emit node-added)
      for (const element of addedElements) {
        // Skip if shouldn't be in tree
        const tag = element.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        if (isHidden(element)) continue;

        // Skip if already tracked
        if (this.isElementTracked(element)) continue;

        // Find parent in our tree
        const parentId = this.findParentNodeId(element);
        if (parentId) {
          this.addNodeToTree(element, parentId);
        }
      }

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
   */
  private detectReRenderedNodes(
    removedNodeIds: Set<string>,
    addedElements: Set<HTMLElement>
  ): Map<string, HTMLElement> {
    const matches = new Map<string, HTMLElement>();

    if (removedNodeIds.size === 0 || addedElements.size === 0) {
      return matches;
    }

    // Collect fingerprints from removed nodes
    const removedFingerprints: ElementFingerprint[] = [];
    const fingerprintToId = new Map<string, string>();

    for (const nodeId of removedNodeIds) {
      const tracked = this.nodeMap.get(nodeId);
      if (tracked) {
        removedFingerprints.push(tracked.node.fingerprint);
        fingerprintToId.set(tracked.node.fingerprint.id, nodeId);
      }
    }

    // Convert added elements to array
    const candidateElements = Array.from(addedElements);

    // Use batch matching
    const matchResults = matchAll(
      removedFingerprints,
      candidateElements,
      this.config.weights,
      this.config.confidenceThreshold
    );

    // Process matches
    const usedElements = new Set<HTMLElement>();
    for (const [fpId, result] of matchResults) {
      if (result && !usedElements.has(result.element)) {
        const nodeId = fingerprintToId.get(fpId);
        if (nodeId) {
          matches.set(nodeId, result.element);
          usedElements.add(result.element);
        }
      }
    }

    return matches;
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
        if (!element || !element.isConnected) {
          // Truly gone - emit removal
          tracked.status = 'lost';
          this.removeNodeFromTree(nodeId);
          this.emitEvent({ type: 'node-removed', nodeId });

          if (this.config.debugMode) {
            console.log('[TreeTracker] Node removed after grace period:', nodeId);
          }
        } else {
          // Reappeared - restore
          tracked.ref = new WeakRef(element);
          tracked.status = 'active';
          tracked.lostAt = null;

          if (this.config.debugMode) {
            console.log('[TreeTracker] Node reappeared:', nodeId);
          }
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
      // Update reference
      tracked.ref = new WeakRef(match.element);
      tracked.status = 'active';
      tracked.lostAt = null;

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

    // Emit event
    this.emitEvent({
      type: 'node-added',
      node: newNode,
      parentId,
      index,
    });

    if (this.config.debugMode) {
      console.log('[TreeTracker] Node added:', newNode.id, label);
    }
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
  // Helper Methods
  // ===========================================================================

  /**
   * Check if an element is already tracked.
   */
  private isElementTracked(element: HTMLElement): boolean {
    for (const tracked of this.nodeMap.values()) {
      const el = tracked.ref.deref();
      if (el === element) return true;
    }
    return false;
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
} from './types';
export { DEFAULT_TREE_TRACKER_CONFIG } from './types';
