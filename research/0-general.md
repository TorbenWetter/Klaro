# SimplifAI: Comprehensive Research for Senior-Friendly Website Simplification

A Chrome extension that dynamically simplifies website UIs for seniors represents a significant opportunity in an underserved market. While reader mode extensions and senior devices exist separately, **no solution currently combines AI-powered web simplification with senior-specific UX design while preserving site interactivity**. This research synthesizes technical APIs, UX guidelines, competitive landscape, and implementation strategies to enable a successful hackathon build.

## Part 1: Chrome extension APIs enable full DOM control

Chrome extensions can achieve complete DOM manipulation through content scripts running in an "isolated world" — sharing the page's DOM while maintaining separate JavaScript execution. Manifest V3 (required for all new extensions) introduces significant architectural changes: service workers replace persistent background pages, `declarativeNetRequest` replaces blocking `webRequest`, and remote code execution is completely banned.

**Critical APIs for SimplifAI:**

| API                                   | Purpose                      | Key Consideration                                                               |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| **Content Scripts**                   | DOM access and modification  | Runs in isolated world; use `run_at: "document_start"` for CSS to prevent flash |
| **chrome.scripting.insertCSS**        | Programmatic style injection | `origin: "USER"` provides highest CSS priority                                  |
| **MutationObserver**                  | Handle dynamic/SPA content   | Essential for React/Vue sites; debounce callbacks to 100ms+                     |
| **chrome.dom.openOrClosedShadowRoot** | Access Shadow DOM            | Chrome 88+; penetrates closed shadow roots                                      |
| **chrome.storage**                    | Persist user preferences     | Service workers have no persistent state                                        |

For permissions, the recommended approach uses `activeTab` with optional host permissions to avoid the scary "read and change all your data" warning at install. CSS declared in `content_scripts` injects **before any DOM construction**, making it ideal for preventing visual flash of unsimplified content.

Shadow DOM manipulation requires special handling — standard `querySelector` doesn't pierce shadow boundaries. The `chrome.dom.openOrClosedShadowRoot(element)` API provides access to both open and closed shadow roots for comprehensive modification. Content scripts cannot truly intercept content before render, but CSS injection at `document_start` achieves the visual effect of pre-render modification.

## Part 2: Content extraction balances fidelity with token efficiency

Mozilla's **Readability.js** emerges as the gold standard for content extraction, powering Firefox Reader View and used by **9,600+ projects**. Its multi-stage pipeline scores DOM nodes based on text density, link density, and class/ID patterns like `article|content|main` (positive) versus `sidebar|ad|nav` (negative).

**Token reduction pipeline for LLM processing:**

```
Raw HTML (~70,000 tokens)
    ↓ Remove scripts/styles/comments (-60%)
Cleaned HTML (~28,000 tokens)
    ↓ Readability.js extraction (-70%)
Article HTML (~8,000 tokens)
    ↓ Convert to Markdown (-30%)
Clean Markdown (~6,000 tokens)
```

Research from the HtmlRAG paper demonstrates that **hierarchy is the most important UI feature for LLM understanding** — flattening the DOM loses critical structural information. The D2Snap algorithm achieves 4x token reduction while preserving hierarchical relationships through type-specific handlers that merge container elements while protecting interactive components.

**Recommended library stack:**

- **Primary**: `@mozilla/readability` — battle-tested, works directly with DOM
- **Token optimization**: Jina Reader-LM (512K context, 0.84 ROUGE-L, low hallucination)
- **Backup**: `@extractus/article-extractor` for server-side processing

Key preservation decisions: keep headings (h1-h6), lists, tables, and links; strip CSS classes, inline styles, data attributes, and empty elements. The `isProbablyReaderable()` function provides a quick eligibility check to avoid heavy processing on unsuitable pages.

## Part 3: Senior UX requires specific, research-backed specifications

Nielsen Norman Group research with **179 participants across 6 websites** confirms that **52% of users 45+ don't recognize what a hamburger menu (☰) means**, and hidden navigation cuts discoverability by over 20%. Small text and targets represent the single most common complaint from elderly users.

**Critical specifications backed by research:**

