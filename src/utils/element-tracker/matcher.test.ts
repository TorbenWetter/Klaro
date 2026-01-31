/**
 * Unit tests for matcher functions.
 * Tests the weighted multi-attribute matching algorithm.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  findBestMatch,
  calculateConfidence,
  filterCandidates,
  matchAll,
  findUnmatched,
} from './matcher';
import { createFingerprint } from './fingerprint';
import type { ElementFingerprint, MatchWeights } from './types';
import { DEFAULT_WEIGHTS } from './types';

// =============================================================================
// Test Helpers
// =============================================================================

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  textContent = ''
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  if (textContent) {
    element.textContent = textContent;
  }
  return element;
}

function createTree(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function createMockFingerprint(
  overrides: Partial<ElementFingerprint> = {}
): ElementFingerprint {
  return {
    id: 'test-id',
    testId: null,
    htmlId: null,
    role: 'button',
    ariaLabel: null,
    name: null,
    textContent: 'Click Me',
    placeholder: null,
    value: null,
    alt: null,
    title: null,
    href: null,
    tagName: 'button',
    inputType: null,
    ancestorPath: [],
    siblingIndex: 0,
    childIndex: 0,
    nearestLandmark: null,
    neighborText: { previous: null, next: null, parent: null },
    boundingBox: { x: 100, y: 100, width: 100, height: 40 },
    viewportPercent: { xPercent: 0.1, yPercent: 0.1 },
    aspectRatio: 2.5,
    timestamp: Date.now(),
    lastMatchConfidence: 1.0,
    ...overrides,
  };
}

// =============================================================================
// Filter Candidates Tests
// =============================================================================

describe('filterCandidates', () => {
  it('filters by tag name', () => {
    const fp = createMockFingerprint({ tagName: 'button' });
    const candidates = [
      createElement('button', {}, 'Button 1'),
      createElement('a', { href: '#' }, 'Link'),
      createElement('button', {}, 'Button 2'),
      createElement('div', {}, 'Div'),
    ];

    const filtered = filterCandidates(fp, candidates);

    expect(filtered.length).toBe(2);
    expect(filtered.every((el) => el.tagName.toLowerCase() === 'button')).toBe(
      true
    );
  });

  it('returns empty array if no matching tags', () => {
    const fp = createMockFingerprint({ tagName: 'select' });
    const candidates = [
      createElement('button', {}, 'Button'),
      createElement('input', { type: 'text' }),
    ];

    const filtered = filterCandidates(fp, candidates);

    expect(filtered.length).toBe(0);
  });
});

// =============================================================================
// Calculate Confidence Tests
// =============================================================================

describe('calculateConfidence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns 0 confidence for different tag names', () => {
    const fp = createMockFingerprint({ tagName: 'button' });
    const candidate = createElement('a', { href: '#' }, 'Link');

    const result = calculateConfidence(fp, candidate);

    expect(result.confidence).toBe(0);
  });

  it('returns 1.0 confidence for exact testId match', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      testId: 'submit-btn',
    });
    const candidate = createElement(
      'button',
      { 'data-testid': 'submit-btn' },
      'Submit'
    );

    const result = calculateConfidence(fp, candidate);

    expect(result.confidence).toBe(1.0);
    expect(result.algorithm).toBe('exact');
  });

  it('returns 0 confidence for mismatched testIds', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      testId: 'submit-btn',
    });
    const candidate = createElement(
      'button',
      { 'data-testid': 'cancel-btn' },
      'Cancel'
    );

    const result = calculateConfidence(fp, candidate);

    expect(result.confidence).toBe(0);
  });

  it('calculates high confidence for similar text content', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Submit Form',
    });
    const container = createTree('<button>Submit Form</button>');
    const candidate = container.querySelector('button') as HTMLElement;

    const result = calculateConfidence(fp, candidate);

    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.matchDetails.contentScore).toBeGreaterThan(0.9);
  });

  it('calculates moderate confidence for fuzzy text match', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Register Now',
    });
    const container = createTree('<button>Register</button>');
    const candidate = container.querySelector('button') as HTMLElement;

    const result = calculateConfidence(fp, candidate);

    // Should get partial credit for similar text
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.matchDetails.contentScore).toBeGreaterThan(0.6);
  });

  it('includes all score categories in matchDetails', () => {
    const fp = createMockFingerprint();
    const candidate = createElement('button', {}, 'Click Me');

    const result = calculateConfidence(fp, candidate);

    expect(result.matchDetails).toHaveProperty('identityScore');
    expect(result.matchDetails).toHaveProperty('semanticScore');
    expect(result.matchDetails).toHaveProperty('contentScore');
    expect(result.matchDetails).toHaveProperty('structureScore');
    expect(result.matchDetails).toHaveProperty('neighborScore');
    expect(result.matchDetails).toHaveProperty('positionScore');
  });

  it('gives high semantic score for matching roles', () => {
    const fp = createMockFingerprint({
      tagName: 'div',
      role: 'button',
    });
    const candidate = createElement('div', { role: 'button' }, 'Click');

    const result = calculateConfidence(fp, candidate);

    expect(result.matchDetails.semanticScore).toBeGreaterThan(0.8);
  });

  it('handles aria-label matching', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      ariaLabel: 'Close dialog',
    });
    const candidate = createElement(
      'button',
      { 'aria-label': 'Close dialog' },
      'X'
    );

    const result = calculateConfidence(fp, candidate);

    expect(result.matchDetails.semanticScore).toBeGreaterThan(0.8);
  });

  it('gives position score for nearby elements', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      boundingBox: { x: 100, y: 100, width: 100, height: 40 },
    });
    const container = createTree('<button>Click</button>');
    const candidate = container.querySelector('button') as HTMLElement;
    // In tests, getBoundingClientRect returns 0,0,0,0 by default

    const result = calculateConfidence(fp, candidate);

    // Position score will be based on distance from stored position
    expect(typeof result.matchDetails.positionScore).toBe('number');
  });
});

// =============================================================================
// Find Best Match Tests
// =============================================================================

describe('findBestMatch', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds exact match by testId', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      testId: 'unique-btn',
      textContent: 'Old Text',
    });
    const candidates = [
      createElement('button', { 'data-testid': 'other-btn' }, 'Other'),
      createElement('button', { 'data-testid': 'unique-btn' }, 'New Text'),
      createElement('button', {}, 'No ID'),
    ];

    const match = findBestMatch(fp, candidates);

    expect(match).not.toBeNull();
    expect(match!.confidence).toBe(1.0);
    expect(match!.element.getAttribute('data-testid')).toBe('unique-btn');
  });

  it('returns null when no candidates match threshold', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Specific Button Text',
    });
    const candidates = [
      createElement('button', {}, 'Completely Different'),
      createElement('button', {}, 'Also Different'),
    ];

    const match = findBestMatch(fp, candidates, DEFAULT_WEIGHTS, 0.9);

    expect(match).toBeNull();
  });

  it('returns null when no candidates have matching tag', () => {
    const fp = createMockFingerprint({ tagName: 'select' });
    const candidates = [
      createElement('button', {}, 'Button'),
      createElement('a', { href: '#' }, 'Link'),
    ];

    const match = findBestMatch(fp, candidates);

    expect(match).toBeNull();
  });

  it('selects highest confidence match', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Submit Form',
      ariaLabel: 'Submit the form',
    });
    const candidates = [
      createElement('button', {}, 'Cancel'),
      createElement(
        'button',
        { 'aria-label': 'Submit the form' },
        'Submit Form'
      ),
      createElement('button', {}, 'Submit'),
    ];

    const match = findBestMatch(fp, candidates, DEFAULT_WEIGHTS, 0.5);

    expect(match).not.toBeNull();
    // The second button should match best (has both text and aria-label)
    expect(match!.element.textContent).toBe('Submit Form');
  });

  it('respects custom threshold', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Submit',
    });
    const candidates = [createElement('button', {}, 'Submit')];

    // With very high threshold
    const highThreshold = findBestMatch(fp, candidates, DEFAULT_WEIGHTS, 0.99);

    // With normal threshold
    const normalThreshold = findBestMatch(fp, candidates, DEFAULT_WEIGHTS, 0.6);

    // High threshold might not match, normal should
    expect(normalThreshold).not.toBeNull();
  });

  it('handles empty candidates array', () => {
    const fp = createMockFingerprint();
    const match = findBestMatch(fp, []);

    expect(match).toBeNull();
  });
});

// =============================================================================
// Match All Tests
// =============================================================================

describe('matchAll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('matches multiple fingerprints', () => {
    const fp1 = createMockFingerprint({
      id: 'fp-1',
      tagName: 'button',
      testId: 'btn-1',
    });
    const fp2 = createMockFingerprint({
      id: 'fp-2',
      tagName: 'button',
      testId: 'btn-2',
    });

    const candidates = [
      createElement('button', { 'data-testid': 'btn-1' }, 'Button 1'),
      createElement('button', { 'data-testid': 'btn-2' }, 'Button 2'),
      createElement('button', { 'data-testid': 'btn-3' }, 'Button 3'),
    ];

    const results = matchAll([fp1, fp2], candidates);

    expect(results.size).toBe(2);
    expect(results.get('fp-1')).not.toBeNull();
    expect(results.get('fp-2')).not.toBeNull();
    expect(results.get('fp-1')!.confidence).toBe(1.0);
    expect(results.get('fp-2')!.confidence).toBe(1.0);
  });

  it('returns null for unmatched fingerprints', () => {
    const fp = createMockFingerprint({
      id: 'fp-missing',
      tagName: 'select',
    });

    const candidates = [
      createElement('button', {}, 'Button'),
      createElement('input', { type: 'text' }),
    ];

    const results = matchAll([fp], candidates);

    expect(results.get('fp-missing')).toBeNull();
  });
});

// =============================================================================
// Find Unmatched Tests
// =============================================================================

describe('findUnmatched', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds elements not matching any fingerprint', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      testId: 'known-btn',
    });

    const candidates = [
      createElement('button', { 'data-testid': 'known-btn' }, 'Known'),
      createElement('button', { 'data-testid': 'new-btn' }, 'New'),
      createElement('input', { type: 'text' }),
    ];

    const unmatched = findUnmatched([fp], candidates);

    // Should include the new button and input (input doesn't match tag)
    expect(unmatched.length).toBe(2);
    expect(unmatched.some((el) => el.getAttribute('data-testid') === 'new-btn')).toBe(
      true
    );
  });

  it('returns all elements when no fingerprints provided', () => {
    const candidates = [
      createElement('button', {}, 'Button 1'),
      createElement('button', {}, 'Button 2'),
    ];

    const unmatched = findUnmatched([], candidates);

    expect(unmatched.length).toBe(2);
  });

  it('returns empty array when all elements matched', () => {
    const fp1 = createMockFingerprint({
      id: 'fp-1',
      tagName: 'button',
      testId: 'btn-1',
    });
    const fp2 = createMockFingerprint({
      id: 'fp-2',
      tagName: 'button',
      testId: 'btn-2',
    });

    const candidates = [
      createElement('button', { 'data-testid': 'btn-1' }, 'Button 1'),
      createElement('button', { 'data-testid': 'btn-2' }, 'Button 2'),
    ];

    const unmatched = findUnmatched([fp1, fp2], candidates);

    expect(unmatched.length).toBe(0);
  });
});

// =============================================================================
// Weight Customization Tests
// =============================================================================

describe('custom weights', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('respects custom weights for scoring', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Submit',
      ariaLabel: 'Submit form',
    });

    const candidate = createElement(
      'button',
      { 'aria-label': 'Submit form' },
      'Different Text'
    );

    // With high ariaLabel weight
    const highAriaWeights: MatchWeights = {
      ...DEFAULT_WEIGHTS,
      ariaLabel: 5.0, // Boost aria-label
      textContent: 0.1, // Reduce text importance
    };

    const resultHighAria = calculateConfidence(fp, candidate, highAriaWeights);

    // With high textContent weight
    const highTextWeights: MatchWeights = {
      ...DEFAULT_WEIGHTS,
      ariaLabel: 0.1,
      textContent: 5.0,
    };

    const resultHighText = calculateConfidence(fp, candidate, highTextWeights);

    // High aria weight should give better score (aria matches, text doesn't)
    expect(resultHighAria.confidence).toBeGreaterThan(resultHighText.confidence);
  });
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('handles elements with no attributes', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Click',
    });
    const candidate = createElement('button');

    const result = calculateConfidence(fp, candidate);

    // Should not throw, just return low confidence
    expect(result.confidence).toBeDefined();
    expect(result.confidence).toBeLessThan(1);
  });

  it('handles fingerprints with missing optional fields', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      // Minimal fingerprint
      textContent: '',
      ariaLabel: null,
      testId: null,
    });
    const candidate = createElement('button', {}, 'Button');

    const result = calculateConfidence(fp, candidate);

    expect(result.confidence).toBeDefined();
  });

  it('handles very long text content', () => {
    const longText = 'a'.repeat(1000);
    const fp = createMockFingerprint({
      tagName: 'div',
      textContent: longText.slice(0, 100), // Fingerprint should be truncated
    });
    const candidate = createElement('div', {}, longText);

    const result = calculateConfidence(fp, candidate);

    // Should handle without throwing
    expect(result.confidence).toBeDefined();
  });

  it('handles special characters in text', () => {
    const fp = createMockFingerprint({
      tagName: 'button',
      textContent: 'Save & Continue →',
    });
    const candidate = createElement('button', {}, 'Save & Continue →');

    const result = calculateConfidence(fp, candidate);

    expect(result.matchDetails.contentScore).toBeGreaterThan(0.9);
  });
});

// =============================================================================
// Integration with createFingerprint Tests
// =============================================================================

describe('integration with createFingerprint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('matches element against its own fingerprint with high confidence', () => {
    const container = createTree(`
      <nav data-testid="main-nav">
        <button id="menu-btn" aria-label="Open menu">Menu</button>
      </nav>
    `);
    const button = container.querySelector('button') as HTMLElement;

    // Create fingerprint from element
    const fp = createFingerprint(button);

    // Match against same element
    const result = calculateConfidence(fp, button);

    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('matches element against similar recreated element', () => {
    // Simulate React re-render: element destroyed and recreated
    const container1 = createTree(`
      <div>
        <button data-testid="cta">Register Now</button>
      </div>
    `);
    const original = container1.querySelector('button') as HTMLElement;
    const fp = createFingerprint(original);

    // Remove original
    container1.remove();

    // Create new element (simulating re-render)
    const container2 = createTree(`
      <div>
        <button data-testid="cta">Register Now</button>
      </div>
    `);
    const recreated = container2.querySelector('button') as HTMLElement;

    // Should match via testId
    const result = calculateConfidence(fp, recreated);

    expect(result.confidence).toBe(1.0);
  });

  it('matches element with changed text but same testId', () => {
    const container1 = createTree(`
      <button data-testid="cta">Register Now</button>
    `);
    const original = container1.querySelector('button') as HTMLElement;
    const fp = createFingerprint(original);

    container1.remove();

    // Recreate with different text (simulating A/B test or rotation)
    const container2 = createTree(`
      <button data-testid="cta">Sign Up Today</button>
    `);
    const changed = container2.querySelector('button') as HTMLElement;

    // Should still match via testId
    const result = calculateConfidence(fp, changed);

    expect(result.confidence).toBe(1.0);
  });
});
