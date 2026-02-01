# Feature: Unified Sidebar with Element Tracking Integration

> A completely refactored sidebar that renders a simplified, accessible copy of web pages for seniors, using stable ElementTracker fingerprint IDs to enable reliable click forwarding even after complete DOM destruction/recreation by React/Vue/Angular.

## Overview

The sidebar provides seniors with a distraction-free, accessible interface to interact with websites. It accurately reflects the page hierarchy with unified elements for navigation, search, titles, text, and collapsible sections. Interactive elements (buttons, links, form inputs) use the ElementTracker's stable fingerprint IDs to survive framework re-renders.

**Key Differentiators from Current Implementation:**

- Single unified mode (replaces READ/ACCESSIBLE split)
- Form inputs mirrored bidirectionally in sidebar with real-time sync
- Collapsible sections for reduced cognitive load
- Only high-confidence (>0.8) elements displayed
- Granular incremental updates (only changed elements regenerated)
- Clean linear flow design (minimal visual chrome)

### Research Foundation

| Source                       | Insight Applied                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **0-general.md**             | 18px+ fonts, 7:1 contrast, 44x44px touch targets, visible labels over icons, 5-7 max nav items |
| **1-tech-stack.md**          | Svelte 5 + Tailwind, WXT bundler, Zustand-style reactivity                                     |
| **2-dom-extraction.md**      | Readability.js for article extraction, **hierarchy is most important UI feature for LLM**      |
| **3-element-tracking.md**    | Multi-attribute fingerprints, 0.6 confidence threshold, WeakRef pattern                        |
| **element-tracking.md spec** | Full TrackedElement/Fingerprint types, double-RAF batching, grace periods                      |
| **Teammates' approach**      | LLM generates UI structure, actionBinding links to page elements, change classification        |

### Core Architecture Decision: LLM-Driven Importance Selection

**The Problem:** Current approach tracks ALL interactive elements and dumps them into the sidebar. A page with 50 buttons shows 50 buttons. That's not simplification.

**The Solution:** LLM decides what's important. We use stable ElementTracker fingerprints for reliable element references.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INITIAL LOAD                                                             │
│                                                                          │
│ 1. ElementTracker scans page → tracks ALL interactive elements          │
│ 2. DOM Scanner extracts content → headings, text, landmarks             │
│ 3. Build page representation → Markdown + element inventory (~4K tokens)│
│ 4. Send to LLM: "For a senior, which elements are important?"           │
│ 5. LLM returns: { importantIds: [...], sections: [...], summary: "..." }│
│ 6. Sidebar renders ONLY the important elements                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ ON DOM UPDATE (element text changes, new elements appear)               │
│                                                                          │
│ 1. ElementTracker emits event (element-matched, element-found, etc.)    │
│ 2. Classify change:                                                      │
│    - MINOR (text change, value change): Apply heuristic immediately     │
│    - NEW CONTEXT (modal, form section): Queue for LLM re-evaluation     │
│ 3. For minor changes: Update UI optimistically                          │
│ 4. For new context: Call LLM in background, merge results               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why This Approach:**

