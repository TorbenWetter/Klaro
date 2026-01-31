import { getBlocksResponseJSONSchema, SidebarBlockSchema } from "../lib/sidebar-schema";
import type { SidebarBlock } from "../lib/sidebar-types";

/** Gemini API key from env (set in .env as VITE_GEMINI_API_KEY). */
const GEMINI_API_KEY = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GEMINI_API_KEY) || "";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

export interface GeminiSimplifyResult {
    summary: string;
    priorityIds: string[];
}

/**
 * Calls Gemini with the minimized page text and asks for a short summary
 * and priority action IDs. Returns parsed JSON from the model output.
 */
export async function getGeminiSimplify(minimizedPageText: string): Promise<GeminiSimplifyResult> {
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
        throw new Error("Gemini returned no text");
    }

    // Extract JSON from the response (in case model wraps in markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    const parsed = JSON.parse(jsonStr) as {
        summary?: string;
        priorityIds?: string[];
    };

    return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "Could not summarize this page.",
        priorityIds: Array.isArray(parsed.priorityIds) ? parsed.priorityIds.filter((id) => typeof id === "string") : [],
    };
}

function buildStructuredBlocksPrompt(): string {
    const jsonSchema = getBlocksResponseJSONSchema();
    return `You are helping people with disabilities and elderly users use the web. Given a short description of a web page and a list of interactive elements (each line: id [tag] label, and for select: | value:label, ...), respond with exactly one valid JSON array and nothing else.

CRITICAL JSON RULES (your output must be parseable by JSON.parse):
- Output ONLY the raw JSON array. No markdown, no code fences, no explanation, no text before or after.
- Use double quotes for ALL property names and string values (never single quotes).
- No trailing commas after the last element in an array or object.
- Inside string values: escape double quotes as \\", newlines as \\n, backslashes as \\\\. Do not put unescaped newlines or quotes inside strings.
- Use exact actionId values from the Actions list (copy them character-for-character).

JSON Schema for the response array:
${jsonSchema}

Return ONLY the blocks that are relevant for understanding and using the page: main explanation, primary actions (Sign in, Search, Submit, Continue, Buy, etc.), and key form fields. Omit decorative links, redundant buttons, and clutter. Order blocks in a logical flow: first a short markdown summary of what the page is for, then the most important actions and inputs.

When the Actions list contains [input], [textarea], or [select] elements, you MUST include matching "input" or "select" blocks for key form fields (e.g. search, email, password, main dropdowns). Use the exact actionId from the list. For "select" blocks, copy the options from the list (the value:label pairs after the pipe).

ACTION ID RULES: Each block type must use an actionId from a matching Actions list line. For "input" blocks use ONLY ids from lines that show [input] or [textarea]. For "button" or "link" blocks use ONLY ids from lines that show [button] or [a]. For "select" blocks use ONLY ids from lines that show [select]. Never use a button or link id for an input block, or an input id for a button/link block.

For markdown blocks, use real markdown in the "content" string: use ## or ### for section headings and **...** for emphasis. Start the first block with a heading for the page summary (e.g. ## What this page does), then one or two short paragraphs. Remember: inside the JSON string, newlines must be written as \\n.`;
}

/**
 * Calls Gemini to get a structured list of sidebar blocks (markdown + interactive components).
 * Returns only relevant content in a logical order for accessibility.
 */
export async function getGeminiStructuredBlocks(minimizedPageText: string): Promise<SidebarBlock[]> {
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "gemini.ts:getGeminiStructuredBlocks",
            message: "entry",
            data: { minimizedLen: minimizedPageText.length, hasKey: !!GEMINI_API_KEY },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "H3",
        }),
    }).catch(() => {});
    // #endregion
    const body = {
        contents: [
            {
                parts: [
                    {
                        text: `${buildStructuredBlocksPrompt()}\n\n---\n\n${minimizedPageText}`,
                    },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
        },
    };

    const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                location: "gemini.ts:getGeminiStructuredBlocks:fetchNotOk",
                message: "Gemini API error",
                data: { status: res.status, errSlice: errText.slice(0, 150) },
                timestamp: Date.now(),
                sessionId: "debug-session",
                hypothesisId: "H3,H4",
            }),
        }).catch(() => {});
        // #endregion
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

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                location: "gemini.ts:noText",
                message: "Gemini returned no text",
                data: { candidatesLen: data.candidates?.length },
                timestamp: Date.now(),
                sessionId: "debug-session",
                hypothesisId: "H4",
            }),
        }).catch(() => {});
        // #endregion
        throw new Error("Gemini returned no text");
    }

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    const arr = JSON.parse(jsonStr) as unknown[];

    const blocks: SidebarBlock[] = [];
    if (Array.isArray(arr)) {
        for (const item of arr) {
            const result = SidebarBlockSchema.safeParse(item);
            if (result.success) {
                blocks.push(result.data as SidebarBlock);
            }
        }
    }

    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            location: "gemini.ts:getGeminiStructuredBlocks:return",
            message: "parsed blocks",
            data: { blocksLength: blocks.length },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "H4,H5",
        }),
    }).catch(() => {});
    // #endregion
    return blocks;
}
