<script lang="ts">
  import type { UINode, ActionBinding } from '$lib/schemas/accessible-ui';
  
  // Import shadcn components
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import { Progress } from '$lib/components/ui/progress';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import * as Accordion from '$lib/components/ui/accordion';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Table from '$lib/components/ui/table';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { ScrollArea } from '$lib/components/ui/scroll-area';

  // Self-import for recursive rendering
  import Self from './UIRenderer.svelte';

  interface Props {
    /** The UI nodes to render */
    nodes: UINode[];
    /** Callback when an action is triggered (click) */
    onAction?: (binding: ActionBinding) => void;
    /** Callback when an input value changes */
    onInputChange?: (elementId: string, value: string) => void;
    /** Callback when a checkbox/switch is toggled */
    onToggle?: (elementId: string, checked: boolean) => void;
  }

  let { nodes, onAction, onInputChange, onToggle }: Props = $props();

  function handleAction(binding: ActionBinding | undefined) {
    if (binding && onAction) {
      onAction(binding);
    }
  }

  function handleInputChange(binding: ActionBinding | undefined, value: string) {
    console.log('[UIRenderer] handleInputChange:', { binding, value, hasOnInputChange: !!onInputChange });
    if (binding && onInputChange) {
      onInputChange(binding.elementId, value);
    } else if (!binding) {
      console.warn('[UIRenderer] No actionBinding for input!');
    }
  }

  function handleToggle(binding: ActionBinding | undefined, checked: boolean) {
    if (binding && onToggle) {
      onToggle(binding.elementId, checked);
    }
  }

  // Helper to get select value for single select
  function getSelectValue(node: { defaultValue?: string; options: Array<{ value: string; label: string }> }) {
    if (!node.defaultValue) return undefined;
    return node.defaultValue;
  }

  // Debounce helper for input changes
  function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: unknown[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), ms);
    }) as T;
  }
</script>