- ElementTracker provides **stable IDs** that survive DOM destruction (unlike `data-acc-id`)
- LLM decides **what matters** for seniors (not everything that's interactive)
- Incremental updates avoid full rescan latency
- Heuristic fallback ensures responsiveness when LLM is slow

## Requirements

### Functional Requirements

- [ ] FR1: Render page content in a single unified view that reflects the original page hierarchy
- [ ] FR2: Display collapsible sections for each major page region (header, main, form sections, footer)
- [ ] FR3: Show only elements with confidence > 0.8; hide 'searching' and low-confidence elements
- [ ] FR4: Mirror form inputs (text, email, password, select, textarea, checkbox, radio) bidirectionally
- [ ] FR5: Sync input values to original page in real-time (each keystroke) with input event dispatch
- [ ] FR6: Forward button/link clicks to original elements via `tracker.clickElement(id)`
- [ ] FR7: Cache LLM summary; regenerate only when significant content changes detected
- [ ] FR8: Subscribe to ElementTracker events for granular incremental updates
- [ ] FR9: Display AI-generated summary at top (2-3 sentences for quick understanding)
- [ ] FR10: Show "priority actions" (LLM-identified key tasks) prominently below summary
- [ ] FR11: Render headings, paragraphs, lists in clean linear flow with senior-friendly typography

### Non-Functional Requirements

- [ ] NFR1: Typography: 18px minimum body text, 7:1 contrast ratio, 1.5+ line height
- [ ] NFR2: Touch targets: 44x44px minimum for all interactive elements
- [ ] NFR3: Performance: Sidebar render < 200ms after receiving data
- [ ] NFR4: Accessibility: Full keyboard navigation, proper focus management, ARIA labels
- [ ] NFR5: Memory: Sidebar state < 2MB per tab (tracked elements + cached content)
- [ ] NFR6: Real-time sync: Input value sync < 50ms latency
- [ ] NFR7: Update responsiveness: UI reflects tracker changes within 100ms

## User Experience

### Unified Layout Structure

```
┌─────────────────────────────────────────┐
│ HEADER                                   │
│ ├─ "Klaro" logo/title                   │
│ ├─ Page domain badge                    │
│ └─ Refresh button                       │
├─────────────────────────────────────────┤
│ AI SUMMARY CARD                          │
│ "This page lets you register for the    │
│  AI Hackathon. Key actions: Register,   │
│  View Schedule, Check Prizes."          │
├─────────────────────────────────────────┤
│ PRIORITY ACTIONS                         │
│ ├─ [Register Now]     (button)          │
│ ├─ [View Schedule]    (button)          │
│ └─ [Check Prizes]     (button)          │
├─────────────────────────────────────────┤
│ PAGE CONTENT (collapsible sections)      │
│                                          │
│ ▼ Navigation                  [3 items] │
│   ├─ About (link)                       │
│   ├─ Schedule (link)                    │
│   └─ Prizes (link)                      │
│                                          │
│ ▶ Main Content               [5 items] │
│   (collapsed - click to expand)         │
│                                          │
│ ▶ Registration Form          [4 fields] │
│   (collapsed - click to expand)         │
│                                          │
│ ▶ Footer                     [2 links]  │
│   (collapsed - click to expand)         │
└─────────────────────────────────────────┘
```

### Section Expansion (Example: Form)

```
▼ Registration Form                [4 fields]
  ┌───────────────────────────────────────┐
  │ Full Name                             │
  │ ┌─────────────────────────────────┐   │
  │ │ Enter your full name            │   │
  │ └─────────────────────────────────┘   │
  ├───────────────────────────────────────┤
  │ Email Address                         │
  │ ┌─────────────────────────────────┐   │
  │ │ your@email.com                  │   │
  │ └─────────────────────────────────┘   │
  ├───────────────────────────────────────┤
  │ Experience Level                      │
  │ ┌─────────────────────────────────┐   │
  │ │ Beginner              ▼        │   │
  │ └─────────────────────────────────┘   │
  ├───────────────────────────────────────┤
  │ [Submit Registration]    (button)     │
  └───────────────────────────────────────┘
```

### UI States

**Loading:**

- Centered spinner with "Loading page..." text
- Skeleton placeholders for sections

**Empty/Error:**

- Clear error message with "Try Again" button
- Helpful hint text explaining possible causes

**No Actions Found:**

- "This page doesn't have interactive elements we can simplify"
- Option to switch to article/reading mode

**Element Searching:**

- Element hidden from view (FR3: only show >0.8 confidence)
- If critical action becomes unavailable, show inline message

**Form Input Sync:**

- Real-time value updates with subtle visual feedback
- Error states mirrored from page validation

### Edge Cases

| Scenario                                    | Expected Behavior                                                   |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Element lost after user sees it             | Remove from sidebar, don't show error unless user tries to interact |
| Element re-identified with lower confidence | Hide if drops below 0.8, restore when confidence returns            |
| Form validation error on page               | Mirror validation styling (red border, error message if detectable) |
| Page has no main content                    | Show available actions only, skip summary section                   |
| Very long page (100+ sections)              | Virtualized list, only render visible sections                      |
| Modal opens on page                         | Detect new interactive region, add as new section                   |
| SPA navigation                              | Full rescan + regenerate summary (treat as new page)                |
| Multiple forms on page                      | Each form as separate collapsible section                           |
| Password fields                             | Render as password input in sidebar (dots), sync masked             |
| Checkbox/radio groups                       | Render as fieldset with grouped options                             |

## Technical Design

### Module Architecture

```
src/
├── entrypoints/
│   ├── sidepanel/
│   │   ├── App.svelte              # Root component (REWRITE)
│   │   ├── components/
│   │   │   ├── Header.svelte       # Logo, domain, refresh
│   │   │   ├── SummaryCard.svelte  # AI summary display
│   │   │   ├── PriorityActions.svelte # Top 3-5 actions
│   │   │   ├── ContentSection.svelte  # Collapsible region
│   │   │   ├── ActionButton.svelte    # Clickable button/link
│   │   │   ├── FormInput.svelte       # Mirrored input field
│   │   │   ├── SelectInput.svelte     # Mirrored select
│   │   │   ├── CheckboxGroup.svelte   # Radio/checkbox group
│   │   │   └── LoadingState.svelte    # Loading/error states
│   │   ├── stores/
│   │   │   ├── page.svelte.ts      # Svelte 5 runes store for page state
│   │   │   └── tracker.svelte.ts   # Reactive wrapper for tracker events
│   │   ├── lib/
│   │   │   ├── section-builder.ts  # Build sections from pageCopy
│   │   │   └── input-sync.ts       # Form input synchronization
│   │   ├── main.ts
│   │   ├── index.html
│   │   └── app.css
│   ├── content.ts                   # MODIFY: Enhanced message handlers
│   └── background.ts                # UNCHANGED
├── utils/
│   ├── element-tracker/             # UNCHANGED (already implemented)
│   ├── dom-scanner.ts               # MODIFY: New scanning functions
│   └── llm-service.ts               # MODIFY: Incremental regeneration
```

### Data Model

```typescript
// stores/page.svelte.ts

/** Page state managed with Svelte 5 runes */
interface PageState {
  // Metadata
  url: string;
  domain: string;
  title: string;

  // AI Summary
  summary: string;
  summaryLoading: boolean;
  summaryError: string | null;

  // Priority actions (LLM-identified)
  priorityActionIds: string[];

  // Page structure
  sections: PageSection[];

  // All tracked elements (from ElementTracker)
  elements: Map<string, SidebarElement>;

  // Loading/error state
  loading: boolean;
  error: string | null;
}

/** A collapsible section of the page */
interface PageSection {
  id: string;
  name: string; // "Navigation", "Main Content", "Registration Form"
  landmark: string; // nav, main, form, footer, section
  expanded: boolean;
  itemCount: number; // Count of items inside (for collapsed preview)
  blocks: PageBlock[]; // Content blocks in this section
}

/** Content block within a section */
type PageBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'text'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'action'; elementId: string } // Reference to SidebarElement
  | { type: 'input'; elementId: string } // Reference to SidebarElement
  | { type: 'select'; elementId: string }
  | { type: 'checkbox-group'; elementIds: string[]; label: string }
  | { type: 'radio-group'; elementIds: string[]; label: string; name: string };

/** Sidebar representation of a tracked element */
interface SidebarElement {
  id: string; // Fingerprint ID from ElementTracker
  type: 'button' | 'link' | 'input' | 'select' | 'textarea' | 'checkbox' | 'radio';
  label: string; // Visible text/aria-label
  confidence: number; // Match confidence from tracker
  status: 'active' | 'searching' | 'lost';

  // For inputs
  value?: string; // Current value (synced)
  placeholder?: string;
  inputType?: string; // text, email, password, etc.
  required?: boolean;
  disabled?: boolean;

  // For selects
  options?: Array<{ value: string; label: string; selected: boolean }>;

  // For checkboxes/radios
  checked?: boolean;
  name?: string; // Group name for radios
}
```

### Enhanced Message Protocol

```typescript
// content.ts additions

/** Enhanced SCAN_PAGE response */
interface ScanPageResponse {
  // Metadata
  url: string;
  domain: string;
  title: string;

  // Structured content (for LLM and display)
  sections: SectionData[];

  // All tracked elements with full details
  elements: TrackedElementData[];

  // Error handling
  error?: string;
}

interface SectionData {
  id: string;
  name: string;
  landmark: string;
  blocks: BlockData[];
}

interface BlockData {
  type: 'heading' | 'text' | 'list' | 'action' | 'input' | 'select' | 'checkbox' | 'radio';
  // Type-specific fields...
  elementId?: string; // Reference to element in elements array
}

interface TrackedElementData {
  id: string;
  type: string;
  label: string;
  confidence: number;
  status: 'active' | 'searching' | 'lost';
  value?: string;
  placeholder?: string;
  inputType?: string;
  options?: SelectOption[];
  checked?: boolean;
  name?: string;
  required?: boolean;
  disabled?: boolean;
}

/** New message: Sync input value to page */
interface SyncInputMessage {
  type: 'SYNC_INPUT';
  elementId: string;
  value: string;
  eventType: 'input' | 'change' | 'blur';
}

/** New message: Granular element update */
interface ElementUpdateMessage {
  type: 'ELEMENT_UPDATE';
  updates: Array<{
    id: string;
    action: 'added' | 'updated' | 'removed';
    data?: TrackedElementData;
  }>;
}
```

### Section Building Logic

```typescript
// lib/section-builder.ts

/**
 * Build PageSection[] from raw page data.
 * Groups content by landmark elements (nav, main, form, footer, section).
 */
function buildSections(blocks: BlockData[], elements: Map<string, SidebarElement>): PageSection[] {
  const sections: PageSection[] = [];
  let currentSection: PageSection | null = null;

  for (const block of blocks) {
    // Detect section boundaries from landmarks
    if (isLandmarkStart(block)) {
      if (currentSection) sections.push(currentSection);
      currentSection = createSection(block);
    }

    // Add block to current section
    if (currentSection) {
      // Filter: only include actions with confidence > 0.8
      if (block.type === 'action' || block.type === 'input') {
        const element = elements.get(block.elementId!);
        if (!element || element.confidence < 0.8 || element.status !== 'active') {
          continue; // Skip low-confidence elements
        }
      }
      currentSection.blocks.push(block);
      currentSection.itemCount++;
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}
```

### Form Input Synchronization

```typescript
// lib/input-sync.ts

/**
 * Real-time bidirectional sync between sidebar inputs and page inputs.
 */
class InputSyncManager {
  private pending = new Map<string, NodeJS.Timeout>();

  /**
   * Handle sidebar input change - sync to page immediately.
   * Dispatches 'input' event on each keystroke.
   */
  async syncToPage(elementId: string, value: string): Promise<void> {
    // Cancel pending debounce for this element
    const existing = this.pending.get(elementId);
    if (existing) clearTimeout(existing);

    // Send immediately (no debounce for real-time requirement)
    await browser.tabs.sendMessage(await getActiveTabId(), {
      type: 'SYNC_INPUT',
      elementId,
      value,
      eventType: 'input',
    });
  }

  /**
   * Handle blur - send 'change' event for validation triggers.
   */
  async syncOnBlur(elementId: string, value: string): Promise<void> {
    await browser.tabs.sendMessage(await getActiveTabId(), {
      type: 'SYNC_INPUT',
      elementId,
      value,
      eventType: 'change',
    });
  }
}

// content.ts handler
if (message.type === 'SYNC_INPUT') {
  const element = tracker.getElementById(message.elementId) as HTMLInputElement;
  if (element) {
    element.value = message.value;
    element.dispatchEvent(new Event(message.eventType, { bubbles: true }));
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false, error: 'Element not found' });
  }
  return;
}
```

### LLM Importance Selection (Core Feature)

This is the heart of the simplification logic. The LLM decides what's important for seniors.

#### What We Send to LLM (Initial Load)

```typescript
// llm-service.ts

interface LLMInput {
  // Page metadata
  url: string;
  title: string;

  // Content structure (Markdown format, ~2K tokens)
  contentMarkdown: string;

  // ALL tracked elements with fingerprint IDs (~1-2K tokens)
  elements: Array<{
    id: string; // Fingerprint ID (stable)
    type: string; // button, link, input, select, etc.
    label: string; // Visible text
    section: string; // Which landmark it's in (nav, main, form, footer)
    context: string; // Surrounding text (neighbor context from fingerprint)
  }>;
}

function formatForLLM(
  title: string,
  url: string,
  sections: SectionData[],
  elements: TrackedElementData[]
): string {
  const parts: string[] = [];

  parts.push(`PAGE: ${title}`);
  parts.push(`URL: ${url}`);
  parts.push('');

  // Content structure with headings
  parts.push('CONTENT STRUCTURE:');
  for (const section of sections) {
    parts.push(`\n## ${section.name} (${section.landmark})`);
    for (const block of section.blocks) {
      if (block.type === 'heading') {
        parts.push(`${'#'.repeat(block.level + 1)} ${block.text}`);
      } else if (block.type === 'text') {
        parts.push(block.content.slice(0, 200));
      }
    }
  }

  // Element inventory with IDs
  parts.push('\n\nINTERACTIVE ELEMENTS (use id for selection):');
  for (const el of elements) {
    parts.push(`- id="${el.id}" [${el.type}] "${el.label}" in ${el.section}`);
  }

  return parts.join('\n');
}
```

#### What We Expect Back from LLM

```typescript
interface LLMResponse {
  // 2-3 sentence summary for seniors
  summary: string;

