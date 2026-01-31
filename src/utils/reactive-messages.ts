/**
 * Message types for reactive binding system
 * Used for communication between content script and sidepanel
 */

import type { ScannedAction } from './dom-scanner';
import type { ElementState, PendingChange } from './binding-manager';
import type { AccessibleUI, UINode } from '$lib/schemas/accessible-ui';

// ============================================================================
// CONTENT SCRIPT → SIDEPANEL MESSAGES
// ============================================================================

/** State patch for an existing element */
export interface StatePatchMessage {
  type: 'STATE_PATCH';
  id: string;
  changes: Partial<ElementState>;
}

/** Element was removed from the page */
export interface ElementRemovedMessage {
  type: 'ELEMENT_REMOVED';
  id: string;
}

/** Minor addition - new elements that don't need LLM */
export interface MinorAdditionMessage {
  type: 'MINOR_ADDITION';
  elements: ScannedAction[];
}

/** New UI context detected - needs LLM processing (user approval required) */
export interface PendingChangeMessage {
  type: 'PENDING_CHANGE';
  change: PendingChange;
}

/** Response to PROCESS_CHANGE request */
export interface ChangeProcessedMessage {
  type: 'CHANGE_PROCESSED';
  changeId: string;
  ui: AccessibleUI | null;
  error?: string;
}

/** Initial state for all elements after scan */
export interface InitialStateMessage {
  type: 'INITIAL_STATE';
  states: Record<string, ElementState>;
}

export type ContentToSidepanelMessage =
  | StatePatchMessage
  | ElementRemovedMessage
  | MinorAdditionMessage
  | PendingChangeMessage
  | ChangeProcessedMessage
  | InitialStateMessage;

// ============================================================================
// SIDEPANEL → CONTENT SCRIPT MESSAGES
// ============================================================================

/** Start reactive tracking after initial scan */
export interface StartTrackingMessage {
  type: 'START_TRACKING';
  actions: ScannedAction[];
}

/** Stop reactive tracking */
export interface StopTrackingMessage {
  type: 'STOP_TRACKING';
}

/** User approved a pending change - process it */
export interface ProcessChangeMessage {
  type: 'PROCESS_CHANGE';
  changeId: string;
}

/** User rejected a pending change - dismiss it */
export interface DismissChangeMessage {
  type: 'DISMISS_CHANGE';
  changeId: string;
}

/** Get subtree description for a pending change (for LLM) */
export interface GetSubtreeDescriptionMessage {
  type: 'GET_SUBTREE_DESCRIPTION';
  changeId: string;
}

export type SidepanelToContentMessage =
  | StartTrackingMessage
  | StopTrackingMessage
  | ProcessChangeMessage
  | DismissChangeMessage
  | GetSubtreeDescriptionMessage;

// ============================================================================
// PENDING CHANGE QUEUE ITEM (for UI)
// ============================================================================

export interface QueuedChange {
  id: string;
  timestamp: number;
  description: string;
  estimatedTokens: number;
  elementCount: number;
  status: 'pending' | 'processing' | 'completed' | 'dismissed';
}
