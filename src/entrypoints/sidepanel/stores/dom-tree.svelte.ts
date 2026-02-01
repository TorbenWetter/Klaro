/**
 * DOM Tree Store
 *
 * Svelte 5 runes-based state management for hierarchical DOM tree.
 * Handles tree state, expand/collapse, modal focus mode, and incremental updates.
 */

import type {
  DOMTree,
  DOMTreeNode,
  DOMTreeNodeBase,
  CollapseConfig,
  LLMLabelResponse,
} from '$lib/schemas/dom-tree';
import { DEFAULT_COLLAPSE_CONFIG } from '$lib/schemas/dom-tree';
import type { ElementFingerprint } from '../../../utils/element-tracker/types';

// =============================================================================
// Store State
// =============================================================================

/** Current page URL */
let url = $state('');

/** Page title */
let title = $state('');

/** Loading state */
let loading = $state(false);

/** Error message */
let error = $state<string | null>(null);

/** The DOM tree */
let tree = $state<DOMTree | null>(null);

/** Modal focus mode - when active, only modal content is shown */
let modalFocusMode = $state(false);

/** Previous expand state before modal focus (for restoration) */
let preModalExpandState = $state<Map<string, boolean>>(new Map());

/** LLM-enhanced labels by node ID */
let enhancedLabels = $state<Map<string, string>>(new Map());

/** LLM descriptions by node ID */
let descriptions = $state<Map<string, string>>(new Map());

/** Element states from content script (values, checked, etc.) */
let elementStates = $state<Map<string, Record<string, unknown>>>(new Map());

/** Version counter for forcing reactivity */
let version = $state(0);

/** Collapse configuration */
let collapseConfig = $state<CollapseConfig>(DEFAULT_COLLAPSE_CONFIG);

// =============================================================================
// Derived State
// =============================================================================

/** Total node count */
const nodeCount = $derived(tree?.nodeCount ?? 0);

/** Maximum tree depth */
const maxDepth = $derived(tree?.maxDepth ?? 0);

/** Whether a modal is currently active */
const hasActiveModal = $derived(tree?.modalNode !== null);

/** Active modal node (if any) */
const activeModal = $derived(tree?.modalNode ?? null);

// =============================================================================
// Core Actions
// =============================================================================

/**
 * Set loading state.
 */
export function setLoading(value: boolean): void {
  loading = value;
}

/**
 * Set error state.
 */
export function setError(value: string | null): void {
  error = value;
}

/**
 * Reset the store to initial state.
 */
export function reset(): void {
  url = '';
  title = '';
  loading = false;
  error = null;
  tree = null;
  modalFocusMode = false;
  preModalExpandState = new Map();
  enhancedLabels = new Map();
  descriptions = new Map();
  elementStates = new Map();
  version = 0;
}

/**
 * Initialize the store with a scanned tree.
 */
export function initializeTree(domTree: DOMTree): void {
  url = domTree.url;
  title = domTree.title;
  tree = domTree;
  error = null;
  loading = false;
  version++;

  // If a modal is active, auto-enter focus mode
  if (domTree.modalNode) {
    enterModalFocusMode(domTree.modalNode.id);
  }
}

// =============================================================================
// Tree Navigation & Manipulation
// =============================================================================

/**
 * Toggle a node's expanded state.
 */
export function toggleNode(nodeId: string): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node) {
    node.isExpanded = !node.isExpanded;
    version++;
  }
}

/**
 * Expand a specific node.
 */
export function expandNode(nodeId: string): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node && !node.isExpanded) {
    node.isExpanded = true;
    version++;
  }
}

/**
 * Collapse a specific node.
 */
export function collapseNode(nodeId: string): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node && node.isExpanded) {
    node.isExpanded = false;
    version++;
  }
}

/**
 * Expand all nodes.
 */
export function expandAll(): void {
  if (!tree) return;

  function expand(node: DOMTreeNode) {
    node.isExpanded = true;
    node.children.forEach(expand);
  }

  expand(tree.root);
  version++;
}

/**
 * Collapse all nodes.
 */
export function collapseAll(): void {
  if (!tree) return;

  function collapse(node: DOMTreeNode) {
    node.isExpanded = false;
    node.children.forEach(collapse);
  }

  collapse(tree.root);
  version++;
}

/**
 * Expand nodes to reveal a specific node (expand all ancestors).
 */
export function revealNode(nodeId: string): void {
  if (!tree) return;

  // Find path from root to node
  const path = findPathToNode(tree.root, nodeId);
  if (!path) return;

  // Expand all nodes in path except the target
  for (let i = 0; i < path.length - 1; i++) {
    path[i].isExpanded = true;
  }
  version++;
}

// =============================================================================
// Modal Focus Mode
// =============================================================================

/**
 * Enter modal focus mode - collapse all except modal content.
 */
