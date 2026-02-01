# Feature: Landmark-Based Sidebar with Inline Elements

> A refactored sidebar that organizes page content by DOM landmarks (nav, main, form, footer, etc.) with collapsible sections, showing elements inline within their structural context rather than grouped separately.

## Overview

The current sidebar implementation uses LLM to generate a complete UI schema, which loses the page's structural context and groups actions separately from their content. This refactor preserves DOM hierarchy by organizing content into landmark-based collapsible sections, with elements displayed inline where they appear on the page.

**Key Changes from Current Implementation:**

- Remove the "Read" tab - single unified view organized by landmarks
- Remove LLM-generated UI schema approach (`page-to-ui.ts`)
- Add landmark-based section extraction to DOM scanner
- Build sections from DOM structure, not LLM generation
- LLM role changes: filter importance + enhance labels (not generate UI)
- Incremental updates: LLM evaluates only changed elements

**Research Foundation:**

> "DOM hierarchy is the strongest UI feature for LLM backends. Element extraction approaches that discard parent-child relationships perform significantly worse than those preserving tree structure." - research/2-dom-extraction.md

## Requirements

### Functional Requirements

- [ ] FR1: Extract content organized by landmark regions (nav, main, section, article, aside, form, header, footer)
- [ ] FR2: Display each landmark as a collapsible section with item count badge
- [ ] FR3: Mirror page structure exactly within each section (headings, text, actions in DOM order)
- [ ] FR4: All sections collapsed by default - seniors expand what they need
- [ ] FR5: Remove elements immediately when lost (no "unavailable" state)
- [ ] FR6: Aggressive DOM cleaning before LLM: ads, cookie banners, social widgets, chat widgets, popups, empty elements
- [ ] FR7: LLM filters importance - decides which elements are relevant for seniors
- [ ] FR8: LLM enhances labels - improves element descriptions for clarity
- [ ] FR9: Text changes update locally without LLM call
- [ ] FR10: Structure changes (new/removed elements) trigger LLM evaluation for that element only
- [ ] FR11: Fully functional form inputs - typing in sidebar syncs to page in real-time
- [ ] FR12: Remove "Read" tab - single unified landmark-based view

### Non-Functional Requirements

- [ ] NFR1: Initial render < 500ms after page scan (excluding LLM latency)
- [ ] NFR2: LLM token budget: ~4K tokens for page representation
- [ ] NFR3: Incremental updates < 100ms for local changes
- [ ] NFR4: Reuse existing UIRenderer components (shadcn-based)
- [ ] NFR5: Maintain fingerprint-based ElementTracker integration

## User Experience

### Layout Structure

```
┌─────────────────────────────────────────┐
│ HEADER                                   │
│ ├─ "Klaro" logo/title                   │
│ └─ Refresh button                       │
├─────────────────────────────────────────┤
│ PAGE CONTENT (collapsible sections)      │
│                                          │
│ ▶ Navigation                  [3 items] │
│   (collapsed - click to expand)         │
│                                          │
│ ▶ Main Content               [8 items]  │
│   (collapsed - click to expand)         │
│                                          │
│ ▶ Registration Form          [4 fields] │
│   (collapsed - click to expand)         │
│                                          │
│ ▶ Footer                     [2 links]  │
│   (collapsed - click to expand)         │
└─────────────────────────────────────────┘
```

### Section Expanded View

```
▼ Registration Form                [4 fields]
  ┌───────────────────────────────────────┐
  │ Create your account                   │  ← Heading (h2)
  │                                       │
  │ Enter your details below to get       │  ← Text block
  │ started with our service.             │
  │                                       │
  │ Full Name                             │  ← Input label
  │ ┌─────────────────────────────────┐   │
  │ │ Enter your full name            │   │  ← Functional input
  │ └─────────────────────────────────┘   │
  │                                       │
  │ Email Address                         │
  │ ┌─────────────────────────────────┐   │
  │ │ your@email.com                  │   │
  │ └─────────────────────────────────┘   │
  │                                       │
  │ [Create Account]                      │  ← Button inline
  └───────────────────────────────────────┘
```

### Section Header Behavior

| State     | Appearance                                 |
| --------- | ------------------------------------------ |
| Collapsed | `▶ Section Name [N items]` - chevron right |
| Expanded  | `▼ Section Name [N items]` - chevron down  |
| Empty     | Section hidden entirely                    |
| Loading   | `▶ Section Name [...]` - spinner in badge  |

