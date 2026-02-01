import { type GeminiResponse, extractGeminiText, parseGeminiJson } from './gemini-types';

/** Gemini API key from env (set in .env as VITE_GEMINI_API_KEY). */
const GEMINI_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// =============================================================================
// General-Purpose Gemini Call
// =============================================================================

export interface GeminiCallOptions {
  /** System prompt (instruction) */
  system: string;
  /** User message (content to analyze) */
  user: string;
  /** Temperature for generation (0-1, lower = more deterministic) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
}

/**
 * General-purpose Gemini API call.
 * Returns the raw text response from the model.
 */
export async function callGemini(options: GeminiCallOptions): Promise<string> {
  const { system, user, temperature = 0.2, maxTokens = 2048 } = options;

  const body = {
    contents: [
      {
        parts: [{ text: `${system}\n\n---\n\n${user}` }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
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

  return text;
}

/**
 * Call Gemini and parse the response as JSON.
 * Automatically handles markdown-wrapped JSON responses.
 */
export async function callGeminiJson<T>(options: GeminiCallOptions): Promise<T> {
  const text = await callGemini(options);
  return parseGeminiJson<T>(text);
}
