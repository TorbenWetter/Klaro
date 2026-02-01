# Optimal technology stack for Klaro: A Chrome extension for seniors

**WXT with Preact and Lit emerges as the optimal combination** for building Klaro, a Chrome extension that dynamically simplifies website UIs for seniors. This stack balances developer velocity with the technical demands of content script injection—the core challenge for any extension that modifies third-party websites.

For a **48-hour hackathon**, the recommended stack is WXT + React + Tailwind + Zustand, achievable in under 15 minutes setup time. For **long-term production**, swap React for Preact (90% smaller bundles) and add Lit specifically for injected UI components where Shadow DOM isolation is critical.

---

## Chrome extension bundlers have converged on Vite

The bundler landscape for Chrome extensions has shifted dramatically toward Vite-based solutions in 2024-2025, with three clear leaders emerging from the comparison of seven major options.

**WXT (Web Extension Tools)** stands as the recommended choice for most new projects. Built on Vite, it offers file-based entrypoints similar to Nuxt, automatic manifest generation from inline config, and critically, support for both Manifest V2 and V3 from a single codebase. With **8,500 GitHub stars**, 196 contributors, and active maintenance through September 2025 (v0.20.11), WXT provides the most future-proof foundation. Its bundle sizes run **40-50% smaller** than Plasmo in real-world comparisons—one migration from Plasmo to WXT reduced ZIP size from 700KB to 400KB.

| Bundler       | HMR Content Scripts | MV3 Support | TypeScript    | Build Speed     | Maintenance Status                            |
| ------------- | ------------------- | ----------- | ------------- | --------------- | --------------------------------------------- |
| **WXT**       | Fast reload         | Full        | Native        | Fast (Vite)     | ✅ Active                                     |
| **CRXJS**     | True HMR            | Full        | Native        | Fast (Vite)     | ⚠️ Seeking maintainers (deadline: March 2025) |
| **Plasmo**    | Partial             | Full        | Native        | Medium (Parcel) | ⚠️ Concerns                                   |
| **Webpack**   | Plugin needed       | Manual      | Config needed | Slow            | Varies                                        |
| **Parcel**    | No (MV3)            | Partial     | Native        | Fast            | Active                                        |
| **Turbopack** | N/A                 | None        | N/A           | N/A             | Not ready for extensions                      |

**CRXJS (@crxjs/vite-plugin)** offers the only true Hot Module Replacement for content scripts—instant UI updates while preserving extension state. However, the project has posted a **critical warning**: the maintenance team must establish by March 31, 2025, or the repository will be archived June 1, 2025. This uncertainty makes it risky for new long-term projects despite its 3,800 stars and technical excellence.

**Plasmo** holds the highest star count (**12,600**) but uses Parcel rather than Vite, causing incompatibilities with modern tooling like TailwindCSS v4 and producing larger bundle sizes. Community reports indicate reduced active development, and framework lock-in can complicate Vue or advanced React patterns.

---

## WXT vs Plasmo: The framework decision comes down to maintenance and flexibility

For Klaro specifically, WXT's advantages are decisive. The extension will need to inject UI into arbitrary websites to simplify them for seniors—a task requiring reliable content script handling and style isolation.

**Plasmo's CSUI (Content Script UI)** provides built-in Shadow DOM injection with anchor types (overlay, inline, overlay-anchor) and lifecycle functions like `getInlineAnchor` and `getOverlayAnchor`. The `@plasmohq/messaging` package offers type-safe REST-style handlers that simplify background-to-content communication:

```typescript
// Plasmo's messaging pattern
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const result = await processRequest(req.body);
  res.send({ result });
};
```

However, **WXT's Vite foundation** provides access to the entire Vite plugin ecosystem, better tree-shaking, and framework agnosticism. WXT recommends using `@webext-core/messaging` for typed messaging and `wxt/storage` with built-in migration support. The trade-off is no built-in CSUI equivalent—Shadow DOM injection requires manual implementation or using Lit components.

