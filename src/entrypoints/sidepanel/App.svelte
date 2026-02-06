<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Settings, RotateCw, ArrowLeft } from '@lucide/svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import Onboarding from './components/Onboarding.svelte';
  import PreferenceControls from './components/PreferenceControls.svelte';
  import PageSummary from './components/PageSummary.svelte';
  import ReaderView from './components/ReaderView.svelte';
  import {
    type AccessibilityPreferences,
    DEFAULT_PREFERENCES,
    loadPreferences,
    savePreferences,
    isOnboardingComplete,
  } from '../../utils/accessibility-preferences';
  import type { ReaderContent } from '../../utils/reader-extract';

  // Onboarding state
  let showOnboarding = $state<boolean | null>(null);

  // Preferences state
  let prefs = $state<AccessibilityPreferences>({ ...DEFAULT_PREFERENCES });

  // View state
  let view = $state<'reader' | 'settings'>('reader');

  // Reader state
  let readerContent = $state<ReaderContent | null>(null);
  let loading = $state(false);
  let extractError = $state(false);

  // Scroll memory state
  let currentTabId = $state<number | null>(null);
  const MAX_SCROLL_ENTRIES = 50;
  let scrollPositions = new Map<number, number>();
  let viewportRef = $state<HTMLElement | null>(null);

  // Extraction guard — incremented on each call, stale calls bail out
  let extractionId = 0;

  async function extractContent() {
    const thisExtraction = ++extractionId;

    // Save current scroll position before switching
    if (currentTabId !== null && viewportRef) {
      scrollPositions.set(currentTabId, viewportRef.scrollTop);
    }

    // Evict oldest entries if map is too large
    if (scrollPositions.size > MAX_SCROLL_ENTRIES) {
      const oldest = scrollPositions.keys().next().value!;
      scrollPositions.delete(oldest);
    }

    loading = true;
    extractError = false;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (thisExtraction !== extractionId) return;

      if (!tab?.id) {
        readerContent = null;
        extractError = true;
        return;
      }

      currentTabId = tab.id;

      const response = (await browser.tabs.sendMessage(tab.id, {
        type: 'GET_READER_CONTENT',
      })) as { content: ReaderContent | null } | undefined;
      if (thisExtraction !== extractionId) return;

      if (response?.content) {
        readerContent = response.content;
        // Restore scroll position after content renders
        await tick();
        if (thisExtraction !== extractionId) return;
        if (viewportRef) {
          const saved = scrollPositions.get(currentTabId);
          viewportRef.scrollTop = saved ?? 0;
        }
      } else {
        readerContent = null;
        extractError = true;
      }
    } catch {
      if (thisExtraction !== extractionId) return;
      readerContent = null;
      extractError = true;
    } finally {
      if (thisExtraction === extractionId) {
        loading = false;
      }
    }
  }

  async function handlePrefsChange(updated: AccessibilityPreferences) {
    prefs = updated;
    await savePreferences(updated);
  }

  async function handleOnboardingComplete() {
    prefs = await loadPreferences();
    showOnboarding = false;
    await extractContent();
  }

  onMount(async () => {
    const onboardingDone = await isOnboardingComplete();
    if (onboardingDone) {
      prefs = await loadPreferences();
      showOnboarding = false;
      await extractContent();
    } else {
      showOnboarding = true;
    }

    // Listen for tab changes from background script
    browser.runtime.onMessage.addListener((message: Record<string, unknown>) => {
      if (message.type === 'TAB_CHANGED' && !showOnboarding) {
        extractContent();
      }
    });
  });
</script>

{#if showOnboarding === null}
  <div class="h-screen flex items-center justify-center bg-background">
    <div class="text-center">
      <img src="/Klaro_Logo_Yellow.svg" alt="Klaro" class="h-12 w-12 mx-auto mb-3 animate-pulse" />
      <p class="text-muted-foreground text-sm">Loading...</p>
    </div>
  </div>
{:else if showOnboarding}
  <Onboarding onComplete={handleOnboardingComplete} />
{:else}
  <div class="app-container">
    <!-- Header -->
    <header class="header">
      <div class="flex items-center gap-2">
        <img
          src="/Klaro_Logo_Yellow.svg"
          alt="Klaro"
          class="h-9 w-9 shrink-0 rounded"
          width="36"
          height="36"
        />
        <h1 class="font-bold text-xl">Klaro</h1>
      </div>
      {#if view === 'reader'}
        <button class="gear-btn" onclick={() => (view = 'settings')} aria-label="Open settings">
          <Settings size={22} />
        </button>
      {:else}
        <button class="gear-btn" onclick={() => (view = 'reader')} aria-label="Back to reader">
          <ArrowLeft size={22} />
        </button>
      {/if}
    </header>

    <!-- Content -->
    <div class="content">
      {#if view === 'settings'}
        <ScrollArea.Root class="h-full">
          <div class="p-4 space-y-4">
            <PreferenceControls {prefs} onChange={handlePrefsChange} />
            <PageSummary />
          </div>
        </ScrollArea.Root>
      {:else if extractError}
        <div class="error-state">
          <p class="text-lg font-medium">Could not extract content</p>
          <p class="text-sm text-muted-foreground">
            This page may be empty or restricted. Try reloading the page.
          </p>
          <Button variant="outline" size="sm" onclick={() => extractContent()} class="mt-4">
            <RotateCw size={16} class="mr-2" />
            Retry
          </Button>
        </div>
      {:else if readerContent}
        <div class="reader-wrapper">
          {#if loading}
            <div class="loading-bar"></div>
          {/if}
          <ScrollArea.Root class="h-full" bind:viewportRef>
            <div class={loading ? 'loading-dim' : ''}>
              <ReaderView content={readerContent} {prefs} />
            </div>
          </ScrollArea.Root>
        </div>
      {:else if loading}
        <div class="p-4 space-y-4">
          <Skeleton class="h-4 w-1/3" />
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-4 w-2/3" />
          <div class="pt-4 space-y-3">
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-5/6" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-4/5" />
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    flex-shrink: 0;
  }

  .gear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--foreground);
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .gear-btn:hover {
    background: var(--accent);
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: 24px;
    color: var(--foreground);
  }

  .reader-wrapper {
    position: relative;
    height: 100%;
  }

  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 10;
    background: var(--primary);
    transform-origin: left;
    animation: loading-progress 1.5s ease-in-out infinite;
  }

  @keyframes loading-progress {
    0% {
      transform: scaleX(0);
    }
    50% {
      transform: scaleX(0.7);
    }
    100% {
      transform: scaleX(1);
    }
  }

  .loading-dim {
    opacity: 0.5;
    transition: opacity 0.15s;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-bar {
      animation: none;
      transform: scaleX(1);
    }

    .loading-dim {
      transition: none;
    }
  }
</style>
