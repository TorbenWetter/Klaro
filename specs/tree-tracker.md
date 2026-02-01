# Feature: TreeTracker - Unified DOM Tree Tracking

> A single, robust tracker class that handles both hierarchical DOM tree structure and interactive element actions, replacing the current dual-system architecture.

## Overview

The current implementation has two parallel systems:

1. **ElementTracker** - Tracks interactive elements with robust matching, grace periods, double-RAF batching
2. **Tree sync** - Tracks all DOM nodes but with naive matching, no grace periods, simple debouncing

This causes elements to disappear from the sidebar during React re-renders because the tree sync doesn't leverage ElementTracker's proven infrastructure.

**TreeTracker** unifies these into a single system that:

- Tracks ALL visible DOM nodes (not just interactive)
- Uses the robust matcher module with weighted scoring
- Implements grace periods before declaring nodes lost
- Uses double-RAF batching for React compatibility
- Emits events for sidebar integration
- Maintains the hierarchical tree structure

## Requirements

### Functional Requirements

- [ ] FR1: Track all visible DOM elements using fingerprint-based identification
- [ ] FR2: Detect React re-renders by matching "removed" elements to "added" elements using fuzzy scoring
- [ ] FR3: Maintain hierarchical tree structure with parent-child relationships
- [ ] FR4: Emit events for tree changes (node-added, node-removed, node-updated, node-matched)
- [ ] FR5: Support element actions (click, setValue, toggleCheckbox, setSelect) by fingerprint ID
- [ ] FR6: Handle modal detection and focus mode
- [ ] FR7: Persist fingerprints to session storage for page reload recovery

### Non-Functional Requirements

- [ ] NFR1: Performance - Handle up to 5000 nodes without blocking UI
- [ ] NFR2: Latency - Process mutations within 100ms (double-RAF + grace period)
- [ ] NFR3: Memory - Use WeakRef for element references to allow garbage collection
- [ ] NFR4: Reliability - 95%+ match rate for React re-renders on typical SPAs

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ TreeTracker                                                     │
├─────────────────────────────────────────────────────────────────┤
│ State:                                                          │
│   - tree: TreeNode (root)                                       │
│   - nodeMap: Map<id, TrackedNode>                               │
│   - pendingRemovals: Map<id, timestamp>  (grace period)         │
│                                                                 │
│ Reuses:                                                         │
│   - matcher.ts (findBestMatch, matchAll, calculateConfidence)   │
│   - fingerprint.ts (createFingerprint, updateFingerprint)       │
│   - similarity.ts (textSimilarity, positionSimilarity)          │
│   - types.ts (ElementFingerprint, MatchWeights, TrackerConfig)  │
│                                                                 │
│ Events:                                                         │
│   - tree-initialized                                            │
│   - node-added                                                  │
│   - node-removed                                                │
│   - node-updated                                                │
│   - node-matched (re-render detected)                           │
│   - tree-error                                                  │
└─────────────────────────────────────────────────────────────────┘
           │
           │ MutationObserver (double-RAF batching)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│ DOM                                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Affected Components

| File                                                  | Changes                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `src/utils/tree-tracker/index.ts`                     | **NEW** - Main TreeTracker class                                 |
| `src/utils/tree-tracker/types.ts`                     | **NEW** - TreeNode, TrackedNode, event types                     |
| `src/utils/tree-tracker/tree-builder.ts`              | **NEW** - Build hierarchical tree from DOM                       |
| `src/entrypoints/content.ts`                          | **MODIFY** - Replace ElementTracker + tree sync with TreeTracker |
| `src/entrypoints/sidepanel/App.svelte`                | **MODIFY** - Listen to TreeTracker events via messages           |
| `src/entrypoints/sidepanel/stores/dom-tree.svelte.ts` | **MODIFY** - Handle new event types                              |
| `src/utils/element-tracker/`                          | **DEPRECATE** - Keep for reference, mark as deprecated           |
| `src/utils/dom-tree-scanner.ts`                       | **DEPRECATE** - Replaced by tree-tracker/tree-builder.ts         |

### Data Model