### Edge Cases

| Scenario                            | Expected Behavior                                      |
| ----------------------------------- | ------------------------------------------------------ |
| No landmarks found                  | Show single "Page Content" section with all elements   |
| Element lost during interaction     | Remove from section immediately, no error shown        |
| LLM unavailable                     | Show elements without importance filtering, raw labels |
| Very long section (50+ items)       | Virtualized list, only render visible items            |
| Nested landmarks (form inside main) | Form gets own section, not nested inside main          |
| Multiple forms on page              | Each form as separate section                          |
| Dynamic content (modal appears)     | New section added for modal landmark                   |

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INITIAL LOAD                                                             │
│                                                                          │
│ 1. ElementTracker scans → all interactive elements with fingerprints    │
│    (fingerprint.nearestLandmark contains landmark info)                 │
│                                                                          │
│ 2. LandmarkScanner extracts → content by landmark region                │
│    - Headings, text blocks, element references                          │
│    - Aggressive cleaning (remove ads, social, cookies, etc.)            │
│                                                                          │
│ 3. Build LLM prompt → landmark-organized representation (~4K tokens)    │
│    SECTION: Navigation (nav)                                            │
│    - [link id="fp_abc"] Home                                            │
│    - [link id="fp_def"] About                                           │
│    SECTION: Main Content (main)                                         │
│    - [heading] Welcome                                                  │
│    - [text] Introduction paragraph...                                   │
│    - [button id="fp_ghi"] Get Started                                   │
│                                                                          │
│ 4. LLM returns → importance decisions + enhanced labels                 │
│    {                                                                     │
│      "elements": {                                                       │
│        "fp_abc": { "important": true, "label": "Go to Home" },         │
│        "fp_ghi": { "important": true, "label": "Start Registration" }  │
│      },                                                                  │
│      "sections": {                                                       │
│        "nav": { "title": "Navigation", "description": "Main menu" }    │
│      }                                                                   │
│    }                                                                     │
│                                                                          │
│ 5. Render → collapsible sections using UIRenderer components            │
│    - Filter elements by importance                                      │
│    - Apply enhanced labels                                              │
│    - Maintain DOM order within sections                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ ON UPDATE (structure change - new/removed element)                       │
│                                                                          │
│ 1. ElementTracker emits → element-found or element-lost                 │
│                                                                          │
│ 2. For element-found:                                                   │
│    - Get element context (landmark, neighbors, text)                    │
│    - Send to LLM: "Is this important for seniors? Enhance label."       │
│    - LLM returns: { important: true/false, label: "..." }              │
│    - If important: Insert at correct position using landmark            │
│                                                                          │
│ 3. For element-lost:                                                    │
│    - Remove from section immediately                                    │
│    - No LLM call needed                                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ ON UPDATE (text change - label/value changed)                           │
│                                                                          │
│ 1. ElementTracker emits → element-matched with new fingerprint          │
│                                                                          │
│ 2. Compare old vs new text content                                      │
│                                                                          │
│ 3. Update locally → change label in rendered section                    │
│    - No LLM call needed                                                 │
│    - Preserves importance decision from initial load                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Module Structure

```
src/
├── entrypoints/
│   ├── sidepanel/
│   │   ├── App.svelte              # REWRITE - single landmark view
│   │   ├── components/
│   │   │   ├── LandmarkSection.svelte   # NEW - collapsible section
│   │   │   ├── SectionContent.svelte    # NEW - renders blocks in section
│   │   │   └── (keep existing UI components from UIRenderer)
│   │   ├── stores/
│   │   │   └── landmarks.svelte.ts      # NEW - landmark state management
│   │   └── lib/
│   │       └── section-builder.ts       # NEW - builds sections from scan
│   ├── content.ts                  # MODIFY - add landmark scanning
│   └── background.ts               # UNCHANGED
├── utils/
│   ├── element-tracker/            # UNCHANGED
│   ├── dom-scanner.ts              # MODIFY - add landmark extraction
│   ├── landmark-scanner.ts         # NEW - extracts content by landmark
│   ├── dom-cleaner.ts              # NEW - aggressive boilerplate removal
│   ├── llm-service.ts              # MODIFY - new prompts for importance/labels
│   └── page-to-ui.ts               # DELETE - no longer needed
├── lib/
│   ├── schemas/
│   │   ├── accessible-ui.ts        # KEEP - reuse node types
│   │   └── landmark-section.ts     # NEW - section schema
│   └── components/
│       └── ui-renderer/            # KEEP - reuse components
```

