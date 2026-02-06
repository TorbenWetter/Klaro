<script lang="ts">
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import type {
    AccessibilityPreferences,
    FontSize,
    ContrastMode,
    SpacingLevel,
  } from '../../../utils/accessibility-preferences';
  import { FONT_SIZES } from '../../../utils/accessibility-preferences';

  interface Props {
    prefs: AccessibilityPreferences;
    onChange: (prefs: AccessibilityPreferences) => void;
  }

  let { prefs, onChange }: Props = $props();

  function update(patch: Partial<AccessibilityPreferences>) {
    onChange({ ...prefs, ...patch });
  }

  const fontSizeOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'xlarge', label: 'Huge' },
  ];

  const spacingOptions: {
    value: SpacingLevel;
    label: string;
    letterSpacing: string;
    lineHeight: number;
  }[] = [
    { value: 'normal', label: 'Normal', letterSpacing: 'normal', lineHeight: 1.6 },
    { value: 'comfortable', label: 'Comfortable', letterSpacing: '0.02em', lineHeight: 1.8 },
    { value: 'spacious', label: 'Spacious', letterSpacing: '0.05em', lineHeight: 2.1 },
  ];

  const contrastOptions: { value: ContrastMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'inverted', label: 'Inverted' },
  ];

  let previewFontSize = $derived(FONT_SIZES[prefs.fontSize]);
  let previewSpacing = $derived(spacingOptions.find((o) => o.value === prefs.spacingLevel)!);
</script>

<div class="controls">
  <!-- Font Size -->
  <section class="setting-section">
    <h2 class="setting-label">Text Size</h2>
    <div
      class="preview-text font-preview"
      style="font-size: {previewFontSize}px; transition: font-size 0.2s ease;"
    >
      The quick brown fox jumps over the lazy dog.
    </div>
    <div class="pill-row">
      {#each fontSizeOptions as option}
        <button
          class="pill"
          class:selected={prefs.fontSize === option.value}
          onclick={() => update({ fontSize: option.value })}
        >
          <span class="pill-label" style="font-size: {FONT_SIZES[option.value] * 0.65}px">
            {option.label}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Spacing -->
  <section class="setting-section">
    <h2 class="setting-label">Spacing</h2>
    <div
      class="preview-text spacing-preview"
      style="
        letter-spacing: {previewSpacing.letterSpacing};
        line-height: {previewSpacing.lineHeight};
        transition: letter-spacing 0.2s ease, line-height 0.2s ease;
      "
    >
      Reading should feel comfortable. Good spacing helps your eyes follow each line without getting
      lost.
    </div>
    <div class="pill-row">
      {#each spacingOptions as option}
        <button
          class="pill"
          class:selected={prefs.spacingLevel === option.value}
          onclick={() => update({ spacingLevel: option.value })}
        >
          <span class="pill-label" style="letter-spacing: {option.letterSpacing};">
            {option.label}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Contrast -->
  <section class="setting-section">
    <h2 class="setting-label">Contrast</h2>
    <div
      class="contrast-preview"
      class:high-contrast={prefs.contrastMode === 'high'}
      class:inverted-contrast={prefs.contrastMode === 'inverted'}
    >
      <p class="contrast-text">This is how your text will look.</p>
      <p class="contrast-link">Links stand out clearly.</p>
    </div>
    <div class="pill-row">
      {#each contrastOptions as option}
        <button
          class="pill"
          class:selected={prefs.contrastMode === option.value}
          onclick={() => update({ contrastMode: option.value })}
        >
          <span class="pill-label">{option.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Reduced Motion -->
  <section class="setting-section">
    <div class="motion-row">
      <div class="motion-info">
        <Label for="toggle-reducedMotion" class="text-sm font-medium">Reduced Motion</Label>
        <p class="motion-desc">Disable animations</p>
      </div>
      <Switch
        id="toggle-reducedMotion"
        checked={prefs.reducedMotion}
        onCheckedChange={(checked) => update({ reducedMotion: checked })}
      />
    </div>
  </section>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .setting-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
    margin: 0;
  }

  /* Preview areas */
  .preview-text {
    font-family: Georgia, 'Times New Roman', serif;
    color: var(--foreground);
    padding: 16px;
    border-radius: 10px;
    background: var(--secondary);
    border: 1px solid var(--border);
  }

  .font-preview {
    line-height: 1.4;
  }

  .spacing-preview {
    font-size: 15px;
  }

  /* Contrast preview */
  .contrast-preview {
    padding: 16px;
    border-radius: 10px;
    background: #ffffff;
    border: 1px solid var(--border);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 15px;
    line-height: 1.6;
    transition:
      background-color 0.25s ease,
      color 0.25s ease,
      filter 0.25s ease;
  }

  .contrast-text {
    margin: 0 0 4px;
    color: #1a1a1a;
  }

  .contrast-link {
    margin: 0;
    color: #1a5fb4;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .contrast-preview.high-contrast {
    background: #000000;
    border-color: #444444;
  }

  .contrast-preview.high-contrast .contrast-text {
    color: #ffffff;
  }

  .contrast-preview.high-contrast .contrast-link {
    color: #ffff00;
  }

  .contrast-preview.inverted-contrast {
    filter: invert(1) hue-rotate(180deg);
  }

  /* Pill buttons */
  .pill-row {
    display: flex;
    gap: 8px;
  }

  .pill {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 8px;
    border: 2px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--muted-foreground);
    font-family: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s,
      background-color 0.15s;
  }

  .pill:hover {
    border-color: var(--foreground);
    color: var(--foreground);
  }

  .pill.selected {
    border-color: var(--foreground);
    background: var(--foreground);
    color: var(--background);
  }

  .pill-label {
    font-weight: 500;
    font-size: 13px;
    white-space: nowrap;
  }

  /* Motion toggle */
  .motion-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    background: var(--secondary);
    border: 1px solid var(--border);
  }

  .motion-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .motion-desc {
    font-size: 12px;
    color: var(--muted-foreground);
    margin: 0;
  }
</style>
