/**
 * DOM Tree Store
 *
 * Simple Svelte 5 runes-based store for holding the raw DOM tree
 * without LLM semantic grouping. Shows all content in original DOM hierarchy.
 */

import type { DOMTree, DOMTreeNode } from '$lib/schemas/dom-tree';

// =============================================================================
// State
// =============================================================================

let tree = $state<DOMTree | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

// Element states for form synchronization (value, checked, etc.)
let elementStates = $state<Map<string, Record<string, unknown>>>(new Map());

// =============================================================================
// Computed
// =============================================================================

function countNodes(node: DOMTreeNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

// =============================================================================
// Actions
// =============================================================================

function setTree(newTree: DOMTree): void {
  tree = newTree;
  elementStates = new Map();
}

function setLoading(value: boolean): void {
  loading = value;
}

function setError(value: string | null): void {
  error = value;
}

function reset(): void {
  tree = null;
  elementStates = new Map();
}

/**
 * Update form state for an element (value, checked, disabled, options)
 */
function updateElementState(elementId: string, changes: Record<string, unknown>): void {
  const current = elementStates.get(elementId) || {};
  elementStates.set(elementId, { ...current, ...changes });
  // Trigger reactivity by reassigning
  elementStates = new Map(elementStates);
}

/**
 * Toggle expand/collapse state of a node
 */
function toggleNode(nodeId: string): void {
  if (!tree) return;

  function findAndToggle(node: DOMTreeNode): boolean {
    if (node.id === nodeId) {
      node.isExpanded = !node.isExpanded;
      return true;
    }
    for (const child of node.children) {
      if (findAndToggle(child)) return true;
    }
    return false;
  }

  findAndToggle(tree.root);
  // Trigger reactivity
  tree = { ...tree };
}

/**
 * Expand all nodes
 */
function expandAll(): void {
  if (!tree) return;

  function expand(node: DOMTreeNode): void {
    node.isExpanded = true;
    for (const child of node.children) {
      expand(child);
    }
  }

  expand(tree.root);
  tree = { ...tree };
}

/**
 * Collapse all nodes
 */
function collapseAll(): void {
  if (!tree) return;

  function collapse(node: DOMTreeNode): void {
    node.isExpanded = false;
    for (const child of node.children) {
      collapse(child);
    }
  }

  collapse(tree.root);
  tree = { ...tree };
}

/**
 * Find a node by ID
 */
function findNode(nodeId: string): DOMTreeNode | null {
  if (!tree) return null;

  function find(node: DOMTreeNode): DOMTreeNode | null {
    if (node.id === nodeId) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }

  return find(tree.root);
}

/**
 * Update a node's properties
 */
function updateNode(nodeId: string, changes: Partial<DOMTreeNode>): void {
  if (!tree) return;
  const node = findNode(nodeId);
  if (node) {
    Object.assign(node, changes);
    tree = { ...tree };
  }
}

/**
 * Remove a node from the tree
 */
function removeNode(nodeId: string): void {
  if (!tree) return;

  function removeFromParent(parent: DOMTreeNode): boolean {
    const index = parent.children.findIndex((c) => c.id === nodeId);
    if (index !== -1) {
      parent.children.splice(index, 1);
      return true;
    }
    for (const child of parent.children) {
      if (removeFromParent(child)) return true;
    }
    return false;
  }

  removeFromParent(tree.root);
  elementStates.delete(nodeId);
  tree = { ...tree };
}

// =============================================================================
// Exported Store
// =============================================================================

export const domTreeStore = {
  // Reactive getters
  get tree() {
    return tree;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },
  get elementStates() {
    return elementStates;
  },
  get url() {
    return tree?.url || '';
  },
  get title() {
    return tree?.title || '';
  },
  get nodeCount() {
    return tree ? countNodes(tree.root) : 0;
  },
  get root() {
    return tree?.root || null;
  },

  // Actions
  setTree,
  setLoading,
  setError,
  reset,
  updateElementState,
  toggleNode,
  expandAll,
  collapseAll,
  findNode,
  updateNode,
  removeNode,
};
