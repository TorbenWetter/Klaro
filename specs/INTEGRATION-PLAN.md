# Sidebar Integration Plan: ElementTracker + Existing Sidebar

## Overview

This document details how to integrate the newly implemented ElementTracker system with the existing sidebar implementation from teammates.

---

## Current State Analysis

### Sidebar Expectations (`App.svelte`)

The sidebar has two modes: **READ** and **ACCESSIBLE**.

**ACCESSIBLE mode** (lines 212-251) iterates over `pageCopy` and renders three block types:

```svelte
{#each pageCopy as block, i (i)}
  {#if block.type === 'heading'}
    <h ...>{block.text}</h>
  {:else if block.type === 'text'}
    <p ...>{block.content}</p>
  {:else if block.type === 'action'}
    <button onclick={() => handleActionClick(block.id)}>
      {block.text}
    </button>
  {/if}
{/each}
```

**Key expectation**: `pageCopy` must contain **headings, text, AND actions interleaved in document order**.

### Content Script Response (`content.ts`)

Currently returns (lines 68-81):

```typescript
const content = scanPageContent(); // pageCopy has NO actions
const actions = trackedToActions(tracker.getTrackedElements()); // Separate array

sendResponse({
  ...content, // { article, headings, pageCopy (no actions) }
  actions, // Flat array, not in document order
});
```

**Problem**: Actions are returned separately, NOT interleaved in `pageCopy`. The sidebar receives:

- `pageCopy` = `[heading, text, heading, text, ...]` (no actions)
- `actions` = `[{id, tag, text}, ...]` (flat array, no document order)

### DOM Scanner Gap (`dom-scanner.ts`)

Two functions exist:

1. **`scanPage()`** (lines 97-225): Original function that DOES include actions in `pageCopy` with random `data-acc-id`
2. **`scanPageContent()`** (lines 250-333): My new function that EXCLUDES actions from `pageCopy`

The new function was designed to separate concerns (actions from ElementTracker, content from scanner), but this broke the document-order interleaving.

---

## Root Cause

The sidebar expects `pageCopy` to be a **complete, document-ordered stream** of headings, text, and actions. My implementation separated actions into their own array, breaking this contract.

---

## Integration Solution

### Approach: Merge Tracked Elements into pageCopy in Document Order

Instead of returning actions separately, we need to **walk the DOM once** and build `pageCopy` with:

- Headings from native HTML elements
- Text blocks from paragraphs/lists
- Actions from **ElementTracker's fingerprinted elements** (not random IDs)

### Implementation Steps

#### Step 1: Create a New Function `scanPageWithTracker()`

Location: `src/utils/dom-scanner.ts`

```typescript
/**
 * Scans page content and interleaves tracked actions in document order.
 * Uses ElementTracker fingerprint IDs for stable element references.
 */
export function scanPageWithTracker(
  trackedElements: Map<HTMLElement, string> // element -> fingerprint ID
): ScanResult {
  // Walk DOM once, building pageCopy with interleaved actions
  // When we encounter an interactive element:
  //   - Check if it's in trackedElements map
  //   - If yes, use the fingerprint ID
  //   - If no, skip (or add with temporary ID)
}
```

#### Step 2: Update Content Script

Location: `src/entrypoints/content.ts`

```typescript
if (message.type === 'SCAN_PAGE') {
  // Build element -> ID map from tracker
  const trackedMap = new Map<HTMLElement, string>();
  for (const tracked of tracker.getTrackedElements()) {
    if (tracked.status !== 'lost') {
      const el = tracker.getElementById(tracked.fingerprint.id);
      if (el) trackedMap.set(el, tracked.fingerprint.id);
    }
  }

  // Scan with tracker-aware function
  const result = scanPageWithTracker(trackedMap);
  sendResponse(result);
}
```

#### Step 3: Keep `actions` Array for Compatibility

The sidebar also uses `actions` for LLM summarization (line 62):

```typescript
const { summary } = await getLLMSimplification(article, actions);
```

So we need to return both:

- `pageCopy`: Complete stream with interleaved actions (for ACCESSIBLE mode)
- `actions`: Flat array of all actions (for LLM summarization)

---

## Detailed Code Changes

### 1. New Types (no changes needed)

The existing `PageBlock` union type already supports actions:

```typescript
export type PageBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'text'; content: string }
  | { type: 'action'; id: string; tag: string; text: string };
```

### 2. New Function: `scanPageWithTracker()`

