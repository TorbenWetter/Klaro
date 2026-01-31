<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import type { ContentBlock } from '$lib/schemas/landmark-section';
  import type { ActionBinding, UINode } from '$lib/schemas/accessible-ui';
  import { fingerprintToUINode, landmarksStore } from '../stores/landmarks.svelte';

  interface Props {
    blocks: ContentBlock[];
    onAction: (binding: ActionBinding) => void;
    onInputChange: (elementId: string, value: string) => void;
    onToggleCheckbox: (elementId: string, checked: boolean) => void;
    onSelectChange: (elementId: string, value: string) => void;
    elementStates?: Map<string, Record<string, unknown>>;
  }

  let {
    blocks,
    onAction,
    onInputChange,
    onToggleCheckbox,
    onSelectChange,
    elementStates = new Map(),
  }: Props = $props();

  /** Group radio buttons by name and identify which have been rendered */
  interface RadioGroupInfo {
    name: string;
    label: string;
    options: Array<{
      elementId: string;
      label: string;
      value: string;
      checked: boolean;
    }>;
  }

  /** Process blocks to identify and group radio buttons */
  const processedBlocks = $derived(() => {
    const radioGroups = new Map<string, RadioGroupInfo>();
    const renderedRadioGroups = new Set<string>();
    const result: Array<{
      block: ContentBlock;
      isRadioGroup: boolean;
      radioGroup?: RadioGroupInfo;
      skipRender?: boolean;
    }> = [];

    // First pass: identify all radio buttons and their groups
    for (const block of blocks) {
      if (block.type === 'element') {
        const state = elementStates.get(block.elementId);
        // Check both state.radioGroup (from content.ts) and fingerprint.name (from fingerprinting)
        const radioGroupName =
          (state?.radioGroup as string | undefined) ||
          (block.fingerprint?.inputType === 'radio' ? block.fingerprint?.name : undefined);

        if (radioGroupName && block.fingerprint?.inputType === 'radio') {
          if (!radioGroups.has(radioGroupName)) {
            radioGroups.set(radioGroupName, {
              name: radioGroupName,
              label: formatRadioGroupLabel(radioGroupName),
              options: [],
            });
          }

          const group = radioGroups.get(radioGroupName)!;
          group.options.push({
            elementId: block.elementId,
            label: block.fingerprint?.ariaLabel || block.fingerprint?.textContent || 'Option',
            value: block.fingerprint?.value || block.elementId,
            checked: (state?.checked as boolean) || false,
          });
        }
      }
    }

    // Second pass: build processed blocks
    for (const block of blocks) {
      if (block.type === 'element') {
        const state = elementStates.get(block.elementId);
        const radioGroupName =
          (state?.radioGroup as string | undefined) ||
          (block.fingerprint?.inputType === 'radio' ? block.fingerprint?.name : undefined);

        if (radioGroupName && block.fingerprint?.inputType === 'radio') {
          // This is a radio button - only render the group once
          if (!renderedRadioGroups.has(radioGroupName)) {
            renderedRadioGroups.add(radioGroupName);
            result.push({
              block,
              isRadioGroup: true,
              radioGroup: radioGroups.get(radioGroupName),
            });
          } else {
            // Skip subsequent radio buttons in the same group
            result.push({ block, isRadioGroup: false, skipRender: true });
          }
        } else {
          result.push({ block, isRadioGroup: false });
        }
      } else {
        result.push({ block, isRadioGroup: false });
      }
    }

    return result;
  });

  /** Format radio group name to a user-friendly label */
  function formatRadioGroupLabel(name: string): string {
    // Convert camelCase or snake_case to Title Case
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/^\s+/, '')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /** Get the UINode for an element block */
  function getUINode(block: ContentBlock & { type: 'element' }): UINode {
    // If node is already set, use it
    if (block.node) return block.node;

    // Convert from fingerprint
    if (block.fingerprint) {
      const decision = landmarksStore.getElementDecision(block.elementId);
      return fingerprintToUINode(block.fingerprint, decision);
    }

    // Fallback
    return {
      type: 'button',
      label: 'Unknown',
      actionBinding: { elementId: block.elementId, action: 'click' },
    };
  }

  /** Get element state value */
  function getStateValue(elementId: string, key: string): unknown {
    return elementStates.get(elementId)?.[key];
  }

  /** Handle action with binding */
  function handleAction(node: UINode): void {
    if ('actionBinding' in node && node.actionBinding) {
      onAction(node.actionBinding);
    }
  }

  /** Handle input change */
  function handleInput(elementId: string, event: Event): void {
    const target = event.target as HTMLInputElement;
    onInputChange(elementId, target.value);
  }

  /** Set initial value without making input controlled */
  function setInitialValue(
    node: HTMLInputElement | HTMLTextAreaElement,
    value: string | undefined
  ) {
    if (value !== undefined && value !== '') {
      node.value = value;
    }

    return {
      update(newValue: string | undefined) {
        // Only update if not focused
        if (document.activeElement !== node && newValue !== undefined) {
          node.value = newValue;
        }
      },
    };
  }
</script>

