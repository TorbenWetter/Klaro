/**
 * Semantic Groups Schema
 *
 * Types for LLM-generated semantic grouping of elements.
 * Elements are organized by purpose rather than DOM structure,
 * providing a stable sidebar that survives framework re-renders.
 */

import { z } from 'zod';
import type { ElementFingerprint } from '../../utils/element-tracker/types';
import type { NodeType } from './dom-tree';
import { CONFIG } from '../../config';

// =============================================================================
// Element Reference
// =============================================================================

/**
 * Reference to a tracked element within a group.
 * Contains the fingerprint ID and display information.
 */
export interface ElementRef {
  type: 'element';
  /** Fingerprint ID for element tracking */
  elementId: string;
}

/** Zod schema for ElementRef */
export const ElementRefSchema = z.object({
  type: z.literal('element'),
  elementId: z.string(),
});

// =============================================================================
// Display Group
// =============================================================================

/**
 * A semantic group containing elements or nested groups.
 * Groups are created by the LLM based on element purpose.
 */
export interface DisplayGroup {
  type: 'group';
  /** Client-generated UUID */
  id: string;
  /** LLM-generated descriptive name */
  name: string;
  /** UI state: is group expanded */
  isExpanded: boolean;
  /** Child groups or element references */
  children: (DisplayGroup | ElementRef)[];
}

/** Zod schema for DisplayGroup (recursive) */
export const DisplayGroupSchema: z.ZodType<DisplayGroup> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    id: z.string(),
    name: z.string(),
    isExpanded: z.boolean(),
    children: z.array(z.union([DisplayGroupSchema, ElementRefSchema])),
  })
);

// =============================================================================
// Semantic Tree
// =============================================================================

/**
 * Root semantic tree structure.
 * Contains all groups and metadata for the sidebar.
 */
export interface SemanticTree {
  /** Top-level groups */
  groups: DisplayGroup[];
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Whether modal overlay is active */
  modalActive: boolean;
  /** Modal group (when modal is active) */
  modalGroup: DisplayGroup | null;
  /** Version counter for reactivity */
  version: number;
}

// =============================================================================
// Tracked Element Data
// =============================================================================

/**
 * Full element data stored alongside the semantic tree.
 * Indexed by fingerprint ID for quick lookup.
 */
export interface TrackedElementData {
  /** Fingerprint ID */
  id: string;
  /** Full fingerprint for matching */
  fingerprint: ElementFingerprint;
  /** HTML tag name */
  tagName: string;
  /** Node type classification */
  nodeType: NodeType;
  /** Display label (LLM-enhanced or original) */
  label: string;
  /** Original label before LLM enhancement */
  originalLabel: string;
  /** Optional description */
  description?: string;
  /** For interactive elements: specific type */
  interactiveType?: 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'select' | 'textarea';
  /** For inputs: placeholder text */
  placeholder?: string;
  /** For headings: level 1-6 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** For images: alt text */
  altText?: string;
  /** Current form state (for inputs, checkboxes, selects) */
  formState?: ElementFormState;
}

/**
 * Form state for interactive elements.
 */
export interface ElementFormState {
  /** Current value for inputs/textareas */
  value?: string;
  /** Checked state for checkboxes/radios */
  checked?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Options for selects */
  options?: Array<{ value: string; label: string; selected: boolean }>;
}

// =============================================================================
// LLM Request/Response Types
// =============================================================================

/**
 * Element info sent to LLM for grouping.
 */
export interface LLMGroupingElement {
  /** Fingerprint ID */
  id: string;
  /** Element type (button, link, input, heading, etc.) */
  type: string;
  /** Current label text */
  label: string;
  /** Ancestor path for landmark context */
  context: string;
}

/**
 * Request sent to LLM for semantic grouping.
 */
export interface LLMGroupingRequest {
  pageTitle: string;
  pageUrl: string;
  elements: LLMGroupingElement[];
}

/**
 * LLM response for a single group child.
 */
export type LLMGroupChild =
  | { type: 'group'; name: string; children: LLMGroupChild[] }
  | { type: 'element'; id: string; label?: string };

/**
 * LLM response for semantic grouping.
 */
export interface LLMGroupingResponse {
  groups: Array<{
    name: string;
    children: LLMGroupChild[];
  }>;
}

/** Zod schema for LLM group child (recursive) */
const LLMGroupChildSchema: z.ZodType<LLMGroupChild> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('group'),
      name: z.string(),
      children: z.array(LLMGroupChildSchema),
    }),
    z.object({
      type: z.literal('element'),
      id: z.string(),
      label: z.string().optional(),
    }),
  ])
);

/** Zod schema for LLM grouping response */
export const LLMGroupingResponseSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      children: z.array(LLMGroupChildSchema),
    })
  ),
});

// =============================================================================
// Message Types
// =============================================================================

/** Request to scan and group elements */
export interface ScanAndGroupRequest {
  type: 'SCAN_AND_GROUP';
}

/** Response with semantic tree */
export interface SemanticTreeResponse {
  type: 'SEMANTIC_TREE';
  tree: SemanticTree;
  elements: Map<string, TrackedElementData>;
  error?: string;
}

/** Element added to DOM after initial scan */
export interface ElementAddedMessage {
  type: 'ELEMENT_ADDED';
  element: TrackedElementData;
  /** Neighbor element IDs for placement heuristic */
  neighborIds: string[];
  /** Suggested group ID based on DOM position */
  suggestedGroupId?: string;
}

/** Element removed from DOM */
export interface ElementRemovedMessage {
  type: 'ELEMENT_REMOVED';
  elementId: string;
}

