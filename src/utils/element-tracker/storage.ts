/**
 * Tab Storage
 *
 * Wrapper around chrome.storage.session for per-tab fingerprint persistence.
 * Uses session storage which auto-clears when browser closes.
 */

import type { ElementFingerprint, TrackerConfig } from './types';
import { DEFAULT_CONFIG } from './types';

// Storage key prefixes
const FINGERPRINT_PREFIX = 'klaro_fp_';
const CONFIG_PREFIX = 'klaro_cfg_';

/**
 * Per-tab storage for fingerprints and configuration.
 */
export class TabStorage {
  private tabId: number;
  private fingerprintKey: string;
  private configKey: string;

  constructor(tabId: number) {
    this.tabId = tabId;
    this.fingerprintKey = `${FINGERPRINT_PREFIX}${tabId}`;
    this.configKey = `${CONFIG_PREFIX}${tabId}`;
  }

  /**
   * Save fingerprints for this tab.
   */
  async saveFingerprints(fingerprints: ElementFingerprint[]): Promise<void> {
    try {
      await browser.storage.session.set({
        [this.fingerprintKey]: fingerprints,
      });
    } catch (error) {
      console.error('[Klaro] Failed to save fingerprints:', error);
    }
  }

  /**
   * Load fingerprints for this tab.
   */
  async loadFingerprints(): Promise<ElementFingerprint[]> {
    try {
      const result = await browser.storage.session.get(this.fingerprintKey);
      return (result[this.fingerprintKey] as ElementFingerprint[]) || [];
    } catch (error) {
      console.error('[Klaro] Failed to load fingerprints:', error);
      return [];
    }
  }

  /**
   * Save configuration for this tab.
   */
  async saveConfig(config: Partial<TrackerConfig>): Promise<void> {
    try {
      await browser.storage.session.set({
        [this.configKey]: config,
      });
    } catch (error) {
      console.error('[Klaro] Failed to save config:', error);
    }
  }

