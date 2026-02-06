<script lang="ts">
  import { onMount } from 'svelte';
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

  async function extractContent() {
    loading = true;
    extractError = false;
    readerContent = null;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        extractError = true;
        return;
      }

      const response = (await browser.tabs.sendMessage(tab.id, {
        type: 'GET_READER_CONTENT',
      })) as { content: ReaderContent | null } | undefined;

      if (response?.content) {
        readerContent = response.content;
      } else {
        extractError = true;
      }
    } catch {
      extractError = true;
    } finally {
      loading = false;
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
      {:else if extractError}
        <div class="error-state">
          <p class="text-lg font-medium">Could not extract content</p>
          <p class="text-sm text-muted-foreground">
            This page may be empty or restricted. Try reloading the page.
          </p>
          <Button variant="outline" size="sm" onclick={extractContent} class="mt-4">
            <RotateCw size={16} class="mr-2" />
            Retry
          </Button>
        </div>
      {:else if readerContent}
        <ScrollArea.Root class="h-full">
          <ReaderView content={readerContent} {prefs} />
        </ScrollArea.Root>
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
</style>