### Data Model

```typescript
// stores/landmarks.svelte.ts

/** A landmark section containing page content */
interface LandmarkSection {
  id: string; // Unique section ID
  landmark: string; // nav, main, form, footer, etc.
  title: string; // "Navigation", "Main Content", etc.
  description?: string; // Optional LLM-enhanced description
  expanded: boolean; // Collapsed by default
  itemCount: number; // Badge count
  blocks: ContentBlock[]; // Content in DOM order
}

/** Content block within a section */
type ContentBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'text'; content: string }
  | { type: 'element'; elementId: string; node: UINode }; // References tracked element

/** LLM importance decision for an element */
interface ElementDecision {
  important: boolean;
  label: string; // Enhanced label for seniors
  description?: string; // Optional context
}

/** LLM response for initial page evaluation */
interface LLMPageResponse {
  elements: Record<string, ElementDecision>; // By fingerprint ID
  sections: Record<
    string,
    {
      // By landmark type
      title: string;
      description?: string;
    }
  >;
}

/** LLM response for single element evaluation */
interface LLMElementResponse {
  important: boolean;
  label: string;
  description?: string;
}

/** Page state */
interface PageState {
  url: string;
  loading: boolean;
  error: string | null;
  sections: LandmarkSection[];
  elementDecisions: Map<string, ElementDecision>;
}
```

### DOM Cleaner

```typescript
// utils/dom-cleaner.ts

/** Elements to remove before LLM processing */
const REMOVE_SELECTORS = [
  // Ads
  '[class*="ad-"]',
  '[class*="ads-"]',
  '[id*="google_ads"]',
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',

  // Cookie banners
  '[class*="cookie"]',
  '[class*="consent"]',
  '[id*="gdpr"]',
  '[class*="privacy-banner"]',
  '[aria-label*="cookie"]',

  // Social widgets
  '[class*="social-share"]',
  '[class*="share-button"]',
  '.fb-like',
  '.twitter-share',
  '[class*="linkedin"]',

  // Chat widgets
  '[class*="chat-widget"]',
  '[class*="intercom"]',
  '[class*="zendesk"]',
  '[class*="drift"]',
  '[class*="crisp"]',
  '[id*="hubspot"]',

  // Popups and modals (unless focused)
  '[class*="popup"]:not(:focus-within)',
  '[class*="modal"]:not([aria-modal="true"])',
  '[class*="overlay"]:not(:focus-within)',

  // Empty elements
  ':empty:not(input):not(textarea):not(img):not(br):not(hr)',

  // Hidden elements
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display: none"]',
  '[style*="visibility: hidden"]',

  // Skip links and screen reader only
  '.sr-only',
  '.visually-hidden',
  '[class*="skip-link"]',
];

/** Tags to completely remove (including content) */
const REMOVE_TAGS = ['script', 'style', 'noscript', 'svg', 'canvas'];

export function cleanDOM(root: Element): void {
  // Remove tag types
  for (const tag of REMOVE_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }

  // Remove by selector
  for (const selector of REMOVE_SELECTORS) {
    try {
      root.querySelectorAll(selector).forEach((el) => el.remove());
    } catch {
      // Invalid selector, skip
    }
  }
}
```

### Landmark Scanner

