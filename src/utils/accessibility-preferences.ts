/**
 * Accessibility Preferences
 *
 * Hardcoded defaults for accessibility styling.
 * Will be replaced with user-configurable preferences via onboarding.
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
// Defaults
// =============================================================================

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontSize: 'large', // Seniors benefit from larger text
  highContrast: true, // Better readability
  increasedSpacing: true, // Easier scanning
  reducedMotion: true, // Less distraction
};

// =============================================================================
// Font Size Multipliers
// =============================================================================

const FONT_SIZE_MULTIPLIERS: Record<FontSize, number> = {
  small: 0.875,
  medium: 1,
  large: 1.25,
  xlarge: 1.5,
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
// Current Preferences (will be replaced with store)
// =============================================================================

let currentPreferences = DEFAULT_PREFERENCES;

export function getPreferences(): AccessibilityPreferences {
  return currentPreferences;
}

export function setPreferences(prefs: Partial<AccessibilityPreferences>): void {
  currentPreferences = { ...currentPreferences, ...prefs };
}
