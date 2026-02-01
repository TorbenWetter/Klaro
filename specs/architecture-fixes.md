# Feature: Architecture Fixes & Hardening

> Resolve 20 identified issues across TreeTracker, semantic tree store, LLM service, and message passing to harden the Klaro extension for production use.

## Overview

During code review, 20 issues were identified ranging from critical race conditions to minor code quality concerns. This specification defines the fixes for all issues in a single comprehensive phase, organized by component for implementation clarity.

## Requirements

### Functional Requirements

- [ ] FR1: Sidepanel waits for `TREE_SCANNED` message before requesting tree data (race condition fix)
- [ ] FR2: TreeTracker is the single source of truth for element deduplication (unified 0.6 threshold)
- [ ] FR3: Semantic tree store implements LRU eviction with max 500 elements and timestamp-based cleanup
- [ ] FR4: Modal overlay detection triggers when dialogs appear in the DOM
- [ ] FR5: All message handlers use consistent async/await pattern with proper return values
- [ ] FR6: LLM calls are debounced per-element (500ms) to prevent duplicate enhancement requests
- [ ] FR7: Configuration constants centralized in single `src/config.ts` file
- [ ] FR8: Element→ID reverse lookup uses WeakMap for O(1) performance

### Non-Functional Requirements

- [ ] NFR1: No memory leaks - elements cleaned from store within reasonable bounds
- [ ] NFR2: All debug logging removed from production code
- [ ] NFR3: Console error messages have consistent formatting
- [ ] NFR4: Modal state properly isolated via deep clone (structuredClone)
- [ ] NFR5: Store mutations use helper functions to prevent missed reactivity triggers

## Decision Log

| Decision                       | Rationale                                             | Date       |
| ------------------------------ | ----------------------------------------------------- | ---------- |
| Skip LLM caching               | Complexity not justified for current usage patterns   | 2026-02-01 |
| LRU with max 500 elements      | Balance between memory and re-render handling         | 2026-02-01 |
| TreeTracker-only deduplication | Single source of truth, sidebar trusts content script | 2026-02-01 |
| Console-only error logging     | Keep simple, no external dependencies                 | 2026-02-01 |
| Implement modal detection      | Feature was designed but not wired up                 | 2026-02-01 |
| Remove all debug logs          | Clean production output                               | 2026-02-01 |
| Event-driven init sync         | Sidepanel waits for tree-ready signal                 | 2026-02-01 |
| No LLM retries                 | Fast fallback preferred over latency                  | 2026-02-01 |
| Async/await message handlers   | Cleaner code, proper response handling                | 2026-02-01 |
| Single config file             | One source of truth for all constants                 | 2026-02-01 |
| WeakMap for element→ID         | O(1) lookup, memory-safe                              | 2026-02-01 |
| 500ms debounce for LLM         | Prevent duplicate calls on rapid updates              | 2026-02-01 |
| structuredClone for modal      | Proper state isolation                                | 2026-02-01 |
| Mutation helpers for stores    | Prevent missed reactivity triggers                    | 2026-02-01 |
| Timestamp-based LRU            | True LRU instead of LIFO                              | 2026-02-01 |
| All fixes in one phase         | Comprehensive fix, single PR                          | 2026-02-01 |

## Technical Design

### Issue Mapping

| #   | Issue                               | Severity      | Component           | Fix                            |
| --- | ----------------------------------- | ------------- | ------------------- | ------------------------------ |
| 1   | Race condition: tree not ready      | Critical      | App.svelte          | Event-driven init              |
| 2   | Memory leak: elements never cleaned | Critical      | semantic-tree store | LRU with max size              |
| 3   | Duplicate LLM calls on new elements | Critical      | content.ts          | Remove ELEMENT_FOUND, debounce |
| 4   | Fingerprint threshold mismatch      | Critical      | semantic-tree store | Remove sidebar dedup           |
| 5   | Async handler returns undefined     | Critical      | content.ts          | Refactor to async/await        |
| 6   | No LLM rate limiting                | Moderate      | llm-service         | Debounce per-element           |
| 7   | LLM short ID collision              | Moderate      | llm-service         | Increase to 12 chars           |
| 8   | Grace period vs LLM latency         | Moderate      | N/A                 | Document limitation            |
| 9   | restoreExpandStates not awaited     | Moderate      | semantic-tree store | Add await                      |
| 10  | Modal overlay never triggered       | Moderate      | tree-tracker        | Add modal detection            |
| 11  | getElementId is O(n)                | Moderate      | tree-tracker        | WeakMap index                  |
| 12  | Debug logging in production         | Minor         | Multiple            | Remove all                     |
| 13  | Input listeners not cleaned         | Minor         | content.ts          | Document (WeakMap handles)     |
| 14  | Timeout races with double-RAF       | Minor         | tree-tracker        | Cancel timeout on RAF          |
| 15  | preModalTree shallow copy           | Minor         | semantic-tree store | structuredClone                |
| 16  | Type assertion without validation   | Minor         | App.svelte          | Add runtime check              |
| 17  | LRU is LIFO not LRU                 | Minor         | semantic-tree store | Timestamp tracking             |
| 18  | Dual deduplication logic            | Architectural | Multiple            | Single source in TreeTracker   |
| 19  | No LLM retry mechanism              | Architectural | llm-service         | Keep fast fallback (no change) |
| 20  | Mutable state with runes            | Architectural | semantic-tree store | Mutation helpers               |