| Feature            | WXT                                 | Plasmo         |
| ------------------ | ----------------------------------- | -------------- |
| Bundler            | Vite (modern)                       | Parcel (dated) |
| MV2+MV3 support    | Both simultaneously                 | MV3 primarily  |
| Framework support  | Fully agnostic                      | React-first    |
| Bundle size        | Smaller (40-50% reduction reported) | Larger         |
| Active maintenance | ✅ Strong                           | ⚠️ Concerns    |
| Built-in CSUI      | No                                  | Yes            |
| Storage migrations | Built-in                            | No             |

**Extension.js** (4,500 stars) offers zero-config simplicity and the unique ability to run Chrome Extension Samples directly from GitHub URLs (`npx extension dev <github-url>`), making it valuable for prototyping. **Bedframe** (565 stars) focuses on CI/CD workflows with GitHub Actions integration for automated versioning and publishing—useful for enterprise deployments but overkill for hackathons.

---

## UI framework selection depends on where the UI renders

Klaro's architecture involves two distinct UI contexts: the **popup/options pages** (controlled environment) and **injected content script UI** (hostile environment on third-party pages). Each context has different optimal choices.

**For injected content script UI, Lit is the clear winner.** Unlike every other framework evaluated, Lit creates native Web Components with **built-in Shadow DOM by default**. Every `LitElement` automatically encapsulates styles, preventing the host page's CSS from affecting Klaro's UI and vice versa. At **~5KB minified+gzipped**, Lit provides this isolation without the manual setup required by React, Preact, Svelte, SolidJS, or Vue.

```javascript
// Lit component - Shadow DOM automatic
import { LitElement, html, css } from 'lit';

class SimplifyButton extends LitElement {
  static styles = css`
    button {
      /* Styles isolated from page */
    }
  `;
  render() {
    return html`<button @click=${this.simplify}>Simplify</button>`;
  }
}
```

**For popup and options pages**, bundle size matters less since these load from the extension's local files. **Preact** (3-5KB) offers the best balance—90% smaller than React while maintaining full React ecosystem compatibility via `preact/compat`. Teams familiar with React can use their existing knowledge and most React libraries without modification.

| Framework      | Bundle Size (min+gzip) | Shadow DOM | TypeScript | Best Use Case               |
| -------------- | ---------------------- | ---------- | ---------- | --------------------------- |
| **Lit**        | ~5 KB                  | Native ✅  | Native     | Content script UI           |
| **Preact**     | ~3-5 KB                | Manual     | Excellent  | Popup/options (React teams) |
| **Svelte**     | ~2 KB + compiled       | Manual     | Excellent  | Popup/options (small apps)  |
| **SolidJS**    | ~7-8 KB                | Manual     | Excellent  | Performance-critical UI     |
| **React**      | ~42-45 KB              | Manual     | Excellent  | Large existing codebases    |
| **Vue 3**      | ~21 KB                 | Manual     | Excellent  | Vue teams                   |
| **Vanilla TS** | 0 KB                   | Native     | Native     | Minimal UI requirements     |

For frameworks without native Shadow DOM support, manual setup is required. React components must render into a manually created shadow root using `createRoot`, and CSS-in-JS solutions like Emotion need `CacheProvider` with the shadow root as the container. This adds **20-30 lines of boilerplate** per injection point.

---

## State management should prioritize tiny bundles and chrome.storage integration

Chrome extensions have unique state management requirements: state must persist across service worker restarts, sync between popup/content/background contexts, and optionally sync across devices via Chrome's sync infrastructure.

**chrome.storage.local** provides 10MB of local storage (unlimited with permission), while **chrome.storage.sync** offers ~100KB that syncs across Chrome instances but has rate limits (120 writes/minute). For Klaro's user preferences, `.sync` is ideal—seniors often use multiple devices, and their simplification settings should follow them.

For application state beyond simple persistence, **Nanostores** at **286 bytes** is the smallest viable option:

```javascript
import { persistentAtom } from '@nanostores/persistent';

// Configure chrome.storage as the engine
const $simplifyLevel = persistentAtom('simplify-level', 'moderate', {
  encode: JSON.stringify,
  decode: JSON.parse,
});
```

