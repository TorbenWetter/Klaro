/**
 * LLM Service for Tree Label Enhancement
 *
 * Provides human-readable labels for DOM tree nodes using Gemini.
 * Aligned with spec: Phase 6 - Smart Collapse & LLM
 */

import { callGemini } from './gemini';
import type { DOMTreeNode, LLMLabelResponse } from '$lib/schemas/dom-tree';
import { LLMLabelResponse as LLMLabelResponseSchema } from '$lib/schemas/dom-tree';

// =============================================================================
// LLM Prompt (Single source of truth)
// =============================================================================

/**
 * System prompt for tree labeling.
 * Aligned with spec: "provide a clear, concise label that describes what it is or does"
 */
const LABELING_PROMPT = `You are helping create accessible labels for webpage elements for seniors (65+).

For each element, provide a clear, concise label that describes what it is or does.

GUIDELINES:
- Use simple, clear language
- Describe the PURPOSE, not the HTML tag
- For buttons/links: describe the action ("Sign in", "Go to cart")
- For inputs: describe what to enter ("Your email", "Search products")
- For containers: describe the content ("Main navigation", "Product list")
- Keep labels under 50 characters
- Use action verbs for interactive elements
- Only include elements that need better labels
- Skip elements that already have good labels

Respond with JSON only, no markdown:
{ "<element_id>": "label", ... }`;

// =============================================================================
// Tree Label Enhancement
// =============================================================================

/**
 * Collect nodes from tree for LLM processing.
 * Prioritizes visible and interactive nodes that need better labels.
 */
function collectNodesForLLM(node: DOMTreeNode, collected: DOMTreeNode[], maxNodes: number): void {
  if (collected.length >= maxNodes) return;

  // Check if this node needs a better label
  const needsBetterLabel =
    node.label === node.tagName ||
    node.label === 'div' ||
    node.label === 'span' ||
    node.label.length <= 2 ||
    (node.nodeType === 'container' && !node.label.includes(' '));

  // Include interactive nodes, visible nodes, and nodes needing better labels
  if (node.nodeType === 'interactive' || node.isVisible || needsBetterLabel) {
    collected.push(node);
  }

  for (const child of node.children) {
    collectNodesForLLM(child, collected, maxNodes);
  }
}

/**
 * Convert tree nodes to prompt format for LLM.
 */
function nodesToPrompt(nodes: DOMTreeNode[]): string {
  const lines: string[] = [];

  for (const node of nodes) {
    const indent = '  '.repeat(Math.min(node.depth, 4));
    const type =
      node.interactiveType || (node.headingLevel ? `h${node.headingLevel}` : node.nodeType);
    const id = node.id.slice(0, 8);
    lines.push(`${indent}[${id}] ${type}: "${node.label}"`);
  }

  return lines.join('\n');
}

/**
 * Enhance tree labels using LLM (batch call for initial scan).
 * Called once when the tree is first scanned.
 */
export async function enhanceTreeLabels(
  rootNode: DOMTreeNode,
  pageTitle: string
): Promise<LLMLabelResponse> {
  // Collect nodes that might need better labels (limit to 100 for token efficiency)
  const nodes: DOMTreeNode[] = [];
  collectNodesForLLM(rootNode, nodes, 100);

  if (nodes.length === 0) {
    return { labels: {} };
  }

  const prompt = `Page: "${pageTitle}"

Elements to label:
${nodesToPrompt(nodes)}`;

  try {
    const response = await callGemini({
      system: LABELING_PROMPT,
      user: prompt,
      temperature: 0.2,
      maxTokens: 4096,
    });

    // Parse response - handle both flat format and nested format
    const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // If response has "labels" key, use that; otherwise treat whole object as labels
    const labels = parsed.labels || parsed;

    // Validate with schema
    const result = LLMLabelResponseSchema.safeParse({ labels });

    if (result.success) {
      return result.data;
    }

    // Partial success - use what we can
    console.warn('[Klaro] LLM response validation issue, using raw labels');
    return { labels };
  } catch (error) {
    console.error('[Klaro] enhanceTreeLabels failed:', error);
    return { labels: {} };
  }
}

/**
 * Enhance a single node's label using LLM.
 * Called when a new node is added to the tree (one call per element).
 */
export async function enhanceSingleNodeLabel(
  node: DOMTreeNode,
  pageTitle: string
): Promise<{ label?: string; description?: string }> {
  const type =
    node.interactiveType || (node.headingLevel ? `h${node.headingLevel}` : node.nodeType);
  const id = node.id.slice(0, 8);

  const prompt = `Page: "${pageTitle}"

New element:
[${id}] ${type}: "${node.label}"

Provide a better label if needed, or return the current label if it's already good.`;

  try {
    const response = await callGemini({
      system: LABELING_PROMPT,
      user: prompt,
      temperature: 0.2,
      maxTokens: 256,
    });

    // Parse response - expect { "<id>": "label" } format
    const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // Get the label from response (could be keyed by id or just "label")
    const label = parsed[id] || parsed[node.id] || parsed.label || node.label;

    return { label };
  } catch (error) {
    console.error('[Klaro] enhanceSingleNodeLabel failed:', error);
    return { label: node.label };
  }
}
