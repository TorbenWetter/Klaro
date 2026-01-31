import type { ScanResult } from './dom-scanner';
import { type AccessibleUI, parseAccessibleUI, getSchemaDescription } from '$lib/schemas/accessible-ui';
import { type GeminiResponse, extractGeminiText, parseGeminiJson } from './gemini-types';

/** Gemini API key from env (set in .env as VITE_GEMINI_API_KEY). */
const GEMINI_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

/** Cache TTL for UI conversions (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Formats the scan result into a concise representation for the LLM
 */
function formatScanForLLM(scan: ScanResult): string {
  const parts: string[] = [];

  // Page title and description from article
  if (scan.article) {
    parts.push(`PAGE TITLE: ${scan.article.title}`);
    if (scan.article.byline) {
      parts.push(`BYLINE: ${scan.article.byline}`);
    }
    const articlePreview = scan.article.textContent.slice(0, 1500);
    parts.push(`\nARTICLE CONTENT:\n${articlePreview}${scan.article.textContent.length > 1500 ? '...' : ''}`);
  }

  // Headings structure
  if (scan.headings.length > 0) {
    parts.push('\nHEADINGS STRUCTURE:');
    for (const h of scan.headings.slice(0, 20)) {
      parts.push(`${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`);
    }
  }

  // Interactive elements (with IDs for binding)
  if (scan.actions.length > 0) {
    parts.push('\nINTERACTIVE ELEMENTS (use elementId for actionBinding):');
    for (const a of scan.actions.slice(0, 50)) {
      parts.push(`- id="${a.id}" [${a.tag}] ${a.text}`);
    }
  }

  // Page content blocks
  if (scan.pageCopy.length > 0) {
    parts.push('\nPAGE CONTENT IN ORDER:');
    for (const block of scan.pageCopy.slice(0, 100)) {
      if (block.type === 'heading') {
        parts.push(`[H${block.level}] ${block.text}`);
      } else if (block.type === 'text') {
        parts.push(`[TEXT] ${block.content.slice(0, 200)}${block.content.length > 200 ? '...' : ''}`);
      } else if (block.type === 'action') {
        parts.push(`[ACTION id="${block.id}"] [${block.tag}] ${block.text}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Create the system prompt for the LLM
 */
function getSystemPrompt(): string {
  return `You are an accessibility expert helping to create an accessible version of a web page.
Your task is to analyze the page content and structure, then output a JSON object that describes
an accessible UI using the component schema below.

IMPORTANT GUIDELINES:
1. Create a clean, organized, accessible representation of the page
2. Group related content into cards with clear titles
3. Use semantic heading levels (h1 for main title, h2 for sections, etc.)
4. For interactive elements (buttons, links, inputs), include actionBinding with the exact elementId from the INTERACTIVE ELEMENTS list
5. Prioritize the most important actions and content for users who need accessibility features
6. Use appropriate components: alerts for important notices, badges for status, tables for tabular data
7. Keep text concise and clear
8. Output ONLY valid JSON, no markdown code blocks or extra text

${getSchemaDescription()}

Respond with ONLY the JSON object, no markdown formatting.`;
}

/**
 * Calls Gemini to convert page scan into accessible UI structure
 */
async function callGeminiForUI(scanText: string): Promise<AccessibleUI> {
  const systemPrompt = getSystemPrompt();

  const body = {
    contents: [
      {
        parts: [{ text: `${systemPrompt}\n\n---\n\nPAGE DATA:\n${scanText}` }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = extractGeminiText(data);
  
  if (!text) {
    throw new Error('Gemini returned no text');
  }

  const parsed = parseGeminiJson<unknown>(text);
  return parseAccessibleUI(parsed);
}

/**
 * Creates a fallback UI from the scan result when LLM fails
 */
function createFallbackUI(scan: ScanResult): AccessibleUI {
  const nodes: AccessibleUI['nodes'] = [];

  if (scan.article?.title) {
    nodes.push({
      type: 'heading',
      level: 1,
      text: scan.article.title,
    });
  }

  if (scan.article?.textContent) {
    const paragraphs = scan.article.textContent
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 20)
      .slice(0, 10);

    for (const p of paragraphs) {
      nodes.push({
        type: 'paragraph',
        text: p.trim().slice(0, 500),
      });
    }
  }

  if (scan.actions.length > 0) {
    const actionNodes: AccessibleUI['nodes'] = [];
    for (const action of scan.actions.slice(0, 15)) {
      actionNodes.push({
        type: 'button',
        label: action.text,
        variant: action.tag === 'a' ? 'link' : 'default',
        actionBinding: {
          elementId: action.id,
          action: 'click',
        },
      });
    }

    nodes.push({
      type: 'card',
      title: 'Available Actions',
      description: 'Interactive elements on this page',
      children: actionNodes,
    });
  }

  return {
    title: scan.article?.title || 'Page Content',
    description: 'Accessible view of the page content',
    nodes,
  };
}

/**
 * Converts a page scan result into an accessible UI structure using LLM
 */
export async function convertPageToUI(scan: ScanResult): Promise<AccessibleUI> {
  if (!scan.article && scan.pageCopy.length === 0 && scan.actions.length === 0) {
    return {
      title: 'Empty Page',
      description: 'No content found on this page',
      nodes: [
        {
          type: 'alert',
          variant: 'default',
          description: 'This page appears to be empty or could not be scanned.',
        },
      ],
    };
  }

  const scanText = formatScanForLLM(scan);

  try {
    return await callGeminiForUI(scanText);
  } catch {
    return createFallbackUI(scan);
  }
}

/**
 * Cache for storing converted UI by URL to avoid repeated LLM calls
 */
interface CacheEntry {
  ui: AccessibleUI;
  timestamp: number;
}

const uiCache = new Map<string, CacheEntry>();
let lastCacheCleanup = 0;
const CACHE_CLEANUP_INTERVAL_MS = 60_000; // Clean up at most once per minute

/**
 * Removes expired entries from the cache (runs periodically, not on every call)
 */
function cleanupCacheIfNeeded(): void {
  const now = Date.now();
  if (now - lastCacheCleanup < CACHE_CLEANUP_INTERVAL_MS) return;
  
  lastCacheCleanup = now;
  for (const [key, value] of uiCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      uiCache.delete(key);
    }
  }
}

/**
 * Converts page to UI with caching
 */
export async function convertPageToUIWithCache(
  scan: ScanResult,
  url: string,
): Promise<AccessibleUI> {
  const cached = uiCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.ui;
  }

  const ui = await convertPageToUI(scan);
  uiCache.set(url, { ui, timestamp: Date.now() });
  
  // Periodically clean up expired entries
  cleanupCacheIfNeeded();

  return ui;
}

/**
 * Converts a new subtree (like a modal or popup) into accessible UI structure
 * This is used for incremental updates when new UI contexts appear
 */
export async function convertSubtreeToUI(
  description: string,
  elements: { id: string; tag: string; text: string }[],
): Promise<AccessibleUI | null> {
  if (!description && elements.length === 0) {
    return null;
  }

  const prompt = `You are converting a new UI element that just appeared on the page into an accessible format.

${getSchemaDescription()}

NEW UI CONTENT:
${description}

INTERACTIVE ELEMENTS (use elementId for actionBinding):
${elements.map(e => `- id="${e.id}" [${e.tag}] ${e.text}`).join('\n')}

Create a concise accessible representation of this new UI. 
If it's a dialog/modal, wrap it in a card with a clear title.
Include all interactive elements with their actionBindings.

Respond with ONLY valid JSON, no markdown formatting.`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  };

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('Gemini API error for subtree:', res.status);
      return createFallbackSubtreeUI(elements);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = extractGeminiText(data);
    
    if (!text) {
      return createFallbackSubtreeUI(elements);
    }

    const parsed = parseGeminiJson<unknown>(text);
    return parseAccessibleUI(parsed);
  } catch (e) {
    console.error('Failed to convert subtree:', e);
    return createFallbackSubtreeUI(elements);
  }
}

/**
 * Creates a simple fallback UI for a subtree when LLM fails
 */
function createFallbackSubtreeUI(
  elements: { id: string; tag: string; text: string }[],
): AccessibleUI {
  const nodes: AccessibleUI['nodes'] = [];

  for (const el of elements) {
    if (el.tag === 'input' || el.tag === 'textarea') {
      nodes.push({
        type: 'input',
        label: el.text || 'Input',
        actionBinding: { elementId: el.id, action: 'click' },
      });
    } else if (el.tag === 'select') {
      nodes.push({
        type: 'select',
        label: el.text || 'Select',
        options: [{ value: '', label: '(options loading...)' }],
        actionBinding: { elementId: el.id, action: 'click' },
      });
    } else {
      nodes.push({
        type: 'button',
        label: el.text || el.tag,
        variant: el.tag === 'a' ? 'link' : 'default',
        actionBinding: { elementId: el.id, action: 'click' },
      });
    }
  }

  return {
    title: 'New Content',
    description: 'New interactive elements appeared',
    nodes: [{
      type: 'card',
      title: 'New Content',
      children: nodes,
    }],
  };
}

export type { AccessibleUI };