  // Which elements are important (by fingerprint ID)
  importantElementIds: string[];

  // Optional: how to group/organize the important elements
  sections?: Array<{
    name: string; // "Getting Started", "Account Options", etc.
    description?: string; // Brief explanation for seniors
    elementIds: string[]; // Elements in this section
  }>;

  // Optional: priority ranking for "quick actions" display
  priorityElementIds?: string[]; // Top 3-5 most important
}
```

#### LLM System Prompt

```typescript
const IMPORTANCE_SYSTEM_PROMPT = `You are helping simplify a webpage for seniors (65+).

Given a page's content and interactive elements, decide which elements are IMPORTANT for a senior to see.

CRITERIA FOR IMPORTANCE:
- Primary actions (submit, register, search, login, checkout)
- Essential navigation (home, back, main sections)
- Form fields that must be filled
- Critical information (prices, dates, confirmations)

EXCLUDE (not important for seniors):
- Social media sharing buttons
- Newsletter popups
- Chat widgets
- Advertising
- Secondary navigation (breadcrumbs, pagination beyond 1-2)
- Developer tools (inspect, console)
- Cookie consent (handle separately)

GUIDELINES:
- Maximum 10-15 important elements per page
- Group related elements logically
- Prioritize task completion over exploration
- If page has a clear primary action, make it the top priority

Return JSON with:
{
  "summary": "2-3 sentence explanation of what this page does and key actions",
  "importantElementIds": ["id1", "id2", ...],
  "priorityElementIds": ["id1", "id2", "id3"],  // Top 3-5 for quick access
  "sections": [
    { "name": "Section Name", "elementIds": ["id1", "id2"] }
  ]
}`;
```

#### Change Classification and Update Strategy

```typescript
// lib/change-classifier.ts

