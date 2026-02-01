<script lang="ts">
  import { ChangeQueue } from '$lib/components/change-queue';
  import { UIRenderer } from '$lib/components/ui-renderer';
  import type { ActionBinding, UINode } from '$lib/schemas/accessible-ui';
  import { onDestroy, onMount } from 'svelte';
  import type { ElementState } from '../../utils/binding-manager';
  import type { ScannedAction, ScanResult } from '../../utils/dom-scanner';
  import {
    convertPageToUIWithCache,
    convertSubtreeToUI,
    type AccessibleUI,
  } from '../../utils/page-to-ui';
  import type {
    ContentToSidepanelMessage,
    ElementRemovedMessage,
    InitialStateMessage,
    MinorAdditionMessage,
    PendingChangeMessage,
    QueuedChange,
    StatePatchMessage,
  } from '../../utils/reactive-messages';
  // shadcn components
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  // Onboarding
  import Onboarding from './components/Onboarding.svelte';
  import {
    type AccessibilityPreferences,
    loadPreferences,
    isOnboardingComplete,
    applyPreferencesToDOM,
  } from '../../utils/accessibility-preferences';

  // Constants
  const COOLDOWN_MS = 10_000;
  const INPUT_DEBOUNCE_MS = 300;
  const COOLDOWN_UPDATE_INTERVAL_MS = 100;
  const URL_CHANGE_DEBOUNCE_MS = 500;

  // Onboarding & settings state
  let showOnboarding = $state<boolean | null>(null); // null = loading
  let settings = $state<AccessibilityPreferences | null>(null);

  // Handle onboarding completion
  async function handleOnboardingComplete() {
    // Preferences are already saved by Onboarding component
    // Just load them and apply
    settings = await loadPreferences();
    applyPreferencesToDOM(settings);
    showOnboarding = false;
  }

  // UI state
  let loading = $state(false);
  let scanError = $state<string | null>(null);
  let accessibleUI = $state<AccessibleUI | null>(null);
  let currentUrl = $state('');

  // Cooldown state
  let lastScanTime = $state(0);
  let cooldownRemaining = $state(0);
  let cooldownIntervalId: ReturnType<typeof setInterval> | null = null;

  // Debounce timers for input changes
  const inputDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // URL change debounce timer
  let urlChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Reactive tracking state
  let isTracking = $state(false);
  let changeQueue = $state<QueuedChange[]>([]);
  let elementStates = $state<Map<string, Partial<ElementState>>>(new Map());

  // Track elements being actively edited (to ignore incoming patches)
  const activelyEditing = new Map<string, number>(); // elementId -> timestamp
  const EDITING_LOCKOUT_MS = 2000; // Ignore patches for 2s after last edit

  // Derived state
  const isOnCooldown = $derived(cooldownRemaining > 0);

  /**
   * Sends a message to the active tab's content script
   */
  async function sendToActiveTab<T>(message: Record<string, unknown>): Promise<T | null> {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      return (await browser.tabs.sendMessage(tab.id, message)) as T;
    } catch {
      return null;
    }
  }

  /**
   * Starts the cooldown timer after a scan
   */
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

  /**
   * Clears all pending debounce timers
   */
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
   * Handles URL change with debouncing - triggers a rescan when the URL changes
   */
  async function handleUrlChange(newUrl: string): Promise<void> {
    // Skip if URL hasn't actually changed
    if (newUrl === currentUrl) return;

    // Clear any pending URL change debounce
    if (urlChangeDebounceTimer) {
      clearTimeout(urlChangeDebounceTimer);
    }

    // Debounce the rescan
    urlChangeDebounceTimer = setTimeout(async () => {
      urlChangeDebounceTimer = null;

      // Update current URL
      currentUrl = newUrl;

      // Trigger rescan (bypassing cooldown for URL-triggered scans)
      loading = true;
      scanError = null;

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
          scanError = 'No active tab found.';
          return;
        }

        resetScanState();
        await performScan(tab.id, newUrl);
      } catch (e) {
        scanError = e instanceof Error ? e.message : 'Could not scan this page.';
        resetScanState();
      } finally {
        loading = false;
      }
    }, URL_CHANGE_DEBOUNCE_MS);
  }

  /**
   * Resets all scan-related state to initial values
   */
  function resetScanState(): void {
    accessibleUI = null;
    changeQueue = [];
    elementStates = new Map();
  }

  /**
   * Start reactive tracking after scan
   */
  async function startTracking(actions: ScannedAction[]) {
    await sendToActiveTab({ type: 'START_TRACKING', actions });
    isTracking = true;
  }

  /**
   * Stop reactive tracking
   */
  async function stopTracking() {
    await sendToActiveTab({ type: 'STOP_TRACKING' });
    isTracking = false;
    changeQueue = [];
  }

  /**
   * Handle incoming messages from content script
   */
  function handleContentMessage(message: ContentToSidepanelMessage) {
    switch (message.type) {
      case 'STATE_PATCH':
        handleStatePatch(message);
        break;
      case 'ELEMENT_REMOVED':
        handleElementRemoved(message);
        break;
      case 'MINOR_ADDITION':
        handleMinorAddition(message);
        break;
      case 'PENDING_CHANGE':
        handlePendingChange(message);
        break;
      case 'INITIAL_STATE':
        handleInitialState(message);
        break;
    }
  }

  /**
   * Apply initial state from the page to sync current values
   */
  function handleInitialState(message: InitialStateMessage) {
    if (!accessibleUI) return;

    // Apply all initial states to the UI
    let updatedNodes = accessibleUI.nodes;
    for (const [elementId, state] of Object.entries(message.states)) {
      updatedNodes = applyPatchToNodes(updatedNodes, elementId, state);
      elementStates.set(elementId, state);
    }

    accessibleUI = {
      ...accessibleUI,
      nodes: updatedNodes,
    };
    elementStates = new Map(elementStates);
  }

  /**
   * Check if an element is being actively edited
   */
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
   * Apply a state patch to the UI
   */
  function handleStatePatch(message: StatePatchMessage) {
    // Skip value/checked patches for elements being actively edited
    if (isElementBeingEdited(message.id)) {
      // Only skip value-related changes, allow other changes like disabled
      const filteredChanges = { ...message.changes };
      delete filteredChanges.value;
      delete filteredChanges.checked;

      if (Object.keys(filteredChanges).length === 0) {
        return; // Nothing left to apply
      }
      message = { ...message, changes: filteredChanges };
    }

    // Store the state change
    const current = elementStates.get(message.id) || {};
    elementStates.set(message.id, { ...current, ...message.changes });
    elementStates = new Map(elementStates); // Trigger reactivity

    // Update the accessible UI nodes in place
    if (accessibleUI) {
      accessibleUI = {
        ...accessibleUI,
        nodes: applyPatchToNodes(accessibleUI.nodes, message.id, message.changes),
      };
    }
  }

  /**
   * Recursively apply a patch to UI nodes
   */
  function applyPatchToNodes(
    nodes: UINode[],
    elementId: string,
    changes: Partial<ElementState>
  ): UINode[] {
    return nodes.map((node) => {
      // Check if this node has the matching actionBinding
      if ('actionBinding' in node && node.actionBinding?.elementId === elementId) {
        const updatedNode = { ...node };

        if (changes.value !== undefined && 'value' in updatedNode) {
          (updatedNode as any).value = changes.value;
        }
        if (changes.checked !== undefined && 'checked' in updatedNode) {
          (updatedNode as any).checked = changes.checked;
        }
        if (changes.disabled !== undefined && 'disabled' in updatedNode) {
          (updatedNode as any).disabled = changes.disabled;
        }
        if (changes.label !== undefined && 'label' in updatedNode) {
          (updatedNode as any).label = changes.label;
        }

        return updatedNode;
      }

      // Recursively handle containers
      if ('children' in node && Array.isArray(node.children)) {
        return {
          ...node,
          children: applyPatchToNodes(node.children, elementId, changes),
        };
      }
      if ('items' in node && Array.isArray(node.items)) {
        return {
          ...node,
          items: node.items.map((item: any) => {
            if ('content' in item && Array.isArray(item.content)) {
              return { ...item, content: applyPatchToNodes(item.content, elementId, changes) };
            }
            return item;
          }),
        };
      }

      return node;
    });
  }

  /**
   * Handle element removal
   */
  function handleElementRemoved(message: ElementRemovedMessage) {
    elementStates.delete(message.id);
    elementStates = new Map(elementStates);

    // Could also remove from UI, but might want to keep it visible with a "removed" state
  }

  /**
   * Handle minor additions (auto-accepted, no LLM needed)
   */
  function handleMinorAddition(message: MinorAdditionMessage) {
    // For minor additions, we could add simple UI nodes without LLM
    // For now, just log and potentially show a badge
    console.log('Minor addition:', message.elements);
  }

  /**
   * Handle pending change that needs user approval
   */
  function handlePendingChange(message: PendingChangeMessage) {
    const change = message.change;
    const queuedChange: QueuedChange = {
      id: change.id,
      timestamp: change.timestamp,
      description: change.description,
      estimatedTokens: change.estimatedTokens,
      elementCount:
        change.classification.type === 'new-context' ? change.classification.elements.length : 0,
      status: 'pending',
    };

    changeQueue = [...changeQueue, queuedChange];
  }

  /**
   * Accept a pending change - process it with LLM
   */
  async function acceptChange(changeId: string) {
    // Update status to processing
    changeQueue = changeQueue.map((c) =>
      c.id === changeId ? { ...c, status: 'processing' as const } : c
    );

    try {
      // Get the subtree description from content script
      const response = await sendToActiveTab<{ description: string; elements: ScannedAction[] }>({
        type: 'GET_SUBTREE_DESCRIPTION',
        changeId,
      });

      if (response?.description) {
        // Call LLM to generate UI for this subtree
        const subtreeUI = await convertSubtreeToUI(response.description, response.elements);

        if (subtreeUI && accessibleUI) {
          // Append the new UI nodes
          accessibleUI = {
            ...accessibleUI,
            nodes: [...accessibleUI.nodes, ...subtreeUI.nodes],
          };
        }
      }

      // Mark as completed
      changeQueue = changeQueue.map((c) =>
        c.id === changeId ? { ...c, status: 'completed' as const } : c
      );

      // Remove from queue after a delay
      setTimeout(() => {
        changeQueue = changeQueue.filter((c) => c.id !== changeId);
      }, 2000);
    } catch (e) {
      console.error('Failed to process change:', e);
      // Revert to pending on error
      changeQueue = changeQueue.map((c) =>
        c.id === changeId ? { ...c, status: 'pending' as const } : c
      );
    }

    // Dismiss from content script
    await sendToActiveTab({ type: 'DISMISS_CHANGE', changeId });
  }

  /**
   * Reject a pending change
   */
  async function rejectChange(changeId: string) {
    changeQueue = changeQueue.map((c) =>
      c.id === changeId ? { ...c, status: 'dismissed' as const } : c
    );

    // Remove from queue after a brief delay
    setTimeout(() => {
      changeQueue = changeQueue.filter((c) => c.id !== changeId);
    }, 300);

    await sendToActiveTab({ type: 'DISMISS_CHANGE', changeId });
  }

  /**
   * Accept all pending changes
   */
  async function acceptAllChanges() {
    const pending = changeQueue.filter((c) => c.status === 'pending');
    for (const change of pending) {
      await acceptChange(change.id);
    }
  }

  /**
   * Reject all pending changes
   */
  async function rejectAllChanges() {
    const pending = changeQueue.filter((c) => c.status === 'pending');
    for (const change of pending) {
      await rejectChange(change.id);
    }
  }

  /**
   * Core scan logic - fetches page data and processes it
   */
  async function performScan(tabId: number, url: string): Promise<void> {
    // Stop any existing tracking
    if (isTracking) {
      await stopTracking();
    }

    const response = (await browser.tabs.sendMessage(tabId, {
      type: 'SCAN_PAGE',
    })) as ScanResult & { error?: string };

    if (response.error) {
      scanError = response.error;
      return;
    }

    accessibleUI = await convertPageToUIWithCache(response, url);

    // Start reactive tracking with the scanned actions
    if (response.actions.length > 0) {
      await startTracking(response.actions);
    }
  }

  /**
   * Scans the current tab (with cooldown enforcement)
   */
  async function scanCurrentTab(): Promise<void> {
    if (isOnCooldown) return;

    loading = true;
    scanError = null;
    startCooldown();

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        scanError = 'No active tab found.';
        return;
      }

      currentUrl = tab.url ?? '';
      await performScan(tab.id, currentUrl);
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Could not scan this page.';
      resetScanState();
    } finally {
      loading = false;
    }
  }

  /**
   * Handles action binding clicks (buttons, links)
   */
  function handleUIAction(binding: ActionBinding): void {
    sendToActiveTab({ type: 'CLICK_ELEMENT', id: binding.elementId });
  }

  /**
   * Handles input value changes with debouncing
   */
  function handleInputChange(elementId: string, value: string): void {
    // Mark this element as being actively edited (to ignore incoming patches)
    activelyEditing.set(elementId, Date.now());

    // Clear existing timer for this element
    const existingTimer = inputDebounceTimers.get(elementId);
    if (existingTimer) clearTimeout(existingTimer);

    // Set new debounced timer
    const timer = setTimeout(() => {
      sendToActiveTab({ type: 'SET_INPUT_VALUE', id: elementId, value });
      inputDebounceTimers.delete(elementId);
    }, INPUT_DEBOUNCE_MS);

    inputDebounceTimers.set(elementId, timer);
  }

  /**
   * Handles checkbox/switch toggle changes
   */
  function handleToggle(elementId: string, checked: boolean): void {
    // Mark as being edited to prevent patch from reverting the toggle
    activelyEditing.set(elementId, Date.now());
    sendToActiveTab({ type: 'TOGGLE_CHECKBOX', id: elementId, checked });
  }

  /**
   * Handles select value changes
   */
  function handleSelectChange(elementId: string, value: string): void {
    // Mark as being edited to prevent patch from reverting
    activelyEditing.set(elementId, Date.now());
    sendToActiveTab({ type: 'SET_SELECT_VALUE', id: elementId, value });
  }

  onMount(() => {
    // Load settings and check onboarding status first
    (async () => {
      const onboardingDone = await isOnboardingComplete();
      if (onboardingDone) {
        settings = await loadPreferences();
        applyPreferencesToDOM(settings);
        showOnboarding = false;
        // Proceed with scanning
        initializeScan();
      } else {
        showOnboarding = true;
      }
    })();

    // Listen for messages from content script
    const messageListener = (message: any) => {
      if (
        message.type &&
        [
          'STATE_PATCH',
          'ELEMENT_REMOVED',
          'MINOR_ADDITION',
          'PENDING_CHANGE',
          'INITIAL_STATE',
        ].includes(message.type)
      ) {
        handleContentMessage(message as ContentToSidepanelMessage);
      }
    };

    browser.runtime.onMessage.addListener(messageListener);

    // Listen for URL changes on tabs
    const tabUpdateListener = async (
      tabId: number,
      changeInfo: { url?: string; status?: string },
      _tab: { id?: number; url?: string }
    ) => {
      // Only care about URL changes on the active tab in the current window
      if (!changeInfo.url) return;

      // Verify this is the active tab in the current window
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || activeTab.id !== tabId) return;

      // Handle the URL change with debouncing
      handleUrlChange(changeInfo.url);
    };

    browser.tabs.onUpdated.addListener(tabUpdateListener);

    return () => {
      browser.runtime.onMessage.removeListener(messageListener);
      browser.tabs.onUpdated.removeListener(tabUpdateListener);
    };
  });

  /**
   * Initialize scanning after onboarding is complete
   */
  async function initializeScan() {
    loading = true;
    scanError = null;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      scanError = 'No active tab found.';
      loading = false;
      return;
    }

    currentUrl = tab.url ?? '';

    try {
      await performScan(tab.id, currentUrl);
    } catch (e) {
      scanError = e instanceof Error ? e.message : 'Could not scan this page.';
      resetScanState();
    } finally {
      loading = false;
    }
  }

  onDestroy(() => {
    if (cooldownIntervalId) clearInterval(cooldownIntervalId);
    clearAllDebounceTimers();
    if (isTracking) {
      stopTracking();
    }
  });
