/**
 * Element Tracker
 *
 * Main class for stable element tracking across framework re-renders.
 * Uses fingerprinting, fuzzy matching, and MutationObserver with double-RAF batching.
 */

import type {
  ElementFingerprint,
  TrackedElement,
  TrackerConfig,
  TrackerEvent,
  TrackerEventType,
  MatchResult,
} from './types';
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from './types';
import {
  createFingerprint,
  getInteractiveElements,
  isInteractiveElement,
  updateFingerprint,
} from './fingerprint';
import { findBestMatch, matchAll, findUnmatched } from './matcher';
import { TabStorage } from './storage';

// =============================================================================
// ElementTracker Class
// =============================================================================

/**
 * Main element tracker class.
 * Tracks interactive elements across DOM mutations using fingerprinting.
 */
export class ElementTracker extends EventTarget {
  private config: TrackerConfig;
  private tracked: Map<string, TrackedElement>;
  private observer: MutationObserver | null;
  private storage: TabStorage | null;
  private container: HTMLElement | Document;

  // Batching state
  private pendingMutations: MutationRecord[];
  private rafId: number | null;
  private timeoutId: number | null;
  private isProcessing: boolean;

  // Grace period tracking
  private searchingElements: Map<string, number>; // id -> timeout handle

  // Debug overlay
  private debugOverlay: HTMLElement | null;

  constructor(config: Partial<TrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tracked = new Map();
    this.observer = null;
    this.storage = null;
    this.container = document;

    this.pendingMutations = [];
    this.rafId = null;
    this.timeoutId = null;
    this.isProcessing = false;

    this.searchingElements = new Map();
    this.debugOverlay = null;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start tracking elements in the container.
   */
  async start(container: HTMLElement | Document = document): Promise<void> {
    this.container = container;

    // Initialize storage if we have a tab ID
    try {
      const tabId = await this.getTabId();
      if (tabId) {
        this.storage = new TabStorage(tabId);
        await this.loadFromStorage();
      }
    } catch {
      // Running outside extension context (e.g., tests)
      this.storage = null;
    }

    // Initial scan for interactive elements
    await this.scanAndTrack();

    // Set up mutation observer
    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.observer.observe(
      container instanceof Document ? container.body : container,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-testid',
          'aria-label',
          'role',
          'name',
          'placeholder',
          'value',
          'disabled',
          'id',
          'href',
        ],
      }
    );