type ChangeType = 'minor' | 'new-context' | 'navigation';

interface ClassifiedChange {
  type: ChangeType;
  affectedElementIds: string[];
  description: string;
  requiresLLM: boolean;
}

/**
 * Classify a change to determine how to handle it.
 * Based on ElementTracker events.
 */
function classifyChange(event: TrackerEvent): ClassifiedChange {
  switch (event.type) {
    case 'element-matched':
      // Element re-identified after re-render
      // If text changed significantly, might need LLM re-eval
      const textSimilarity = calculateTextSimilarity(
        event.fingerprint.textContent,
        getNewText(event.element)
      );

      if (textSimilarity > 0.8) {
        // Minor text change (e.g., "Register" → "Register Now")
        return {
          type: 'minor',
          affectedElementIds: [event.fingerprint.id],
          description: 'Element text slightly changed',
          requiresLLM: false,
        };
      } else {
        // Significant text change - might affect importance
        return {
          type: 'minor',
          affectedElementIds: [event.fingerprint.id],
          description: 'Element text changed significantly',
          requiresLLM: true, // Re-evaluate this element's importance
        };
      }

    case 'element-found':
      // New element appeared
      // Check if it's in a new context (modal, popup, new section)
      if (isInNewContext(event.element)) {
        return {
          type: 'new-context',
          affectedElementIds: [event.fingerprint.id],
          description: 'New interactive context appeared (modal/section)',
          requiresLLM: true,
        };
      }
      return {
        type: 'minor',
        affectedElementIds: [event.fingerprint.id],
        description: 'New element appeared',
        requiresLLM: false, // Use heuristic: show if in important section
      };

    case 'element-lost':
      // Element disappeared - just remove from UI
      return {
        type: 'minor',
        affectedElementIds: [event.fingerprint.id],
        description: 'Element removed',
        requiresLLM: false,
      };

    case 'elements-updated':
      // Batch update - check for navigation
      if (urlChanged()) {
        return {
          type: 'navigation',
          affectedElementIds: event.added.map((f) => f.id),
          description: 'Page navigation detected',
          requiresLLM: true, // Full re-evaluation
        };
      }
      return {
        type: 'minor',
        affectedElementIds: [...event.added, ...event.updated].map((f) => f.id),
        description: 'Batch element update',
        requiresLLM: false,
      };
  }
}