/** Element data updated (label, state, etc.) */
export interface ElementUpdatedMessage {
  type: 'ELEMENT_UPDATED';
  elementId: string;
  changes: Partial<TrackedElementData>;
}

/** Modal opened - enter overlay mode */
export interface ModalOpenedMessage {
  type: 'MODAL_OPENED';
  modalGroup: DisplayGroup;
  modalElements: Map<string, TrackedElementData>;
}

/** Modal closed - exit overlay mode */
export interface ModalClosedMessage {
  type: 'MODAL_CLOSED';
}

/** Form state changed */
export interface FormStateChangedMessage {
  type: 'FORM_STATE_CHANGED';
  elementId: string;
  formState: ElementFormState;
}

/** Union of all semantic grouping messages */
export type SemanticGroupMessage =
  | ScanAndGroupRequest
  | SemanticTreeResponse
  | ElementAddedMessage
  | ElementRemovedMessage
  | ElementUpdatedMessage
  | ModalOpenedMessage
  | ModalClosedMessage
  | FormStateChangedMessage;

// =============================================================================
// Expand State Persistence
// =============================================================================

// Note: ExpandStateStore is now defined locally in semantic-tree.svelte.ts
// with timestamp support for true LRU behavior

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a client-side UUID for groups.
 */
export function generateGroupId(): string {
  return crypto.randomUUID();
}

/**
 * Check if a child is an element reference.
 */
export function isElementRef(child: DisplayGroup | ElementRef): child is ElementRef {
  return child.type === 'element';
}

/**
 * Check if a child is a group.
 */
export function isDisplayGroup(child: DisplayGroup | ElementRef): child is DisplayGroup {
  return child.type === 'group';
}

/**
 * Convert LLM response to DisplayGroup structure with generated IDs.
 * @param response - LLM response with short IDs (12 chars from CONFIG)
 * @param elementIds - Array of full element IDs to match against
 */
export function llmResponseToDisplayGroups(
  response: LLMGroupingResponse,
  elementIds: string[]
): DisplayGroup[] {
  // Build a map from short ID prefix to full ID
  const shortToFullId = new Map<string, string>();
  for (const fullId of elementIds) {
    const shortId = fullId.slice(0, CONFIG.llm.shortIdLength);
    shortToFullId.set(shortId, fullId);
  }

  function convertChild(child: LLMGroupChild): DisplayGroup | ElementRef | null {
    if (child.type === 'element') {
      // Map short ID back to full ID (try exact match, then prefix match)
      const fullId =
        shortToFullId.get(child.id) ||
        shortToFullId.get(child.id.slice(0, CONFIG.llm.shortIdLength));
      if (!fullId) {
        // Element not found, skip it
        return null;
      }
      return { type: 'element', elementId: fullId };
    }
    const children = child.children
      .map(convertChild)
      .filter((c): c is DisplayGroup | ElementRef => c !== null);
    return {
      type: 'group',
      id: generateGroupId(),
      name: child.name,
      isExpanded: true,
      children,
    };
  }

  return response.groups.map((group) => {
    const children = group.children
      .map(convertChild)
      .filter((c): c is DisplayGroup | ElementRef => c !== null);
    return {
      type: 'group',
      id: generateGroupId(),
      name: group.name,
      isExpanded: true,
      children,
    };
  });
}

/**
 * Build reverse lookup index from semantic tree.
 * Returns Map<elementId, groupId>.
 */
export function buildElementToGroupIndex(groups: DisplayGroup[]): Map<string, string> {
  const index = new Map<string, string>();

  function walk(group: DisplayGroup): void {
    for (const child of group.children) {
      if (isElementRef(child)) {
        index.set(child.elementId, group.id);
      } else {
        walk(child);
      }
    }
  }

  for (const group of groups) {
    walk(group);
  }

  return index;
}

/**
 * Find a group by ID in the tree.
 */
export function findGroupById(groups: DisplayGroup[], groupId: string): DisplayGroup | null {
  for (const group of groups) {
    if (group.id === groupId) return group;
    for (const child of group.children) {
      if (isDisplayGroup(child)) {
        const found = findGroupById([child], groupId);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Remove an element from all groups.
 * Returns true if element was found and removed.
 */
export function removeElementFromGroups(groups: DisplayGroup[], elementId: string): boolean {
  let removed = false;

  function removeFromGroup(group: DisplayGroup): void {
    const index = group.children.findIndex(
      (child) => isElementRef(child) && child.elementId === elementId
    );
    if (index !== -1) {
      group.children.splice(index, 1);
      removed = true;
      return;
    }
    for (const child of group.children) {
      if (isDisplayGroup(child)) {
        removeFromGroup(child);
      }
    }
  }

  for (const group of groups) {
    removeFromGroup(group);
  }

  return removed;
}

/**
 * Add an element to a group.
 */
export function addElementToGroup(
  groups: DisplayGroup[],
  groupId: string,
  elementId: string
): boolean {
  const group = findGroupById(groups, groupId);
  if (!group) return false;

  group.children.push({ type: 'element', elementId });
  return true;
}

/**
 * Create a flat list fallback when LLM fails.
 * Returns a single "Page Elements" group containing all elements.
 */
export function createFlatListFallback(elementIds: string[]): DisplayGroup[] {
  return [
    {
      type: 'group',
      id: generateGroupId(),
      name: 'Page Elements',
      isExpanded: true,
      children: elementIds.map((id) => ({ type: 'element', elementId: id })),
    },
  ];
}
