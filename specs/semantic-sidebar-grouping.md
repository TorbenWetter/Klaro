# Feature: Semantic Sidebar Grouping

> Replace DOM hierarchy mirroring with LLM-generated semantic groups for a cleaner, more stable sidebar experience.

## Overview

The current sidebar mirrors the DOM tree structure, which causes two problems:

1. **Deep nesting** - DOM hierarchy creates unnecessary visual depth
2. **Instability** - React/Vue re-renders change DOM structure, causing elements to "move" in the sidebar

This redesign introduces semantic grouping where the LLM organizes elements by purpose rather than position. Elements are tracked by fingerprint and stay in their semantic group regardless of DOM changes.

## Requirements

### Functional Requirements

- [ ] FR1: LLM generates semantic groups with meaningful names (e.g., "Navigation", "Account Actions")
- [ ] FR2: Groups use a hybrid approach - landmark-like top-level groups with LLM sub-groups within
- [ ] FR3: Nesting depth is contextual - LLM decides when nesting adds value (usually flat or 1-2 levels)
- [ ] FR4: Elements stay in their assigned group even when DOM structure changes
- [ ] FR5: New elements are placed by looking at display structure neighbors (not DOM parents)
- [ ] FR6: Orphan elements (no clear group) are placed in the nearest landmark-based group
- [ ] FR7: Empty groups remain as placeholders (elements may return)
- [ ] FR8: All meaningful text (headings, key paragraphs) appears alongside interactive elements
- [ ] FR9: Modal opens trigger overlay mode - modal content replaces sidebar temporarily
- [ ] FR10: Expand/collapse states persist per URL

### Non-Functional Requirements

- [ ] NFR1: Reuse existing fingerprint-based element tracking (no changes to core matching logic)
- [ ] NFR2: Keep current tracker timing (150ms grace period, 0.6 confidence threshold)
- [ ] NFR3: Full page context sent to LLM in one call for coherent grouping
- [ ] NFR4: Flat list fallback if LLM fails or times out

## Architecture

### Core Principle: No Shadow Tree

We decided against maintaining a parallel DOM hierarchy ("shadow tree") because:

1. Fingerprint's `ancestorPath` already captures landmark context
2. Semantic grouping shouldn't depend on DOM structure
3. For placing new elements, we look at **display structure neighbors** (which group are nearby elements in?) rather than DOM parents

### Data Structures

```typescript
// Primary: Display structure (source of truth)
interface DisplayGroup {
  id: string; // Client-generated UUID
  name: string; // LLM-generated name
  isExpanded: boolean;
  children: (DisplayGroup | ElementRef)[];
}

interface ElementRef {
  type: 'element';
  elementId: string; // Fingerprint ID
}

// Root structure
interface SemanticTree {
  groups: DisplayGroup[];
  version: number; // For reactivity
}

// Derived: Reverse lookup index (maintained automatically)
// Map<elementId, groupId> - rebuilt when display structure changes
```

### LLM Schema

```typescript
// Input to LLM (what we send)
interface LLMGroupingRequest {
  pageTitle: string;
  pageUrl: string;
  elements: Array<{
    id: string;            // Fingerprint ID
    type: string;          // 'button' | 'link' | 'input' | 'heading' | etc.
    label: string;         // Current/original label
    context: string;       // ancestorPath for landmark hints
  }>;
}

// Output from LLM (what we receive)
interface LLMGroupingResponse {
  groups: Array<{
    name: string;          // Human-readable group name
    children: Array<
      | { type: 'group'; name: string; children: Array<...> }  // Nested group
      | { type: 'element'; id: string; label?: string }        // Element with optional enhanced label
    >;
  }>;
}
```

### Element Placement Algorithm

When a new element appears after initial load:

```
1. Create fingerprint for new element
2. Get ancestorPath from fingerprint (contains landmark info)
3. Find DOM neighbors (previous/next siblings in actual DOM)
4. Check if any neighbors are tracked elements
5. If neighbor found in display structure:
   → Place new element in same group as neighbor
6. Else, use ancestorPath to find nearest landmark group:
   → Place at end of that group
7. Optionally: lightweight LLM call for label enhancement
```

## User Experience

### Visual Design

**Groups:**

- Collapsible sections with chevron indicator
- Click anywhere on group header to toggle expand/collapse
- Quick transition animation (100-150ms)
- No count badges - keep minimal

**Elements:**

- Well-designed interactive elements (buttons, inputs, etc.)
- Inputs are functional with bi-directional sync (existing feature)
- Type-specific icons for visual distinction
- Indentation to show hierarchy within groups

**No features for MVP:**

- No search/filter
- No manual drag-and-drop reorganization
- No focus indicator for current element
- No group descriptions (names should be self-explanatory)

### User Flows

**Initial Page Load:**

