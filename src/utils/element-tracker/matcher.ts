/**
 * Fuzzy Matcher
 *
 * Similo-inspired weighted multi-attribute matching algorithm.
 * Finds the best matching DOM element for a stored fingerprint.
 */

import type {
  ElementFingerprint,
  MatchResult,
  MatchDetails,
  MatchWeights,
  MatchAlgorithm,
  AncestorInfo,
} from './types';
import { DEFAULT_WEIGHTS } from './types';
import {
  textSimilarity,
  positionSimilarity,
  boundingBoxIoU,
} from './similarity';
import {
  createFingerprint,
  getTestId,
  getVisibleText,
  normalizeText,
  getNeighborText,
  getSiblingIndex,
  getImplicitRole,
  hasStableId,
  buildAncestorPath,
} from './fingerprint';

// =============================================================================
// Main Matching Functions
// =============================================================================

/**
 * Find the best matching element for a fingerprint from a list of candidates.
 *
 * @param fingerprint The stored fingerprint to match
 * @param candidates List of potential matching elements
 * @param weights Attribute weights for scoring
 * @param threshold Minimum confidence to accept a match
 * @returns Best match result, or null if no match above threshold
 */
export function findBestMatch(
  fingerprint: ElementFingerprint,
  candidates: HTMLElement[],
  weights: MatchWeights = DEFAULT_WEIGHTS,
  threshold = 0.6
): MatchResult | null {
  // Pre-filter by tag name (must match exactly)
  const filtered = filterCandidates(fingerprint, candidates);

  if (filtered.length === 0) {
    return null;
  }

  let bestMatch: MatchResult | null = null;

  for (const candidate of filtered) {
    const result = calculateConfidence(fingerprint, candidate, weights);

    if (result.confidence >= threshold) {
      if (!bestMatch || result.confidence > bestMatch.confidence) {
        bestMatch = result;
      }
    }
  }

  return bestMatch;
}

/**
 * Calculate confidence score between a fingerprint and a candidate element.
 * Returns detailed breakdown of each attribute's contribution.
 */
export function calculateConfidence(
  fingerprint: ElementFingerprint,
  candidate: HTMLElement,
  weights: MatchWeights = DEFAULT_WEIGHTS
): MatchResult {
  const candidateTag = candidate.tagName.toLowerCase();

  // PREREQUISITE: Tag must match exactly
  if (fingerprint.tagName !== candidateTag) {
    return createEmptyResult(fingerprint, candidate, 'fuzzy');
  }

  // Check for testId - exact match means perfect confidence
  const candidateTestId = getTestId(candidate);
  if (fingerprint.testId && candidateTestId) {
    if (fingerprint.testId === candidateTestId) {
      // Perfect match via testId
      return {
        fingerprint,
        element: candidate,
        confidence: 1.0,
        matchDetails: {
          identityScore: 1.0,
          semanticScore: 1.0,
          contentScore: 1.0,
          structureScore: 1.0,
          neighborScore: 1.0,
          positionScore: 1.0,
        },
        algorithm: 'exact',
      };
    } else {
      // Different testIds = definitely different elements
      return createEmptyResult(fingerprint, candidate, 'fuzzy');
    }
  }

  // Calculate individual scores
  const identityScore = calculateIdentityScore(fingerprint, candidate, weights);
  const semanticScore = calculateSemanticScore(fingerprint, candidate, weights);
  const contentScore = calculateContentScore(fingerprint, candidate, weights);
  const structureScore = calculateStructureScore(fingerprint, candidate, weights);
  const neighborScore = calculateNeighborScore(fingerprint, candidate, weights);
  const positionScore = calculatePositionScore(fingerprint, candidate, weights);

  // Calculate weighted average
  const details: MatchDetails = {
    identityScore,
    semanticScore,
    contentScore,
    structureScore,
    neighborScore,
    positionScore,
  };

  const confidence = calculateWeightedAverage(details, weights);

  return {
    fingerprint,
    element: candidate,
    confidence,
    matchDetails: details,
    algorithm: confidence >= 0.9 ? 'exact' : 'fuzzy',
  };
}

/**
 * Pre-filter candidates to reduce comparison workload.
 * Elements with different tagName are immediately excluded.
 */
export function filterCandidates(
  fingerprint: ElementFingerprint,
  candidates: HTMLElement[]
): HTMLElement[] {
  return candidates.filter(
    (el) => el.tagName.toLowerCase() === fingerprint.tagName
  );
}

// =============================================================================
// Score Calculation Functions
// =============================================================================

/**
 * Calculate identity score (testId, htmlId).
 */
function calculateIdentityScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  let score = 0;
  let maxScore = 0;

  // TestId (already handled for exact match, but partial credit if one is missing)
  if (fp.testId || getTestId(el)) {
    maxScore += weights.testId;
    const candidateTestId = getTestId(el);
    if (fp.testId && candidateTestId && fp.testId === candidateTestId) {
      score += weights.testId;
    }
    // If only one has testId, no points (but we don't penalize)
  }

  // HTML ID
  if (fp.htmlId || (hasStableId(el) && el.id)) {
    maxScore += weights.htmlId;
    if (fp.htmlId && hasStableId(el) && fp.htmlId === el.id) {
      score += weights.htmlId;
    }
  }

  return maxScore > 0 ? score / maxScore : 1; // Default to 1 if no identity attrs
}

