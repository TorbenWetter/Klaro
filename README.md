# Klaro

An accessibility sidecar browser extension built with **WXT** and **Svelte**. It helps people with disabilities and elderly users by:

- **Single view**: One combined flow of readable content (markdown) and interactive components (buttons, links, inputs, selects) in the side panel.
- **LLM-driven**: The current page is sent to Gemini; the model returns only relevant content and actions in a logical order.
- **Action forwarding**: Clicks, input values, and select choices in the panel are forwarded to the real page (high-contrast, accessible UI).

## Tech stack

- **WXT** – extension tooling (HMR, Manifest v3, side panel)
- **Svelte 5** – small, fast UI
- **Tailwind CSS** – high-contrast styling
- **@mozilla/readability** – article extraction

## Setup

```bash
pnpm install
```

**API key:** Copy `.env.example` to `.env` and set your Gemini API key (get one at [Google AI Studio](https://aistudio.google.com/app/apikey)):

```bash
cp .env.example .env
# Edit .env and set: VITE_GEMINI_API_KEY=your_actual_key
```

The extension reads `VITE_GEMINI_API_KEY` from `.env` at build time. Without it, the LLM call will fail and the panel falls back to a raw copy of the page content.

If you hit pnpm store location errors, use your normal store or run `pnpm install` from the project root after fixing store config.

## Development

```bash
pnpm dev
```

Load the extension from `.output/chrome-mv3` (or the path WXT prints). Click the extension icon to open the **side panel** (no popup). The panel scans the active tab and shows one combined flow: markdown summaries and interactive elements you can use from the panel; actions are applied on the page.

## Build

```bash
pnpm build
pnpm zip   # optional: pack for store
```

## Project structure

- `src/entrypoints/background.ts` – opens side panel on action click
- `src/entrypoints/content.ts` – runs on pages; handles `SCAN_PAGE`, `CLICK_ELEMENT`, `SET_INPUT_VALUE`, `SET_SELECT_VALUE`
- `src/entrypoints/sidepanel/App.svelte` – single view: renders LLM-structured blocks (markdown + action components)
- `src/lib/sidebar-types.ts` – `SidebarBlock` union and block types
- `src/lib/MarkdownBlock.svelte`, `ActionButton.svelte`, `ActionLink.svelte`, `ActionInput.svelte`, `ActionSelect.svelte` – pre-built components
- `src/utils/dom-scanner.ts` – Readability + TreeWalker; assigns `data-acc-id`, exposes select options
- `src/utils/minimize-dom.ts` – builds minimal page text for the LLM
- `src/utils/gemini.ts` – `getGeminiStructuredBlocks` (structured JSON) and `getGeminiSimplify`
- `src/utils/llm-service.ts` – `getLLMStructuredSidebar` (with fallback from pageCopy)

## Recommended IDE

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).
