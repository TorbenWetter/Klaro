# Feature: Tree Rendering Improvements

> Reduce noise and improve label quality in the sidebar tree by flattening empty containers, consolidating redundant nodes, and enhancing label extraction.

## Overview

The current tree rendering produces too many meaningless wrapper nodes and misses some accessibility label sources. This spec defines five improvements that work generically across all websites:

1. **Empty Container Flattening** - Skip containers with no meaningful content
2. **Label Extraction Improvements** - Add aria-labelledby, aria-describedby support
3. **Interactive Parent Consolidation** - Text inside buttons/links should not create separate nodes
4. **Duplicate Node Elimination** - Button with icon+text should show one consolidated node
5. **Form Field Context** - Better label detection for inputs

## Requirements

### Functional Requirements

- [ ] FR1: Containers with no direct text content, no aria-label, no title, and no landmark role should be skipped (children promoted to parent level)
- [ ] FR2: Whitespace-only text nodes should be treated as "no content"
- [ ] FR3: aria-labelledby should be resolved by looking up referenced element IDs
- [ ] FR4: aria-describedby should be resolved as secondary/description text
- [ ] FR5: Interactive elements (buttons, links) should consolidate all child text into their label
- [ ] FR6: Children of interactive elements should be hidden from the tree (not rendered as separate nodes)
- [ ] FR7: SVG children inside interactive elements should contribute their aria-label/title to parent label
- [ ] FR8: Form inputs should check previous siblings, parent `<label>`, and fieldset `<legend>` for labels
- [ ] FR9: Text consolidation must preserve DOM order

### Non-Functional Requirements

- [ ] NFR1: Performance - Changes must not significantly impact tree building time (< 10% increase)
- [ ] NFR2: Compatibility - Must work on all websites without site-specific logic

## Technical Design

### Affected Components

- `src/utils/tree-tracker/tree-builder.ts` - Main changes for container flattening, label extraction, child consolidation
- `src/utils/element-tracker/fingerprint.ts` - Enhanced `getVisibleText()` for better text extraction

### 1. Empty Container Flattening

**Current behavior** (tree-builder.ts:642-659): Only flattens single-child containers.

**New behavior**: Skip ANY container that has:

