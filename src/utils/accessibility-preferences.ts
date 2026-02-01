/**
 * Accessibility Preferences
 *
 * Single source of truth for accessibility settings.
 * Used by: LLM prompts, TreeView/TreeNode styling, CSS classes, onboarding flow.
 */

// =============================================================================
// Types
// =============================================================================

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

export interface AccessibilityPreferences {
  fontSize: FontSize;
  highContrast: boolean;
  increasedSpacing: boolean;
  reducedMotion: boolean;
}

// =============================================================================
// Defaults (optimized for seniors 65+)
// =============================================================================

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontSize: 'large', // Larger text for readability
  highContrast: false, // Off by default, user can enable
  increasedSpacing: true, // Easier scanning
  reducedMotion: true, // Less distraction
};

// =============================================================================
// Font Size Values
// =============================================================================

const FONT_SIZE_PX: Record<FontSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
  xlarge: '20px',
};

const FONT_SIZE_MULTIPLIERS: Record<FontSize, number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
  xlarge: 1.25,
};

/**
 * Apply font size preference to a base size
 */
export function applyFontSize(baseSize: number, prefs: AccessibilityPreferences): number {
  return baseSize * FONT_SIZE_MULTIPLIERS[prefs.fontSize];
}

/**
 * Get spacing multiplier based on preferences
 */
export function getSpacingMultiplier(prefs: AccessibilityPreferences): number {
  return prefs.increasedSpacing ? 1.5 : 1;
}

// =============================================================================
// DOM Application
// =============================================================================

/**
 * Apply preferences to the DOM via CSS classes and custom properties.
 * Call this when preferences change or on initial load.
 */
export function applyPreferencesToDOM(prefs: AccessibilityPreferences): void {
  const root = document.documentElement;

  // Font size
  root.style.setProperty('--klaro-font-size', FONT_SIZE_PX[prefs.fontSize]);

  // Line height and letter spacing based on increased spacing
  root.style.setProperty('--klaro-line-height', prefs.increasedSpacing ? '1.8' : '1.5');
  root.style.setProperty('--klaro-letter-spacing', prefs.increasedSpacing ? '0.02em' : 'normal');

  // High contrast mode
  root.classList.toggle('high-contrast', prefs.highContrast);

  // Reduced motion
  root.classList.toggle('reduced-motion', prefs.reducedMotion);
}

// =============================================================================
// Storage (browser.storage.local)
// =============================================================================

const STORAGE_KEY = 'klaroAccessibilityPreferences';

/**
 * Load preferences from browser storage.
 * Returns defaults if not found or if running outside extension context.
 */
export async function loadPreferences(): Promise<AccessibilityPreferences> {
  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      const result = await browser.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        currentPreferences = { ...DEFAULT_PREFERENCES, ...result[STORAGE_KEY] };
        return currentPreferences;
      }
    }
  } catch {
    // Running outside extension context or storage error
  }
  return DEFAULT_PREFERENCES;
}

/**
 * Save preferences to browser storage.
 */
export async function savePreferences(prefs: AccessibilityPreferences): Promise<void> {
  currentPreferences = prefs;
  applyPreferencesToDOM(prefs);

  try {
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      await browser.storage.local.set({ [STORAGE_KEY]: prefs });
    }
  } catch {
    // Running outside extension context or storage error
  }
}

// =============================================================================
// Current Preferences (in-memory state)
// =============================================================================

let currentPreferences = DEFAULT_PREFERENCES;

export function getPreferences(): AccessibilityPreferences {
  return currentPreferences;
}

export function setPreferences(prefs: Partial<AccessibilityPreferences>): void {
  currentPreferences = { ...currentPreferences, ...prefs };
  applyPreferencesToDOM(currentPreferences);
}