```typescript
// utils/landmark-scanner.ts

const LANDMARK_SELECTORS = [
  'nav',
  'main',
  'aside',
  'header',
  'footer',
  'section',
  'article',
  'form',
  '[role="navigation"]',
  '[role="main"]',
  '[role="complementary"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="region"]',
  '[role="form"]',
  '[role="search"]',
];

interface ScannedLandmark {
  id: string;
  type: string; // nav, main, form, etc.
  element: HTMLElement;
  title: string; // From aria-label, heading, or tag
  blocks: ContentBlock[]; // Headings, text, element refs
}

export function scanLandmarks(
  root: HTMLElement,
  trackedElements: Map<string, TrackedElement>
): ScannedLandmark[] {
  const landmarks: ScannedLandmark[] = [];
  const processedElements = new Set<Element>();

  // Find all landmarks
  const landmarkElements = root.querySelectorAll(LANDMARK_SELECTORS.join(', '));

  for (const element of landmarkElements) {
    if (processedElements.has(element)) continue;

    // Skip nested landmarks (they'll be their own section)
    const nestedLandmarks = element.querySelectorAll(LANDMARK_SELECTORS.join(', '));
    nestedLandmarks.forEach((nested) => processedElements.add(nested));

    const landmark = extractLandmarkContent(
      element as HTMLElement,
      trackedElements,
      processedElements
    );

    if (landmark.blocks.length > 0) {
      landmarks.push(landmark);
    }

    processedElements.add(element);
  }

  // Handle content outside any landmark
  const orphanedContent = extractOrphanedContent(root, processedElements, trackedElements);
  if (orphanedContent.blocks.length > 0) {
    landmarks.unshift({
      id: 'page-content',
      type: 'main',
      element: root,
      title: 'Page Content',
      blocks: orphanedContent.blocks,
    });
  }

  return landmarks;
}

function extractLandmarkContent(
  landmark: HTMLElement,
  trackedElements: Map<string, TrackedElement>,
  excludeElements: Set<Element>
): ScannedLandmark {
  const blocks: ContentBlock[] = [];

  // TreeWalker for DOM-order traversal
  const walker = document.createTreeWalker(landmark, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (excludeElements.has(node as Element)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const text = el.textContent?.trim();
      if (text) {
        blocks.push({
          type: 'heading',
          level: parseInt(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6,
          text: text.slice(0, 200),
        });
      }
      continue;
    }

    // Interactive elements (from tracker)
    const tracked = findTrackedElement(el, trackedElements);
    if (tracked) {
      blocks.push({
        type: 'element',
        elementId: tracked.fingerprint.id,
        node: trackedToUINode(tracked), // Convert to UINode for rendering
      });
      continue;
    }

    // Text blocks
    if (['p', 'li', 'td', 'th', 'figcaption', 'blockquote'].includes(tag)) {
      const text = el.textContent?.trim();
      if (text && text.length > 10) {
        blocks.push({
          type: 'text',
          content: text.slice(0, 500),
        });
      }
    }
  }

  return {
    id: generateLandmarkId(landmark),
    type: getLandmarkType(landmark),
    element: landmark,
    title: getLandmarkTitle(landmark),
    blocks,
  };
}
```

### LLM Service Changes

```typescript
// utils/llm-service.ts - NEW FUNCTIONS

const IMPORTANCE_PROMPT = `You are helping simplify a webpage for seniors (65+).

Given the page content organized by landmark sections, decide which interactive elements are IMPORTANT for a senior to see, and provide enhanced labels that are clear and action-oriented.

CRITERIA FOR IMPORTANCE:
- Primary actions (submit, register, login, search, checkout, buy)
- Essential navigation (home, back, main sections)
- Form fields that must be filled
- Critical information links

EXCLUDE (mark as not important):
- Social media sharing buttons
- Newsletter signup popups
- Chat widgets
- Advertising links
- Secondary navigation (breadcrumbs, pagination beyond page 1-2)
- Developer/admin tools
- Duplicate actions (e.g., multiple "Login" buttons)

LABEL ENHANCEMENT:
- Use clear, action-oriented language
- "Submit" → "Send your registration"
- "Learn more" → "Read about our services"
- Keep labels concise (under 30 characters)

Return JSON:
{
  "elements": {
    "<fingerprint_id>": {
      "important": true/false,
      "label": "Enhanced label for seniors"
    }
  },
  "sections": {
    "<landmark_type>": {
      "title": "Section Title",
      "description": "Brief description (optional)"
    }
  }
}`;

export async function evaluatePageImportance(
  landmarks: ScannedLandmark[]
): Promise<LLMPageResponse> {
  const prompt = formatLandmarksForLLM(landmarks);

  const response = await callLLM({
    system: IMPORTANCE_PROMPT,
    user: prompt,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return parseLLMResponse(response);
}

const ELEMENT_PROMPT = `A new interactive element appeared on a webpage being simplified for seniors.

Decide if this element is IMPORTANT for a senior to see, and if so, provide an enhanced label.

Element context:
- Type: {type}
- Current label: {label}
- Section: {landmark}
- Nearby text: {context}