- No direct text content (whitespace doesn't count)
- No aria-label attribute
- No title attribute
- No landmark role/tag (nav, main, header, footer, aside, article, section, form)

**Implementation location**: `buildDOMTree()` in tree-builder.ts

```typescript
// In processNode(), after getting children:
function shouldSkipContainer(element: HTMLElement, children: TreeNode[]): boolean {
  // Only applies to containers
  if (getNodeType(element) !== 'container') return false;

  // Never skip if it has meaningful attributes
  if (element.getAttribute('aria-label')) return false;
  if (element.getAttribute('title')) return false;
  if (element.getAttribute('role')) return false;

  // Never skip landmark elements
  const tag = element.tagName.toLowerCase();
  if (['nav', 'main', 'header', 'footer', 'aside', 'article', 'section', 'form'].includes(tag)) {
    return false;
  }

  // Check for direct text content (non-whitespace)
  const hasDirectText = Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (hasDirectText) return false;

  // Skip this container - children will be promoted
  return true;
}
```

**Tree transformation**: When a container is skipped, its children are added directly to the grandparent at the container's position, preserving order.

### 2. Label Extraction Improvements

**Add to `extractLabel()` in tree-builder.ts:**

```typescript
export function extractLabel(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();

  // [existing form element handling...]

  // NEW: Check aria-labelledby first (highest priority for accessibility)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = resolveAriaLabelledBy(labelledBy);
    if (labelText) return normalizeText(labelText, 100);
  }

  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Check title attribute
  const title = element.getAttribute('title');
  if (title) return title;

  // [rest of existing logic...]
}

/**
 * Resolve aria-labelledby by looking up referenced element IDs.
 * Handles space-separated list of IDs.
 */
function resolveAriaLabelledBy(ids: string): string {
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Resolve aria-describedby for description text.
 */
function resolveAriaDescribedBy(ids: string): string | undefined {
  const text = ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}
```

**Also add description field**: Store aria-describedby result in node's `description` field.

### 3. Interactive Parent Consolidation

**New function in tree-builder.ts:**

```typescript
/**
 * Extract consolidated label from interactive element including all child text.
 * Used for buttons, links, and other interactive elements.
 */
function extractConsolidatedLabel(element: HTMLElement): string {
  // First check aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = resolveAriaLabelledBy(labelledBy);
    if (labelText) return normalizeText(labelText, 100);
  }

  // Then aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Collect all text content in DOM order, including SVG aria-labels
  const textParts: string[] = [];

  function collectText(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) textParts.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      // For SVG, use aria-label or title
      if (tag === 'svg') {
        const svgLabel =
          el.getAttribute('aria-label') || el.querySelector('title')?.textContent?.trim();
        if (svgLabel) textParts.push(svgLabel);
        return; // Don't recurse into SVG
      }

      // Skip script, style
      if (tag === 'script' || tag === 'style') return;

      // Recurse into children
      for (const child of node.childNodes) {
        collectText(child);
      }
    }
  }

  collectText(element);

  const consolidated = textParts.join(' ').trim();
  if (consolidated) return normalizeText(consolidated, 100);

  // Fallback to title or tag
  return element.getAttribute('title') || element.tagName.toLowerCase();
}
```

### 4. Duplicate Node Elimination

**Modify `processNode()` in tree-builder.ts:**

```typescript
function processNode(element: HTMLElement, depth: number): TreeNode | TreeNode[] | null {
  // ... existing skip logic ...

  const nodeType = getNodeType(element);

  // For interactive elements, use consolidated label and DON'T process children
  if (nodeType === 'interactive') {
    const label = extractConsolidatedLabel(element);
    const fingerprint = createFingerprint(element);

    return {
      id: fingerprint.id,
      fingerprint,
      tagName: element.tagName.toLowerCase(),
      nodeType,
      interactiveType: getInteractiveType(element),
      label,
      originalLabel: label,
      depth,
      isExpanded: false,
      isVisible: isInViewport(element),
      isModal: false,
      children: [], // NO CHILDREN for interactive elements
      // ... other fields
    };
  }

  // ... rest of existing logic for non-interactive elements ...
}
```

### 5. Form Field Context

**Enhanced label detection for form elements in tree-builder.ts:**

```typescript
/**
 * Extract label for form field using multiple strategies.
 */
function extractFormFieldLabel(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): string {
  // 1. aria-labelledby (highest priority)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = resolveAriaLabelledBy(labelledBy);
    if (text) return text;
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 3. Associated <label for="id"> element
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return text;
    }
  }

  // 4. Wrapping <label> element
  const parentLabel = element.closest('label');
  if (parentLabel) {
    // Clone and remove form elements to get just the label text
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button').forEach((el) => el.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 5. Previous sibling (common pattern: "Label: [input]")
  const prevSibling = element.previousElementSibling;
  if (prevSibling) {
    const tag = prevSibling.tagName.toLowerCase();
    if (tag === 'label' || tag === 'span' || tag === 'div') {
      const text = prevSibling.textContent?.trim()?.replace(/:$/, '');
      if (text && text.length < 100) return text;
    }
  }

  // 6. Fieldset legend
  const fieldset = element.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = legend.textContent?.trim();
      if (text) return text;
    }
  }

  // 7. Placeholder
  if ('placeholder' in element && element.placeholder) {
    return element.placeholder;
  }

  // 8. name attribute (last resort, often technical)
  if (element.name) {
    // Convert "first_name" to "First Name"
    return element.name.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Fallback
  return element.type || 'input';
}
```

**Update `extractLabel()` to use this for form elements:**

```typescript
export function extractLabel(element: HTMLElement): string {
  // For form elements, use enhanced detection
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return extractFormFieldLabel(element);
  }

  // ... rest of existing logic ...
}
```

## Implementation Plan

### Phase 1: Container Flattening

1. [ ] Add `shouldSkipContainer()` function to tree-builder.ts
2. [ ] Modify `processNode()` to check and skip empty containers
3. [ ] When skipping, return children array instead of single node
4. [ ] Update parent processing to handle array returns (flatten into children list)
5. [ ] Test with deeply nested empty divs

### Phase 2: Label Extraction Improvements

1. [ ] Add `resolveAriaLabelledBy()` helper function
2. [ ] Add `resolveAriaDescribedBy()` helper function
3. [ ] Update `extractLabel()` to check aria-labelledby first
4. [ ] Store aria-describedby in node's description field
5. [ ] Test with sites using aria-labelledby (common in React apps)

### Phase 3: Interactive Element Consolidation

1. [ ] Add `extractConsolidatedLabel()` function
2. [ ] Modify `processNode()` to not recurse into interactive elements
3. [ ] Ensure SVG aria-label/title is included in consolidated label
4. [ ] Test with icon buttons, link cards, complex button contents

### Phase 4: Form Field Labels

1. [ ] Add `extractFormFieldLabel()` function
2. [ ] Update `extractLabel()` to delegate to it for form elements
3. [ ] Test with various form patterns (label for, wrapping label, sibling label, fieldset)

## Test Plan

### Unit Tests

- [ ] `shouldSkipContainer()` returns true for empty divs
- [ ] `shouldSkipContainer()` returns false for nav/main/header/etc.
- [ ] `shouldSkipContainer()` returns false for divs with aria-label
- [ ] `resolveAriaLabelledBy()` handles single ID
- [ ] `resolveAriaLabelledBy()` handles space-separated IDs
- [ ] `resolveAriaLabelledBy()` handles missing IDs gracefully
- [ ] `extractConsolidatedLabel()` preserves text order
- [ ] `extractConsolidatedLabel()` includes SVG aria-label
- [ ] `extractFormFieldLabel()` finds label[for=id]
- [ ] `extractFormFieldLabel()` finds wrapping label
- [ ] `extractFormFieldLabel()` finds previous sibling label
- [ ] `extractFormFieldLabel()` finds fieldset legend

### Manual Testing

- [ ] Test on hackathon site (localhost:5173) - verify reduced nesting
- [ ] Test on Wikipedia - verify proper heading/link extraction
- [ ] Test on GitHub - verify button labels include icon context
- [ ] Test on Google Forms - verify form field labels detected
- [ ] Test on React app (e.g., Facebook) - verify aria-labelledby works

## Edge Cases

| Scenario                                        | Expected Behavior                       |
| ----------------------------------------------- | --------------------------------------- |
| Container with only `<!-- comments -->`         | Treat as empty, skip                    |
| Container with `&nbsp;` only                    | Treat as empty (whitespace), skip       |
| aria-labelledby references non-existent ID      | Skip that ID, use others or fallback    |
| Circular aria-labelledby references             | Only resolve first level, don't recurse |
| Button containing another button (invalid HTML) | Outer button gets label, inner ignored  |
| SVG with both aria-label and `<title>`          | Prefer aria-label                       |
| Input with both label[for] and aria-label       | Prefer aria-label (higher specificity)  |
| Multiple inputs sharing same label[for] ID      | Each input gets the same label          |

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                                                | Rationale                                                         | Date       |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| Skip all empty containers, not just single-child        | Reduces noise significantly without losing meaning                | 2026-02-01 |
| Always resolve aria-labelledby regardless of visibility | Referenced elements often hidden (e.g., screen reader only spans) | 2026-02-01 |
| Hide children of interactive elements completely        | Prevents duplicate content, cleaner tree                          | 2026-02-01 |
| Whitespace = empty for container detection              | Whitespace-only nodes never meaningful for users                  | 2026-02-01 |
| Include SVG aria-label in parent button label           | Icon-only buttons need accessible names                           | 2026-02-01 |
| Preserve DOM order when consolidating text              | Natural reading order expected by users                           | 2026-02-01 |
| Form label search: siblings + parent + fieldset         | Covers common patterns without over-reaching                      | 2026-02-01 |
