<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { convertPageToUIWithCache, type AccessibleUI } from '../../utils/page-to-ui';
  import type { ScanResult, ArticleResult } from '../../utils/dom-scanner';
  import { getLLMSimplification } from '../../utils/llm-service';
  import { UIRenderer } from '$lib/components/ui-renderer';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  
  // shadcn components
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Alert from '$lib/components/ui/alert';
  import * as Card from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  const COOLDOWN_MS = 10_000; // 10 second cooldown between scans

  let activeTab = $state('accessible');
  let loading = $state(false);
  let scanError = $state<string | null>(null);
  let accessibleUI = $state<AccessibleUI | null>(null);
  let currentUrl = $state('');
  
  // For READ mode
  let article = $state<ArticleResult | null>(null);
  let simplifiedSummary = $state('');

  // Cooldown state
  let lastScanTime = $state(0);
  let cooldownRemaining = $state(0);
  let cooldownIntervalId: ReturnType<typeof setInterval> | null = null;

  // Check if we're in cooldown
  const isOnCooldown = $derived(cooldownRemaining > 0);

  function startCooldown() {
    lastScanTime = Date.now();
    cooldownRemaining = COOLDOWN_MS;
    
    if (cooldownIntervalId) clearInterval(cooldownIntervalId);
    cooldownIntervalId = setInterval(() => {
      const elapsed = Date.now() - lastScanTime;
      cooldownRemaining = Math.max(0, COOLDOWN_MS - elapsed);
      if (cooldownRemaining <= 0 && cooldownIntervalId) {
        clearInterval(cooldownIntervalId);
        cooldownIntervalId = null;
      }
    }, 100);
  }

  async function scanCurrentTab() {
    // Check cooldown
    if (isOnCooldown) {
      return;
    }

    loading = true;
    scanError = null;
    startCooldown();
    
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        scanError = 'No active tab found.';
        return;
      }

      currentUrl = tab.url ?? '';

      const response = await browser.tabs.sendMessage(tab.id, {
        type: 'SCAN_PAGE',
      }) as ScanResult & { error?: string };

      if (response.error) {
        scanError = response.error;
        return;
      }

      article = response.article ?? null;

      // Generate accessible UI and summary in parallel
      const [ui, llmResult] = await Promise.all([
        convertPageToUIWithCache(response, currentUrl),
        getLLMSimplification(response.article, response.actions),
      ]);

      accessibleUI = ui;
      simplifiedSummary = llmResult.summary;
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Could not scan this page.';
      accessibleUI = null;
      article = null;
      simplifiedSummary = '';
    } finally {
      loading = false;
    }
  }

  function handleActionClick(id: string) {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { type: 'CLICK_ELEMENT', id });
      }
    });
  }

  function handleUIAction(binding: ActionBinding) {
    handleActionClick(binding.elementId);
  }

  // Debounce input changes to avoid too many messages
  let inputDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  
  function handleInputChange(elementId: string, value: string) {
    console.log('[App] handleInputChange:', { elementId, value });
    
    // Clear existing timer for this element
    const existingTimer = inputDebounceTimers.get(elementId);
    if (existingTimer) clearTimeout(existingTimer);
    
    // Set new debounced timer (300ms delay)
    const timer = setTimeout(() => {
      console.log('[App] Sending SET_INPUT_VALUE:', { elementId, value });
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) {
          browser.tabs.sendMessage(tabs[0].id, { 
            type: 'SET_INPUT_VALUE', 
            id: elementId, 
            value 
          });
        }
      });
      inputDebounceTimers.delete(elementId);
    }, 300);
    
    inputDebounceTimers.set(elementId, timer);
  }

  function handleToggle(elementId: string, checked: boolean) {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { 
          type: 'TOGGLE_CHECKBOX', 
          id: elementId, 
          checked 
        });
      }
    });
  }

  onMount(() => {
    // Initial scan on load (no cooldown for first scan)
    loading = true;
    scanError = null;
    
    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        scanError = 'No active tab found.';
        loading = false;
        return;
      }

      currentUrl = tab.url ?? '';

      try {
        const response = await browser.tabs.sendMessage(tab.id, {
          type: 'SCAN_PAGE',
        }) as ScanResult & { error?: string };

        if (response.error) {
          scanError = response.error;
          return;
        }

        article = response.article ?? null;

        const [ui, llmResult] = await Promise.all([
          convertPageToUIWithCache(response, currentUrl),
          getLLMSimplification(response.article, response.actions),
        ]);

        accessibleUI = ui;
        simplifiedSummary = llmResult.summary;
      } catch (e) {
        scanError = e instanceof Error ? e.message : 'Could not scan this page.';
        accessibleUI = null;
        article = null;
        simplifiedSummary = '';
      } finally {
        loading = false;
      }
    });
  });

  onDestroy(() => {
    if (cooldownIntervalId !== null) clearInterval(cooldownIntervalId);
  });
