/**
 * Reader Content Extraction
 *
 * Custom DOM walker that extracts ALL visible content from any page.
 * Walks the live DOM, converts elements to clean semantic HTML,
 * and returns structured content for the reader view.
 */

export interface ReaderContent {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  siteName: string | null;
}

const MAX_NODES = 50_000;

/** Tags to skip entirely */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'template',
  'iframe',
  'object',
  'embed',
  'map',
  'dialog',
  'svg', // handled separately
]);

/** Tags that pass through as semantic HTML */
const SEMANTIC_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'blockquote',
  'pre',
  'code',
  'figure',
  'figcaption',
  'hr',
  'br',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
]);

/** Inline tags that pass through (with normalization) */
const INLINE_TAGS = new Set([
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'mark',
  'abbr',
  'time',
  'cite',
  'q',
  'small',
  'kbd',
]);

/** Tags that are transparent — emit children only */
const TRANSPARENT_TAGS = new Set([
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'form',
  'fieldset',
  'label',
]);

/** Lazy-load data attributes for images */
const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original'];

/** Inline tag normalization map */
const TAG_NORMALIZE: Record<string, string> = {
  b: 'strong',
  i: 'em',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isHidden(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
  // offsetParent is null for display:none, but also for body and fixed elements
  if (el.offsetParent === null) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') return false;
    // position:fixed elements have offsetParent === null naturally
    const pos = el.style.position;
    if (pos === 'fixed' || pos === 'sticky') return false;
    return true;
  }
  return false;
}

function resolveUrl(url: string, baseUrl: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function getImgSrc(img: HTMLImageElement, baseUrl: string): string | null {
  // Lazy-load recovery
  let src = img.currentSrc || img.getAttribute('src') || '';
  if (!src || src.startsWith('data:')) {
    for (const attr of LAZY_ATTRS) {
      const val = img.getAttribute(attr);
      if (val) {
        src = val;
        break;
      }
    }
  }
  // Also check data-srcset
  if ((!src || src.startsWith('data:')) && img.getAttribute('data-srcset')) {
    const srcset = img.getAttribute('data-srcset')!;
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
    if (first) src = first;
  }
  if (!src || src.startsWith('data:')) return null;
  return resolveUrl(src, baseUrl);
}

function isTrackingPixel(img: HTMLImageElement): boolean {
  const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0');
  const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0');
  return w <= 1 && h <= 1;
}

function getLabel(el: HTMLElement): string {
  // <label for="id">
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  // Wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Get the label text (excluding the input itself)
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    for (const input of clone.querySelectorAll('input, select, textarea')) {
      input.remove();
    }
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
  }
  // placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();
  // name
  const name = el.getAttribute('name');
  if (name?.trim()) return name.trim();
  return '';
}

function hasInlineBackground(el: HTMLElement): string | null {
  const style = el.getAttribute('style');
  if (!style) return null;
  if (!style.includes('background') && !style.includes('url(')) return null;
  // Extract URL from inline style
  const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return match?.[1] || null;
}

