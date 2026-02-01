/**
 * Tree Tracker Types
 *
 * Types for unified DOM tree tracking with fingerprint-based identification,
 * grace periods, and robust re-render detection.
 */

import type { ElementFingerprint, MatchWeights } from '../element-tracker/types';

// =============================================================================
// Node Types
// =============================================================================

/**
 * Node types for tree classification
 */
export type NodeType =
  | 'interactive' // buttons, links, inputs
  | 'text' // headings, paragraphs
  | 'media' // images, video
  | 'container' // divs, sections
  | 'list' // ul, ol
  | 'listItem' // li
  | 'table'; // table elements

/**
 * Interactive element subtypes
 */
export type InteractiveType =
  | 'button'
  | 'link'
  | 'input'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'textarea';

// =============================================================================
// Tree Node
// =============================================================================

/**
 * A node in the hierarchical tree
 */
export interface TreeNode {
  /** Fingerprint ID for tracking */
  id: string;
  /** Full fingerprint for element re-identification */
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
  /** Child nodes */
  children: TreeNode[];

  // Interactive-specific
  /** For interactive elements: the specific type */
  interactiveType?: InteractiveType;

  // Text-specific
  /** For headings: level 1-6 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;

  // Media-specific
  /** For images: alt text */
  altText?: string;

  // Form state (synced from DOM)
  /** Current input value */
  value?: string;
  /** Checkbox/radio checked state */
  checked?: boolean;
  /** Element disabled state */
  disabled?: boolean;
  /** For inputs: placeholder text */
  placeholder?: string;
  /** For selects: available options */
  options?: { value: string; label: string; selected: boolean }[];

  // LLM enhancement
  /** LLM-provided description (optional) */
  description?: string;
}

// =============================================================================
// Tracked Node (Internal)
// =============================================================================

/**
 * Tracking status for a node
 */
export type TrackedNodeStatus = 'active' | 'searching' | 'lost';

/**
 * Internal tracked node with WeakRef and status
 */
export interface TrackedNode {
  /** The tree node data */
  node: TreeNode;
  /** Weak reference to DOM element (allows GC) */
  ref: WeakRef<HTMLElement>;
  /** Current tracking status */
  status: TrackedNodeStatus;
  /** Timestamp when element was detected as missing (for grace period) */
  lostAt: number | null;
  /** Parent node ID (null for root) */
  parentId: string | null;
}

// =============================================================================
// DOM Tree
// =============================================================================

/**
 * Tree structure returned by initial scan
 */
