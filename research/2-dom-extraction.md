# DOM extraction and LLM-optimized preprocessing for Klaro

**Building an AI-powered Chrome extension that simplifies website UIs for seniors requires a carefully orchestrated pipeline from raw DOM to LLM-simplified render.** The core challenge is achieving sub-3-second latency while reducing 100K+ token pages to manageable 4-8K context windows—all while preserving interactive elements seniors need to complete tasks. This research synthesizes extraction techniques, cleaning algorithms, academic approaches, and practical implementation patterns into an actionable architecture for Klaro's hackathon MVP and production roadmap.

The recommended pipeline uses **speculative extraction triggered at DOMContentLoaded**, followed by **aggressive boilerplate removal via Readability.js**, then **conversion to Markdown using dom-to-semantic-markdown** for optimal token efficiency. Interactive elements require a **proxy pattern** where simplified elements forward events to hidden originals rather than replacing them—critical for preserving form submissions and button functionality.

## The fastest extraction path starts with `outerHTML`

Raw DOM serialization via `document.documentElement.outerHTML` is **20-100x faster than TreeWalker traversal** for typical pages, completing in under 5ms. This single native call outperforms all JavaScript iteration approaches because the browser handles serialization internally without per-node overhead.

```typescript
// Fastest single-call extraction
const extractDOM = (): string => document.documentElement.outerHTML;

// For filtered traversal needs, TreeWalker remains efficient
const extractTextNodes = (): string[] => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (text) texts.push(text);
  }
  return texts;
};
```

**Cloning trade-offs** matter for different use cases: `cloneNode(true)` is 3-20x faster than innerHTML round-trips for DOM manipulation needs, but adds **5-15MB memory overhead** for a 5MB page. Critically, cloning does NOT preserve event listeners—only inline handlers survive. For LLM submission requiring string serialization, `outerHTML` wins; for local DOM manipulation before simplification, cloning provides faster iteration.

**Dynamic content detection** for SPAs requires MutationObserver with debouncing. React hydration can be detected by `[data-reactroot]` presence, Vue by removal of `[data-server-rendered]` attribute. The robust pattern waits for 300-500ms of DOM stability with a 5-second maximum timeout:

```typescript
const waitForSPAHydration = (debounceMs = 300, maxWaitMs = 5000): Promise<void> => {
  return new Promise((resolve) => {
    let timer: number;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, debounceMs);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, maxWaitMs);
  });
};
```

**Shadow DOM extraction** only works for open shadow roots—`element.shadowRoot` returns null for closed mode (browser native elements like `<video>`, `<input type="range">`). Cross-origin iframes cannot be accessed via `contentDocument` due to security restrictions; Chrome extensions with `all_frames: true` can inject content scripts into same-origin iframes only.

## Readability.js achieves 70-85% size reduction through content scoring

Mozilla's **Readability.js** remains the gold standard for content extraction, achieving the **highest median F1 score (0.970)** in benchmarks. Its algorithm uses a multi-stage pipeline: preprocessing removes scripts/styles, candidate identification scores elements by tag type and class/ID patterns, content scoring evaluates text length and link density, and sibling merging combines related content.

The **scoring algorithm** works as follows: semantic tags like `<article>` receive +25 base points, `<div>` gets +5. Class/ID patterns matching `/article|content|main|post/i` add +25 points; patterns matching `/nav|footer|sidebar|ad|sponsor/i` subtract +25. Content scoring adds points for comma count (prose indicator) and text length, while subtracting for high link density (navigation indicator). Parents and grandparents receive propagated scores from children at 50% backoff rates.

```typescript
import { Readability, isProbablyReaderable } from '@mozilla/readability';

function extractContent(doc: Document) {
  const clone = doc.cloneNode(true) as Document;
  if (!isProbablyReaderable(clone, { minContentLength: 140, minScore: 20 })) {
    return null; // Page not suitable for reader-mode extraction
  }
  return new Readability(clone, {
    charThreshold: 500,
    nbTopCandidates: 5,
    classesToPreserve: ['highlight', 'code'],
  }).parse();
}
```

**Boilerplate detection patterns** identify elements to remove before or alongside Readability processing:

| Element Type   | Detection Selectors                                       |
| -------------- | --------------------------------------------------------- |
| Ads            | `.ad`, `[id*="google_ads"]`, `iframe[src*="doubleclick"]` |
| Cookie banners | `.cookie-consent`, `#gdpr-banner`, `[aria-modal="true"]`  |
| Navigation     | `nav`, `[role="navigation"]`, `.menu`, `.navbar`          |
| Social widgets | `.share-buttons`, `[class*="social-"]`, `.fb-like`        |
| Comments       | `#comments`, `.disqus`, `#disqus_thread`                  |

