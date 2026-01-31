import { type GeminiResponse, extractGeminiText, parseGeminiJson } from './gemini-types';

/** Gemini API key from env (set in .env as VITE_GEMINI_API_KEY). */
const GEMINI_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are helping an elderly user understand a web page. Given a short page summary and a list of actions (each line: id [tag] label), respond with JSON only, no markdown or extra text:
{"summary": "2 simple sentences summarizing what this page is for.", "priorityIds": ["id1", "id2", "id3"]}
Pick up to 3 action ids that are most useful for a senior (e.g. Sign in, Search, Submit, Continue, Buy). Use the exact ids from the list.`;

export interface GeminiSimplifyResult {
  summary: string;
  priorityIds: string[];
}

interface SimplifyParsedResponse {
  summary?: string;
  priorityIds?: string[];
}

/**
 * Calls Gemini with the minimized page text and asks for a short summary
 * and priority action IDs. Returns parsed JSON from the model output.
 */
export async function getGeminiSimplify(
  minimizedPageText: string,
): Promise<GeminiSimplifyResult> {
  const body = {
    contents: [
      {
        parts: [{ text: `${SYSTEM_PROMPT}\n\n---\n\n${minimizedPageText}` }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 256,
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

  const parsed = parseGeminiJson<SimplifyParsedResponse>(text);

  return {
    summary: typeof parsed.summary === 'string'
      ? parsed.summary
      : 'Could not summarize this page.',
    priorityIds: Array.isArray(parsed.priorityIds)
      ? parsed.priorityIds.filter((id) => typeof id === 'string')
      : [],
  };
}