export interface DOMTree {
  /** Root node (usually body) */
  root: TreeNode;
  /** Total number of nodes in tree */
  nodeCount: number;
  /** Maximum nesting depth */
  maxDepth: number;
  /** Currently active modal node (if any) */
  modalNode: TreeNode | null;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * TreeTracker configuration
 */
export interface TreeTrackerConfig {
  /** Minimum confidence to accept a match (default: 0.6) */
  confidenceThreshold: number;
  /** Time to wait before declaring element lost, in ms (default: 150) */
  gracePeriodMs: number;
  /** Maximum nodes to track (default: 5000) */
  maxNodes: number;
  /** Maximum tree depth (default: 50) */
  maxDepth: number;
  /** Weights for matching algorithm */
  weights: MatchWeights;
  /** Enable debug logging (default: false) */
  debugMode: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_TREE_TRACKER_CONFIG: TreeTrackerConfig = {
  confidenceThreshold: 0.6,
  gracePeriodMs: 150, // Slightly longer than ElementTracker's 100ms for React
  maxNodes: 5000,
  maxDepth: 50,
  weights: {
    // Identity (exact match when present)
    testId: 1.0,
    htmlId: 0.9,
    // Structural - HIGHEST PRIORITY for tree tracking
    tagName: 0.95,
    ancestorPath: 0.9,
    siblingIndex: 0.85,
    // Position
    boundingBox: 0.8,
    // Semantic
    role: 0.7,
    ariaLabel: 0.6,
    name: 0.7,
    // Content - LOWER PRIORITY
    textContent: 0.3,
    placeholder: 0.5,
    alt: 0.4,
    href: 0.6,
    // Contextual
    neighborText: 0.4,
    // Deprioritized
    className: 0.1,
  },
  debugMode: false,
};

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event types emitted by TreeTracker
 */
export type TreeTrackerEventType =
  | 'tree-initialized'
  | 'node-added'
  | 'node-removed'
  | 'node-updated'
  | 'node-matched'
  | 'tree-error';

/**
 * Emitted when initial tree scan completes
 */
export interface TreeInitializedEvent {
  type: 'tree-initialized';
  tree: DOMTree;
}

/**
 * Emitted when a new node is added to the tree
 */
export interface NodeAddedEvent {
  type: 'node-added';
  node: TreeNode;
  parentId: string;
  index: number;
}

/**
 * Emitted when a node is removed from the tree
 */
export interface NodeRemovedEvent {
  type: 'node-removed';
  nodeId: string;
}

/**
 * Emitted when a node's properties are updated
 */
export interface NodeUpdatedEvent {
  type: 'node-updated';
  nodeId: string;
  changes: Partial<TreeNode>;
}

/**
 * Emitted when a re-rendered node is matched (React re-render detected)
 */
export interface NodeMatchedEvent {
  type: 'node-matched';
  nodeId: string;
  confidence: number;
  changes: Partial<TreeNode>;
}

/**
 * Emitted when an error occurs
 */
export interface TreeErrorEvent {
  type: 'tree-error';
  error: string;
}

/**
 * Union of all TreeTracker events
 */
export type TreeTrackerEvent =
  | TreeInitializedEvent
  | NodeAddedEvent
  | NodeRemovedEvent
  | NodeUpdatedEvent
  | NodeMatchedEvent
  | TreeErrorEvent;

// =============================================================================
// Message Types (for content script <-> sidebar communication)
// =============================================================================

/**
 * Request to scan full DOM tree
 */
export interface ScanTreeRequest {
  type: 'SCAN_TREE';
}

/**
 * Response with complete DOM tree
 */
export interface ScanTreeResponse {
  type: 'TREE_SCANNED';
  tree: DOMTree;
  error?: string;
}

/**
 * Node added to DOM (sent to sidebar)
 */
export interface NodeAddedMessage {
  type: 'NODE_ADDED';
  parentId: string;
  node: TreeNode;
  index: number;
}

/**
 * Node removed from DOM (sent to sidebar)
 */
export interface NodeRemovedMessage {
  type: 'NODE_REMOVED';
  nodeId: string;
}

/**
 * Node updated (sent to sidebar)
 */
export interface NodeUpdatedMessage {
  type: 'NODE_UPDATED';
  nodeId: string;
  changes: Partial<TreeNode>;
}

/**
 * Node matched after re-render (sent to sidebar)
 */
export interface NodeMatchedMessage {
  type: 'NODE_MATCHED';
  nodeId: string;
  confidence: number;
  changes: Partial<TreeNode>;
}

/**
 * Union of all tree-related messages
 */
export type TreeMessage =
  | ScanTreeRequest
  | ScanTreeResponse
  | NodeAddedMessage
  | NodeRemovedMessage
  | NodeUpdatedMessage
  | NodeMatchedMessage;

// =============================================================================
// Action Types
// =============================================================================

/**
 * Result of an element action
 */
export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Click element request
 */
export interface ClickElementRequest {
  type: 'CLICK_ELEMENT';
  id: string;
}

/**
 * Set input value request
 */
export interface SetInputValueRequest {
  type: 'SET_INPUT_VALUE';
  id: string;
  value: string;
}

/**
 * Toggle checkbox request
 */
export interface ToggleCheckboxRequest {
  type: 'TOGGLE_CHECKBOX';
  id: string;
  checked?: boolean;
}

/**
 * Set select value request
 */
export interface SetSelectValueRequest {
  type: 'SET_SELECT_VALUE';
  id: string;
  value: string;
}

/**
 * Scroll to element request
 */
export interface ScrollToElementRequest {
  type: 'SCROLL_TO_ELEMENT';
  id: string;
}

/**
 * Union of all action requests
 */
export type ActionRequest =
  | ClickElementRequest
  | SetInputValueRequest
  | ToggleCheckboxRequest
  | SetSelectValueRequest
  | ScrollToElementRequest;

// =============================================================================
// Re-exports
// =============================================================================

// Re-export fingerprint types for convenience
export type { ElementFingerprint, MatchWeights } from '../element-tracker/types';