```typescript
// src/utils/tree-tracker/types.ts

import type { ElementFingerprint, MatchWeights } from '../element-tracker/types';

/**
 * Node types for tree classification
 */
export type NodeType =
  | 'interactive' // buttons, links, inputs
  | 'text' // headings, paragraphs
  | 'media' // images, video
  | 'container' // divs, sections
  | 'list' // ul, ol
  | 'listItem' // li
  | 'table'; // table elements

/**
 * A node in the hierarchical tree
 */
export interface TreeNode {
  id: string; // Fingerprint ID
  fingerprint: ElementFingerprint;
  tagName: string;
  nodeType: NodeType;
  label: string; // Display text
  depth: number;
  isExpanded: boolean;
  isVisible: boolean; // In viewport
  isModal: boolean;
  children: TreeNode[];

  // Interactive-specific
  interactiveType?: 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'select' | 'textarea';

  // Text-specific
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;

  // Form state (synced from DOM)
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  options?: { value: string; label: string; selected: boolean }[];
}

/**
 * Internal tracked node with WeakRef
 */
export interface TrackedNode {
  node: TreeNode;
  ref: WeakRef<HTMLElement>;
  status: 'active' | 'searching' | 'lost';
  lostAt: number | null;
  parentId: string | null;
}

/**
 * Tree structure returned by initial scan
 */
export interface DOMTree {
  root: TreeNode;
  nodeCount: number;
  maxDepth: number;
  modalNode: TreeNode | null;
  url: string;
  title: string;
}

/**
 * TreeTracker configuration
 */
export interface TreeTrackerConfig {
  confidenceThreshold: number; // Default: 0.6
  gracePeriodMs: number; // Default: 150
  maxNodes: number; // Default: 5000
  maxDepth: number; // Default: 50
  weights: MatchWeights;
  debugMode: boolean;
}

/**
 * Event types emitted by TreeTracker
 */
export type TreeTrackerEventType =
  | 'tree-initialized'
  | 'node-added'
  | 'node-removed'
  | 'node-updated'
  | 'node-matched'
  | 'tree-error';

export interface TreeInitializedEvent {
  type: 'tree-initialized';
  tree: DOMTree;
}

export interface NodeAddedEvent {
  type: 'node-added';
  node: TreeNode;
  parentId: string;
  index: number;
}

export interface NodeRemovedEvent {
  type: 'node-removed';
  nodeId: string;
}

export interface NodeUpdatedEvent {
  type: 'node-updated';
  nodeId: string;
  changes: Partial<TreeNode>;
}

export interface NodeMatchedEvent {
  type: 'node-matched';
  nodeId: string;
  confidence: number;
  changes: Partial<TreeNode>;
}

export interface TreeErrorEvent {
  type: 'tree-error';
  error: string;
}

export type TreeTrackerEvent =
  | TreeInitializedEvent
  | NodeAddedEvent
  | NodeRemovedEvent
  | NodeUpdatedEvent
  | NodeMatchedEvent
  | TreeErrorEvent;
```

### TreeTracker Class Structure

```typescript
// src/utils/tree-tracker/index.ts

export class TreeTracker extends EventTarget {
  private config: TreeTrackerConfig;
  private tree: DOMTree | null;
  private nodeMap: Map<string, TrackedNode>;
  private observer: MutationObserver | null;
  private storage: TabStorage | null;

  // Batching state (double-RAF)
  private pendingMutations: MutationRecord[];
  private rafId: number | null;
  private isProcessing: boolean;

  // Grace period tracking
  private pendingRemovals: Map<string, number>; // nodeId -> timestamp
  private gracePeriodTimeouts: Map<string, number>; // nodeId -> timeout handle

  // === Lifecycle ===

  constructor(config?: Partial<TreeTrackerConfig>);

  async start(container?: HTMLElement | Document): Promise<DOMTree>;
  stop(): void;

  // === Tree Access ===

  getTree(): DOMTree | null;
  getNode(id: string): TreeNode | null;
  getElement(id: string): HTMLElement | null;
  getAllNodes(): TreeNode[];

  // === Element Actions ===

  clickElement(id: string): Promise<{ success: boolean; error?: string }>;
  setInputValue(id: string, value: string): Promise<{ success: boolean }>;
  toggleCheckbox(id: string, checked?: boolean): Promise<{ success: boolean }>;
  setSelectValue(id: string, value: string): Promise<{ success: boolean }>;
  scrollToElement(id: string): Promise<{ success: boolean }>;

  // === Events ===

  on<T extends TreeTrackerEventType>(type: T, handler: EventListener): void;
  off<T extends TreeTrackerEventType>(type: T, handler: EventListener): void;

  // === Internal ===

  private handleMutations(mutations: MutationRecord[]): void;
  private processMutationBatch(): Promise<void>;
  private detectReRenderedNodes(
    removed: Set<string>,
    added: Set<HTMLElement>
  ): Map<string, HTMLElement>;
  private startGracePeriod(nodeId: string): void;
  private resolveGracePeriods(): void;
  private buildInitialTree(): DOMTree;
  private emitEvent(event: TreeTrackerEvent): void;
}
```

### Key Algorithm: Mutation Processing with Grace Periods

