<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  import type { ScanTreeResponse, DOMTreeNode, DOMTreeNodeBase } from '$lib/schemas/dom-tree';
  import type { ElementFingerprint } from '../../utils/element-tracker/types';
  import { domTreeStore } from './stores/dom-tree.svelte';
  import TreeView from './components/TreeView.svelte';

  // shadcn components
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Separator } from '$lib/components/ui/separator';

  // =============================================================================
  // Constants
  // =============================================================================

  const COOLDOWN_MS = 10_000;
  const INPUT_DEBOUNCE_MS = 300;
  const COOLDOWN_UPDATE_INTERVAL_MS = 100;
  const URL_CHANGE_DEBOUNCE_MS = 500;

  // =============================================================================
  // State
  // =============================================================================

  // Cooldown state
  let lastScanTime = $state(0);
  let cooldownRemaining = $state(0);
  let cooldownIntervalId: ReturnType<typeof setInterval> | null = null;

  // Debounce timers
  const inputDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let urlChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Track elements being actively edited
  const activelyEditing = new Map<string, number>();
  const EDITING_LOCKOUT_MS = 2000;

  // Element states from content script
  let elementStates = $state<Map<string, Record<string, unknown>>>(new Map());

  // Derived state
  const isOnCooldown = $derived(cooldownRemaining > 0);

  // =============================================================================
  // Message Types
  // =============================================================================

  interface StatePatchMessage {
    type: 'STATE_PATCH';
    id: string;
    changes: Record<string, unknown>;
  }

  interface ElementRemovedMessage {
    type: 'ELEMENT_REMOVED';
    id: string;
  }

  interface InitialStateMessage {
    type: 'INITIAL_STATE';
    states: Record<string, Record<string, unknown>>;
  }

  interface ElementMatchedMessage {
    type: 'ELEMENT_MATCHED';
    fingerprint: ElementFingerprint;
    confidence: number;
  }

  // Tree sync messages
  interface NodeAddedMessage {
    type: 'NODE_ADDED';
    parentId: string;
    node: DOMTreeNode;
    index: number;
  }

  interface NodeRemovedMessage {
    type: 'NODE_REMOVED';
    nodeId: string;
  }

  interface NodeUpdatedMessage {
    type: 'NODE_UPDATED';
    nodeId: string;
    changes: Partial<DOMTreeNodeBase>;
  }

  interface NodeMatchedMessage {
    type: 'NODE_MATCHED';
    nodeId: string;
    confidence: number;
    changes: Partial<DOMTreeNodeBase>;
  }

  type ContentMessage =
    | StatePatchMessage
    | ElementRemovedMessage
    | InitialStateMessage
    | ElementMatchedMessage
    | NodeAddedMessage
    | NodeRemovedMessage
    | NodeUpdatedMessage
    | NodeMatchedMessage;

  // =============================================================================
  // Helpers
  // =============================================================================

  async function sendToActiveTab<T>(message: Record<string, unknown>): Promise<T | null> {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      return (await browser.tabs.sendMessage(tab.id, message)) as T;
    } catch {
      return null;
    }
  }

  function startCooldown(): void {
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
    }, COOLDOWN_UPDATE_INTERVAL_MS);
  }

  function clearAllDebounceTimers(): void {
    for (const timer of inputDebounceTimers.values()) {
      clearTimeout(timer);
    }
    inputDebounceTimers.clear();

    if (urlChangeDebounceTimer) {
      clearTimeout(urlChangeDebounceTimer);
      urlChangeDebounceTimer = null;
    }
  }

  function isElementBeingEdited(elementId: string): boolean {
    const lastEditTime = activelyEditing.get(elementId);
    if (!lastEditTime) return false;

    const elapsed = Date.now() - lastEditTime;
    if (elapsed > EDITING_LOCKOUT_MS) {
      activelyEditing.delete(elementId);
      return false;
    }
    return true;
  }

  // =============================================================================
  // Scanning
  // =============================================================================

  async function performScan(tabId: number): Promise<void> {
    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'SCAN_TREE',
    })) as ScanTreeResponse;

    if (response.error || !response.tree) {
      domTreeStore.setError(response.error || 'Scan failed');
      return;
    }

    // Initialize store with scanned tree
    domTreeStore.initializeTree(response.tree);
  }

  async function scanCurrentTab(): Promise<void> {
    if (isOnCooldown) return;

    domTreeStore.setLoading(true);
    domTreeStore.setError(null);
    startCooldown();

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        domTreeStore.setError('No active tab found.');
        return;
      }

      await performScan(tab.id);
    } catch (e) {
      domTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
      domTreeStore.reset();
    } finally {
      domTreeStore.setLoading(false);
    }
  }

  async function handleUrlChange(newUrl: string): Promise<void> {
    if (newUrl === domTreeStore.url) return;

    if (urlChangeDebounceTimer) {
      clearTimeout(urlChangeDebounceTimer);
    }

    urlChangeDebounceTimer = setTimeout(async () => {
      urlChangeDebounceTimer = null;

      domTreeStore.setLoading(true);
      domTreeStore.setError(null);

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
          domTreeStore.setError('No active tab found.');
          return;
        }

        domTreeStore.reset();
        await performScan(tab.id);
      } catch (e) {
        domTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
        domTreeStore.reset();
      } finally {
        domTreeStore.setLoading(false);
      }
    }, URL_CHANGE_DEBOUNCE_MS);
  }

  // =============================================================================
  // Message Handlers
  // =============================================================================

  function handleContentMessage(message: ContentMessage): void {
    switch (message.type) {
      case 'STATE_PATCH':
        handleStatePatch(message);
        break;
      case 'ELEMENT_REMOVED':
        handleElementRemoved(message);
        break;
      case 'INITIAL_STATE':
        handleInitialState(message);
        break;
      case 'ELEMENT_MATCHED':
        handleElementMatched(message);
        break;
      case 'NODE_ADDED':
        handleNodeAdded(message);
        break;
      case 'NODE_REMOVED':
        handleNodeRemoved(message);
        break;
      case 'NODE_UPDATED':
        handleNodeUpdated(message);
        break;
      case 'NODE_MATCHED':
        handleNodeMatched(message);
        break;
    }
  }

  function handleStatePatch(message: StatePatchMessage): void {
    if (isElementBeingEdited(message.id)) {
      const filteredChanges = { ...message.changes };
      delete filteredChanges.value;
      delete filteredChanges.checked;

      if (Object.keys(filteredChanges).length === 0) {
        return;
      }
      message = { ...message, changes: filteredChanges };
    }

    const current = elementStates.get(message.id) || {};
    elementStates.set(message.id, { ...current, ...message.changes });
    elementStates = new Map(elementStates);

    domTreeStore.updateElementState(message.id, message.changes);
  }

  function handleElementRemoved(message: ElementRemovedMessage): void {
    elementStates.delete(message.id);
    elementStates = new Map(elementStates);
    domTreeStore.removeNode(message.id);
  }

  function handleInitialState(message: InitialStateMessage): void {
    for (const [elementId, state] of Object.entries(message.states)) {
      elementStates.set(elementId, state);
    }
    elementStates = new Map(elementStates);
    domTreeStore.setInitialElementStates(message.states);
  }

  function handleElementMatched(message: ElementMatchedMessage): void {
    const { fingerprint } = message;
    domTreeStore.updateNodeFingerprint(fingerprint.id, fingerprint);
  }

  // Tree sync handlers
  function handleNodeAdded(message: NodeAddedMessage): void {
    const { parentId, node, index } = message;
    domTreeStore.addNode(parentId, node, index);
  }

  function handleNodeRemoved(message: NodeRemovedMessage): void {
    const { nodeId } = message;
    domTreeStore.removeNode(nodeId);
    elementStates.delete(nodeId);
    elementStates = new Map(elementStates);
  }

  function handleNodeUpdated(message: NodeUpdatedMessage): void {
    const { nodeId, changes } = message;
    domTreeStore.updateNode(nodeId, changes);
  }

  function handleNodeMatched(message: NodeMatchedMessage): void {
    const { nodeId, changes } = message;
    domTreeStore.updateNode(nodeId, changes);
  }

  // =============================================================================
  // Action Handlers
  // =============================================================================

  function handleUIAction(binding: ActionBinding): void {
    sendToActiveTab({ type: 'CLICK_ELEMENT', id: binding.elementId });
  }

  function handleInputChange(elementId: string, value: string): void {
    activelyEditing.set(elementId, Date.now());

    const existingTimer = inputDebounceTimers.get(elementId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      sendToActiveTab({ type: 'SET_INPUT_VALUE', id: elementId, value });
      inputDebounceTimers.delete(elementId);
    }, INPUT_DEBOUNCE_MS);

    inputDebounceTimers.set(elementId, timer);
  }

  function handleToggle(elementId: string, checked: boolean): void {
    activelyEditing.set(elementId, Date.now());
    sendToActiveTab({ type: 'TOGGLE_CHECKBOX', id: elementId, checked });
  }

  function handleSelectChange(elementId: string, value: string): void {
    activelyEditing.set(elementId, Date.now());
    sendToActiveTab({ type: 'SET_SELECT_VALUE', id: elementId, value });
  }

  function handleScrollTo(elementId: string): void {
    sendToActiveTab({ type: 'SCROLL_TO_ELEMENT', id: elementId });
  }

  function handleToggleNode(nodeId: string): void {
    domTreeStore.toggleNode(nodeId);
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  onMount(() => {
    domTreeStore.setLoading(true);
    domTreeStore.setError(null);

    const messageListener = (message: any) => {
      const handledTypes = [
        'STATE_PATCH',
        'ELEMENT_REMOVED',
        'INITIAL_STATE',
        'ELEMENT_MATCHED',
        // Tree sync messages
        'NODE_ADDED',
        'NODE_REMOVED',
        'NODE_UPDATED',
        'NODE_MATCHED', // Re-render detection
      ];

      if (message.type && handledTypes.includes(message.type)) {
        handleContentMessage(message as ContentMessage);
      }
    };

    browser.runtime.onMessage.addListener(messageListener);

    const tabUpdateListener = async (
      tabId: number,
      changeInfo: { url?: string; status?: string }
    ) => {
      if (!changeInfo.url) return;

      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || activeTab.id !== tabId) return;

      handleUrlChange(changeInfo.url);
    };

    browser.tabs.onUpdated.addListener(tabUpdateListener);

    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        domTreeStore.setError('No active tab found.');
        domTreeStore.setLoading(false);
        return;
      }

      try {
        await performScan(tab.id);
      } catch (e) {
        domTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
        domTreeStore.reset();
      } finally {
        domTreeStore.setLoading(false);
      }
    });

    return () => {
      browser.runtime.onMessage.removeListener(messageListener);
      browser.tabs.onUpdated.removeListener(tabUpdateListener);
    };
  });

  onDestroy(() => {
    if (cooldownIntervalId) clearInterval(cooldownIntervalId);
    clearAllDebounceTimers();
  });
