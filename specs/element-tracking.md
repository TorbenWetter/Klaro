# Feature: Element Tracking System

> Stable element fingerprinting and re-identification across React/Vue/Angular re-renders, enabling the simplified sidebar to trigger actions on the original page even after complete DOM destruction and recreation.

## Overview

The element tracking system solves a critical problem: when modern frameworks like React re-render components, DOM nodes are destroyed and recreated, losing any `data-*` attributes we've attached. This breaks the connection between sidebar actions and page elements.

The DOM in modern SPAs is a **transient projection of application state**—an ephemeral rendering layer subject to frequent, aggressive, and often unpredictable destruction and recreation. The traditional mechanism of retaining a reference to a DOM node fails because the host application's reconciliation process frequently discards underlying DOM nodes during state updates, replacing them with new, visually identical nodes.

The solution uses **multi-attribute fingerprinting** (inspired by the Similo algorithm's 14-attribute approach achieving 89% accuracy) to create stable element identities that survive DOM recreation, combined with **hybrid fuzzy matching** (character-based + token-based) to re-identify elements even when their attributes partially change.

### Key Research Insights

| Source                 | Key Finding                                                           | Application                                      |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| **Similo**             | 14-attribute weighted scoring achieves 89% accuracy, ~3ms per element | Our fingerprint structure and matching algorithm |
| **Healenium**          | LCS-based matching with 0.5 minimum confidence threshold              | Grace period logic for unmount vs move           |
| **Playwright**         | Priority: Role > Text > TestID > Label > CSS/XPath                    | Attribute weight ordering                        |
| **VON Similo**         | Visual overlapping nodes achieve 94.7% accuracy                       | Position-based fallback with IoU                 |
| **Research consensus** | `element.isConnected` is reliable; WeakRef timing is not              | DOM tracking strategy                            |

## Requirements

### Functional Requirements

- [ ] FR1: Generate stable fingerprints for all interactive elements using 14+ attributes (Similo-inspired)
- [ ] FR2: Re-identify elements after DOM destruction using weighted fuzzy matching with hybrid string comparison
- [ ] FR3: Maintain per-tab fingerprint state in `chrome.storage.session` that survives tab switches
- [ ] FR4: Emit events: `element-found`, `element-lost`, `element-matched`, `confidence-changed`, `elements-updated`
- [ ] FR5: Support configurable confidence threshold (default 0.6, matching Healenium's recommendation)
- [ ] FR6: Provide visual debugging overlay with Shadow DOM isolation showing tracked elements and confidence scores
- [ ] FR7: Clean up tab state when tabs are closed via background.ts listener
- [ ] FR8: Forward click/interaction events from sidebar to matched elements with visual feedback
- [ ] FR9: Implement "grace period" logic to distinguish unmount from move (element removed then reappears)
- [ ] FR10: Capture isotopic/neighbor context (adjacent element text) for robust matching

### Non-Functional Requirements

- [ ] NFR1: Handle 200+ interactive elements per page without degrading performance
- [ ] NFR2: Match latency < 50ms for re-identifying all elements after DOM change (research shows ~3ms/element is achievable)
- [ ] NFR3: Memory footprint < 5MB for fingerprint storage per tab
- [ ] NFR4: Zero impact on page functionality (CSS isolation via Shadow DOM)
- [ ] NFR5: MutationObserver callback execution < 10ms per batch (< 1% of frame time)
- [ ] NFR6: Use double-RAF batching with 100ms timeout fallback for framework reconciliation detection

## Technical Design

### Module Architecture

```
src/
├── utils/
│   ├── element-tracker/
│   │   ├── index.ts              # Main ElementTracker class, event-driven
│   │   ├── fingerprint.ts        # Fingerprint generation (pure functions)
│   │   ├── matcher.ts            # Fuzzy matching algorithm (pure functions)
│   │   ├── similarity.ts         # String similarity algorithms (Jaro-Winkler, Dice, token-based)
│   │   ├── storage.ts            # chrome.storage.session wrapper
│   │   ├── debug-overlay.ts      # Shadow DOM visualization
│   │   └── types.ts              # TypeScript interfaces
│   └── dom-scanner.ts            # MODIFIED: Uses ElementTracker instead of data-acc-id
├── entrypoints/
│   ├── content.ts                # MODIFIED: ElementTracker replaces MutationObserver
│   └── background.ts             # MODIFIED: Tab cleanup on close
```

### Data Model

```typescript
// types.ts

/**
 * Stable fingerprint capturing element identity.
 * Based on Similo's 14-attribute approach with extensions for isotopic context.
 */
interface ElementFingerprint {
  // === Unique ID (assigned by us, survives in storage, not on DOM) ===
  id: string;

  // === Priority 1: Explicit identifiers (most stable, weight 1.0) ===
  testId: string | null; // data-testid, data-test, data-cy
  id: string | null; // HTML id attribute (if stable, not auto-generated)

  // === Priority 2: Semantic/ARIA (very stable, weight 0.85) ===
  ariaLabel: string | null;
  role: string | null; // Explicit or implicit ARIA role
  name: string | null; // Form element name attribute

  // === Priority 3: Content-based (high value, use fuzzy matching, weight 0.75) ===
  textContent: string; // Normalized, truncated to 100 chars
  placeholder: string | null;
  value: string | null; // For inputs (current value)
  alt: string | null; // For images
  title: string | null;
  href: string | null; // For links (normalized)

  // === Priority 4: Structural (medium stability, weight 0.4-0.5) ===
  tagName: string;
  inputType: string | null; // For inputs: text, submit, checkbox, etc.
  ancestorPath: AncestorInfo[]; // 2-4 levels up, stops at landmarks
  siblingIndex: number; // Index among same-tag siblings
  childIndex: number; // Index among all siblings
  nearestLandmark: LandmarkInfo | null; // Closest nav, main, section, form, etc.

  // === Priority 5: Isotopic/Neighbor Context (medium stability, weight 0.3) ===
  neighborText: {
    previous: string | null; // Text of previous sibling (truncated)
    next: string | null; // Text of next sibling (truncated)
    parent: string | null; // Parent's text (excluding this element)
  };

  // === Priority 6: Visual (fallback only, weight 0.15-0.2) ===
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  viewportPercent: {
    xPercent: number; // Position as % of viewport width
    yPercent: number; // Position as % of viewport height
  };
  aspectRatio: number; // width / height

  // === Metadata ===
  timestamp: number; // When fingerprint was created/updated
  lastMatchConfidence: number; // Last match confidence (1.0 for newly created)
}

/** Ancestor information for structural fingerprinting */
interface AncestorInfo {
  tagName: string;
  role: string | null;
  testId: string | null;
  landmark: string | null; // If this is a landmark element
  index: number; // Index among siblings at this level
}

/** Landmark element info for anchoring */
interface LandmarkInfo {
  tagName: string;
  role: string | null;
  id: string | null;
  distanceUp: number; // How many levels up to reach this landmark
}

/** Tracked element with current DOM reference */
interface TrackedElement {
  fingerprint: ElementFingerprint;
  ref: WeakRef<HTMLElement>; // Weak reference for memory efficiency
  status: 'active' | 'searching' | 'lost';
  lostAt: number | null; // Timestamp when element was detected as missing
}

/** Match result from fuzzy matching */
interface MatchResult {
  fingerprint: ElementFingerprint;
  element: HTMLElement;
  confidence: number;
  matchDetails: {
    identityScore: number; // testId, id matches
    semanticScore: number; // aria-label, role, name
    contentScore: number; // textContent, placeholder
    structureScore: number; // ancestorPath, siblingIndex
    neighborScore: number; // isotopic context
    positionScore: number; // bounding box IoU
  };
  algorithm: 'exact' | 'fuzzy' | 'position-fallback';
}

/** Events emitted by ElementTracker */
type TrackerEvent =
  | { type: 'element-found'; fingerprint: ElementFingerprint; element: HTMLElement }
  | { type: 'element-lost'; fingerprint: ElementFingerprint; lastKnownText: string }
  | {
      type: 'element-matched';
      fingerprint: ElementFingerprint;
      element: HTMLElement;
      confidence: number;
    }
  | {
      type: 'confidence-changed';
      fingerprint: ElementFingerprint;
      oldConfidence: number;
      newConfidence: number;
    }
  | {
      type: 'elements-updated';
      added: ElementFingerprint[];
      removed: ElementFingerprint[];
      updated: ElementFingerprint[];
    };

/** Configuration for the tracker */
interface TrackerConfig {
  confidenceThreshold: number; // Default: 0.6 (Healenium uses 0.5-0.6)
  gracePeriodMs: number; // Default: 100 (wait before declaring element lost)
  debugMode: boolean; // Default: false
  weights: MatchWeights;
}

/**
 * Configurable weights for matching algorithm.
 * Based on research consensus: Playwright, Healenium, Similo.
 * Stable attributes get higher weights.
 */
interface MatchWeights {
  // Identity (highest - exact match or nothing)
  testId: number; // Default: 1.0
  htmlId: number; // Default: 0.9

  // Semantic/ARIA (very high)
  role: number; // Default: 0.85
  ariaLabel: number; // Default: 0.85
  name: number; // Default: 0.8

  // Content (high, use fuzzy matching)
  textContent: number; // Default: 0.75
  placeholder: number; // Default: 0.65
  alt: number; // Default: 0.6

  // Structural (medium)
  tagName: number; // Default: 0.5 (must match exactly as prerequisite)
  href: number; // Default: 0.45
  ancestorPath: number; // Default: 0.4
  siblingIndex: number; // Default: 0.3

  // Isotopic/Neighbor (medium-low)
  neighborText: number; // Default: 0.3

  // Positional (low - fallback only)
  boundingBox: number; // Default: 0.2

  // Explicitly deprioritized
  className: number; // Default: 0.1 (CSS-in-JS makes this unreliable)
}
```

### Core Components

#### 1. ElementTracker (index.ts)

Main class that orchestrates fingerprinting, matching, and DOM observation.

```typescript
class ElementTracker extends EventTarget {
  private config: TrackerConfig;
  private tracked: Map<string, TrackedElement>;
  private mutationQueue: MutationRecord[];
  private rafId: number | null;
  private timeoutId: number | null;
  private observer: MutationObserver;
  private storage: TabStorage;
  private overlay: DebugOverlay | null;

  constructor(config: Partial<TrackerConfig> = {});

  // Lifecycle
  start(): void; // Begin observing DOM
  stop(): void; // Stop observing, cleanup

  // Element operations
  getTrackedElements(): TrackedElement[];
  getElementById(id: string): HTMLElement | null;
  clickElement(id: string): Promise<{ success: boolean; confidence: number }>;

  // Events (inherited from EventTarget)
  addEventListener(type: TrackerEvent['type'], handler): void;

  // Debug
  setDebugMode(enabled: boolean): void;
}
```

#### 2. Fingerprint Generation (fingerprint.ts)

Pure functions for creating fingerprints from DOM elements.

```typescript
// Landmark tags that serve as stable anchors
const LANDMARK_TAGS = new Set([
  'main',
  'nav',
  'header',
  'footer',
  'aside',
  'article',
  'section',
  'form',
  'dialog',
]);

// Implicit ARIA roles by tag
const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  a: 'link',
  input: 'textbox',
  select: 'combobox',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
};

function createFingerprint(element: HTMLElement): ElementFingerprint;
function generateId(): string;
function buildAncestorPath(element: HTMLElement, maxDepth?: number): AncestorInfo[];
function findNearestLandmark(element: HTMLElement): LandmarkInfo | null;
function getSiblingIndex(element: HTMLElement): number;
function getNeighborText(element: HTMLElement): ElementFingerprint['neighborText'];
function normalizeText(text: string, maxLength?: number): string;
function getImplicitRole(element: HTMLElement): string | null;

/**
 * Check if an element has a stable (non-generated) ID.
 * Generated IDs often have patterns like: r:1, :r0:, react-123, etc.
 */
function hasStableId(element: HTMLElement): boolean;

/**
 * Filter class names to exclude high-entropy (hashed) classes.
 * Returns only low-entropy classes that might be meaningful.
 */
function filterStableClasses(classList: DOMTokenList): string[];
```

##### Entropy-Aware Class Filtering

CSS-in-JS libraries generate non-deterministic, hashed class names that are useless for identification:

```typescript
/**
 * Detect high-entropy (likely hashed) class names.
 * High entropy: sc-1a2b3c, css-x9z, emotion-123, _hash_abc1
 * Low entropy: btn-primary, nav-item, sidebar-toggle
 */
function isHighEntropyClass(className: string): boolean {
  // Short random-looking strings
  if (className.length < 5 && /^[a-z0-9]+$/i.test(className)) return true;

  // Common CSS-in-JS patterns
  if (/^(sc-|css-|emotion-|styled-|_[a-z]+_[a-z0-9]+)/i.test(className)) return true;

  // Contains hash-like segments (mixed alphanumeric)
  if (/[a-z][0-9][a-z0-9]{2,}|[0-9][a-z][a-z0-9]{2,}/i.test(className)) return true;

  return false;
}

function filterStableClasses(classList: DOMTokenList): string[] {
  return Array.from(classList).filter((cls) => !isHighEntropyClass(cls));
}
```

#### 3. Similarity Algorithms (similarity.ts)

Research-backed string similarity functions.

```typescript
/**
 * Jaro-Winkler similarity for short strings.
 * ~2x faster than Levenshtein, optimized for short strings with common prefixes.
 * Returns 0-1 (1 = identical).
 */
function jaroWinkler(a: string, b: string): number;

/**
 * Sørensen-Dice coefficient using bigrams.
 * O(n) complexity, handles word reordering well.
 * Returns 0-1 (1 = identical).
 */
function diceCoefficient(a: string, b: string): number;

/**
 * Levenshtein distance normalized to 0-1 similarity.
 * Use fastest-levenshtein library for performance (~2-5ms for 40k comparisons).
 */
function levenshteinSimilarity(a: string, b: string): number;

/**
 * Token Set Ratio for multi-word labels.
 * Handles word insertions, reordering, extra punctuation.
 * "Register Now" vs "Now Register!" = high similarity.
 */
function tokenSetRatio(a: string, b: string): number;

/**
 * Hybrid text similarity: character-based for single words, token-based for multi-word.
 * This is the primary function for comparing UI text.
 */
function textSimilarity(a: string, b: string): number {
  const tokensA = a.trim().toLowerCase().split(/\s+/);
  const tokensB = b.trim().toLowerCase().split(/\s+/);

  if (tokensA.length === 1 && tokensB.length === 1) {
    // Single word: Jaro-Winkler (fast, prefix-aware)
    return jaroWinkler(a.toLowerCase(), b.toLowerCase());
  }

  // Multi-word: Token Set Ratio (handles reordering)
  return tokenSetRatio(a, b);
}

/**
 * IoU (Intersection over Union) for bounding box comparison.
 * Returns 0-1 (1 = perfect overlap, 0 = no overlap).
 */
function boundingBoxIoU(a: BoundingBox, b: BoundingBox): number;

/**
 * Position proximity with 100px threshold (Similo recommendation).
 * Returns 0-1 (1 = same position, 0 = >100px apart).
 */
function positionSimilarity(a: BoundingBox, b: BoundingBox): number {
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist >= 100) return 0;
  return 1 - dist / 100;
}
```

##### Performance Benchmarks

From research (40,000 comparisons = 200 × 200 elements):

| Algorithm        | Library                 | Time     | Notes                           |
| ---------------- | ----------------------- | -------- | ------------------------------- |
| Levenshtein      | `fastest-levenshtein`   | 2-5ms    | Recommended for single words    |
| Jaro-Winkler     | Native implementation   | 1-3ms    | Fastest for short strings       |
| Dice Coefficient | `fast-dice-coefficient` | 1-3ms    | Good for bigram overlap         |
| Token Set Ratio  | `fuzzball`              | 10-30ms  | Best for multi-word, still fast |
| Fuse.js          | `fuse.js`               | 33,875ms | **AVOID** - too slow            |

#### 4. Fuzzy Matcher (matcher.ts)

Pure functions for matching fingerprints to DOM elements.

```typescript
/**
 * Find the best matching element for a fingerprint.
 * Uses weighted multi-attribute scoring (Similo-inspired).
 */
function findBestMatch(
  fingerprint: ElementFingerprint,
  candidates: HTMLElement[],
  weights: MatchWeights
): MatchResult | null;

/**
 * Calculate confidence score between fingerprint and candidate.
 * Returns detailed breakdown of each attribute's contribution.
 */
function calculateConfidence(
  fingerprint: ElementFingerprint,
  element: HTMLElement,
  weights: MatchWeights
): { score: number; details: MatchResult['matchDetails'] };

/**
 * Pre-filter candidates to reduce comparison workload.
 * Groups by tagName to avoid comparing button to div.
 */
function filterCandidates(
  fingerprint: ElementFingerprint,
  allElements: HTMLElement[]
): HTMLElement[];
```

##### Matching Algorithm

The algorithm follows Similo's weighted sum approach with research-backed weights:

```typescript
function calculateConfidence(
  fp: ElementFingerprint,
  candidate: HTMLElement,
  weights: MatchWeights
): { score: number; details: MatchResult['matchDetails'] } {

  // === PREREQUISITE: Tag must match exactly ===
  if (fp.tagName !== candidate.tagName.toLowerCase()) {
    return { score: 0, details: { ... } };
  }

  // === EARLY EXIT: testId mismatch means different element ===
  const candidateTestId = candidate.getAttribute('data-testid');
  if (fp.testId && candidateTestId && fp.testId !== candidateTestId) {
    return { score: 0, details: { ... } };
  }

  // === PERFECT MATCH: testId exact match ===
  if (fp.testId && fp.testId === candidateTestId) {
    return { score: 1.0, details: { identityScore: 1.0, ... } };
  }

  let totalScore = 0;
  let totalWeight = 0;

  // --- Identity attributes (exact match) ---
  // ... score id, testId

  // --- Semantic attributes (exact match) ---
  // ... score role, ariaLabel, name

  // --- Content attributes (fuzzy match) ---
  if (fp.textContent) {
    const candidateText = getVisibleText(candidate);
    const similarity = textSimilarity(fp.textContent, candidateText);
    totalScore += weights.textContent * similarity;
    totalWeight += weights.textContent;
  }

  // --- Structural attributes ---
  // ... score ancestorPath, siblingIndex

  // --- Neighbor/Isotopic context ---
  // ... score neighbor text similarity

  // --- Position (low weight fallback) ---
  const candidateRect = candidate.getBoundingClientRect();
  const posScore = positionSimilarity(fp.boundingBox, candidateRect);
  totalScore += weights.boundingBox * posScore;
  totalWeight += weights.boundingBox;

  return {
    score: totalWeight > 0 ? totalScore / totalWeight : 0,
    details: { ... }
  };
}
```

##### Default Weights (Research-Backed)

Based on Playwright, Healenium, and Similo consensus:

| Attribute      | Weight | Rationale                                |
| -------------- | ------ | ---------------------------------------- |
| `testId`       | 1.0    | Explicit testing contract, most stable   |
| `htmlId`       | 0.9    | Usually stable (unless auto-generated)   |
| `role`         | 0.85   | ARIA role, accessibility requirement     |
| `ariaLabel`    | 0.85   | User-facing, stable for a11y             |
| `name`         | 0.8    | Form semantics                           |
| `textContent`  | 0.75   | Visible text (may change, use fuzzy)     |
| `placeholder`  | 0.65   | Usually stable                           |
| `alt`          | 0.6    | Image accessibility                      |
| `tagName`      | 0.5    | Must match (prerequisite)                |
| `href`         | 0.45   | Link destination                         |
| `ancestorPath` | 0.4    | Structural context                       |
| `neighborText` | 0.3    | Isotopic anchoring                       |
| `siblingIndex` | 0.3    | Position among siblings                  |
| `boundingBox`  | 0.2    | Visual position (fallback)               |
| `className`    | 0.1    | **Deprioritized** - CSS-in-JS unreliable |

#### 5. Tab Storage (storage.ts)

Wrapper around chrome.storage.session for per-tab state.

```typescript
class TabStorage {
  private tabId: number;
  private key: string;

  constructor(tabId: number) {
    this.tabId = tabId;
    this.key = `tab_${tabId}_fingerprints`;
  }

  async saveFingerprints(fingerprints: ElementFingerprint[]): Promise<void>;
  async loadFingerprints(): Promise<ElementFingerprint[]>;
  async clear(): Promise<void>;

  static async cleanupTab(tabId: number): Promise<void>;
}
```

#### 6. Debug Overlay (debug-overlay.ts)

Shadow DOM-isolated visualization for debugging.

```typescript
class DebugOverlay {
  private shadowHost: HTMLElement;
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;

  constructor();

  show(): void;
  hide(): void;
  updateElements(tracked: TrackedElement[]): void;
  highlightElement(id: string, color: 'green' | 'yellow' | 'red'): void;

  private createStyles(): CSSStyleSheet;
  private createHighlightBox(element: HTMLElement, confidence: number): HTMLElement;
}
```

### MutationObserver Strategy

#### Double-RAF Batching

Research shows that framework reconciliation completes within 1-2 animation frames. The double `requestAnimationFrame` pattern reliably detects batch completion:

```typescript
class MutationBatcher {
  private pendingMutations: MutationRecord[] = [];
  private rafId: number | null = null;
  private timeoutId: number | null = null;
  private observer: MutationObserver;

  constructor(
    private target: Node,
    private onBatchComplete: (mutations: MutationRecord[]) => void
  ) {
    this.observer = new MutationObserver(this.handleMutations.bind(this));
  }

  private handleMutations(mutations: MutationRecord[]): void {
    this.pendingMutations.push(...mutations);

    // Cancel pending processing
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.timeoutId) clearTimeout(this.timeoutId);

    // Double-RAF: wait for framework batch + browser render
    this.rafId = requestAnimationFrame(() => {
      this.rafId = requestAnimationFrame(() => {
        this.flush();
      });
    });

    // Fallback timeout for very rapid mutations (100ms, not 600ms!)
    this.timeoutId = window.setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    if (this.pendingMutations.length === 0) return;

    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.rafId = null;
    this.timeoutId = null;

    const mutations = this.pendingMutations;
    this.pendingMutations = [];
    this.onBatchComplete(mutations);
  }

  observe(): void {
    this.observer.observe(this.target, {
      childList: true,
      subtree: true,
      attributes: true,
      // Limit attribute observation to relevant attributes
      attributeFilter: [
        'data-testid',
        'aria-label',
        'role',
        'name',
        'placeholder',
        'value',
        'disabled',
        'id',
      ],
    });
  }

  disconnect(): void {
    this.observer.disconnect();
    this.flush();
  }
}
```

**Why 100ms, not 600ms:** Research shows that React and other frameworks typically complete DOM updates in under 50ms except for very large lists. 100ms gives plenty of buffer while remaining responsive.

#### Grace Period for Unmount vs Move

When an element disappears, it might be moving (React reordering) rather than truly removed. Implement a grace period:

```typescript
private handleElementDisappeared(tracked: TrackedElement): void {
  // Enter "searching" state
  tracked.status = 'searching';
  tracked.lostAt = Date.now();

  // Don't declare lost immediately - wait for grace period
  setTimeout(() => {
    if (tracked.status === 'searching') {
      // Still not found after grace period
      const reidentified = this.attemptReidentification(tracked);

      if (reidentified) {
        tracked.status = 'active';
        tracked.ref = new WeakRef(reidentified.element);
        this.emit('element-matched', {
          fingerprint: tracked.fingerprint,
          element: reidentified.element,
          confidence: reidentified.confidence
        });
      } else {
        tracked.status = 'lost';
        this.emit('element-lost', {
          fingerprint: tracked.fingerprint,
          lastKnownText: tracked.fingerprint.textContent
        });
      }
    }
  }, this.config.gracePeriodMs);
}
```

### WeakRef Usage (Corrected)

**Critical finding from research:** `WeakRef.deref()` returns the element even after DOM removal until garbage collection occurs. GC timing is non-deterministic and cannot be relied upon.

**Correct pattern:**

```typescript
class ElementTracker {
  getElementById(id: string): HTMLElement | null {
    const tracked = this.tracked.get(id);
    if (!tracked) return null;

    const element = tracked.ref.deref();

    // WeakRef returned undefined = element was garbage collected
    if (!element) {
      this.tracked.delete(id);
      return null;
    }

    // CRITICAL: Check DOM connection separately!
    // WeakRef can return element even after removal from DOM
    if (!element.isConnected) {
      // Element removed from DOM but not yet GC'd
      // Trigger re-identification
      return this.attemptReidentification(tracked)?.element ?? null;
    }

    return element;
  }
}
```

**Use WeakRef for:**

- Memory-efficient caching (allows GC when element removed)
- Preventing detached DOM leaks

**Use MutationObserver for:**

- Detecting element removal from DOM
- Triggering re-identification logic

**Use FinalizationRegistry for:**

- Secondary cleanup only (not primary logic)
- Removing stale fingerprints from storage

```typescript
const registry = new FinalizationRegistry((id: string) => {
  // Element was garbage collected - cleanup storage
  fingerprintMap.delete(id);
  console.debug(`[Klaro] Element ${id} was GC'd, cleaned up.`);
});