    console.debug('[Klaro] ElementTracker started');
  }

  /**
   * Stop tracking and clean up.
   */
  stop(): void {
    // Disconnect observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Cancel pending batches
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Cancel grace period timeouts
    for (const handle of this.searchingElements.values()) {
      clearTimeout(handle);
    }
    this.searchingElements.clear();

    // Remove debug overlay
    if (this.debugOverlay) {
      this.debugOverlay.remove();
      this.debugOverlay = null;
    }

    console.debug('[Klaro] ElementTracker stopped');
  }

  // ===========================================================================
  // Element Access
  // ===========================================================================

  /**
   * Get all tracked elements.
   */
  getTrackedElements(): TrackedElement[] {
    return Array.from(this.tracked.values());
  }

  /**
   * Get element by fingerprint ID.
   * Attempts re-identification if element is stale.
   */
  getElementById(id: string): HTMLElement | null {
    const tracked = this.tracked.get(id);
    if (!tracked) return null;

    const element = tracked.ref.deref();

    // WeakRef returned undefined = element was garbage collected
    if (!element) {
      this.handleElementLost(tracked);
      return null;
    }

    // Element removed from DOM but not yet GC'd
    if (!element.isConnected) {
      // Try to re-identify
      const match = this.attemptReidentification(tracked);
      if (match) {
        return match.element;
      }
      return null;
    }

    return element;
  }

  /**
   * Get fingerprint by ID.
   */
  getFingerprint(id: string): ElementFingerprint | null {
    return this.tracked.get(id)?.fingerprint ?? null;
  }

  /**
   * Click an element by fingerprint ID.
   * Returns success status and confidence.
   */
  async clickElement(
    id: string
  ): Promise<{ success: boolean; confidence: number; error?: string }> {
    const element = this.getElementById(id);

    if (!element) {
      return { success: false, confidence: 0, error: 'Element not found' };
    }

    const tracked = this.tracked.get(id);
    const confidence = tracked?.fingerprint.lastMatchConfidence ?? 0;

    try {
      // Simulate click
      element.click();
      return { success: true, confidence };
    } catch (error) {
      return {
        success: false,
        confidence,
        error: error instanceof Error ? error.message : 'Click failed',
      };
    }
  }

  // ===========================================================================
  // MutationObserver Handling
  // ===========================================================================

  /**
   * Handle incoming mutations (batched via double-RAF).
   */
  private handleMutations(mutations: MutationRecord[]): void {
    this.pendingMutations.push(...mutations);

    // Cancel any pending processing
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.timeoutId) clearTimeout(this.timeoutId);

    // Double-RAF: wait for framework batch + browser render
    this.rafId = requestAnimationFrame(() => {
      this.rafId = requestAnimationFrame(() => {
        this.processMutationBatch();
      });
    });

    // Fallback timeout (100ms)
    this.timeoutId = window.setTimeout(() => {
      this.processMutationBatch();
    }, 100);
  }

  /**
   * Process accumulated mutations.
   */
  private async processMutationBatch(): Promise<void> {
    if (this.isProcessing || this.pendingMutations.length === 0) return;

    this.isProcessing = true;

    // Clear timers
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Take current batch
    const mutations = this.pendingMutations;
    this.pendingMutations = [];

    try {
      // Collect removed and added nodes
      const removedNodes = new Set<Node>();
      const addedNodes = new Set<Node>();

      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          removedNodes.add(node);
          // Also add descendants
          if (node instanceof HTMLElement) {
            for (const descendant of node.querySelectorAll('*')) {
              removedNodes.add(descendant);
            }
          }
        }
        for (const node of mutation.addedNodes) {
          addedNodes.add(node);
          if (node instanceof HTMLElement) {
            for (const descendant of node.querySelectorAll('*')) {
              addedNodes.add(descendant);
            }
          }
        }
      }

      // Check tracked elements against removed nodes
      for (const [id, tracked] of this.tracked) {
        const element = tracked.ref.deref();

        // Element GC'd or disconnected
        if (!element || !element.isConnected) {
          if (tracked.status !== 'searching' && tracked.status !== 'lost') {
            this.startGracePeriod(tracked);
          }
          continue;
        }

        // Element was in removed nodes but is now back (moved)
        if (removedNodes.has(element) && addedNodes.has(element)) {
          // Element moved, update fingerprint
          const newFp = updateFingerprint(tracked.fingerprint, element, 1.0);
          tracked.fingerprint = newFp;
        }
      }

      // Find new interactive elements
      const allInteractive = getInteractiveElements(
        this.container instanceof Document
          ? this.container.body
          : this.container
      );

      // Check for new elements
      for (const element of allInteractive) {
        if (!this.isTracked(element)) {
          this.trackElement(element);
        }
      }

      // Try to match searching elements against new candidates
      await this.resolveSearchingElements(allInteractive);

      // Save to storage
      await this.saveToStorage();

      // Emit update event
      this.emitEvent({
        type: 'elements-updated',
        added: [],
        removed: [],
        updated: [],
      });
    } finally {
      this.isProcessing = false;
    }
  }

  // ===========================================================================
  // Element Tracking
  // ===========================================================================

  /**
   * Initial scan and track of interactive elements.
   */
  private async scanAndTrack(): Promise<void> {
    const elements = getInteractiveElements(
      this.container instanceof Document ? this.container.body : this.container
    );

    for (const element of elements) {
      if (!this.isTracked(element)) {
        this.trackElement(element);
      }
    }

    await this.saveToStorage();
  }

  /**
   * Track a new element.
   */
  private trackElement(element: HTMLElement): TrackedElement {
    const fingerprint = createFingerprint(element);

    const tracked: TrackedElement = {
      fingerprint,
      ref: new WeakRef(element),
      status: 'active',
      lostAt: null,
    };

    this.tracked.set(fingerprint.id, tracked);

    this.emitEvent({
      type: 'element-found',
      fingerprint,
      element,
    });

    return tracked;
  }

  /**
   * Check if an element is already tracked.
   */
  private isTracked(element: HTMLElement): boolean {
    for (const tracked of this.tracked.values()) {
      const el = tracked.ref.deref();
      if (el === element) return true;
    }
    return false;
  }

  // ===========================================================================
  // Grace Period & Re-identification
  // ===========================================================================

  /**
   * Start grace period for a potentially lost element.
   */
  private startGracePeriod(tracked: TrackedElement): void {
    tracked.status = 'searching';
    tracked.lostAt = Date.now();

    // Set timeout for grace period
    const handle = window.setTimeout(() => {
      this.searchingElements.delete(tracked.fingerprint.id);

      if (tracked.status === 'searching') {
        // Still not found - declare lost
        this.handleElementLost(tracked);
      }
    }, this.config.gracePeriodMs);

    this.searchingElements.set(tracked.fingerprint.id, handle);
  }

  /**
   * Try to resolve searching elements against available candidates.
   */
  private async resolveSearchingElements(
    candidates: HTMLElement[]
  ): Promise<void> {
    const searchingFingerprints: ElementFingerprint[] = [];

    for (const tracked of this.tracked.values()) {
      if (tracked.status === 'searching') {
        searchingFingerprints.push(tracked.fingerprint);
      }
    }

    if (searchingFingerprints.length === 0) return;

    // Match searching fingerprints against candidates
    const matches = matchAll(
      searchingFingerprints,
      candidates,
      this.config.weights,
      this.config.confidenceThreshold
    );

    // Process matches
    for (const [id, match] of matches) {
      if (match) {
        const tracked = this.tracked.get(id);
        if (tracked && tracked.status === 'searching') {
          this.handleElementMatched(tracked, match);
        }
      }
    }
  }

  /**
   * Attempt to re-identify a single element.
   */
  private attemptReidentification(
    tracked: TrackedElement
  ): MatchResult | null {
    const candidates = getInteractiveElements(
      this.container instanceof Document ? this.container.body : this.container
    );

    const match = findBestMatch(
      tracked.fingerprint,
      candidates,
      this.config.weights,
      this.config.confidenceThreshold
    );

    if (match) {
      this.handleElementMatched(tracked, match);
      return match;
    }

    return null;
  }

  /**
   * Handle successful re-identification.
   */
  private handleElementMatched(
    tracked: TrackedElement,
    match: MatchResult
  ): void {
    // Cancel grace period timeout
    const handle = this.searchingElements.get(tracked.fingerprint.id);
    if (handle) {
      clearTimeout(handle);
      this.searchingElements.delete(tracked.fingerprint.id);
    }

    const oldConfidence = tracked.fingerprint.lastMatchConfidence;

    // Update tracked element
    tracked.ref = new WeakRef(match.element);
    tracked.status = 'active';
    tracked.lostAt = null;
    tracked.fingerprint = updateFingerprint(
      tracked.fingerprint,
      match.element,
      match.confidence
    );

    this.emitEvent({
      type: 'element-matched',
      fingerprint: tracked.fingerprint,
      element: match.element,
      confidence: match.confidence,
    });

    // Emit confidence change if significant
    if (Math.abs(oldConfidence - match.confidence) > 0.1) {
      this.emitEvent({
        type: 'confidence-changed',
        fingerprint: tracked.fingerprint,
        oldConfidence,
        newConfidence: match.confidence,
      });
    }
  }

  /**
   * Handle element loss (after grace period).
   */
  private handleElementLost(tracked: TrackedElement): void {
    tracked.status = 'lost';

    this.emitEvent({
      type: 'element-lost',
      fingerprint: tracked.fingerprint,
      lastKnownText: tracked.fingerprint.textContent,
    });

    // Remove from tracked (or keep for potential re-appearance?)
    // For now, keep it so we can match if it reappears
  }

  // ===========================================================================
  // Storage
  // ===========================================================================

  /**
   * Save current state to storage.
   */
  private async saveToStorage(): Promise<void> {
    if (!this.storage) return;

    const fingerprints = Array.from(this.tracked.values())
      .filter((t) => t.status !== 'lost')
      .map((t) => t.fingerprint);

    await this.storage.saveFingerprints(fingerprints);
  }

  /**
   * Load state from storage.
   */
  private async loadFromStorage(): Promise<void> {
    if (!this.storage) return;

    const fingerprints = await this.storage.loadFingerprints();

    for (const fp of fingerprints) {
      // Create tracked entry without element reference
      // Will be matched on first mutation batch
      const tracked: TrackedElement = {
        fingerprint: fp,
        ref: new WeakRef(document.createElement('div')), // Placeholder
        status: 'searching',
        lostAt: Date.now(),
      };

      this.tracked.set(fp.id, tracked);
    }

    // Immediately try to match stored fingerprints
    if (fingerprints.length > 0) {
      const candidates = getInteractiveElements(document.body);
      await this.resolveSearchingElements(candidates);
    }
  }

  /**
   * Get current tab ID.
   */
  private async getTabId(): Promise<number | null> {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tabs[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * Emit a tracker event.
   */
  private emitEvent(event: TrackerEvent): void {
    this.dispatchEvent(
      new CustomEvent(event.type, { detail: event })
    );
  }

  /**
   * Add event listener with proper typing.
   */
  on<T extends TrackerEventType>(
    type: T,
    handler: (event: CustomEvent<Extract<TrackerEvent, { type: T }>>) => void
  ): void {
    this.addEventListener(type, handler as EventListener);
  }

  /**
   * Remove event listener.
   */
  off<T extends TrackerEventType>(
    type: T,
    handler: (event: CustomEvent<Extract<TrackerEvent, { type: T }>>) => void
  ): void {
    this.removeEventListener(type, handler as EventListener);
  }

  // ===========================================================================
  // Debug Mode
  // ===========================================================================

  /**
   * Enable or disable debug overlay.
   */
  setDebugMode(enabled: boolean): void {
    this.config.debugMode = enabled;

    if (enabled) {
      this.createDebugOverlay();
      this.updateDebugOverlay();
    } else if (this.debugOverlay) {
      this.debugOverlay.remove();
      this.debugOverlay = null;
    }
  }

  /**
   * Create debug overlay container.
   */
  private createDebugOverlay(): void {
    if (this.debugOverlay) return;

    // Create shadow DOM for CSS isolation
    const host = document.createElement('div');
    host.id = 'klaro-debug-overlay';
    host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 999999; pointer-events: none;';

    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .highlight {
        position: fixed;
        border: 2px solid;
        border-radius: 4px;
        pointer-events: none;
        transition: all 0.2s ease;
      }
      .highlight.high { border-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
      .highlight.medium { border-color: #eab308; background: rgba(234, 179, 8, 0.1); }
      .highlight.low { border-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
      .label {
        position: absolute;
        top: -20px;
        left: 0;
        font-size: 10px;
        font-family: monospace;
        padding: 2px 4px;
        border-radius: 2px;
        white-space: nowrap;
      }
      .highlight.high .label { background: #22c55e; color: white; }
      .highlight.medium .label { background: #eab308; color: black; }
      .highlight.low .label { background: #ef4444; color: white; }
    `;

    shadow.appendChild(style);

    const container = document.createElement('div');
    container.id = 'highlights';
    shadow.appendChild(container);

    document.body.appendChild(host);
    this.debugOverlay = host;
  }

  /**
   * Update debug overlay with current tracked elements.
   */
  private updateDebugOverlay(): void {
    if (!this.debugOverlay) return;

    const shadow = this.debugOverlay.shadowRoot;
    if (!shadow) return;

    const container = shadow.getElementById('highlights');
    if (!container) return;

    // Clear existing highlights
    container.innerHTML = '';

    // Add highlights for each tracked element
    for (const tracked of this.tracked.values()) {
      if (tracked.status === 'lost') continue;

      const element = tracked.ref.deref();
      if (!element || !element.isConnected) continue;

      const rect = element.getBoundingClientRect();
      const confidence = tracked.fingerprint.lastMatchConfidence;

      const highlight = document.createElement('div');
      highlight.className = `highlight ${
        confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low'
      }`;
      highlight.style.cssText = `
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
      `;

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = `${(confidence * 100).toFixed(0)}% | ${tracked.fingerprint.textContent.slice(0, 20)}`;
      highlight.appendChild(label);

      container.appendChild(highlight);
    }
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update configuration.
   */
  setConfig(config: Partial<TrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): TrackerConfig {
    return { ...this.config };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create and start an ElementTracker.
 */
export async function createTracker(
  config: Partial<TrackerConfig> = {},
  container: HTMLElement | Document = document
): Promise<ElementTracker> {
  const tracker = new ElementTracker(config);
  await tracker.start(container);
  return tracker;
}

// =============================================================================
// Re-exports
// =============================================================================

export * from './types';
export * from './fingerprint';
export * from './matcher';
export * from './similarity';
export * from './storage';
