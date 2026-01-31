/**
 * Unit tests for similarity algorithms.
 * Pure functions = easy to test without DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  jaro,
  jaroWinkler,
  diceCoefficient,
  levenshteinDistance,
  levenshteinSimilarity,
  tokenSetRatio,
  textSimilarity,
  boundingBoxIoU,
  positionSimilarity,
  sizeSimilarity,
  aspectRatioSimilarity,
  visualSimilarity,
  normalizeString,
  stringsEqual,
} from './similarity';
import type { BoundingBox } from './types';

// =============================================================================
// Jaro / Jaro-Winkler Tests
// =============================================================================

describe('jaro', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaro('hello', 'hello')).toBe(1);
    expect(jaro('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(jaro('hello', '')).toBe(0);
    expect(jaro('', 'hello')).toBe(0);
  });

  it('returns high score for similar strings', () => {
    expect(jaro('martha', 'marhta')).toBeGreaterThan(0.9);
    expect(jaro('dwayne', 'duane')).toBeGreaterThan(0.8);
  });

  it('returns low score for dissimilar strings', () => {
    expect(jaro('abc', 'xyz')).toBeLessThan(0.5);
  });
});

describe('jaroWinkler', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1);
  });

  it('boosts score for common prefix', () => {
    const jaroScore = jaro('prefix_abc', 'prefix_xyz');
    const jwScore = jaroWinkler('prefix_abc', 'prefix_xyz');
    expect(jwScore).toBeGreaterThan(jaroScore);
  });

  it('handles UI button text variations', () => {
    expect(jaroWinkler('Submit', 'Submit Now')).toBeGreaterThan(0.7);
    expect(jaroWinkler('Save', 'Save Changes')).toBeGreaterThan(0.6);
  });

  it('returns low score for completely different strings', () => {
    expect(jaroWinkler('Register', 'Contact')).toBeLessThan(0.6);
  });
});

// =============================================================================
// Dice Coefficient Tests
// =============================================================================

describe('diceCoefficient', () => {
  it('returns 1.0 for identical strings', () => {
    expect(diceCoefficient('hello', 'hello')).toBe(1);
  });

  it('returns 0 for strings shorter than 2 chars (no bigrams)', () => {
    expect(diceCoefficient('a', 'b')).toBe(0);
  });

  it('returns 1 for identical empty strings', () => {
    expect(diceCoefficient('', '')).toBe(1);
  });

  it('returns high score for similar strings', () => {
    expect(diceCoefficient('night', 'nacht')).toBeGreaterThan(0.2);
  });

  it('handles repeated bigrams correctly', () => {
    expect(diceCoefficient('aa', 'aa')).toBe(1);
    expect(diceCoefficient('aaa', 'aaa')).toBe(1);
  });
});

// =============================================================================
// Levenshtein Tests
// =============================================================================

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns string length for empty comparisons', () => {
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('counts single character changes correctly', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1); // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1); // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1); // deletion
  });

  it('counts multiple edits correctly', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 1.0 for two empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1);
  });

  it('returns normalized similarity', () => {
    // "cat" to "bat" = 1 edit, max length 3, so 1 - 1/3 = 0.666...
    expect(levenshteinSimilarity('cat', 'bat')).toBeCloseTo(0.667, 2);
  });

  it('returns 0 for completely different strings of same length', () => {
    expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
  });
});

// =============================================================================
// Token Set Ratio Tests
// =============================================================================

describe('tokenSetRatio', () => {
  it('returns 1.0 for identical strings', () => {
    expect(tokenSetRatio('hello world', 'hello world')).toBe(1);
  });

  it('handles word reordering', () => {
    expect(tokenSetRatio('Sign Up Now', 'Now Sign Up')).toBeGreaterThan(0.9);
  });

  it('handles extra words', () => {
    expect(tokenSetRatio('Submit', 'Submit Form')).toBeGreaterThan(0.6);
  });

  it('handles punctuation differences', () => {
    expect(tokenSetRatio('Click here!', 'Click here')).toBeGreaterThan(0.8);
  });

  it('returns low score for no common words', () => {
    expect(tokenSetRatio('hello world', 'foo bar')).toBeLessThan(0.5);
  });

  it('handles empty strings', () => {
    expect(tokenSetRatio('', '')).toBe(1);
    expect(tokenSetRatio('hello', '')).toBe(0);
  });
});

// =============================================================================
// Text Similarity (Hybrid) Tests
// =============================================================================

describe('textSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(textSimilarity('Submit', 'Submit')).toBe(1);
    expect(textSimilarity('Click Here', 'Click Here')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(textSimilarity('SUBMIT', 'submit')).toBe(1);
    expect(textSimilarity('Click Here', 'CLICK HERE')).toBe(1);
  });

  it('uses Jaro-Winkler for single words', () => {
    // Single word comparison should use Jaro-Winkler
    const score = textSimilarity('Submit', 'Submitting');
    expect(score).toBeGreaterThan(0.8); // Common prefix boost
  });

  it('uses token-based for multi-word labels', () => {
    // Should handle reordering well
    expect(textSimilarity('Sign Up Now', 'Now Sign Up')).toBeGreaterThan(0.9);
  });

  it('handles UI text rotation scenarios', () => {
    // Test site rotates between these
    expect(textSimilarity('Register Now', 'Join Now')).toBeGreaterThan(0.4);
    expect(textSimilarity('Sign Up', 'Get Started')).toBeLessThan(0.5);
  });

  it('returns 0 for empty strings', () => {
    expect(textSimilarity('hello', '')).toBe(0);
    expect(textSimilarity('', 'hello')).toBe(0);
  });
});

// =============================================================================
// Bounding Box IoU Tests
// =============================================================================

describe('boundingBoxIoU', () => {
  const box1: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };

  it('returns 1.0 for identical boxes', () => {
    expect(boundingBoxIoU(box1, box1)).toBe(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const box2: BoundingBox = { x: 200, y: 200, width: 100, height: 100 };
    expect(boundingBoxIoU(box1, box2)).toBe(0);
  });

  it('returns 0 for adjacent boxes (touching but not overlapping)', () => {
    const adjacent: BoundingBox = { x: 100, y: 0, width: 100, height: 100 };
    expect(boundingBoxIoU(box1, adjacent)).toBe(0);
  });

  it('calculates correct IoU for partial overlap', () => {
    // 50% overlap horizontally
    const box2: BoundingBox = { x: 50, y: 0, width: 100, height: 100 };
    // Intersection: 50x100 = 5000
    // Union: 10000 + 10000 - 5000 = 15000
    // IoU: 5000/15000 = 0.333...
    expect(boundingBoxIoU(box1, box2)).toBeCloseTo(0.333, 2);
  });

  it('handles zero-size boxes', () => {
    const zeroBox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
    expect(boundingBoxIoU(zeroBox, zeroBox)).toBe(0);
  });
});

// =============================================================================
// Position Similarity Tests
// =============================================================================

describe('positionSimilarity', () => {
  const origin: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };

  it('returns 1.0 for same position', () => {
    expect(positionSimilarity(origin, origin)).toBe(1);
  });

  it('returns 0 for positions 100+ pixels apart', () => {
    const far: BoundingBox = { x: 100, y: 0, width: 100, height: 100 };
    expect(positionSimilarity(origin, far)).toBe(0);
  });

  it('returns linear falloff within threshold', () => {
    // 50px away = 50% similarity
    const halfway: BoundingBox = { x: 50, y: 0, width: 100, height: 100 };
    expect(positionSimilarity(origin, halfway)).toBeCloseTo(0.5, 1);
  });

  it('uses Euclidean distance (diagonal)', () => {
    // 70.7px diagonal (50,50) should be ~0.29 similarity
    const diagonal: BoundingBox = { x: 50, y: 50, width: 100, height: 100 };
    const dist = Math.hypot(50, 50); // ~70.7
    expect(positionSimilarity(origin, diagonal)).toBeCloseTo(1 - dist / 100, 2);
  });

  it('supports custom threshold', () => {
    const box: BoundingBox = { x: 150, y: 0, width: 100, height: 100 };
    expect(positionSimilarity(origin, box, 100)).toBe(0);
    expect(positionSimilarity(origin, box, 200)).toBeCloseTo(0.25, 2);
  });
});

// =============================================================================
// Size Similarity Tests
// =============================================================================

describe('sizeSimilarity', () => {
  it('returns 1.0 for same size', () => {
    const box: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(sizeSimilarity(box, box)).toBe(1);
  });

  it('returns ratio for different sizes', () => {
    const small: BoundingBox = { x: 0, y: 0, width: 50, height: 50 };
    const large: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    // Area: 2500 vs 10000, ratio = 0.25
    expect(sizeSimilarity(small, large)).toBe(0.25);
  });

  it('handles zero-size boxes', () => {
    const zero: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };
    const normal: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(sizeSimilarity(zero, zero)).toBe(1);
    expect(sizeSimilarity(zero, normal)).toBe(0);
  });
});

// =============================================================================
// Aspect Ratio Similarity Tests
// =============================================================================

describe('aspectRatioSimilarity', () => {
  it('returns 1.0 for same aspect ratio', () => {
    const square: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(aspectRatioSimilarity(square, square)).toBe(1);
  });

  it('returns high score for similar ratios', () => {
    const rect1: BoundingBox = { x: 0, y: 0, width: 200, height: 100 }; // 2:1
    const rect2: BoundingBox = { x: 0, y: 0, width: 180, height: 100 }; // 1.8:1
    // 1.8/2.0 = 0.9
    expect(aspectRatioSimilarity(rect1, rect2)).toBeGreaterThanOrEqual(0.9);
  });

  it('returns low score for different ratios', () => {
    const wide: BoundingBox = { x: 0, y: 0, width: 400, height: 100 }; // 4:1
    const tall: BoundingBox = { x: 0, y: 0, width: 100, height: 400 }; // 0.25:1
    expect(aspectRatioSimilarity(wide, tall)).toBeLessThan(0.1);
  });

  it('handles zero height', () => {
    const zero: BoundingBox = { x: 0, y: 0, width: 100, height: 0 };
    const normal: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(aspectRatioSimilarity(zero, normal)).toBe(0);
  });
});

// =============================================================================
// Visual Similarity (Combined) Tests
// =============================================================================

describe('visualSimilarity', () => {
  it('returns 1.0 for identical boxes', () => {
    const box: BoundingBox = { x: 50, y: 50, width: 100, height: 100 };
    expect(visualSimilarity(box, box)).toBe(1);
  });

  it('returns weighted combination of position, size, aspect', () => {
    const box1: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const box2: BoundingBox = { x: 25, y: 25, width: 100, height: 100 };
    // Same size and aspect ratio, slightly different position
    const score = visualSimilarity(box1, box2);
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });

  it('returns low score for completely different boxes', () => {
    const box1: BoundingBox = { x: 0, y: 0, width: 100, height: 100 };
    const box2: BoundingBox = { x: 500, y: 500, width: 50, height: 200 };
    // Position: 0 (far), Size: 0.5 (50/100 area), Aspect: 0.25 (1 vs 0.25)
    // Score = 0*0.5 + 0.5*0.3 + 0.25*0.2 = 0.2
    expect(visualSimilarity(box1, box2)).toBeLessThan(0.5);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('normalizeString', () => {
  it('lowercases text', () => {
    expect(normalizeString('HELLO')).toBe('hello');
  });

  it('trims whitespace', () => {
    expect(normalizeString('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeString('hello   world')).toBe('hello world');
  });

  it('handles all transformations together', () => {
    expect(normalizeString('  HELLO   WORLD  ')).toBe('hello world');
  });
});

describe('stringsEqual', () => {
  it('returns true for identical strings', () => {
    expect(stringsEqual('hello', 'hello')).toBe(true);
  });

  it('ignores case differences', () => {
    expect(stringsEqual('Hello', 'HELLO')).toBe(true);
  });

  it('ignores whitespace differences', () => {
    expect(stringsEqual('hello world', '  hello   world  ')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(stringsEqual('hello', 'world')).toBe(false);
  });
});
