<script lang="ts">
  import type { QueuedChange } from '../../../utils/reactive-messages';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';

  interface Props {
    changes: QueuedChange[];
    onAccept: (changeId: string) => void;
    onReject: (changeId: string) => void;
    onAcceptAll: () => void;
    onRejectAll: () => void;
  }

  let { changes, onAccept, onReject, onAcceptAll, onRejectAll }: Props = $props();

  const pendingChanges = $derived(changes.filter(c => c.status === 'pending'));
  const processingChanges = $derived(changes.filter(c => c.status === 'processing'));
  const totalTokens = $derived(pendingChanges.reduce((sum, c) => sum + c.estimatedTokens, 0));

  function formatTimestamp(ts: number): string {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(ts).toLocaleTimeString();
  }

  function formatTokens(tokens: number): string {
    if (tokens < 1000) return `~${tokens} tokens`;
    return `~${(tokens / 1000).toFixed(1)}k tokens`;
  }
</script>

{#if pendingChanges.length > 0 || processingChanges.length > 0}
  <div class="change-queue border-b bg-muted/50 p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <Badge variant="outline" class="text-xs">
          {pendingChanges.length} pending
        </Badge>
        {#if processingChanges.length > 0}
          <Badge variant="secondary" class="text-xs animate-pulse">
            {processingChanges.length} processing
          </Badge>
        {/if}
        <span class="text-xs text-muted-foreground">
          {formatTokens(totalTokens)}
        </span>
      </div>
      
      {#if pendingChanges.length > 1}
        <div class="flex gap-1">
          <Button 
            variant="ghost" 
            size="sm" 
            class="h-6 text-xs"
            onclick={() => onAcceptAll()}
          >
            Accept all
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            class="h-6 text-xs text-muted-foreground"
            onclick={() => onRejectAll()}
          >
            Dismiss all
          </Button>
        </div>
      {/if}
    </div>

    <div class="space-y-2 max-h-48 overflow-y-auto">
      {#each changes as change (change.id)}
        <Card.Root class="p-2 {change.status === 'processing' ? 'opacity-70' : ''}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{change.description}</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-xs text-muted-foreground">
                  {change.elementCount} elements
                </span>
                <span class="text-xs text-muted-foreground">•</span>
                <span class="text-xs text-muted-foreground">
                  {formatTokens(change.estimatedTokens)}
                </span>
                <span class="text-xs text-muted-foreground">•</span>
                <span class="text-xs text-muted-foreground">
                  {formatTimestamp(change.timestamp)}
                </span>
              </div>
            </div>
            
            {#if change.status === 'pending'}
              <div class="flex gap-1 shrink-0">
                <Button 
                  variant="default" 
                  size="sm" 
                  class="h-7 px-2 text-xs"
                  onclick={() => onAccept(change.id)}
                >
                  Process
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  class="h-7 px-2 text-xs"
                  onclick={() => onReject(change.id)}
                >
                  ✕
                </Button>
              </div>
            {:else if change.status === 'processing'}
              <Badge variant="secondary" class="text-xs animate-pulse shrink-0">
                Processing...
              </Badge>
            {:else if change.status === 'completed'}
              <Badge variant="default" class="text-xs shrink-0">
                Done
              </Badge>
            {/if}
          </div>
        </Card.Root>
      {/each}
    </div>
  </div>
{/if}
