/**
 * Unit tests for fingerprint generation functions.
 * Uses happy-dom for DOM simulation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateId,
  createFingerprint,
  getTestId,
  getVisibleText,
  normalizeText,
  buildAncestorPath,
  findNearestLandmark,
  getSiblingIndex,
  getChildIndex,
  getNeighborText,
  getImplicitRole,
  hasStableId,
  isHighEntropyClass,
  filterStableClasses,
  getStableClassString,
  getInteractiveElements,
  isInteractiveElement,
} from './fingerprint';

// =============================================================================
// Helper to create test DOM elements
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
  return container;
}

// =============================================================================
// ID Generation Tests
// =============================================================================

describe('generateId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('generates non-empty strings', () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Test ID Extraction Tests
// =============================================================================

describe('getTestId', () => {
  it('extracts data-testid', () => {
    const el = createElement('button', { 'data-testid': 'submit-btn' });
    expect(getTestId(el)).toBe('submit-btn');
  });

  it('extracts data-test', () => {
    const el = createElement('button', { 'data-test': 'submit-btn' });
    expect(getTestId(el)).toBe('submit-btn');
  });

  it('extracts data-cy', () => {
    const el = createElement('button', { 'data-cy': 'submit-btn' });
    expect(getTestId(el)).toBe('submit-btn');
  });

  it('extracts data-test-id', () => {
    const el = createElement('button', { 'data-test-id': 'submit-btn' });
    expect(getTestId(el)).toBe('submit-btn');
  });

  it('returns null when no test ID', () => {
    const el = createElement('button');
    expect(getTestId(el)).toBeNull();
  });

  it('prefers data-testid over others', () => {
    const el = createElement('button', {
      'data-testid': 'preferred',
      'data-test': 'fallback',
    });
    expect(getTestId(el)).toBe('preferred');
  });
});

// =============================================================================
// Text Extraction Tests
// =============================================================================

describe('getVisibleText', () => {
  it('extracts text content from elements', () => {
    const el = createElement('button', {}, 'Click Me');
    expect(getVisibleText(el)).toBe('Click Me');
  });

  it('handles nested text', () => {
    const el = createTree('<span><strong>Bold</strong> text</span>')
      .firstChild as HTMLElement;
    expect(getVisibleText(el)).toContain('Bold');
    expect(getVisibleText(el)).toContain('text');
  });

  it('returns placeholder for inputs', () => {
    const el = createElement('input', { placeholder: 'Enter email' });
    expect(getVisibleText(el)).toBe('Enter email');
  });

  it('returns empty string for empty elements', () => {
    const el = createElement('div');
    expect(getVisibleText(el)).toBe('');
  });
});

describe('normalizeText', () => {
  it('trims whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeText('hello   world')).toBe('hello world');
  });

  it('truncates to max length', () => {
    const longText = 'a'.repeat(200);
    expect(normalizeText(longText, 100).length).toBe(100);
  });

  it('uses default max length of 100', () => {
    const longText = 'a'.repeat(200);
    expect(normalizeText(longText).length).toBe(100);
  });
});

// =============================================================================
// Structural Analysis Tests
// =============================================================================

describe('buildAncestorPath', () => {
  it('builds path up to max depth', () => {
    const tree = createTree(`
      <div>
        <section>
          <form>
            <div>
              <button>Click</button>
            </div>
          </form>
        </section>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const path = buildAncestorPath(button);

    // Should stop at form (landmark) or reach max depth of 4
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThanOrEqual(4);
  });

  it('stops at landmark elements', () => {
    const tree = createTree(`
      <div>
        <main>
          <div>
            <button>Click</button>
          </div>
        </main>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const path = buildAncestorPath(button);

    // Should include up to main (landmark)
    const hasLandmark = path.some((a) => a.landmark === 'main');
    expect(hasLandmark).toBe(true);
  });

  it('includes ancestor info', () => {
    const tree = createTree(`
      <nav data-testid="main-nav">
        <button>Click</button>
      </nav>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const path = buildAncestorPath(button);

    expect(path.length).toBeGreaterThan(0);
    expect(path[0].tagName).toBe('nav');
    expect(path[0].testId).toBe('main-nav');
    expect(path[0].landmark).toBe('nav');
  });
});

describe('findNearestLandmark', () => {
  it('finds nav landmark', () => {
    const tree = createTree(`
      <nav>
        <ul>
          <li><a href="#">Link</a></li>
        </ul>
      </nav>
    `);
    const link = tree.querySelector('a') as HTMLElement;
    const landmark = findNearestLandmark(link);

    expect(landmark).not.toBeNull();
    expect(landmark!.tagName).toBe('nav');
  });

  it('finds landmark by role', () => {
    const tree = createTree(`
      <div role="navigation">
        <button>Menu</button>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const landmark = findNearestLandmark(button);

    expect(landmark).not.toBeNull();
    expect(landmark!.role).toBe('navigation');
  });

  it('returns null when no landmark', () => {
    const tree = createTree(`
      <div>
        <span>
          <button>Click</button>
        </span>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const landmark = findNearestLandmark(button);

    expect(landmark).toBeNull();
  });

  it('includes distance', () => {
    const tree = createTree(`
      <main>
        <div>
          <div>
            <button>Click</button>
          </div>
        </div>
      </main>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const landmark = findNearestLandmark(button);

    expect(landmark).not.toBeNull();
    expect(landmark!.distanceUp).toBe(3);
  });
});

describe('getSiblingIndex', () => {
  it('returns 0 for only child', () => {
    const tree = createTree(`
      <div>
        <button>Only</button>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    expect(getSiblingIndex(button)).toBe(0);
  });

  it('returns correct index among same-tag siblings', () => {
    const tree = createTree(`
      <div>
        <button>First</button>
        <span>Separator</span>
        <button>Second</button>
        <button>Third</button>
      </div>
    `);
    const buttons = tree.querySelectorAll('button');
    expect(getSiblingIndex(buttons[0] as HTMLElement)).toBe(0);
    expect(getSiblingIndex(buttons[1] as HTMLElement)).toBe(1);
    expect(getSiblingIndex(buttons[2] as HTMLElement)).toBe(2);
  });
});

describe('getChildIndex', () => {
  it('returns absolute index among all siblings', () => {
    const tree = createTree(`
      <div>
        <span>First</span>
        <button>Second</button>
        <div>Third</div>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    expect(getChildIndex(button)).toBe(1);
  });
});

// =============================================================================
// Neighbor Context Tests
// =============================================================================

describe('getNeighborText', () => {
  it('extracts previous sibling text', () => {
    const tree = createTree(`
      <div>
        <label>Email:</label>
        <input type="text" />
      </div>
    `);
    const input = tree.querySelector('input') as HTMLElement;
    const neighbors = getNeighborText(input);

    expect(neighbors.previous).toBe('Email:');
  });

  it('extracts next sibling text', () => {
    const tree = createTree(`
      <div>
        <input type="text" />
        <span>Required</span>
      </div>
    `);
    const input = tree.querySelector('input') as HTMLElement;
    const neighbors = getNeighborText(input);

    expect(neighbors.next).toBe('Required');
  });

  it('returns null for missing siblings', () => {
    const tree = createTree(`
      <div>
        <button>Only</button>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const neighbors = getNeighborText(button);

    expect(neighbors.previous).toBeNull();
    expect(neighbors.next).toBeNull();
  });

  it('truncates long neighbor text', () => {
    const longText = 'a'.repeat(100);
    const tree = createTree(`
      <div>
        <span>${longText}</span>
        <button>Click</button>
      </div>
    `);
    const button = tree.querySelector('button') as HTMLElement;
    const neighbors = getNeighborText(button);

    expect(neighbors.previous!.length).toBeLessThanOrEqual(50);
  });
});

// =============================================================================
// ARIA Role Tests
// =============================================================================

describe('getImplicitRole', () => {
  it('returns button for button element', () => {
    const el = createElement('button');
    expect(getImplicitRole(el)).toBe('button');
  });

  it('returns link for anchor with href', () => {
    const el = createElement('a', { href: '/page' });
    expect(getImplicitRole(el)).toBe('link');
  });

  it('returns null for anchor without href', () => {
    const el = createElement('a');
    expect(getImplicitRole(el)).toBeNull();
  });

  it('returns textbox for text input', () => {
    const el = createElement('input', { type: 'text' });
    expect(getImplicitRole(el)).toBe('textbox');
  });

  it('returns checkbox for checkbox input', () => {
    const el = createElement('input', { type: 'checkbox' });
    expect(getImplicitRole(el)).toBe('checkbox');
  });

  it('returns button for submit input', () => {
    const el = createElement('input', { type: 'submit' });
    expect(getImplicitRole(el)).toBe('button');
  });

  it('returns navigation for nav element', () => {
    const el = createElement('nav');
    expect(getImplicitRole(el)).toBe('navigation');
  });
});

// =============================================================================
// ID Stability Tests
// =============================================================================

describe('hasStableId', () => {
  it('returns false for empty ID', () => {
    const el = createElement('div');
    expect(hasStableId(el)).toBe(false);
  });

  it('returns false for whitespace ID', () => {
    const el = createElement('div', { id: '   ' });
    expect(hasStableId(el)).toBe(false);
  });

  it('returns false for React-style IDs', () => {
    expect(hasStableId(createElement('div', { id: ':r0:' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: ':ra:' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: 'r:1' }))).toBe(false);
  });

  it('returns false for numeric IDs', () => {
    expect(hasStableId(createElement('div', { id: '123' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: '12345' }))).toBe(false);
  });

  it('returns false for framework-prefixed IDs', () => {
    expect(hasStableId(createElement('div', { id: 'react-123' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: 'angular-456' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: 'vue-789' }))).toBe(false);
  });

  it('returns false for auto-generated patterns', () => {
    expect(hasStableId(createElement('div', { id: 'id-1' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: 'el_2' }))).toBe(false);
    expect(hasStableId(createElement('div', { id: 'node-3' }))).toBe(false);
  });

  it('returns true for semantic IDs', () => {
    expect(hasStableId(createElement('div', { id: 'main-content' }))).toBe(true);
    expect(hasStableId(createElement('div', { id: 'header' }))).toBe(true);
    expect(hasStableId(createElement('div', { id: 'submit-button' }))).toBe(true);
    expect(hasStableId(createElement('div', { id: 'user-profile' }))).toBe(true);
  });
});

// =============================================================================
// Class Entropy Tests
// =============================================================================

describe('isHighEntropyClass', () => {
  it('detects styled-components classes', () => {
    expect(isHighEntropyClass('sc-1a2b3c')).toBe(true);
    expect(isHighEntropyClass('sc-bdVaJa')).toBe(true);
  });

  it('detects emotion classes', () => {
    expect(isHighEntropyClass('css-1563')).toBe(true);
    expect(isHighEntropyClass('css-x7d5')).toBe(true);
    expect(isHighEntropyClass('emotion-123')).toBe(true);
  });

  it('detects CSS modules patterns', () => {
    expect(isHighEntropyClass('_button_1a2b3')).toBe(true);
    expect(isHighEntropyClass('styles_header_abc123')).toBe(true);
  });

  it('detects short hash-like classes', () => {
    expect(isHighEntropyClass('a1')).toBe(true);
    expect(isHighEntropyClass('x7')).toBe(true);
  });

  it('detects hex-like classes', () => {
    expect(isHighEntropyClass('abcdef')).toBe(true);
    expect(isHighEntropyClass('1a2b3c')).toBe(true);
  });

  it('accepts semantic class names', () => {
    expect(isHighEntropyClass('btn-primary')).toBe(false);
    expect(isHighEntropyClass('nav-item')).toBe(false);
    expect(isHighEntropyClass('sidebar-toggle')).toBe(false);
    expect(isHighEntropyClass('header')).toBe(false);
    expect(isHighEntropyClass('container')).toBe(false);
  });

  it('accepts Tailwind-like utility classes', () => {
    expect(isHighEntropyClass('text-center')).toBe(false);
    expect(isHighEntropyClass('flex')).toBe(false);
    expect(isHighEntropyClass('items-center')).toBe(false);
  });
});

describe('filterStableClasses', () => {
  it('filters out high-entropy classes', () => {
    const el = createElement('div');
    el.className = 'btn-primary sc-1a2b3c css-x7d5 nav-item';
    const stable = filterStableClasses(el.classList);

    expect(stable).toContain('btn-primary');
    expect(stable).toContain('nav-item');
    expect(stable).not.toContain('sc-1a2b3c');
    expect(stable).not.toContain('css-x7d5');
  });
});

describe('getStableClassString', () => {
  it('returns space-separated stable classes', () => {
    const el = createElement('div');
    el.className = 'btn sc-abc123 primary css-xyz';
    const result = getStableClassString(el);

    expect(result).toContain('btn');
    expect(result).toContain('primary');
    expect(result).not.toContain('sc-abc123');
  });
});

// =============================================================================
// Interactive Element Detection Tests
// =============================================================================

describe('isInteractiveElement', () => {
  it('detects buttons', () => {
    expect(isInteractiveElement(createElement('button'))).toBe(true);
  });

  it('detects links with href', () => {
    expect(isInteractiveElement(createElement('a', { href: '/page' }))).toBe(true);
  });

  it('rejects links without href', () => {
    expect(isInteractiveElement(createElement('a'))).toBe(false);
  });

  it('detects inputs', () => {
    expect(isInteractiveElement(createElement('input', { type: 'text' }))).toBe(true);
    expect(isInteractiveElement(createElement('input', { type: 'checkbox' }))).toBe(true);
  });

  it('rejects hidden inputs', () => {
    expect(isInteractiveElement(createElement('input', { type: 'hidden' }))).toBe(false);
  });

  it('detects role=button', () => {
    expect(isInteractiveElement(createElement('div', { role: 'button' }))).toBe(true);
  });

  it('detects onclick', () => {
    expect(isInteractiveElement(createElement('div', { onclick: 'handler()' }))).toBe(true);
  });

  it('detects positive tabindex', () => {
    expect(isInteractiveElement(createElement('div', { tabindex: '0' }))).toBe(true);
  });

  it('rejects negative tabindex', () => {
    expect(isInteractiveElement(createElement('div', { tabindex: '-1' }))).toBe(false);
  });

  it('rejects non-interactive elements', () => {
    expect(isInteractiveElement(createElement('div'))).toBe(false);
    expect(isInteractiveElement(createElement('span'))).toBe(false);
    expect(isInteractiveElement(createElement('p'))).toBe(false);
  });
});

describe('getInteractiveElements', () => {
  it('finds all interactive elements', () => {
    const tree = createTree(`
      <div>
        <button>Click</button>
        <a href="/link">Link</a>
        <input type="text" />
        <select><option>Choose</option></select>
        <div role="button">Fake Button</div>
        <span>Not interactive</span>
      </div>
    `);

    const elements = getInteractiveElements(tree);
    expect(elements.length).toBe(5);
  });
});

// =============================================================================
// Full Fingerprint Creation Tests
// =============================================================================

describe('createFingerprint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates a complete fingerprint', () => {
    const tree = createTree(`
      <nav data-testid="main-nav">
        <button
          id="submit-btn"
          aria-label="Submit form"
          name="submit"
        >
          Submit Now
        </button>
      </nav>
    `);
    document.body.appendChild(tree);

    const button = tree.querySelector('button') as HTMLElement;
    const fp = createFingerprint(button);

    // ID
    expect(fp.id).toBeTruthy();

    // Explicit identifiers
    expect(fp.htmlId).toBe('submit-btn');

    // Semantic
    expect(fp.role).toBe('button');
    expect(fp.ariaLabel).toBe('Submit form');
    expect(fp.name).toBe('submit');

    // Content
    expect(fp.textContent).toContain('Submit Now');

    // Structural
    expect(fp.tagName).toBe('button');
    expect(fp.ancestorPath.length).toBeGreaterThan(0);

    // Neighbor context
    expect(fp.neighborText).toBeDefined();

    // Visual
    expect(fp.boundingBox).toBeDefined();
    expect(fp.aspectRatio).toBeDefined();

    // Metadata
    expect(fp.timestamp).toBeGreaterThan(0);
    expect(fp.lastMatchConfidence).toBe(1.0);
  });

  it('captures ancestor path correctly', () => {
    const tree = createTree(`
      <main>
        <section data-testid="hero">
          <div>
            <button>CTA</button>
          </div>
        </section>
      </main>
    `);
    document.body.appendChild(tree);

    const button = tree.querySelector('button') as HTMLElement;
    const fp = createFingerprint(button);

    // Should include path up to main or section
    const hasSection = fp.ancestorPath.some((a) => a.tagName === 'section');
    const hasMain = fp.ancestorPath.some((a) => a.tagName === 'main');
    expect(hasSection || hasMain).toBe(true);
  });

  it('captures nearest landmark', () => {
    const tree = createTree(`
      <form id="login-form">
        <input type="text" name="email" />
      </form>
    `);
    document.body.appendChild(tree);

    const input = tree.querySelector('input') as HTMLElement;
    const fp = createFingerprint(input);

    expect(fp.nearestLandmark).not.toBeNull();
    expect(fp.nearestLandmark!.tagName).toBe('form');
    expect(fp.nearestLandmark!.id).toBe('login-form');
  });
});
