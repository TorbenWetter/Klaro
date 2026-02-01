# Feature: Hierarchical DOM Mirror Sidebar

> A sidebar that mirrors the full website DOM tree in real-time, preserving hierarchy and rendering interactive elements as functional components.

## Overview

Replace the current landmark-based flat section view with a full hierarchical tree that mirrors the website's DOM structure. All visible elements are tracked, organized in their original parent-child relationships, and rendered as a navigable tree. The LLM enhances labels and descriptions without reorganizing content. When a modal/overlay covers the page, the sidebar focuses on just that content.

## Requirements

### Functional Requirements

- [ ] FR1: Mirror full visible DOM tree in sidebar (all elements, not just interactive)
- [ ] FR2: Preserve exact parent-child hierarchy from website DOM
- [ ] FR3: Track ALL elements with fingerprints (text, headings, containers, interactive)
- [ ] FR4: Real-time sync - sidebar updates instantly when DOM changes
- [ ] FR5: Click any sidebar item → scroll website to element + highlight
- [ ] FR6: Render interactive elements as functional components (inputs, buttons, checkboxes)
- [ ] FR7: Render non-interactive content as styled text (headings, paragraphs)
- [ ] FR8: Smart auto-collapse based on element count and nesting depth
- [ ] FR9: Expand/collapse tree nodes with chevrons
- [ ] FR10: Modal focus mode - when overlay covers page, hide other sidebar content
- [ ] FR11: LLM provides enhanced labels/descriptions (doesn't reorganize structure)
- [ ] FR12: Filter out truly hidden elements (`display:none`, `visibility:hidden`, `aria-hidden`)

### Non-Functional Requirements

- [ ] NFR1: Performance - Handle 1000+ elements without lag (collapsed by default)
- [ ] NFR2: Memory - Use WeakRef for all DOM references to allow garbage collection
- [ ] NFR3: Responsiveness - Sidebar updates within 100ms of DOM mutation
- [ ] NFR4: LLM efficiency - Only send visible viewport if full DOM exceeds token limit
- [ ] NFR5: Accessibility - Sidebar tree is keyboard navigable (arrow keys, Enter)

## User Experience

### User Flows

1. **Primary Flow: Page Load**
   1. User opens sidepanel on any webpage
   2. Extension scans full DOM tree
   3. Sidebar renders collapsed tree matching page structure
   4. LLM enhances labels for visible viewport elements
   5. User expands sections to explore content

2. **Navigation Flow**
   1. User clicks any item in sidebar tree
   2. Website scrolls to that element
   3. Element gets visual highlight (border/overlay)
   4. Highlight fades after 2 seconds

3. **Form Interaction Flow**
   1. User sees form inputs rendered as actual inputs in sidebar
   2. User types in sidebar input
   3. Value syncs to real page input in real-time
   4. Form validation on page triggers normally

4. **Modal Focus Flow**
   1. Modal opens on website (covers >50% of viewport)
   2. Sidebar collapses all content except modal subtree
   3. Modal content auto-expands in sidebar
   4. When modal closes, previous sidebar state restores

### UI States

- **Loading**: Skeleton tree with 3-4 levels of placeholder nodes
- **Empty**: "This page has no visible content" message
- **Error**: "Could not scan page" with retry button
- **Normal**: Full tree view with expand/collapse
- **Modal Focus**: Dimmed tree except modal subtree (or hidden entirely)

### Tree Node Visual States

| Element Type             | Visual Representation                  |
| ------------------------ | -------------------------------------- |
| Container (div, section) | Folder icon + label, expandable        |
| Heading (h1-h6)          | Bold text, sized by level              |
| Paragraph                | Normal text, truncated with "..."      |
| Button                   | Rendered `<Button>` component          |
| Input (text)             | Rendered `<Input>` component           |
| Input (checkbox)         | Rendered `<Checkbox>` component        |
| Select                   | Rendered `<Select>` component          |
| Link                     | Styled link text, clickable            |
| Image                    | "[Image: alt text]" placeholder        |
| List                     | Expandable with list items as children |

### Smart Collapse Rules

| Condition              | Behavior                       |
| ---------------------- | ------------------------------ |
| Depth > 4 levels       | Auto-collapse                  |
| Node has > 10 children | Auto-collapse                  |
| Node has 1-3 children  | Auto-expand                    |
| Interactive element    | Always visible (not collapsed) |
| Modal content          | Auto-expand when modal shown   |
| First 2 levels         | Auto-expand on initial load    |

### Edge Cases

| Scenario                       | Expected Behavior                          |
| ------------------------------ | ------------------------------------------ |
| Deeply nested DOM (20+ levels) | Render all, collapse beyond level 4        |
| Element removed from DOM       | Remove from sidebar tree immediately       |
| Element added to DOM           | Insert at correct tree position            |
| Element moved in DOM           | Update position in sidebar tree            |
| Text content changes           | Update label in real-time                  |
| iframe content                 | Show "[iframe]" placeholder (no access)    |
| Shadow DOM                     | Attempt to pierce, fallback to placeholder |
| SVG graphics                   | Show "[SVG]" with aria-label if available  |
| Canvas                         | Show "[Canvas]" placeholder                |
| Video/Audio                    | Show media controls if interactive         |

## Technical Design

### New Data Structures

```typescript
// Tree node representing a DOM element
interface DOMTreeNode {
  id: string; // Fingerprint ID
  fingerprint: ElementFingerprint; // Full fingerprint for tracking
  tagName: string; // HTML tag
  nodeType: 'container' | 'text' | 'interactive' | 'media';
  label: string; // Display text (LLM-enhanced)
  children: DOMTreeNode[]; // Child nodes
  depth: number; // Nesting level (0 = root)
  isExpanded: boolean; // UI state
  isVisible: boolean; // Currently visible in viewport
  isModal: boolean; // Part of a modal/overlay
}

// Root tree structure
interface DOMTree {
  root: DOMTreeNode;
  nodeCount: number;
  maxDepth: number;
  modalNode: DOMTreeNode | null; // Currently active modal
}

// Visibility tracking for scroll-to
interface ElementVisibility {
  elementId: string;
  isInViewport: boolean;
  boundingRect: DOMRect;
}
```

### Affected Components

| File                                                   | Changes                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `src/utils/dom-tree-scanner.ts`                        | **NEW** - Replaces landmark-scanner, builds full tree |
| `src/utils/element-tracker/index.ts`                   | Track ALL elements, not just interactive              |
| `src/utils/element-tracker/fingerprint.ts`             | Add fingerprinting for text/container elements        |
| `src/entrypoints/sidepanel/stores/dom-tree.svelte.ts`  | **NEW** - Tree state management                       |
| `src/entrypoints/sidepanel/components/TreeView.svelte` | **NEW** - Recursive tree renderer                     |
| `src/entrypoints/sidepanel/components/TreeNode.svelte` | **NEW** - Single node with expand/collapse            |
| `src/entrypoints/sidepanel/App.svelte`                 | Replace sections with tree view                       |
| `src/entrypoints/content.ts`                           | Add SCAN_TREE, SCROLL_TO_ELEMENT messages             |
| `src/utils/llm-service.ts`                             | Add batch labeling for visible nodes                  |
| `src/utils/modal-detector.ts`                          | **NEW** - Detect modal/overlay visibility             |

### Component Architecture

```
App.svelte
├── Header (unchanged)
└── TreeView.svelte (NEW - replaces LandmarkSection list)
    └── TreeNode.svelte (recursive)
        ├── NodeHeader (expand/collapse + label)
        ├── NodeContent (rendered component or text)
        └── TreeNode[] (children, if expanded)
```

### Message Protocol Updates

```typescript
// New messages content.ts ↔ sidepanel

// Request full tree scan
{ type: 'SCAN_TREE' }
→ { type: 'TREE_SCANNED', tree: DOMTree }

// Real-time updates
{ type: 'NODE_ADDED', parentId: string, node: DOMTreeNode, index: number }
{ type: 'NODE_REMOVED', nodeId: string }
{ type: 'NODE_UPDATED', nodeId: string, changes: Partial<DOMTreeNode> }
{ type: 'NODE_MOVED', nodeId: string, newParentId: string, newIndex: number }

// Modal detection
{ type: 'MODAL_OPENED', modalNodeId: string }
{ type: 'MODAL_CLOSED' }

// Navigation
{ type: 'SCROLL_TO_ELEMENT', elementId: string }
→ { type: 'SCROLL_COMPLETE', success: boolean }
```

### Tree Building Algorithm

```typescript
function buildDOMTree(root: HTMLElement): DOMTreeNode {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as HTMLElement;
      // Skip hidden elements
      if (isHidden(el)) return NodeFilter.FILTER_REJECT;
      // Skip script, style, etc.
      if (isBoilerplate(el)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  function processNode(element: HTMLElement, depth: number): DOMTreeNode {
    const fingerprint = createFingerprint(element);
    const children: DOMTreeNode[] = [];

    // Process direct children
    for (const child of element.children) {
      if (child instanceof HTMLElement && !isHidden(child)) {
        children.push(processNode(child, depth + 1));
      }
    }

    return {
      id: fingerprint.id,
      fingerprint,
      tagName: element.tagName.toLowerCase(),
      nodeType: getNodeType(element),
      label: getLabel(element),
      children,
      depth,
      isExpanded: shouldAutoExpand(depth, children.length),
      isVisible: isInViewport(element),
      isModal: isModalContent(element),
    };
  }

  return processNode(root, 0);
}
```

### Modal Detection Algorithm

```typescript
function detectActiveModal(): HTMLElement | null {
  // Strategy 1: Check for elements with role="dialog" that are visible
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const dialog of dialogs) {
    if (isVisible(dialog) && coversViewport(dialog, 0.5)) {
      return dialog as HTMLElement;
    }
  }

  // Strategy 2: Check for fixed/absolute positioned elements covering viewport
  const overlays = document.querySelectorAll('*');
  for (const el of overlays) {
    const style = getComputedStyle(el);
    if (
      (style.position === 'fixed' || style.position === 'absolute') &&
      coversViewport(el, 0.5) &&
      hasInteractiveContent(el)
    ) {
      return el as HTMLElement;
    }
  }

  return null;
}

function coversViewport(element: Element, threshold: number): boolean {
  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = rect.width * rect.height;
  return elementArea / viewportArea >= threshold;
}
```

### Smart Collapse Algorithm

```typescript
function shouldAutoExpand(
  depth: number,
  childCount: number,
  hasInteractiveChild: boolean
): boolean {
  // Always expand if has direct interactive element
  if (hasInteractiveChild) return true;

  // Expand first 2 levels by default
  if (depth < 2) return true;

  // Collapse if too deep
  if (depth > 4) return false;

  // Collapse if too many children
  if (childCount > 10) return false;

  // Expand small groups
  if (childCount <= 3) return true;

  return false;
}
```

### Scroll-to-Element Implementation

```typescript
// content.ts
function scrollToElement(elementId: string): boolean {
  const element = tracker.getElementById(elementId);
  if (!element) return false;

  // Scroll into view with smooth animation
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'center',
  });

  // Add highlight effect
  highlightElement(element, {
    duration: 2000,
    style: 'outline', // or 'overlay'
  });

  return true;
}
```

### LLM Batch Labeling

```typescript
async function labelVisibleNodes(nodes: DOMTreeNode[]): Promise<Map<string, string>> {
  // Filter to visible viewport nodes
  const visibleNodes = nodes.filter((n) => n.isVisible);

  // Check token limit
  const prompt = buildLabelingPrompt(visibleNodes);
  if (prompt.length > MAX_TOKENS) {
    // Split into batches
    return labelInBatches(visibleNodes);
  }

  const response = await callGemini({
    system: LABELING_PROMPT,
    user: prompt,
    temperature: 0.2,
  });

  return parseLabelResponse(response);
}

const LABELING_PROMPT = `You are helping create accessible labels for webpage elements.
For each element, provide a clear, concise label that describes what it is or does.
Keep labels under 50 characters. Use action verbs for interactive elements.

Respond with JSON: { "<id>": "label", ... }`;
```

## Implementation Plan

### Phase 1: Core Tree Infrastructure

1. [ ] Create `DOMTreeNode` and `DOMTree` types in new schema file
2. [ ] Implement `dom-tree-scanner.ts` with `buildDOMTree()` function
3. [ ] Update `ElementTracker` to track ALL visible elements
4. [ ] Add fingerprinting for non-interactive elements (text nodes, containers)
5. [ ] Create `dom-tree.svelte.ts` store with tree state management

### Phase 2: Tree Rendering

1. [ ] Create `TreeView.svelte` component (container with scroll)
2. [ ] Create `TreeNode.svelte` recursive component
3. [ ] Implement expand/collapse with chevron animation
4. [ ] Render interactive elements as actual components
5. [ ] Render text content with appropriate styling
6. [ ] Add indentation based on depth

### Phase 3: Real-time Sync

1. [ ] Modify MutationObserver to detect all DOM changes
2. [ ] Implement incremental tree updates (add/remove/move/update)
3. [ ] Add `NODE_ADDED`, `NODE_REMOVED`, `NODE_UPDATED` messages
4. [ ] Update store with granular tree modifications
5. [ ] Ensure UI updates without full re-render

### Phase 4: Navigation & Highlighting

1. [ ] Implement `SCROLL_TO_ELEMENT` message handler
2. [ ] Add click handler to all TreeNode components
3. [ ] Create highlight overlay component
4. [ ] Add smooth scroll with center alignment
5. [ ] Auto-fade highlight after 2 seconds

### Phase 5: Modal Focus Mode

1. [ ] Create `modal-detector.ts` utility
2. [ ] Detect modal open/close via MutationObserver
3. [ ] Send `MODAL_OPENED`/`MODAL_CLOSED` messages
4. [ ] Implement sidebar focus mode (dim/hide non-modal content)
5. [ ] Auto-expand modal subtree
6. [ ] Restore previous state on modal close

### Phase 6: Smart Collapse & LLM

1. [ ] Implement `shouldAutoExpand()` algorithm
2. [ ] Apply smart collapse on initial render
3. [ ] Add LLM batch labeling for visible nodes
4. [ ] Cache LLM labels to avoid re-fetching
5. [ ] Update labels when nodes become visible (scroll)

### Phase 7: Cleanup & Migration

1. [ ] Remove old `landmark-scanner.ts` (or keep for reference)
2. [ ] Remove old `LandmarkSection.svelte` and `SectionContent.svelte`
3. [ ] Update `App.svelte` to use new tree view
4. [ ] Remove old store (`landmarks.svelte.ts`)
5. [ ] Update tests for new architecture

## Test Plan

### Unit Tests

- [ ] `dom-tree-scanner.ts`: Builds correct tree from mock DOM
- [ ] `dom-tree-scanner.ts`: Filters hidden elements correctly
- [ ] `dom-tree-scanner.ts`: Handles deeply nested DOM (20+ levels)
- [ ] `modal-detector.ts`: Detects role="dialog" modals
- [ ] `modal-detector.ts`: Detects fixed position overlays
- [ ] Smart collapse: Correct expansion at different depths
- [ ] Fingerprint: Works for text nodes and containers

### Integration Tests

- [ ] Full tree scan on test-site produces correct structure
- [ ] Real-time updates: Add element → appears in sidebar
- [ ] Real-time updates: Remove element → removed from sidebar
- [ ] Real-time updates: Text change → label updates
- [ ] Click sidebar item → website scrolls to element
- [ ] Form input in sidebar → syncs to website
- [ ] Modal opens → sidebar enters focus mode
- [ ] Modal closes → sidebar restores previous state

### Manual Testing

- [ ] Test on React SPA (test-site)
- [ ] Test on static HTML page
- [ ] Test on complex site (Amazon, GitHub)
- [ ] Test modal focus on site with popups
- [ ] Test performance with 1000+ element page
- [ ] Test keyboard navigation through tree
- [ ] Test with screen reader

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                                  | Rationale                                                            | Date       |
| ----------------------------------------- | -------------------------------------------------------------------- | ---------- |
| Mirror full DOM, not just interactive     | User wants complete page representation for seniors who need context | 2024-01-31 |
| Track ALL elements with fingerprints      | Ensures stability during React re-renders for entire tree            | 2024-01-31 |
| LLM labels only, doesn't reorganize       | Preserves original page structure user is familiar with              | 2024-01-31 |
| Replace current landmark approach         | User prefers single unified view over mode toggle                    | 2024-01-31 |
| Modal focus mode hides other content      | Directs attention to modal when it covers most of viewport           | 2024-01-31 |
| Smart auto-collapse based on depth/count  | Balances showing content vs overwhelming user with deep trees        | 2024-01-31 |
| Click-to-scroll for ALL elements          | Provides navigation aid for seniors, not just interactive elements   | 2024-01-31 |
| Render interactive elements as components | Allows direct interaction in sidebar, familiar UI patterns           | 2024-01-31 |