**Defuddle**, created in 2025 by Obsidian's developer, offers a modern alternative that's more forgiving than Readability—removing fewer uncertain elements while better standardizing output for downstream processing. It handles MathJax/KaTeX conversion to MathML and normalizes code blocks with language detection. For Klaro's accessibility focus, Defuddle's HTML standardization (converting H1s to H2s, stripping anchor links from headings) may improve LLM comprehension.

## The Chrome Accessibility Tree provides 10-20x token reduction

**The accessibility tree is the single most impactful optimization for token efficiency.** Claude's Chrome extension uses it as the primary page representation, falling back to screenshots only when necessary. The tree contains roles, names, states, and hierarchy—exactly the semantic information needed for UI understanding—while filtering out all visual/layout noise.

Access the accessibility tree via Chrome DevTools Protocol in extensions:

```typescript
// manifest.json: "permissions": ["debugger"]
async function getAccessibilityTree(tabId: number) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
    const { nodes } = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
    return nodes; // AXNode[] with role, name, properties, childIds
  } finally {
    await chrome.debugger.detach({ tabId });
  }
}
```

**Important caveat**: Using `chrome.debugger` shows an intrusive "Debugging this browser" warning bar to users. For a senior-friendly experience, this UX cost may be unacceptable for production. The fallback approach uses content-script DOM processing without debugger API.

**Token reduction comparison** across representation formats:

| Representation     | Typical News Page | Reduction from Raw |
| ------------------ | ----------------- | ------------------ |
| Raw HTML           | 80K-150K tokens   | —                  |
| Cleaned HTML       | 15K-30K tokens    | 5x                 |
| Accessibility Tree | 5K-15K tokens     | 10-15x             |
| Markdown           | 2K-8K tokens      | 15-40x             |

**dom-to-semantic-markdown** is the recommended conversion library for LLM consumption. Unlike generic HTML-to-Markdown converters, it's specifically designed for LLM processing with automatic main content detection, reference-style links for URL deduplication, and table column tracking markers:

```typescript
import { convertHtmlToMarkdown } from 'dom-to-semantic-markdown';

const markdown = convertHtmlToMarkdown(document.body, {
  extractMainContent: true,
  refifyUrls: true, // [text][1] style for token efficiency
  enableTableColumnTracking: true,
  includeMetaData: 'basic',
});
```

## Research confirms hierarchy preservation is critical for LLM understanding

The **D2Snap algorithm** from "Beyond Pixels: DOM Downsampling for LLM-Based Web Agents" (arXiv:2508.04412) provides the first principled approach to DOM downsampling. It uses three parameters—element merge ratio (k), text sentence drop fraction (l), and attribute filtering threshold (m)—to progressively simplify DOM while preserving hierarchical structure.

**Critical finding**: DOM hierarchy is the strongest UI feature for LLM backends. Element extraction approaches that discard parent-child relationships perform significantly worse than those preserving tree structure. D2Snap-downsampled DOMs achieved **67% success rate** on web agent benchmarks, matching visual baselines while using dramatically fewer tokens.

**AutoWebGLM's HTML simplification** achieves reduction to approximately **6% of original size** through:

1. Removing CSS, JavaScript, comments (near-lossless cleaning)
2. Merging nested single-child containers: `<div><div><p>text</p></div></div>` → `<p>text</p>`
3. Removing empty tags

**Agent-E's DOM distillation** (Emergence AI) takes a task-specific approach—dynamically selecting which DOM subtrees to include based on the current task plan. This "flexible distillation" achieved **73.2% success** on WebVoyager, a 20% improvement over prior text-only approaches.

The **VIPS algorithm** (Vision-based Page Segmentation) from Microsoft Research combines DOM structure with visual cues (position, background color, font properties) to identify semantic blocks. Its "Degree of Coherence" metric remains relevant for determining block-level extraction granularity.

## Preserving interactivity requires proxying rather than replacing

**Event listeners do not survive `cloneNode()`**—only inline handlers are copied. For seniors who need to submit forms, click buttons, and follow links, Klaro must maintain interactive functionality through an **element mapping and event forwarding pattern**:

