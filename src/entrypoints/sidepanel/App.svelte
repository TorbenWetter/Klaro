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
  import type { TrackedElementData, DisplayGroup } from '$lib/schemas/semantic-groups';
  import { createFlatListFallback, generateGroupId } from '$lib/schemas/semantic-groups';
  import type { ElementFingerprint, NodeType } from '../../utils/element-tracker/types';
  import { semanticTreeStore } from './stores/semantic-tree.svelte';
  import { generateSemanticGroups } from '../../utils/llm-service';
  import GroupView from './components/GroupView.svelte';

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

  /**
   * Convert DOMTreeNode to TrackedElementData
   */
  function nodeToElementData(node: DOMTreeNode): TrackedElementData {
    return {
      id: node.id,
      fingerprint: node.fingerprint,
      tagName: node.tagName,
      nodeType: node.nodeType,
      label: node.label,
      originalLabel: node.originalLabel,
      description: node.description,
      interactiveType: node.interactiveType,
      placeholder: node.placeholder,
      headingLevel: node.headingLevel,
      altText: node.altText,
    };
  }

  /**
   * Flatten DOM tree to element map
   */
  function treeToElementMap(root: DOMTreeNode): Map<string, TrackedElementData> {
    const elements = new Map<string, TrackedElementData>();

    function traverse(node: DOMTreeNode): void {
      // Only include meaningful elements (interactive, text, media)
      if (
        node.nodeType === 'interactive' ||
        node.nodeType === 'text' ||
        node.nodeType === 'media'
      ) {
        elements.set(node.id, nodeToElementData(node));
      }
      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(root);
    return elements;
  }

  // =============================================================================
  // Scanning with Semantic Grouping
  // =============================================================================

  async function performScan(tabId: number): Promise<void> {
    // Get DOM tree from content script
    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'SCAN_TREE',
    })) as ScanTreeResponse;

    if (response.error || !response.tree) {
      semanticTreeStore.setError(response.error || 'Scan failed');
      return;
    }

    const { tree } = response;

    // Convert DOM tree nodes to element map
    const elements = treeToElementMap(tree.root);

    // Try to generate semantic groups via LLM
    let groups: DisplayGroup[] | null = null;

    try {
      groups = await generateSemanticGroups(elements, tree.title, tree.url);
    } catch (error) {
      console.warn('[Klaro] LLM grouping failed, using flat list:', error);
    }

    // Fall back to flat list if LLM fails
    if (!groups) {
      semanticTreeStore.initializeFlat(tree.url, tree.title, elements);
      return;
    }

    // Initialize semantic tree with LLM-generated groups
    semanticTreeStore.initializeTree(
      {
        groups,
        url: tree.url,
        title: tree.title,
        modalActive: false,
        modalGroup: null,
        version: 1,
      },
      elements
    );
  }

  async function scanCurrentTab(): Promise<void> {
    if (isOnCooldown) return;

    semanticTreeStore.setLoading(true);
    semanticTreeStore.setError(null);
    startCooldown();

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        semanticTreeStore.setError('No active tab found.');
        return;
      }

      await performScan(tab.id);
    } catch (e) {
      semanticTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
      semanticTreeStore.reset();
    } finally {
      semanticTreeStore.setLoading(false);
    }
  }

  async function handleUrlChange(newUrl: string): Promise<void> {
    if (newUrl === semanticTreeStore.url) return;

    if (urlChangeDebounceTimer) {
      clearTimeout(urlChangeDebounceTimer);
    }

    urlChangeDebounceTimer = setTimeout(async () => {
      urlChangeDebounceTimer = null;

      semanticTreeStore.setLoading(true);
      semanticTreeStore.setError(null);

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
          semanticTreeStore.setError('No active tab found.');
          return;
        }

        semanticTreeStore.reset();
        await performScan(tab.id);
      } catch (e) {
        semanticTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
        semanticTreeStore.reset();
      } finally {
        semanticTreeStore.setLoading(false);
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

    // Update form state in semantic tree store
    semanticTreeStore.updateElementFormState(message.id, {
      value: message.changes.value as string | undefined,
      checked: message.changes.checked as boolean | undefined,
      disabled: message.changes.disabled as boolean | undefined,
      options: message.changes.options as
        | Array<{ value: string; label: string; selected: boolean }>
        | undefined,
    });
  }

  function handleElementRemoved(message: ElementRemovedMessage): void {
    semanticTreeStore.removeElement(message.id);
  }

  function handleInitialState(message: InitialStateMessage): void {
    for (const [elementId, state] of Object.entries(message.states)) {
      semanticTreeStore.updateElementFormState(elementId, {
        value: state.value as string | undefined,
        checked: state.checked as boolean | undefined,
        disabled: state.disabled as boolean | undefined,
        options: state.options as
          | Array<{ value: string; label: string; selected: boolean }>
          | undefined,
      });
    }
  }

  // Tree sync handlers
  function handleNodeAdded(message: NodeAddedMessage): void {
    const { node, neighborIds = [] } = message;

    // Only add meaningful elements
    if (node.nodeType !== 'interactive' && node.nodeType !== 'text' && node.nodeType !== 'media') {
      return;
    }

    const elementData = nodeToElementData(node);
    semanticTreeStore.addElement(elementData, neighborIds);
  }

  function handleNodeRemoved(message: NodeRemovedMessage): void {
    const { nodeId } = message;
    semanticTreeStore.removeElement(nodeId);
  }

  function handleNodeUpdated(message: NodeUpdatedMessage): void {
    const { nodeId, changes } = message;
    semanticTreeStore.updateElement(nodeId, changes as Partial<TrackedElementData>);
  }

  function handleNodeMatched(message: NodeMatchedMessage): void {
    const { nodeId, changes } = message;
    // Element stays in its semantic group - just update any changed properties
    semanticTreeStore.updateElement(nodeId, changes as Partial<TrackedElementData>);
  }

  async function handleTreeScanned(message: TreeScannedMessage): Promise<void> {
    if (message.error || !message.tree) {
      // Tree scan failed or not ready - will retry via performScan
      return;
    }

    // Tree received from content script - process it
    const elements = treeToElementMap(message.tree.root);

    // Try to generate semantic groups via LLM
    let groups: DisplayGroup[] | null = null;

    try {
      groups = await generateSemanticGroups(elements, message.tree.title, message.tree.url);
    } catch (error) {
      console.warn('[Klaro] LLM grouping failed, using flat list:', error);
    }

    // Fall back to flat list if LLM fails
    if (!groups) {
      semanticTreeStore.initializeFlat(message.tree.url, message.tree.title, elements);
    } else {
      semanticTreeStore.initializeTree(
        {
          groups,
          url: message.tree.url,
          title: message.tree.title,
          modalActive: false,
          modalGroup: null,
          version: 1,
        },
        elements
      );
    }

    semanticTreeStore.setLoading(false);
  }

  function handleModalOpened(message: ModalOpenedMessage): void {
    // Modal opened - switch to modal overlay mode
    // For now, just log - full implementation would create modal group
    console.info('[Klaro] Modal opened:', message.modalId);
    // TODO: Collect modal elements and call semanticTreeStore.enterModalOverlay()
  }

  function handleModalClosed(): void {
    // Modal closed - exit overlay mode
    if (semanticTreeStore.modalActive) {
      semanticTreeStore.exitModalOverlay();
    }
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

  function handleToggleGroup(groupId: string): void {
    semanticTreeStore.toggleGroup(groupId);
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  onMount(() => {
    semanticTreeStore.setLoading(true);
    semanticTreeStore.setError(null);

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

    browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        semanticTreeStore.setError('No active tab found.');
        semanticTreeStore.setLoading(false);
        return;
      }

      try {
        await performScan(tab.id);
      } catch (e) {
        semanticTreeStore.setError(e instanceof Error ? e.message : 'Could not scan this page.');
        semanticTreeStore.reset();
      } finally {
        semanticTreeStore.setLoading(false);
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
      {#if semanticTreeStore.tree}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => semanticTreeStore.expandAll()}
          title="Expand all groups"
        >
          ↓↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => semanticTreeStore.collapseAll()}
          title="Collapse all groups"
        >
          ↑↑
        </Button>
      {/if}
      <Button
        variant="outline"
        size="sm"
        onclick={() => scanCurrentTab()}
        disabled={isOnCooldown || semanticTreeStore.loading}
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
    {#if semanticTreeStore.loading}
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
    {:else if semanticTreeStore.error}
      <!-- Error State -->
      <div class="p-4">
        <Alert.Root variant="destructive">
          <Alert.Title>Unable to scan page</Alert.Title>
          <Alert.Description>
            {semanticTreeStore.error}
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
    {:else if semanticTreeStore.tree}
      <!-- Semantic Group View -->
      <div class="groups-container">
        {#if semanticTreeStore.title}
          <div class="p-4 pb-2">
            <h2 class="text-lg font-semibold text-foreground">{semanticTreeStore.title}</h2>
            <p class="text-sm text-muted-foreground">
              {semanticTreeStore.elementCount} elements in {semanticTreeStore.groupCount} groups
            </p>
          </div>
          <Separator />
        {/if}

        <GroupView
          tree={semanticTreeStore.tree}
          elements={semanticTreeStore.elements}
          modalActive={semanticTreeStore.modalActive}
          onToggleGroup={handleToggleGroup}
          onAction={handleUIAction}
          onInputChange={handleInputChange}
          onToggleCheckbox={handleToggle}
          onSelectChange={handleSelectChange}
          onScrollTo={handleScrollTo}
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
