import { Readability } from "@mozilla/readability";

/** Parsed article from Readability (main content only). */
export interface ArticleResult {
    title: string;
    textContent: string;
    byline: string;
}

/** Option for a select element. */
export interface ScannedSelectOption {
    value: string;
    label: string;
}

/** Interactive element found on the page (button, link, input, etc.). */
export interface ScannedAction {
    id: string;
    tag: string;
    text: string;
    /** For select elements: option value and label. */
    options?: ScannedSelectOption[];
}

/** Heading in document order for accessible outline. */
export interface ScannedHeading {
    level: number;
    text: string;
}

/** One block in reading order: a real copy of the page flow. */
export type PageBlock =
    | { type: "heading"; level: number; text: string }
    | { type: "text"; content: string }
    | { type: "action"; id: string; tag: string; text: string };

/** Result of scanning the current page: article, headings, actions, and pageCopy. */
export interface ScanResult {
    article: ArticleResult | null;
    headings: ScannedHeading[];
    actions: ScannedAction[];
    /** Blocks in document order for a real copy of the page. */
    pageCopy: PageBlock[];
}

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);
/** Tags we treat as text blocks (one block per element, in document order). */
const TEXT_BLOCK_TAGS = new Set(["p", "li", "td", "th", "figcaption", "blockquote"]);
const ACTION_DATA_ATTR = "data-acc-id";

function getElementLabel(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
        const input = el as HTMLInputElement;
        return (input.placeholder || input.value || el.getAttribute("aria-label") || el.innerText || "").trim();
    }
    return (el.getAttribute("aria-label") || el.innerText || "").trim();
}

function isInteractiveAndVisible(node: Node): boolean {
    const el = node as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (!tag || !INTERACTIVE_TAGS.has(tag)) {
        if (el.getAttribute?.("role") !== "button") return false;
    }
    if (el.offsetParent === null) return false;
    const label = getElementLabel(el);
    return label.length > 0;
}

/**
 * Scans the current document for main article content (Readability) and
 * interactive elements (buttons, links, inputs). Assigns stable `data-acc-id`
 * to elements so the side panel can trigger clicks.
 */
export function scanPage(): ScanResult {
    // Article via Readability (mutates the clone)
    const docClone = document.cloneNode(true) as Document;
    const reader = new Readability(docClone);
    const parsed = reader.parse();
    const article: ArticleResult | null = parsed
        ? {
              title: parsed.title ?? "",
              textContent: parsed.textContent ?? "",
              byline: parsed.byline ?? "",
          }
        : null;

    const headings: ScannedHeading[] = [];
    const headingWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const el = node as HTMLElement;
            const tag = el.tagName?.toLowerCase();
            const level = tag?.match(/^h([1-6])$/)?.[1];
            if (!level || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
            const text = (el.textContent ?? "").trim();
            if (text.length === 0) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    while (headingWalker.nextNode()) {
        const el = headingWalker.currentNode as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const level = parseInt(tag.slice(1), 10);
        headings.push({
            level,
            text: (el.textContent ?? "").trim().slice(0, 120),
        });
    }

    const actions: ScannedAction[] = [];
    const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            return isInteractiveAndVisible(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });

    while (treeWalker.nextNode()) {
        const el = treeWalker.currentNode as HTMLElement;
        let id = el.getAttribute(ACTION_DATA_ATTR);
        if (!id) {
            id = `cmd-${Math.random().toString(36).slice(2, 11)}`;
            el.setAttribute(ACTION_DATA_ATTR, id);
        }
        const tag = el.tagName.toLowerCase();
        const action: ScannedAction = {
            id,
            tag,
            text: getElementLabel(el).slice(0, 50),
        };
        if (tag === "select") {
            const select = el as HTMLSelectElement;
            action.options = Array.from(select.options).map((opt) => ({
                value: opt.value,
                label: (opt.textContent ?? opt.value).trim() || opt.value,
            }));
        }
        actions.push(action);
    }

    // Build page copy in document order: headings, text blocks, actions interleaved
    const pageCopy: PageBlock[] = [];
    const copyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const el = node as HTMLElement;
            const tag = el.tagName?.toLowerCase();
            if (!tag || el.offsetParent === null) return NodeFilter.FILTER_SKIP;
            if (tag.match(/^h[1-6]$/)) {
                const t = (el.textContent ?? "").trim();
                return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            if (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.("role") === "button") {
                return getElementLabel(el).length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            if (TEXT_BLOCK_TAGS.has(tag)) {
                const t = (el.textContent ?? "").trim();
                return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
            return NodeFilter.FILTER_SKIP;
        },
    });

    while (copyWalker.nextNode()) {
        const el = copyWalker.currentNode as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag.match(/^h[1-6]$/)) {
            pageCopy.push({
                type: "heading",
                level: parseInt(tag.slice(1), 10),
                text: (el.textContent ?? "").trim().slice(0, 200),
            });
            continue;
        }
        if (INTERACTIVE_TAGS.has(tag) || el.getAttribute?.("role") === "button") {
            let id = el.getAttribute(ACTION_DATA_ATTR);
            if (!id) {
                id = `cmd-${Math.random().toString(36).slice(2, 11)}`;
                el.setAttribute(ACTION_DATA_ATTR, id);
            }
            pageCopy.push({
                type: "action",
                id,
                tag,
                text: getElementLabel(el).slice(0, 80),
            });
            continue;
        }
        if (TEXT_BLOCK_TAGS.has(tag)) {
            pageCopy.push({
                type: "text",
                content: (el.textContent ?? "").trim().slice(0, 2000),
            });
        }
    }

    return { article, headings, actions, pageCopy };
}

/**
 * Highlights an element briefly and triggers click/focus. Call from content
 * script when the side panel requests a click by `data-acc-id`.
 */
export function clickElementById(id: string): boolean {
    const el = document.querySelector<HTMLElement>(`[${ACTION_DATA_ATTR}="${id}"]`);
    if (!el) return false;
    el.click();
    if (typeof el.focus === "function") el.focus();
    const originalBorder = el.style.border;
    el.style.border = "4px solid #FFEB3B";
    setTimeout(() => {
        el.style.border = originalBorder;
    }, 1000);
    return true;
}

/**
 * Sets the value of an input/textarea by data-acc-id and dispatches input/change.
 * Only applies to [input] and [textarea] elements; ignores buttons/links so we never
 * mistakenly update the wrong control when the LLM returns a wrong actionId.
 */
export function setInputValueById(id: string, value: string): boolean {
    const el = document.querySelector<HTMLElement>(`[${ACTION_DATA_ATTR}="${id}"]`);
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea") return false;
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof input.focus === "function") input.focus();
    return true;
}

/**
 * Sets the value of a select by data-acc-id and dispatches change.
 */
export function setSelectValueById(id: string, value: string): boolean {
    const el = document.querySelector<HTMLSelectElement>(`[${ACTION_DATA_ATTR}="${id}"]`);
    if (!el || el.tagName.toLowerCase() !== "select") return false;
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof el.focus === "function") el.focus();
    return true;
}
