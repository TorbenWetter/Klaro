/**
 * Landmark Section Schema
 *
 * Types for landmark-based sidebar organization.
 */

import { z } from 'zod';
import type { UINode } from './accessible-ui';
import type { ElementFingerprint } from '../../utils/element-tracker/types';

// =============================================================================
// Content Block Types
// =============================================================================

/** A heading within a section */
export const HeadingBlock = z.object({
  type: z.literal('heading'),
  level: z.number().min(1).max(6) as z.ZodType<1 | 2 | 3 | 4 | 5 | 6>,
  text: z.string(),
});

/** A text paragraph within a section */
export const TextBlock = z.object({
  type: z.literal('text'),
  content: z.string(),
});

/** An interactive element reference */
export const ElementBlock = z.object({
  type: z.literal('element'),
  elementId: z.string(),
  // UINode is stored after LLM enhancement
  node: z.custom<UINode>().optional(),
  // Original fingerprint for reference
  fingerprint: z.custom<ElementFingerprint>().optional(),
});

/** Union of all content block types */
export const ContentBlock = z.discriminatedUnion('type', [HeadingBlock, TextBlock, ElementBlock]);

export type ContentBlock =
  | z.infer<typeof HeadingBlock>
  | z.infer<typeof TextBlock>
  | z.infer<typeof ElementBlock>;

// =============================================================================
// Landmark Section Types
// =============================================================================

/** Supported landmark types */
export const LandmarkType = z.enum([
  'nav',
  'main',
  'aside',
  'header',
  'footer',
  'section',
  'article',
  'form',
  'search',
  'region',
  'page',
]);

export type LandmarkType = z.infer<typeof LandmarkType>;

/** A landmark section containing page content */
export const LandmarkSection = z.object({
  /** Unique section ID */
  id: z.string(),
  /** Landmark type (nav, main, form, etc.) */
  landmark: LandmarkType,
  /** Display title (LLM-enhanced or default) */
  title: z.string(),
  /** Optional description from LLM */
  description: z.string().optional(),
  /** Whether section is expanded (collapsed by default) */
  expanded: z.boolean().default(false),
  /** Number of interactive items for badge */
  itemCount: z.number().default(0),
  /** Content blocks in DOM order */
  blocks: z.array(ContentBlock),
});

export type LandmarkSection = z.infer<typeof LandmarkSection>;

// =============================================================================
// LLM Response Types
// =============================================================================

/** LLM decision for a single element */
export const ElementDecision = z.object({
  /** Whether this element is important for seniors */
  important: z.boolean(),
  /** Enhanced label for the element */
  label: z.string(),
  /** Optional description/help text */
  description: z.string().optional(),
});

export type ElementDecision = z.infer<typeof ElementDecision>;

/** LLM response for initial page evaluation */
export const LLMPageResponse = z.object({
  /** Importance decisions by fingerprint ID */
  elements: z.record(z.string(), ElementDecision),
  /** Section metadata by landmark type */
  sections: z.record(
    z.string(),
    z.object({
      title: z.string(),
      description: z.string().optional(),
    })
  ),
});

export type LLMPageResponse = z.infer<typeof LLMPageResponse>;

/** LLM response for single element evaluation (incremental update) */
export const LLMElementResponse = z.object({
  important: z.boolean(),
  label: z.string(),
  description: z.string().optional(),
});

export type LLMElementResponse = z.infer<typeof LLMElementResponse>;

// =============================================================================
// Page State Types
// =============================================================================

/** Full page state for the sidebar */
export interface PageState {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Landmark sections */
  sections: LandmarkSection[];
  /** Element decisions from LLM (by fingerprint ID) */
  elementDecisions: Map<string, ElementDecision>;
}

/** Initial page state */
export function createInitialPageState(): PageState {
  return {
    url: '',
    title: '',
    loading: false,
    error: null,
    sections: [],
    elementDecisions: new Map(),
  };
}

// =============================================================================
// Message Types
// =============================================================================

/** Request to scan landmarks from sidepanel to content script */
export interface ScanLandmarksRequest {
  type: 'SCAN_LANDMARKS';
}

/** Response from content script with scanned landmarks */
export interface ScanLandmarksResponse {
  url: string;
  title: string;
  landmarks: Array<{
    id: string;
    type: string;
    rawTitle: string;
    blocks: ContentBlock[];
  }>;
  error?: string;
}