/**
 * Calculate semantic score (role, ariaLabel, name).
 */
function calculateSemanticScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  let score = 0;
  let maxScore = 0;

  // Role
  const fpRole = fp.role;
  const elRole = el.getAttribute('role') || getImplicitRole(el);
  if (fpRole || elRole) {
    maxScore += weights.role;
    if (fpRole && elRole && fpRole === elRole) {
      score += weights.role;
    }
  }

  // Aria-label (fuzzy match)
  const fpAriaLabel = fp.ariaLabel;
  const elAriaLabel = el.getAttribute('aria-label');
  if (fpAriaLabel || elAriaLabel) {
    maxScore += weights.ariaLabel;
    if (fpAriaLabel && elAriaLabel) {
      score += weights.ariaLabel * textSimilarity(fpAriaLabel, elAriaLabel);
    }
  }

  // Name attribute
  const fpName = fp.name;
  const elName = el.getAttribute('name');
  if (fpName || elName) {
    maxScore += weights.name;
    if (fpName && elName && fpName === elName) {
      score += weights.name;
    }
  }

  return maxScore > 0 ? score / maxScore : 1;
}

/**
 * Calculate content score (textContent, placeholder, alt, href).
 */
function calculateContentScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  let score = 0;
  let maxScore = 0;

  // Text content (fuzzy match)
  if (fp.textContent) {
    maxScore += weights.textContent;
    const elText = normalizeText(getVisibleText(el), 100);
    if (elText) {
      score += weights.textContent * textSimilarity(fp.textContent, elText);
    }
  }

  // Placeholder
  const fpPlaceholder = fp.placeholder;
  const elPlaceholder = el.getAttribute('placeholder');
  if (fpPlaceholder || elPlaceholder) {
    maxScore += weights.placeholder;
    if (fpPlaceholder && elPlaceholder) {
      score +=
        weights.placeholder * textSimilarity(fpPlaceholder, elPlaceholder);
    }
  }

  // Alt text
  const fpAlt = fp.alt;
  const elAlt = el.getAttribute('alt');
  if (fpAlt || elAlt) {
    maxScore += weights.alt;
    if (fpAlt && elAlt) {
      score += weights.alt * textSimilarity(fpAlt, elAlt);
    }
  }

  // Href (exact path match)
  if (fp.href) {
    maxScore += weights.href;
    const elHref = el.getAttribute('href');
    if (elHref) {
      // Normalize and compare paths
      const fpPath = fp.href;
      const elPath = normalizePath(elHref);
      if (fpPath === elPath) {
        score += weights.href;
      } else {
        // Partial credit for similar paths
        score += weights.href * textSimilarity(fpPath, elPath);
      }
    }
  }

  return maxScore > 0 ? score / maxScore : 1;
}

/**
 * Calculate structure score (ancestorPath, siblingIndex).
 */
function calculateStructureScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  let score = 0;
  let maxScore = 0;

  // Ancestor path similarity
  if (fp.ancestorPath.length > 0) {
    maxScore += weights.ancestorPath;
    const elPath = buildAncestorPath(el);
    score += weights.ancestorPath * ancestorPathSimilarity(fp.ancestorPath, elPath);
  }

  // Sibling index
  maxScore += weights.siblingIndex;
  const elSiblingIndex = getSiblingIndex(el);
  if (fp.siblingIndex === elSiblingIndex) {
    score += weights.siblingIndex;
  } else {
    // Partial credit for nearby index
    const indexDiff = Math.abs(fp.siblingIndex - elSiblingIndex);
    if (indexDiff <= 2) {
      score += weights.siblingIndex * (1 - indexDiff * 0.25);
    }
  }

  return maxScore > 0 ? score / maxScore : 1;
}

/**
 * Calculate neighbor/isotopic score.
 */
function calculateNeighborScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  const elNeighbors = getNeighborText(el);
  let score = 0;
  let count = 0;

  // Previous sibling
  if (fp.neighborText.previous && elNeighbors.previous) {
    score += textSimilarity(fp.neighborText.previous, elNeighbors.previous);
    count++;
  }

  // Next sibling
  if (fp.neighborText.next && elNeighbors.next) {
    score += textSimilarity(fp.neighborText.next, elNeighbors.next);
    count++;
  }

  // Parent text
  if (fp.neighborText.parent && elNeighbors.parent) {
    score += textSimilarity(fp.neighborText.parent, elNeighbors.parent);
    count++;
  }

  return count > 0 ? score / count : 1;
}

/**
 * Calculate position/visual score.
 */
