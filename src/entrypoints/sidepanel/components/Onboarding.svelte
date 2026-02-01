<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import * as Card from "$lib/components/ui/card";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";

    // Settings that will be saved
    export interface AccessibilitySettings {
        fontSize: "small" | "medium" | "large" | "xlarge";
        highContrast: boolean;
        increasedSpacing: boolean;
        reducedMotion: boolean;
    }

    interface Props {
        onComplete: (settings: AccessibilitySettings) => void;
    }

    let { onComplete }: Props = $props();

    // Current step (1-3)
    let step = $state(1);

    // Settings state
    let fontSize = $state<AccessibilitySettings["fontSize"]>("medium");
    let highContrast = $state(false);
    let increasedSpacing = $state(false);
    let reducedMotion = $state(false);

    // Font size config
    const fontSizes = [
        { value: "small", label: "Small", size: "14px" },
        { value: "medium", label: "Medium", size: "16px" },
        { value: "large", label: "Large", size: "18px" },
        { value: "xlarge", label: "Extra Large", size: "20px" },
    ] as const;

    function nextStep() {
        if (step < 3) {
            step++;
        }
    }

    function prevStep() {
        if (step > 1) {
            step--;
        }
    }

    function finish() {
        onComplete({
            fontSize,
            highContrast,
            increasedSpacing,
            reducedMotion,
        });
    }

    // Get current font size in px for preview
    const currentFontSize = $derived(fontSizes.find((f) => f.value === fontSize)?.size ?? "16px");

    // Preview styles based on current settings
    const previewStyles = $derived({
        fontSize: currentFontSize,
        lineHeight: increasedSpacing ? "1.8" : "1.5",
        letterSpacing: increasedSpacing ? "0.02em" : "normal",
    });

    const previewContainerStyles = $derived({
        background: highContrast ? "black" : undefined,
        color: highContrast ? "white" : undefined,
        border: highContrast ? "2px solid white" : undefined,
    });
</script>

