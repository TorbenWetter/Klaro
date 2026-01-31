# Klaro

An accessibility sidecar browser extension built with **WXT** and **Svelte**. It helps users (especially seniors) by:

- **Read**: Extracts main article content with Mozilla Readability and shows a simple summary.
- **Do**: Lists interactive elements (buttons, links, inputs) and lets you trigger them from the side panel with one click (high-contrast, Neo-Brutalism style).

## Tech stack

- **WXT** – extension tooling (HMR, Manifest v3, side panel)
- **Svelte 5** – small, fast UI
- **Tailwind CSS** – high-contrast styling
- **@mozilla/readability** – article extraction

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env` and set your Gemini API key (get one at [Google AI Studio](https://aistudio.google.com/app/apikey)):

```bash
cp .env.example .env
# Edit .env and set VITE_GEMINI_API_KEY=your_key
```

If you hit pnpm store location errors, use your normal store or run `pnpm install` from the project root after fixing store config.

## Development

```bash
pnpm dev
```

Load the extension from `.output/chrome-mv3` (or the path WXT prints). Click the extension icon to open the **side panel** (no popup). The side panel scans the active tab on open and lets you switch between **Read** and **Do** modes.

## Build

```bash
pnpm build
pnpm zip   # optional: pack for store
```

## Project structure

- `src/entrypoints/background.ts` – opens side panel on action click
- `src/entrypoints/content.ts` – runs on pages; handles `SCAN_PAGE` and `CLICK_ELEMENT` messages
- `src/entrypoints/sidepanel/` – Svelte UI (Read/Do tabs, article summary, action buttons)
- `src/utils/dom-scanner.ts` – Readability + TreeWalker for article and interactive elements
- `src/utils/llm-service.ts` – stub for future LLM summary/priority (replace with OpenAI/Gemini when ready)

## Recommended IDE

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).
