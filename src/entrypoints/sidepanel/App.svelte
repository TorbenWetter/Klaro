<script lang="ts">
    import { ChangeQueue } from "$lib/components/change-queue";
    import { UIRenderer } from "$lib/components/ui-renderer";
    import type { ActionBinding, UINode } from "$lib/schemas/accessible-ui";
    import { onDestroy, onMount } from "svelte";
    import type { ElementState } from "../../utils/binding-manager";
    import type { ArticleResult, ScannedAction, ScanResult } from "../../utils/dom-scanner";
    import { getLLMSimplification } from "../../utils/llm-service";
    import { convertPageToUIWithCache, convertSubtreeToUI, type AccessibleUI } from "../../utils/page-to-ui";
    import type {
        ContentToSidepanelMessage,
        ElementRemovedMessage,
        InitialStateMessage,
        MinorAdditionMessage,
        PendingChangeMessage,
        QueuedChange,
        StatePatchMessage,
    } from "../../utils/reactive-messages";
    // shadcn components
    import * as Alert from "$lib/components/ui/alert";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import * as Card from "$lib/components/ui/card";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    import { Separator } from "$lib/components/ui/separator";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import * as Tabs from "$lib/components/ui/tabs";

    // Constants
    const COOLDOWN_MS = 10_000;
    const INPUT_DEBOUNCE_MS = 300;
    const COOLDOWN_UPDATE_INTERVAL_MS = 100;
    const URL_CHANGE_DEBOUNCE_MS = 500;

    // UI state
    let activeTab = $state("accessible");
    let loading = $state(false);
    let scanError = $state<string | null>(null);
    let accessibleUI = $state<AccessibleUI | null>(null);
    let currentUrl = $state("");

    // Read mode state
    let article = $state<ArticleResult | null>(null);
    let simplifiedSummary = $state("");

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
    const pendingCount = $derived(changeQueue.filter((c) => c.status === "pending").length);

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
                    scanError = "No active tab found.";
                    return;
                }

                resetScanState();
                await performScan(tab.id, newUrl);
            } catch (e) {
                scanError = e instanceof Error ? e.message : "Could not scan this page.";
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
        article = null;
        simplifiedSummary = "";
        changeQueue = [];
        elementStates = new Map();
    }

    /**
     * Start reactive tracking after scan
     */
    async function startTracking(actions: ScannedAction[]) {
        await sendToActiveTab({ type: "START_TRACKING", actions });
        isTracking = true;
    }

    /**
     * Stop reactive tracking
     */
    async function stopTracking() {
        await sendToActiveTab({ type: "STOP_TRACKING" });
        isTracking = false;
        changeQueue = [];
    }

    /**
     * Handle incoming messages from content script
     */
    function handleContentMessage(message: ContentToSidepanelMessage) {
        switch (message.type) {
            case "STATE_PATCH":
                handleStatePatch(message);
                break;
            case "ELEMENT_REMOVED":
                handleElementRemoved(message);
                break;
            case "MINOR_ADDITION":
                handleMinorAddition(message);
                break;
            case "PENDING_CHANGE":
                handlePendingChange(message);
                break;
            case "INITIAL_STATE":
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
    function applyPatchToNodes(nodes: UINode[], elementId: string, changes: Partial<ElementState>): UINode[] {
        return nodes.map((node) => {
            // Check if this node has the matching actionBinding
            if ("actionBinding" in node && node.actionBinding?.elementId === elementId) {
                const updatedNode = { ...node };

                if (changes.value !== undefined && "value" in updatedNode) {
                    (updatedNode as any).value = changes.value;
                }
                if (changes.checked !== undefined && "checked" in updatedNode) {
                    (updatedNode as any).checked = changes.checked;
                }
                if (changes.disabled !== undefined && "disabled" in updatedNode) {
                    (updatedNode as any).disabled = changes.disabled;
                }
                if (changes.label !== undefined && "label" in updatedNode) {
                    (updatedNode as any).label = changes.label;
                }

                return updatedNode;
            }

            // Recursively handle containers
            if ("children" in node && Array.isArray(node.children)) {
                return {
                    ...node,
                    children: applyPatchToNodes(node.children, elementId, changes),
                };
            }
            if ("items" in node && Array.isArray(node.items)) {
                return {
                    ...node,
                    items: node.items.map((item: any) => {
                        if ("content" in item && Array.isArray(item.content)) {
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
        console.log("Minor addition:", message.elements);
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
            elementCount: change.classification.type === "new-context" ? change.classification.elements.length : 0,
            status: "pending",
        };

        changeQueue = [...changeQueue, queuedChange];
    }

    /**
     * Accept a pending change - process it with LLM
     */
    async function acceptChange(changeId: string) {
        // Update status to processing
        changeQueue = changeQueue.map((c) => (c.id === changeId ? { ...c, status: "processing" as const } : c));

        try {
            // Get the subtree description from content script
            const response = await sendToActiveTab<{ description: string; elements: ScannedAction[] }>({
                type: "GET_SUBTREE_DESCRIPTION",
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
            changeQueue = changeQueue.map((c) => (c.id === changeId ? { ...c, status: "completed" as const } : c));

            // Remove from queue after a delay
            setTimeout(() => {
                changeQueue = changeQueue.filter((c) => c.id !== changeId);
            }, 2000);
        } catch (e) {
            console.error("Failed to process change:", e);
            // Revert to pending on error
            changeQueue = changeQueue.map((c) => (c.id === changeId ? { ...c, status: "pending" as const } : c));
        }

        // Dismiss from content script
        await sendToActiveTab({ type: "DISMISS_CHANGE", changeId });
    }

    /**
     * Reject a pending change
     */
    async function rejectChange(changeId: string) {
        changeQueue = changeQueue.map((c) => (c.id === changeId ? { ...c, status: "dismissed" as const } : c));

        // Remove from queue after a brief delay
        setTimeout(() => {
            changeQueue = changeQueue.filter((c) => c.id !== changeId);
        }, 300);

        await sendToActiveTab({ type: "DISMISS_CHANGE", changeId });
    }

    /**
     * Accept all pending changes
     */
    async function acceptAllChanges() {
        const pending = changeQueue.filter((c) => c.status === "pending");
        for (const change of pending) {
            await acceptChange(change.id);
        }
    }

    /**
     * Reject all pending changes
     */
    async function rejectAllChanges() {
        const pending = changeQueue.filter((c) => c.status === "pending");
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
            type: "SCAN_PAGE",
        })) as ScanResult & { error?: string };

        if (response.error) {
            scanError = response.error;
            return;
        }

        article = response.article ?? null;

        // Generate accessible UI and summary in parallel
        const [ui, llmResult] = await Promise.all([
            convertPageToUIWithCache(response, url),
            getLLMSimplification(response.article, response.actions),
        ]);

        accessibleUI = ui;
        simplifiedSummary = llmResult.summary;

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
                scanError = "No active tab found.";
                return;
            }

            currentUrl = tab.url ?? "";
            await performScan(tab.id, currentUrl);
        } catch (e) {
            scanError = e instanceof Error ? e.message : "Could not scan this page.";
            resetScanState();
        } finally {
            loading = false;
        }
    }

    /**
     * Handles action binding clicks (buttons, links)
     */
    function handleUIAction(binding: ActionBinding): void {
        sendToActiveTab({ type: "CLICK_ELEMENT", id: binding.elementId });
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
            sendToActiveTab({ type: "SET_INPUT_VALUE", id: elementId, value });
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
        sendToActiveTab({ type: "TOGGLE_CHECKBOX", id: elementId, checked });
    }

    /**
     * Handles select value changes
     */
    function handleSelectChange(elementId: string, value: string): void {
        // Mark as being edited to prevent patch from reverting
        activelyEditing.set(elementId, Date.now());
        sendToActiveTab({ type: "SET_SELECT_VALUE", id: elementId, value });
    }

    onMount(() => {
        loading = true;
        scanError = null;

        // Listen for messages from content script
        const messageListener = (message: any) => {
            if (message.type && ["STATE_PATCH", "ELEMENT_REMOVED", "MINOR_ADDITION", "PENDING_CHANGE", "INITIAL_STATE"].includes(message.type)) {
                handleContentMessage(message as ContentToSidepanelMessage);
            }
        };

        browser.runtime.onMessage.addListener(messageListener);

        // Listen for URL changes on tabs
        const tabUpdateListener = async (tabId: number, changeInfo: { url?: string; status?: string }, _tab: { id?: number; url?: string }) => {
            // Only care about URL changes on the active tab in the current window
            if (!changeInfo.url) return;

            // Verify this is the active tab in the current window
            const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (!activeTab || activeTab.id !== tabId) return;

            // Handle the URL change with debouncing
            handleUrlChange(changeInfo.url);
        };

        browser.tabs.onUpdated.addListener(tabUpdateListener);

        browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
            if (!tab?.id) {
                scanError = "No active tab found.";
                loading = false;
                return;
            }

            currentUrl = tab.url ?? "";

            try {
                await performScan(tab.id, currentUrl);
            } catch (e) {
                scanError = e instanceof Error ? e.message : "Could not scan this page.";
                resetScanState();
            } finally {
                loading = false;
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
        if (isTracking) {
            stopTracking();
        }
    });
</script>

<main class="h-screen flex flex-col bg-background text-foreground">
    <!-- HEADER -->
    <header class="p-4 bg-card border-b flex justify-between items-center sticky top-0 z-10">
        <div class="flex items-center gap-2">
            <h1 class="font-bold text-xl">Klaro</h1>
            {#if isTracking}
                <Badge variant="secondary" class="text-xs">Live</Badge>
            {/if}
        </div>
        <Button variant="outline" size="sm" onclick={() => scanCurrentTab()} disabled={isOnCooldown || loading}>
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

    <!-- TABS -->
    <Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col">
        <Tabs.List class="grid w-full grid-cols-2 rounded-none border-b">
            <Tabs.Trigger value="read" class="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                📖 Read
            </Tabs.Trigger>
            <Tabs.Trigger value="accessible" class="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                ♿ Accessible
                {#if pendingCount > 0}
                    <Badge variant="destructive" class="ml-1 text-xs h-5 px-1.5">
                        {pendingCount}
                    </Badge>
                {/if}
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
                    <Button variant="outline" class="mt-4" onclick={() => scanCurrentTab()} disabled={isOnCooldown}>
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
                                    <Button variant="link" class="mt-2" onclick={() => (activeTab = "accessible")}>
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
                                        onSelectChange={handleSelectChange}
                                    />
                                </div>
                            {:else}
                                <Alert.Root>
                                    <Alert.Title>Unable to generate view</Alert.Title>
                                    <Alert.Description>Could not create an accessible version of this page. Try refreshing.</Alert.Description>
                                </Alert.Root>
                            {/if}
                        </article>
                    </Tabs.Content>
                {/if}
            </div>
        </ScrollArea>
    </Tabs.Root>
</main>
