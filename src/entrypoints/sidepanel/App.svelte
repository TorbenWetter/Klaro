<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  import type {
    ScanTreeResponse,
    DOMTreeNode,
    DOMTreeNodeBase,
    DOMTree,
  } from '$lib/schemas/dom-tree';
  import { CONFIG } from '../../config';
  import type { ElementFingerprint } from '../../utils/element-tracker/types';
  import { domTreeStore } from './stores/dom-tree-store.svelte';
  import { enhanceTreeWithLayout } from '../../utils/llm-service';
  import TreeView from './components/TreeView.svelte';

  // shadcn components
  import * as Alert from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Separator } from '$lib/components/ui/separator';

  // =============================================================================
  // Constants (from centralized config)
  // =============================================================================

  const COOLDOWN_MS = CONFIG.ui.cooldownMs;
  const INPUT_DEBOUNCE_MS = CONFIG.ui.inputDebounceMs;
  const COOLDOWN_UPDATE_INTERVAL_MS = CONFIG.ui.cooldownUpdateIntervalMs;
  const URL_CHANGE_DEBOUNCE_MS = CONFIG.ui.urlChangeDebounceMs;
  const EDITING_LOCKOUT_MS = CONFIG.ui.editingLockoutMs;

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

  // Per-tab session cache for instant switching
  interface TabSession {
    tree: DOMTree | null;
    elementStates: Map<string, Record<string, unknown>>;
  }
  const tabSessionCache = new Map<number, TabSession>();
  let currentTabId: number | null = null;
  let isInitializing = true; // Prevent race conditions during initial load

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
    neighborIds?: string[];
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

  interface TreeScannedMessage {
    type: 'TREE_SCANNED';
    tree: DOMTree | null;
    error?: string;
  }

  interface ModalOpenedMessage {
    type: 'MODAL_OPENED';
    modalId: string | null;
  }

  interface ModalClosedMessage {
    type: 'MODAL_CLOSED';
    modalId: string | null;
  }

  type ContentMessage =
    | StatePatchMessage
    | ElementRemovedMessage
    | InitialStateMessage
    | ElementMatchedMessage
    | NodeAddedMessage
    | NodeRemovedMessage
    | NodeUpdatedMessage
    | NodeMatchedMessage
    | TreeScannedMessage
    | ModalOpenedMessage
    | ModalClosedMessage;

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

  /**
   * Deep clone an object (works with Svelte 5 proxies).
   * Uses JSON serialization to strip proxy wrappers.
   */
  function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Save current session to cache for the given tab.
   */
  function saveTabSession(tabId: number): void {
    if (!domTreeStore.tree) return;

    // Convert Map to array of entries for JSON serialization
    const statesArray = Array.from(domTreeStore.elementStates.entries());

    tabSessionCache.set(tabId, {
      tree: deepClone(domTreeStore.tree),
      elementStates: new Map(statesArray.map(([k, v]) => [k, deepClone(v)])),
    });

    // Limit cache size (keep last 10 tabs)
    if (tabSessionCache.size > 10) {
      const firstKey = tabSessionCache.keys().next().value;
      if (firstKey !== undefined) {
        tabSessionCache.delete(firstKey);
      }
    }
  }

  /**
   * Restore session from cache for the given tab.
   * Returns true if session was restored, false if cache miss.
   */
  function restoreTabSession(tabId: number): boolean {
    const cached = tabSessionCache.get(tabId);

    if (!cached || !cached.tree) {
      return false;
    }

    // Restore cached session immediately
    domTreeStore.setTree(cached.tree);
    for (const [id, state] of cached.elementStates) {
      domTreeStore.updateElementState(id, state);
    }
    return true;
  }

  /**
   * Handle tab activation (user switched tabs).
   */
  async function handleTabActivated(tabId: number): Promise<void> {
    // Skip during initial load to prevent race conditions
    if (isInitializing) return;
    if (tabId === currentTabId) return;

    // Save current tab's session before switching
    if (currentTabId !== null) {
      saveTabSession(currentTabId);
    }

    currentTabId = tabId;

    // Try to restore from cache first (instant switch)
    const restored = restoreTabSession(tabId);
    if (restored) {
      domTreeStore.setLoading(false);
      return;
    }

    // No cache - need to scan
    domTreeStore.setLoading(true);
    domTreeStore.setError(null);
    domTreeStore.reset();

    try {
      await performScan(tabId);
    } catch (e) {
      domTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
      domTreeStore.reset();
    } finally {
      domTreeStore.setLoading(false);
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
  // Scanning with LLM Layout Enhancement
  // =============================================================================

  const MAX_LLM_RETRIES = 3;
  const LLM_RETRY_DELAY_MS = 1000;

  async function performScan(tabId: number): Promise<void> {
    // Get DOM tree from content script
    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'SCAN_TREE',
    })) as ScanTreeResponse;

    if (response.error || !response.tree) {
      domTreeStore.setError(response.error || 'Scan failed');
      return;
    }

    // Store tree immediately (shows structure while LLM processes)
    domTreeStore.setTree(response.tree);

    // Enhance with LLM layout hints (with retry)
    await enhanceWithRetry(response.tree, MAX_LLM_RETRIES);

    // Save to tab session cache
    if (tabId) {
      saveTabSession(tabId);
    }
  }

  /**
   * Enhance tree with LLM layout hints, with retry on failure
   */
  async function enhanceWithRetry(tree: DOMTree, retriesLeft: number): Promise<void> {
    domTreeStore.setLayoutStatus('loading');

    try {
      const layoutResponse = await enhanceTreeWithLayout(tree.root, tree.title, tree.url);
      domTreeStore.applyLayoutHints(layoutResponse);
      domTreeStore.setLayoutStatus('complete');
    } catch (error) {
      console.warn(`[Klaro] LLM enhancement failed, retries left: ${retriesLeft}`, error);

      if (retriesLeft > 0) {
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, LLM_RETRY_DELAY_MS));
        await enhanceWithRetry(tree, retriesLeft - 1);
      } else {
        domTreeStore.setLayoutStatus('error');
        console.error('[Klaro] LLM enhancement failed after all retries');
      }
    }
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
        // Element matched after re-render - no action needed for semantic groups
        // Element stays in its group regardless of DOM position
        break;
      case 'TREE_SCANNED':
        handleTreeScanned(message);
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
        // Node matched after re-render - element stays in place
        handleNodeMatched(message);
        break;
      case 'MODAL_OPENED':
        handleModalOpened(message);
        break;
      case 'MODAL_CLOSED':
        handleModalClosed();
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

    // Update form state in tree store
    domTreeStore.updateElementState(message.id, message.changes);
  }

  function handleElementRemoved(message: ElementRemovedMessage): void {
    domTreeStore.removeNode(message.id);
  }

  function handleInitialState(message: InitialStateMessage): void {
    for (const [elementId, state] of Object.entries(message.states)) {
      domTreeStore.updateElementState(elementId, state);
    }
  }

  // Tree sync handlers
  function handleNodeAdded(_message: NodeAddedMessage): void {
    // For now, trigger a rescan on significant tree changes
    // Full incremental update would require more complex tree manipulation
    console.info('[Klaro] Node added - consider rescanning');
  }

  function handleNodeRemoved(message: NodeRemovedMessage): void {
    domTreeStore.removeNode(message.nodeId);
  }

  function handleNodeUpdated(message: NodeUpdatedMessage): void {
    domTreeStore.updateNode(message.nodeId, message.changes);
  }

  function handleNodeMatched(message: NodeMatchedMessage): void {
    domTreeStore.updateNode(message.nodeId, message.changes);
  }

  function handleTreeScanned(message: TreeScannedMessage): void {
    if (message.error || !message.tree) {
      return;
    }

    // Store tree directly - no LLM processing
    domTreeStore.setTree(message.tree);
    domTreeStore.setLoading(false);
  }

  function handleModalOpened(message: ModalOpenedMessage): void {
    console.info('[Klaro] Modal opened:', message.modalId);
    // TODO: Implement modal focus mode if needed
  }

  function handleModalClosed(): void {
    console.info('[Klaro] Modal closed');
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

    const messageListener = (message: unknown) => {
      // Type guard for message validation
      if (!message || typeof message !== 'object' || !('type' in message)) {
        return;
      }

      const msg = message as { type: string; [key: string]: unknown };

      const handledTypes = [
        'STATE_PATCH',
        'ELEMENT_REMOVED',
        'INITIAL_STATE',
        'ELEMENT_MATCHED',
        // Tree sync messages
        'TREE_SCANNED',
        'NODE_ADDED',
        'NODE_REMOVED',
        'NODE_UPDATED',
        'NODE_MATCHED',
        // Modal messages
        'MODAL_OPENED',
        'MODAL_CLOSED',
      ];

      if (handledTypes.includes(msg.type)) {
        handleContentMessage(msg as ContentMessage);
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

    // Listen for tab switches
    const tabActivatedListener = (activeInfo: { tabId: number; windowId: number }) => {
      handleTabActivated(activeInfo.tabId);
    };

    browser.tabs.onActivated.addListener(tabActivatedListener);

    // Listen for tab removal to clean up cache
    const tabRemovedListener = (tabId: number) => {
      tabSessionCache.delete(tabId);
    };

    browser.tabs.onRemoved.addListener(tabRemovedListener);

    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        domTreeStore.setError('No active tab found.');
        domTreeStore.setLoading(false);
        isInitializing = false;
        return;
      }

      currentTabId = tab.id;

      try {
        await performScan(tab.id);
      } catch (e) {
        domTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
        domTreeStore.reset();
      } finally {
        domTreeStore.setLoading(false);
        isInitializing = false;
      }
    });

    return () => {
      browser.runtime.onMessage.removeListener(messageListener);
      browser.tabs.onUpdated.removeListener(tabUpdateListener);
      browser.tabs.onActivated.removeListener(tabActivatedListener);
      browser.tabs.onRemoved.removeListener(tabRemovedListener);
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
      <img
        src="/Klaro_Logo_Yellow.svg"
        alt="Klaro"
        class="h-9 w-9 shrink-0 rounded"
        width="36"
        height="36"
      />
      <h1 class="font-bold text-xl">Klaro</h1>
    </div>
    <div class="flex items-center gap-2">
      {#if domTreeStore.tree}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => domTreeStore.expandAll()}
          title="Expand all"
        >
          ↓↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => domTreeStore.collapseAll()}
          title="Collapse all"
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
          <Skeleton class="h-10 w-full rounded-md" />
          <Skeleton class="h-6 w-11/12 rounded ml-4" />
          <Skeleton class="h-6 w-10/12 rounded ml-4" />
          <Skeleton class="h-10 w-full rounded-md" />
          <Skeleton class="h-6 w-11/12 rounded ml-4" />
        </div>
        <Separator class="my-4" />
        <div class="space-y-2">
          <Skeleton class="h-10 w-full rounded-md" />
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
    {:else if domTreeStore.root}
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
          root={domTreeStore.root}
          layoutStatus={domTreeStore.layoutStatus}
          onToggle={handleToggleNode}
          onAction={handleUIAction}
          onInputChange={handleInputChange}
          onToggleCheckbox={handleToggle}
          onSelectChange={handleSelectChange}
          onScrollTo={handleScrollTo}
          elementStates={domTreeStore.elementStates}
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
