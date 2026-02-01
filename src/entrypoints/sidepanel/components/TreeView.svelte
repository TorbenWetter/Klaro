<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import type { DOMTreeNode } from '$lib/schemas/dom-tree';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  import { getPreferences } from '../../../utils/accessibility-preferences';

  interface Props {
    /** Root node of the tree */
    root: DOMTreeNode;
    /** Whether in modal focus mode */
    modalFocusMode?: boolean;
    /** Layout status for loading indicator */
    layoutStatus?: 'pending' | 'loading' | 'complete' | 'error';
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
    layoutStatus = 'pending',
    onToggle,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    onScrollTo,
    elementStates = new Map(),
  }: Props = $props();

  // Get nodes to render, flattening single-child container wrappers
  const nodesToRender = $derived.by(() => {
    if (root.children.length === 0) return [];

    if (
      root.children.length === 1 &&
      root.children[0].nodeType === 'container' &&
      root.children[0].children.length > 0
    ) {
      return root.children[0].children;
    }

    return root.children;
  });

  // Check if layout enhancement is ready
  const layoutReady = $derived(layoutStatus === 'complete');

  // Preferences for styling
  const prefs = $derived(getPreferences());
</script>

<div
  class="tree-view overflow-y-auto p-2"
  class:high-contrast={prefs.highContrast}
  class:large-text={prefs.fontSize === 'large' || prefs.fontSize === 'xlarge'}
  class:increased-spacing={prefs.increasedSpacing}
  role="tree"
  aria-label="Page structure"
>
  {#if nodesToRender.length === 0}
    <p class="text-sm text-muted-foreground italic p-4">No visible content on this page.</p>
  {:else if layoutStatus === 'loading' || layoutStatus === 'pending'}
    <!-- Show loading indicator + basic tree while LLM processes -->
    <div class="layout-loading mb-3 p-2 bg-muted/30 rounded text-center">
      <p class="text-xs text-muted-foreground animate-pulse">Analyzing layout...</p>
    </div>
    <div class="tree-content">
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
          useLayoutHints={false}
        />
      {/each}
    </div>
  {:else if layoutStatus === 'error'}
    <!-- Error state - show basic tree -->
    <div class="layout-error mb-3 p-2 bg-destructive/10 rounded text-center">
      <p class="text-xs text-destructive">Layout analysis failed</p>
    </div>
    <div class="tree-content">
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
          useLayoutHints={false}
        />
      {/each}
    </div>
  {:else}
    <!-- Layout ready - render with LLM layout hints -->
    <div class="tree-content layout-enhanced">
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
          useLayoutHints={true}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-view {
    max-height: calc(100vh - 120px);
  }

  .tree-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* When layout enhanced, let children control their own flow */
  .tree-content.layout-enhanced {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  /* Font size adjustments */
  .tree-view.large-text {
    font-size: 1.1rem;
  }

  .tree-view.large-text :global(.text-sm) {
    font-size: 1rem;
  }

  .tree-view.large-text :global(.text-xs) {
    font-size: 0.9rem;
  }

  /* Increased spacing */
  .tree-view.increased-spacing .tree-content {
    gap: 12px;
  }

  .tree-view.increased-spacing :global(.node-header) {
    padding-top: 6px;
    padding-bottom: 6px;
  }

  /* High contrast mode */
  .tree-view.high-contrast {
    --foreground: oklch(0.1 0 0);
    --muted-foreground: oklch(0.3 0 0);
  }
</style>
