/**
 * Reader Content Extraction
 *
 * Wraps @mozilla/readability to extract article content from the current page.
 * Clones the document so the original DOM is not modified.
 * Pre-processes lazy-loaded images and noscript fallbacks before extraction.
 */

import { Readability } from '@mozilla/readability';

export interface ReaderContent {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  siteName: string | null;
}

/**
 * Pre-process the cloned document to recover lazy-loaded images
 * and noscript fallbacks before Readability strips them.
 */
function prepareDocument(doc: Document): void {
  // Resolve lazy-loaded images: copy data-src variants to src
  const lazyAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset'];
  for (const img of doc.querySelectorAll('img')) {
    if (!img.getAttribute('src') || img.getAttribute('src')?.startsWith('data:')) {
      for (const attr of lazyAttrs) {
        const value = img.getAttribute(attr);
        if (value) {
          if (attr === 'data-srcset') {
            img.setAttribute('srcset', value);
          } else {
            img.setAttribute('src', value);
          }
          break;
        }
      }
    }
  }

  // Unwrap <noscript> tags that contain images (common lazy-load fallback).
  // Replace the noscript with its content so Readability can see the images.
  for (const noscript of doc.querySelectorAll('noscript')) {
    const content = noscript.textContent || '';
    if (/<img\s/i.test(content)) {
      const wrapper = doc.createElement('div');
      wrapper.innerHTML = content;
      noscript.parentNode?.replaceChild(wrapper, noscript);
    }
  }

  // Convert <picture> source srcset so Readability keeps them
  for (const source of doc.querySelectorAll('picture source')) {
    const srcset = source.getAttribute('data-srcset');
    if (srcset) {
      source.setAttribute('srcset', srcset);
    }
  }
}

/**
 * Extract readable content from the current document.
 * Returns null if Readability cannot parse the page.
 */
export function extractReaderContent(): ReaderContent | null {
  const clone = document.cloneNode(true) as Document;

  prepareDocument(clone);

  const reader = new Readability(clone);
  const article = reader.parse();

  if (!article || !article.content) {
    return null;
  }

  // Resolve relative URLs in the extracted HTML against the current page
  const baseUrl = document.baseURI;
  const content = resolveRelativeUrls(article.content, baseUrl);

  return {
    title: article.title ?? '',
    byline: article.byline ?? null,
    content,
    textContent: article.textContent ?? '',
    siteName: article.siteName ?? null,
  };
}

/**
 * Resolve relative src and href attributes to absolute URLs
 * so images and links work correctly inside the side panel.
 */
function resolveRelativeUrls(html: string, baseUrl: string): string {
  // Use a temporary element to parse and fix URLs
  const container = document.createElement('div');
  container.innerHTML = html;

  for (const img of container.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      try {
        img.setAttribute('src', new URL(src, baseUrl).href);
      } catch {
        // Invalid URL, leave as-is
      }
    }
  }

  for (const a of container.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      try {
        a.setAttribute('href', new URL(href, baseUrl).href);
      } catch {
        // Invalid URL, leave as-is
      }
    }
    // Open links in new tab since we're in the side panel
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }

  return container.innerHTML;
}
