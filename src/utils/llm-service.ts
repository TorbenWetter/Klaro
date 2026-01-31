import { minimizeForLLM } from './minimize-dom';
import { getGeminiSimplify, callGemini } from './gemini';
import type { ArticleResult, ScannedAction } from './dom-scanner';
import type { ScannedLandmark } from './landmark-scanner';
import type {
  LLMPageResponse,
  LLMElementResponse,
  ElementDecision,
} from '$lib/schemas/landmark-section';
import {
  LLMPageResponse as LLMPageResponseSchema,
  LLMElementResponse as LLMElementResponseSchema,
} from '$lib/schemas/landmark-section';
import { landmarksToPrompt } from './landmark-scanner';

export interface LLMSimplificationResult {
  summary: string;
  priorityIds: string[];
}

function heuristicFallback(
  article: ArticleResult | null,
  actions: ScannedAction[]
): LLMSimplificationResult {
  const text = article?.textContent ?? '';
  const summary =
    text.length > 0
      ? `Here is the main point: ${text.slice(0, 150).trim()}...`
      : 'No article found. This might be a tool or app.';

  const priorityKeywords = [
    'sign in',
    'log in',
    'login',
    'search',
    'buy',
    'submit',
    'continue',
    'next',
    'send',
  ];
  const scored = actions.map((a) => {
    const lower = a.text.toLowerCase();
    const score = priorityKeywords.some((k) => lower.includes(k)) ? 2 : 1;
    return { ...a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const priorityIds = scored.slice(0, 5).map((a) => a.id);

  return { summary, priorityIds };
}

/**
 * Minimizes the page data for token efficiency, then calls Gemini in the frontend.
 * Falls back to heuristic summary/priorities if the API fails.
 */
export async function getLLMSimplification(
  article: ArticleResult | null,
  actions: ScannedAction[]
): Promise<LLMSimplificationResult> {
  const minimized = minimizeForLLM(article, actions);

  try {
    return await getGeminiSimplify(minimized);
  } catch {
    return heuristicFallback(article, actions);
  }
}

// =============================================================================
// Landmark-Based Importance Evaluation
// =============================================================================

/** System prompt for full page evaluation */
const PAGE_IMPORTANCE_PROMPT = `You are helping simplify a webpage for seniors (65+).

Given the page content organized by sections, decide which interactive elements are IMPORTANT for a senior to see, and provide enhanced labels that are clear and action-oriented.

NOTE: Many pages do NOT have proper semantic HTML structure (no <nav>, <main>, <footer> tags). The sections may be inferred from class names or visual groupings. Work with whatever structure is provided.

CRITERIA FOR IMPORTANCE (mark as important: true):
- Primary actions: submit, register, login, search, checkout, buy, add to cart
- Essential navigation: home, main menu items, back, previous/next
- Form fields that must be filled (name, email, password, etc.)
- Critical information links (help, contact, account)
- Tab buttons that reveal important content

EXCLUDE (mark as important: false):
- Social media sharing buttons
- Newsletter signup popups
- Chat widgets
- Advertising links
- "Close" or "X" buttons for banners/popups
- Secondary navigation: breadcrumbs, pagination beyond page 1-2, minor links
- Developer/admin tools
- Duplicate actions (e.g., multiple "Login" buttons - only mark one important)
- Decorative elements

LABEL ENHANCEMENT:
- Use clear, action-oriented language
- "Submit" → "Send your registration"
- "Learn more" → "Read about our services"
- Keep labels concise (under 40 characters)
- Use simple words seniors understand
- If the element has no clear label, describe what it does based on context

FOR SECTIONS WITHOUT CLEAR NAMES:
- Infer the purpose from content (e.g., section with form fields → "Registration Form")
- Use descriptive titles like "Main Actions", "Page Navigation", "Contact Options"

Respond with JSON only, no markdown:
{
  "elements": {
    "<fingerprint_id>": { "important": true/false, "label": "Enhanced label" }
  },
  "sections": {
    "<landmark_type>": { "title": "Section Title", "description": "Brief description (optional)" }
  }
}`;

/** System prompt for single element evaluation */
const ELEMENT_IMPORTANCE_PROMPT = `A new interactive element appeared on a webpage being simplified for seniors.

Decide if this element is IMPORTANT for a senior to see, and if so, provide an enhanced label.

CRITERIA FOR IMPORTANCE:
- Primary actions (submit, login, search, buy)
- Essential navigation
- Form fields
- Critical links

EXCLUDE:
- Social sharing
- Ads
- Secondary navigation
- Duplicate actions

Respond with JSON only:
{ "important": true/false, "label": "Enhanced label if important" }`;

/**
 * Evaluate importance and generate enhanced labels for all elements on a page.
 * Used on initial page load.
 */
export async function evaluatePageImportance(
  landmarks: ScannedLandmark[]
): Promise<LLMPageResponse> {
  // Convert landmarks to prompt format
  const prompt = landmarksToPrompt(landmarks);

  try {
    const response = await callGemini({
      system: PAGE_IMPORTANCE_PROMPT,
      user: prompt,
      temperature: 0.2,
      maxTokens: 4096,
    });

    // Parse and validate response
    const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const result = LLMPageResponseSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Partial success - use what we can
    console.warn('[Klaro] LLM response validation failed, using partial data:', result.error);
    return {
      elements: parsed.elements || {},
      sections: parsed.sections || {},
    };
  } catch (error) {
    console.error('[Klaro] evaluatePageImportance failed:', error);
    // Return empty response - caller should use heuristic fallback
    return { elements: {}, sections: {} };
  }
}

/**
 * Evaluate a single new element (for incremental updates).
 * Used when ElementTracker detects a new element.
 */
export async function evaluateNewElement(
  elementType: string,
  currentLabel: string,
  landmarkType: string,
  nearbyText: string
): Promise<LLMElementResponse> {
  const context = `
Element type: ${elementType}
Current label: ${currentLabel}
Section: ${landmarkType}
Nearby text: ${nearbyText.slice(0, 200)}
`.trim();

  try {
    const response = await callGemini({
      system: ELEMENT_IMPORTANCE_PROMPT,
      user: context,
      temperature: 0.2,
      maxTokens: 256,
    });

    // Parse and validate response
    const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const result = LLMElementResponseSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Fallback to marking as not important
    console.warn('[Klaro] Single element LLM response validation failed:', result.error);
    return { important: false, label: currentLabel };
  } catch (error) {
    console.error('[Klaro] evaluateNewElement failed:', error);
    // Fallback - show the element but with original label
    return { important: true, label: currentLabel };
  }
}

/**
 * Check if an element should be excluded from LLM evaluation to save tokens.
 * This is purely technical filtering, NOT content-based filtering.
 *
 * Excludes:
 * - Elements with no text/label
 * - Known boilerplate (ads, tracking, cookie banners)
 * - Tiny elements (likely spacers or tracking pixels)
 */
export function shouldExcludeFromLLM(
  elementType: string,
  label: string,
  fingerprint?: { boundingBox?: { width: number; height: number } }
): { exclude: boolean; reason?: string } {
  // No text = can't be useful to show
  if (!label || label.trim().length === 0) {
    return { exclude: true, reason: 'no-text' };
  }

  // Very short meaningless labels (single char, just punctuation)
  const trimmed = label.trim();
  if (trimmed.length === 1 && /^[^\w]$/.test(trimmed)) {
    return { exclude: true, reason: 'punctuation-only' };
  }

  // Tiny elements (likely tracking pixels or spacers)
  // Use 1% of viewport as minimum, with 5px absolute floor
  if (fingerprint?.boundingBox) {
    const { width, height } = fingerprint.boundingBox;
    const minDimension = Math.max(5, Math.min(window.innerWidth, window.innerHeight) * 0.01);
    if (width < minDimension || height < minDimension) {
      return { exclude: true, reason: 'too-small' };
    }
  }

  // Known boilerplate patterns in labels (ads, tracking)
  const boilerplatePatterns = [
    /^ad[-_]?\d*$/i, // ad, ad-1, ad_2
    /^advertisement$/i,
    /^sponsored$/i,
    /^tracking$/i,
    /^\d+x\d+$/, // 300x250 (ad sizes)
  ];

  for (const pattern of boilerplatePatterns) {
    if (pattern.test(trimmed)) {
      return { exclude: true, reason: 'boilerplate-pattern' };
    }
  }

  // Include everything else - let LLM decide
  return { exclude: false };
}

/**
 * Default decision when LLM is unavailable.
 * FAIL OPEN: Show the element, let the user decide.
 * No content-based filtering - that's the LLM's job.
 */
export function defaultImportance(label: string): ElementDecision {
  return { important: true, label };
}