function trackElement(id: string, element: HTMLElement): void {
  registry.register(element, id);
}
```

### Integration Points

#### Modified: content.ts

```typescript
import { ElementTracker } from './utils/element-tracker';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const tracker = new ElementTracker({
      confidenceThreshold: 0.6,
      gracePeriodMs: 100,
      debugMode: false,
    });

    tracker.addEventListener('elements-updated', () => {
      browser.runtime.sendMessage({ type: 'PAGE_UPDATED' });
    });

    tracker.start();

    browser.runtime.onMessage.addListener((msg, _, respond) => {
      if (msg.type === 'SCAN_PAGE') {
        const elements = tracker.getTrackedElements();
        respond({ actions: elements.map(toAction) });
        return true;
      }
      if (msg.type === 'CLICK_ELEMENT') {
        tracker.clickElement(msg.id).then(respond);
        return true;
      }
      if (msg.type === 'SET_DEBUG_MODE') {
        tracker.setDebugMode(msg.enabled);
        respond({ ok: true });
        return true;
      }
    });
  },
});
```

#### Modified: background.ts

```typescript
import { TabStorage } from './utils/element-tracker/storage';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Clean up storage when tab closes
  browser.tabs.onRemoved.addListener((tabId) => {
    TabStorage.cleanupTab(tabId);
  });
});
```

### Event Flow

```
DOM Mutation Detected (MutationObserver)
        ↓
