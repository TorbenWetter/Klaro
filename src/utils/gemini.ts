/** Gemini API key from env (set in .env as VITE_GEMINI_API_KEY). */
const GEMINI_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) ||
  '';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

export interface GeminiSimplifyResult {
  summary: string;
  priorityIds: string[];
}

/**
 * Calls Gemini with the minimized page text and asks for a short summary
 * and priority action IDs. Returns parsed JSON from the model output.
 */
export async function getGeminiSimplify(
  minimizedPageText: string,
): Promise<GeminiSimplifyResult> {
  const systemPrompt = `You are helping an elderly user understand a web page. Given a short page summary and a list of actions (each line: id [tag] label), respond with JSON only, no markdown or extra text:
{"summary": "2 simple sentences summarizing what this page is for.", "priorityIds": ["id1", "id2", "id3"]}
Pick up to 3 action ids that are most useful for a senior (e.g. Sign in, Search, Submit, Continue, Buy). Use the exact ids from the list.`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: `${systemPrompt}\n\n---\n\n${minimizedPageText}`,
          },
        ],
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

  interface CandidatePart {
    text?: string;
  }
  interface CandidateContent {
    parts?: CandidatePart[];
  }
  interface Candidate {
    content?: CandidateContent;
  }
  const data = (await res.json()) as { candidates?: Candidate[] };

  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Gemini returned no text');
  }

  // Extract JSON from the response (in case model wraps in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(jsonStr) as {
    summary?: string;
    priorityIds?: string[];
  };

  return {
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Could not summarize this page.',
    priorityIds: Array.isArray(parsed.priorityIds)
      ? parsed.priorityIds.filter((id) => typeof id === 'string')
      : [],
  };
}