class DomWalker {
  private parts: string[] = [];
  private textParts: string[] = [];
  private nodeCount = 0;
  private baseUrl: string;
  private truncated = false;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  walk(node: Node): void {
    if (this.truncated) return;

    // Text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Don't emit whitespace-only text nodes at the top level
      if (text.trim()) {
        this.parts.push(escapeHtml(text));
        this.textParts.push(text);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    this.nodeCount++;
    if (this.nodeCount > MAX_NODES) {
      if (!this.truncated) {
        this.truncated = true;
        this.parts.push('<p><em>[Content truncated — page is very large]</em></p>');
      }
      return;
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Skip always
    if (SKIP_TAGS.has(tag)) return;

    // Handle noscript: only keep if it contains images
    if (tag === 'noscript') {
      const content = el.textContent || '';
      if (/<img\s/i.test(content)) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = content;
        this.walkChildren(wrapper);
      }
      return;
    }

    // Visibility check (skip hidden elements)
    if (isHidden(el)) return;

    // Image
    if (tag === 'img') {
      this.handleImg(el as HTMLImageElement);
      return;
    }

    // Picture: extract the resolved img
    if (tag === 'picture') {
      const img = el.querySelector('img');
      if (img) this.handleImg(img);
      return;
    }

    // Video
    if (tag === 'video') {
      this.handleVideo(el as HTMLVideoElement);
      return;
    }

    // Links
    if (tag === 'a') {
      this.handleLink(el as HTMLAnchorElement);
      return;
    }

    // Interactive elements
    if (tag === 'button') {
      const text = el.textContent?.trim();
      if (text) {
        this.parts.push(`<strong>[${escapeHtml(text)}]</strong>`);
        this.textParts.push(`[${text}]`);
      }
      return;
    }

    if (tag === 'input') {
      this.handleInput(el as HTMLInputElement);
      return;
    }

    if (tag === 'select') {
      this.handleSelect(el as HTMLSelectElement);
      return;
    }

    if (tag === 'textarea') {
      const label = getLabel(el);
      const value = (el as HTMLTextAreaElement).value || el.getAttribute('placeholder') || '';
      if (label || value) {
        this.parts.push(
          `<p>${label ? `<strong>${escapeHtml(label)}:</strong> ` : ''}${escapeHtml(value)}</p>`
        );
        this.textParts.push(`${label}: ${value}`);
      }
      return;
    }

    // Semantic tags: keep with their tag
    if (SEMANTIC_TAGS.has(tag)) {
      if (tag === 'hr' || tag === 'br') {
        this.parts.push(`<${tag}>`);
        return;
      }
      this.parts.push(`<${tag}>`);
      this.walkChildren(el);
      this.parts.push(`</${tag}>`);
      return;
    }

    // Inline tags: keep (with normalization)
    if (INLINE_TAGS.has(tag)) {
      const normalized = TAG_NORMALIZE[tag] || tag;
      this.parts.push(`<${normalized}>`);
      this.walkChildren(el);
      this.parts.push(`</${normalized}>`);
      return;
    }

    // Transparent tags: emit children only
    if (TRANSPARENT_TAGS.has(tag)) {
      this.walkChildren(el);
      return;
    }

    // Div: text-only → <p>, otherwise transparent
    if (tag === 'div') {
      // Check for background images
      const bgUrl = hasInlineBackground(el);
      if (bgUrl) {
        const resolved = resolveUrl(bgUrl, this.baseUrl);
        this.parts.push(`<img src="${escapeHtml(resolved)}" alt="">`);
      }

      // If it only contains text nodes (no child elements), wrap in <p>
      const hasChildElements = Array.from(el.childNodes).some(
        (child) => child.nodeType === Node.ELEMENT_NODE
      );
      if (!hasChildElements) {
        const text = el.textContent?.trim();
        if (text) {
          this.parts.push(`<p>${escapeHtml(text)}</p>`);
          this.textParts.push(text);
        }
      } else {
        this.walkChildren(el);
      }
      return;
    }

    // Span: unwrap (emit children)
    if (tag === 'span') {
      this.walkChildren(el);
      return;
    }

    // Fallback: treat as transparent
    this.walkChildren(el);
  }

  private walkChildren(el: Element): void {
    for (const child of el.childNodes) {
      this.walk(child);
    }
  }

  private handleImg(img: HTMLImageElement): void {
    if (isTrackingPixel(img)) return;

    const src = getImgSrc(img, this.baseUrl);
    if (!src) return;

    const alt = img.getAttribute('alt') || '';
    this.parts.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
    if (alt) this.textParts.push(alt);
  }

  private handleVideo(video: HTMLVideoElement): void {
    const poster = video.getAttribute('poster');
    const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src');
    if (poster) {
      this.parts.push(
        `<img src="${escapeHtml(resolveUrl(poster, this.baseUrl))}" alt="Video poster">`
      );
    }
    if (src) {
      const resolved = resolveUrl(src, this.baseUrl);
      this.parts.push(`<p><a href="${escapeHtml(resolved)}">[Video]</a></p>`);
    }
  }

  private handleLink(a: HTMLAnchorElement): void {
    const href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:')) {
      // Just emit children as text
      this.walkChildren(a);
      return;
    }
    const resolved = resolveUrl(href, this.baseUrl);
    this.parts.push(`<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener">`);
    this.walkChildren(a);
    this.parts.push('</a>');
  }

