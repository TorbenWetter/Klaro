/**
 * LLM Service for Semantic Grouping and Label Enhancement
 *
 * Provides:
 * - Semantic grouping of elements by purpose (not DOM structure)
 * - Human-readable labels for elements
 *
 * Uses Gemini for LLM calls.
 */

import { callGemini } from './gemini';
import type { DOMTreeNode, LLMLabelResponse } from '$lib/schemas/dom-tree';
import { LLMLabelResponse as LLMLabelResponseSchema } from '$lib/schemas/dom-tree';
import type {
  LLMGroupingElement,
  LLMGroupingResponse,
  DisplayGroup,
  TrackedElementData,
} from '$lib/schemas/semantic-groups';
import {
  LLMGroupingResponseSchema,
  llmResponseToDisplayGroups,
} from '$lib/schemas/semantic-groups';
import { CONFIG } from '../config';

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
    const id = node.id.slice(0, CONFIG.llm.shortIdLength);
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
      temperature: CONFIG.llm.temperature,
      maxTokens: CONFIG.llm.maxTokensBatch,
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
  const id = node.id.slice(0, CONFIG.llm.shortIdLength);

  const prompt = `Page: "${pageTitle}"

New element:
[${id}] ${type}: "${node.label}"

Provide a better label if needed, or return the current label if it's already good.`;

  try {
    const response = await callGemini({
      system: LABELING_PROMPT,
      user: prompt,
      temperature: CONFIG.llm.temperature,
      maxTokens: CONFIG.llm.maxTokensLabel,
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

// =============================================================================
// Semantic Grouping
// =============================================================================

/**
 * System prompt for semantic grouping.
 * Uses few-shot examples for typical groups.
 */
const GROUPING_PROMPT = `You are organizing a webpage's elements into semantic groups for an accessibility sidebar.
Create logical groupings based on PURPOSE, not DOM structure.

COMMON GROUP PATTERNS:
- Navigation: links for moving between pages/sections
- Header: persistent top-of-page elements (logo, search, account)
- Footer: bottom-of-page links and info
- Main Content: primary page content and actions
- Forms: related inputs and their submit actions
- User Account: login, profile, settings elements
- Actions: buttons and controls for the current view

GUIDELINES:
- Use clear, descriptive group names (2-4 words)
- Nest only when it adds clarity (prefer flat)
- Group related interactive elements together
- Include headings as structural markers within groups
- For pages with few elements (<5), you may skip grouping entirely
- Place orphan elements in the nearest logical group

EXAMPLE INPUT:
Page: "Online Store"
Elements:
[abc123] link: "Home"
[def456] link: "Products"
[ghi789] button: "Login"
[jkl012] input: "Search"
[mno345] button: "Add to Cart"
[pqr678] heading: "Featured Products"

EXAMPLE OUTPUT:
{
  "groups": [
    {
      "name": "Navigation",
      "children": [
        {"type": "element", "id": "abc123", "label": "Home"},
        {"type": "element", "id": "def456", "label": "Products"}
      ]
    },
    {
      "name": "Header Actions",
      "children": [
        {"type": "element", "id": "jkl012", "label": "Search products"},
        {"type": "element", "id": "ghi789", "label": "Login"}
      ]
    },
    {
      "name": "Products",
      "children": [
        {"type": "element", "id": "pqr678", "label": "Featured Products"},
        {"type": "element", "id": "mno345", "label": "Add to Cart"}
      ]
    }
  ]
}

Respond with JSON only, no markdown code blocks.`;

/**
 * Convert elements to prompt format for grouping.
 */
function elementsToPrompt(elements: LLMGroupingElement[]): string {
  const lines: string[] = [];

  for (const element of elements) {
    const id = element.id.slice(0, CONFIG.llm.shortIdLength);
    lines.push(`[${id}] ${element.type}: "${element.label}"`);
    if (element.context) {
      lines.push(`  context: ${element.context}`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert TrackedElementData to LLMGroupingElement format.
 */
function toGroupingElement(element: TrackedElementData): LLMGroupingElement {
  // Build context from ancestor path
  let context = '';
  if (element.fingerprint.nearestLandmark) {
    context = element.fingerprint.nearestLandmark.tagName;
    if (element.fingerprint.nearestLandmark.role) {
      context += ` (${element.fingerprint.nearestLandmark.role})`;
    }
  } else if (element.fingerprint.ancestorPath.length > 0) {
    context = element.fingerprint.ancestorPath
      .map((a) => a.landmark || a.tagName)
      .filter(Boolean)
      .join(' > ');
  }

  // Determine element type (string for LLM, not restricted to NodeType)
  let type: string = element.interactiveType || element.nodeType;
  if (element.headingLevel) {
    type = `h${element.headingLevel}`;
  }

  return {
    id: element.id,
    type,
    label: element.label || element.originalLabel,
    context,
  };
}

/**
 * Generate semantic groups for elements using LLM.
 * Returns DisplayGroup array ready for the sidebar.
 *
 * @param elements - Map of element ID to TrackedElementData
 * @param pageTitle - Page title for context
 * @param pageUrl - Page URL for context
 * @returns DisplayGroup array, or null if LLM fails (caller should use flat fallback)
 */
export async function generateSemanticGroups(
  elements: Map<string, TrackedElementData>,
  pageTitle: string,
  pageUrl: string
): Promise<DisplayGroup[] | null> {
  // Convert elements to prompt format
  const groupingElements: LLMGroupingElement[] = [];

  for (const element of elements.values()) {
    // Only include meaningful elements
    if (
      element.nodeType === 'interactive' ||
      element.nodeType === 'text' ||
      element.nodeType === 'media'
    ) {
      groupingElements.push(toGroupingElement(element));
    }
  }

  // If very few elements, let LLM decide whether to group
  if (groupingElements.length === 0) {
    return null;
  }

  const prompt = `Page: "${pageTitle}"
URL: ${pageUrl}

Elements to organize (${groupingElements.length} total):
${elementsToPrompt(groupingElements)}`;

  try {
    const response = await callGemini({
      system: GROUPING_PROMPT,
      user: prompt,
      temperature: CONFIG.llm.groupingTemperature,
      maxTokens: CONFIG.llm.maxTokensGrouping,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Klaro] LLM returned no JSON for grouping');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate with schema
    const result = LLMGroupingResponseSchema.safeParse(parsed);

    // Get all element IDs for mapping short IDs back to full IDs
    const elementIds = Array.from(elements.keys());

    if (!result.success) {
      console.warn('[Klaro] LLM grouping response validation failed:', result.error);
      // Try to use partial response if groups exist
      if (parsed.groups && Array.isArray(parsed.groups)) {
        return llmResponseToDisplayGroups(parsed as LLMGroupingResponse, elementIds);
      }
      return null;
    }

    // Convert LLM response to DisplayGroup structure with generated IDs
    return llmResponseToDisplayGroups(result.data, elementIds);
  } catch (error) {
    console.error('[Klaro] generateSemanticGroups failed:', error);
    return null;
  }
}

/**
 * Enhance a single element's label using LLM (for newly added elements).
 * Lighter weight than full grouping.
 */
export async function enhanceElementLabel(
  element: TrackedElementData,
  pageTitle: string
): Promise<string> {
  const groupingElement = toGroupingElement(element);
  const id = element.id.slice(0, CONFIG.llm.shortIdLength);

  const prompt = `Page: "${pageTitle}"

New element needs a label:
[${id}] ${groupingElement.type}: "${groupingElement.label}"
Context: ${groupingElement.context || 'unknown'}

Provide a clear, concise label (under 50 characters) that describes what this element is or does.
Respond with just the label text, no JSON.`;

  try {
    const response = await callGemini({
      system:
        'You create clear, accessible labels for webpage elements. Respond with just the label.',
      user: prompt,
      temperature: CONFIG.llm.temperature,
      maxTokens: 64,
    });

    // Clean up response (remove quotes, trim)
    const label = response.replace(/^["']|["']$/g, '').trim();
    return label || element.label;
  } catch (error) {
    console.error('[Klaro] enhanceElementLabel failed:', error);
    return element.label;
  }
}

// =============================================================================
// Debounced Enhancement
// =============================================================================

/** Debounce timers for per-element enhancement */
const enhancementDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();

/** Pending enhancement resolvers */
const pendingEnhancements = new Map<string, (label: string) => void>();

/**
 * Enhance element label with debouncing to prevent duplicate calls.
 * Multiple calls within the debounce window will result in a single LLM call.
 */
export function enhanceElementLabelDebounced(
  element: TrackedElementData,
  pageTitle: string
): Promise<string> {
  return new Promise((resolve) => {
    const elementId = element.id;

    // Clear existing debounce timer
    const existingTimer = enhancementDebounceMap.get(elementId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Store the resolver (newer calls replace older)
    pendingEnhancements.set(elementId, resolve);

    // Set up debounced call
    const timer = setTimeout(async () => {
      enhancementDebounceMap.delete(elementId);
      const resolver = pendingEnhancements.get(elementId);
      pendingEnhancements.delete(elementId);

      if (resolver) {
        const label = await enhanceElementLabel(element, pageTitle);
        resolver(label);
      }
    }, CONFIG.llm.debounceMs);

    enhancementDebounceMap.set(elementId, timer);
  });
}