export function enterModalFocusMode(modalNodeId: string): void {
  if (!tree) return;

  // Save current expand state
  preModalExpandState = new Map();
  function saveState(node: DOMTreeNode) {
    preModalExpandState.set(node.id, node.isExpanded);
    node.children.forEach(saveState);
  }
  saveState(tree.root);

  // Collapse all except modal path
  function collapseExceptModal(node: DOMTreeNode): boolean {
    // Check if this node is the modal or contains it
    if (node.id === modalNodeId) {
      // Expand the modal and its interactive children
      node.isExpanded = true;
      expandInteractiveChildren(node);
      return true;
    }

    // Check if any child contains the modal
    let containsModal = false;
    for (const child of node.children) {
      if (collapseExceptModal(child)) {
        containsModal = true;
      }
    }

    if (containsModal) {
      node.isExpanded = true;
    } else {
      node.isExpanded = false;
    }

    return containsModal;
  }

  collapseExceptModal(tree.root);
  modalFocusMode = true;
  version++;
}

/**
 * Exit modal focus mode - restore previous expand state.
 */
export function exitModalFocusMode(): void {
  if (!tree || !modalFocusMode) return;

  // Restore expand state
  function restoreState(node: DOMTreeNode) {
    const wasExpanded = preModalExpandState.get(node.id);
    if (wasExpanded !== undefined) {
      node.isExpanded = wasExpanded;
    }
    node.children.forEach(restoreState);
  }
  restoreState(tree.root);

  modalFocusMode = false;
  preModalExpandState = new Map();
  version++;
}

/**
 * Expand all interactive children of a node.
 */
function expandInteractiveChildren(node: DOMTreeNode): void {
  for (const child of node.children) {
    if (child.nodeType === 'interactive' || hasInteractiveDescendant(child)) {
      child.isExpanded = true;
      expandInteractiveChildren(child);
    }
  }
}

/**
 * Check if a node has any interactive descendants.
 */
function hasInteractiveDescendant(node: DOMTreeNode): boolean {
  if (node.nodeType === 'interactive') return true;
  return node.children.some(hasInteractiveDescendant);
}

// =============================================================================
// Tree Updates (Real-time Sync)
// =============================================================================

/**
 * Add a new node to the tree.
 */
export function addNode(parentId: string, node: DOMTreeNode, index: number): void {
  if (!tree) return;

  const parent = findNodeById(tree.root, parentId);
  if (parent) {
    parent.children.splice(index, 0, node);
    tree.nodeCount++;
    version++;
  }
}

/**
 * Remove a node from the tree.
 */
export function removeNode(nodeId: string): void {
  if (!tree) return;

  const parent = findParentOf(tree.root, nodeId);
  if (parent) {
    const index = parent.children.findIndex((c) => c.id === nodeId);
    if (index !== -1) {
      parent.children.splice(index, 1);
      tree.nodeCount--;
      version++;
    }
  }
}

/**
 * Update a node's properties.
 */
export function updateNode(nodeId: string, changes: Partial<DOMTreeNodeBase>): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node) {
    Object.assign(node, changes);
    version++;
  }
}

/**
 * Move a node to a new parent.
 */
export function moveNode(nodeId: string, newParentId: string, newIndex: number): void {
  if (!tree) return;

  // Find and remove from current parent
  const oldParent = findParentOf(tree.root, nodeId);
  if (!oldParent) return;

  const oldIndex = oldParent.children.findIndex((c) => c.id === nodeId);
  if (oldIndex === -1) return;

  const [node] = oldParent.children.splice(oldIndex, 1);

  // Add to new parent
  const newParent = findNodeById(tree.root, newParentId);
  if (newParent) {
    newParent.children.splice(newIndex, 0, node);
    // Update depth
    updateNodeDepths(node, newParent);
    version++;
  }
}

/**
 * Update fingerprint for a node (after re-match).
 */
export function updateNodeFingerprint(nodeId: string, fingerprint: ElementFingerprint): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node) {
    node.fingerprint = fingerprint;
    // Update label from new fingerprint
    node.originalLabel = fingerprint.textContent || fingerprint.ariaLabel || node.originalLabel;
    // Use enhanced label if available, otherwise original
    if (!enhancedLabels.has(nodeId)) {
      node.label = node.originalLabel;
    }
    version++;
  }
}

// =============================================================================
// LLM Label Enhancement
// =============================================================================

/**
 * Apply LLM-enhanced labels to nodes.
 * Note: LLM uses shortened 8-char IDs, so we match by prefix.
 */