/**
 * Detect if element is in a "new context" (modal, popup, new section)
 */
function isInNewContext(element: HTMLElement): boolean {
  // Check for modal/dialog
  const dialog = element.closest(
    '[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]'
  );
  if (dialog) return true;

  // Check for high z-index overlay
  const style = window.getComputedStyle(element);
  const zIndex = parseInt(style.zIndex, 10);
  if (zIndex > 100 && (style.position === 'fixed' || style.position === 'absolute')) {
    return true;
  }

  // Check for popup class patterns
  if (element.closest('[class*="modal"], [class*="popup"], [class*="overlay"]')) {
    return true;
  }

  return false;
}
```

#### Heuristic Fallback (When LLM Unavailable)

```typescript
// lib/heuristic-importance.ts

/**
 * Determine element importance using heuristics when LLM is unavailable.
 * Based on research: forms, primary actions, main navigation are important.
 */
function heuristicImportance(elements: TrackedElementData[]): string[] {
  const important: string[] = [];

  const PRIORITY_KEYWORDS = [
    // Primary actions
    'submit',
    'register',
    'sign up',
    'login',
    'sign in',
    'search',
    'buy',
    'checkout',
    'add to cart',
    'continue',
    'next',
    'confirm',
    // Navigation
    'home',
    'back',
    'menu',
    'help',
    'contact',
    // Forms are always important
  ];

  const EXCLUDE_KEYWORDS = [
    'share',
    'tweet',
    'facebook',
    'instagram',
    'linkedin',
    'subscribe',
    'newsletter',
    'cookie',
    'chat',
    'feedback',
  ];

  for (const el of elements) {
    const label = el.label.toLowerCase();

    // Exclude social/marketing elements
    if (EXCLUDE_KEYWORDS.some((kw) => label.includes(kw))) {
      continue;
    }

    // Include form inputs (always important for task completion)
    if (['input', 'select', 'textarea'].includes(el.type)) {
      important.push(el.id);
      continue;
    }

    // Include priority keywords
    if (PRIORITY_KEYWORDS.some((kw) => label.includes(kw))) {
      important.push(el.id);
      continue;
    }

    // Include elements in main/form landmarks
    if (el.section === 'main' || el.section === 'form') {
      important.push(el.id);
    }
  }

  // Limit to top 15
  return important.slice(0, 15);
}

/**
 * Get priority actions using heuristics.
 */
function heuristicPriorityActions(elements: TrackedElementData[]): string[] {
  const PRIMARY_PATTERNS = [
    /^(register|sign up|get started|join)/i,
    /^(login|sign in)/i,
    /^(search)/i,
    /^(submit|send|confirm)/i,
    /^(buy|checkout|add to cart)/i,
  ];

  const priorities: string[] = [];

  for (const pattern of PRIMARY_PATTERNS) {
    const match = elements.find((el) => pattern.test(el.label));
    if (match && !priorities.includes(match.id)) {
      priorities.push(match.id);
    }
  }

  return priorities.slice(0, 5);
}
```

### Incremental LLM Updates

```typescript
// llm-service.ts modifications

/**
 * Check if page content changed significantly enough to regenerate summary.
 * Uses content hash comparison.
 */
function shouldRegenerateSummary(oldContent: string, newContent: string): boolean {
  // Compare content hashes
  const oldHash = simpleHash(normalizeForComparison(oldContent));
  const newHash = simpleHash(normalizeForComparison(newContent));

  if (oldHash === newHash) return false;

  // Calculate similarity - regenerate if < 80% similar
  const similarity = textSimilarity(
    normalizeForComparison(oldContent),
    normalizeForComparison(newContent)
  );

  return similarity < 0.8;
}

/**
 * Regenerate priority actions when element list changes.
 * Much lighter than full summary regeneration.
 */
async function regeneratePriorityActions(actions: TrackedElementData[]): Promise<string[]> {
  // Use heuristic for fast updates (no API call)
  return heuristicPriorityActions(actions);
}
```

### DOM Scanner Modifications

```typescript
// dom-scanner.ts additions

/**
 * Scan page and build structured sections with landmark detection.
 * Returns data ready for sidebar consumption.
 */
