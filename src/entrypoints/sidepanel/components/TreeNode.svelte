<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import type {
    DOMTreeNode,
    DisplayMode,
    SpacingLevel,
    EmphasisLevel,
  } from '$lib/schemas/dom-tree';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  import { getPreferences } from '../../../utils/accessibility-preferences';
  // Self-import for recursion (Svelte 5 pattern)
  import TreeNode from './TreeNode.svelte';

  interface Props {
    /** The tree node to render */
    node: DOMTreeNode;
    /** Whether in modal focus mode */
    modalFocusMode?: boolean;
    /** Whether to apply LLM layout hints */
    useLayoutHints?: boolean;
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
    node,
    modalFocusMode = false,
    useLayoutHints = false,
    onToggle,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    onScrollTo,
    elementStates = new Map(),
  }: Props = $props();

  // =============================================================================
  // Layout Styling
  // =============================================================================

  const prefs = $derived(getPreferences());

  // Layout hints from LLM
  const display = $derived(node.layout?.display || 'block');
  const emphasis = $derived(node.layout?.emphasis || 'normal');
  const spacing = $derived(node.layout?.spacing || 'normal');

  /** Get CSS classes based on display mode */
  function getDisplayClasses(mode: DisplayMode): string {
    switch (mode) {
      case 'inline':
        return 'display-inline';
      case 'flex-row':
        return 'display-flex-row';
      case 'flex-col':
        return 'display-flex-col';
      case 'grid':
        return 'display-grid';
      default:
        return 'display-block';
    }
  }

  /** Get CSS classes based on emphasis level */
  function getEmphasisClasses(level: EmphasisLevel): string {
    switch (level) {
      case 'critical':
        return 'emphasis-critical';
      case 'high':
        return 'emphasis-high';
      case 'low':
        return 'emphasis-low';
      default:
        return '';
    }
  }

  /** Get CSS classes based on spacing */
  function getSpacingClasses(level: SpacingLevel): string {
    switch (level) {
      case 'compact':
        return 'spacing-compact';
      case 'spacious':
        return 'spacing-spacious';
      default:
        return '';
    }
  }

  const layoutClasses = $derived(
    useLayoutHints
      ? `${getDisplayClasses(display)} ${getEmphasisClasses(emphasis)} ${getSpacingClasses(spacing)}`.trim()
      : ''
  );

  /** Check if this node should be dimmed (modal mode but not in modal) */
  const isDimmed = $derived(modalFocusMode && !node.isModal);

  /** Whether this node has children */
  const hasChildren = $derived(node.children.length > 0);

  /** Whether to show expand/collapse control */
  const isExpandable = $derived(hasChildren && node.nodeType === 'container');

  /** Icons for different node types */
  const nodeIcons: Record<string, string> = {
    container: '📁',
    text: '📝',
    interactive: '🔘',
    media: '🖼️',
    list: '📋',
    listItem: '•',
    table: '📊',
  };

  /** Interactive type icons */
  const interactiveIcons: Record<string, string> = {
    button: '🔘',
    link: '🔗',
    input: '✏️',
    checkbox: '☑️',
    radio: '⭕',
    select: '📋',
    textarea: '📝',
  };

  /** Get icon for node */
  function getIcon(): string {
    if (node.interactiveType) {
      return interactiveIcons[node.interactiveType] || '🔘';
    }
    if (node.headingLevel) {
      return `H${node.headingLevel}`;
    }
    return nodeIcons[node.nodeType] || '📄';
  }

  /** Calculate indentation */
  const indentPx = $derived(node.depth * 16);

  /** Get element state value */
  function getStateValue(key: string): unknown {
    return elementStates.get(node.id)?.[key];
  }

  /** Handle click on node label (scroll to element) */
  function handleLabelClick(): void {
    onScrollTo(node.id);
  }

  /** Handle action for interactive elements */
  function handleAction(): void {
    const binding: ActionBinding = {
      elementId: node.id,
      action: 'click',
    };
    onAction(binding);
  }

  /** Handle input change */
  function handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    onInputChange(node.id, target.value);
  }

  /** Set initial value without making input controlled */
  function setInitialValue(
    inputNode: HTMLInputElement | HTMLTextAreaElement,
    value: string | undefined
  ) {
    if (value !== undefined && value !== '') {
      inputNode.value = value;
    }

    return {
      update(newValue: string | undefined) {
        // Only update if not focused
        if (document.activeElement !== inputNode && newValue !== undefined) {
          inputNode.value = newValue;
        }
      },
    };
  }

  /** Truncate text for display */
  function truncate(text: string, maxLength = 50): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }
