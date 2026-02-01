# Feature: Sidebar Semantic Styling

> LLM-powered intelligent layout that understands page structure and renders it with accessible, visually hierarchical styling in the sidebar.

## Overview

The sidebar currently displays a raw DOM tree. This feature adds intelligent layout decisions: the LLM analyzes page content to assign semantic roles (navigation, main-content, form, etc.) and emphasis levels, which the UI then renders with appropriate visual styling based on user accessibility preferences.

**Key insight:** The LLM's value is _understanding what content IS_ - not just applying uniform styles, but making intelligent decisions like "this is the primary navigation, style it compactly" or "this is the main article, make it readable."

## Requirements

### Functional Requirements

- [ ] FR1: LLM assigns semantic roles to nodes (navigation, main-content, form, heading, list, footer)
- [ ] FR2: LLM assigns emphasis levels (critical, high, normal, low) to guide visual weight
- [ ] FR3: Combined LLM prompt handles both labels AND layout hints in single call
- [ ] FR4: TreeView renders nodes differently based on assigned role and emphasis
- [ ] FR5: User preferences (hardcoded defaults) affect final rendering
- [ ] FR6: Klaro-injected elements (`.klaro-*`) excluded from tree and styling

### Non-Functional Requirements

- [ ] NFR1: LLM response must include layout hints within existing token budget
- [ ] NFR2: Graceful retry on LLM failure (show loading state)
- [ ] NFR3: Styling must maintain accessibility (WCAG AA contrast, focus indicators)

## User Experience

### User Flows

1. **Primary Flow: Page Scan with Styled View**
   - User opens sidepanel
   - Content script scans DOM, builds tree
   - LLM analyzes tree, returns labels + roles + emphasis
   - TreeView renders with semantic sections and visual hierarchy
   - User sees organized, accessible view of page content

2. **Fallback Flow: LLM Failure**
   - LLM call fails or times out
   - Show loading skeleton with retry indicator
   - Retry LLM call (with exponential backoff)
   - On persistent failure, show error with manual retry button

### UI States

- **Loading:** Skeleton with "Analyzing page structure..." message
- **Success:** Styled semantic sections with visual hierarchy
- **Retry:** Loading skeleton with "Retrying..." indicator
- **Error:** Error message with "Try Again" button

### Visual Layout

Top-level semantic roles render as **distinct visual sections**:

```
┌─────────────────────────────────┐
│ 🧭 Navigation                   │  ← Compact horizontal/list style
│ Home | Products | About | Cart  │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 📄 Main Content                 │  ← Readable prose style
│                                 │
│ # Welcome to Our Store          │  ← Heading with emphasis
│                                 │
│ Browse our collection of...     │  ← Body text, comfortable spacing
│                                 │
│ [🔘 Shop Now]                   │  ← Critical emphasis = prominent
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 📝 Newsletter Form              │  ← Grouped form fields
│ Email: [____________]           │
│ [Subscribe]                     │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ 📋 Footer                       │  ← De-emphasized, compact
│ Privacy · Terms · Contact       │
└─────────────────────────────────┘
```

### Edge Cases

| Scenario                       | Expected Behavior                                 |
| ------------------------------ | ------------------------------------------------- |
| LLM assigns unknown role       | Treat as "container", render with default styling |
| Multiple main-content sections | All render as main-content style                  |
| Deeply nested content          | Children inherit parent's role context            |
| Empty section                  | Hide section entirely                             |
| Single-element page            | Render as main-content                            |

## Technical Design

### Direct Layout Instructions

> **Note:** We pivoted from named semantic roles (navigation, main-content, etc.) to direct layout instructions after finding that LLM role classification was often unreliable. Direct layout instructions give the LLM more flexibility to describe HOW elements should be displayed rather than categorizing WHAT they are.

```typescript
type DisplayMode = 'inline' | 'block' | 'flex-row' | 'flex-col' | 'grid';
type SpacingLevel = 'compact' | 'normal' | 'spacious';
type EmphasisLevel = 'critical' | 'high' | 'normal' | 'low';

interface LayoutHints {
  display?: DisplayMode; // How element flows in layout
  emphasis?: EmphasisLevel; // Visual weight
  spacing?: SpacingLevel; // Gap/padding level
}
```