export function scanPageStructured(trackedElements: Map<string, TrackedElement>): ScanPageResponse {
  const url = window.location.href;
  const domain = window.location.hostname;
  const title = document.title;

  // Find all landmark elements
  const landmarks = findLandmarks(document.body);

  // Build sections from landmarks
  const sections = landmarks.map((landmark) => ({
    id: generateSectionId(landmark),
    name: getLandmarkName(landmark),
    landmark: landmark.tagName.toLowerCase(),
    blocks: extractBlocksFromLandmark(landmark, trackedElements),
  }));

  // Convert tracked elements to sidebar format
  const elements = Array.from(trackedElements.values())
    .filter((t) => t.status !== 'lost')
    .map((t) => trackedToSidebarElement(t));

  return { url, domain, title, sections, elements };
}

function findLandmarks(root: HTMLElement): HTMLElement[] {
  const selectors = [
    'nav',
    'main',
    'header',
    'footer',
    'aside',
    'form',
    'section',
    'article',
    '[role="navigation"]',
    '[role="main"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    '[role="form"]',
  ];

  return Array.from(root.querySelectorAll(selectors.join(', ')));
}

function getLandmarkName(element: HTMLElement): string {
  // Priority: aria-label > heading inside > tag-based name
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const heading = element.querySelector('h1, h2, h3');
  if (heading) return heading.textContent?.trim().slice(0, 50) || 'Section';

  const tagNames: Record<string, string> = {
    nav: 'Navigation',
    main: 'Main Content',
    header: 'Header',
    footer: 'Footer',
    aside: 'Sidebar',
    form: 'Form',
    section: 'Section',
    article: 'Article',
  };

  return tagNames[element.tagName.toLowerCase()] || 'Section';
}
```

### Svelte 5 Store Pattern

```typescript
// stores/page.svelte.ts

import { getContext, setContext } from 'svelte';

const PAGE_STATE_KEY = Symbol('page-state');

export function createPageState() {
  // Svelte 5 runes for reactive state
  let url = $state('');
  let domain = $state('');
  let title = $state('');
  let summary = $state('');
  let summaryLoading = $state(false);
  let priorityActionIds = $state<string[]>([]);
  let sections = $state<PageSection[]>([]);
  let elements = $state(new Map<string, SidebarElement>());
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Derived: get priority action elements
  const priorityActions = $derived(
    priorityActionIds
      .map((id) => elements.get(id))
      .filter(
        (e): e is SidebarElement => e !== undefined && e.confidence > 0.8 && e.status === 'active'
      )
  );

  // Derived: filter sections to only show high-confidence elements
  const filteredSections = $derived(
    sections.map((section) => ({
      ...section,
      blocks: section.blocks.filter((block) => {
        if (block.type !== 'action' && block.type !== 'input') return true;
        const el = elements.get(block.elementId!);
        return el && el.confidence > 0.8 && el.status === 'active';
      }),
      itemCount: section.blocks.filter(/* same filter */).length,
    }))
  );

  return {
    // State (readable)
    get url() {
      return url;
    },
    get domain() {
      return domain;
    },
    get title() {
      return title;
    },
    get summary() {
      return summary;
    },
    get summaryLoading() {
      return summaryLoading;
    },
    get priorityActions() {
      return priorityActions;
    },
    get sections() {
      return filteredSections;
    },
    get elements() {
      return elements;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },

    // Actions
    async loadPage() {
      loading = true;
      error = null;

      try {
        const response = await browser.tabs.sendMessage(await getActiveTabId(), {
          type: 'SCAN_PAGE',
        });

        if (response.error) throw new Error(response.error);

        url = response.url;
        domain = response.domain;
        title = response.title;
        sections = response.sections;
        elements = new Map(response.elements.map((e) => [e.id, e]));

        // Start LLM summary generation
        summaryLoading = true;
        const llmResult = await getLLMSimplification(response.sections, response.elements);
        summary = llmResult.summary;
        priorityActionIds = llmResult.priorityIds;
        summaryLoading = false;
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load page';
      } finally {
        loading = false;
      }
    },

    // Handle granular element updates from tracker
    updateElement(id: string, data: Partial<SidebarElement>) {
      const existing = elements.get(id);
      if (existing) {
        elements.set(id, { ...existing, ...data });
        elements = new Map(elements); // Trigger reactivity
      }
    },

    removeElement(id: string) {
      elements.delete(id);
      elements = new Map(elements);
    },

    toggleSection(sectionId: string) {
      sections = sections.map((s) => (s.id === sectionId ? { ...s, expanded: !s.expanded } : s));
    },

    // Update input value (for form sync)
    updateInputValue(elementId: string, value: string) {
      const el = elements.get(elementId);
      if (el) {
        elements.set(elementId, { ...el, value });
        elements = new Map(elements);
      }
    },
  };
}

export function getPageState() {
  return getContext<ReturnType<typeof createPageState>>(PAGE_STATE_KEY);
}

