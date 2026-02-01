<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import type { DisplayGroup, ElementRef, TrackedElementData } from '$lib/schemas/semantic-groups';
  import { isElementRef, isDisplayGroup } from '$lib/schemas/semantic-groups';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';
  // Self-import for nested groups
  import GroupNode from './GroupNode.svelte';

  interface Props {
    /** The group to render */
    group: DisplayGroup;
    /** Depth for styling (0 = top level) */
    depth?: number;
    /** Get element data by ID */
    getElement: (id: string) => TrackedElementData | undefined;
    /** Handlers */
    onToggleGroup: (groupId: string) => void;
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
    onScrollTo: (elementId: string) => void;
  }

  let {
    group,
    depth = 0,
    getElement,
    onToggleGroup,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    onScrollTo,
  }: Props = $props();

  /** Whether group has any children */
  const hasChildren = $derived(group.children.length > 0);

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

  /** Get icon for element */
  function getElementIcon(element: TrackedElementData): string {
    if (element.interactiveType) {
      return interactiveIcons[element.interactiveType] || '🔘';
    }
    if (element.headingLevel) {
      return `H${element.headingLevel}`;
    }
    if (element.nodeType === 'media') {
      return '🖼️';
    }
    if (element.nodeType === 'text') {
      return '📝';
    }
    return '📄';
  }

  /** Handle click on group header */
  function handleGroupClick(): void {
    onToggleGroup(group.id);
  }

  /** Handle action for interactive elements */
  function handleAction(elementId: string): void {
    const binding: ActionBinding = {
      elementId,
      action: 'click',
    };
    onAction(binding);
  }

  /** Handle input change */
  function handleInput(elementId: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    onInputChange(elementId, target.value);
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

<div class="group-node" class:nested={depth > 0}>
  <!-- Group Header -->
  <button class="group-header" onclick={handleGroupClick} aria-expanded={group.isExpanded}>
    <span class="chevron" class:expanded={group.isExpanded}>▶</span>
    <span class="group-name">{group.name}</span>
  </button>

  <!-- Group Content -->
  {#if group.isExpanded && hasChildren}
    <div class="group-content" transition:slide={{ duration: 120 }}>
      {#each group.children as child}
        {#if isDisplayGroup(child)}
          <!-- Nested Group -->
          <GroupNode
            group={child}
            depth={depth + 1}
            {getElement}
            {onToggleGroup}
            {onAction}
            {onInputChange}
            {onToggleCheckbox}
            {onSelectChange}
            {onScrollTo}
          />
        {:else if isElementRef(child)}
          <!-- Element -->
          {@const element = getElement(child.elementId)}
          {#if element}
            <div class="element-item">
              {#if element.nodeType === 'interactive'}
                <!-- Interactive Elements -->
                {#if element.interactiveType === 'button' || element.interactiveType === 'link'}
                  <Button
                    variant={element.interactiveType === 'link' ? 'link' : 'default'}
                    size="sm"
                    class="w-full justify-start text-left h-auto py-1.5 px-3"
                    onclick={() => handleAction(element.id)}
                  >
                    <span class="icon">{getElementIcon(element)}</span>
                    <span class="label">{truncate(element.label)}</span>
                  </Button>
                {:else if element.interactiveType === 'input'}
                  <div class="input-wrapper">
                    <Label class="text-xs text-muted-foreground"
                      >{truncate(element.label, 30)}</Label
                    >
                    <input
                      class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      type="text"
                      placeholder={element.placeholder}
                      oninput={(e) => handleInput(element.id, e)}
                      onfocus={() => handleAction(element.id)}
                      use:setInitialValue={element.formState?.value}
                    />
                  </div>
                {:else if element.interactiveType === 'textarea'}
                  <div class="input-wrapper">
                    <Label class="text-xs text-muted-foreground"
                      >{truncate(element.label, 30)}</Label
                    >
                    <textarea
                      class="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                      placeholder={element.placeholder}
                      rows={2}
                      oninput={(e) => handleInput(element.id, e)}
                      onfocus={() => handleAction(element.id)}
                      use:setInitialValue={element.formState?.value}
                    ></textarea>
                  </div>
                {:else if element.interactiveType === 'checkbox'}
                  <div class="checkbox-wrapper">
                    <Checkbox
                      checked={element.formState?.checked ?? false}
                      onCheckedChange={(checked) => onToggleCheckbox(element.id, Boolean(checked))}
                    />
                    <button class="checkbox-label" onclick={() => onScrollTo(element.id)}>
                      {truncate(element.label)}
                    </button>
                  </div>
                {:else if element.interactiveType === 'radio'}
                  <div class="radio-wrapper">
                    <input
                      type="radio"
                      class="radio-input"
                      checked={element.formState?.checked ?? false}
                      onchange={() => onToggleCheckbox(element.id, true)}
                    />
                    <button class="radio-label" onclick={() => onScrollTo(element.id)}>
                      {truncate(element.label)}
                    </button>
                  </div>
                {:else if element.interactiveType === 'select'}
                  <div class="select-wrapper">
                    <Label class="text-xs text-muted-foreground"
                      >{truncate(element.label, 30)}</Label
                    >
                    <select
                      class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={element.formState?.value ?? ''}
                      onchange={(e) =>
                        onSelectChange(element.id, (e.target as HTMLSelectElement).value)}
                      onfocus={() => handleAction(element.id)}
                    >
                      {#each element.formState?.options ?? [] as option}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  </div>
                {:else}
                  <!-- Fallback interactive -->
                  <Button
                    variant="outline"
                    size="sm"
                    class="w-full justify-start text-left h-auto py-1.5 px-3"
                    onclick={() => handleAction(element.id)}
                  >
                    <span class="icon">{getElementIcon(element)}</span>
                    <span class="label">{truncate(element.label)}</span>
                  </Button>
                {/if}
              {:else if element.nodeType === 'text'}
                <!-- Text Content -->
                <button class="text-element" onclick={() => onScrollTo(element.id)}>
                  {#if element.headingLevel}
                    <span
                      class="heading"
                      class:h1={element.headingLevel === 1}
                      class:h2={element.headingLevel === 2}
                      class:h3={element.headingLevel === 3}
                    >
                      <span class="heading-level">H{element.headingLevel}</span>
                      {truncate(element.label, 60)}
                    </span>
                  {:else}
                    <span class="text-content">{truncate(element.label, 80)}</span>
                  {/if}
                </button>
              {:else if element.nodeType === 'media'}
                <!-- Media Content -->
                <button class="media-element" onclick={() => onScrollTo(element.id)}>
                  <span class="icon">🖼️</span>
                  <span class="label">{truncate(element.altText || element.label, 40)}</span>
                </button>
              {:else}
                <!-- Other element types -->
                <button class="generic-element" onclick={() => onScrollTo(element.id)}>
                  <span class="icon">{getElementIcon(element)}</span>
                  <span class="label">{truncate(element.label, 50)}</span>
                </button>
              {/if}
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .group-node {
    --transition-duration: 120ms;
  }

  .group-node.nested {
    margin-left: 12px;
    border-left: 1px solid hsl(var(--border) / 0.4);
    padding-left: 8px;
  }

  /* Group Header */
  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: hsl(var(--muted) / 0.3);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-duration);
  }

  .group-header:hover {
    background: hsl(var(--muted) / 0.6);
  }

  .chevron {
    font-size: 10px;
    color: hsl(var(--muted-foreground));
    transition: transform var(--transition-duration);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .group-name {
    font-weight: 600;
    font-size: 14px;
    color: hsl(var(--foreground));
  }

  /* Group Content */
  .group-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 0 8px 8px;
  }

  /* Element Items */
  .element-item {
    padding: 2px 4px;
  }

  .element-item:hover {
    background: hsl(var(--muted) / 0.3);
    border-radius: 4px;
  }

  /* Text Elements */
  .text-element {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 4px 8px;
    font-size: 14px;
    color: hsl(var(--foreground));
    width: 100%;
    border-radius: 4px;
  }

  .text-element:hover {
    background: hsl(var(--muted) / 0.4);
  }

  .heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .heading-level {
    font-size: 10px;
    padding: 2px 5px;
    background: hsl(var(--muted));
    border-radius: 4px;
    color: hsl(var(--muted-foreground));
    font-weight: 500;
  }

  .heading.h1 {
    font-size: 17px;
  }

  .heading.h2 {
    font-size: 15px;
  }

  .heading.h3 {
    font-size: 14px;
  }

  .text-content {
    color: hsl(var(--muted-foreground));
    font-size: 13px;
  }

  /* Media Elements */
  .media-element {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 4px 8px;
    font-size: 13px;
    color: hsl(var(--muted-foreground));
    width: 100%;
    border-radius: 4px;
  }

  .media-element:hover {
    background: hsl(var(--muted) / 0.4);
  }

  /* Generic Elements */
  .generic-element {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 4px 8px;
    font-size: 14px;
    color: hsl(var(--foreground));
    width: 100%;
    border-radius: 4px;
  }

  .generic-element:hover {
    background: hsl(var(--muted) / 0.4);
  }

  /* Form Elements */
  .input-wrapper,
  .select-wrapper {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 4px 8px;
  }

  .checkbox-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
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
    gap: 10px;
    padding: 6px 8px;
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

  /* Icons */
  .icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
