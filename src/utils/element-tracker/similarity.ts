/**
 * Similarity Algorithms for Element Matching
 *
 * Research-backed string and position similarity functions.
 * All functions are pure and return values in range [0, 1] where 1 = identical.
 */

import type { BoundingBox } from './types';

// =============================================================================
// String Similarity Algorithms
// =============================================================================

/**
 * Jaro similarity between two strings.
 * Base algorithm for Jaro-Winkler.
 *
 * @returns Similarity score 0-1
 */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Jaro-Winkler similarity for short strings.
 * ~2x faster than Levenshtein, optimized for short strings with common prefixes.
 *
 * @param a First string
 * @param b Second string
 * @param prefixScale Scaling factor for common prefix (default: 0.1)
 * @returns Similarity score 0-1 (1 = identical)
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const jaroScore = jaro(a, b);

  // Find common prefix length (max 4 chars)
  let prefixLength = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  return jaroScore + prefixLength * prefixScale * (1 - jaroScore);
}

/**
 * Sørensen-Dice coefficient using bigrams.
 * O(n) complexity, handles word reordering moderately well.
 *
 * @param a First string
 * @param b Second string
 * @returns Similarity score 0-1 (1 = identical)
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  // Generate bigrams
  const aBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    aBigrams.set(bigram, (aBigrams.get(bigram) || 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = aBigrams.get(bigram);
    if (count && count > 0) {
      aBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (a.length - 1 + (b.length - 1));
}

/**
 * Levenshtein edit distance between two strings.
 *
 * @returns Number of edits (insertions, deletions, substitutions)
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two-row optimization for memory efficiency
  let previousRow = new Array(b.length + 1);
  let currentRow = new Array(b.length + 1);

  // Initialize first row
  for (let j = 0; j <= b.length; j++) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    currentRow[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1, // deletion
        currentRow[j - 1] + 1, // insertion
        previousRow[j - 1] + cost // substitution
      );
    }

    // Swap rows
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[b.length];
}

/**
 * Levenshtein distance normalized to 0-1 similarity.
 *
 * @param a First string
 * @param b Second string
 * @returns Similarity score 0-1 (1 = identical)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Tokenize a string into lowercase words.
 */
function tokenize(str: string): string[] {
  return str
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Jaccard similarity between two sets.
 */
function jaccardSets<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  return intersection / (a.size + b.size - intersection);
}

/**
 * Token Set Ratio for multi-word labels.
 * Handles word insertions, reordering, extra punctuation.
 * "Register Now" vs "Now Register!" = high similarity.
 *
 * Based on FuzzyWuzzy's token_set_ratio algorithm.
 *
 * @param a First string
 * @param b Second string
 * @returns Similarity score 0-1 (1 = identical)
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  // Find intersection and differences
  const intersection = new Set<string>();
  const diffA = new Set<string>();
  const diffB = new Set<string>();

  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection.add(token);
    } else {
      diffA.add(token);
    }
  }

  for (const token of tokensB) {
    if (!tokensA.has(token)) {
      diffB.add(token);
    }
  }

  // Build sorted strings for comparison
  const sortedIntersection = [...intersection].sort().join(' ');
  const sortedDiffA = [...diffA].sort().join(' ');
  const sortedDiffB = [...diffB].sort().join(' ');

  const combined1 = sortedIntersection;
  const combined2 = [sortedIntersection, sortedDiffA].filter(Boolean).join(' ');
  const combined3 = [sortedIntersection, sortedDiffB].filter(Boolean).join(' ');

  // Compare the combinations
  const score1 = jaroWinkler(combined1, combined2);
  const score2 = jaroWinkler(combined1, combined3);
  const score3 = jaroWinkler(combined2, combined3);

  // Also consider Jaccard similarity as a baseline
  const jaccardScore = jaccardSets(tokensA, tokensB);

  return Math.max(score1, score2, score3, jaccardScore);
}

/**
 * Hybrid text similarity: character-based for single words, token-based for multi-word.
 * This is the primary function for comparing UI text.
 *
 * @param a First string
 * @param b Second string
 * @returns Similarity score 0-1 (1 = identical)
 */