### Affected Components

#### 1. `src/config.ts` (NEW)

Central configuration file consolidating all constants:

```typescript
// src/config.ts
export const CONFIG = {
  // Element tracking
  tracking: {
    confidenceThreshold: 0.6,
    gracePeriodMs: 150,
    maxNodes: 5000,
    maxDepth: 50,
  },

  // Semantic tree store
  store: {
    maxElements: 500,
    maxStoredUrls: 100,
    expandStateKey: 'klaro_expand_states',
  },

  // LLM service
  llm: {
    debounceMs: 500,
    shortIdLength: 12,
    maxTokensLabel: 256,
    maxTokensBatch: 4096,
    maxTokensGrouping: 8192,
    temperature: 0.2,
    groupingTemperature: 0.3,
  },

  // UI
  ui: {
    inputDebounceMs: 300,
    cooldownMs: 10000,
    urlChangeDebounceMs: 500,
  },
} as const;
```

#### 2. `src/utils/tree-tracker/index.ts`

**Changes:**

- Add `elementToId: WeakMap<HTMLElement, string>` for O(1) lookups
- Add modal detection logic (detect `role="dialog"` or `aria-modal="true"`)
- Emit `modal-opened` and `modal-closed` events
- Fix timeout/RAF race by clearing timeout when RAF fires
- Update to use centralized config

```typescript
// New fields
private elementToId: WeakMap<HTMLElement, string>;

// In populateNodeMap, add:
this.elementToId.set(element, node.id);

// New getElementId implementation:
getElementId(element: HTMLElement): string | null {
  return this.elementToId.get(element) ?? null;
}

// Modal detection in processMutationBatch:
private detectModalChanges(addedElements: Set<HTMLElement>): void {
  for (const el of addedElements) {
    if (this.isModalElement(el)) {
      this.emitEvent({ type: 'modal-opened', element: el });
    }
  }
}

private isModalElement(el: HTMLElement): boolean {
  return el.getAttribute('role') === 'dialog'
    || el.getAttribute('aria-modal') === 'true'
    || el.matches('[data-modal], .modal, [class*="modal"]');
}
```

#### 3. `src/entrypoints/content.ts`

**Changes:**

- Remove `ELEMENT_FOUND` message (duplicate of NODE_ADDED)
- Refactor all message handlers to async/await pattern
- Add modal event forwarding
- Remove debug console.log statements
- Update to use centralized config

```typescript
// Before (sync handler with async inside):
if (message.type === 'SCAN_TREE') {
  try {
    if (tracker) {
      const tree = tracker.getTree();
      // ... async logic
    }
  } catch (e) { ... }
  return true; // Indicate async
}

// After (clean async pattern):
async function handleMessage(message, sendResponse) {
  switch (message.type) {
    case 'SCAN_TREE':
      return handleScanTree(sendResponse);
    // ...
  }
}

async function handleScanTree(sendResponse) {
  if (!tracker) {
    sendResponse({ type: 'TREE_SCANNED', tree: null, error: 'Tracker not initialized' });
    return;
  }

  let tree = tracker.getTree();
  if (!tree) {
    tree = await tracker.start();
  }

  setTimeout(() => sendInitialStates(), 100);
  sendResponse({ type: 'TREE_SCANNED', tree });
}
```

#### 4. `src/entrypoints/sidepanel/App.svelte`

