/**
 * LLM Service for Label Enhancement and Semantic Layout
 *
 * Provides:
 * - Human-readable labels for elements
 * - Semantic role assignment for intelligent layout
 * - Emphasis levels for visual hierarchy
 *
 * Uses Gemini for LLM calls.
 */

import { callGemini } from './gemini';
import type { DOMTreeNode, LLMLayoutResponse } from '$lib/schemas/dom-tree';
import { LLMLayoutResponse as LLMLayoutResponseSchema } from '$lib/schemas/dom-tree';
import { CONFIG } from '../config';

// =============================================================================
// LLM Prompt (Single source of truth)
// =============================================================================

/**
 * Combined system prompt for labeling AND layout assignment.
 * Returns both labels and direct layout instructions in a single call.
 */
const COMBINED_PROMPT = `You are helping create an accessible sidebar view of a webpage for seniors (65+).

For each element, provide:
1. A clear, concise LABEL describing what it is or does
2. LAYOUT instructions for how to display it

LABEL GUIDELINES:
- Use simple, clear language
- Describe the PURPOSE, not the HTML tag
- For buttons/links: describe the action ("Sign in", "Go to cart")
- For inputs: describe what to enter ("Your email", "Search products")
- Keep labels under 50 characters

LAYOUT OPTIONS:

display (how element flows):
- "inline": Flows horizontally with siblings (for nav links, buttons in a row, tags)
- "block": Stacked vertically, full width (for paragraphs, headings, form fields)
- "flex-row": Children arranged in a horizontal row (for toolbars, button groups)
- "flex-col": Children stacked vertically (for forms, lists)
- "grid": Children in a grid layout (for card grids, image galleries)

emphasis (visual importance):
- "critical": Primary actions - make prominent (Buy, Submit, Sign In)
- "high": Important content - stand out (main headings, key info)
- "normal": Regular content (default)
- "low": De-emphasized (fine print, metadata, timestamps)

spacing (gaps and padding):
- "compact": Tight spacing (nav items, dense lists)
- "normal": Standard spacing (default)
- "spacious": Extra breathing room (readable paragraphs, forms)

Respond with JSON only, no markdown:
{
  "labels": { "<id>": "label", ... },
  "layout": { "<id>": { "display": "inline", "emphasis": "normal", "spacing": "compact" }, ... }
}

TIPS:
- Group related links/buttons as "inline" so they flow together
- Use "flex-row" for parent containers with horizontal children
- Main content paragraphs should be "block" with "spacious" spacing
- Navigation links should be "inline" with "compact" spacing`;

// =============================================================================
// Tree Label & Layout Enhancement
// =============================================================================

/**
 * Collect nodes from tree for LLM processing.
 * Includes all meaningful nodes for layout assignment.
 */
function collectNodesForLLM(node: DOMTreeNode, collected: DOMTreeNode[], maxNodes: number): void {
  if (collected.length >= maxNodes) return;

  // Include meaningful nodes (not just structural containers)
  const isMeaningful =
    node.nodeType === 'interactive' ||
    node.nodeType === 'text' ||
    node.nodeType === 'media' ||
    node.nodeType === 'list' ||
    node.headingLevel !== undefined ||
    (node.label && node.label.length > 2 && node.label !== node.tagName);

  if (isMeaningful) {
    collected.push(node);
  }

  for (const child of node.children) {
    collectNodesForLLM(child, collected, maxNodes);
  }
}

/**
 * Convert tree nodes to prompt format for LLM.
 * Includes hierarchy context for better role assignment.
 */
function nodesToPrompt(nodes: DOMTreeNode[]): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const indent = '  '.repeat(Math.min(node.depth, 4));
    const type =
      node.interactiveType || (node.headingLevel ? `h${node.headingLevel}` : node.nodeType);
    const id = node.id.slice(0, CONFIG.llm.shortIdLength);
    const tag = node.tagName;

    // Include tag for context (helps LLM identify nav, form, etc.)
    lines.push(`${indent}[${id}] <${tag}> ${type}: "${node.label.slice(0, 60)}"`);
  }

  return lines.join('\n');
}

/**
 * Enhance tree with labels AND layout hints using LLM.
 * Single call for efficiency - returns both labels and semantic roles.
 */
export async function enhanceTreeWithLayout(
  rootNode: DOMTreeNode,
  pageTitle: string,
  pageUrl: string
): Promise<LLMLayoutResponse> {
  // Collect meaningful nodes (limit to 80 for token efficiency)
  const nodes: DOMTreeNode[] = [];
  collectNodesForLLM(rootNode, nodes, 80);

  if (nodes.length === 0) {
    return { labels: {} };
  }

  // Extract domain for context
  let domain = '';
  try {
    domain = new URL(pageUrl).hostname;
  } catch {
    domain = pageUrl;
  }

  const prompt = `Page: "${pageTitle}"
Domain: ${domain}

Elements to analyze (${nodes.length} total):
${nodesToPrompt(nodes)}

Analyze each element and provide labels + layout roles.`;

  try {
    const response = await callGemini({
      system: COMBINED_PROMPT,
      user: prompt,
      temperature: CONFIG.llm.temperature,
      maxTokens: CONFIG.llm.maxTokensBatch,
    });

    // Parse response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Klaro] LLM returned no JSON');
      return { labels: {} };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate with schema
    const result = LLMLayoutResponseSchema.safeParse(parsed);

    if (result.success) {
      console.info(
        `[Klaro] LLM enhanced ${Object.keys(result.data.labels).length} labels, ${Object.keys(result.data.layout || {}).length} layouts`
      );
      return result.data;
    }

    // Partial success - use what we can
    console.warn('[Klaro] LLM response validation issue, using partial data');
    return {
      labels: parsed.labels || {},
      layout: parsed.layout || {},
    };
  } catch (error) {
    console.error('[Klaro] enhanceTreeWithLayout failed:', error);
    throw error; // Re-throw to trigger retry logic
  }
}

/**
 * Legacy function for backwards compatibility.
 * @deprecated Use enhanceTreeWithLayout instead
 */
export async function enhanceTreeLabels(
  rootNode: DOMTreeNode,
  pageTitle: string
): Promise<LLMLayoutResponse> {
  return enhanceTreeWithLayout(rootNode, pageTitle, '');
}

/**
 * Enhance a single node's label using LLM.
 * Called when a new node is added to the tree.
 */
export async function enhanceSingleNodeLabel(
  node: DOMTreeNode,
  pageTitle: string
): Promise<{ label?: string; description?: string }> {
  const type =
    node.interactiveType || (node.headingLevel ? `h${node.headingLevel}` : node.nodeType);
  const id = node.id.slice(0, CONFIG.llm.shortIdLength);

  const prompt = `Page: "${pageTitle}"

New element:
[${id}] <${node.tagName}> ${type}: "${node.label}"

Provide a better label if needed.`;

  try {
    const response = await callGemini({
      system: `You create clear, accessible labels for webpage elements.
Respond with JSON: { "label": "your label", "role": "navigation|main-content|form|heading|list|footer|container", "emphasis": "critical|high|normal|low" }`,
      user: prompt,
      temperature: CONFIG.llm.temperature,
      maxTokens: CONFIG.llm.maxTokensLabel,
    });

    const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      label: parsed.label || node.label,
    };
  } catch (error) {
    console.error('[Klaro] enhanceSingleNodeLabel failed:', error);
    return { label: node.label };
  }
}