### User Preferences (Hardcoded Defaults)

```typescript
// src/utils/accessibility-preferences.ts

export interface AccessibilityPreferences {
  fontSize: 'small' | 'medium' | 'large' | 'xlarge';
  highContrast: boolean;
  increasedSpacing: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontSize: 'large', // Seniors benefit from larger text
  highContrast: true, // Better readability
  increasedSpacing: true, // Easier scanning
  reducedMotion: true, // Less distraction
};
```

### LLM Response Schema

```typescript
interface LLMLayoutResponse {
  labels: Record<string, string>; // Element labels
  layout: Record<
    string,
    {
      // Layout hints per node
      display?: DisplayMode;
      emphasis?: EmphasisLevel;
      spacing?: SpacingLevel;
    }
  >;
}
```

### Combined LLM Prompt

```typescript
const COMBINED_PROMPT = `You are helping create an accessible sidebar view of a webpage for seniors (65+).

For each element, provide:
1. A clear, concise LABEL describing what it is or does
2. LAYOUT instructions for how to display it

LABEL GUIDELINES:
- Use simple, clear language
- Describe the PURPOSE, not the HTML tag
- For buttons/links: describe the action ("Sign in", "Go to cart")
- For inputs: describe what to enter ("Your email", "Search products")
- Keep labels under 50 characters

LAYOUT OPTIONS:

display (how element flows):
- "inline": Flows horizontally with siblings (for nav links, buttons in a row, tags)
- "block": Stacked vertically, full width (for paragraphs, headings, form fields)
- "flex-row": Children arranged in a horizontal row (for toolbars, button groups)
- "flex-col": Children stacked vertically (for forms, lists)
- "grid": Children in a grid layout (for card grids, image galleries)

emphasis (visual importance):
- "critical": Primary actions - make prominent (Buy, Submit, Sign In)
- "high": Important content - stand out (main headings, key info)
- "normal": Regular content (default)
- "low": De-emphasized (fine print, metadata, timestamps)

spacing (gaps and padding):
- "compact": Tight spacing (nav items, dense lists)
- "normal": Standard spacing (default)
- "spacious": Extra breathing room (readable paragraphs, forms)

Respond with JSON only, no markdown:
{
  "labels": { "<id>": "label", ... },
  "layout": { "<id>": { "display": "inline", "emphasis": "normal", "spacing": "compact" }, ... }
}`;
```

### Affected Components

| File                                                        | Changes                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `src/utils/llm-service.ts`                                  | Update prompt to return layout hints, modify response parsing |
| `src/utils/accessibility-preferences.ts`                    | NEW: Hardcoded preferences with types                         |
| `src/entrypoints/sidepanel/stores/dom-tree-store.svelte.ts` | Store layout hints per node                                   |
| `src/entrypoints/sidepanel/components/TreeView.svelte`      | Pass layout status and hints to TreeNode                      |
| `src/entrypoints/sidepanel/components/TreeNode.svelte`      | Apply display/emphasis/spacing styling                        |
| `src/lib/schemas/dom-tree.ts`                               | Add LayoutHints to DOMTreeNode type                           |

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Content Script  │────▶│  Tree Builder    │────▶│   LLM Service   │
│ (DOM scanning)  │     │ (build nodes)    │     │ (labels+layout) │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │
                        │  Preferences     │              │
                        │ (hardcoded)      │              │
                        └────────┬─────────┘              │
                                 │                        │
                                 ▼                        ▼
                        ┌─────────────────────────────────────────┐
                        │              TreeView                    │
                        │  ┌─────────────────────────────────┐    │
                        │  │ SemanticSection (per role)      │    │
                        │  │  └─ TreeNode (styled by         │    │
                        │  │       role + emphasis + prefs)  │    │
                        │  └─────────────────────────────────┘    │
                        └─────────────────────────────────────────┘
```

### Style Mapping

```typescript
// How display modes map to CSS classes