```typescript
// dom-scanner.ts

/**
 * Scans page content with ElementTracker integration.
 * Returns pageCopy with actions interleaved in document order.
 *
 * @param trackedElements Map of DOM elements to their fingerprint IDs
 */
export function scanPageWithTracker(
  trackedElements: Map<HTMLElement, string>
): ScanResult {
  // Article extraction (unchanged)
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const parsed = reader.parse();
  const article: ArticleResult | null = parsed ? { ... } : null;

  // Headings array (unchanged)
  const headings: ScannedHeading[] = [];
  // ... existing heading walker ...

  // Actions array (from trackedElements)
  const actions: ScannedAction[] = [];
  for (const [element, id] of trackedElements) {
    actions.push({
      id,
      tag: element.tagName.toLowerCase(),
      text: getElementLabel(element).slice(0, 50),
    });
  }

  // === NEW: Build pageCopy with interleaved actions ===
  const pageCopy: PageBlock[] = [];

  const copyWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement;
        const tag = el.tagName?.toLowerCase();
        if (!tag || el.offsetParent === null) return NodeFilter.FILTER_SKIP;

        // Headings
        if (tag.match(/^h[1-6]$/)) {
          const t = (el.textContent ?? '').trim();
          return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }

        // Interactive elements (if tracked)
        if (trackedElements.has(el)) {
          return NodeFilter.FILTER_ACCEPT;
        }

        // Text blocks
        if (TEXT_BLOCK_TAGS.has(tag)) {
          const t = (el.textContent ?? '').trim();
          return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  while (copyWalker.nextNode()) {
    const el = copyWalker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag.match(/^h[1-6]$/)) {
      pageCopy.push({
        type: 'heading',
        level: parseInt(tag.slice(1), 10),
        text: (el.textContent ?? '').trim().slice(0, 200),
      });
      continue;
    }

    // Check if it's a tracked interactive element
    const fingerprintId = trackedElements.get(el);
    if (fingerprintId) {
      pageCopy.push({
        type: 'action',
        id: fingerprintId,
        tag,
        text: getElementLabel(el).slice(0, 80),
      });
      continue;
    }

    if (TEXT_BLOCK_TAGS.has(tag)) {
      pageCopy.push({
        type: 'text',
        content: (el.textContent ?? '').trim().slice(0, 2000),
      });
    }
  }

  return { article, headings, actions, pageCopy };
}
```

### 3. Update Content Script

```typescript
// content.ts

import { scanPageWithTracker } from '../utils/dom-scanner';

// In SCAN_PAGE handler:
if (message.type === 'SCAN_PAGE') {
  try {
    // Build element -> fingerprint ID map
    const trackedMap = new Map<HTMLElement, string>();

    if (tracker) {
      for (const tracked of tracker.getTrackedElements()) {
        if (tracked.status !== 'lost') {
          const el = tracker.getElementById(tracked.fingerprint.id);
          if (el) {
            trackedMap.set(el, tracked.fingerprint.id);
          }
        }
      }
    }

    // Scan with tracker integration
    const result = scanPageWithTracker(trackedMap);
    sendResponse(result);
  } catch (e) {
    sendResponse({
      article: null,
      headings: [],
      actions: [],
      pageCopy: [],
      error: e instanceof Error ? e.message : 'Scan failed',
    });
  }
  return;
}
```

### 4. Remove Old `scanPageContent()` Function

Delete `scanPageContent()` (lines 250-333) since it's replaced by `scanPageWithTracker()`.

---

## Benefits of This Approach

1. **Preserves Document Order**: Actions appear in `pageCopy` exactly where they occur in the DOM
2. **Uses Stable IDs**: Fingerprint IDs survive framework re-renders (unlike random `data-acc-id`)
3. **Single DOM Walk**: Efficient - scans once instead of twice
4. **Backward Compatible**: Still returns `actions` array for LLM summarization
5. **Clean Separation**: ElementTracker handles identity, scanner handles extraction

---

## Additional Sidebar Enhancements (Optional)

### A. Show Confidence Scores

The `ScannedAction` type could be extended:

```typescript
export interface ScannedAction {
  id: string;
  tag: string;
  text: string;
  confidence?: number; // NEW: 0-1 from ElementTracker
  status?: 'active' | 'searching' | 'lost'; // NEW
}
```

Sidebar could then show:

- Gray out low-confidence buttons
- Show "searching..." state during re-identification
- Hide or disable lost elements

### B. Real-time Updates

The sidebar already listens for `PAGE_UPDATED` messages (line 89):

```typescript
if (msg?.type === 'PAGE_UPDATED') scanCurrentTab();
```

This will automatically refresh when ElementTracker emits `elements-updated`.

### C. Debug Mode Toggle

Add a button to toggle debug overlay:

```svelte
<button onclick={() => sendDebugMode(!debugEnabled)}>
  Debug: {debugEnabled ? 'ON' : 'OFF'}
</button>
```

---

## Migration Checklist

- [ ] Add `scanPageWithTracker()` to `dom-scanner.ts`
- [ ] Update content script to use `scanPageWithTracker()`
- [ ] Remove old `scanPageContent()` function
- [ ] Test ACCESSIBLE mode shows interleaved actions
- [ ] Test clicks work with fingerprint IDs
- [ ] Test actions survive DOM mutations (text rotation, shuffle)
- [ ] Verify LLM summarization still receives actions

---

## Test Scenarios

1. **Initial Load**: Actions appear in document order in sidebar
2. **CTA Text Rotation**: Button text changes, but same fingerprint ID, still clickable
3. **Sponsor Shuffle**: Complete DOM reconstruction, actions re-identified and clickable
4. **Modal Open/Close**: Form elements appear/disappear correctly
5. **Tab Switching**: State persisted via chrome.storage.session
6. **Page Reload**: Fresh tracking starts, actions appear correctly

---

## Files to Modify

| File                               | Changes                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `src/utils/dom-scanner.ts`         | Add `scanPageWithTracker()`, remove `scanPageContent()` |
| `src/entrypoints/content.ts`       | Use `scanPageWithTracker()` with tracker map            |
| `src/utils/dom-scanner.ts` (types) | Optionally extend `ScannedAction` with confidence       |

---

## Timeline

1. **Phase 1**: Implement `scanPageWithTracker()` and update content script
2. **Phase 2**: Test with test-site (all mutation scenarios)
3. **Phase 3**: Optional enhancements (confidence display, debug toggle)
