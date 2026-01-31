import type { ArticleResult, ScannedAction } from './dom-scanner';

/** Max chars of article body to send to the LLM. */
const MAX_ARTICLE_CHARS = 600;
/** Max number of actions to include in the prompt. */
const MAX_ACTIONS = 25;
/** Max chars per action label in the minimized string. */
const MAX_ACTION_LABEL_CHARS = 40;

/**
 * Builds a minimal text representation of the page for the LLM to reduce tokens.
 * Includes: page title, short article excerpt, and a compact list of actions (id, tag, label).
 */
export function minimizeForLLM(
  article: ArticleResult | null,
  actions: ScannedAction[],
): string {
  const parts: string[] = [];

  if (article?.title) {
    parts.push(`Title: ${article.title.trim().slice(0, 120)}`);
  }
  const text = article?.textContent?.trim() ?? '';
  if (text) {
    const excerpt = text.slice(0, MAX_ARTICLE_CHARS).replace(/\s+/g, ' ');
    parts.push(`Content: ${excerpt}${text.length > MAX_ARTICLE_CHARS ? '...' : ''}`);
  }
  if (parts.length === 0) {
    parts.push('Content: (No article extracted — likely an app or tool page.)');
  }

  const limited = actions.slice(0, MAX_ACTIONS);
  if (limited.length > 0) {
    const actionLines = limited.map(
      (a) => `${a.id} [${a.tag}] ${a.text.slice(0, MAX_ACTION_LABEL_CHARS).trim()}`,
    );
    parts.push('Actions:\n' + actionLines.join('\n'));
  } else {
    parts.push('Actions: (none listed)');
  }

  return parts.join('\n\n');
}
