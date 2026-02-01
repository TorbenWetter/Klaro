# Feature: Show All Text Content in Sidebar

> Replace LLM-based semantic grouping with a pure DOM tree view that shows all text content without filtering or reordering.

## Overview

Currently, Klaro filters out long text content (>200 chars) and uses LLM to reorganize page elements into semantic groups. Users want to see **all** text content from the page in its **original DOM hierarchy**, without AI-driven restructuring.

This feature will:

1. Remove character length limits that filter out long text
2. Replace GroupView with TreeView as the default sidebar view
3. Disable LLM semantic grouping
4. Keep LLM for a new purpose: generating CSS overrides based on user accessibility preferences

## Requirements

### Functional Requirements

- [ ] FR1: All visible text content from the page must appear in the sidebar
- [ ] FR2: Text elements must preserve their original DOM hierarchy/order
- [ ] FR3: No character length limits on displayed text (show full content)
- [ ] FR4: Interactive elements (buttons, links, inputs) appear inline at their DOM position
- [ ] FR5: TreeView component becomes the default and only view
- [ ] FR6: LLM semantic grouping is disabled/removed
- [ ] FR7: LLM is repurposed to generate CSS overrides based on user preferences

### Non-Functional Requirements

- [ ] NFR1: Performance - Sidebar must render within 2 seconds for pages with up to 5000 nodes
- [ ] NFR2: Memory - No memory leaks from holding large text content
- [ ] NFR3: Accessibility - Sidebar itself must be keyboard navigable

## User Experience

### User Flows

1. **Primary Flow: View Page Content**
   - User opens sidepanel on any webpage
   - Content script scans DOM and builds tree
   - TreeView displays all elements in DOM order
   - User scrolls through full page content in sidebar
   - User can interact with buttons/links/inputs directly

2. **Alternative Flow: Apply Accessibility Styles**
   - User has configured preferences (font size, colors, etc.)
   - LLM generates CSS overrides based on preferences
   - Styles are injected into the page
   - Sidebar reflects styled content

### UI States

- **Loading:** Skeleton loader while scanning (existing behavior)
- **Content:** TreeView with collapsible hierarchy
- **Empty:** Message when page has no content
- **Error:** Message when page cannot be scanned

### Edge Cases

| Scenario                       | Expected Behavior                          |
| ------------------------------ | ------------------------------------------ |
| Very long text (10k+ chars)    | Show full text, browser handles scrolling  |
| Deeply nested DOM (50+ levels) | Show all levels, collapsible for usability |
| Page with only images          | Show media elements with alt text          |
| Dynamic content changes        | Update tree via existing mutation observer |
| Empty text nodes               | Skip nodes with only whitespace            |

## Technical Design

### Affected Components

| File                                                       | Changes                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `src/entrypoints/sidepanel/App.svelte`                     | Switch from GroupView to TreeView, remove LLM grouping calls    |
| `src/utils/tree-tracker/tree-builder.ts`                   | Remove 200-char text limit, remove meaningless label filtering  |
| `src/utils/llm-service.ts`                                 | Remove `generateSemanticGroups()`, add `generateCssOverrides()` |
| `src/entrypoints/sidepanel/components/GroupView.svelte`    | Can be deleted or kept for future use                           |
| `src/entrypoints/sidepanel/stores/semantic-tree.svelte.ts` | Simplify to pure tree storage, remove grouping logic            |
| `src/config.ts`                                            | Remove LLM grouping config, add CSS generation config           |

### Changes to tree-builder.ts

```typescript
// REMOVE: extractLabel() line 379-384 - the 200-char limit
// BEFORE:
if (fullText && fullText.length > 0 && fullText.length < 200) {
  return normalizeText(fullText, 100);
}

// AFTER:
if (fullText && fullText.length > 0) {
  return fullText.trim(); // No truncation
}

// REMOVE: normalizeText() truncation - keep whitespace normalization only
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
  // Remove: .slice(0, maxLength)
}

// REMOVE: meaninglessLabels filtering (lines 943-974)
// REMOVE: isTagLabel/isGenericLabel checks (lines 976-1000)
// Keep shouldSkipElement() but only for truly hidden elements
```

### Changes to App.svelte