export function setPageState(state: ReturnType<typeof createPageState>) {
  setContext(PAGE_STATE_KEY, state);
}
```

## Implementation Plan

### Phase 1: Data Layer Foundation

1. [ ] Create `stores/page.svelte.ts` with Svelte 5 runes
2. [ ] Add `ScanPageResponse` types to `dom-scanner.ts`
3. [ ] Implement `scanPageStructured()` with landmark detection
4. [ ] Create `lib/section-builder.ts` for section grouping
5. [ ] Update content.ts `SCAN_PAGE` handler to use new scanner
6. [ ] Add unit tests for section building and landmark detection

### Phase 2: LLM Importance Selection (CRITICAL)

7. [ ] Create `lib/llm-importance.ts` with `formatForLLM()` function
8. [ ] Implement `LLMResponse` parsing with Zod validation
9. [ ] Add `IMPORTANCE_SYSTEM_PROMPT` for senior-focused selection
10. [ ] Implement `heuristicImportance()` fallback
11. [ ] Implement `heuristicPriorityActions()` for fast updates
12. [ ] Add caching by URL + content hash
13. [ ] Unit tests for heuristic functions

### Phase 3: Change Classification

14. [ ] Create `lib/change-classifier.ts`
15. [ ] Implement `classifyChange()` for tracker events
16. [ ] Implement `isInNewContext()` for modal/popup detection
17. [ ] Wire up to ElementTracker events in content.ts
18. [ ] Add `ELEMENT_UPDATE` message with classification
19. [ ] Integration tests for change classification

### Phase 4: Message Protocol & Form Sync

20. [ ] Add `SYNC_INPUT` message handler to content.ts
21. [ ] Add `ELEMENT_UPDATE` message type for granular updates
22. [ ] Implement input event dispatching (input, change, blur)
23. [ ] Add checkbox/radio state synchronization
24. [ ] Create `lib/input-sync.ts` manager class
25. [ ] Add integration tests for form sync

### Phase 5: Core UI Components

26. [ ] Create `components/Header.svelte`
27. [ ] Create `components/SummaryCard.svelte`
28. [ ] Create `components/PriorityActions.svelte`
29. [ ] Create `components/ActionButton.svelte`
30. [ ] Create `components/ContentSection.svelte` (collapsible)
31. [ ] Create `components/LoadingState.svelte`

### Phase 6: Form UI Components

32. [ ] Create `components/FormInput.svelte` with real-time sync
33. [ ] Create `components/SelectInput.svelte`
34. [ ] Create `components/CheckboxGroup.svelte`
35. [ ] Create `components/RadioGroup.svelte`
36. [ ] Add visual feedback for sync state
37. [ ] Handle disabled/required states

### Phase 7: Main App Integration

38. [ ] Rewrite `App.svelte` using new components and store
39. [ ] Wire up tracker event subscriptions
40. [ ] Implement section collapse/expand
41. [ ] Add keyboard navigation
42. [ ] Implement error handling and retry
43. [ ] Add loading skeletons

### Phase 8: LLM Service Integration

44. [ ] Modify `llm-service.ts` for section-based input
45. [ ] Implement `shouldRegenerateSummary()` logic
46. [ ] Wire up LLM importance selection to initial load flow
47. [ ] Cache summary by content hash
48. [ ] Handle API errors gracefully with heuristic fallback

### Phase 9: Real-time Updates

49. [ ] Subscribe to `element-found`, `element-lost`, `element-matched` events
50. [ ] Implement incremental UI updates (no full rescan)
51. [ ] Handle `confidence-changed` to show/hide elements
52. [ ] Queue LLM re-evaluation for `new-context` changes
53. [ ] Debounce rapid updates (300ms) for UI stability
54. [ ] Test with test-site's aggressive re-renders

### Phase 10: Polish & Accessibility

55. [ ] Implement focus management for section expand/collapse
56. [ ] Add ARIA labels to all interactive elements
57. [ ] Test with screen reader (VoiceOver/NVDA)
58. [ ] Add keyboard shortcuts (Escape to collapse all, Tab navigation)
59. [ ] Verify 44x44px touch targets and 7:1 contrast ratio
60. [ ] Performance profiling and optimization
61. [ ] End-to-end testing with test-site (all mutation scenarios)

## Test Plan

### Unit Tests

```typescript
// section-builder.test.ts
describe('buildSections', () => {
  it('groups blocks by landmark elements');
  it('names sections from aria-label or headings');
  it('filters out elements with confidence < 0.8');
  it('hides elements in searching status');
  it('counts only visible items for collapsed preview');
});

// input-sync.test.ts
describe('InputSyncManager', () => {
  it('syncs text input value immediately');
  it('dispatches input event on each keystroke');
  it('dispatches change event on blur');
  it('handles checkbox toggle correctly');
  it('syncs select option changes');
  it('handles element not found gracefully');
});