const DISPLAY_STYLES: Record<DisplayMode, string> = {
  inline: 'display: inline-flex', // Flows horizontally
  block: 'display: block; width: 100%', // Full width vertical
  'flex-row': 'display: flex; flex-direction: row; flex-wrap: wrap', // Children horizontal
  'flex-col': 'display: flex; flex-direction: column', // Children vertical
  grid: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))',
};

const EMPHASIS_STYLES: Record<EmphasisLevel, string> = {
  critical: 'background: primary/10; font-weight: 700; padding: 4px 8px',
  high: 'font-weight: 600',
  normal: '',
  low: 'opacity: 0.75',
};

const SPACING_STYLES: Record<SpacingLevel, { padding: string; gap: string }> = {
  compact: { padding: '1px 4px', gap: '2px' },
  normal: { padding: '2px 8px', gap: '4px' },
  spacious: { padding: '6px 12px', gap: '12px' },
};

// Preferences modify base styles (via CSS classes on TreeView)
// - .large-text: Increases font sizes
// - .high-contrast: Increases color contrast
// - .increased-spacing: Adds extra gaps
```

## Implementation Plan

### Phase 1: Schema & Preferences

1. [x] Create `src/utils/accessibility-preferences.ts` with types and defaults
2. [x] Update `src/lib/schemas/dom-tree.ts` to add `role` and `emphasis` fields
3. [x] Update `dom-tree-store.svelte.ts` to store layout hints

### Phase 2: LLM Integration

1. [x] Update `llm-service.ts` with combined prompt
2. [x] Update response parsing to extract layout hints
3. [x] Apply layout hints to nodes in store
4. [x] Add retry logic with loading state

### Phase 3: UI Components

1. [x] Create `SemanticSection.svelte` wrapper component
2. [x] Update `TreeView.svelte` to group nodes by role
3. [x] Update `TreeNode.svelte` to apply role/emphasis/preference styling
4. [x] Add section icons and headers

### Phase 4: Polish & Testing

1. [ ] Test on various page types (news, e-commerce, forms, docs)
2. [ ] Verify accessibility (contrast, focus, screen reader)
3. [ ] Performance test with large pages
4. [ ] Add error handling UI

## Test Plan

### Unit Tests

- [ ] `applyPreferences()` correctly scales font sizes
- [ ] Role style mapping returns correct classes
- [ ] LLM response parsing handles missing layout field gracefully
- [ ] Unknown roles fall back to 'container'

### Integration Tests

- [ ] Full flow: scan → LLM → styled render
- [ ] Retry logic triggers on LLM failure
- [ ] Preferences affect all styled elements

### Manual Testing

- [ ] News article: main-content readable, nav compact
- [ ] E-commerce: product info prominent, footer de-emphasized
- [ ] Login page: form grouped, submit button critical emphasis
- [ ] Complex page: multiple sections render distinctly

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                              | Rationale                                                                                                                                                                                                                           | Date       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| LLM assigns semantic roles            | Intelligent layout decisions based on content understanding                                                                                                                                                                         | 2026-02-01 |
| Basic role set (6 roles)              | Sufficient for most pages, keeps prompt simple                                                                                                                                                                                      | 2026-02-01 |
| Emphasis levels included              | Allows critical actions to stand out                                                                                                                                                                                                | 2026-02-01 |
| Combined LLM prompt                   | Single call for labels + layout = efficient                                                                                                                                                                                         | 2026-02-01 |
| Hardcoded preferences                 | Onboarding system not ready, start with sensible defaults                                                                                                                                                                           | 2026-02-01 |
| Sectioned visual layout               | Clear separation helps users understand page structure                                                                                                                                                                              | 2026-02-01 |
| Retry on failure                      | Users expect styled view, don't fall back silently                                                                                                                                                                                  | 2026-02-01 |
| Always active                         | New view replaces old, no toggle needed                                                                                                                                                                                             | 2026-02-01 |
| **Pivot: Direct layout instructions** | Named roles (navigation, main-content, etc.) were often misclassified by LLM. Direct layout instructions (display, spacing, emphasis) give LLM more flexibility to describe HOW to render rather than categorize WHAT something is. | 2026-02-01 |
