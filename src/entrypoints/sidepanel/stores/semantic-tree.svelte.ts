/**
 * Semantic Tree Store
 *
 * Svelte 5 runes-based state management for semantic grouping.
 * Groups are organized by purpose (LLM-generated), not DOM structure.
 * Elements stay in their groups even when DOM changes.
 */

import { browser } from 'wxt/browser';
import type {
  SemanticTree,
  DisplayGroup,
  ElementRef,
  TrackedElementData,
  ElementFormState,
} from '$lib/schemas/semantic-groups';
import {
  isElementRef,
  isDisplayGroup,
  buildElementToGroupIndex,
  findGroupById,
  removeElementFromGroups,
  addElementToGroup,
  createFlatListFallback,
} from '$lib/schemas/semantic-groups';
import { CONFIG } from '../../../config';

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

/** The semantic tree (groups structure) */
let tree = $state<SemanticTree | null>(null);

/** Element data by ID */
let elements = $state<Map<string, TrackedElementData>>(new Map());

/** Reverse lookup: elementId → groupId */
let elementToGroup = $state<Map<string, string>>(new Map());

/** Label deduplication: "tag:label" → elementId (keeps first/canonical element for each label) */
let labelToElementId = $state<Map<string, string>>(new Map());

/** Modal overlay active */
let modalActive = $state(false);

/** Saved tree state before modal (for restoration) */
let preModalTree = $state<SemanticTree | null>(null);

/** Version counter for forcing reactivity */
let version = $state(0);

// =============================================================================
// Derived State
// =============================================================================

/** Total element count (unique elements shown in sidebar) */
const elementCount = $derived(elements.size);

/** Total unique labels tracked */
const uniqueLabelCount = $derived(labelToElementId.size);

/** Total group count (top-level only) */
const groupCount = $derived(tree?.groups.length ?? 0);

// =============================================================================
// Types
// =============================================================================

/** Expand state entry with timestamp for LRU */
interface ExpandStateEntry {
  collapsedIds: string[];
  lastAccess: number;
}

/** Storage format for expand states */
interface ExpandStateStore {
  [url: string]: ExpandStateEntry;
}

// =============================================================================
// Expand State Persistence
// =============================================================================

const EXPAND_STATE_KEY = CONFIG.store.expandStateKey;

/**
 * Load expand states from storage.
 */
async function loadExpandStates(): Promise<ExpandStateStore> {
  try {
    const result = await browser.storage.local.get(EXPAND_STATE_KEY);
    return (result[EXPAND_STATE_KEY] as ExpandStateStore) || {};
  } catch {
    return {};
  }
}

/**
 * Save expand states to storage with true LRU cleanup (timestamp-based).
 */
async function saveExpandStates(states: ExpandStateStore): Promise<void> {
  try {
    const urls = Object.keys(states);
    if (urls.length > CONFIG.store.maxStoredUrls) {
      // Sort by lastAccess timestamp (oldest first)
      const sorted = urls.sort((a, b) => states[a].lastAccess - states[b].lastAccess);
      const toRemove = sorted.slice(0, urls.length - CONFIG.store.maxStoredUrls);
      for (const u of toRemove) {
        delete states[u];
      }
    }
    await browser.storage.local.set({ [EXPAND_STATE_KEY]: states });
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get URL key for expand state storage.
 */
function getUrlKey(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return u.pathname + u.search;
  } catch {
    return pageUrl;
  }
}

/**
 * Save current expand states for this URL.
 */
async function persistExpandStates(): Promise<void> {
  if (!tree) return;

  const collapsedGroupIds: string[] = [];

  function collectCollapsed(groups: DisplayGroup[]): void {
    for (const group of groups) {
      if (!group.isExpanded) {
        collapsedGroupIds.push(group.id);
      }
      for (const child of group.children) {
        if (isDisplayGroup(child)) {
          collectCollapsed([child]);
        }
      }
    }
  }

  collectCollapsed(tree.groups);

  const states = await loadExpandStates();
  states[getUrlKey(url)] = {
    collapsedIds: collapsedGroupIds,
    lastAccess: Date.now(),
  };
  await saveExpandStates(states);
}

/**
 * Restore expand states for this URL.
 */
async function restoreExpandStates(): Promise<void> {
  if (!tree) return;

  const states = await loadExpandStates();
  const entry = states[getUrlKey(url)];
  const collapsedIds = entry?.collapsedIds || [];
  const collapsedSet = new Set(collapsedIds);

  function applyStates(groups: DisplayGroup[]): void {
    for (const group of groups) {
      group.isExpanded = !collapsedSet.has(group.id);
      for (const child of group.children) {
        if (isDisplayGroup(child)) {
          applyStates([child]);
        }
      }
    }
  }

  applyStates(tree.groups);

  // Update lastAccess timestamp
  if (entry) {
    states[getUrlKey(url)] = { ...entry, lastAccess: Date.now() };
    await saveExpandStates(states);
  }

  version++;
}

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
  elements = new Map();
  elementToGroup = new Map();
  labelToElementId = new Map();
  modalActive = false;
  preModalTree = null;
  version = 0;
}

