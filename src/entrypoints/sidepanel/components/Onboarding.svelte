<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import type {
    AccessibilityPreferences,
    FontSize,
  } from '../../../utils/accessibility-preferences';
  import {
    DEFAULT_PREFERENCES,
    applyPreferencesToDOM,
    savePreferences,
    setOnboardingComplete,
  } from '../../../utils/accessibility-preferences';

  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  // Current step (0-indexed)
  let step = $state(0);

  // Preferences being configured
  let preferences = $state<AccessibilityPreferences>({ ...DEFAULT_PREFERENCES });

  // Steps configuration
  const steps = [
    { id: 'welcome', title: 'Welcome to Klaro' },
    { id: 'fontSize', title: 'Which text size do you prefer?' },
    { id: 'spacing', title: 'Which letter spacing do you prefer?' },
    { id: 'contrast', title: 'Which contrast do you prefer?' },
    { id: 'complete', title: "You're all set!" },
  ];

  const totalSteps = steps.length;
  const currentStep = $derived(steps[step]);
  const isFirstStep = $derived(step === 0);
  const isLastStep = $derived(step === totalSteps - 1);

  // Font size options
  const fontSizeOptions: { value: FontSize; label: string; multiplier: string }[] = [
    { value: 'medium', label: 'Normal Size', multiplier: '1x' },
    { value: 'large', label: 'Large Size', multiplier: '1.2x' },
    { value: 'xlarge', label: 'Huge Size', multiplier: '1.5x' },
  ];

  function goBack(): void {
    if (step > 0) {
      step--;
    }
  }

  function goNext(): void {
    if (step < totalSteps - 1) {
      step++;
    }
  }

  async function finish(): Promise<void> {
    await savePreferences(preferences);
    await setOnboardingComplete();
    onComplete();
  }

  function selectFontSize(size: FontSize): void {
    preferences.fontSize = size;
    applyPreferencesToDOM(preferences);
  }

  function selectSpacing(increased: boolean): void {
    preferences.increasedSpacing = increased;
    applyPreferencesToDOM(preferences);
  }

  function selectContrast(high: boolean): void {
    preferences.highContrast = high;
    applyPreferencesToDOM(preferences);
  }
</script>

<div class="onboarding">
  <!-- Main content area (white/light) -->
  <div class="content-area">
    <!-- Step content -->
    <div class="step-content">
      {#if currentStep.id === 'welcome'}
        <!-- Welcome Step -->
        <div class="welcome-step">
          <img src="/Klaro_Logo_Yellow.svg" alt="Klaro" class="logo" />
          <h1 class="title">Welcome to Klaro</h1>
          <p class="description">
            Let's personalize your experience. We'll ask a few questions to make the sidebar easier
            for you to use.
          </p>
        </div>
      {:else if currentStep.id === 'fontSize'}
        <!-- Font Size Step - title changes with selection -->
        <h1
          class="step-title"
          style="font-size: {preferences.fontSize === 'medium'
            ? '16px'
            : preferences.fontSize === 'large'
              ? '20px'
              : '24px'}; transition: font-size 0.2s ease;"
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
              <span
                class="option-label"
                style="font-size: {option.value === 'medium'
                  ? '16px'
                  : option.value === 'large'
                    ? '20px'
                    : '24px'}"
              >
                {option.label} ({option.multiplier})
              </span>
            </button>
          {/each}
        </div>
      {:else if currentStep.id === 'spacing'}
        <!-- Spacing Step - title changes with selection -->
        <h1
          class="step-title"
          style="letter-spacing: {preferences.increasedSpacing
            ? '0.1em'
            : 'normal'}; transition: letter-spacing 0.2s ease;"
        >
          {currentStep.title}
        </h1>
        <div class="options">
          <button
            class="option-pill"
            class:selected={!preferences.increasedSpacing}
            onclick={() => selectSpacing(false)}
          >
            <span class="option-label">Normal Spacing</span>
          </button>
          <button
            class="option-pill"
            class:selected={preferences.increasedSpacing}
            onclick={() => selectSpacing(true)}
          >
            <span class="option-label" style="letter-spacing: 0.1em;">Increased Spacing</span>
          </button>
        </div>
      {:else if currentStep.id === 'contrast'}
        <!-- Contrast Step - background changes with selection -->
        <div
          class="contrast-preview-area"
          class:high-contrast={preferences.highContrast}
          style="transition: background-color 0.2s ease, color 0.2s ease;"
        >
          <h1 class="step-title contrast-title">{currentStep.title}</h1>
          <div class="options">
            <button
              class="option-pill"
              class:selected={!preferences.highContrast}
              class:contrast-pill={true}
              onclick={() => selectContrast(false)}
            >
              <svg class="option-icon" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="2" fill="none" />
              </svg>
              <span class="option-label">Normal Contrast</span>
            </button>
            <button
              class="option-pill"
              class:selected={preferences.highContrast}
              class:contrast-pill={true}
              onclick={() => selectContrast(true)}
            >
              <svg class="option-icon" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="10" fill="currentColor" />
              </svg>
              <span class="option-label">High Contrast</span>
            </button>
          </div>
        </div>
      {:else if currentStep.id === 'complete'}
        <!-- Complete Step -->
        <div class="complete-step">
          <div class="checkmark">✓</div>
          <h1 class="title">{currentStep.title}</h1>
          <p class="description">Your preferences have been saved. You can change them anytime.</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Footer (dark bar) -->
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

  /* Content area (white background) */
  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Step content */
  .step-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 24px;
  }

  /* When contrast step, remove padding so preview area fills */
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

  /* Welcome step */
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

  /* Options list */
  .options {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    max-width: 280px;
  }

  /* Pill-shaped option buttons */
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

  .option-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .option-label {
    font-weight: 500;
    white-space: nowrap;
  }

  /* Contrast preview area - changes background with selection */
  .contrast-preview-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 24px;
    background: #ffffff;
    border-radius: 0;
  }

  .contrast-preview-area.high-contrast {
    background: #000000;
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

  /* Complete step */
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

  /* Footer (dark bar) */
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
