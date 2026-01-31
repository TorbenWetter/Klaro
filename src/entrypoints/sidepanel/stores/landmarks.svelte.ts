/**
 * Landmarks Store
 *
 * Svelte 5 runes-based state management for landmark sections.
 * Handles section state, element filtering, and incremental updates.
 */

import type {
  LandmarkSection,
  ContentBlock,
  ElementDecision,
  LLMPageResponse,
} from '$lib/schemas/landmark-section';
import type {
  ScannedLandmark,
  ContentBlock as ScannedBlock,
} from '../../../utils/landmark-scanner';
import type { ElementFingerprint } from '../../../utils/element-tracker';
import type { UINode, ActionBinding } from '$lib/schemas/accessible-ui';
import { defaultImportance } from '../../../utils/llm-service';

// =============================================================================
// Constants
// =============================================================================

/** Minimum confidence threshold to display elements (spec: FR3) */
const CONFIDENCE_THRESHOLD = 0.8;

// =============================================================================
// Store State
// =============================================================================

/** Current page URL */
let url = $state('');

/** Page title */
let title = $state('');

/** Loading state */
let loading = $state(false);

/** Error message */
let error = $state<string | null>(null);

/** Landmark sections */
let sections = $state<LandmarkSection[]>([]);

/** Element decisions from LLM (by fingerprint ID) */
let elementDecisions = $state<Map<string, ElementDecision>>(new Map());

/** Element states from content script (values, checked, etc.) */
let elementStates = $state<Map<string, Record<string, unknown>>>(new Map());

/** Element confidence scores (by fingerprint ID) */
let elementConfidences = $state<Map<string, number>>(new Map());

/** Version counter to force Svelte reactivity */
let version = $state(0);

// =============================================================================
// Derived State
// =============================================================================

/** Total count of visible items across all sections */
const totalItemCount = $derived(sections.reduce((sum, section) => sum + section.itemCount, 0));

/** Whether all sections are collapsed */
const allCollapsed = $derived(sections.every((section) => !section.expanded));

/** Whether any section is expanded */
const hasExpandedSection = $derived(sections.some((section) => section.expanded));

// =============================================================================
// Actions
// =============================================================================

/**
 * Set loading state.
 */
export function setLoading(value: boolean): void {
  loading = value;
}

/**
 * Set error state.
 */
export function setError(value: string | null): void {
  error = value;
}

/**
 * Reset the store to initial state.
 */
export function reset(): void {
  url = '';
  title = '';
  loading = false;
  error = null;
  sections = [];
  elementDecisions = new Map();
  elementStates = new Map();
}

/**
 * Initialize sections from scanned landmarks.
 * Call this after receiving SCAN_LANDMARKS response.
 */
export function initializeFromScan(
  pageUrl: string,
  pageTitle: string,
  scannedLandmarks: ScannedLandmark[]
): void {
  url = pageUrl;
  title = pageTitle;
  error = null;

  // Store confidence for each element
  const newConfidences = new Map<string, number>();
  for (const landmark of scannedLandmarks) {
    for (const block of landmark.blocks) {
      if (block.type === 'element' && block.fingerprint) {
        // Store confidence from fingerprint
        const confidence = block.fingerprint.lastMatchConfidence ?? 1.0;
        newConfidences.set(block.elementId, confidence);
      }
    }
  }
  elementConfidences = newConfidences;

  // Convert scanned landmarks to sections, filtering low-confidence elements
  sections = scannedLandmarks.map((landmark) => {
    // Filter blocks to only include high-confidence elements
    const filteredBlocks = landmark.blocks.filter((block) => {
      if (block.type !== 'element') return true;
      const confidence = newConfidences.get(block.elementId) ?? 1.0;
      return confidence >= CONFIDENCE_THRESHOLD;
    });

    return {
      id: landmark.id,
      landmark: landmark.type,
      title: landmark.rawTitle,
      description: undefined,
      expanded: false, // All collapsed by default
      itemCount: countInteractiveElements(filteredBlocks),
      blocks: filteredBlocks.map(convertBlock),
    };
  });

  // Remove empty sections
  sections = sections.filter((section) => section.blocks.length > 0);
}

/**
 * Apply LLM importance decisions to sections.
 * Filters out non-important elements and applies enhanced labels.
 * Also filters by confidence threshold.
 */
export function applyLLMDecisions(response: LLMPageResponse): void {
  // Store all decisions
  elementDecisions = new Map(Object.entries(response.elements));

  // Update sections with LLM-enhanced titles and filter elements
  sections = sections.map((section) => {
    // Apply section title/description from LLM if available
    const sectionMeta = response.sections[section.landmark];
    const updatedSection = {
      ...section,
      title: sectionMeta?.title || section.title,
      description: sectionMeta?.description,
    };

    // Filter blocks - keep headings/text, filter elements by importance AND confidence
    updatedSection.blocks = section.blocks.filter((block) => {
      if (block.type !== 'element') return true;

      // Check confidence threshold first
      const confidence = elementConfidences.get(block.elementId) ?? 1.0;
      if (confidence < CONFIDENCE_THRESHOLD) return false;

      const decision = elementDecisions.get(block.elementId);
      // If no decision from LLM, show the element (fail open)
      if (!decision) {
        return true;
      }

      return decision.important;
    });

    // Update item count after filtering
    updatedSection.itemCount = updatedSection.blocks.filter((b) => b.type === 'element').length;

    return updatedSection;
  });

  // Remove empty sections (no content after filtering)
  sections = sections.filter((section) => section.blocks.length > 0);
}

