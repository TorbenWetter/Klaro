/**
 * Accessibility Preferences
 *
 * Single source of truth for accessibility settings.
 * Used by: side panel reader view, onboarding flow.
 */

// =============================================================================
// Types
// =============================================================================

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type ContrastMode = 'normal' | 'high' | 'inverted';
export type SpacingLevel = 'normal' | 'comfortable' | 'spacious';

export interface AccessibilityPreferences {
  fontSize: FontSize;
  contrastMode: ContrastMode;
  spacingLevel: SpacingLevel;
  reducedMotion: boolean;
}

// =============================================================================
// Defaults (optimized for seniors 65+)
// =============================================================================

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontSize: 'large',
  contrastMode: 'normal',
  spacingLevel: 'comfortable',
  reducedMotion: true,
};

// =============================================================================
// Font Size Values (px for reader view)
// =============================================================================

export const FONT_SIZES: Record<FontSize, number> = {
  small: 16,
  medium: 18,
  large: 21,
  xlarge: 25,
};

// =============================================================================
// Storage (browser.storage.local)
// =============================================================================

const STORAGE_KEY = 'klaroAccessibilityPreferences';
const ONBOARDING_KEY = 'klaroOnboardingComplete';

export async function isOnboardingComplete(): Promise<boolean> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const result = await browser.storage.local.get(ONBOARDING_KEY);
      return result[ONBOARDING_KEY] === true;
    }
  } catch {
    // Running outside extension context
  }
  return false;
}

export async function setOnboardingComplete(): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [ONBOARDING_KEY]: true });
    }
  } catch {
    // Running outside extension context
  }
}

/**
 * Load preferences from browser storage.
 * Handles backward-compat migration from older preference formats.
 */
export async function loadPreferences(): Promise<AccessibilityPreferences> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const result = await browser.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        const stored = result[STORAGE_KEY] as Record<string, unknown>;
        currentPreferences = migratePreferences(stored);
        return currentPreferences;
      }
    }
  } catch {
    // Running outside extension context or storage error
  }
  return DEFAULT_PREFERENCES;
}

export async function savePreferences(prefs: AccessibilityPreferences): Promise<void> {
  currentPreferences = prefs;

  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [STORAGE_KEY]: prefs });
    }
  } catch {
    // Running outside extension context or storage error
  }
}

// =============================================================================
// Migration
// =============================================================================

function migratePreferences(stored: Record<string, unknown>): AccessibilityPreferences {
  const base = { ...DEFAULT_PREFERENCES };

  if (
    stored.fontSize &&
    ['small', 'medium', 'large', 'xlarge'].includes(stored.fontSize as string)
  ) {
    base.fontSize = stored.fontSize as FontSize;
  }
  if (
    stored.contrastMode &&
    ['normal', 'high', 'inverted'].includes(stored.contrastMode as string)
  ) {
    base.contrastMode = stored.contrastMode as ContrastMode;
  }
  if (
    stored.spacingLevel &&
    ['normal', 'comfortable', 'spacious'].includes(stored.spacingLevel as string)
  ) {
    base.spacingLevel = stored.spacingLevel as SpacingLevel;
  }
  if (typeof stored.reducedMotion === 'boolean') base.reducedMotion = stored.reducedMotion;

  // v1 backward-compat: highContrast → contrastMode
  if (typeof stored.highContrast === 'boolean' && !stored.contrastMode) {
    base.contrastMode = stored.highContrast ? 'high' : 'normal';
  }

  // v1 backward-compat: increasedSpacing → spacingLevel
  if (typeof stored.increasedSpacing === 'boolean' && !stored.spacingLevel) {
    base.spacingLevel = stored.increasedSpacing ? 'comfortable' : 'normal';
  }

  return base;
}

// =============================================================================
// Current Preferences (in-memory state)
// =============================================================================

let currentPreferences = DEFAULT_PREFERENCES;

export function getPreferences(): AccessibilityPreferences {
  return currentPreferences;
}