export function textSimilarity(a: string, b: string): number {
  // Normalize
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();

  // Exact match
  if (normA === normB) return 1;

  // Empty strings
  if (normA.length === 0 || normB.length === 0) return 0;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.length === 1 && tokensB.length === 1) {
    // Single word: Jaro-Winkler (fast, prefix-aware)
    return jaroWinkler(normA, normB);
  }

  // Multi-word: Token Set Ratio (handles reordering)
  return tokenSetRatio(a, b);
}

// =============================================================================
// Position/Geometry Similarity
// =============================================================================

/**
 * IoU (Intersection over Union) for bounding box comparison.
 * Standard metric for comparing rectangles.
 *
 * @param a First bounding box
 * @param b Second bounding box
 * @returns Similarity score 0-1 (1 = perfect overlap, 0 = no overlap)
 */
export function boundingBoxIoU(a: BoundingBox, b: BoundingBox): number {
  // Calculate intersection
  const xInter1 = Math.max(a.x, b.x);
  const yInter1 = Math.max(a.y, b.y);
  const xInter2 = Math.min(a.x + a.width, b.x + b.width);
  const yInter2 = Math.min(a.y + a.height, b.y + b.height);

  // No intersection
  if (xInter2 < xInter1 || yInter2 < yInter1) return 0;

  const intersectionArea = (xInter2 - xInter1) * (yInter2 - yInter1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  if (unionArea === 0) return 0;
  return intersectionArea / unionArea;
}

/**
 * Position proximity with threshold (Similo recommendation: 100px).
 * Elements more than threshold pixels apart get 0 similarity.
 *
 * @param a First bounding box
 * @param b Second bounding box
 * @param threshold Maximum distance for any similarity (default: 100px)
 * @returns Similarity score 0-1 (1 = same position, 0 = far apart)
 */
export function positionSimilarity(
  a: BoundingBox,
  b: BoundingBox,
  threshold = 100
): number {
  // Calculate Euclidean distance between top-left corners
  const dist = Math.hypot(a.x - b.x, a.y - b.y);

  if (dist >= threshold) return 0;
  return 1 - dist / threshold;
}

/**
 * Size similarity based on area ratio.
 * Handles cases where elements scale proportionally.
 *
 * @param a First bounding box
 * @param b Second bounding box
 * @returns Similarity score 0-1 (1 = same size)
 */
export function sizeSimilarity(a: BoundingBox, b: BoundingBox): number {
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;

  if (areaA === 0 && areaB === 0) return 1;
  if (areaA === 0 || areaB === 0) return 0;

  const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  return ratio;
}

/**
 * Aspect ratio similarity.
 * Elements with similar shapes score higher.
 *
 * @param a First bounding box
 * @param b Second bounding box
 * @returns Similarity score 0-1 (1 = same aspect ratio)
 */
export function aspectRatioSimilarity(a: BoundingBox, b: BoundingBox): number {
  const ratioA = a.height > 0 ? a.width / a.height : 0;
  const ratioB = b.height > 0 ? b.width / b.height : 0;

  if (ratioA === 0 && ratioB === 0) return 1;
  if (ratioA === 0 || ratioB === 0) return 0;

  const similarity = Math.min(ratioA, ratioB) / Math.max(ratioA, ratioB);
  return similarity;
}

/**
 * Combined visual similarity (position + size + aspect ratio).
 * Uses weighted average with position as primary signal.
 *
 * @param a First bounding box
 * @param b Second bounding box
 * @param positionThreshold Maximum distance for position similarity
 * @returns Similarity score 0-1
 */
export function visualSimilarity(
  a: BoundingBox,
  b: BoundingBox,
  positionThreshold = 100
): number {
  const position = positionSimilarity(a, b, positionThreshold);
  const size = sizeSimilarity(a, b);
  const aspect = aspectRatioSimilarity(a, b);

  // Weighted: position is most important, then size, then aspect ratio
  return position * 0.5 + size * 0.3 + aspect * 0.2;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize a string for comparison.
 * Lowercases, trims whitespace, collapses multiple spaces.
 */
export function normalizeString(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if two strings are semantically equal after normalization.
 */
export function stringsEqual(a: string, b: string): boolean {
  return normalizeString(a) === normalizeString(b);
}