</script>

<main class="h-screen flex flex-col bg-background text-foreground">
  <!-- HEADER -->
  <header class="p-4 bg-card border-b flex justify-between items-center sticky top-0 z-10">
    <h1 class="font-bold text-xl">Klaro</h1>
    <Button 
      variant="outline" 
      size="sm" 
      onclick={() => scanCurrentTab()} 
      disabled={isOnCooldown || loading}
    >
      {#if isOnCooldown}
        {Math.ceil(cooldownRemaining / 1000)}s
      {:else}
        ↻ Refresh
      {/if}
    </Button>
  </header>

  <!-- TABS -->
  <Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col">
    <Tabs.List class="grid w-full grid-cols-2 rounded-none border-b">
      <Tabs.Trigger value="read" class="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
        📖 Read
      </Tabs.Trigger>
      <Tabs.Trigger value="accessible" class="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
        ♿ Accessible
      </Tabs.Trigger>
    </Tabs.List>

    <ScrollArea class="flex-1">
      <div class="p-4">
        {#if loading}
          <!-- Loading State -->
          <div class="space-y-4">
            <Skeleton class="h-8 w-3/4" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-2/3" />
            <Separator class="my-4" />
            <Skeleton class="h-32 w-full rounded-lg" />
            <div class="flex gap-2 pt-4">
              <Skeleton class="h-10 w-28 rounded-md" />
              <Skeleton class="h-10 w-28 rounded-md" />
            </div>
          </div>
        {:else if scanError}
          <!-- Error State -->
          <Alert.Root variant="destructive">
            <Alert.Title>Unable to scan page</Alert.Title>
            <Alert.Description>
              {scanError}
              <br /><br />
              Try refreshing the page or open a normal webpage (not chrome:// or extension pages).
            </Alert.Description>
          </Alert.Root>
          <Button 
            variant="outline" 
            class="mt-4" 
            onclick={() => scanCurrentTab()}
            disabled={isOnCooldown}
          >
            {#if isOnCooldown}
              Wait {Math.ceil(cooldownRemaining / 1000)}s
            {:else}
              Try again
            {/if}
          </Button>
        {:else}
          <!-- READ TAB -->
          <Tabs.Content value="read" class="mt-0">
            {#if article}
              <div class="space-y-4">
                <h2 class="text-2xl font-bold leading-tight">{article.title}</h2>
                
                <Card.Root>
                  <Card.Header>
                    <Card.Title class="text-base">Summary</Card.Title>
                  </Card.Header>
                  <Card.Content>
                    <p class="text-base leading-relaxed">{simplifiedSummary}</p>
                  </Card.Content>
                </Card.Root>

                <Separator />

                <p class="text-base leading-relaxed whitespace-pre-wrap">
                  {article.textContent}
                </p>
              </div>
            {:else}
              <Card.Root>
                <Card.Content class="pt-6 text-center">
                  <p class="text-muted-foreground">No article text found on this page.</p>
                  <Button variant="link" class="mt-2" onclick={() => (activeTab = 'accessible')}>
                    View accessible version instead
                  </Button>
                </Card.Content>
              </Card.Root>
            {/if}
          </Tabs.Content>

          <!-- ACCESSIBLE TAB -->
          <Tabs.Content value="accessible" class="mt-0">
            <article aria-label="Accessible version of this page">
              {#if accessibleUI}
                <div class="accessible-ui-container">
                  {#if accessibleUI.title}
                    <h1 class="text-2xl font-bold mb-2">{accessibleUI.title}</h1>
                  {/if}
                  {#if accessibleUI.description}
                    <p class="text-muted-foreground mb-4">{accessibleUI.description}</p>
                  {/if}
                  <UIRenderer 
                    nodes={accessibleUI.nodes} 
                    onAction={handleUIAction}
                    onInputChange={handleInputChange}
                    onToggle={handleToggle}
                  />
                </div>
              {:else}
                <Alert.Root>
                  <Alert.Title>Unable to generate view</Alert.Title>
                  <Alert.Description>
                    Could not create an accessible version of this page. Try refreshing.
                  </Alert.Description>
                </Alert.Root>
              {/if}
            </article>
          </Tabs.Content>
        {/if}
      </div>
    </ScrollArea>
  </Tabs.Root>
</main>