</script>

<div
  class="tree-node {layoutClasses}"
  class:dimmed={isDimmed}
  class:layout-styled={useLayoutHints}
  role="treeitem"
  aria-selected="false"
  aria-expanded={isExpandable ? node.isExpanded : undefined}
  style="--indent: {indentPx}px"
  data-display={display}
  data-emphasis={emphasis}
  data-spacing={spacing}
>
  <!-- Node Header -->
  <div class="node-header" style="padding-left: {indentPx}px">
    <!-- Expand/Collapse Toggle -->
    {#if isExpandable}
      <button
        class="expand-toggle"
        onclick={() => onToggle(node.id)}
        aria-label={node.isExpanded ? 'Collapse' : 'Expand'}
      >
        <span class="chevron" class:expanded={node.isExpanded}>▶</span>
      </button>
    {:else}
      <span class="expand-spacer"></span>
    {/if}

    <!-- Node Content -->
    <div class="node-content">
      {#if node.nodeType === 'interactive'}
        <!-- Interactive Element: Render as component -->
        {#if node.interactiveType === 'button' || node.interactiveType === 'link'}
          <Button
            variant={node.interactiveType === 'link' ? 'link' : 'default'}
            size="sm"
            class="w-full justify-start text-left h-auto py-1 px-2"
            onclick={handleAction}
          >
            <span class="icon">{getIcon()}</span>
            <span class="label">{truncate(node.label)}</span>
          </Button>
        {:else if node.interactiveType === 'input'}
          <div class="input-wrapper">
            <Label class="text-xs text-muted-foreground">{truncate(node.label, 30)}</Label>
            <input
              class="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              type="text"
              placeholder={node.placeholder}
              oninput={handleInput}
              onfocus={handleAction}
              use:setInitialValue={typeof getStateValue('value') === 'string'
                ? (getStateValue('value') as string)
                : undefined}
            />
          </div>
        {:else if node.interactiveType === 'textarea'}
          <div class="input-wrapper">
            <Label class="text-xs text-muted-foreground">{truncate(node.label, 30)}</Label>
            <textarea
              class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={node.placeholder}
              rows={2}
              oninput={handleInput}
              onfocus={handleAction}
              use:setInitialValue={typeof getStateValue('value') === 'string'
                ? (getStateValue('value') as string)
                : undefined}
            ></textarea>
          </div>
        {:else if node.interactiveType === 'checkbox'}
          <div class="checkbox-wrapper">
            <Checkbox
              checked={typeof getStateValue('checked') === 'boolean'
                ? (getStateValue('checked') as boolean)
                : false}
              onCheckedChange={(checked) => onToggleCheckbox(node.id, Boolean(checked))}
            />
            <button class="checkbox-label" onclick={handleLabelClick}>
              {truncate(node.label)}
            </button>
          </div>
        {:else if node.interactiveType === 'radio'}
          <div class="radio-wrapper">
            <input
              type="radio"
              class="radio-input"
              checked={typeof getStateValue('checked') === 'boolean'
                ? (getStateValue('checked') as boolean)
                : false}
              onchange={() => onToggleCheckbox(node.id, true)}
            />
            <button class="radio-label" onclick={handleLabelClick}>
              {truncate(node.label)}
            </button>
          </div>
        {:else if node.interactiveType === 'select'}
          {@const stateOptions = elementStates.get(node.id)?.options as
            | Array<{ value: string; label: string }>
            | undefined}
          <div class="select-wrapper">
            <Label class="text-xs text-muted-foreground">{truncate(node.label, 30)}</Label>
            <select
              class="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={typeof getStateValue('value') === 'string'
                ? (getStateValue('value') as string)
                : ''}
              onchange={(e) => onSelectChange(node.id, (e.target as HTMLSelectElement).value)}
              onfocus={handleAction}
            >
              {#each stateOptions || [] as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        {:else}
          <!-- Fallback for unknown interactive type -->
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start text-left h-auto py-1 px-2"
            onclick={handleAction}
          >
            <span class="icon">{getIcon()}</span>
            <span class="label">{truncate(node.label)}</span>
          </Button>
        {/if}
      {:else if node.nodeType === 'text'}
        <!-- Text Content -->
        <button class="text-node" onclick={handleLabelClick}>
          {#if node.headingLevel}
            <span
              class="heading"
              class:h1={node.headingLevel === 1}
              class:h2={node.headingLevel === 2}
              class:h3={node.headingLevel === 3}
              class:h4={node.headingLevel === 4}
              class:h5={node.headingLevel === 5}
              class:h6={node.headingLevel === 6}
            >
              <span class="heading-level">H{node.headingLevel}</span>
              {truncate(node.label, 60)}
            </span>
          {:else}
            <span class="text-content">{truncate(node.label, 80)}</span>
          {/if}
        </button>
      {:else if node.nodeType === 'media'}
        <!-- Media Content -->
        <button class="media-node" onclick={handleLabelClick}>
          <span class="icon">🖼️</span>
          <span class="label text-muted-foreground">{truncate(node.altText || node.label, 40)}</span
          >
        </button>
      {:else}
        <!-- Container/Other -->
        <button class="container-node" onclick={handleLabelClick}>
          <span class="icon">{getIcon()}</span>
          <span class="label">{truncate(node.label, 40)}</span>
          {#if hasChildren}
            <span class="child-count">({node.children.length})</span>
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <!-- Children (if expanded) -->
  {#if isExpandable && node.isExpanded && node.children.length > 0}
    <div class="node-children" role="group" transition:slide={{ duration: 150 }}>
      {#each node.children as child (child.id)}
        <TreeNode
          node={child}
          {modalFocusMode}
          {useLayoutHints}
          {onToggle}
          {onAction}
          {onInputChange}
          {onToggleCheckbox}
          {onSelectChange}
          {onScrollTo}
          {elementStates}
        />
      {/each}
    </div>
  {/if}

  <!-- Non-expandable children (show inline) -->
  {#if !isExpandable && node.children.length > 0}
    <div class="node-children inline-children">
      {#each node.children as child (child.id)}
        <TreeNode
          node={child}
          {modalFocusMode}
          {useLayoutHints}
          {onToggle}
          {onAction}
          {onInputChange}
          {onToggleCheckbox}
          {onSelectChange}
          {onScrollTo}
          {elementStates}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    --transition-duration: 150ms;
  }

  .tree-node.dimmed {
    opacity: 0.4;
    pointer-events: none;
  }

  /* =============================================================================
     Display Mode Styles (LLM-assigned layout)
     ============================================================================= */

  /* Inline: flows horizontally with siblings */
  .tree-node.layout-styled.display-inline {
    display: inline-flex;
    flex-shrink: 0;
  }

  .tree-node.layout-styled.display-inline .node-header {
    padding: 2px 6px;
  }

  /* Block: stacked vertically, full width (default) */
  .tree-node.layout-styled.display-block {
    display: block;
    width: 100%;
  }

  /* Flex-row: children in horizontal row */
  .tree-node.layout-styled.display-flex-row > .node-children {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
    border-left: none;
    margin-left: 0;
    padding: 4px 0;
  }

  /* Flex-col: children stacked vertically */
  .tree-node.layout-styled.display-flex-col > .node-children {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Grid: children in grid layout */
  .tree-node.layout-styled.display-grid > .node-children {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    border-left: none;
    margin-left: 0;
    padding: 4px 0;
  }

  /* =============================================================================
     Emphasis Level Styles
     ============================================================================= */

  .tree-node.layout-styled.emphasis-critical {
    background: hsl(var(--primary) / 0.1);
    border-radius: 6px;
    padding: 4px 8px;
    margin: 2px 0;
  }

  .tree-node.layout-styled.emphasis-critical :global(button),
  .tree-node.layout-styled.emphasis-critical :global(a) {
    font-weight: 700;
  }

  .tree-node.layout-styled.emphasis-high {
    font-weight: 600;
  }

  .tree-node.layout-styled.emphasis-low {
    opacity: 0.75;
  }

  .tree-node.layout-styled.emphasis-low .node-header {
    padding-top: 1px;
    padding-bottom: 1px;
    min-height: 24px;
  }

  /* =============================================================================
     Spacing Level Styles
     ============================================================================= */

  .tree-node.layout-styled.spacing-compact .node-header {
    padding: 1px 4px;
    min-height: 22px;
    gap: 2px;
  }

  .tree-node.layout-styled.spacing-compact > .node-children {
    gap: 2px;
  }

  .tree-node.layout-styled.spacing-spacious .node-header {
    padding: 6px 12px;
    min-height: 36px;
  }

  .tree-node.layout-styled.spacing-spacious > .node-children {
    gap: 12px;
  }

  /* =============================================================================
     Base Node Styles
     ============================================================================= */

  .node-header {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 2px 8px;
    min-height: 28px;
  }

  .node-header:hover {
    background-color: hsl(var(--muted) / 0.5);
  }

  .expand-toggle {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: hsl(var(--muted-foreground));
  }

  .expand-toggle:hover {
    color: hsl(var(--foreground));
  }

  .chevron {
    font-size: 10px;
    transition: transform var(--transition-duration);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .expand-spacer {
    width: 20px;
    flex-shrink: 0;
  }

  .node-content {
    flex: 1;
    min-width: 0;
  }

  /* Text nodes */
  .text-node {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    font-size: 14px;
    color: hsl(var(--foreground));
    width: 100%;
  }

  .text-node:hover {
    text-decoration: underline;
  }

  .heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .heading-level {
    font-size: 10px;
    padding: 1px 4px;
    background: hsl(var(--muted));
    border-radius: 3px;
    color: hsl(var(--muted-foreground));
    font-weight: 500;
  }

  .heading.h1 {
    font-size: 18px;
  }

  .heading.h2 {
    font-size: 16px;
  }

  .heading.h3 {
    font-size: 15px;
  }

  .heading.h4,
  .heading.h5,
  .heading.h6 {
    font-size: 14px;
  }

  .text-content {
    color: hsl(var(--muted-foreground));
    font-size: 13px;
  }

  /* Container nodes */
  .container-node {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    font-size: 14px;
    color: hsl(var(--foreground));
    width: 100%;
  }

  .container-node:hover {
    text-decoration: underline;
  }

  .container-node .icon {
    font-size: 12px;
  }

  .container-node .label {
    font-weight: 500;
  }

  .child-count {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    margin-left: 4px;
  }

  /* Media nodes */
  .media-node {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 2px 0;
    font-size: 13px;
    width: 100%;
  }

  .media-node:hover {
    text-decoration: underline;
  }

  /* Interactive elements */
  .input-wrapper,
  .select-wrapper {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .checkbox-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .checkbox-label {
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 14px;
    color: hsl(var(--foreground));
    padding: 0;
  }

  .checkbox-label:hover {
    text-decoration: underline;
  }

  .radio-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .radio-input {
    appearance: none;
    width: 16px;
    height: 16px;
    border: 1px solid hsl(var(--input));
    border-radius: 50%;
    background: hsl(var(--background));
    cursor: pointer;
    flex-shrink: 0;
  }

  .radio-input:checked {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary));
    box-shadow: inset 0 0 0 3px hsl(var(--background));
  }

  .radio-input:focus-visible {
    outline: none;
    ring: 2px solid hsl(var(--ring));
  }

  .radio-label {
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 14px;
    color: hsl(var(--foreground));
    padding: 0;
  }

  .radio-label:hover {
    text-decoration: underline;
  }

  /* Icons in buttons */
  :global(.node-content .icon) {
    font-size: 12px;
    margin-right: 4px;
  }

  /* Children container */
  .node-children {
    border-left: 1px solid hsl(var(--border) / 0.5);
    margin-left: calc(var(--indent, 0px) + 10px);
  }

  .inline-children {
    border-left: none;
    margin-left: 0;
  }
</style>
