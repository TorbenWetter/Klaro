<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getLLMSimplification } from '../../utils/llm-service';
  import type {
    ArticleResult,
    ScannedAction,
    ScannedHeading,
    PageBlock,
  } from '../../utils/dom-scanner';

  type Mode = 'READ' | 'ACCESSIBLE';

  const AUTO_REFRESH_INTERVAL_MS = 45_000;

  let mode = $state<Mode>('ACCESSIBLE');
  let loading = $state(false);
  let article = $state<ArticleResult | null>(null);
  let headings = $state<ScannedHeading[]>([]);
  let actions = $state<ScannedAction[]>([]);
  let pageCopy = $state<PageBlock[]>([]);
  let simplifiedSummary = $state('');
  let scanError = $state<string | null>(null);

  let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  let pageUpdatedListener: ((msg: { type?: string }) => void) | null = null;
  let visibilityOff: (() => void) | null = null;

  async function scanCurrentTab() {
    loading = true;
    scanError = null;
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        scanError = 'No active tab.';
        return;
      }

      const response = await browser.tabs.sendMessage(tab.id, {
        type: 'SCAN_PAGE',
      }) as {
        article: ArticleResult | null;
        headings: ScannedHeading[];
        actions: ScannedAction[];
        pageCopy: PageBlock[];
        error?: string;
      };

      if (response.error) {
        scanError = response.error;
        return;
      }

      article = response.article ?? null;
      headings = response.headings ?? [];
      actions = response.actions ?? [];
      pageCopy = response.pageCopy ?? [];

      const { summary } = await getLLMSimplification(article, actions);
      simplifiedSummary = summary;
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Could not scan this page.';
      article = null;
      headings = [];
      actions = [];
      pageCopy = [];
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

  onMount(() => {
    scanCurrentTab();

    // React to page DOM changes (SPA nav, dynamic content)
    pageUpdatedListener = (msg: { type?: string }) => {
      if (msg?.type === 'PAGE_UPDATED') scanCurrentTab();
    };
    browser.runtime.onMessage.addListener(pageUpdatedListener);

    // Auto-refresh when panel becomes visible again
    const onVisibility = () => {
      if (document.visibilityState === 'visible') scanCurrentTab();
    };
    document.addEventListener('visibilitychange', onVisibility);
    visibilityOff = () =>
      document.removeEventListener('visibilitychange', onVisibility);

    // Periodic auto-refresh while panel is open
    refreshIntervalId = setInterval(() => {
      if (document.visibilityState === 'visible') scanCurrentTab();
    }, AUTO_REFRESH_INTERVAL_MS);
  });

  onDestroy(() => {
    if (refreshIntervalId !== null) clearInterval(refreshIntervalId);
    if (pageUpdatedListener !== null)
      browser.runtime.onMessage.removeListener(pageUpdatedListener);
    if (visibilityOff !== null) visibilityOff();
  });
</script>

<main class="h-screen flex flex-col bg-[#FDFBF7] text-black font-sans">
  <!-- HEADER -->
  <header
    class="p-4 bg-white border-b-2 border-black flex justify-between items-center sticky top-0 z-10"
  >
    <h1 class="font-bold text-xl">Klaro</h1>
    <button
      onclick={scanCurrentTab}
      class="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
    >
      ↻ Refresh
    </button>
  </header>

  <!-- TABS -->
  <div class="flex border-b-2 border-black">
    <button
      type="button"
      onclick={() => (mode = 'READ')}
      class="flex-1 py-4 font-bold text-lg border-r-2 border-black transition-colors {mode ===
      'READ'
      ? 'bg-[#FFEB3B]'
      : 'bg-white'} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-black"
    >
      📖 Read
    </button>
    <button
      type="button"
      onclick={() => (mode = 'ACCESSIBLE')}
      class="flex-1 py-4 font-bold text-lg transition-colors {mode ===
      'ACCESSIBLE'
      ? 'bg-[#FFEB3B]'
      : 'bg-white'} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-black"
    >
      ♿ Accessible
    </button>
  </div>

  <!-- CONTENT -->
  <div class="flex-1 overflow-y-auto p-4 space-y-6">
    {#if loading}
      <div class="flex justify-center items-center h-40">
        <p class="text-xl font-medium animate-pulse">Thinking...</p>
      </div>
    {:else if scanError}
      <div class="p-4 bg-red-50 border-2 border-red-600 rounded-xl">
        <p class="text-lg font-medium text-red-900">{scanError}</p>
        <p class="mt-2 text-sm text-red-700">
          Try refreshing the page or open a normal webpage (not chrome:// or
          extension pages).
        </p>
        <button
          type="button"
          onclick={scanCurrentTab}
          class="mt-4 text-sm bg-red-200 px-3 py-1 rounded hover:bg-red-300"
        >
          Try again
        </button>
      </div>
    {:else}
      <!-- READ MODE -->
      {#if mode === 'READ'}
        {#if article}
          <div class="space-y-4">
            <h2 class="text-3xl font-bold leading-tight">{article.title}</h2>

            <div
              class="bg-blue-50 border-2 border-blue-800 p-4 rounded-xl"
            >
              <p class="text-lg leading-relaxed font-medium">
                {simplifiedSummary}
              </p>
            </div>

            <hr class="border-gray-300" />

            <p
              class="text-lg text-gray-700 leading-relaxed whitespace-pre-wrap"
            >
              {article.textContent}
            </p>
          </div>
        {:else}
          <div class="p-4 bg-gray-100 rounded-lg text-center">
            <p class="text-lg">No article text found on this page.</p>
            <button
              type="button"
              onclick={() => (mode = 'ACCESSIBLE')}
              class="mt-4 text-blue-700 underline hover:no-underline"
            >
              Open accessible version
            </button>
          </div>
        {/if}
      {/if}

      <!-- ACCESSIBLE: real copy of the page in reading order -->
      {#if mode === 'ACCESSIBLE'}
        <article
          class="space-y-4"
          aria-label="Accessible copy of this page"
        >
          {#each pageCopy as block, i (i)}
            {#if block.type === 'heading'}
              <h
                class="block font-bold text-black"
                style="font-size: {block.level === 1
                  ? '1.75rem'
                  : block.level === 2
                    ? '1.5rem'
                    : block.level === 3
                      ? '1.25rem'
                      : '1.125rem'}; padding-left: {(block.level - 1) * 0.5}rem"
              >
                {block.text}
              </h>
            {:else if block.type === 'text'}
              <p class="text-lg text-gray-900 leading-relaxed whitespace-pre-wrap">
                {block.content}
              </p>
            {:else if block.type === 'action'}
              <button
                type="button"
                onclick={() => handleActionClick(block.id)}
                class="w-full text-left p-3 bg-white border-2 border-black rounded-lg shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-[3px] active:shadow-none transition-all focus:outline-none focus:ring-4 focus:ring-offset-1 focus:ring-black text-base font-medium"
              >
                {block.text}
              </button>
            {/if}
          {/each}
          {#if pageCopy.length === 0}
            <p class="text-lg text-gray-700">
              No content could be extracted. Try a different page or refresh.
            </p>
          {/if}
        </article>
      {/if}
    {/if}
  </div>
</main>