**Zustand** (~2.9KB) offers more features including React hooks integration and middleware support. With `zustand-chrome-storage` or a custom adapter, state automatically persists to chrome.storage:

```javascript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useStore = create(
  persist(
    (set) => ({
      simplifyLevel: 'moderate',
      setLevel: (level) => set({ simplifyLevel: level }),
    }),
    { name: 'klaro-settings', storage: chromeStorageAdapter }
  )
);
```

**Redux Toolkit** at 30-40KB is overkill for most extensions unless the team already uses Redux or needs extensive time-travel debugging. **webext-redux** specifically handles multi-context synchronization for Redux stores but adds complexity most extensions don't require.

---

## Content script architecture requires Shadow DOM and efficient DOM observation

For Klaro to modify third-party websites without breaking them—or being broken by them—proper isolation architecture is essential.

**Shadow DOM injection** creates an encapsulated boundary:

```javascript
// Create isolated container for Klaro UI
const host = document.createElement('div');
host.id = 'klaro-extension-root';
const shadowRoot = host.attachShadow({ mode: 'closed' });

// Inject styles that can't leak out or be affected by page
const sheet = new CSSStyleSheet();
sheet.replaceSync(`.klaro-button { /* isolated styles */ }`);
shadowRoot.adoptedStyleSheets = [sheet];

document.body.appendChild(host);
```

**MutationObserver patterns** are critical for Klaro to detect dynamic content loads (SPAs, infinite scroll, lazy loading) and apply simplifications:

```javascript
// Debounced observer for efficient DOM watching
let timeout;
const observer = new MutationObserver((mutations) => {
  clearTimeout(timeout);
  timeout = setTimeout(() => processNewContent(mutations), 100);
});

observer.observe(document.body, { childList: true, subtree: true });
```

**CSS-in-JS vs external CSS**: For content scripts, CSS-in-JS (Emotion, styled-components) with shadow root targeting is preferred because styles are bundled with components and automatically isolated. External CSS requires `web_accessible_resources` configuration and still risks conflicts without Shadow DOM.

**Dynamic imports** work in content scripts but all chunks must be declared in `web_accessible_resources`. Manifest V3 prohibits remote code execution—everything must be bundled at build time.

---

## Testing strategy combines Vitest for speed and Playwright for E2E

**Vitest** provides the fastest unit testing experience for extensions, with native ESM support and instant watch mode. The **vitest-chrome** package provides complete Chrome API mocks:

```javascript
// vitest.init.ts
import * as chrome from 'vitest-chrome';
Object.assign(global, chrome);

// Test example
test('storage operations', async () => {
  await chrome.storage.local.set({ key: 'value' });
  const result = await chrome.storage.local.get('key');
  expect(result.key).toBe('value');
});
```

**Playwright** handles E2E testing by loading unpacked extensions into Chromium:

```javascript
const context = await chromium.launchPersistentContext('', {
  args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
});
```

**Shadow DOM testing** requires **shadow-dom-testing-library** since standard Testing Library queries can't penetrate shadow boundaries:

```javascript
import { screen } from 'shadow-dom-testing-library';
screen.getByShadowRole('button'); // Finds button inside shadow root
```

---

## Developer tooling checklist for Chrome extensions

**TypeScript configuration** should enable strict mode for better Chrome API typing:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@types/chrome"]
  }
}
```

**@types/chrome** (1.6M+ weekly downloads) provides community-maintained types, while **chrome-types** from Google auto-generates types daily from Chromium source—more current for bleeding-edge APIs.

**ESLint with extension rules**: Use `eslint-plugin-crx-v3` for Manifest V3-specific linting and `globals.webextensions` for proper global recognition:

```javascript
// eslint.config.js
import globals from 'globals';
export default [
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
];
```

**Hot reload** beyond bundler HMR: **hot-reload-extension-vite-plugin** provides reliable reload for service workers and side panels. The "Advanced Extension Reloader" browser extension offers one-click manual reload with configurable hotkeys.

**Debugging service workers**: Navigate to `chrome://extensions`, click "Inspect views: service worker" to open DevTools. Keep DevTools open to prevent service worker termination during debugging—but close it to test lifecycle behavior.