export function applyLLMLabels(response: LLMLabelResponse): void {
  if (!tree) return;

  // Store labels (match by prefix since LLM uses shortened IDs)
  for (const [shortId, label] of Object.entries(response.labels)) {
    const node = findNodeByIdPrefix(tree.root, shortId);
    if (node) {
      enhancedLabels.set(node.id, label);
      node.label = label;
    }
  }

  // Store descriptions
  if (response.descriptions) {
    for (const [shortId, desc] of Object.entries(response.descriptions)) {
      const node = findNodeByIdPrefix(tree.root, shortId);
      if (node) {
        descriptions.set(node.id, desc);
        node.description = desc;
      }
    }
  }

  enhancedLabels = new Map(enhancedLabels);
  descriptions = new Map(descriptions);
  version++;
}

/**
 * Get enhanced label for a node (falls back to original).
 */
export function getNodeLabel(nodeId: string): string {
  return enhancedLabels.get(nodeId) || '';
}

/**
 * Get description for a node.
 */
export function getNodeDescription(nodeId: string): string | undefined {
  return descriptions.get(nodeId);
}

// =============================================================================
// Element State Management
// =============================================================================

/**
 * Update element state from content script.
 */
export function updateElementState(elementId: string, changes: Record<string, unknown>): void {
  const current = elementStates.get(elementId) || {};
  elementStates.set(elementId, { ...current, ...changes });
  elementStates = new Map(elementStates);
  version++;
}

/**
 * Set initial element states.
 */
export function setInitialElementStates(states: Record<string, Record<string, unknown>>): void {
  for (const [id, state] of Object.entries(states)) {
    elementStates.set(id, state);
  }
  elementStates = new Map(elementStates);
  version++;
}

/**
 * Get element state.
 */
export function getElementState(elementId: string): Record<string, unknown> | undefined {
  return elementStates.get(elementId);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find a node by ID.
 */
function findNodeById(node: DOMTreeNode, id: string): DOMTreeNode | null {
  if (node.id === id) return node;

  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }

  return null;
}

/**
 * Find a node by ID prefix (for matching shortened LLM IDs).
 */
function findNodeByIdPrefix(node: DOMTreeNode, prefix: string): DOMTreeNode | null {
  if (node.id.startsWith(prefix)) return node;

  for (const child of node.children) {
    const found = findNodeByIdPrefix(child, prefix);
    if (found) return found;
  }

  return null;
}

/**
 * Find parent of a node.
 */
function findParentOf(
  node: DOMTreeNode,
  id: string,
  parent: DOMTreeNode | null = null
): DOMTreeNode | null {
  if (node.id === id) return parent;

  for (const child of node.children) {
    const found = findParentOf(child, id, node);
    if (found) return found;
  }

  return null;
}

/**
 * Find path from root to a node.
 */
function findPathToNode(root: DOMTreeNode, targetId: string): DOMTreeNode[] | null {
  if (root.id === targetId) return [root];

  for (const child of root.children) {
    const path = findPathToNode(child, targetId);
    if (path) {
      return [root, ...path];
    }
  }

  return null;
}

/**
 * Update depth for node and all descendants.
 */
function updateNodeDepths(node: DOMTreeNode, parent: DOMTreeNode): void {
  node.depth = parent.depth + 1;
  for (const child of node.children) {
    updateNodeDepths(child, node);
  }
}

/**
 * Get all nodes as flat array.
 */
export function getAllNodes(): DOMTreeNode[] {
  if (!tree) return [];

  const nodes: DOMTreeNode[] = [];

  function collect(node: DOMTreeNode) {
    nodes.push(node);
    node.children.forEach(collect);
  }

  collect(tree.root);
  return nodes;
}

/**
 * Get visible nodes (in viewport).
 */
export function getVisibleNodes(): DOMTreeNode[] {
  return getAllNodes().filter((n) => n.isVisible);
}

// =============================================================================
// Store Export
// =============================================================================

export const domTreeStore = {
  // State (readonly externally)
  get url() {
    return url;
  },
  get title() {
    return title;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },
  get tree() {
    return tree;
  },
  get nodeCount() {
    return nodeCount;
  },
  get maxDepth() {
    return maxDepth;
  },
  get modalFocusMode() {
    return modalFocusMode;
  },
  get hasActiveModal() {
    return hasActiveModal;
  },
  get activeModal() {
    return activeModal;
  },
  get version() {
    return version;
  },
  get collapseConfig() {
    return collapseConfig;
  },

  // Core actions
  setLoading,
  setError,
  reset,
  initializeTree,

  // Tree navigation
  toggleNode,
  expandNode,
  collapseNode,
  expandAll,
  collapseAll,
  revealNode,

  // Modal focus
  enterModalFocusMode,
  exitModalFocusMode,

  // Tree updates
  addNode,
  removeNode,
  updateNode,
  moveNode,
  updateNodeFingerprint,

  // LLM labels
  applyLLMLabels,
  getNodeLabel,
  getNodeDescription,

  // Element state
  updateElementState,
  setInitialElementStates,
  getElementState,

  // Utilities
  getAllNodes,
  getVisibleNodes,
};