  /**
   * Load configuration for this tab.
   */
  async loadConfig(): Promise<TrackerConfig> {
    try {
      const result = await browser.storage.session.get(this.configKey);
      const stored = result[this.configKey] as Partial<TrackerConfig> | undefined;
      return {
        ...DEFAULT_CONFIG,
        ...stored,
      };
    } catch (error) {
      console.error('[Klaro] Failed to load config:', error);
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Clear all data for this tab.
   */
  async clear(): Promise<void> {
    try {
      await browser.storage.session.remove([
        this.fingerprintKey,
        this.configKey,
      ]);
    } catch (error) {
      console.error('[Klaro] Failed to clear storage:', error);
    }
  }

  /**
   * Get storage usage for this tab (approximate bytes).
   */
  async getUsage(): Promise<number> {
    try {
      const fingerprints = await this.loadFingerprints();
      const config = await this.loadConfig();
      const data = JSON.stringify({ fingerprints, config });
      return new Blob([data]).size;
    } catch {
      return 0;
    }
  }

  // ==========================================================================
  // Static Methods
  // ==========================================================================

  /**
   * Clean up storage for a closed tab.
   * Call this from background.ts when a tab is removed.
   */
  static async cleanupTab(tabId: number): Promise<void> {
    const storage = new TabStorage(tabId);
    await storage.clear();
    console.debug(`[Klaro] Cleaned up storage for tab ${tabId}`);
  }

  /**
   * Clean up storage for all closed tabs.
   * Useful for garbage collection of orphaned data.
   */
  static async cleanupOrphanedTabs(): Promise<void> {
    try {
      // Get all open tabs
      const tabs = await browser.tabs.query({});
      const openTabIds = new Set(tabs.map((t) => t.id).filter(Boolean));

      // Get all storage keys
      const allStorage = await browser.storage.session.get(null);
      const keysToRemove: string[] = [];

      for (const key of Object.keys(allStorage)) {
        // Check fingerprint keys
        if (key.startsWith(FINGERPRINT_PREFIX)) {
          const tabId = parseInt(key.slice(FINGERPRINT_PREFIX.length), 10);
          if (!isNaN(tabId) && !openTabIds.has(tabId)) {
            keysToRemove.push(key);
          }
        }
        // Check config keys
        if (key.startsWith(CONFIG_PREFIX)) {
          const tabId = parseInt(key.slice(CONFIG_PREFIX.length), 10);
          if (!isNaN(tabId) && !openTabIds.has(tabId)) {
            keysToRemove.push(key);
          }
        }
      }

      if (keysToRemove.length > 0) {
        await browser.storage.session.remove(keysToRemove);
        console.debug(
          `[Klaro] Cleaned up ${keysToRemove.length} orphaned storage keys`
        );
      }
    } catch (error) {
      console.error('[Klaro] Failed to cleanup orphaned tabs:', error);
    }
  }

  /**
   * Get total storage usage across all tabs.
   */
  static async getTotalUsage(): Promise<{
    bytes: number;
    tabCount: number;
    fingerprintCount: number;
  }> {
    try {
      const allStorage = await browser.storage.session.get(null);
      let bytes = 0;
      let tabCount = 0;
      let fingerprintCount = 0;
      const seenTabs = new Set<string>();

      for (const [key, value] of Object.entries(allStorage)) {
        if (key.startsWith(FINGERPRINT_PREFIX)) {
          const tabId = key.slice(FINGERPRINT_PREFIX.length);
          if (!seenTabs.has(tabId)) {
            seenTabs.add(tabId);
            tabCount++;
          }
          const fingerprints = value as ElementFingerprint[];
          fingerprintCount += fingerprints.length;
          bytes += new Blob([JSON.stringify(value)]).size;
        } else if (key.startsWith(CONFIG_PREFIX)) {
          bytes += new Blob([JSON.stringify(value)]).size;
        }
      }

      return { bytes, tabCount, fingerprintCount };
    } catch {
      return { bytes: 0, tabCount: 0, fingerprintCount: 0 };
    }
  }
}

// =============================================================================
// Fingerprint Serialization Helpers
// =============================================================================

/**
 * Serialize fingerprints for storage (strips WeakRef, etc.).
 * Fingerprints are already plain objects, but this ensures clean serialization.
 */
export function serializeFingerprints(
  fingerprints: ElementFingerprint[]
): ElementFingerprint[] {
  return fingerprints.map((fp) => ({
    ...fp,
    // Ensure all fields are serializable
    boundingBox: { ...fp.boundingBox },
    viewportPercent: { ...fp.viewportPercent },
    neighborText: { ...fp.neighborText },
    ancestorPath: fp.ancestorPath.map((a) => ({ ...a })),
    nearestLandmark: fp.nearestLandmark ? { ...fp.nearestLandmark } : null,
  }));
}

/**
 * Deserialize fingerprints from storage.
 * Validates structure and fills in missing fields with defaults.
 */
export function deserializeFingerprints(
  data: unknown
): ElementFingerprint[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.filter(isValidFingerprint).map((fp) => ({
    ...fp,
    // Ensure required fields exist
    boundingBox: fp.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
    viewportPercent: fp.viewportPercent || { xPercent: 0, yPercent: 0 },
    neighborText: fp.neighborText || { previous: null, next: null, parent: null },
    ancestorPath: fp.ancestorPath || [],
    nearestLandmark: fp.nearestLandmark || null,
  }));
}

/**
 * Type guard to validate fingerprint structure.
 */
function isValidFingerprint(obj: unknown): obj is ElementFingerprint {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const fp = obj as Record<string, unknown>;

  // Check required string fields
  if (typeof fp.id !== 'string' || typeof fp.tagName !== 'string') {
    return false;
  }

  // Check required number fields
  if (typeof fp.timestamp !== 'number') {
    return false;
  }

  return true;
}
