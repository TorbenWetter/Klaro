<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import ActionButton from "../../lib/ActionButton.svelte";
    import ActionInput from "../../lib/ActionInput.svelte";
    import ActionLink from "../../lib/ActionLink.svelte";
    import ActionSelect from "../../lib/ActionSelect.svelte";
    import MarkdownBlock from "../../lib/MarkdownBlock.svelte";
    import type { SidebarBlock } from "../../lib/sidebar-types";
    import type { ArticleResult, ScannedAction, ScannedHeading } from "../../utils/dom-scanner";
    import { getLLMStructuredSidebar } from "../../utils/llm-service";

    let loading = $state(false);
    let article = $state<ArticleResult | null>(null);
    let headings = $state<ScannedHeading[]>([]);
    let actions = $state<ScannedAction[]>([]);
    let blocks = $state<SidebarBlock[]>([]);
    let scanError = $state<string | null>(null);

    let tabUpdatedListener: ((tabId: number, changeInfo: { status?: string }, tab: { id?: number; url?: string }) => void) | null = null;

    async function scanCurrentTab() {
        loading = true;
        scanError = null;
        // #region agent log
        fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                location: "App.svelte:scanStart",
                message: "scanCurrentTab started",
                data: {},
                timestamp: Date.now(),
                sessionId: "debug-session",
                hypothesisId: "H1",
            }),
        }).catch(() => {});
        // #endregion
        try {
            const [tab] = await browser.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!tab?.id) {
                scanError = "No active tab.";
                return;
            }

            const response = (await browser.tabs.sendMessage(tab.id, {
                type: "SCAN_PAGE",
            })) as {
                article: ArticleResult | null;
                headings: ScannedHeading[];
                actions: ScannedAction[];
                error?: string;
            };

            if (response.error) {
                scanError = response.error;
                // #region agent log
                fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        location: "App.svelte:responseError",
                        message: "scan response had error",
                        data: { error: response.error },
                        timestamp: Date.now(),
                        sessionId: "debug-session",
                        hypothesisId: "H2",
                    }),
                }).catch(() => {});
                // #endregion
                return;
            }

            article = response.article ?? null;
            headings = response.headings ?? [];
            actions = response.actions ?? [];

            // #region agent log
            fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    location: "App.svelte:beforeLLM",
                    message: "calling getLLMStructuredSidebar",
                    data: { actionsLength: actions.length },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    hypothesisId: "H3",
                }),
            }).catch(() => {});
            // #endregion
            blocks = await getLLMStructuredSidebar(article, actions);
            // #region agent log
            fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    location: "App.svelte:afterLLM",
                    message: "getLLMStructuredSidebar returned",
                    data: { blocksLength: blocks.length },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    hypothesisId: "H4,H5",
                }),
            }).catch(() => {});
            // #endregion
        } catch (e) {
            // #region agent log
            fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    location: "App.svelte:catch",
                    message: "scanCurrentTab threw",
                    data: { err: e instanceof Error ? e.message : String(e) },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    hypothesisId: "H3,H4",
                }),
            }).catch(() => {});
            // #endregion
            scanError = e instanceof Error ? e.message : "Could not scan this page.";
            article = null;
            headings = [];
            actions = [];
            blocks = [];
        } finally {
            loading = false;
        }
    }

    function sendToTab(type: "CLICK_ELEMENT" | "SET_INPUT_VALUE" | "SET_SELECT_VALUE", id: string, value?: string) {
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs[0]?.id) {
                const msg = type === "CLICK_ELEMENT" ? { type, id } : { type, id, value: value ?? "" };
                browser.tabs.sendMessage(tabs[0].id, msg);
            }
        });
    }

    function handleActionClick(actionId: string) {
        sendToTab("CLICK_ELEMENT", actionId);
    }

    function handleInputValue(actionId: string, value: string) {
        sendToTab("SET_INPUT_VALUE", actionId, value);
    }

    function handleSelectValue(actionId: string, value: string) {
        sendToTab("SET_SELECT_VALUE", actionId, value);
    }

    onMount(() => {
        scanCurrentTab();

        tabUpdatedListener = (tabId: number, changeInfo: { status?: string }, _tab: { id?: number; url?: string }) => {
            if (changeInfo.status !== "complete") return;
            browser.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
                if (activeTab?.id === tabId) scanCurrentTab();
            });
        };
        browser.tabs.onUpdated.addListener(tabUpdatedListener);
    });

    onDestroy(() => {
        if (tabUpdatedListener !== null) browser.tabs.onUpdated.removeListener(tabUpdatedListener);
    });
</script>

<main class="h-screen flex flex-col bg-[#FDFBF7] text-black font-sans">
    <header class="p-4 bg-white border-b-2 border-black flex justify-between items-center sticky top-0 z-10">
        <h1 class="font-bold text-xl">Klaro</h1>
        <button
            type="button"
            onclick={scanCurrentTab}
            class="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
        >
            ↻ Refresh
        </button>
    </header>

    <div class="flex-1 overflow-y-auto p-4 space-y-6" aria-label="Page content and actions">
        {#if loading}
            <div class="flex justify-center items-center h-40">
                <p class="text-xl font-medium animate-pulse">Thinking...</p>
            </div>
        {:else if scanError}
            <div class="p-4 bg-red-50 border-2 border-red-600 rounded-xl">
                <p class="text-lg font-medium text-red-900">{scanError}</p>
                <p class="mt-2 text-sm text-red-700">Try refreshing the page or open a normal webpage (not chrome:// or extension pages).</p>
                <button type="button" onclick={scanCurrentTab} class="mt-4 text-sm bg-red-200 px-3 py-1 rounded hover:bg-red-300"> Try again </button>
            </div>
        {:else}
            <article class="space-y-6" aria-label="Accessible page summary and actions">
                {#each blocks as block, i (i)}
                    {#if block.type === "markdown"}
                        <MarkdownBlock content={block.content} importance={block.importance} />
                    {:else if block.type === "button"}
                        <ActionButton label={block.label} actionId={block.actionId} importance={block.importance} onAction={handleActionClick} />
                    {:else if block.type === "link"}
                        <ActionLink label={block.label} actionId={block.actionId} importance={block.importance} onAction={handleActionClick} />
                    {:else if block.type === "input"}
                        <ActionInput
                            label={block.label}
                            actionId={block.actionId}
                            inputType={block.inputType}
                            placeholder={block.placeholder}
                            importance={block.importance}
                            onValue={handleInputValue}
                        />
                    {:else if block.type === "select"}
                        <ActionSelect
                            label={block.label}
                            actionId={block.actionId}
                            options={block.options}
                            importance={block.importance}
                            onValue={handleSelectValue}
                        />
                    {/if}
                {/each}
                {#if blocks.length === 0}
                    <p class="text-lg text-gray-700">No content could be extracted. Try a different page or refresh.</p>
                {/if}
            </article>
        {/if}
    </div>
</main>