</script>

{#if showOnboarding === null}
  <!-- Loading settings -->
  <div class="h-screen flex items-center justify-center bg-background">
    <div class="text-center">
      <img src="/Klaro_Logo_Yellow.svg" alt="Klaro" class="h-12 w-12 mx-auto mb-3 animate-pulse" />
      <p class="text-muted-foreground text-sm">Loading...</p>
    </div>
  </div>
{:else if showOnboarding}
  <!-- Onboarding Flow -->
  <Onboarding
    onComplete={async () => {
      await handleOnboardingComplete();
      initializeScan();
    }}
  />
{:else}
  <!-- Main App -->
  <main
    class="h-screen flex flex-col bg-background text-foreground"
    style="font-size: var(--klaro-font-size, 16px); line-height: var(--klaro-line-height, 1.5); letter-spacing: var(--klaro-letter-spacing, normal);"
  >
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
        {#if isTracking}
          <Badge variant="secondary" class="text-xs">Live</Badge>
        {/if}
      </div>
      <Button
        variant="outline"
        size="sm"
        class="bg-brand text-brand-foreground border-brand hover:bg-brand/90 hover:opacity-90"
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

    <!-- CHANGE QUEUE -->
    <ChangeQueue
      changes={changeQueue}
      onAccept={acceptChange}
      onReject={rejectChange}
      onAcceptAll={acceptAllChanges}
      onRejectAll={rejectAllChanges}
    />

    <!-- ACCESSIBILITY VIEW (full page, no tabs) -->
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
        {:else if accessibleUI}
          <!-- Short summary at top, then full accessibility view -->
          <article aria-label="Accessible version of this page">
            <div class="accessible-ui-container">
              {#if accessibleUI.title || accessibleUI.description}
                <div class="pb-4 mb-4 border-b">
                  {#if accessibleUI.title}
                    <h2 class="text-lg font-semibold text-foreground">{accessibleUI.title}</h2>
                  {/if}
                  {#if accessibleUI.description}
                    <p class="text-sm text-muted-foreground mt-1">{accessibleUI.description}</p>
                  {/if}
                </div>
              {/if}
              <UIRenderer
                nodes={accessibleUI.nodes}
                onAction={handleUIAction}
                onInputChange={handleInputChange}
                onToggle={handleToggle}
                onSelectChange={handleSelectChange}
              />
            </div>
          </article>
        {:else}
          <Alert.Root>
            <Alert.Title>No content</Alert.Title>
            <Alert.Description
              >Could not create an accessible version of this page. Try refreshing.</Alert.Description
            >
          </Alert.Root>
        {/if}
      </div>
    </ScrollArea>
  </main>
{/if}