/**
 * Toggle a section's expanded state.
 */
export function toggleSection(sectionId: string): void {
  sections = sections.map((section) =>
    section.id === sectionId ? { ...section, expanded: !section.expanded } : section
  );
}

/**
 * Expand all sections.
 */
export function expandAll(): void {
  sections = sections.map((section) => ({ ...section, expanded: true }));
}

/**
 * Collapse all sections.
 */
export function collapseAll(): void {
  sections = sections.map((section) => ({ ...section, expanded: false }));
}

/**
 * Update element state from content script (STATE_PATCH).
 */
export function updateElementState(elementId: string, changes: Record<string, unknown>): void {
  const current = elementStates.get(elementId) || {};
  elementStates.set(elementId, { ...current, ...changes });
  elementStates = new Map(elementStates); // Trigger reactivity
}

/**
 * Update element fingerprint when re-matched (text may have changed).
 */
export function updateElementFingerprint(elementId: string, fingerprint: ElementFingerprint): void {
  const decision = elementDecisions.get(elementId);

  const newSections = sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.type === 'element' && block.elementId === elementId) {
        const newNode = fingerprintToUINode(fingerprint, decision);
        return {
          ...block,
          fingerprint,
          node: newNode,
        };
      }
      return block;
    }),
  }));

  // Trigger Svelte reactivity by reassigning
  sections = newSections;

  // Increment version to force re-renders in components using the store
  version++;
}

/**
 * Update element confidence (from ELEMENT_MATCHED).
 * If confidence drops below threshold, remove the element from sections.
 */
export function updateElementConfidence(elementId: string, confidence: number): void {
  elementConfidences.set(elementId, confidence);
  elementConfidences = new Map(elementConfidences);

  // If confidence dropped below threshold, remove from sections
  if (confidence < CONFIDENCE_THRESHOLD) {
    sections = sections.map((section) => {
      const filteredBlocks = section.blocks.filter(
        (block) => block.type !== 'element' || block.elementId !== elementId
      );

      return {
        ...section,
        blocks: filteredBlocks,
        itemCount: filteredBlocks.filter((b) => b.type === 'element').length,
      };
    });

    // Remove empty sections
    sections = sections.filter((section) => section.blocks.length > 0);
  }
}

/**
 * Get element confidence.
 */
export function getElementConfidence(elementId: string): number {
  return elementConfidences.get(elementId) ?? 1.0;
}

/**
 * Set initial element states from content script (INITIAL_STATE).
 */
export function setInitialElementStates(states: Record<string, Record<string, unknown>>): void {
  for (const [id, state] of Object.entries(states)) {
    elementStates.set(id, state);
  }
  elementStates = new Map(elementStates);
}

/**
 * Remove an element when it's lost (ELEMENT_REMOVED).
 */
export function removeElement(elementId: string): void {
  // Remove from element states
  elementStates.delete(elementId);
  elementStates = new Map(elementStates);

  // Remove from sections
  sections = sections.map((section) => {
    const filteredBlocks = section.blocks.filter(
      (block) => block.type !== 'element' || block.elementId !== elementId
    );

    return {
      ...section,
      blocks: filteredBlocks,
      itemCount: filteredBlocks.filter((b) => b.type === 'element').length,
    };
  });

  // Remove empty sections
  sections = sections.filter((section) => section.blocks.length > 0);
}

/**
 * Add a new element (element-found from ElementTracker).
 */
export function addElement(fingerprint: ElementFingerprint, decision: ElementDecision): void {
  // Store decision
  elementDecisions.set(fingerprint.id, decision);
  elementDecisions = new Map(elementDecisions);

  // Store confidence
  const confidence = fingerprint.lastMatchConfidence ?? 1.0;
  elementConfidences.set(fingerprint.id, confidence);
  elementConfidences = new Map(elementConfidences);

  // Skip if not important
  if (!decision.important) return;

  // Skip if confidence below threshold
  if (confidence < CONFIDENCE_THRESHOLD) return;

  // Find the section this element belongs to
  const landmarkType = fingerprint.nearestLandmark?.tagName || 'page';
  const sectionIndex = sections.findIndex(
    (s) => s.landmark === landmarkType || s.id === 'page-content'
  );

  if (sectionIndex === -1) {
    // No matching section, add to page-content or create new one
    const pageSection = sections.find((s) => s.id === 'page-content');
    if (pageSection) {
      pageSection.blocks.push({
        type: 'element',
        elementId: fingerprint.id,
        fingerprint,
        node: fingerprintToUINode(fingerprint, decision),
      });
      pageSection.itemCount++;
      sections = [...sections];
    }
    return;
  }

  // Add to existing section
  const section = sections[sectionIndex];
  section.blocks.push({
    type: 'element',
    elementId: fingerprint.id,
    fingerprint,
    node: fingerprintToUINode(fingerprint, decision),
  });
  section.itemCount++;
  sections = [...sections];
}

