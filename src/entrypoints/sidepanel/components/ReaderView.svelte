<script lang="ts">
  import type { AccessibilityPreferences } from '../../../utils/accessibility-preferences';
  import { FONT_SIZES } from '../../../utils/accessibility-preferences';
  import type { ReaderContent } from '../../../utils/reader-extract';

  interface Props {
    content: ReaderContent;
    prefs: AccessibilityPreferences;
  }

  let { content, prefs }: Props = $props();

  const lineHeights: Record<string, number> = {
    normal: 1.6,
    comfortable: 1.8,
    spacious: 2.1,
  };

  const letterSpacings: Record<string, string> = {
    normal: 'normal',
    comfortable: '0.02em',
    spacious: '0.05em',
  };

  let fontSize = $derived(FONT_SIZES[prefs.fontSize]);
  let lineHeight = $derived(lineHeights[prefs.spacingLevel]);
  let letterSpacing = $derived(letterSpacings[prefs.spacingLevel]);

  let a11yCount = $derived(
    content.a11yContent
      ? (content.a11yContent.match(/<(p|li|h[1-6]|strong|a)\b/g) || []).length || 1
      : 0
  );
</script>

<article
  class="reader-content"
  data-klaro-contrast={prefs.contrastMode !== 'normal' ? prefs.contrastMode : undefined}
  style="
    --klaro-font-size: {fontSize}px;
    --klaro-line-height: {lineHeight};
    --klaro-letter-spacing: {letterSpacing};
  "
  class:reduced-motion={prefs.reducedMotion}