  private handleInput(input: HTMLInputElement): void {
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    const label = getLabel(input);

    if (type === 'hidden' || type === 'submit' || type === 'reset' || type === 'image') {
      if (type === 'submit' || type === 'reset') {
        const text = input.value || type;
        this.parts.push(`<strong>[${escapeHtml(text)}]</strong>`);
        this.textParts.push(`[${text}]`);
      }
      return;
    }

    if (type === 'checkbox') {
      const checked = input.checked ? '\u2611' : '\u2610';
      if (label) {
        this.parts.push(`<p>${checked} ${escapeHtml(label)}</p>`);
        this.textParts.push(`${checked} ${label}`);
      }
      return;
    }

    if (type === 'radio') {
      const checked = input.checked ? '\u25C9' : '\u25CB';
      if (label) {
        this.parts.push(`<p>${checked} ${escapeHtml(label)}</p>`);
        this.textParts.push(`${checked} ${label}`);
      }
      return;
    }

    // Text-like inputs
    const value = input.value || input.getAttribute('placeholder') || '';
    if (label || value) {
      this.parts.push(
        `<p>${label ? `<strong>${escapeHtml(label)}:</strong> ` : ''}${escapeHtml(value)}</p>`
      );
      this.textParts.push(`${label}: ${value}`);
    }
  }

  private handleSelect(select: HTMLSelectElement): void {
    const label = getLabel(select);
    const selected = select.options[select.selectedIndex];
    const value = selected?.textContent?.trim() || '';
    if (label || value) {
      this.parts.push(
        `<p>${label ? `<strong>${escapeHtml(label)}:</strong> ` : ''}${escapeHtml(value)}</p>`
      );
      this.textParts.push(`${label}: ${value}`);
    }
  }

  getHtml(): string {
    return this.parts.join('');
  }

  getTextContent(): string {
    return this.textParts.join(' ');
  }
}

function extractTitle(): string {
  // 1. og:title
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle?.trim()) return ogTitle.trim();

  // 2. First <h1>
  const h1 = document.querySelector('h1');
  if (h1?.textContent?.trim()) return h1.textContent.trim();

  // 3. document.title (strip site name suffix)
  if (document.title) {
    const title = document.title.replace(/\s*[\|–—-]\s*[^|–—-]*$/, '').trim();
    if (title) return title;
  }

  // 4. Hostname fallback
  return location.hostname;
}

function extractSiteName(): string | null {
  const ogSiteName = document
    .querySelector('meta[property="og:site_name"]')
    ?.getAttribute('content');
  if (ogSiteName?.trim()) return ogSiteName.trim();
  return null;
}

function extractByline(): string | null {
  // Check common meta tags
  const authorMeta =
    document.querySelector('meta[name="author"]')?.getAttribute('content') ||
    document.querySelector('meta[property="article:author"]')?.getAttribute('content');
  if (authorMeta?.trim()) return authorMeta.trim();

  // Check common byline selectors
  const bylineSelectors = ['[rel="author"]', '.author', '.byline', '[itemprop="author"]'];
  for (const sel of bylineSelectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }

  return null;
}

/**
 * Post-process the generated HTML:
 * - Strip empty elements
 * - Resolve remaining relative URLs
 * - Add target/rel to links
 */
function postProcess(html: string, baseUrl: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  // Strip empty elements (but not void elements like img, hr, br)
  const voidElements = new Set(['img', 'hr', 'br', 'input']);
  for (const el of container.querySelectorAll(
    'p, div, span, strong, em, li, h1, h2, h3, h4, h5, h6'
  )) {
    if (!el.innerHTML.trim() && !voidElements.has(el.tagName.toLowerCase())) {
      el.remove();
    }
  }

  // Resolve remaining relative URLs on images
  for (const img of container.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('blob:')) {
      try {
        img.setAttribute('src', new URL(src, baseUrl).href);
      } catch {
        // leave as-is
      }
    }
  }

  // Ensure all links have target and rel
  for (const a of container.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      try {
        a.setAttribute('href', new URL(href, baseUrl).href);
      } catch {
        // leave as-is
      }
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }

  return container.innerHTML;
}

/**
 * Extract all visible content from the current document.
 * Returns null only if the page has essentially no content.
 */
export function extractReaderContent(): ReaderContent | null {
  const baseUrl = document.baseURI;
  const walker = new DomWalker(baseUrl);

  walker.walk(document.body);

  const rawHtml = walker.getHtml();
  if (!rawHtml.trim()) return null;

  const content = postProcess(rawHtml, baseUrl);
  if (!content.trim()) return null;

  return {
    title: extractTitle(),
    byline: extractByline(),
    content,
    textContent: walker.getTextContent(),
    siteName: extractSiteName(),
  };
}