| Element             | Minimum               | Recommended for Seniors | Source                     |
| ------------------- | --------------------- | ----------------------- | -------------------------- |
| Body text           | 16px                  | **18-19px**             | Health.gov, Bernard et al. |
| Contrast ratio      | 4.5:1 (WCAG AA)       | **7:1 (WCAG AAA)**      | W3C WAI                    |
| Touch/click targets | 24x24px (WCAG 2.2 AA) | **44x44px (WCAG AAA)**  | MIT/NNGroup                |
| Line height         | 1.4                   | **1.5-1.7**             | Readability research       |
| Primary nav items   | N/A                   | **5-7 maximum**         | Cognitive load studies     |

**UI elements that confuse seniors most:**

1. **Hamburger menus** — Replace with visible "MENU" button with text label
2. **Dropdown menus** — Convert to expanded static lists; hover timing fails with tremors
3. **Infinite scroll** — Causes disorientation; replace with "Load More" + page numbers
4. **Popups/modals** — Context confusion; convert to inline content
5. **Auto-playing carousels** — Can't read before content moves; show all statically

Cognitive load research shows seniors exhibit decision avoidance when faced with complex choices. Forms should be chunked into **3-5 fields visible at once**, with progressive disclosure revealing additional sections only when needed. Common senior tasks (email, news, banking, health portals, shopping) should inform which website categories receive priority simplification templates.

## Part 4: Significant market gaps exist for AI-powered simplification

The competitive landscape reveals a fragmented market with no comprehensive solution:

| Category             | Examples               | Approach                       | Gap                                       |
| -------------------- | ---------------------- | ------------------------------ | ----------------------------------------- |
| Reader extensions    | Just Read, Reader View | Extract article, display clean | Breaks interactivity, not senior-specific |
| Senior devices       | GrandPad, Oscar Senior | Custom hardware/launcher       | Device-focused, doesn't simplify web      |
| Accessibility tools  | Helperbird, BeeLine    | Font/contrast adjustment       | Passive changes only, no AI               |
| Browser reader modes | Safari, Firefox, Edge  | Built-in content extraction    | Manual activation, limited customization  |

**Key competitive gaps SimplifAI can fill:**

1. **No AI-powered semantic understanding** — Existing tools use heuristics only
2. **Interactive preservation missing** — Reader modes strip forms and buttons
3. **No persistent cross-site memory** — Users must manually activate per page
4. **Senior-specific design absent** — Tools designed for general audiences
5. **Fragmented solutions** — Users combine multiple extensions for complete coverage

GrandPad ($499+ device) and Oscar Senior ($10/month) prove market willingness to pay for senior-focused solutions. Helperbird at **1M+ users** demonstrates accessibility extension demand. The intersection — AI-powered web simplification specifically designed for seniors — remains unaddressed.

## Part 5: Hybrid architecture balances isolation with functionality

The core technical challenge: simplifying appearance while **preserving event listeners**. Critical finding: `cloneNode()` does NOT copy `addEventListener` handlers, making complete DOM replacement risky for interactive sites.

**Recommended hybrid architecture:**

1. **Shadow DOM** for extension UI (settings panel, toolbar) — complete style isolation
2. **In-place CSS modification** for page simplification — preserves all event listeners
3. **MutationObserver with 100ms debouncing** for SPA support
4. **Event delegation** for any interactive elements added by the extension

```javascript
// Pattern: In-place modification preserves events
element.style.fontSize = '18px'; // SAFE: keeps listeners
element.classList.add('simplified'); // SAFE: keeps listeners

// Avoid: Clone loses events
const clone = element.cloneNode(true); // RISKY: loses addEventListener
```

**CSS specificity strategy for overriding modern sites:**

- Use `origin: "USER"` in `insertCSS` for highest priority
- Double selectors (`.class.class`) beat single class selectors
- Monitor `<head>` with MutationObserver, re-append styles when CSS-in-JS libraries inject new stylesheets
- Namespace all classes (`ext-simplified-*`) to avoid conflicts

For SPAs, detect client-side routing via History API interception and URL change monitoring. React's virtual DOM reconciliation may overwrite modifications — target stable selectors (`data-testid`, `aria-labels`) rather than generated class names.

## Part 6: AI integration should follow a tiered capability model

Chrome's **Built-in AI (Gemini Nano)** provides local processing with zero data transmission, available in Chrome 138+ on Windows/macOS/Linux with sufficient hardware (22GB storage, 4GB+ VRAM or 16GB RAM).