>
  {#if content.siteName}
    <p class="site-name">{content.siteName}</p>
  {/if}

  <h1 class="title">{content.title}</h1>

  {#if content.byline}
    <p class="byline">{content.byline}</p>
  {/if}

  <div class="body">
    {@html content.content}
  </div>

  {#if content.a11yContent}
    <details class="a11y-section">
      <summary>Accessibility elements ({a11yCount})</summary>
      <div class="a11y-body">
        {@html content.a11yContent}
      </div>
    </details>
  {/if}
</article>

<style>
  .reader-content {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: var(--klaro-font-size);
    line-height: var(--klaro-line-height);
    letter-spacing: var(--klaro-letter-spacing);
    color: #1a1a1a;
    padding: 24px 20px 48px;
    max-width: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .reader-content.reduced-motion :global(*) {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }

  /* High contrast */
  .reader-content[data-klaro-contrast='high'] {
    background: #000000;
    color: #ffffff;
  }

  .reader-content[data-klaro-contrast='high'] .site-name {
    color: #cccccc;
  }

  .reader-content[data-klaro-contrast='high'] .byline {
    color: #cccccc;
  }

  .reader-content[data-klaro-contrast='high'] :global(a) {
    color: #ffff00 !important;
  }

  .reader-content[data-klaro-contrast='high'] :global(a:visited) {
    color: #ff80ff !important;
  }

  /* Inverted */
  .reader-content[data-klaro-contrast='inverted'] {
    filter: invert(1) hue-rotate(180deg);
  }

  .reader-content[data-klaro-contrast='inverted'] :global(img),
  .reader-content[data-klaro-contrast='inverted'] :global(video),
  .reader-content[data-klaro-contrast='inverted'] :global(svg) {
    filter: invert(1) hue-rotate(180deg);
  }

  .site-name {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666666;
    margin: 0 0 8px;
  }

  .title {
    font-size: 1.6em;
    line-height: 1.2;
    font-weight: 700;
    margin: 0 0 12px;
    letter-spacing: -0.01em;
  }

  .byline {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 0.85em;
    color: #666666;
    margin: 0 0 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e0e0e0;
  }

  .reader-content[data-klaro-contrast='high'] .byline {
    border-bottom-color: #444444;
  }

  /* Extracted content styles */
  .body :global(p) {
    margin: 0 0 1em;
  }

  .body :global(h1),
  .body :global(h2),
  .body :global(h3),
  .body :global(h4),
  .body :global(h5),
  .body :global(h6) {
    font-weight: 700;
    line-height: 1.3;
    margin: 1.5em 0 0.5em;
  }

  .body :global(h2) {
    font-size: 1.35em;
  }

  .body :global(h3) {
    font-size: 1.15em;
  }

  .body :global(img) {
    max-width: 40%;
    height: auto;
    border-radius: 4px;
    margin: 0.75em 0;
  }

  .body :global(.img-row) {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 0.75em 0;
    margin: 0;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }

  .body :global(.img-row) :global(img) {
    flex: 0 0 auto;
    max-width: 60%;
    max-height: 240px;
    width: auto;
    height: auto;
    object-fit: contain;
    margin: 0;
    scroll-snap-align: start;
  }

  .body :global(a) {
    color: #1a5fb4;
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-right: 0.4em;
  }

  .body :global(a:hover) {
    color: #0d3b7a;
  }

  .body :global(blockquote) {
    border-left: 3px solid #cccccc;
    padding-left: 1em;
    margin: 1em 0;
    color: #555555;
    font-style: italic;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(blockquote) {
    border-left-color: #666666;
    color: #cccccc;
  }

  .body :global(ul),
  .body :global(ol) {
    padding-left: 1.5em;
    margin: 1em 0;
  }

  .body :global(li) {
    margin: 0.3em 0;
  }

  .body :global(pre) {
    background: #f5f5f5;
    padding: 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(pre) {
    background: #1a1a1a;
    color: #ffffff;
  }

  .body :global(code) {
    background: #f0f0f0;
    padding: 0.15em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(code) {
    background: #333333;
  }

  .body :global(figure) {
    margin: 1em 0;
  }

  .body :global(figcaption) {
    font-size: 0.85em;
    color: #666666;
    text-align: center;
    margin-top: 0.5em;
  }

  .body :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.9em;
  }

  .body :global(th),
  .body :global(td) {
    border: 1px solid #dddddd;
    padding: 0.5em 0.75em;
    text-align: left;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(th),
  .reader-content[data-klaro-contrast='high'] .body :global(td) {
    border-color: #555555;
  }

  .body :global(hr) {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 2em 0;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(hr) {
    border-top-color: #444444;
  }

  /* Details/Summary */
  .body :global(details) {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 0.5em 0.75em;
    margin: 1em 0;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(details) {
    border-color: #555555;
  }

  .body :global(summary) {
    font-weight: 600;
    cursor: pointer;
  }

  /* Definition Lists */
  .body :global(dl) {
    margin: 1em 0;
  }

  .body :global(dt) {
    font-weight: 700;
    margin-top: 0.5em;
  }

  .body :global(dd) {
    margin-left: 1.5em;
    margin-bottom: 0.5em;
  }

  /* Mark (highlight) */
  .body :global(mark) {
    background: #fff3b0;
    padding: 0.1em 0.2em;
    border-radius: 2px;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(mark) {
    background: #665500;
    color: #ffffff;
  }

  /* Keyboard key */
  .body :global(kbd) {
    background: #f5f5f5;
    border: 1px solid #cccccc;
    border-radius: 3px;
    padding: 0.1em 0.4em;
    font-size: 0.85em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }

  .reader-content[data-klaro-contrast='high'] .body :global(kbd) {
    background: #333333;
    border-color: #666666;
    color: #ffffff;
  }

  /* Accessibility elements section */
  .a11y-section {
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 0.5em 0.75em;
    margin: 2em 0 0;
    font-size: 0.85em;
    color: #666666;
  }

  .a11y-section summary {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-weight: 600;
    cursor: pointer;
    color: #888888;
    font-size: 0.9em;
  }

  .a11y-body {
    margin-top: 0.75em;
    padding-top: 0.75em;
    border-top: 1px solid #e0e0e0;
  }

  .a11y-body :global(p) {
    margin: 0 0 0.5em;
  }

  .a11y-body :global(a) {
    color: #1a5fb4;
    text-decoration: underline;
  }

  .reader-content[data-klaro-contrast='high'] .a11y-section {
    border-color: #555555;
    color: #999999;
  }

  .reader-content[data-klaro-contrast='high'] .a11y-section summary {
    color: #aaaaaa;
  }

  .reader-content[data-klaro-contrast='high'] .a11y-body {
    border-top-color: #555555;
  }

  .reader-content[data-klaro-contrast='high'] .a11y-body :global(a) {
    color: #ffff00;
  }
</style>
