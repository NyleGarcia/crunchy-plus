<script lang="ts" generics="V extends string | number">
  /**
   * Segmented control on shadcn ToggleGroup (type="single"): a radio group of a few options with a pill that slides to
   * the selection. Arrow keys / Home / End move the selection; `hint` is the tooltip. Clicking the active option keeps it
   * (no empty state). Ids may be numbers — the ToggleGroup works on their string form. `count` renders a small number
   * after the label (filter chips); `grow` stretches the options to equal widths.
   */
  import * as ToggleGroup from '@/components/ui/toggle-group';
  import { cn } from '@/lib/utils';

  let {
    options,
    value = $bindable(),
    ariaLabel,
    size = 'md',
    grow = false,
    class: className = '',
    onchange,
  }: {
    options: { id: V; label: string; hint?: string; count?: number }[];
    value: V;
    ariaLabel: string;
    size?: 'sm' | 'md';
    grow?: boolean;
    class?: string;
    onchange?: (v: V) => void;
  } = $props();

  let root = $state<HTMLElement | null>(null);
  let pill = $state({ x: 0, w: 0, ready: false });

  function measure() {
    const el = root?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el || !root) return (pill = { ...pill, ready: false });
    pill = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
  }
  $effect(() => {
    void value;
    void options.length;
    requestAnimationFrame(measure);
  });
  $effect(() => {
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  });
  function set(v: V) {
    if (v === value) return;
    value = v;
    onchange?.(v);
  }
  /** ToggleGroup speaks strings; map back to the option id (and ignore the "deselect" that clicking the active one sends). */
  function fromString(s: string) {
    const o = options.find((x) => String(x.id) === s);
    if (o) set(o.id);
  }
  function onKey(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.id === value);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = options.length - 1;
    if (n < 0) return;
    e.preventDefault();
    set(options[n]!.id);
    root?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.focus();
  }
</script>

<ToggleGroup.Root
  type="single"
  bind:ref={root}
  bind:value={() => String(value), (s: string) => fromString(s)}
  rovingFocus={false}
  aria-label={ariaLabel}
  class={cn(
    'relative max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-border bg-white/[0.03] p-[3px] [scrollbar-width:none]',
    grow && 'w-full',
    className,
  )}
>
  <span
    class={cn(
      'pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-[7px] bg-primary opacity-0 shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-[transform,width,opacity] duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
      pill.ready && 'opacity-100',
    )}
    style="transform: translateX({pill.x}px); width: {pill.w}px"
    aria-hidden="true"
  ></span>
  {#each options as o, i (o.id)}
    <ToggleGroup.Item value={String(o.id)} title={o.hint} data-i={i} onkeydown={onKey}>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          tabindex={o.id === value ? 0 : -1}
          class={cn(
            'relative z-[1] rounded-[7px] border-0 bg-transparent font-semibold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 data-[state=on]:text-primary-foreground',
            size === 'sm' ? 'px-[9px] py-[3px] text-xs' : 'px-[11px] py-[5px] text-[12.5px]',
            grow && 'flex-1',
          )}
        >
          {o.label}{#if o.count != null}<small class="ml-1 opacity-75">{o.count}</small>{/if}
        </button>
      {/snippet}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