**Decision framework: Heuristics vs. AI**

| Use Heuristics (Free, Instant) | Use AI (Latency, Cost)          |
| ------------------------------ | ------------------------------- |
| Font size adjustment           | Content prioritization          |
| Contrast ratio calculation     | Page type classification        |
| Known ad/popup blocking        | Jargon explanation              |
| Semantic HTML detection        | Form field grouping             |
| Link/button resizing           | "Most likely tasks" suggestions |

**Chrome Built-in AI APIs:**

- **Prompt API** — General purpose with JSON Schema for structured output
- **Summarizer API** — TL;DR, key-points, teaser modes
- **Rewriter API** — Tone/style adjustment ("casual", "shorter")
- **Writer API** — Generate explanations for confusing elements

**Efficient prompting strategy:**

```javascript
const simplificationSchema = {
  type: 'object',
  properties: {
    essential: { type: 'array', items: { type: 'string' } }, // Keep prominently
    optional: { type: 'array', items: { type: 'string' } }, // Can minimize
    remove: { type: 'array', items: { type: 'string' } }, // Hide entirely
  },
};

const result = await session.prompt(pageContent, {
  responseConstraint: simplificationSchema,
});
```

**Fallback hierarchy:** Chrome Built-in AI → WebLLM (in-browser via WebGPU) → Cloud API. WebLLM runs Phi-3, Llama 3 models locally with **80% native performance** via WebGPU acceleration, though initial model download is 1-4GB.

## Part 7: Privacy architecture must protect sensitive pages completely

The extension must completely disable on sensitive pages — banking sites, health portals, and email. HIPAA guidance explicitly states that any entity accessing Protected Health Information on authenticated pages is considered a "business associate" requiring formal agreements.

**Sensitive page detection patterns:**

```javascript
const SENSITIVE_PATTERNS = {
  domains: /bank|paypal|venmo|chase|wellsfargo|mychart|patient|portal/i,
  forms: 'form:has(input[type="password"])',
  autocomplete: 'input[autocomplete*="cc-"]', // Credit card fields
};
```

**PII that must never leave the device:**

| Data Type   | Regex Pattern                                       |
| ----------- | --------------------------------------------------- |
| SSN         | `\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b`                   |
| Credit Card | Visa/MC/Amex/Discover patterns with Luhn validation |
| Email       | Standard email pattern                              |
| Phone       | `\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`               |

**Privacy-first architecture:**

1. **Default to local processing** with Gemini Nano — no cloud transmission
2. **Scrub PII** before any AI processing with regex replacement
3. **Never modify** password forms, CSRF tokens, or authentication flows
4. **Use activeTab permission** instead of `<all_urls>` — grants access only on user click

Trust signals for seniors: clear "This stays on your computer" messaging, visible processing indicators ("Making text easier to read..."), simple opt-out toggles, and no legal jargon in privacy explanations. Research shows 82% of older adults understand security concepts but only 14% feel confident managing privacy settings.

## Part 8: Hackathon scope and implementation strategy

Based on comprehensive research across all domains, here are strategic recommendations for a 48-hour hackathon build.

### Minimum viable feature set (achievable in 48 hours)

**Core simplification (Rule-based, no AI required):**

- Increase all text to 18px minimum with CSS injection
- Boost contrast to 7:1 ratio on text elements
- Enlarge all clickable elements to 44x44px minimum
- Stop all auto-playing media and freeze carousels
- Hide common annoyances (cookie banners, newsletter popups, chat widgets)

**Navigation simplification:**

- Replace hamburger menus with visible "MENU" text button
- Convert infinite scroll to "Load More" button (detectable via scroll event patterns)

**Reader mode for articles (Using Readability.js):**

- One-click "Simplify This Page" activation
- Clean article view with senior-friendly typography
- Preserve links and images

### Technical stack recommendations

| Component          | Recommended                   | Rationale                           |
| ------------------ | ----------------------------- | ----------------------------------- |
| Content extraction | `@mozilla/readability`        | Battle-tested, 10.7K GitHub stars   |
| CSS injection      | Manifest-declared + insertCSS | Pre-render injection prevents flash |
| State management   | `chrome.storage.local`        | Persists across sessions            |
| AI (stretch)       | Chrome Prompt API             | No cloud dependencies, free         |
| Build tool         | Vite + CRXJS                  | Fast HMR for extension development  |

