<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import type { DOMTreeNode } from '$lib/schemas/dom-tree';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';

  interface Props {
    /** Root node of the tree */
    root: DOMTreeNode;
    /** Whether in modal focus mode */
    modalFocusMode?: boolean;
    /** Handlers */
    onToggle: (nodeId: string) => void;
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
    onScrollTo: (elementId: string) => void;
    /** Element states for form synchronization */
    elementStates?: Map<string, Record<string, unknown>>;
  }

  let {
    root,
    modalFocusMode = false,
    onToggle,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    onScrollTo,
    elementStates = new Map(),
  }: Props = $props();
</script>

<div class="tree-view overflow-y-auto" role="tree" aria-label="Page structure">
  <!-- Render content, flattening single-child container wrappers at root -->
  {#if root.children.length > 0}
    {@const nodesToRender =
      root.children.length === 1 &&
      root.children[0].nodeType === 'container' &&
      root.children[0].children.length > 0
        ? root.children[0].children // Skip the single wrapper, render its children
        : root.children}
    {#each nodesToRender as node (node.id)}
      <TreeNode
        {node}
        {modalFocusMode}
        {onToggle}
        {onAction}
        {onInputChange}
        {onToggleCheckbox}
        {onSelectChange}
        {onScrollTo}
        {elementStates}
      />
    {/each}
  {:else}
    <p class="text-sm text-muted-foreground italic p-4">No visible content on this page.</p>
  {/if}
</div>

<style>
  .tree-view {
    max-height: calc(100vh - 120px);
  }
</style>
