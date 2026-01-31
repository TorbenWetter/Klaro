<script lang="ts">
    import { untrack } from "svelte";
    import type { SelectOption } from "./sidebar-types";

    interface Props {
        label: string;
        actionId: string;
        options: SelectOption[];
        importance?: "primary" | "secondary";
        onValue: (actionId: string, value: string) => void;
    }
    let { label, actionId, options, onValue }: Props = $props();

    const firstOptionValue = $derived(options[0]?.value ?? "");
    let selectedValue = $state("");

    $effect(() => {
        const first = firstOptionValue;
        untrack(() => {
            if (first && !selectedValue) selectedValue = first;
        });
    });

    function handleChange() {
        onValue(actionId, selectedValue);
    }

    const selectClass =
        "w-full p-3 border-2 border-black rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-black bg-white";
</script>

<div class="space-y-1">
    <label for="select-{actionId}" class="block text-sm font-medium text-gray-900">
        {label}
    </label>
    <select id="select-{actionId}" class={selectClass} aria-label={label} bind:value={selectedValue} onchange={handleChange}>
        {#each options as opt}
            <option value={opt.value}>{opt.label}</option>
        {/each}
    </select>
</div>