1. Scan DOM, create fingerprints for all meaningful elements
2. Send full element list to LLM with page context
3. LLM returns semantic grouping structure
4. Generate client-side UUIDs for each group
5. Build display structure and reverse-lookup index
6. Render sidebar with all groups expanded (or restore from URL-based state)

**Element State Change (e.g., input value):**

1. User types in sidebar input
2. Bi-directional sync updates actual DOM element
3. Element stays in same group (no structural change)

**DOM Mutation (React re-render):**

1. MutationObserver detects change
2. Element's DOM reference lost → grace period starts
3. Fingerprint matching finds element at new location
4. Element keeps its display structure position (stays in group)
5. Only element data updates if needed (label, state)

**New Element Appears:**

1. MutationObserver detects new element
2. Create fingerprint, check if meaningful
3. Use placement algorithm (neighbor lookup → landmark fallback)
4. Add to appropriate group in display structure
5. Optional: LLM call for label enhancement

**Modal Opens:**

1. Detect modal (existing logic: role="dialog", covers viewport)
2. Enter overlay mode - temporarily replace sidebar with modal content
3. Modal elements get their own semantic grouping
4. When modal closes, restore previous sidebar state

**Page Navigation (SPA):**

1. Detect URL change
2. Save current expand states to URL-based storage
3. Re-scan DOM, re-run LLM grouping
4. Restore expand states if returning to previously visited URL

### Edge Cases

| Scenario                       | Expected Behavior                                                 |
| ------------------------------ | ----------------------------------------------------------------- |
| LLM timeout/failure            | Show flat list of all elements (ungrouped)                        |
| Very few elements (<5)         | LLM decides if grouping adds value or shows flat                  |
| Element removed from DOM       | Remove from display structure, keep group even if empty           |
| All elements in group removed  | Keep empty group as placeholder                                   |
| Element's DOM position changes | Element stays in its semantic group                               |
| Nested interactive elements    | LLM decides if they should be grouped (e.g., "Quantity Controls") |

## Technical Design

### Affected Components

**New/Significantly Changed:**

- `src/lib/schemas/semantic-groups.ts` - New schema for display structure and LLM response
- `src/utils/llm-service.ts` - New grouping prompt and response handling
- `src/entrypoints/sidepanel/stores/semantic-tree.svelte.ts` - New store replacing dom-tree store
- `src/entrypoints/sidepanel/components/GroupView.svelte` - New component for rendering groups
- `src/entrypoints/sidepanel/components/GroupNode.svelte` - New component for individual groups

**Modified:**

- `src/entrypoints/sidepanel/App.svelte` - Use new semantic tree store, handle overlay mode
- `src/entrypoints/content.ts` - Emit element data for grouping, handle new element placement

**Unchanged:**

- `src/utils/tree-tracker/` - Core fingerprinting and matching logic stays the same
- `src/utils/element-tracker/` - Fingerprint generation unchanged

### LLM Prompt Design

Use few-shot examples with typical groups:

```
System: You are organizing a webpage's interactive elements into semantic groups
for an accessibility sidebar. Create logical groupings based on purpose, not DOM structure.

Common group patterns:
- Navigation: links for moving between pages/sections
- Header/Footer: persistent page elements
- Forms: related inputs and their submit actions
- Content Actions: buttons/links related to main content
- User Account: login, profile, settings elements

Guidelines:
- Use clear, descriptive group names (2-4 words)
- Nest only when it adds clarity (prefer flat)
- Group related interactive elements together
- Include headings as structural markers within groups
- Small pages may not need grouping at all

Example input:
[Elements: Home link, Products link, Login button, Search input, Add to Cart button, Product title heading]

Example output:
{
  "groups": [
    {
      "name": "Navigation",
      "children": [
        {"type": "element", "id": "1", "label": "Home"},
        {"type": "element", "id": "2", "label": "Products"}
      ]
    },
    {
      "name": "Account",
      "children": [
        {"type": "element", "id": "3", "label": "Login"}
      ]
    },
    {
      "name": "Product",
      "children": [
        {"type": "element", "id": "5", "label": "Product Title"},
        {"type": "element", "id": "6", "label": "Add to Cart"},
        {"type": "element", "id": "4", "label": "Search Products"}
      ]
    }
  ]
}
```

### State Persistence

```typescript
// URL-based expand state storage
interface ExpandStateStore {
  // Key: URL pathname + search (no hash)
  // Value: Set of collapsed group IDs
  [url: string]: string[];
}

// Stored in browser.storage.local
// Cleaned up periodically (LRU with max 100 URLs)
```

### Reverse Lookup Index