Return JSON:
{
  "important": true/false,
  "label": "Enhanced label (if important)"
}`;

export async function evaluateNewElement(
  element: TrackedElement,
  context: string
): Promise<LLMElementResponse> {
  const prompt = ELEMENT_PROMPT.replace('{type}', element.fingerprint.tagName)
    .replace('{label}', element.fingerprint.textContent)
    .replace('{landmark}', element.fingerprint.nearestLandmark?.tagName || 'unknown')
    .replace('{context}', context);

  const response = await callLLM({
    system: prompt,
    user: '',
    temperature: 0.2,
    maxTokens: 256,
  });

  return parseLLMResponse(response);
}
```

### Message Protocol Updates

```typescript
// content.ts additions

/** New message type for landmark scanning */
interface ScanLandmarksMessage {
  type: 'SCAN_LANDMARKS';
}

interface ScanLandmarksResponse {
  url: string;
  title: string;
  landmarks: ScannedLandmark[];
  error?: string;
}

// Handler
if (message.type === 'SCAN_LANDMARKS') {
  try {
    // Clean DOM first
    const clone = document.body.cloneNode(true) as HTMLElement;
    cleanDOM(clone);

    // Get tracked elements
    const trackedElements = tracker?.getTrackedElements() || [];
    const trackedMap = new Map(trackedElements.map((t) => [t.fingerprint.id, t]));

    // Scan landmarks
    const landmarks = scanLandmarks(clone, trackedMap);

    sendResponse({
      url: window.location.href,
      title: document.title,
      landmarks,
    });
  } catch (e) {
    sendResponse({
      url: window.location.href,
      title: document.title,
      landmarks: [],
      error: e instanceof Error ? e.message : 'Scan failed',
    });
  }
  return;
}
```

### Svelte Components

```svelte
<!-- components/LandmarkSection.svelte -->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { ChevronRight, ChevronDown } from 'lucide-svelte';
  import { Badge } from '$lib/components/ui/badge';
  import SectionContent from './SectionContent.svelte';

  interface Props {
    section: LandmarkSection;
    onToggle: (sectionId: string) => void;
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
  }

  let { section, onToggle, onAction, onInputChange, onToggleCheckbox, onSelectChange }: Props =
    $props();
</script>

<div class="landmark-section border-b">
  <button
    class="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
    onclick={() => onToggle(section.id)}
    aria-expanded={section.expanded}
  >
    <div class="flex items-center gap-2">
      {#if section.expanded}
        <ChevronDown class="h-4 w-4" />
      {:else}
        <ChevronRight class="h-4 w-4" />
      {/if}
      <span class="font-medium">{section.title}</span>
    </div>
    <Badge variant="secondary">{section.itemCount} items</Badge>
  </button>

  {#if section.expanded}
    <div class="px-4 pb-4" transition:slide={{ duration: 200 }}>
      {#if section.description}
        <p class="text-sm text-muted-foreground mb-4">{section.description}</p>
      {/if}
      <SectionContent
        blocks={section.blocks}
        {onAction}
        {onInputChange}
        {onToggleCheckbox}
        {onSelectChange}
      />
    </div>
  {/if}
</div>
```

## Implementation Plan

### Phase 1: DOM Cleaning & Landmark Extraction

1. [ ] Create `utils/dom-cleaner.ts` with aggressive cleaning rules
2. [ ] Create `utils/landmark-scanner.ts` with landmark extraction
3. [ ] Add `SCAN_LANDMARKS` message handler to content.ts
4. [ ] Unit tests for cleaning and landmark extraction

### Phase 2: LLM Integration Changes

5. [ ] Add `evaluatePageImportance()` to llm-service.ts
6. [ ] Add `evaluateNewElement()` for incremental updates
7. [ ] Create importance/label prompts for seniors
8. [ ] Add response parsing with Zod validation
9. [ ] Unit tests for LLM response parsing

### Phase 3: State Management

10. [ ] Create `stores/landmarks.svelte.ts` with Svelte 5 runes
11. [ ] Implement section toggle (expand/collapse)
12. [ ] Implement element filtering by importance
13. [ ] Implement local text change updates

### Phase 4: UI Components

14. [ ] Create `LandmarkSection.svelte` component
15. [ ] Create `SectionContent.svelte` component
16. [ ] Integrate existing UIRenderer components for elements
17. [ ] Add slide transitions for expand/collapse

### Phase 5: App.svelte Rewrite