Queue mutations, schedule processing (double-RAF)
        ↓
After RAF + RAF (or 100ms timeout):
        ↓
┌───────────────────────────────────────────────────────┐
│ processMutationBatch():                               │
│                                                       │
│ 1. For removed nodes:                                 │
│    - Find which tracked elements were in removed      │
│    - Enter "searching" state, start grace period      │
│                                                       │
│ 2. For added nodes:                                   │
│    - Check if any match "searching" fingerprints      │
│    - If match found: emit 'element-matched'           │
│    - If new interactive element: create fingerprint,  │
│      emit 'element-found'                             │
│                                                       │
│ 3. After grace period (100ms):                        │
│    - If still "searching": attempt re-identification  │
│    - If no match: emit 'element-lost'                 │
└───────────────────────────────────────────────────────┘
        ↓
Save updated fingerprints to chrome.storage.session
        ↓
Emit 'elements-updated' → Sidebar refreshes
```

## Implementation Plan

### Phase 1: Core Types and Similarity Functions

1. [ ] Create `src/utils/element-tracker/types.ts` with all interfaces
2. [ ] Implement `similarity.ts` with Jaro-Winkler, Dice, token-based, IoU
3. [ ] Add unit tests for similarity functions (pure functions, easy to test)

### Phase 2: Fingerprint Generation

4. [ ] Implement `fingerprint.ts` with all extraction functions
5. [ ] Add entropy-aware class filtering
6. [ ] Add ancestor path with landmark detection
7. [ ] Add neighbor/isotopic text extraction
8. [ ] Add unit tests for fingerprint generation

### Phase 3: Matching Algorithm

9. [ ] Implement `matcher.ts` with weighted scoring
10. [ ] Add candidate pre-filtering by tagName
11. [ ] Add confidence calculation with detailed breakdown
12. [ ] Add unit tests for matching

### Phase 4: Storage Layer

13. [ ] Implement `storage.ts` for chrome.storage.session wrapper
14. [ ] Add tab cleanup in background.ts
15. [ ] Test storage persistence across tab switches

### Phase 5: ElementTracker Class

16. [ ] Implement `index.ts` with double-RAF MutationObserver batching
17. [ ] Add grace period logic for unmount vs move
18. [ ] Add WeakRef + isConnected pattern
19. [ ] Integrate fingerprint + matcher + storage
20. [ ] Add continuous tracking logic

### Phase 6: Integration

21. [ ] Modify `content.ts` to use ElementTracker
22. [ ] Update message handlers for new API
23. [ ] Test with existing sidebar (should work with minimal changes)

### Phase 7: Debug Overlay

24. [ ] Implement `debug-overlay.ts` with Shadow DOM isolation
25. [ ] Add visual confidence indicators (green/yellow/red)
26. [ ] Add toggle via message from sidebar/devtools

### Phase 8: Testing with Test Site

27. [ ] Run against test-site with all its challenges
28. [ ] Tune weights based on results
29. [ ] Document edge cases and limitations
30. [ ] Performance profiling (ensure <50ms re-identification)

## Test Plan

### Unit Tests (Vitest)

```typescript
// similarity.test.ts
describe('textSimilarity', () => {
  it('returns 1.0 for identical strings');
  it('uses Jaro-Winkler for single words');
  it('uses token-based for multi-word labels');
  it('handles "Register Now" vs "Join Now" (partial match)');
  it('handles word reordering ("Sign Up" vs "Up Sign")');
});

