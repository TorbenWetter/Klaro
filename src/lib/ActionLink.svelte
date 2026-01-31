<script lang="ts">
    interface Props {
        label: string;
        actionId: string;
        importance?: "primary" | "secondary";
        onAction: (actionId: string) => void;
    }
    let { label, actionId, importance = "primary", onAction }: Props = $props();

    const isPrimary = $derived(importance === "primary");
    const linkClass = $derived(
        "w-full text-left p-3 rounded-lg transition-all focus:outline-none focus:ring-4 focus:ring-offset-1 focus:ring-black text-base font-medium block " +
            (isPrimary
                ? "bg-white border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] text-blue-800 underline hover:no-underline"
                : "bg-gray-100 border border-gray-600 hover:bg-gray-200 text-gray-800"),
    );
</script>

<button type="button" class={linkClass} role="link" aria-label={label} onclick={() => onAction(actionId)}>
    {label}
</button>
