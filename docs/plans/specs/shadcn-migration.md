---
title: "Spec: shadcn-svelte migration (hub + popup)"
tags: [plans, spec, ui]
updated: 2026-10-13
status: done
---
# Spec: shadcn-svelte migration (hub + popup)

Decision (2026-10-13): stop hand-making UI for the extension pages. The hub and the popup move to **shadcn-svelte** (bits-ui primitives, Tailwind v4, copy-in components under `src/components/ui/`), following the RSI+ migration (`~/git/rsi-plus/docs/plans/specs/shadcn-migration.md`) and the playbook in `~/docs/projects/wxt-extensions/shadcn-svelte-wxt-playbook.md`. Crunchyroll's own pages are untouched: the content script (`crunchyroll.content/`, `theme.css`, `badges.ts`) and the MAIN-world hook stay vanilla and scoped, and the two Svelte components mounted in content-script shadow roots (`Widget.svelte`, `UpNextRow.svelte`) keep their own scoped CSS — Tailwind is never injected into crunchyroll.com, and bits-ui portals (Select, Tooltip) would render outside the shadow root anyway.

## Foundation
- `tailwindcss` + `@tailwindcss/vite` in `wxt.config.ts` (`vite: () => ({ plugins: [tailwindcss()] })`).
- `components.json` and `src/lib/utils.ts` (`cn`, `WithElementRef`, `WithoutChild*`) hand-written (the CLI's `init` hangs without a TTY); components added with `npx shadcn-svelte@latest add -y --skip-preflight --no-deps-install …` then `npm install`.
- `src/shadcn.css` = the CLI's `dist/tailwind.css` (custom variants `data-active:` / `data-open:` / `data-checked:` / `data-horizontal:` … that the kit's classes rely on). Re-copy when upgrading the CLI.
- `src/app.css`: Tailwind + `tw-animate-css` + `shadcn.css` + the old `base.css` palette as shadcn tokens, dark-only (`color-scheme: dark`): `--background #0b0c10`, `--card #14161c`, `--popover #1c1f27`, `--primary #ff7a1a` (brand orange) with `--primary-foreground #160b02`, `--muted-foreground #9da1b0`, `--destructive #ff5470`, plus `--success #3ddc97`, `--warning #ffb454`, and legacy aliases (`--bg`, `--surface`, `--line`, `--text`, `--ok`, `--err`). Base layer restores `button { cursor: pointer }` and `a { color: primary }` from the old base.css. Imported by `entrypoints/hub/main.ts` and `entrypoints/popup/main.ts` **only**.
- Installed: `badge button card checkbox collapsible command input select separator switch table tabs toggle toggle-group tooltip` (+ `dialog`, `input-group`, `textarea` pulled in as dependencies of `command`). `popover`, `progress`, `label`, `skeleton` were added and pruned again as nothing used them; no charts in Crunchy+, so no `chart` / LayerChart.
- `@lucide/svelte` icons instead of glyphs (▶ → `Play`, ✓ → `Check`, ↓ → `ArrowDown`, +/− → `Plus`/`Minus`, ⚠ → `TriangleAlert`, spinner → `LoaderCircle`).
- One `Tooltip.Provider` at each page root (`Hub.svelte`, popup `App.svelte`).

## Shared components (`src/components/`)
- `Segmented.svelte` — radio-style control on `ToggleGroup type="single"` with a sliding brand-coloured pill; keyboard = arrows / Home / End; clicking the active option keeps it; optional `count` per option (filter chips) and `grow` (equal widths). Replaces every `.seg` radiogroup.
- `Hint.svelte` — `Tooltip` wrapper (`<Hint text="…">…</Hint>`) replacing `title=` attributes; the trigger span is not a tab stop, like `title` was.
- `Busy.svelte` — spinner + the background's `cr:progress` label.

## Conversions
| File | Before | After |
|---|---|---|
| `hub/Hub.svelte` | hand-made tablist + `onkeydown` | `Tabs` (3 sections, so no sidebar); `#upnext` / `#import` / `#export` hash routing and arrow / Home / End keys unchanged (bits-ui); inactive panes are not mounted (`{#if tab === id}`) |
| `popup/App.svelte` | `section` boxes, `.seg`, `<select>`, checkboxes, `<details>` | `Card`, `Segmented`, `Select` (dub locale), `Switch` for every settings toggle, `Input`, `Collapsible` (hidden rows, declutter), `Badge`, `Button` (`variant="link"` for the old `.linkish`); `<input type="range">` kept native with `accent-primary` |
| `UpNext.svelte` | `.card` anchors, `.seg`, `.rows` list | Card-styled `<a>` tiles with a `Play` icon, `Segmented`, `Badge` ("N to watch"), `Table` for the caught-up list, `Button` Refresh with `RefreshCw` |
| `UndoPanel.svelte` | boxes, `<select>`, `<table>` | `Card` ×2, `Select` for the time window (number ↔ string) and per-row action, `Table`, `Checkbox`, `Button` |
| `ExportPanel.svelte` | `.card`, `<table>` of checkboxes, `<details>`, `.warn` box | `Card`, `Table` + `Checkbox` grid, `Input` hours, `Badge` existing/new, `Collapsible` for unmapped shows, `TriangleAlert` warnings box, `Plus`/`Minus` list icons |
| `ImportPanel.svelte` | rules box, `.seg` filters, `<table>`, hand-made candidate picker | `Card` rules + confirm, `Segmented` filter with counts, `Select` idle status / sort, `Table` (fixed layout; "Now" column hidden below `md`), `Checkbox` rows + backport, `Badge` score pills (success / warning / destructive / violet Jev), `Command` candidate picker (`shouldFilter={false}`; Enter in its input still searches AniList, the Search button too; a candidate is picked by click or Enter on the highlighted row), `Hint` for every former `title` |

Script logic, copy, keyboard shortcuts, `localStorage` / `storage` keys, message types and deep links are unchanged; `npm test` (113 tests), `npm run check` (0 / 0) and `npm run build` are green. Tailwind lands in the shared `assets/plus-*.css` chunk (both pages import it), not in a per-page CSS file.

## Select sentinel
bits-ui `Select` treats `''` as "nothing picked". No hub / popup select has an empty option (the only `''` option, "Not on list", is in the vanilla `Widget.svelte`), so no sentinel was needed; numeric values (undo window hours) are bound through `String(n)` / `Number(v)`.

## Known presentation deltas
- Text links underline on hover only (Tailwind preflight); before, browser default underline.
- Range sliders stay native (`accent-color`), no shadcn `Slider`.
- The import table's "Now" column hides below 768 px (`md`) instead of 720 px.
- Checkboxes are bits-ui buttons (16 px, brand fill), switches replace popup checkboxes.
- Tooltips are styled popovers with a 300 ms delay instead of native `title` bubbles.

## Final pass (done 2026-10-13)
`base.css` deleted (nothing imported it after the pages switched to `app.css`; the content-script components carry their own scoped styles), `docs/architecture.md` "Hub styling" section, changelog, README stack line.