```typescript
// REMOVE: Import and usage of GroupView
// REMOVE: Call to generateSemanticGroups()
// REMOVE: semanticTreeStore grouping methods

// ADD: Direct use of TreeView with tree from content script
import TreeView from './components/TreeView.svelte';

// In performScan():
async function performScan(tabId: number): Promise<void> {
  const response = await browser.tabs.sendMessage(tabId, { type: 'SCAN_TREE' });
  if (response.error || !response.tree) {
    // handle error
    return;
  }
  // Store tree directly, no LLM processing
  treeStore.setTree(response.tree);
}
```

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Content Script  │────▶│  Tree Builder    │────▶│  TreeView   │
│ (DOM scanning)  │     │ (no filtering)   │     │ (display)   │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

### Dependencies

- **Existing**: TreeView component, tree-builder utilities, content script scanning
- **Remove**: semantic-tree.svelte.ts grouping logic, GroupView component usage

### Exclusions

Elements injected by Klaro itself (Leichte Sprache feature) must be excluded from the DOM tree:

- `.klaro-mark`, `.klaro-badge`, `.klaro-tooltip`
- `.klaro-simplified`, `.klaro-simplified-badge`
- Any element with class starting with `klaro-`

## Implementation Plan

### Phase 1: Remove Text Filtering

1. [x] Remove 200-char limit in `extractLabel()` (tree-builder.ts:379-384)
2. [x] Remove `maxLength` parameter from `normalizeText()`
3. [x] Remove meaningless label filtering (tree-builder.ts:943-1000)
4. [x] Keep only visibility-based filtering (hidden elements)
5. [x] Test that all text elements now appear in tree

### Phase 2: Switch to TreeView

1. [x] Update App.svelte to import TreeView instead of GroupView
2. [x] Remove `generateSemanticGroups()` call from `performScan()`
3. [x] Simplify store to hold raw tree without grouping
4. [x] Update template to render TreeView with full tree
5. [x] Test that sidebar shows DOM hierarchy correctly

### Phase 3: Clean Up LLM Grouping

1. [x] Remove `generateSemanticGroups()` from llm-service.ts
2. [x] Remove grouping-related prompts and types
3. [x] Remove unused semantic-tree store methods (file is now dead code)
4. [x] Update config.ts to remove grouping settings

### Phase 4: Exclude Klaro-Injected Elements

1. [x] Add klaro-\* class exclusion to tree-builder.ts
2. [x] Test that Leichte Sprache badges don't appear in sidebar

### Phase 5: Sidebar Styling (Future - see separate spec)

1. [ ] Design LLM prompt for sidebar styling based on user preferences
2. [ ] Implement styled TreeView rendering
3. [ ] Connect to user preferences/onboarding system

## Test Plan

### Unit Tests

- [ ] `normalizeText()` returns full text without truncation
- [ ] `extractLabel()` handles text of any length
- [ ] Tree building includes all visible text nodes
- [ ] Hidden elements are still excluded

### Integration Tests

- [ ] Sidebar shows all paragraphs from a long article
- [ ] DOM hierarchy preserved (parent-child relationships)
- [ ] Interactive elements clickable at correct positions
- [ ] Page mutations update tree correctly

### Manual Testing

- [ ] Test on Wikipedia article (long content)
- [ ] Test on Amazon product page (mixed content)
- [ ] Test on GitHub repo page (code + text)
- [ ] Test on news site (articles with many paragraphs)
- [ ] Verify no performance degradation on large pages

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                     | Rationale                                             | Date       |
| ---------------------------- | ----------------------------------------------------- | ---------- |
| Remove LLM grouping entirely | User prefers DOM hierarchy over AI organization       | 2026-02-01 |
| Show full text, no limits    | Accessibility requires complete content access        | 2026-02-01 |
| No performance optimization  | User accepts potential slowness for simplicity        | 2026-02-01 |
| TreeView as default          | Simpler, preserves hierarchy, existing component      | 2026-02-01 |
| Sidebar styling only         | LLM styles sidebar, NOT the original page             | 2026-02-01 |
| Exclude klaro-\* elements    | Leichte Sprache badges are Klaro UI, not page content | 2026-02-01 |