/**
 * Initialize the store with a semantic tree and elements.
 */
export async function initializeTree(
  semanticTree: SemanticTree,
  elementData: Map<string, TrackedElementData>
): Promise<void> {
  url = semanticTree.url;
  title = semanticTree.title;
  tree = semanticTree;
  elements = elementData;
  error = null;
  loading = false;

  // Build reverse lookup index
  rebuildIndex();

  // Restore expand states for this URL (now properly awaited)
  await restoreExpandStates();

  version++;
}

/**
 * Initialize with flat list fallback (when LLM fails).
 */
export function initializeFlat(
  pageUrl: string,
  pageTitle: string,
  elementData: Map<string, TrackedElementData>
): void {
  const elementIds = Array.from(elementData.keys());
  const groups = createFlatListFallback(elementIds);

  tree = {
    groups,
    url: pageUrl,
    title: pageTitle,
    modalActive: false,
    modalGroup: null,
    version: 1,
  };
  url = pageUrl;
  title = pageTitle;
  elements = elementData;
  error = null;
  loading = false;

  rebuildIndex();
  version++;
}

// =============================================================================
// Index Management
// =============================================================================

/**
 * Rebuild the elementId → groupId reverse lookup index.
 */
function rebuildIndex(): void {
  if (!tree) {
    elementToGroup = new Map();
    return;
  }
  elementToGroup = buildElementToGroupIndex(tree.groups);
}

/**
 * Get the group ID for an element.
 */
export function getGroupForElement(elementId: string): string | undefined {
  return elementToGroup.get(elementId);
}

// =============================================================================
// Group Navigation
// =============================================================================

/**
 * Toggle a group's expanded state.
 */
export function toggleGroup(groupId: string): void {
  if (!tree) return;

  const group = findGroupById(tree.groups, groupId);
  if (group) {
    group.isExpanded = !group.isExpanded;
    persistExpandStates();
    version++;
  }
}

/**
 * Expand a specific group.
 */
export function expandGroup(groupId: string): void {
  if (!tree) return;

  const group = findGroupById(tree.groups, groupId);
  if (group && !group.isExpanded) {
    group.isExpanded = true;
    persistExpandStates();
    version++;
  }
}

/**
 * Collapse a specific group.
 */
export function collapseGroup(groupId: string): void {
  if (!tree) return;

  const group = findGroupById(tree.groups, groupId);
  if (group && group.isExpanded) {
    group.isExpanded = false;
    persistExpandStates();
    version++;
  }
}

/**
 * Expand all groups.
 */
export function expandAll(): void {
  if (!tree) return;

  function expand(groups: DisplayGroup[]): void {
    for (const group of groups) {
      group.isExpanded = true;
      for (const child of group.children) {
        if (isDisplayGroup(child)) {
          expand([child]);
        }
      }
    }
  }

  expand(tree.groups);
  persistExpandStates();
  version++;
}

/**
 * Collapse all groups.
 */
export function collapseAll(): void {
  if (!tree) return;

  function collapse(groups: DisplayGroup[]): void {
    for (const group of groups) {
      group.isExpanded = false;
      for (const child of group.children) {
        if (isDisplayGroup(child)) {
          collapse([child]);
        }
      }
    }
  }

  collapse(tree.groups);
  persistExpandStates();
  version++;
}

// =============================================================================
// Modal Overlay Mode
// =============================================================================

/**
 * Enter modal overlay mode.
 * Saves current tree and replaces with modal content.
 */
export function enterModalOverlay(
  modalGroup: DisplayGroup,
  modalElements: Map<string, TrackedElementData>
): void {
  if (!tree) return;

  // Deep clone for proper isolation (prevents shared reference mutation)
  preModalTree = structuredClone(tree);

  // Replace with modal content
  tree = {
    groups: [modalGroup],
    url,
    title,
    modalActive: true,
    modalGroup,
    version: tree.version + 1,
  };

  // Merge modal elements into element map
  for (const [id, data] of modalElements) {
    elements.set(id, data);
  }
  elements = new Map(elements);

  modalActive = true;
  rebuildIndex();
  version++;
}

/**
 * Exit modal overlay mode.
 * Restores previous tree state.
 */