**Changes:**

- Wait for `TREE_SCANNED` message before requesting scan
- Remove duplicate NODE_ADDED handling that triggers LLM
- Add type validation for incoming messages
- Remove debug console.log statements

```typescript
// New initialization pattern
onMount(() => {
  // Listen for tree-ready signal FIRST
  const treeReadyListener = (message: any) => {
    if (message.type === 'TREE_SCANNED' && message.tree) {
      handleTreeReady(message.tree);
    }
  };
  browser.runtime.onMessage.addListener(treeReadyListener);

  // Request current tree (may already be ready)
  requestCurrentTree();
});

async function requestCurrentTree() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const response = await browser.tabs.sendMessage(tab.id, { type: 'SCAN_TREE' });
  if (response?.tree) {
    handleTreeReady(response.tree);
  }
  // If not ready, will receive TREE_SCANNED message when ready
}
```

#### 5. `src/entrypoints/sidepanel/stores/semantic-tree.svelte.ts`

**Changes:**

- Remove `findSemanticallySimilarElement()` - dedup now in TreeTracker only
- Add LRU eviction with max 500 elements and timestamp tracking
- Add mutation helper functions for Map operations
- Fix `restoreExpandStates()` to be awaited
- Use `structuredClone()` for preModalTree
- Update LRU storage to use timestamps
- Remove debug console.log statements

```typescript
// New types
interface ElementEntry {
  data: TrackedElementData;
  lastAccess: number;
}

interface ExpandStateEntry {
  collapsedIds: string[];
  lastAccess: number;
}

// Mutation helpers
function setElement(id: string, data: TrackedElementData): void {
  const entry: ElementEntry = { data, lastAccess: Date.now() };
  elements.set(id, entry);
  elements = new Map(elements); // Trigger reactivity
  evictIfNeeded();
}

function deleteElement(id: string): void {
  elements.delete(id);
  elements = new Map(elements);
}

function evictIfNeeded(): void {
  if (elements.size <= CONFIG.store.maxElements) return;

  // Sort by lastAccess, evict oldest
  const sorted = [...elements.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toEvict = sorted.slice(0, elements.size - CONFIG.store.maxElements);
  for (const [id] of toEvict) {
    elements.delete(id);
    removeElementFromGroups(tree!.groups, id);
  }
  elements = new Map(elements);
}

// Fixed modal state
export function enterModalOverlay(
  modalGroup: DisplayGroup,
  modalElements: Map<string, TrackedElementData>
): void {
  if (!tree) return;

  // Deep clone for proper isolation
  preModalTree = structuredClone(tree);
  // ... rest unchanged
}

// Fixed initialization
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

  rebuildIndex();
  await restoreExpandStates(); // Now awaited
  version++;
}
```

#### 6. `src/utils/llm-service.ts`

**Changes:**

- Add debounce wrapper for single element enhancement
- Increase short ID length from 8 to 12 characters
- Remove debug console.log statements
- Update to use centralized config

```typescript
import { CONFIG } from '../config';

// Debounce map for per-element enhancement
const enhancementDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();
const pendingEnhancements = new Map<string, (label: string) => void>();

export function enhanceElementLabelDebounced(
  element: TrackedElementData,
  pageTitle: string
): Promise<string> {
  return new Promise((resolve) => {
    const elementId = element.id;

    // Clear existing debounce
    const existing = enhancementDebounceMap.get(elementId);
    if (existing) {
      clearTimeout(existing);
    }

    // Store resolver
    pendingEnhancements.set(elementId, resolve);

    // Debounce
    const timeout = setTimeout(async () => {
      enhancementDebounceMap.delete(elementId);
      const resolver = pendingEnhancements.get(elementId);
      pendingEnhancements.delete(elementId);

      const label = await enhanceElementLabel(element, pageTitle);
      resolver?.(label);
    }, CONFIG.llm.debounceMs);

    enhancementDebounceMap.set(elementId, timeout);
  });
}

// Update ID length
function nodesToPrompt(nodes: DOMTreeNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const id = node.id.slice(0, CONFIG.llm.shortIdLength); // Now 12 chars
    // ...
  }
}
```

#### 7. `src/lib/schemas/semantic-groups.ts`

**Changes:**

- Update `llmResponseToDisplayGroups` to use 12-char IDs
- Remove debug console.log statements

