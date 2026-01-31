import type { SidebarBlock } from "../lib/sidebar-types";
import type { ArticleResult, ScannedAction } from "./dom-scanner";
import { getGeminiSimplify, getGeminiStructuredBlocks } from "./gemini";
import { minimizeForLLM } from "./minimize-dom";

export interface LLMSimplificationResult {
    summary: string;
    priorityIds: string[];
}

function heuristicFallback(article: ArticleResult | null, actions: ScannedAction[]): LLMSimplificationResult {
    const text = article?.textContent ?? "";
    const summary = text.length > 0 ? `Here is the main point: ${text.slice(0, 150).trim()}...` : "No article found. This might be a tool or app.";

    const priorityKeywords = ["sign in", "log in", "login", "search", "buy", "submit", "continue", "next", "send"];
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
export async function getLLMSimplification(article: ArticleResult | null, actions: ScannedAction[]): Promise<LLMSimplificationResult> {
    const minimized = minimizeForLLM(article, actions);

    try {
        return await getGeminiSimplify(minimized);
    } catch {
        return heuristicFallback(article, actions);
    }
}

/**
 * Returns structured sidebar blocks (markdown + interactive components) for the single view.
 * Calls Gemini; errors propagate so the UI can show the real failure (e.g. API key, network).
 */
export async function getLLMStructuredSidebar(article: ArticleResult | null, actions: ScannedAction[]): Promise<SidebarBlock[]> {
    const minimized = minimizeForLLM(article, actions);
    return getGeminiStructuredBlocks(minimized);
}