function calculatePositionScore(
  fp: ElementFingerprint,
  el: HTMLElement,
  weights: MatchWeights
): number {
  const elRect = el.getBoundingClientRect();
  const elBox = {
    x: elRect.x,
    y: elRect.y,
    width: elRect.width,
    height: elRect.height,
  };

  // Combine position similarity and IoU
  const posScore = positionSimilarity(fp.boundingBox, elBox);
  const iouScore = boundingBoxIoU(fp.boundingBox, elBox);

  // Weight position more than IoU (position is more reliable for identification)
  return posScore * 0.7 + iouScore * 0.3;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate weighted average of all scores.
 */
function calculateWeightedAverage(
  details: MatchDetails,
  weights: MatchWeights
): number {
  // Calculate category weights (sum of attribute weights in each category)
  const identityWeight = weights.testId + weights.htmlId;
  const semanticWeight = weights.role + weights.ariaLabel + weights.name;
  const contentWeight =
    weights.textContent + weights.placeholder + weights.alt + weights.href;
  const structureWeight = weights.ancestorPath + weights.siblingIndex;
  const neighborWeight = weights.neighborText;
  const positionWeight = weights.boundingBox;

  const totalWeight =
    identityWeight +
    semanticWeight +
    contentWeight +
    structureWeight +
    neighborWeight +
    positionWeight;

  const weightedSum =
    details.identityScore * identityWeight +
    details.semanticScore * semanticWeight +
    details.contentScore * contentWeight +
    details.structureScore * structureWeight +
    details.neighborScore * neighborWeight +
    details.positionScore * positionWeight;

  return weightedSum / totalWeight;
}

/**
 * Create an empty/zero-confidence result.
 */
function createEmptyResult(
  fingerprint: ElementFingerprint,
  element: HTMLElement,
  algorithm: MatchAlgorithm
): MatchResult {
  return {
    fingerprint,
    element,
    confidence: 0,
    matchDetails: {
      identityScore: 0,
      semanticScore: 0,
      contentScore: 0,
      structureScore: 0,
      neighborScore: 0,
      positionScore: 0,
    },
    algorithm,
  };
}

/**
 * Calculate similarity between two ancestor paths.
 */
function ancestorPathSimilarity(
  fpPath: AncestorInfo[],
  elPath: AncestorInfo[]
): number {
  if (fpPath.length === 0 && elPath.length === 0) return 1;
  if (fpPath.length === 0 || elPath.length === 0) return 0;

  // Compare paths level by level
  const minLen = Math.min(fpPath.length, elPath.length);
  let matches = 0;

  for (let i = 0; i < minLen; i++) {
    const fpAncestor = fpPath[i];
    const elAncestor = elPath[i];

    // Tag match is most important
    if (fpAncestor.tagName === elAncestor.tagName) {
      matches += 0.5;

      // Bonus for matching landmark
      if (fpAncestor.landmark && fpAncestor.landmark === elAncestor.landmark) {
        matches += 0.3;
      }

      // Bonus for matching testId
      if (fpAncestor.testId && fpAncestor.testId === elAncestor.testId) {
        matches += 0.2;
      }
    }
  }

  // Normalize by expected matches (minLen levels, up to 1.0 each)
  return matches / minLen;
}

/**
 * Normalize a URL path for comparison.
 */
function normalizePath(href: string): string {
  if (!href) return '';
  try {
    if (href.startsWith('/') || href.startsWith('#')) {
      return href.split('?')[0].split('#')[0] || href;
    }
    const url = new URL(href);
    return url.pathname;
  } catch {
    return href;
  }
}

// =============================================================================
// Batch Matching
// =============================================================================

/**
 * Match multiple fingerprints against a set of candidates.
 * Useful for re-identifying all tracked elements after a DOM update.
 */
export function matchAll(
  fingerprints: ElementFingerprint[],
  candidates: HTMLElement[],
  weights: MatchWeights = DEFAULT_WEIGHTS,
  threshold = 0.6
): Map<string, MatchResult | null> {
  const results = new Map<string, MatchResult | null>();

  // Group candidates by tag for faster filtering
  const candidatesByTag = new Map<string, HTMLElement[]>();
  for (const candidate of candidates) {
    const tag = candidate.tagName.toLowerCase();
    if (!candidatesByTag.has(tag)) {
      candidatesByTag.set(tag, []);
    }
    candidatesByTag.get(tag)!.push(candidate);
  }

  // Match each fingerprint
  for (const fp of fingerprints) {
    const tagCandidates = candidatesByTag.get(fp.tagName) || [];
    const match = findBestMatch(fp, tagCandidates, weights, threshold);
    results.set(fp.id, match);
  }

  return results;
}

/**
 * Find unmatched elements (new elements not matching any fingerprint).
 */
export function findUnmatched(
  fingerprints: ElementFingerprint[],
  candidates: HTMLElement[],
  weights: MatchWeights = DEFAULT_WEIGHTS,
  threshold = 0.6
): HTMLElement[] {
  const matched = new Set<HTMLElement>();

  for (const fp of fingerprints) {
    const match = findBestMatch(fp, candidates, weights, threshold);
    if (match) {
      matched.add(match.element);
    }
  }

  return candidates.filter((el) => !matched.has(el));
}