18. [ ] Remove Read tab and tabs component
19. [ ] Replace with landmark sections list
20. [ ] Wire up message handlers for SCAN_LANDMARKS
21. [ ] Wire up LLM evaluation on load
22. [ ] Handle incremental updates (element-found, element-lost)

### Phase 6: Incremental Updates

23. [ ] Handle element-found → evaluate with LLM → insert at position
24. [ ] Handle element-lost → remove immediately
25. [ ] Handle text changes → update label locally
26. [ ] Add debouncing for rapid changes (300ms)

### Phase 7: Cleanup & Polish

27. [ ] Delete `page-to-ui.ts` (no longer needed)
28. [ ] Remove UIRenderer generic rendering (keep components only)
29. [ ] Add loading states per section
30. [ ] Add error handling with retry
31. [ ] Performance optimization (virtualization for large sections)

### Phase 8: Testing

32. [ ] Integration tests for full flow
33. [ ] Test with aggressive mutation sites (React re-renders)
34. [ ] Test LLM fallback when unavailable
35. [ ] Accessibility testing with screen readers

## Test Plan

### Unit Tests

```typescript
// dom-cleaner.test.ts
describe('cleanDOM', () => {
  it('removes ad elements by class');
  it('removes cookie consent banners');
  it('removes social share widgets');
  it('removes chat widgets');
  it('removes empty elements except allowed tags');
  it('preserves main content');
  it('preserves form elements');
});

// landmark-scanner.test.ts
describe('scanLandmarks', () => {
  it('extracts nav landmark with links');
  it('extracts main landmark with content');
  it('extracts form landmark with inputs');
  it('handles nested landmarks (form inside main)');
  it('handles page with no landmarks');
  it('preserves DOM order within sections');
  it('includes tracked elements as element blocks');
});

// llm-service.test.ts
describe('evaluatePageImportance', () => {
  it('parses valid LLM response');
  it('handles missing elements gracefully');
  it('applies fallback for invalid response');
});
```

### Integration Tests

```typescript
describe('Landmark-based Sidebar', () => {
  it('shows all landmark sections collapsed by default');
  it('expands section on click');
  it('shows correct item count badge');
  it('filters elements by LLM importance decision');
  it('applies enhanced labels from LLM');
  it('updates locally when element text changes');
  it('adds new element after LLM evaluation');
  it('removes element immediately when lost');
  it('syncs form input values to page');
  it('works without LLM (shows all elements, raw labels)');
});
```

### Manual Testing Checklist

- [ ] Load on news article site - verify landmark extraction
- [ ] Load on e-commerce site - verify form sections
- [ ] Load on React SPA - verify fingerprinting survives re-renders
- [ ] Test with LLM API key removed - verify fallback
- [ ] Test section expand/collapse animations
- [ ] Test form input sync (type in sidebar → appears on page)
- [ ] Test button clicks forward correctly
- [ ] Screen reader testing (VoiceOver/NVDA)

## Open Questions

_None - all questions resolved during discovery._

## Decision Log

| Decision                                  | Rationale                                               | Date       |
| ----------------------------------------- | ------------------------------------------------------- | ---------- |
| Show all landmarks with content           | Seniors see full page structure, can explore            | 2025-01-31 |
| Mirror page structure exactly             | Research: hierarchy is most important for understanding | 2025-01-31 |
| LLM filters importance + enhances labels  | Balance between AI help and structural preservation     | 2025-01-31 |
| Aggressive DOM cleaning                   | Reduce token cost, remove distractions                  | 2025-01-31 |
| Text changes local, structure changes LLM | Minimize latency for common updates                     | 2025-01-31 |
| Reuse UIRenderer components               | Leverage existing shadcn-based components               | 2025-01-31 |
| All sections collapsed by default         | Reduce cognitive load, show outline first               | 2025-01-31 |
| Remove elements immediately when lost     | No confusing "unavailable" states                       | 2025-01-31 |
| Remove Read tab                           | Single unified view organized by landmarks              | 2025-01-31 |

## References

- Research: `research/2-dom-extraction.md` - DOM hierarchy importance
- Research: `research/0-general.md` - Senior UX guidelines
- Existing spec: `specs/sidebar-integration.md` - Original vision
- ElementTracker: `src/utils/element-tracker/` - Fingerprinting system
- UIRenderer: `src/lib/components/ui-renderer/` - Reusable components