describe('boundingBoxIoU', () => {
  it('returns 1.0 for identical boxes');
  it('returns 0 for non-overlapping boxes');
  it('calculates correct IoU for partial overlap');
});

// fingerprint.test.ts
describe('createFingerprint', () => {
  it('extracts all relevant attributes from element');
  it('normalizes text content to 100 chars');
  it('filters out high-entropy class names');
  it('builds correct ancestor path up to landmarks');
  it('captures neighbor text correctly');
});

describe('isHighEntropyClass', () => {
  it('detects sc-1a2b3c as high entropy');
  it('detects css-x9z as high entropy');
  it('accepts btn-primary as low entropy');
  it('accepts nav-item as low entropy');
});

// matcher.test.ts
describe('findBestMatch', () => {
  it('returns exact match with confidence 1.0 for testId match');
  it('rejects candidates with different tagName');
  it('rejects candidates with different testId');
  it('matches element with changed text content (fuzzy)');
  it('uses position as tiebreaker for similar candidates');
  it('returns null when no match above threshold');
});

describe('calculateConfidence', () => {
  it('gives highest score to testId matches');
  it('applies correct weights to each attribute');
  it('returns detailed breakdown in matchDetails');
});
```

### Integration Tests (Playwright)

```typescript
describe('ElementTracker on test-site', () => {
  // Basic tracking
  it('tracks all interactive elements on initial load');
  it('assigns unique IDs to each tracked element');

  // Re-identification after React re-renders
  it('re-identifies elements after sponsor shuffle (8s)');
  it('handles CTA text rotation without losing element');
  it('survives renderKey increment (full DOM replacement)');
  it('handles stats order shuffle (position changes)');

  // Modal handling
  it('tracks modal form elements when visible');
  it('marks modal elements as lost when modal closes');
  it('re-identifies modal elements when modal reopens');

  // Grace period
  it('does not emit element-lost during brief removal');
  it('emits element-lost after grace period if truly gone');

  // Edge cases
  it('handles placeholder text rotation in forms');
  it('distinguishes between two similar buttons');

  // Performance
  it('re-identifies 200 elements in <50ms');
});
```

### Manual Testing Checklist

- [ ] Load test-site, verify all buttons appear in sidebar
- [ ] Wait 6 seconds (CTA text rotation), verify CTA button still clickable
- [ ] Wait 8 seconds (sponsor shuffle + renderKey), verify clicks still work
- [ ] Wait 10 seconds (stats reorder), verify elements tracked correctly
- [ ] Open modal, click form elements from sidebar
- [ ] Close modal, verify form elements marked as lost/unavailable
- [ ] Reopen modal, verify form elements re-identified
- [ ] Switch to another tab, switch back, verify state restored
- [ ] Enable debug mode, verify overlay shows confidence scores
- [ ] Verify green (>0.8), yellow (0.6-0.8), red (<0.6) coloring
- [ ] Reload page, verify fresh tracking starts correctly
- [ ] Check DevTools Performance tab for <50ms re-identification

## Edge Cases

| Scenario                         | Expected Behavior                                                  |
| -------------------------------- | ------------------------------------------------------------------ |
| Element removed permanently      | Grace period → emit 'element-lost', remove from tracked set        |
| Element moves (React reorder)    | Grace period → re-identify in new location → 'element-matched'     |
| Element reappears after removal  | Re-identify with 'element-matched', restore tracking               |
| Two elements with identical text | Track both with unique IDs, use position + structure as tiebreaker |
| Button text rotates completely   | Rely on position + structure + neighbor context                    |
| CSS class changes (CSS-in-JS)    | Ignore classes (low weight), rely on other attributes              |
| Wrapper div added/removed        | Ancestor path tolerates shallow changes, neighbor text stable      |
| Portal moves element to body     | Position + text + aria-label should still match                    |
| Page navigation (same origin)    | Storage persists, re-fingerprint new page                          |
| Page navigation (cross-origin)   | Content script reinjected, fresh tracking                          |
| Service worker terminates        | Storage persists, content script unaffected                        |
| Tab closed                       | Storage cleaned up by background.ts                                |
| Very fast DOM changes            | Double-RAF batching prevents excessive processing                  |
| 500+ elements                    | Pre-filter by tagName, may need further optimization               |
| Modal open/close                 | Track modal elements separately, mark lost when closed             |
| Cumulative Layout Shift          | Position weight is low (0.2), other attributes compensate          |

## Decision Log

| Decision                                     | Rationale                                                           | Date       |
| -------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| Standalone module over extending dom-scanner | Easier to test, clearer separation of concerns                      | 2026-01-31 |
| Event-driven over simple API                 | More autonomous, better fits continuous tracking requirement        | 2026-01-31 |
| Replace existing MutationObserver            | Single source of truth for DOM observation, avoids duplicate work   | 2026-01-31 |
| chrome.storage.session over local            | Per-session state is sufficient, auto-clears on browser close       | 2026-01-31 |
| Configurable weights                         | Test site lacks ARIA attributes, need to tune for real-world sites  | 2026-01-31 |
| WeakRef for memory, isConnected for DOM      | WeakRef timing is non-deterministic; isConnected is reliable        | 2026-01-31 |
| Shadow DOM for debug overlay                 | Avoids CSS conflicts with page styles                               | 2026-01-31 |
| Full event system                            | Sidebar needs granular updates, not just polling                    | 2026-01-31 |
| Benchmark before indexing                    | 200+ elements may not need optimization, avoid premature complexity | 2026-01-31 |
| Double-RAF batching                          | Reliably detects framework reconciliation completion                | 2026-01-31 |
| 100ms debounce (not 600ms)                   | Research shows frameworks complete in <50ms typically               | 2026-01-31 |
| Hybrid text matching                         | Jaro-Winkler for single words, token-based for multi-word           | 2026-01-31 |
| Entropy-aware class filtering                | CSS-in-JS generates useless hashed classes                          | 2026-01-31 |
| 100px position threshold                     | Similo research recommendation for "nearby" vs "different"          | 2026-01-31 |
| 0.6 confidence threshold                     | Healenium uses 0.5-0.6; balance accuracy vs availability            | 2026-01-31 |
| Grace period (100ms)                         | Distinguish unmount from move (React reordering)                    | 2026-01-31 |
| Isotopic/neighbor context                    | Elements identified by stable relationships to surroundings         | 2026-01-31 |
| fastest-levenshtein over Fuse.js             | Performance: 2-5ms vs 33,875ms for similar workloads                | 2026-01-31 |

## Performance Budgets

| Operation                             | Budget  | Measurement              |
| ------------------------------------- | ------- | ------------------------ |
| Fingerprint creation (single element) | < 1ms   | `performance.now()`      |
| Similarity calculation (single pair)  | < 0.1ms | `performance.now()`      |
| Full re-identification (200 elements) | < 50ms  | `performance.now()`      |
| MutationObserver callback             | < 10ms  | DevTools Performance     |
| Storage read/write                    | < 5ms   | `chrome.storage` timing  |
| Debug overlay update                  | < 16ms  | Stay within frame budget |

## Open Questions

_None - all questions resolved during discovery and research._

## References

- Similo Algorithm: [arXiv:2208.00677](https://arxiv.org/abs/2208.00677)
- VON Similo LLM: [arXiv:2310.02046](https://arxiv.org/abs/2310.02046)
- Healenium Documentation: [healenium.io](https://healenium.io/docs/)
- Playwright Locators: [playwright.dev](https://playwright.dev/docs/locators)
- MDN WeakRef: [developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef)
- MutationObserver Performance: [Stack Overflow](https://stackoverflow.com/questions/31659567)
- String Similarity Algorithms: [Stack Overflow](https://stackoverflow.com/questions/25540581)
