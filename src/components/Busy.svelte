<script lang="ts">
  /** Inline progress line: spinner + the background's `cr:progress` label (or a fallback). */
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  let { label, fallback = 'Loading…' }: { label: string; fallback?: string } = $props();
</script>

<p class="text-muted-foreground flex items-center gap-2" role="status">
  <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
  {label || fallback}
</p>
