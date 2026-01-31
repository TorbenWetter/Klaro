<script lang="ts">
    interface Props {
        label: string;
        actionId: string;
        inputType?: "text" | "email" | "search" | "password";
        placeholder?: string;
        importance?: "primary" | "secondary";
        onValue: (actionId: string, value: string) => void;
    }
    let { label, actionId, inputType = "text", placeholder = "", importance = "primary", onValue }: Props = $props();

    let value = $state("");

    function handleBlur() {
        onValue(actionId, value);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            onValue(actionId, value);
        }
    }

    const inputClass = "w-full p-3 border-2 border-black rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-black";
</script>

<div class="space-y-1">
    <label for="input-{actionId}" class="block text-sm font-medium text-gray-900">
        {label}
    </label>
    <input
        id="input-{actionId}"
        type={inputType}
        bind:value
        {placeholder}
        class={inputClass}
        aria-label={label}
        onblur={handleBlur}
        onkeydown={handleKeydown}
    />
</div>