export function exitModalOverlay(): void {
  if (!preModalTree) return;

  tree = preModalTree;
  preModalTree = null;
  modalActive = false;

  rebuildIndex();
  version++;
}

// =============================================================================
// Mutation Helpers (ensure reactivity is triggered)
// =============================================================================

/**
 * Set element data with proper reactivity trigger and LRU eviction.
 */
function setElement(id: string, data: TrackedElementData): void {
  elements.set(id, data);
  elements = new Map(elements); // Trigger Svelte reactivity
  evictElementsIfNeeded();
}

/**
 * Delete element data with proper reactivity trigger.
 */
function deleteElement(id: string): void {
  elements.delete(id);
  elements = new Map(elements); // Trigger Svelte reactivity
}

/**
 * Evict oldest elements if we exceed the max limit.
 * Uses a simple FIFO approach since we don't track access times on elements.
 */
function evictElementsIfNeeded(): void {
  if (elements.size <= CONFIG.store.maxElements) return;
  if (!tree) return;

  // Get elements that are NOT in any group (orphaned)
  const orphanedIds: string[] = [];
  for (const id of elements.keys()) {
    if (!elementToGroup.has(id)) {
      orphanedIds.push(id);
    }
  }

  // Delete orphaned elements first
  for (const id of orphanedIds) {
    if (elements.size <= CONFIG.store.maxElements) break;
    elements.delete(id);
  }

  // If still over limit, remove from end of groups (oldest additions)
  if (elements.size > CONFIG.store.maxElements) {
    const toRemove = elements.size - CONFIG.store.maxElements;
    let removed = 0;

    // Get all element IDs in groups
    const allIds = Array.from(elements.keys());
    for (let i = 0; i < allIds.length && removed < toRemove; i++) {
      const id = allIds[i];
      removeElementFromGroups(tree.groups, id);
      elements.delete(id);
      removed++;
    }

    rebuildIndex();
  }

  elements = new Map(elements); // Trigger reactivity after eviction
}

// =============================================================================
// Element Management
// =============================================================================

/**
 * Generate a deduplication key for an element.
 * Uses tag + normalized label to identify "same" elements.
 */
function getLabelKey(elementData: TrackedElementData): string {
  const label = elementData.label.toLowerCase().trim().slice(0, 50);
  return `${elementData.tag}:${label}`;
}

/**
 * Add a new element to a group.
 * Uses neighbor-based placement if neighborIds provided.
 *
 * LABEL-BASED DEDUPLICATION:
 * - Same ID = same element (update in place)
 * - Same label+tag = duplicate (update canonical element, skip adding)
 * - New label+tag = new element (add to group)
 */
export function addElement(
  elementData: TrackedElementData,
  neighborIds: string[],
  suggestedGroupId?: string
): void {
  if (!tree) return;

  // Check if element already exists by ID
  if (elements.has(elementData.id)) {
    // Same ID = update existing element
    setElement(elementData.id, elementData);

    // If not in a group yet, add it
    if (!elementToGroup.has(elementData.id)) {
      const targetGroupId =
        suggestedGroupId || findGroupFromNeighbors(neighborIds) || tree.groups[0]?.id;
      if (targetGroupId) {
        addElementToGroup(tree.groups, targetGroupId, elementData.id);
        rebuildIndex();
      }
    }
    version++;
    return;
  }

  // LABEL-BASED DEDUPLICATION
  // Only deduplicate NON-INTERACTIVE elements (text, spans, divs)
  // Interactive elements (inputs, buttons, links) should always be shown
  const isInteractive =
    ['button', 'a', 'input', 'select', 'textarea'].includes(elementData.tag) ||
    elementData.interactiveType !== undefined;

  if (!isInteractive) {
    // Check if we already have an element with the same label+tag
    const labelKey = getLabelKey(elementData);
    const existingIdForLabel = labelToElementId.get(labelKey);

    if (existingIdForLabel && elements.has(existingIdForLabel)) {
      // Duplicate label - update the canonical element's data but don't add new entry
      // This keeps the sidebar clean while ensuring we have current data
      const existing = elements.get(existingIdForLabel)!;

      // Update the canonical element with fresh form state (if any)
      if (elementData.formState) {
        existing.formState = { ...existing.formState, ...elementData.formState };
        setElement(existingIdForLabel, existing);
      }

      // Don't add the duplicate to groups - just silently skip
      return;
    }

    // Track this label for future deduplication
    labelToElementId.set(labelKey, elementData.id);
    labelToElementId = new Map(labelToElementId);
  }

  // New unique element - add to store
  setElement(elementData.id, elementData);

  // Find group using neighbor lookup or suggestion
  const targetGroupId =
    suggestedGroupId || findGroupFromNeighbors(neighborIds) || tree.groups[0]?.id;

  if (targetGroupId) {
    addElementToGroup(tree.groups, targetGroupId, elementData.id);
    rebuildIndex();
  }

  version++;
}