```typescript
private async processMutationBatch(): Promise<void> {
  if (this.isProcessing) return;
  this.isProcessing = true;

  const mutations = this.pendingMutations;
  this.pendingMutations = [];

  try {
    // 1. Collect removed and added elements
    const removedNodeIds = new Set<string>();
    const addedElements = new Set<HTMLElement>();
    const updatedElements = new Set<HTMLElement>();

    for (const mutation of mutations) {
      // ... collect from mutation.removedNodes, addedNodes, characterData
    }

    // 2. Match added elements against removed fingerprints (detect re-renders)
    const reRenderedMatches = this.detectReRenderedNodes(removedNodeIds, addedElements);

    // 3. Process re-rendered nodes (update reference, emit node-matched)
    for (const [nodeId, element] of reRenderedMatches) {
      removedNodeIds.delete(nodeId);
      addedElements.delete(element);

      const tracked = this.nodeMap.get(nodeId);
      if (tracked) {
        tracked.ref = new WeakRef(element);
        tracked.status = 'active';

        // Update fingerprint with new element state
        const newFingerprint = updateFingerprint(tracked.node.fingerprint, element, confidence);
        tracked.node.fingerprint = newFingerprint;
        tracked.node.label = extractLabel(element);

        this.emitEvent({
          type: 'node-matched',
          nodeId,
          confidence,
          changes: { label: tracked.node.label }
        });
      }
    }

    // 4. Start grace period for truly removed nodes (don't emit yet)
    for (const nodeId of removedNodeIds) {
      this.startGracePeriod(nodeId);
    }

    // 5. Process truly new nodes (add to tree, emit node-added)
    for (const element of addedElements) {
      // Find parent, create TreeNode, add to tree
      // ...
      this.emitEvent({
        type: 'node-added',
        node,
        parentId,
        index
      });
    }

    // 6. Process updated nodes (emit node-updated)
    for (const element of updatedElements) {
      // ...
    }

  } finally {
    this.isProcessing = false;
  }
}

private detectReRenderedNodes(
  removedNodeIds: Set<string>,
  addedElements: Set<HTMLElement>
): Map<string, HTMLElement> {
  const matches = new Map<string, HTMLElement>();

  // Collect fingerprints from removed nodes
  const removedFingerprints: ElementFingerprint[] = [];
  for (const nodeId of removedNodeIds) {
    const tracked = this.nodeMap.get(nodeId);
    if (tracked) {
      removedFingerprints.push(tracked.node.fingerprint);
    }
  }

  // For each added element, try to match against removed fingerprints
  for (const element of addedElements) {
    const match = findBestMatch(
      removedFingerprints.find(fp => fp.tagName === element.tagName.toLowerCase()),
      [element],
      this.config.weights,
      this.config.confidenceThreshold
    );

    if (match && match.confidence >= this.config.confidenceThreshold) {
      matches.set(match.fingerprint.id, element);
    }
  }

  return matches;
}

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
      } else {
        // Reappeared - restore
        tracked.ref = new WeakRef(element);
        tracked.status = 'active';
      }
    }
  }, this.config.gracePeriodMs);

  this.gracePeriodTimeouts.set(nodeId, handle);
}
```

### Content Script Integration

```typescript
// src/entrypoints/content.ts

import { TreeTracker } from '../utils/tree-tracker';

let tracker: TreeTracker | null = null;

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    // Initialize TreeTracker
    tracker = new TreeTracker({
      confidenceThreshold: 0.6,
      gracePeriodMs: 150,
      maxNodes: 5000,
      debugMode: false,
    });

    // Forward events to sidebar via messages
    tracker.on('tree-initialized', (event) => {
      sendMessage({ type: 'TREE_INITIALIZED', tree: event.detail.tree });
    });

    tracker.on('node-added', (event) => {
      sendMessage({
        type: 'NODE_ADDED',
        node: event.detail.node,
        parentId: event.detail.parentId,
        index: event.detail.index,
      });
    });

    tracker.on('node-removed', (event) => {
      sendMessage({ type: 'NODE_REMOVED', nodeId: event.detail.nodeId });
    });

    tracker.on('node-updated', (event) => {
      sendMessage({
        type: 'NODE_UPDATED',
        nodeId: event.detail.nodeId,
        changes: event.detail.changes,
      });
    });

    tracker.on('node-matched', (event) => {
      sendMessage({
        type: 'NODE_MATCHED',
        nodeId: event.detail.nodeId,
        confidence: event.detail.confidence,
        changes: event.detail.changes,
      });
    });

    // Handle messages from sidebar
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'SCAN_TREE':
          tracker?.start().then((tree) => sendResponse({ tree }));
          return true;

        case 'CLICK_ELEMENT':
          tracker?.clickElement(message.id).then(sendResponse);
          return true;

        case 'SET_INPUT_VALUE':
          tracker?.setInputValue(message.id, message.value).then(sendResponse);
          return true;

        // ... other actions
      }
    });
  },
});
```