---

## Production architecture handles tree-shaking, updates, and analytics

**Tree shaking** works best with Vite/Rollup. Common issues include barrel files (`index.ts` re-exports) and CommonJS dependencies. Use direct imports and ES module versions of libraries (lodash-es instead of lodash).

**Chrome Web Store limits**: Maximum package size is 2GB (ZIP), but performance degrades with size. Most successful extensions stay under 10MB. `storage.local` allows 10MB (unlimited with permission), `storage.sync` caps at ~100KB total.

**Auto-updates** check every 5-6 hours and can take 24-48 hours to propagate. Extensions with 10,000+ weekly users can use staged rollouts (5% → 25% → 100%) to catch issues before full deployment.

**Error tracking**: Sentry works with MV3 but must be bundled (not loaded from CDN). Configure `beforeSend` to truncate file paths for proper source map matching. All analytics require privacy policy disclosure.

**Monorepo setup** is unnecessary for most extensions. Start with pnpm workspaces if sharing code between related projects; add Turborepo only if build times exceed 30 seconds.

---

## Hackathon stack achieves working prototype in 15 minutes

For a 48-hour hackathon building Klaro:

| Component        | Choice             | Reasoning                                             |
| ---------------- | ------------------ | ----------------------------------------------------- |
| **Bundler**      | WXT                | 3-5 min setup, best HMR, auto-opens browser           |
| **UI Framework** | React              | Fastest for most teams; swap to Preact for production |
| **Styling**      | Tailwind + DaisyUI | Zero config, copy-paste components                    |
| **State**        | Zustand            | Simple API, works across contexts                     |
| **Content UI**   | React initially    | Add Lit for production Shadow DOM needs               |

```bash
# Complete hackathon setup
npx wxt@latest init klaro --template react
cd klaro
npm install -D tailwindcss postcss autoprefixer daisyui
npm install zustand
npx tailwindcss init -p
npm run dev  # Browser opens with extension loaded
```

**Critical hackathon pitfalls to avoid**:

- Service workers have no DOM—`document`, `window.*` don't exist
- Event listeners must register synchronously at top level, not inside async callbacks
- All code must be bundled; no CDN scripts allowed in MV3
- Use `chrome.alarms` instead of `setTimeout` (service worker may terminate)
- Use `chrome.storage` for all persistence (variables don't survive restarts)

---

## Long-term production stack adds Lit and proper testing

For production Klaro:

| Component  | Hackathon | Production                            |
| ---------- | --------- | ------------------------------------- |
| Bundler    | WXT       | WXT (same)                            |
| Popup UI   | React     | Preact (90% smaller)                  |
| Content UI | React     | **Lit** (native Shadow DOM)           |
| State      | Zustand   | Zustand + wxt/storage migrations      |
| Testing    | Skip      | Vitest + Playwright                   |
| CI/CD      | Manual    | GitHub Actions + automated publishing |
| Analytics  | Skip      | Sentry (bundled)                      |

The Lit addition is critical for Klaro's core functionality. Injecting simplification UI into arbitrary websites requires bulletproof style isolation. Lit's automatic Shadow DOM encapsulation prevents the visual inconsistencies that would confuse senior users—exactly the population Klaro serves.

## Conclusion

**WXT + Preact + Lit + Zustand** forms the optimal stack for Klaro. WXT provides the most actively maintained build foundation with Vite's speed and ecosystem. Preact delivers React's developer experience at 10% of the bundle cost for extension pages. Lit solves the fundamental challenge of injecting isolated UI into third-party websites. Zustand offers the simplest state management that properly integrates with Chrome's storage APIs.

For hackathon velocity, substitute React for Preact and skip Lit initially—these optimizations can be added incrementally. The critical insight is that **bundler choice matters most**: WXT's HMR, automatic manifest generation, and active maintenance will save hours of debugging that would otherwise consume hackathon time. Start with `npx wxt@latest init --template react` and focus on building features, not fighting tooling.
