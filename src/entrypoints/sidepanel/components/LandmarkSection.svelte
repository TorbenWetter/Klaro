<script lang="ts">
  import { slide } from 'svelte/transition';
  import { Badge } from '$lib/components/ui/badge';
  import SectionContent from './SectionContent.svelte';
  import type { LandmarkSection } from '$lib/schemas/landmark-section';
  import type { ActionBinding } from '$lib/schemas/accessible-ui';

  interface Props {
    section: LandmarkSection;
    onToggle: (sectionId: string) => void;
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
    /** Element states for form synchronization */
    elementStates?: Map<string, Record<string, unknown>>;
  }

  let {
    section,
    onToggle,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    elementStates = new Map(),
  }: Props = $props();

  /** Icon for the landmark type */
  const landmarkIcons: Record<string, string> = {
    nav: '🧭',
    main: '📄',
    form: '📝',
    search: '🔍',
    header: '🔝',
    footer: '🔚',
    aside: '📎',
    article: '📰',
    section: '📑',
    region: '📍',
    page: '📄',
  };

  const icon = $derived(landmarkIcons[section.landmark] || '📄');
</script>

<div class="landmark-section border-b border-border">
  <!-- Section Header (clickable to toggle) -->
  <button
    class="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
    onclick={() => onToggle(section.id)}
    aria-expanded={section.expanded}
    aria-controls={`section-content-${section.id}`}
  >
    <div class="flex items-center gap-3">
      <!-- Chevron indicator -->
      <span
        class="text-muted-foreground transition-transform duration-200"
        class:rotate-90={section.expanded}
      >
        ▶
      </span>

      <!-- Icon and title -->
      <span class="text-lg" aria-hidden="true">{icon}</span>
      <span class="font-medium">{section.title}</span>
    </div>

    <!-- Item count badge -->
    {#if section.itemCount > 0}
      <Badge variant="secondary" class="ml-2">
        {section.itemCount}
        {section.itemCount === 1 ? 'item' : 'items'}
      </Badge>
    {/if}
  </button>

  <!-- Section Content (collapsible) -->
  {#if section.expanded}
    <div
      id={`section-content-${section.id}`}
      class="px-4 pb-4"
      transition:slide={{ duration: 200 }}
    >
      <!-- Optional description from LLM -->
      {#if section.description}
        <p class="text-sm text-muted-foreground mb-4">{section.description}</p>
      {/if}

      <!-- Content blocks -->
      <SectionContent
        blocks={section.blocks}
        {onAction}
        {onInputChange}
        {onToggleCheckbox}
        {onSelectChange}
        {elementStates}
      />
    </div>
  {/if}
</div>

<style>
  .rotate-90 {
    transform: rotate(90deg);
  }
</style>