{#each nodes as node}
  {#if node.type === 'heading'}
    {#if node.level === 1}
      <h1 class="text-2xl font-bold mb-4">{node.text}</h1>
    {:else if node.level === 2}
      <h2 class="text-xl font-semibold mb-3">{node.text}</h2>
    {:else if node.level === 3}
      <h3 class="text-lg font-semibold mb-2">{node.text}</h3>
    {:else if node.level === 4}
      <h4 class="text-base font-medium mb-2">{node.text}</h4>
    {:else if node.level === 5}
      <h5 class="text-sm font-medium mb-1">{node.text}</h5>
    {:else}
      <h6 class="text-sm font-medium mb-1">{node.text}</h6>
    {/if}

  {:else if node.type === 'paragraph'}
    <p class="mb-4 leading-relaxed">{node.text}</p>

  {:else if node.type === 'text'}
    <span class:font-bold={node.bold} class:italic={node.italic}>{node.text}</span>

  {:else if node.type === 'alert'}
    <Alert.Root variant={node.variant} class="mb-4">
      {#if node.title}
        <Alert.Title>{node.title}</Alert.Title>
      {/if}
      <Alert.Description>{node.description}</Alert.Description>
    </Alert.Root>

  {:else if node.type === 'badge'}
    <Badge variant={node.variant} class="mb-2">{node.text}</Badge>

  {:else if node.type === 'progress'}
    <div class="mb-4">
      {#if node.label}
        <Label class="mb-2">{node.label}</Label>
      {/if}
      <Progress value={node.value} max={100} />
    </div>

  {:else if node.type === 'separator'}
    <Separator orientation={node.orientation} class="my-4" />

  {:else if node.type === 'button'}
    <Button
      variant={node.variant}
      size={node.size}
      disabled={node.disabled}
      onclick={() => handleAction(node.actionBinding)}
      class="mb-2 mr-2"
    >
      {node.label}
    </Button>

  {:else if node.type === 'input'}
    <div class="mb-4">
      <Label class="mb-2">{node.label}</Label>
      <Input
        type={node.inputType ?? 'text'}
        placeholder={node.placeholder}
        value={node.value}
        disabled={node.disabled}
        required={node.required}
        onfocus={() => handleAction(node.actionBinding)}
        oninput={(e: Event) => {
          const target = e.target as HTMLInputElement;
          handleInputChange(node.actionBinding, target.value);
        }}
      />
    </div>

  {:else if node.type === 'textarea'}
    <div class="mb-4">
      <Label class="mb-2">{node.label}</Label>
      <Textarea
        placeholder={node.placeholder}
        value={node.value}
        rows={node.rows}
        disabled={node.disabled}
        required={node.required}
        onfocus={() => handleAction(node.actionBinding)}
        oninput={(e: Event) => {
          const target = e.target as HTMLTextAreaElement;
          handleInputChange(node.actionBinding, target.value);
        }}
      />
    </div>

  {:else if node.type === 'checkbox'}
    <div class="flex items-center gap-2 mb-3">
      <Checkbox
        checked={node.checked}
        disabled={node.disabled}
        onCheckedChange={(checked: boolean) => handleToggle(node.actionBinding, checked)}
      />
      <Label>{node.label}</Label>
    </div>

  {:else if node.type === 'switch'}
    <div class="flex items-center gap-2 mb-3">
      <Switch
        checked={node.checked}
        disabled={node.disabled}
        onCheckedChange={(checked: boolean) => handleToggle(node.actionBinding, checked)}
      />
      <Label>{node.label}</Label>
    </div>

  {:else if node.type === 'radioGroup'}
    <div class="mb-4">
      <Label class="mb-2">{node.label}</Label>
      <RadioGroup.Root
        value={node.defaultValue}
        disabled={node.disabled}
        onValueChange={() => handleAction(node.actionBinding)}
      >
        {#each node.options as option}
          <div class="flex items-center gap-2">
            <RadioGroup.Item value={option.value} disabled={option.disabled} />
            <Label>{option.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>

  {:else if node.type === 'select'}
    <div class="mb-4">
      <Label class="mb-2">{node.label}</Label>
      <Select.Root
        type="single"
        value={getSelectValue(node)}
        disabled={node.disabled}
        onValueChange={() => handleAction(node.actionBinding)}
      >
        <Select.Trigger class="w-full">
          {node.placeholder ?? 'Select an option'}
        </Select.Trigger>
        <Select.Content>
          {#each node.options as option}
            <Select.Item value={option.value} label={option.label} disabled={option.disabled}>
              {option.label}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

  {:else if node.type === 'breadcrumb'}
    <nav aria-label="Breadcrumb" class="mb-4">
      <ol class="flex items-center gap-2 text-sm">
        {#each node.items as item, i}
          <li class="flex items-center gap-2">
            {#if item.isCurrent}
              <span class="font-medium" aria-current="page">{item.label}</span>
            {:else}
              <button
                class="text-muted-foreground hover:text-foreground transition-colors"
                onclick={() => handleAction(item.actionBinding)}
              >
                {item.label}
              </button>
            {/if}
            {#if i < node.items.length - 1}
              <span class="text-muted-foreground">/</span>
            {/if}
          </li>
        {/each}
      </ol>
    </nav>

  {:else if node.type === 'navigationMenu'}
    <nav class="mb-4" aria-label="Navigation">
      <ul class="flex {node.orientation === 'vertical' ? 'flex-col' : 'flex-row'} gap-2">
        {#each node.items as item}
          <li>
            <button
              class="px-3 py-2 rounded-md transition-colors {item.active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50'}"
              onclick={() => handleAction(item.actionBinding)}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </button>
          </li>
        {/each}
      </ul>
    </nav>

  {:else if node.type === 'pagination'}
    <nav aria-label="Pagination" class="flex items-center gap-2 mb-4">
      <Button
        variant="outline"
        size="sm"
        disabled={node.currentPage <= 1}
        onclick={() => handleAction(node.actionBinding)}
      >
        Previous
      </Button>
      <span class="text-sm">
        Page {node.currentPage} of {node.totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={node.currentPage >= node.totalPages}
        onclick={() => handleAction(node.actionBinding)}
      >
        Next
      </Button>
    </nav>

  {:else if node.type === 'table'}
    <div class="mb-4 overflow-auto">
      <Table.Root>
        {#if node.caption}
          <Table.Caption>{node.caption}</Table.Caption>
        {/if}
        {#if node.headers}
          <Table.Header>
            <Table.Row>
              {#each node.headers as header}
                <Table.Head>{header}</Table.Head>
              {/each}
            </Table.Row>
          </Table.Header>
        {/if}
        <Table.Body>
          {#each node.rows as row}
            <Table.Row>
              {#each row.cells as cell}
                {#if cell.isHeader}
                  <Table.Head>{cell.content}</Table.Head>
                {:else}
                  <Table.Cell>{cell.content}</Table.Cell>
                {/if}
              {/each}
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>

  {:else if node.type === 'card'}
    <Card.Root class="mb-4">
      {#if node.title || node.description}
        <Card.Header>
          {#if node.title}
            <Card.Title>{node.title}</Card.Title>
          {/if}
          {#if node.description}
            <Card.Description>{node.description}</Card.Description>
          {/if}
        </Card.Header>
      {/if}
      <Card.Content>
        <Self nodes={node.children} {onAction} {onInputChange} {onToggle} />
      </Card.Content>
    </Card.Root>

  {:else if node.type === 'accordion'}
    <Accordion.Root type={node.multiple ? 'multiple' : 'single'} class="mb-4">
      {#each node.items as item, i}
        <Accordion.Item value={`item-${i}`}>
          <Accordion.Trigger>{item.title}</Accordion.Trigger>
          <Accordion.Content>
            <Self nodes={item.content} {onAction} {onInputChange} {onToggle} />
          </Accordion.Content>
        </Accordion.Item>
      {/each}
    </Accordion.Root>

  {:else if node.type === 'tabs'}
    <Tabs.Root value={node.defaultTab ?? node.items[0]?.id} class="mb-4">
      <Tabs.List>
        {#each node.items as item}
          <Tabs.Trigger value={item.id}>{item.label}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      {#each node.items as item}
        <Tabs.Content value={item.id}>
          <Self nodes={item.content} {onAction} {onInputChange} {onToggle} />
        </Tabs.Content>
      {/each}
    </Tabs.Root>

  {:else if node.type === 'scrollArea'}
    <ScrollArea class="mb-4" style={node.maxHeight ? `max-height: ${node.maxHeight}` : undefined}>
      <Self nodes={node.children} {onAction} {onInputChange} {onToggle} />
    </ScrollArea>
  {/if}
{/each}