<div class="h-full flex flex-col bg-background">
    <!-- Header with progress -->
    <header class="p-4 bg-card border-b">
        <div class="flex items-center gap-2 mb-3">
            <img
                src="/Klaro_Logo_Yellow.svg"
                alt="Klaro"
                class="h-8 w-8 shrink-0 rounded"
                width="32"
                height="32"
            />
            <h1 class="font-bold text-lg">Welcome to Klaro</h1>
        </div>
        <!-- Progress dots -->
        <div class="flex items-center justify-center gap-2">
            {#each [1, 2, 3] as s}
                <div
                    class="h-2 w-2 rounded-full transition-colors {s === step
                        ? 'bg-brand'
                        : s < step
                          ? 'bg-brand/50'
                          : 'bg-muted'}"
                ></div>
            {/each}
        </div>
    </header>

    <!-- Content area -->
    <div class="flex-1 overflow-auto p-4">
        {#if step === 1}
            <!-- Step 1: Font Size -->
            <div class="space-y-4">
                <div>
                    <h2 class="text-xl font-semibold mb-1">Choose your font size</h2>
                    <p class="text-sm text-muted-foreground">
                        Select a comfortable reading size. You can change this later.
                    </p>
                </div>

                <!-- Font size buttons -->
                <div class="grid grid-cols-2 gap-2">
                    {#each fontSizes as option}
                        <button
                            type="button"
                            class="p-3 rounded-lg border-2 text-left transition-all {fontSize ===
                            option.value
                                ? 'border-brand bg-brand/10'
                                : 'border-border hover:border-brand/50'}"
                            onclick={() => (fontSize = option.value)}
                        >
                            <span class="block font-medium" style="font-size: {option.size}">
                                {option.label}
                            </span>
                            <span class="text-xs text-muted-foreground">{option.size}</span>
                        </button>
                    {/each}
                </div>

                <Separator />

                <!-- Live Preview -->
                <div>
                    <p class="text-sm font-medium mb-2 text-muted-foreground">Preview</p>
                    <Card.Root>
                        <Card.Content class="pt-4">
                            <div style="font-size: {currentFontSize}; line-height: 1.5;">
                                <p class="font-semibold mb-1">Page Title</p>
                                <p class="text-muted-foreground">
                                    This is how text will appear in Klaro. The quick brown fox jumps
                                    over the lazy dog.
                                </p>
                            </div>
                        </Card.Content>
                    </Card.Root>
                </div>
            </div>
        {:else if step === 2}
            <!-- Step 2: Accessibility Features -->
            <div class="space-y-4">
                <div>
                    <h2 class="text-xl font-semibold mb-1">Accessibility options</h2>
                    <p class="text-sm text-muted-foreground">
                        Enable features to make Klaro easier to use.
                    </p>
                </div>

                <!-- Toggle options -->
                <div class="space-y-3">
                    <div
                        class="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                        <div class="space-y-0.5">
                            <Label for="high-contrast" class="font-medium">High Contrast</Label>
                            <p class="text-xs text-muted-foreground">
                                Stronger colors for better visibility
                            </p>
                        </div>
                        <Switch id="high-contrast" bind:checked={highContrast} />
                    </div>

                    <div
                        class="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                        <div class="space-y-0.5">
                            <Label for="spacing" class="font-medium">Increased Spacing</Label>
                            <p class="text-xs text-muted-foreground">
                                More space between lines and letters
                            </p>
                        </div>
                        <Switch id="spacing" bind:checked={increasedSpacing} />
                    </div>

                    <div
                        class="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                        <div class="space-y-0.5">
                            <Label for="motion" class="font-medium">Reduced Motion</Label>
                            <p class="text-xs text-muted-foreground">
                                Minimize animations and transitions
                            </p>
                        </div>
                        <Switch id="motion" bind:checked={reducedMotion} />
                    </div>
                </div>

                <Separator />

                <!-- Live Preview -->
                <div>
                    <p class="text-sm font-medium mb-2 text-muted-foreground">Preview</p>
                    <Card.Root>
                        <Card.Content class="pt-4">
                            <div
                                class="p-3 rounded {highContrast
                                    ? 'bg-black text-white border-2 border-white'
                                    : ''}"
                                style="font-size: {currentFontSize}; line-height: {increasedSpacing
                                    ? '1.8'
                                    : '1.5'}; letter-spacing: {increasedSpacing
                                    ? '0.02em'
                                    : 'normal'};"
                            >
                                <p class="font-semibold mb-1">Sample Content</p>
                                <p class={highContrast ? "text-white/80" : "text-muted-foreground"}>
                                    Preview of your accessibility settings. Text spacing and contrast
                                    are adjusted based on your choices.
                                </p>
                                <button
                                    type="button"
                                    class="mt-2 px-3 py-1.5 rounded text-sm font-medium {highContrast
                                        ? 'bg-white text-black'
                                        : 'bg-brand text-brand-foreground'}"
                                    style={reducedMotion ? "transition: none;" : ""}
                                >
                                    Sample Button
                                </button>
                            </div>
                        </Card.Content>
                    </Card.Root>
                </div>
            </div>
        {:else}
            <!-- Step 3: All Set -->
            <div class="space-y-6 text-center pt-8">
                <div
                    class="w-16 h-16 mx-auto bg-brand/20 rounded-full flex items-center justify-center"
                >
                    <svg
                        class="w-8 h-8 text-brand-foreground"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>

                <div>
                    <h2 class="text-xl font-semibold mb-2">You're all set!</h2>
                    <p class="text-muted-foreground">
                        Klaro will make web pages easier to navigate and understand.
                    </p>
                </div>

                <!-- Summary -->
                <Card.Root class="text-left">
                    <Card.Header class="pb-2">
                        <Card.Title class="text-base">Your Settings</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Font Size</span>
                            <span class="font-medium capitalize">{fontSize}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">High Contrast</span>
                            <span class="font-medium">{highContrast ? "On" : "Off"}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Increased Spacing</span>
                            <span class="font-medium">{increasedSpacing ? "On" : "Off"}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Reduced Motion</span>
                            <span class="font-medium">{reducedMotion ? "On" : "Off"}</span>
                        </div>
                    </Card.Content>
                </Card.Root>

                <p class="text-xs text-muted-foreground">
                    You can change these settings anytime from the menu.
                </p>
            </div>
        {/if}
    </div>

    <!-- Footer with navigation -->
    <footer class="p-4 bg-card border-t flex justify-between items-center">
        {#if step > 1}
            <Button variant="ghost" size="sm" onclick={prevStep}>Back</Button>
        {:else}
            <div></div>
        {/if}

        {#if step < 3}
            <Button
                class="bg-brand text-brand-foreground hover:bg-brand/90"
                size="sm"
                onclick={nextStep}
            >
                Continue
            </Button>
        {:else}
            <Button
                class="bg-brand text-brand-foreground hover:bg-brand/90"
                size="sm"
                onclick={finish}
            >
                Get Started
            </Button>
        {/if}
    </footer>
</div>
