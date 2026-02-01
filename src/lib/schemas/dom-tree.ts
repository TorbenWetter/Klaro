/**
 * DOM Tree Schema
 *
 * Types for hierarchical DOM tree mirroring in the sidebar.
 * Preserves the exact parent-child relationships from the website DOM.
 */

import { z } from 'zod';
import type { ElementFingerprint } from '../../utils/element-tracker/types';

// =============================================================================
// Node Type Definitions
// =============================================================================

/** Classification of DOM elements for rendering */
export const NodeType = z.enum([
  'container', // div, section, article, nav, etc.
  'text', // p, span with text, headings
  'interactive', // buttons, inputs, links
  'media', // img, video, audio, canvas, svg
  'list', // ul, ol
  'listItem', // li
  'table', // table structures
]);

export type NodeType = z.infer<typeof NodeType>;

// =============================================================================
// DOM Tree Node
// =============================================================================

/** Base tree node without children (for recursive definition) */
export interface DOMTreeNodeBase {
  /** Fingerprint ID for tracking */
  id: string;
  /** Full fingerprint for element tracking */
  fingerprint: ElementFingerprint;
  /** HTML tag name (lowercase) */
  tagName: string;
  /** Node classification for rendering */
  nodeType: NodeType;
  /** Display label (LLM-enhanced or extracted) */
  label: string;
  /** Original text content before LLM enhancement */
  originalLabel: string;
  /** Nesting depth (0 = root) */
  depth: number;
  /** UI state: is node expanded in tree */
  isExpanded: boolean;
  /** Is element currently visible in viewport */
  isVisible: boolean;
  /** Is this part of a modal/overlay */
  isModal: boolean;
  /** LLM-provided description (optional) */
  description?: string;
  /** For interactive elements: the specific type */
  interactiveType?: 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'select' | 'textarea';
  /** For inputs: placeholder text */
  placeholder?: string;
  /** For headings: level 1-6 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** For images: alt text */
  altText?: string;
}

/** Complete tree node with children */
export interface DOMTreeNode extends DOMTreeNodeBase {
  /** Child nodes */
  children: DOMTreeNode[];
}

// =============================================================================
// DOM Tree Root
// =============================================================================

/** Root tree structure with metadata */
export interface DOMTree {
  /** Root node (usually body) */
  root: DOMTreeNode;
  /** Total number of nodes in tree */
  nodeCount: number;
  /** Maximum nesting depth */
  maxDepth: number;
  /** Currently active modal node (if any) */
  modalNode: DOMTreeNode | null;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
}

// =============================================================================
// Visibility & Viewport Tracking
// =============================================================================

/** Visibility state for scroll-to functionality */
export interface ElementVisibility {
  elementId: string;
  isInViewport: boolean;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// =============================================================================
// Smart Collapse Configuration
// =============================================================================

/** Configuration for auto-collapse behavior */
export interface CollapseConfig {
  /** Max depth before auto-collapse (default: 4) */
  maxExpandedDepth: number;
  /** Max children before auto-collapse (default: 10) */
  maxExpandedChildren: number;
  /** Min children for auto-expand (default: 3) */
  minChildrenToExpand: number;
  /** Initial expand depth (default: 2) */
  initialExpandDepth: number;
}

export const DEFAULT_COLLAPSE_CONFIG: CollapseConfig = {
  maxExpandedDepth: 4,
  maxExpandedChildren: 10,
  minChildrenToExpand: 3,
  initialExpandDepth: 2,
};

// =============================================================================
// LLM Label Enhancement
// =============================================================================

/** LLM response for batch labeling */
export const LLMLabelResponse = z.object({
  /** Labels by element ID */
  labels: z.record(z.string(), z.string()),
  /** Optional descriptions by element ID */
  descriptions: z.record(z.string(), z.string()).optional(),
});

export type LLMLabelResponse = z.infer<typeof LLMLabelResponse>;

// =============================================================================
// Message Types
// =============================================================================

/** Request to scan full DOM tree */
export interface ScanTreeRequest {
  type: 'SCAN_TREE';
}

/** Response with complete DOM tree */
export interface ScanTreeResponse {
  type: 'TREE_SCANNED';
  tree: DOMTree;
  error?: string;
}

/** Node added to DOM */
export interface NodeAddedMessage {
  type: 'NODE_ADDED';
  parentId: string;
  node: DOMTreeNode;
  index: number;
}

/** Node removed from DOM */
export interface NodeRemovedMessage {
  type: 'NODE_REMOVED';
  nodeId: string;
}

/** Node updated (text, attributes, etc.) */
export interface NodeUpdatedMessage {
  type: 'NODE_UPDATED';
  nodeId: string;
  changes: Partial<DOMTreeNodeBase>;
}

/** Node moved to different parent */
export interface NodeMovedMessage {
  type: 'NODE_MOVED';
  nodeId: string;
  newParentId: string;
  newIndex: number;
}

/** Modal opened */
export interface ModalOpenedMessage {
  type: 'MODAL_OPENED';
  modalNodeId: string;
}

/** Modal closed */
export interface ModalClosedMessage {
  type: 'MODAL_CLOSED';
}

/** Scroll to element request */
export interface ScrollToElementRequest {
  type: 'SCROLL_TO_ELEMENT';
  elementId: string;
}

/** Scroll complete response */
export interface ScrollCompleteResponse {
  type: 'SCROLL_COMPLETE';
  success: boolean;
  error?: string;
}

/** Union of all tree-related messages */
export type TreeMessage =
  | ScanTreeRequest
  | ScanTreeResponse
  | NodeAddedMessage
  | NodeRemovedMessage
  | NodeUpdatedMessage
  | NodeMovedMessage
  | ModalOpenedMessage
  | ModalClosedMessage
  | ScrollToElementRequest
  | ScrollCompleteResponse;

// =============================================================================
// Helper Types
// =============================================================================

/** Tags that are considered containers */
export const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'nav',
  'aside',
  'header',
  'footer',
  'main',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dialog',
  'template',
  'slot',
]);

/** Tags that are interactive */
export const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
]);

/** Tags that are text content */
export const TEXT_TAGS = new Set([
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'legend',
  'caption',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'mark',
  'del',
  'ins',
  'sub',
  'sup',
  'code',
  'pre',
  'blockquote',
  'q',
  'cite',
  'abbr',
  'time',
  'address',
]);

/** Tags that are media */
export const MEDIA_TAGS = new Set(['img', 'video', 'audio', 'canvas', 'svg', 'picture', 'iframe']);

/** Tags that are lists */
export const LIST_TAGS = new Set(['ul', 'ol', 'dl', 'menu']);

/** Tags that are list items */
export const LIST_ITEM_TAGS = new Set(['li', 'dt', 'dd']);

/** Tags that are tables */
export const TABLE_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
]);

/** Tags to skip entirely (never show in tree) */
export const SKIP_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'slot',
  'br',
  'wbr',
  'hr',
]);

/** Roles that indicate modals/dialogs */
export const MODAL_ROLES = new Set(['dialog', 'alertdialog', 'modal']);