```typescript
class InteractionProxy {
  private mapping = new Map<HTMLElement, HTMLElement>();

  // Create simplified element linked to original
  createSimplifiedElement(original: HTMLElement): HTMLElement {
    const simplified = this.buildSimplifiedVersion(original);
    this.mapping.set(simplified, original);
    simplified.dataset.klaroOriginal = original.dataset.klaroId;
    return simplified;
  }

  // Forward clicks from simplified to original
  setupEventForwarding(container: HTMLElement) {
    container.addEventListener(
      'click',
      (e) => {
        const target = e.target as HTMLElement;
        const original = this.mapping.get(target);
        if (original) {
          e.preventDefault();
          original.click(); // Triggers original's handlers
        }
      },
      true
    );
  }
}
```

**Key principle**: Hide original elements visually (`visibility: hidden` or `display: none`) but keep them in the DOM. Insert simplified versions alongside or overlaid, with event delegation forwarding interactions to the hidden originals. This preserves JavaScript-dependent functionality that would break if elements were removed.

**Form synchronization** requires bidirectional value syncing between simplified and original inputs:

```typescript
function syncInputs(simplified: HTMLInputElement, original: HTMLInputElement) {
  simplified.addEventListener('input', () => {
    original.value = simplified.value;
    original.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
```

## Latency optimization through speculative extraction

The **speculative extraction pattern** pre-extracts DOM content before users request simplification, eliminating extraction latency from the perceived wait time:

```typescript
class SpeculativeExtractor {
  private cached: Promise<string> | null = null;

  constructor() {
    document.addEventListener('DOMContentLoaded', () => this.preExtract());
    this.observeChanges(); // Re-extract on major DOM mutations
  }

  private async preExtract() {
    await waitForSPAHydration();
    this.cached = Promise.resolve(document.documentElement.outerHTML);
  }

  async getExtraction(): Promise<string> {
    return this.cached || document.documentElement.outerHTML;
  }
}
```

**Web Workers cannot access the DOM directly**—they run in isolated contexts without `document` or `window`. The workaround is extracting on the main thread, then posting the HTML string to a worker for heavy processing (cleaning, token counting, chunking) while keeping the main thread responsive.

**Timing strategy for Klaro**:

1. **DOMContentLoaded**: Begin speculative extraction
2. **+300-500ms**: Check for SPA stability via MutationObserver
3. **User clicks Simplify**: Return cached extraction instantly, begin LLM call
4. **LLM response**: Render simplified view (target total <2-3 seconds)

Caching strategies should key by URL and use content hashing (first 10K characters) to detect meaningful changes. Chrome extension storage (`chrome.storage.local`) persists cached extractions across sessions.

## Recommended pipeline architecture for Klaro

### Hackathon MVP (Simplest path to working demo)

```
┌──────────────────────────────────────────────────────────────┐
│  1. EXTRACT (Content Script, <50ms)                          │
│     document.documentElement.outerHTML                       │
│     → Wait for DOMContentLoaded + 300ms stability            │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  2. CLEAN (Content Script, <100ms)                           │
│     Readability.js extraction                                │
│     → Returns { title, content, textContent }                │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  3. CONVERT (Content Script, <50ms)                          │
│     Turndown.js: HTML → Markdown                             │
│     → Reference-style links, preserve tables                 │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  4. LLM CALL (Service Worker, 1-2 seconds)                   │
│     System prompt: "Simplify this for seniors..."            │
│     → Return simplified HTML structure                       │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│  5. RENDER (Content Script)                                  │
│     Hide original content (visibility: hidden)               │
│     Insert simplified overlay with event forwarding          │
└──────────────────────────────────────────────────────────────┘
```

**MVP libraries**:

- `@mozilla/readability` (~12KB gzipped) - content extraction
- `turndown` (~8KB gzipped) - Markdown conversion
- No external DOM library needed—use native browser `document`

### Production pipeline (Optimized for latency and quality)