```typescript
import { CONFIG } from '../../config';

export function llmResponseToDisplayGroups(
  response: LLMGroupingResponse,
  elementIds: string[]
): DisplayGroup[] {
  const shortToFullId = new Map<string, string>();
  for (const fullId of elementIds) {
    const shortId = fullId.slice(0, CONFIG.llm.shortIdLength);
    shortToFullId.set(shortId, fullId);
  }
  // ... rest unchanged, remove console.log statements
}
```

### Data Model Changes

#### ExpandStateStore (updated)

```typescript
interface ExpandStateEntry {
  collapsedIds: string[];
  lastAccess: number;
}

interface ExpandStateStore {
  [url: string]: ExpandStateEntry;
}
```

#### ElementEntry (new)

```typescript
interface ElementEntry {
  data: TrackedElementData;
  lastAccess: number;
}

// elements Map becomes:
let elements = $state<Map<string, ElementEntry>>(new Map());
```

### Message Changes

#### Removed Messages

- `ELEMENT_FOUND` - Redundant with NODE_ADDED

#### New Messages

- `MODAL_OPENED` - When modal dialog detected
- `MODAL_CLOSED` - When modal dialog removed

## Implementation Plan

### Phase 1: Foundation (All in One PR)

1. [ ] Create `src/config.ts` with all centralized constants
2. [ ] Update imports across all files to use centralized config
3. [ ] Add WeakMap index to TreeTracker for O(1) element→ID lookup
4. [ ] Fix timeout/RAF race condition in TreeTracker
5. [ ] Refactor content.ts message handlers to async/await pattern
6. [ ] Remove ELEMENT_FOUND message sending
7. [ ] Add modal detection to TreeTracker
8. [ ] Forward modal events from content script
9. [ ] Update App.svelte to wait for TREE_SCANNED before requesting
10. [ ] Add message type validation in App.svelte
11. [ ] Remove sidebar deduplication (findSemanticallySimilarElement)
12. [ ] Add mutation helpers to semantic-tree store
13. [ ] Implement LRU eviction with timestamps in semantic-tree store
14. [ ] Fix restoreExpandStates to be awaited
15. [ ] Use structuredClone for preModalTree
16. [ ] Update LRU storage to use timestamps
17. [ ] Add debounce wrapper for LLM element enhancement
18. [ ] Increase LLM short ID length to 12 characters
19. [ ] Remove all debug console.log statements
20. [ ] Clean up error message formatting
21. [ ] Wire up modal overlay in App.svelte

## Test Plan

### Unit Tests

- [ ] `src/config.ts` - Verify all constants are exported correctly
- [ ] TreeTracker WeakMap index - Verify O(1) lookup works
- [ ] TreeTracker modal detection - Verify dialog/aria-modal elements detected
- [ ] LRU eviction - Verify oldest elements evicted when limit exceeded
- [ ] Mutation helpers - Verify reactivity triggered on set/delete
- [ ] LLM debounce - Verify only one call made within debounce window
- [ ] Short ID mapping - Verify 12-char IDs map correctly

### Integration Tests

- [ ] Race condition fix - Open sidepanel immediately on navigation, verify no errors
- [ ] Modal overlay - Open modal on test site, verify sidebar switches to modal view
- [ ] Memory stability - Navigate through 10+ pages, verify element count bounded
- [ ] Message handling - Verify all message types processed without undefined responses

### Manual Testing

- [ ] Fresh install - Verify sidepanel loads correctly on first use
- [ ] Page navigation - Verify tree updates on URL change
- [ ] Modal dialogs - Verify modal content appears in sidebar
- [ ] Form filling - Verify form state syncs between page and sidebar
- [ ] Expand state - Verify collapsed groups persist across page reload
- [ ] Stress test - Open test-site with all challenges, verify stability

## Open Questions

_None - all questions resolved during discovery._

## Edge Cases

| Scenario                                     | Expected Behavior                                |
| -------------------------------------------- | ------------------------------------------------ |
| Sidepanel opened before content script ready | Wait for TREE_SCANNED, show loading state        |
| Modal inside modal                           | Treat innermost as active modal                  |
| 500+ elements on page                        | LRU evicts oldest, preserves recent interactions |
| Rapid element additions                      | Debounce coalesces into single LLM call          |
| LLM timeout during enhancement               | Return original label, no retry                  |
| Page unload during LLM call                  | Gracefully cancel, no errors                     |
| Storage quota exceeded                       | Evict oldest URLs until space available          |