</script>

<main class="h-screen flex flex-col bg-background text-foreground">
  <!-- HEADER -->
  <header class="p-4 bg-card border-b flex justify-between items-center sticky top-0 z-10">
    <div class="flex items-center gap-2">
      <img src="/Klaro_Logo_Yellow.svg" alt="Klaro" class="h-9 w-9 shrink-0 rounded" width="36" height="36" />
      <h1 class="font-bold text-xl">Klaro</h1>
    </div>
    <div class="flex items-center gap-2">
      {#if domTreeStore.tree}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => domTreeStore.expandAll()}
          title="Expand all nodes"
        >
          ↓↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => domTreeStore.collapseAll()}
          title="Collapse all nodes"
        >
          ↑↑
        </Button>
      {/if}
      <Button
        variant="outline"
        size="sm"
        onclick={() => scanCurrentTab()}
        disabled={isOnCooldown || domTreeStore.loading}
      >
        {#if isOnCooldown}
          {Math.ceil(cooldownRemaining / 1000)}s
        {:else}
          ↻ Refresh
        {/if}
      </Button>
    </div>
  </header>

  <!-- CONTENT -->
  <ScrollArea class="flex-1">
    {#if domTreeStore.loading}
      <!-- Loading State -->
      <div class="p-4 space-y-4">
        <Skeleton class="h-8 w-3/4" />
        <div class="space-y-2">
          <Skeleton class="h-6 w-full rounded" />
          <Skeleton class="h-6 w-11/12 rounded ml-4" />
          <Skeleton class="h-6 w-10/12 rounded ml-8" />
          <Skeleton class="h-6 w-full rounded" />
          <Skeleton class="h-6 w-11/12 rounded ml-4" />
        </div>
        <Separator class="my-4" />
        <div class="space-y-2">
          <Skeleton class="h-6 w-full rounded" />
          <Skeleton class="h-6 w-10/12 rounded ml-4" />
        </div>
      </div>
    {:else if domTreeStore.error}
      <!-- Error State -->
      <div class="p-4">
        <Alert.Root variant="destructive">
          <Alert.Title>Unable to scan page</Alert.Title>
          <Alert.Description>
            {domTreeStore.error}
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
      </div>
    {:else if domTreeStore.tree}
      <!-- Tree View -->
      <div class="tree-container">
        {#if domTreeStore.title}
          <div class="p-4 pb-2">
            <h2 class="text-lg font-semibold text-foreground">{domTreeStore.title}</h2>
            <p class="text-sm text-muted-foreground">
              {domTreeStore.nodeCount} elements
            </p>
          </div>
          <Separator />
        {/if}

        <TreeView
          root={domTreeStore.tree.root}
          modalFocusMode={domTreeStore.modalFocusMode}
          onToggle={handleToggleNode}
          onAction={handleUIAction}
          onInputChange={handleInputChange}
          onToggleCheckbox={handleToggle}
          onSelectChange={handleSelectChange}
          onScrollTo={handleScrollTo}
          {elementStates}
        />
      </div>
    {:else}
      <!-- Empty State -->
      <div class="p-4">
        <Alert.Root>
          <Alert.Title>No content found</Alert.Title>
          <Alert.Description>
            This page doesn't have any visible content. Try refreshing or navigate to a different
            page.
          </Alert.Description>
        </Alert.Root>
      </div>
    {/if}
  </ScrollArea>
</main>