/**
 * Find a group based on neighbor element IDs.
 */
function findGroupFromNeighbors(neighborIds: string[]): string | undefined {
  for (const neighborId of neighborIds) {
    const neighborGroup = elementToGroup.get(neighborId);
    if (neighborGroup) {
      return neighborGroup;
    }
  }
  return undefined;
}

/**
 * Remove an element from all groups and delete its data.
 * SIMPLIFIED: Trust TreeTracker - if it says remove, remove.
 */
export function removeElement(elementId: string): void {
  if (!tree) return;

  // Only remove if element exists
  const element = elements.get(elementId);
  if (!element) {
    return;
  }

  // Clean up label deduplication map
  const labelKey = getLabelKey(element);
  if (labelToElementId.get(labelKey) === elementId) {
    labelToElementId.delete(labelKey);
    labelToElementId = new Map(labelToElementId);
  }

  removeElementFromGroups(tree.groups, elementId);
  deleteElement(elementId);
  rebuildIndex();
  version++;
}

/**
 * Update element data.
 */
export function updateElement(elementId: string, changes: Partial<TrackedElementData>): void {
  const element = elements.get(elementId);
  if (element) {
    const updated = { ...element, ...changes };
    setElement(elementId, updated);
    version++;
  }
}

/**
 * Update element form state.
 */
export function updateElementFormState(elementId: string, formState: ElementFormState): void {
  const element = elements.get(elementId);
  if (element) {
    const updated = { ...element, formState: { ...element.formState, ...formState } };
    setElement(elementId, updated);
    version++;
  }
}

/**
 * Get element data by ID.
 */
export function getElement(elementId: string): TrackedElementData | undefined {
  return elements.get(elementId);
}

/**
 * Get all elements in a group.
 */
export function getGroupElements(groupId: string): TrackedElementData[] {
  if (!tree) return [];

  const group = findGroupById(tree.groups, groupId);
  if (!group) return [];

  const result: TrackedElementData[] = [];

  function collectElements(children: (DisplayGroup | ElementRef)[]): void {
    for (const child of children) {
      if (isElementRef(child)) {
        const element = elements.get(child.elementId);
        if (element) result.push(element);
      } else {
        collectElements(child.children);
      }
    }
  }

  collectElements(group.children);
  return result;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get all elements as flat array.
 */
export function getAllElements(): TrackedElementData[] {
  return Array.from(elements.values());
}

/**
 * Get all groups as flat array.
 */
export function getAllGroups(): DisplayGroup[] {
  if (!tree) return [];

  const result: DisplayGroup[] = [];

  function collect(groups: DisplayGroup[]): void {
    for (const group of groups) {
      result.push(group);
      for (const child of group.children) {
        if (isDisplayGroup(child)) {
          collect([child]);
        }
      }
    }
  }

  collect(tree.groups);
  return result;
}

/**
 * Find element by fingerprint ID prefix (for LLM shortened IDs).
 */
export function findElementByIdPrefix(prefix: string): TrackedElementData | undefined {
  for (const [id, element] of elements) {
    if (id.startsWith(prefix)) {
      return element;
    }
  }
  return undefined;
}

/**
 * Apply LLM-enhanced labels to elements.
 */
export function applyLLMLabels(labels: Record<string, string>): void {
  for (const [shortId, label] of Object.entries(labels)) {
    const element = findElementByIdPrefix(shortId);
    if (element) {
      element.label = label;
    }
  }
  elements = new Map(elements);
  version++;
}

// =============================================================================
// Store Export
// =============================================================================

export const semanticTreeStore = {
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
  get elements() {
    return elements;
  },
  get elementCount() {
    return elementCount;
  },
  get groupCount() {
    return groupCount;
  },
  get modalActive() {
    return modalActive;
  },
  get version() {
    return version;
  },

  // Core actions
  setLoading,
  setError,
  reset,
  initializeTree,
  initializeFlat,

  // Group navigation
  toggleGroup,
  expandGroup,
  collapseGroup,
  expandAll,
  collapseAll,

  // Modal overlay
  enterModalOverlay,
  exitModalOverlay,

  // Element management
  addElement,
  removeElement,
  updateElement,
  updateElementFormState,
  getElement,
  getGroupElements,
  getGroupForElement,

  // Utilities
  getAllElements,
  getAllGroups,
  findElementByIdPrefix,
  applyLLMLabels,
};