<div class="section-content space-y-4">
  {#each processedBlocks() as { block, isRadioGroup, radioGroup, skipRender } (block.type === 'element' ? `${block.elementId}-${block.node?.label || block.fingerprint?.textContent || ''}` : `${block.type}-${block.type === 'heading' ? block.text : block.type === 'text' ? block.content?.slice(0, 20) : ''}`)}
    {#if skipRender}
      <!-- Skip - radio button already rendered as part of group -->
    {:else if block.type === 'heading'}
      <!-- Heading -->
      {#if block.level === 1}
        <h1 class="text-2xl font-bold mt-2">{block.text}</h1>
      {:else if block.level === 2}
        <h2 class="text-xl font-semibold mt-2">{block.text}</h2>
      {:else if block.level === 3}
        <h3 class="text-lg font-semibold mt-1">{block.text}</h3>
      {:else if block.level === 4}
        <h4 class="text-base font-medium mt-1">{block.text}</h4>
      {:else}
        <h5 class="text-sm font-medium mt-1">{block.text}</h5>
      {/if}
    {:else if block.type === 'text'}
      <!-- Text paragraph -->
      <p class="text-base leading-relaxed text-muted-foreground">{block.content}</p>
    {:else if isRadioGroup && radioGroup}
      <!-- Radio Group -->
      <fieldset class="space-y-3">
        <legend class="text-sm font-medium text-foreground mb-2">{radioGroup.label}</legend>
        {#each radioGroup.options as option}
          <div class="flex items-center gap-3">
            <input
              type="radio"
              name={radioGroup.name}
              id={`radio-${option.elementId}`}
              value={option.value}
              checked={option.checked}
              class="h-4 w-4 text-primary border-input focus:ring-ring"
              onchange={() => onToggleCheckbox(option.elementId, true)}
            />
            <label for={`radio-${option.elementId}`} class="text-base cursor-pointer">
              {option.label}
            </label>
          </div>
        {/each}
      </fieldset>
    {:else if block.type === 'element'}
      <!-- Interactive element -->
      <!-- Use fingerprint timestamp in key to force re-render when fingerprint updates -->
      {#key block.fingerprint?.timestamp}
        {@const node = getUINode(block)}
        {@const elementId = block.elementId}
        {@const stateValue = getStateValue(elementId, 'value')}
        {@const stateChecked = getStateValue(elementId, 'checked')}

        {#if node.type === 'button'}
          <Button
            variant={node.variant || 'default'}
            size="default"
            class="w-full justify-start"
            disabled={node.disabled}
            onclick={() => handleAction(node)}
          >
            {node.label}
          </Button>
        {:else if node.type === 'input'}
          <div class="space-y-2">
            <Label>{node.label}</Label>
            <input
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              type={node.inputType || 'text'}
              placeholder={node.placeholder}
              disabled={node.disabled}
              oninput={(e) => handleInput(elementId, e)}
              onfocus={() => handleAction(node)}
              use:setInitialValue={typeof stateValue === 'string' ? stateValue : node.value}
            />
          </div>
        {:else if node.type === 'textarea'}
          <div class="space-y-2">
            <Label>{node.label}</Label>
            <textarea
              class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={node.placeholder}
              rows={node.rows || 3}
              disabled={node.disabled}
              oninput={(e) => handleInput(elementId, e)}
              onfocus={() => handleAction(node)}
              use:setInitialValue={typeof stateValue === 'string' ? stateValue : node.value}
            ></textarea>
          </div>
        {:else if node.type === 'checkbox'}
          <div class="flex items-center gap-3">
            <Checkbox
              checked={typeof stateChecked === 'boolean' ? stateChecked : node.checked}
              disabled={node.disabled}
              onCheckedChange={(checked) => onToggleCheckbox(elementId, Boolean(checked))}
            />
            <Label
              class="cursor-pointer"
              onclick={() => onToggleCheckbox(elementId, !stateChecked)}
            >
              {node.label}
            </Label>
          </div>
        {:else if node.type === 'switch'}
          <div class="flex items-center gap-3">
            <Checkbox
              checked={typeof stateChecked === 'boolean' ? stateChecked : node.checked}
              disabled={node.disabled}
              onCheckedChange={(checked) => onToggleCheckbox(elementId, Boolean(checked))}
            />
            <Label>{node.label}</Label>
          </div>
        {:else if node.type === 'select'}
          <!-- Actual select dropdown -->
          {@const stateOptions = elementStates.get(elementId)?.options as
            | Array<{ value: string; label: string; selected?: boolean }>
            | undefined}
          {@const options = stateOptions || node.options || []}
          <div class="space-y-2">
            <Label>{node.label}</Label>
            <select
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={node.disabled}
              value={typeof stateValue === 'string' ? stateValue : ''}
              onchange={(e) => onSelectChange(elementId, (e.target as HTMLSelectElement).value)}
              onfocus={() => handleAction(node)}
            >
              {#each options as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
        {:else}
          <!-- Fallback for unknown types -->
          <Button variant="outline" class="w-full justify-start" onclick={() => handleAction(node)}>
            {'label' in node ? node.label : 'Unknown element'}
          </Button>
        {/if}
      {/key}
    {/if}
  {/each}

  {#if processedBlocks().filter((b) => !b.skipRender).length === 0}
    <p class="text-sm text-muted-foreground italic">No content in this section.</p>
  {/if}
</div>
