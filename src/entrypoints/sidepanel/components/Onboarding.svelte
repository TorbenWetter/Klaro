<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type {
    AccessibilityPreferences,
    FontSize,
    ContrastMode,
    SpacingLevel,
  } from '../../../utils/accessibility-preferences';
  import {
    DEFAULT_PREFERENCES,
    FONT_SIZES,
    savePreferences,
    setOnboardingComplete,
  } from '../../../utils/accessibility-preferences';

  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  let step = $state(0);
  let preferences = $state<AccessibilityPreferences>({ ...DEFAULT_PREFERENCES });

  const steps = [
    { id: 'welcome', title: 'Welcome to Klaro' },
    { id: 'fontSize', title: 'Which text size do you prefer?' },
    { id: 'spacing', title: 'Which spacing do you prefer?' },
    { id: 'contrast', title: 'Which contrast do you prefer?' },
    { id: 'complete', title: "You're all set!" },
  ];

  const totalSteps = steps.length;
  const currentStep = $derived(steps[step]);
  const isFirstStep = $derived(step === 0);
  const isLastStep = $derived(step === totalSteps - 1);

  const fontSizeOptions: { value: FontSize; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
    { value: 'xlarge', label: 'Huge' },
  ];

  const spacingOptions: { value: SpacingLevel; label: string; letterSpacing: string }[] = [
    { value: 'normal', label: 'Normal', letterSpacing: 'normal' },
    { value: 'comfortable', label: 'Comfortable', letterSpacing: '0.02em' },
    { value: 'spacious', label: 'Spacious', letterSpacing: '0.05em' },
  ];

  const contrastOptions: { value: ContrastMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'inverted', label: 'Inverted' },
  ];

  function goBack(): void {
    if (step > 0) step--;
  }

  function goNext(): void {
    if (step < totalSteps - 1) step++;
  }

  async function finish(): Promise<void> {
    await savePreferences(preferences);
    await setOnboardingComplete();
    onComplete();
  }

  function selectFontSize(size: FontSize): void {
    preferences.fontSize = size;
  }

  function selectSpacing(level: SpacingLevel): void {
    preferences.spacingLevel = level;
  }

  function selectContrast(mode: ContrastMode): void {
    preferences.contrastMode = mode;
  }
</script>