```typescript
class SemanticTreeStore {
  private tree: SemanticTree;
  private elementToGroup: Map<string, string>; // Derived index

  // Called after any tree modification
  private rebuildIndex(): void {
    this.elementToGroup.clear();
    this.walkTree(this.tree.groups, (element, groupId) => {
      this.elementToGroup.set(element.elementId, groupId);
    });
  }

  // O(1) lookup for element placement
  getGroupForElement(elementId: string): string | undefined {
    return this.elementToGroup.get(elementId);
  }

  // Find group by checking neighbors
  findGroupForNewElement(neighborIds: string[]): string | undefined {
    for (const neighborId of neighborIds) {
      const groupId = this.elementToGroup.get(neighborId);
      if (groupId) return groupId;
    }
    return undefined;
  }
}
```

## Implementation Plan

### Phase 1: Schema and Store Foundation

1. [ ] Create `src/lib/schemas/semantic-groups.ts` with TypeScript interfaces and Zod schemas
2. [ ] Create `src/entrypoints/sidepanel/stores/semantic-tree.svelte.ts` with core store logic
3. [ ] Implement reverse lookup index with automatic rebuild
4. [ ] Add URL-based expand state persistence

### Phase 2: LLM Integration

5. [ ] Design and test LLM prompt with few-shot examples
6. [ ] Update `src/utils/llm-service.ts` with new grouping function
7. [ ] Implement client-side UUID generation for groups
8. [ ] Add flat-list fallback for LLM failures

### Phase 3: Sidebar UI Components

9. [ ] Create `GroupView.svelte` - root component rendering all groups
10. [ ] Create `GroupNode.svelte` - individual group with expand/collapse
11. [ ] Style group headers with chevron, quick transition animation
12. [ ] Ensure interactive elements retain existing functionality (bi-directional sync)

### Phase 4: Element Placement Logic

13. [ ] Implement neighbor-based placement algorithm
14. [ ] Add landmark fallback using fingerprint's ancestorPath
15. [ ] Wire up new element events from tree-tracker to placement logic
16. [ ] Handle element removal (remove from group, keep empty groups)

### Phase 5: Integration and Polish

17. [ ] Update `App.svelte` to use new semantic tree store
18. [ ] Implement modal overlay mode
19. [ ] Wire up content script to emit data in new format
20. [ ] Remove old tree-based components (TreeView, TreeNode)
21. [ ] End-to-end testing on various sites (React, static, SPA)

## Test Plan

### Unit Tests

- [ ] Semantic tree store: add/remove elements, rebuild index
- [ ] Placement algorithm: neighbor lookup, landmark fallback
- [ ] Expand state persistence: save, restore, LRU cleanup
- [ ] LLM response parsing and validation

### Integration Tests

- [ ] Full flow: DOM scan → LLM grouping → sidebar render
- [ ] New element appears → correct group placement
- [ ] Element DOM position changes → stays in group
- [ ] Modal open/close → overlay mode works
- [ ] LLM failure → fallback to flat list

### Manual Testing

- [ ] Test on React site (frequent re-renders)
- [ ] Test on static HTML site
- [ ] Test on SPA with navigation
- [ ] Test modal-heavy site
- [ ] Test site with few elements (<5)
- [ ] Test site with many elements (>100)
- [ ] Verify bi-directional input sync still works
- [ ] Verify button clicks still work

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                                     | Rationale                                                                         | Date       |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| No shadow tree                               | Fingerprint's ancestorPath + display structure neighbors sufficient for placement | 2026-02-01 |
| Display structure as source of truth         | LLM output maps directly; derived index for reverse lookup                        | 2026-02-01 |
| Hybrid grouping (landmarks + LLM sub-groups) | Best of both: stable top-level structure with semantic flexibility                | 2026-02-01 |
| Elements stay in place on DOM change         | Semantic grouping shouldn't change due to framework re-renders                    | 2026-02-01 |
| Full page LLM context                        | Better grouping coherence across entire page                                      | 2026-02-01 |
| Few-shot prompting                           | Consistent output with typical patterns (nav, footer, etc.)                       | 2026-02-01 |
| Client-generated group UUIDs                 | Guaranteed unique, no LLM dependency for IDs                                      | 2026-02-01 |
| Keep empty groups                            | Elements may return; provides stable structure                                    | 2026-02-01 |
| Modal overlay mode                           | Focus on modal content without cluttering with page elements                      | 2026-02-01 |
| URL-based expand state                       | Users return to familiar state when revisiting pages                              | 2026-02-01 |
| No manual reorganization                     | Simpler, consistent experience; LLM groupings are final                           | 2026-02-01 |
| Quick transition (100-150ms)                 | Feels responsive but not jarring                                                  | 2026-02-01 |
| No search for MVP                            | Reduce scope; add later if needed                                                 | 2026-02-01 |
| Keep tracker timing unchanged                | 150ms grace period, 0.6 threshold work well                                       | 2026-02-01 |
