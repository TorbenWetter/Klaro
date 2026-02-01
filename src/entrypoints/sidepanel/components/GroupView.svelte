<script lang="ts">
  import type { SemanticTree, TrackedElementData } from '$lib/schemas/semantic-groups';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  import GroupNode from './GroupNode.svelte';

  interface Props {
    /** The semantic tree to render */
    tree: SemanticTree;
    /** Element data map */
    elements: Map<string, TrackedElementData>;
    /** Whether modal overlay is active */
    modalActive?: boolean;
    /** Handlers */
    onToggleGroup: (groupId: string) => void;
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
    onScrollTo: (elementId: string) => void;
  }

  let {
    tree,
    elements,
    modalActive = false,
    onToggleGroup,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    onScrollTo,
  }: Props = $props();

  /** Get element data by ID */
  function getElement(id: string): TrackedElementData | undefined {
    return elements.get(id);
  }

  /** Whether there are any groups to show */
  const hasGroups = $derived(tree.groups.length > 0);

  /** Total element count */
  const elementCount = $derived(elements.size);
</script>

<div class="group-view" role="tree" aria-label="Page elements grouped by purpose">
  {#if modalActive && tree.modalGroup}
    <!-- Modal Overlay Mode -->
    <div class="modal-overlay">
      <div class="modal-header">
        <span class="modal-badge">Modal</span>
        <span class="modal-title">Dialog Content</span>
      </div>
      <GroupNode
        group={tree.modalGroup}
        depth={0}
        {getElement}
        {onToggleGroup}
        {onAction}
        {onInputChange}
        {onToggleCheckbox}
        {onSelectChange}
        {onScrollTo}
      />
    </div>
  {:else if hasGroups}
    <!-- Normal Groups View -->
    <div class="groups-container">
      {#each tree.groups as group (group.id)}
        <GroupNode
          {group}
          depth={0}
          {getElement}
          {onToggleGroup}
          {onAction}
          {onInputChange}
          {onToggleCheckbox}
          {onSelectChange}
          {onScrollTo}
        />
      {/each}
    </div>
  {:else}
    <!-- Empty State -->
    <div class="empty-state">
      <p class="empty-message">No elements found on this page</p>
      {#if elementCount === 0}
        <p class="empty-hint">Interactive elements will appear here when detected</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .group-view {
    display: flex;
    flex-direction: column;
    padding: 8px;
    min-height: 100%;
  }

  .groups-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Modal Overlay */
  .modal-overlay {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: hsl(var(--primary) / 0.1);
    border-radius: 6px;
    border: 1px solid hsl(var(--primary) / 0.2);
  }

  .modal-badge {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border-radius: 4px;
  }

  .modal-title {
    font-size: 14px;
    font-weight: 500;
    color: hsl(var(--foreground));
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    gap: 8px;
  }

  .empty-message {
    font-size: 14px;
    color: hsl(var(--muted-foreground));
  }

  .empty-hint {
    font-size: 12px;
    color: hsl(var(--muted-foreground) / 0.7);
  }
</style>