// page.svelte.test.ts
describe('PageState', () => {
  it('filters priority actions by confidence');
  it('updates elements reactively');
  it('toggles section expansion');
  it('handles load errors');
});
```

### Integration Tests (Playwright)

```typescript
describe('Sidebar Integration', () => {
  // Basic rendering
  it('displays page title and domain');
  it('shows AI summary after loading');
  it('renders priority actions prominently');
  it('shows collapsible sections');

  // Section behavior
  it('expands section on click');
  it('shows item count when collapsed');
  it('preserves expansion state across updates');

  // Form interactions
  it('syncs text input to page in real-time');
  it('syncs select changes immediately');
  it('syncs checkbox toggles');
  it('handles password fields securely');

  // Click forwarding
  it('clicks button on page via tracker');
  it('shows visual feedback after click');
  it('handles click on lost element gracefully');

  // Real-time updates
  it('hides element when confidence drops below 0.8');
  it('updates element label when text changes');
  it('adds new section when modal opens');

  // Test-site challenges
  it('survives CTA text rotation (6s)');
  it('survives sponsor shuffle + renderKey (8s)');
  it('survives stats order shuffle (10s)');
  it('handles placeholder rotation in forms');
});
```

### Manual Testing Checklist

- [ ] Load test-site, verify sections appear correctly
- [ ] Expand/collapse all sections
- [ ] Click priority action, verify page responds
- [ ] Fill form in sidebar, verify values sync to page
- [ ] Wait through all test-site rotations (10+ seconds)
- [ ] Verify low-confidence elements disappear
- [ ] Test with screen reader (VoiceOver/NVDA)
- [ ] Test keyboard navigation (Tab, Enter, Escape)
- [ ] Verify 44x44px minimum touch targets
- [ ] Check contrast ratio with browser DevTools
- [ ] Test on news article page (Readability content)
- [ ] Test on e-commerce page (many actions)
- [ ] Test on form-heavy page (government site)

## Open Questions

_None - all questions resolved during discovery._

## Integration Notes (Teammates' Code)

Teammates implemented a parallel approach on `origin/main`. Key differences:

| Aspect           | Our Approach                                     | Teammates' Approach                      |
| ---------------- | ------------------------------------------------ | ---------------------------------------- |
| Element IDs      | Stable fingerprint IDs (survive DOM destruction) | Random `data-acc-id` (lost on re-render) |
| LLM Role         | Decides importance, returns element IDs          | Generates full UI schema (Zod validated) |
| UI Components    | Custom Svelte components                         | Full shadcn-ui library                   |
| State Sync       | Polling (250ms) via BindingManager               | Event-driven via ElementTracker          |
| Change Detection | Classification (minor/new-context)               | Similar classification approach          |

**Integration Strategy:**

1. **Keep ElementTracker** for stable element identity (superior to random IDs)
2. **Adopt change classification** concept from BindingManager
3. **Use simpler UI rendering** (not full shadcn) but consider adopting select components
4. **LLM returns element IDs** (not full UI schema) - simpler, less token-heavy

**Files from teammates to potentially reuse:**

- `src/utils/binding-manager.ts` - Change classification logic (adapt for ElementTracker)
- `src/lib/schemas/accessible-ui.ts` - Reference for structured output (but simplify)
- `src/utils/page-to-ui.ts` - LLM prompt patterns (adapt prompts, not full approach)

## Decision Log

| Decision                                             | Rationale                                                                      | Date       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| Single unified mode (no READ/ACCESSIBLE split)       | User requested complete refactor; unified view reflects page hierarchy better  | 2026-01-31 |
| Actions inline in document order                     | Seniors see actions in context where they appear on page                       | 2026-01-31 |
| Hide elements with confidence < 0.8                  | False positives (wrong element clicked) worse than false negatives for seniors | 2026-01-31 |
| Real-time input sync (each keystroke)                | User requirement; enables page validation feedback                             | 2026-01-31 |
| Collapsible sections collapsed by default            | Reduces cognitive load; shows full outline at glance                           | 2026-01-31 |
| Cache LLM summary, regenerate on significant changes | Balances accuracy vs API cost; heuristic fallback for priority actions         | 2026-01-31 |
| Mirror form inputs bidirectionally                   | Seniors type in sidebar; values sync to page seamlessly                        | 2026-01-31 |
| Clean linear flow design                             | Minimal chrome; focus on content; senior-friendly simplicity                   | 2026-01-31 |
| Svelte 5 runes for state                             | Modern reactive patterns; aligns with existing codebase                        | 2026-01-31 |
| Landmark-based section detection                     | Semantic HTML provides natural grouping; ARIA roles as fallback                | 2026-01-31 |
| **LLM decides importance**                           | Can't show all elements; LLM selects what matters for seniors (max 10-15)      | 2026-01-31 |
| **ElementTracker over data-acc-id**                  | Fingerprints survive DOM destruction; teammates' random IDs don't              | 2026-01-31 |
| **LLM returns IDs, not full UI**                     | Simpler than full UI schema; less token overhead; more flexible rendering      | 2026-01-31 |
| **Optimistic + background LLM**                      | Show changes immediately with heuristics; LLM validates in background          | 2026-01-31 |
| **Change classification (minor/new-context)**        | Inspired by teammates; avoids full rescan for small changes                    | 2026-01-31 |
| **Heuristic fallback**                               | Forms important, primary actions important, skip social buttons                | 2026-01-31 |
| **Markdown + element inventory**                     | Research shows ~3-5K tokens; preserves hierarchy; LLM-friendly                 | 2026-01-31 |

## References

- Element Tracking Spec: `specs/element-tracking.md`
- Research: `research/0-general.md` (senior UX guidelines)
- Research: `research/2-dom-extraction.md` (Readability, hierarchy preservation)
- Research: `research/3-element-tracking.md` (Similo, fingerprinting)
- Existing Sidebar: `src/entrypoints/sidepanel/App.svelte`
- ElementTracker: `src/utils/element-tracker/index.ts`