<div class="onboarding">
  <div class="content-area">
    <div class="step-content">
      {#if currentStep.id === 'welcome'}
        <div class="welcome-step">
          <img src="/Klaro_Logo_Yellow.svg" alt="Klaro" class="logo" />
          <h1 class="title">Welcome to Klaro</h1>
          <p class="description">
            Let's personalize your reading experience. We'll ask a few questions to set up your
            reader view.
          </p>
        </div>
      {:else if currentStep.id === 'fontSize'}
        <h1
          class="step-title"
          style="font-size: {FONT_SIZES[preferences.fontSize]}px; transition: font-size 0.2s ease;"
        >
          {currentStep.title}
        </h1>
        <div class="options">
          {#each fontSizeOptions as option}
            <button
              class="option-pill"
              class:selected={preferences.fontSize === option.value}
              onclick={() => selectFontSize(option.value)}
            >
              <span class="option-label" style="font-size: {FONT_SIZES[option.value]}px">
                {option.label}
              </span>
            </button>
          {/each}
        </div>
      {:else if currentStep.id === 'spacing'}
        <h1
          class="step-title"
          style="letter-spacing: {spacingOptions.find((o) => o.value === preferences.spacingLevel)
            ?.letterSpacing ?? 'normal'}; transition: letter-spacing 0.2s ease;"
        >
          {currentStep.title}
        </h1>
        <div class="options">
          {#each spacingOptions as option}
            <button
              class="option-pill"
              class:selected={preferences.spacingLevel === option.value}
              onclick={() => selectSpacing(option.value)}
            >
              <span class="option-label" style="letter-spacing: {option.letterSpacing};">
                {option.label}
              </span>
            </button>
          {/each}
        </div>
      {:else if currentStep.id === 'contrast'}
        <div
          class="contrast-preview-area"
          class:high-contrast={preferences.contrastMode === 'high'}
          class:inverted-contrast={preferences.contrastMode === 'inverted'}
          style="transition: background-color 0.2s ease, color 0.2s ease, filter 0.2s ease;"
        >
          <h1 class="step-title contrast-title">{currentStep.title}</h1>
          <div class="options">
            {#each contrastOptions as option}
              <button
                class="option-pill"
                class:selected={preferences.contrastMode === option.value}
                class:contrast-pill={true}
                onclick={() => selectContrast(option.value)}
              >
                <span class="option-label">{option.label}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else if currentStep.id === 'complete'}
        <div class="complete-step">
          <div class="checkmark">&#10003;</div>
          <h1 class="title">{currentStep.title}</h1>
          <p class="description">
            Your reading preferences have been saved. Tap the gear icon anytime to adjust them.
          </p>
        </div>
      {/if}
    </div>
  </div>

  <div class="footer">
    {#if !isFirstStep}
      <button class="nav-btn" onclick={goBack}>
        <ChevronLeft size={20} strokeWidth={2} />
        <span>Back</span>
      </button>
    {:else}
      <div></div>
    {/if}

    {#if isLastStep}
      <button class="nav-btn primary" onclick={finish}>
        <span>Get Started</span>
      </button>
    {:else}
      <button class="nav-btn" onclick={goNext}>
        <span>Next</span>
        <ChevronRight size={20} strokeWidth={2} />
      </button>
    {/if}
  </div>
</div>

<style>
  .onboarding {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #ffffff;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .step-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 24px;
  }

  .step-content:has(.contrast-preview-area) {
    padding: 0;
  }

  .step-title {
    font-size: 16px;
    font-weight: 300;
    color: #000000;
    text-align: center;
    margin-bottom: 48px;
  }

  .welcome-step,
  .complete-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }

  .logo {
    width: 64px;
    height: 64px;
    margin-bottom: 8px;
  }

  .title {
    font-size: 24px;
    font-weight: 500;
    color: #000000;
    margin: 0;
  }

  .description {
    font-size: 16px;
    color: #666666;
    max-width: 280px;
    line-height: 1.5;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    max-width: 280px;
  }

  .option-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 24px;
    border: 2px solid #8b8b8b;
    border-radius: 999px;
    background: none;
    color: #8b8b8b;
    font-family: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
  }

  .option-pill:hover {
    border-color: #666666;
    color: #666666;
  }

  .option-pill.selected {
    border-color: #000000;
    color: #000000;
  }

  .option-label {
    font-weight: 500;
    white-space: nowrap;
  }

  /* Contrast preview area */
  .contrast-preview-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 24px;
    background: #ffffff;
  }

  .contrast-preview-area.high-contrast {
    background: #000000;
  }

  .contrast-preview-area.inverted-contrast {
    background: #1a1a1a;
    filter: invert(1) hue-rotate(180deg);
  }

  .contrast-preview-area .step-title {
    color: #000000;
  }

  .contrast-preview-area.high-contrast .step-title {
    color: #ffffff;
  }

  .contrast-preview-area .option-pill.contrast-pill {
    border-color: #8b8b8b;
    color: #8b8b8b;
  }

  .contrast-preview-area .option-pill.contrast-pill:hover {
    border-color: #666666;
    color: #666666;
  }

  .contrast-preview-area .option-pill.contrast-pill.selected {
    border-color: #000000;
    color: #000000;
  }

  .contrast-preview-area.high-contrast .option-pill.contrast-pill {
    border-color: #666666;
    color: #666666;
  }

  .contrast-preview-area.high-contrast .option-pill.contrast-pill:hover {
    border-color: #999999;
    color: #999999;
  }

  .contrast-preview-area.high-contrast .option-pill.contrast-pill.selected {
    border-color: #ffffff;
    color: #ffffff;
  }

  .checkmark {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #22c55e;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: bold;
    margin-bottom: 8px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px;
    padding-bottom: 48px;
    background: #000000;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    background: transparent;
    border: none;
    color: #ffffff;
    font-family: inherit;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
  }

  .nav-btn:hover {
    opacity: 0.8;
  }

  .nav-btn.primary {
    background: var(--brand, #e9ff70);
    color: #000000;
    padding: 12px 24px;
    border-radius: 8px;
  }

  .nav-btn.primary:hover {
    opacity: 0.9;
  }
</style>