```
┌─────────────────────────────────────────────────────────────────┐
│  SPECULATIVE EXTRACTION (Background, on page load)              │
│  ├─ DOMContentLoaded: Start extraction                          │
│  ├─ MutationObserver: Wait for SPA stability                    │
│  └─ Cache extraction keyed by URL + content hash                │
└─────────────────────────────────────┬───────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  CONTENT DETECTION (Decision tree)                              │
│  ├─ isProbablyReaderable() → Use Readability.js                 │
│  ├─ Has <main> or [role="main"] → Semantic extraction           │
│  ├─ SPA/web app → Accessibility tree via content script         │
│  └─ Complex site → Full DOM with aggressive pruning             │
└─────────────────────────────────────┬───────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  MULTI-STAGE CLEANING                                           │
│  1. Strip: scripts, styles, SVGs, iframes, comments             │
│  2. Remove: ads, cookie banners, navigation, footers            │
│  3. Prune: empty elements, deeply nested containers             │
│  4. Minimize: strip classes, remove data-*, keep aria-*         │
└─────────────────────────────────────┬───────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  TOKEN-AWARE CONVERSION                                         │
│  ├─ dom-to-semantic-markdown with refifyUrls                    │
│  ├─ Estimate tokens (text.length / 4)                           │
│  ├─ If >8K tokens: progressive chunking by sections             │
│  └─ Include interactive element inventory separately            │
└─────────────────────────────────────┬───────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  LLM PROCESSING                                                 │
│  ├─ Streaming response for progressive render                   │
│  ├─ Structured output: { structure, styles, interactiveMap }    │
│  └─ Fallback: Return cleaned original if LLM fails              │
└─────────────────────────────────────┬───────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  INTERACTIVE RENDER                                             │
│  ├─ Shadow DOM container for style isolation                    │
│  ├─ Element mapping: simplified ↔ original                      │
│  ├─ Event delegation forwarding clicks/inputs                   │
│  └─ MutationObserver for dynamic content updates                │
└─────────────────────────────────────────────────────────────────┘
```

### Token budget allocation strategy

For an **8K token context window** target:

| Component            | Token Budget | Purpose                         |
| -------------------- | ------------ | ------------------------------- |
| System prompt        | 500-800      | Instructions for simplification |
| Page metadata        | 100-200      | Title, description, URL         |
| Structure skeleton   | 500-1000     | Heading hierarchy, landmarks    |
| Interactive elements | 500-1000     | Buttons, forms, links inventory |
| Main content         | 4000-5000    | Cleaned text in Markdown        |
| Reserved             | 500          | LLM response overhead           |

### Critical code patterns for WXT/TypeScript

**Content script entry point**:

```typescript
// entrypoints/content.ts
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const extractor = new SpeculativeExtractor();
    const proxy = new InteractionProxy();

    chrome.runtime.onMessage.addListener((msg, _, respond) => {
      if (msg.type === 'SIMPLIFY') {
        simplifyPage(extractor, proxy).then(respond);
        return true;
      }
    });
  },
});

async function simplifyPage(extractor: SpeculativeExtractor, proxy: InteractionProxy) {
  const html = await extractor.getExtraction();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const article = new Readability(doc).parse();
  if (!article) return { error: 'Could not extract content' };

  const turndown = new TurndownService({
    headingStyle: 'atx',
    linkStyle: 'referenced',
  });
  const markdown = turndown.turndown(article.content);

  // Send to LLM via service worker
  const simplified = await chrome.runtime.sendMessage({
    type: 'LLM_SIMPLIFY',
    content: markdown,
    title: article.title,
  });

  // Render simplified view with interaction proxying
  renderSimplifiedView(simplified, proxy);
}
```

**Service worker for LLM calls**:

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg, _, respond) => {
    if (msg.type === 'LLM_SIMPLIFY') {
      callLLM(msg.content, msg.title).then(respond);
      return true;
    }
  });
});

async function callLLM(content: string, title: string): Promise<SimplifiedPage> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a UI simplification assistant for seniors. 
        Given webpage content, return a simplified HTML structure with:
        - Large, readable text (minimum 18px)
        - High contrast colors
        - Clear button/link styling
        - Simplified navigation
        - Preserved form functionality`,
      messages: [{ role: 'user', content: `Title: ${title}\n\n${content}` }],
    }),
  });
  return response.json();
}
```

## Conclusion

Building Klaro's DOM-to-simplified-UI pipeline requires balancing extraction speed, token efficiency, semantic preservation, and interactivity maintenance. **The optimal approach for the hackathon MVP combines Readability.js extraction with Turndown Markdown conversion**, achieving 15-30x token reduction while maintaining sufficient structure for LLM understanding.

For production, the **Chrome Accessibility Tree offers the most token-efficient representation** (10-20x reduction) but requires careful UX consideration around the debugger warning. The **event delegation and element mapping pattern** is non-negotiable for preserving form submissions and button functionality—seniors cannot use a "simplified" page that breaks their ability to complete tasks.

The most impactful optimizations are **speculative extraction** (eliminating wait time from user perspective) and **aggressive boilerplate removal** before LLM submission. Research from D2Snap and Agent-E confirms that **preserving hierarchical structure** is more important than minimizing tokens—flat element lists perform worse than compressed trees for LLM web understanding.