### Sidebar Store Updates

```typescript
// src/entrypoints/sidepanel/stores/dom-tree.svelte.ts

// Add handler for NODE_MATCHED (re-render detected)
export function handleNodeMatched(
  nodeId: string,
  confidence: number,
  changes: Partial<TreeNode>
): void {
  if (!tree) return;

  const node = findNodeById(tree.root, nodeId);
  if (node) {
    Object.assign(node, changes);
    version++;

    console.log(
      `[Klaro] Node re-matched with ${(confidence * 100).toFixed(0)}% confidence:`,
      node.label
    );
  }
}
```

## Implementation Plan

### Phase 1: Create TreeTracker Module (COMPLETED)

1. [x] Create `src/utils/tree-tracker/types.ts` with all type definitions
2. [x] Create `src/utils/tree-tracker/tree-builder.ts` - extract tree building from dom-tree-scanner.ts
3. [x] Create `src/utils/tree-tracker/index.ts` with TreeTracker class skeleton
4. [x] Implement `start()` - initial tree scan with fingerprinting
5. [x] Implement `stop()` - cleanup observers and timers

### Phase 2: Mutation Handling with Grace Periods (COMPLETED)

1. [x] Implement MutationObserver with double-RAF batching
2. [x] Implement `processMutationBatch()` - collect added/removed/updated
3. [x] Implement `detectReRenderedNodes()` - use matcher module for fuzzy matching
4. [x] Implement `startGracePeriod()` and timeout handling
5. [x] Implement event emission for all tree changes

### Phase 3: Element Actions (COMPLETED)

1. [x] Implement `getElement(id)` - resolve WeakRef with re-identification fallback
2. [x] Implement `clickElement()`, `setInputValue()`, `toggleCheckbox()`, `setSelectValue()`
3. [x] Implement `scrollToElement()` with highlight

### Phase 4: Content Script Integration (COMPLETED)

1. [x] Replace ElementTracker initialization with TreeTracker
2. [x] Remove old tree sync code (MutationObserver, processPendingMutations)
3. [x] Forward TreeTracker events to sidebar via messages
4. [x] Update message handlers for element actions

### Phase 5: Sidebar Updates (COMPLETED)

1. [x] Add `NODE_MATCHED` message handler to App.svelte
2. [x] Update dom-tree store with `handleNodeMatched()` method (handled via updateNode)
3. [x] Keep backwards compatibility with ELEMENT_MATCHED for LLM integration
4. [x] Build verification passed

### Phase 6: Cleanup & Documentation (PENDING)

1. [ ] Mark ElementTracker as deprecated with migration notes
2. [ ] Mark dom-tree-scanner.ts as deprecated
3. [ ] Add JSDoc comments to TreeTracker public API
4. [ ] Update CLAUDE.md with new architecture

## Test Plan

### Unit Tests

- [ ] TreeTracker initializes correctly and builds tree
- [ ] Fingerprint matching detects re-renders with >60% confidence
- [ ] Grace period prevents premature node removal
- [ ] Double-RAF batching coalesces rapid mutations
- [ ] Element actions (click, setValue) resolve correct elements

### Integration Tests

- [ ] React component re-render: element stays in tree
- [ ] Dynamic list: items added/removed correctly tracked
- [ ] Form input: value changes synced to sidebar
- [ ] Modal open/close: modal detection works
- [ ] Page navigation: tree resets correctly

### Manual Testing

- [ ] Test on React SPA (e.g., the test-site with dynamic CTA)
- [ ] Test rapid button clicks that update labels
- [ ] Test form with dynamic validation messages
- [ ] Test infinite scroll / virtualized list
- [ ] Test modal dialogs

## Decision Log

| Decision                                                | Rationale                                                            | Date       |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ---------- |
| Unified TreeTracker replaces ElementTracker + tree sync | Eliminates code duplication, single source of truth for DOM tracking | 2025-01-31 |
| Track all visible nodes (up to 5000)                    | User needs full page structure, not just interactive elements        | 2025-01-31 |
| No LLM enhancement during live updates                  | Performance concern; batch enhancement on initial scan only          | 2025-01-31 |
| New class vs. extending ElementTracker                  | Clean slate avoids complexity; ElementTracker can be deprecated      | 2025-01-31 |
| Clean break on events (no backwards compat)             | Sidebar code is small, updating all handlers is manageable           | 2025-01-31 |
| 150ms grace period (vs ElementTracker's 100ms)          | Slightly longer to handle slower React reconciliation                | 2025-01-31 |
| Reuse matcher.ts, fingerprint.ts, similarity.ts         | Proven, tested code; no need to rewrite                              | 2025-01-31 |