### Demo websites (best showcase scenarios)

1. **News site (NYTimes, CNN)** — Clear article simplification before/after
2. **E-commerce (Amazon product page)** — Demonstrate clutter removal, enlarged buttons
3. **Government site (Medicare.gov)** — Show form simplification, jargon reduction
4. **Banking login page** — Demonstrate privacy protection (extension disables automatically)

### Time allocation for 48-hour hackathon

| Phase                | Hours | Focus                                               |
| -------------------- | ----- | --------------------------------------------------- |
| Setup + Architecture | 4     | Manifest, content script structure, basic injection |
| CSS Simplification   | 8     | Font/contrast/target rules, specificity handling    |
| Reader Mode          | 8     | Readability integration, clean template             |
| Navigation Fixes     | 6     | Hamburger expansion, infinite scroll replacement    |
| Privacy Detection    | 4     | Sensitive page blocking                             |
| UI/UX Polish         | 6     | Popup settings, activation toggle                   |
| Demo Prep            | 6     | Slides, video, specific site demos                  |
| Buffer               | 6     | Bug fixes, edge cases                               |

### Potential gotchas and time sinks to avoid

1. **CSP restrictions** — Some sites block injected scripts; CSS-only modifications are safer
2. **SPA mutation loops** — MutationObserver can trigger infinite loops without proper debouncing
3. **Shadow DOM edge cases** — Don't try to solve all Shadow DOM scenarios; focus on common patterns
4. **Cross-origin iframes** — Skip these entirely for MVP; mark as future enhancement
5. **AI integration complexity** — Gemini Nano requires Chrome Dev/Canary channels and specific hardware; have pure heuristic fallback ready
6. **Form preservation** — Never modify `<form>` elements directly; only style surrounding containers

### What makes the demo impressive to judges

1. **Dramatic before/after** — Side-by-side comparison on a cluttered news site
2. **Live simplification** — Show real-time transformation as user clicks activation
3. **Privacy narrative** — Demonstrate extension auto-disabling on banking site
4. **Persona story** — Frame around specific senior user journey (e.g., "Margaret, 78, wants to read news")
5. **Quantitative impact** — "Font size increased 125%, contrast improved from 3:1 to 7:1"

### Realistic scope vs. stretch goals

| Realistic (MVP)                | Stretch Goals                    |
| ------------------------------ | -------------------------------- |
| CSS-based simplification       | AI content prioritization        |
| Manual activation per page     | Automatic page type detection    |
| Hardcoded simplification rules | User-adjustable intensity slider |
| Article reader mode            | Form wizard conversion           |
| Desktop Chrome only            | Cross-browser support            |
| English only                   | Multi-language support           |

### Architecture diagram for hackathon build

```
SimplifAI/
├── manifest.json          # MV3, activeTab, scripting, storage
├── background.js          # Service worker, message coordination
├── content/
│   ├── detector.js        # Sensitive page detection
│   ├── simplifier.js      # CSS injection, DOM modification
│   └── reader.js          # Readability.js integration
├── styles/
│   ├── base.css           # Core simplification (18px, contrast)
│   └── reader.css         # Clean article template
├── popup/
│   ├── popup.html         # Settings UI
│   └── popup.js           # Toggle activation, preferences
└── lib/
    └── Readability.js     # Bundled content extraction
```

## Conclusion

SimplifAI addresses a genuine market gap at the intersection of accessibility tools, reader modes, and senior-focused devices. The technical foundation is solid: Manifest V3 content scripts provide full DOM access, Readability.js handles content extraction, and Chrome's built-in AI enables local processing without privacy concerns.

The key insight from this research: **simplification that preserves interactivity** is the critical differentiator. Existing reader modes strip functionality; senior devices don't address web complexity. By using in-place CSS modification with event delegation, SimplifAI can make websites dramatically easier to use without breaking forms, buttons, or navigation.

For hackathon success, focus on the visual transformation story — the dramatic before/after of a cluttered website becoming clean and readable. The research-backed specifications (18px fonts, 7:1 contrast, 44x44px targets) provide defensible design decisions. Privacy protection by auto-disabling on sensitive pages demonstrates responsible engineering. Together, these elements create a compelling narrative: technology that genuinely helps a vulnerable population navigate the modern web independently.
