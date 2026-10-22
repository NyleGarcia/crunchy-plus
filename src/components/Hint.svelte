<script lang="ts">
  /**
   * Tooltip wrapper: `<Hint text="…">anything</Hint>` renders the children in a span that shows `text` on hover.
   * The span itself is not a tab stop (like the `title=` attributes it replaces), so wrapping a Button or a Checkbox
   * label adds no extra focus stop.
   */
  import type { Snippet } from 'svelte';
  import * as Tooltip from '@/components/ui/tooltip';

  let { text, class: className = '', children }: { text: string; class?: string; children: Snippet } = $props();
</script>

<Tooltip.Root>
  <Tooltip.Trigger tabindex={-1}>
    {#snippet child({ props })}
      <span {...props} class={className}>{@render children()}</span>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content class="max-w-xs text-pretty">{text}</Tooltip.Content>
</Tooltip.Root>
