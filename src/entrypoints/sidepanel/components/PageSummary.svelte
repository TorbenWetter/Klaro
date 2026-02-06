<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';

  let aiAvailable = $state({ summarizer: false, prompt: false });
  let loading = $state(false);
  let result = $state('');
  let error = $state('');

  async function sendToBackground(message: Record<string, unknown>) {
    return browser.runtime.sendMessage(message);
  }

  async function sendToActiveTab(message: Record<string, unknown>) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return browser.tabs.sendMessage(tab.id, message);
  }

  async function handleSummarize() {
    loading = true;
    error = '';
    result = '';

    try {
      const response = (await sendToActiveTab({ type: 'GET_PAGE_TEXT' })) as {
        text: string;
      } | null;
      if (!response?.text) {
        error = 'Could not extract text from this page.';
        return;
      }

      const aiResult = (await sendToBackground({
        type: 'SUMMARIZE_TEXT',
        text: response.text,
      })) as { result?: string; error?: string };

      if (aiResult?.error) {
        error = aiResult.error;
      } else if (aiResult?.result) {
        result = aiResult.result;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to summarize page.';
    } finally {
      loading = false;
    }
  }

  async function handleSimplify() {
    loading = true;
    error = '';
    result = '';

    try {
      const response = (await sendToActiveTab({ type: 'GET_SELECTED_TEXT' })) as {
        text: string;
      } | null;
      if (!response?.text) {
        error = 'Select some text on the page first.';
        return;
      }

      const aiResult = (await sendToBackground({
        type: 'SIMPLIFY_TEXT',
        text: response.text,
      })) as { result?: string; error?: string };

      if (aiResult?.error) {
        error = aiResult.error;
      } else if (aiResult?.result) {
        result = aiResult.result;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to simplify text.';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      const response = (await sendToBackground({
        type: 'CHECK_AI_AVAILABLE',
      })) as typeof aiAvailable;
      if (response) aiAvailable = response;
    } catch {
      // AI not available
    }
  });
</script>

<Card.Root>
  <Card.Header class="pb-3">
    <Card.Title class="text-sm font-medium">AI Assistant</Card.Title>
    <Card.Description class="text-xs">
      {#if aiAvailable.summarizer || aiAvailable.prompt}
        Summarize pages or simplify selected text.
      {:else}
        Requires Chrome 131+ with built-in AI enabled.
      {/if}
    </Card.Description>
  </Card.Header>
  <Card.Content class="pt-0 space-y-3">
    <div class="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        class="flex-1"
        disabled={!aiAvailable.summarizer || loading}
        onclick={handleSummarize}
      >
        {loading ? 'Working...' : 'Summarize Page'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="flex-1"
        disabled={!aiAvailable.prompt || loading}
        onclick={handleSimplify}
      >
        Simplify Selected
      </Button>
    </div>

    {#if error}
      <Alert.Root variant="destructive">
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if result}
      <div class="rounded-md bg-muted p-3 text-sm leading-relaxed whitespace-pre-wrap">
        {result}
      </div>
    {/if}
  </Card.Content>
</Card.Root>