/**
 * Get the current state of an element (for form sync).
 */
export function getElementState(elementId: string): Record<string, unknown> | undefined {
  return elementStates.get(elementId);
}

/**
 * Get the decision for an element.
 */
export function getElementDecision(elementId: string): ElementDecision | undefined {
  return elementDecisions.get(elementId);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Count interactive elements in a list of blocks.
 */
function countInteractiveElements(blocks: ScannedBlock[]): number {
  return blocks.filter((b) => b.type === 'element').length;
}

/**
 * Convert a scanned block to a content block.
 */
function convertBlock(block: ScannedBlock): ContentBlock {
  if (block.type === 'element') {
    return {
      type: 'element',
      elementId: block.elementId,
      fingerprint: block.fingerprint,
      node: undefined, // Will be set after LLM evaluation
    };
  }
  return block;
}

/**
 * Convert a fingerprint to a UINode for rendering.
 *
 * IMPORTANT: For buttons and CTAs with visible text, we use the fingerprint's
 * textContent (the actual text on the page) rather than the LLM's semantic label.
 * This ensures dynamically changing buttons show their current text.
 *
 * The LLM label is only used for elements without visible text (like icon buttons).
 */
export function fingerprintToUINode(
  fingerprint: ElementFingerprint,
  decision?: ElementDecision
): UINode {
  // Prefer actual visible text for buttons, use LLM label only as fallback
  const label =
    fingerprint.textContent ||
    fingerprint.ariaLabel ||
    decision?.label ||
    fingerprint.placeholder ||
    'Unlabeled';
  const actionBinding: ActionBinding = {
    elementId: fingerprint.id,
    action: 'click',
  };

  const tag = fingerprint.tagName.toLowerCase();
  const inputType = fingerprint.inputType?.toLowerCase();

  // Determine the appropriate UINode type
  if (tag === 'button' || fingerprint.role === 'button') {
    return {
      type: 'button',
      label,
      variant: 'default',
      actionBinding,
    };
  }

  if (tag === 'a' || fingerprint.role === 'link') {
    return {
      type: 'button',
      label,
      variant: 'link',
      actionBinding,
    };
  }

  if (tag === 'input') {
    if (inputType === 'checkbox') {
      return {
        type: 'checkbox',
        label,
        actionBinding,
      };
    }

    if (inputType === 'radio') {
      // Radio buttons are handled as a group in SectionContent.svelte
      // Return as checkbox for fallback rendering (individual radio)
      return {
        type: 'checkbox',
        label,
        actionBinding,
      };
    }

    if (inputType === 'submit' || inputType === 'button') {
      return {
        type: 'button',
        label,
        variant: 'default',
        actionBinding,
      };
    }

    // Text input types
    const textInputTypes = ['text', 'email', 'password', 'number', 'tel', 'url', 'search'];
    const uiInputType = textInputTypes.includes(inputType || 'text')
      ? (inputType as 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search')
      : 'text';

    return {
      type: 'input',
      label,
      placeholder: fingerprint.placeholder || undefined,
      inputType: uiInputType,
      actionBinding,
    };
  }

  if (tag === 'textarea') {
    return {
      type: 'textarea',
      label,
      placeholder: fingerprint.placeholder || undefined,
      actionBinding,
    };
  }

  if (tag === 'select') {
    // Get options from element state if available
    const state = elementStates.get(fingerprint.id);
    const options = (state?.options as Array<{ value: string; label: string }>) || [];

    return {
      type: 'select',
      label,
      options: options.map((opt) => ({ value: opt.value, label: opt.label })),
      actionBinding,
    };
  }

  // Default to button for other interactive elements
  return {
    type: 'button',
    label,
    variant: 'outline',
    actionBinding,
  };
}

// =============================================================================
// Exports
// =============================================================================

export const landmarksStore = {
  // State (readonly externally, use getters)
  get url() {
    return url;
  },
  get title() {
    return title;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },
  get sections() {
    return sections;
  },
  get totalItemCount() {
    return totalItemCount;
  },
  get allCollapsed() {
    return allCollapsed;
  },
  get hasExpandedSection() {
    return hasExpandedSection;
  },
  get version() {
    return version;
  }, // Force reactivity

  // Actions
  setLoading,
  setError,
  reset,
  initializeFromScan,
  applyLLMDecisions,
  toggleSection,
  expandAll,
  collapseAll,
  updateElementState,
  setInitialElementStates,
  removeElement,
  addElement,
  getElementState,
  getElementDecision,
  getElementConfidence,
  updateElementConfidence,
  updateElementFingerprint,
  fingerprintToUINode,
};
