---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Browser TUI library

A reusable `list + preview + actions` browser component in `@poe-code/design-system`, modeled on fzf's interaction loop and Textual's widget/action architecture, replacing the hand-rolled `plan browse` screen and powering future task/package browsers.

## 1. What we're building

A library unit in [packages/design-system/src/](packages/design-system/src/) that provides a generic three-region browser TUI — left sidebar list, main preview pane, action footer — driven by fuzzy filter input and keybind-dispatched actions, built on top of the existing [dashboard](packages/design-system/src/dashboard/) primitives (raw ANSI renderer, `ScreenBuffer`, `createTerminalDriver`, `computeDashboardLayout`).

Consumers of the library (first: [packages/plan-browser/src/browser.ts](packages/plan-browser/src/browser.ts)) declare what is being browsed, not how it is drawn:

- a **list provider** — async iterable of rows + metadata
- a **row formatter** — title, optional second-line metadata, status badge
- a **preview renderer** — given the highlighted row, return ANSI text (markdown plans use the existing [terminal-markdown](packages/design-system/src/terminal-markdown/) renderer)
- an **actions registry** — `{ key, label, predicate, handler }` entries; the footer hint bar, command palette, and dispatch loop all derive from this one source
- a **theme** — reuses the existing [tokens/colors.ts](packages/design-system/src/tokens/colors.ts) palette (accent/muted/success/warning/error/info)

The library handles: layout, focus, fuzzy filtering, async loading + cancellation of preview renders, ANSI passthrough, multi-select, keybind dispatch, `?`-help modal, command palette, confirm modals, narrow-terminal vertical fallback, and the redraw loop (granular dirty regions, not full repaints).

### Non-goals

- Not a generic Textual port. No CSS parser, no DOM, no widget tree — one composite screen with fixed regions.
- Not a replacement for the dashboard. The dashboard remains the streaming-output primitive; the browser is a peer screen built from the same `ScreenBuffer` + driver.
- Not a parallel theme system. Reuses `tokens/colors.ts` as-is; if a gap appears it gets added to the existing token file, not a new one.
- Not multi-screen / no screen stack — one browser screen at a time, plus modal overlays.
- No regex filter mode in v1. Fuzzy only.
- No mouse support in v1.
- No async streaming list updates in v1 — list provider resolves once before render. (Cancellation applies only to preview renders.)
- Existing dashboard consumers ([pipeline.ts](src/cli/commands/pipeline.ts), [experiment.ts](src/cli/commands/experiment.ts)) are not touched.

### Second consumer: GitHub PR review queue

The library must also support a lazygit-style two-pane PR review queue (a separate tool by the same author, [packages/agent-github-review-tools/](packages/agent-github-review-tools/)) — left pane = PRs grouped with pending drafts, right pane = drill-down into the selected review's summary + inline comments, with per-comment actions. This means the preview pane is *itself* a list (comments), with its own cursor, its own actions, and Tab-focus.

Capabilities the library needs to cover both consumers:

- **Unified `Detail` shape** — `detail.items` returns `DetailItem[]`; one titleless item fills the pane, multiple titled items become a cursor-driven sub-list. Single rule, no discriminated union.
- **Detail-scoped actions** — actions declared under `detail.actions` run against the focused detail item; actions at the top level run against the highlighted row (or multi-selection).
- **Grouped rows** — `Row.group` triggers dim group headers when the group key changes.
- **State filter via plain action** — no special API; consumer owns the filter, mutates it in an action handler, calls `refresh()`. Action `label` may be a function to reflect current state.
- **Refresh action** — `refresh()` exposed on `ActionContext`; consumers bind a key for it.

## 2. User-facing shape

### 2.1 Consumer API

One entrypoint, `runBrowser<R>(config)`, returns a promise that resolves with whatever the actions chose to exit with (or `null` if the user quit).

**Plan browser (single detail item — fills the pane):**

```ts
import { runBrowser, singleDetail, type Row } from "@poe-code/design-system";

await runBrowser<void>({
  title: "Plans",
  rows: async () => (await listPlans()).map(planToRow),
  detail: singleDetail(async (row, { width }) =>
    renderMarkdown(await readPlanFile(row.id), { width })),
  actions: [
    { id: "edit",    key: "e", label: "Edit",
      handler: ({ row, suspendAnd }) => suspendAnd(() => openInEditor(row.id)) },
    { id: "archive", key: "a", label: "Archive",
      predicate: ({ row }) => row.badge?.text !== "archived",
      handler: async ({ rows, refresh, toast }) => {
        for (const r of rows) await archivePlan(r.id);
        await refresh();
        toast(`archived ${rows.length}`, "success");
      } },
    { id: "delete",  key: "d", label: "Delete", destructive: true,
      handler: async ({ rows, refresh }) => {
        for (const r of rows) await deletePlan(r.id);
        await refresh();
      } },
    { id: "run",     key: "r", label: "Run",
      handler: ({ row, exit }) => exit(() => runPlan(row.id)) },
  ],
  reorder: { onReorder: async (orderedIds) => writePlanOrder(orderedIds) },
  multiSelect: true,
});
```

**PR review queue (detail items have titles — right pane is a list):**

```ts
let stateFilter: "draft" | "publishing" | "published" = "draft";

await runBrowser<void>({
  title: "Pending reviews",
  rows: async () => (await listDraftState({ filter: stateFilter }))
    .map(pr => ({
      id: pr.id, group: pr.repo,
      title: `#${pr.number} ${pr.title}`,
      subtitle: `${pr.draftCount} drafts · ${pr.author}`,
      badge: badgeFor(pr.state),
    })),
  detail: {
    items: async (row) => (await loadReview(row.id)).comments.map(c => ({
      id: c.id,
      title: c.path,
      subtitle: c.bodyPreview,
      render: () => renderComment(c),
    })),
    actions: [
      { id: "edit-comment",   key: "e", label: "Edit",
        handler: ({ item, suspendAnd, refresh }) =>
          suspendAnd(() => editInlineCommentCommand(item.id)).then(refresh) },
      { id: "delete-comment", key: "x", label: "Delete", destructive: true,
        handler: async ({ item, refresh }) => {
          await deleteInlineCommentCommand(item.id);
          await refresh();
        } },
    ],
  },
  actions: [
    { id: "commit",  key: "c", label: "Commit drafts",
      handler: async ({ row, refresh }) => { await commitReviewsCommand(row.id); await refresh(); } },
    { id: "discard", key: "d", label: "Discard", destructive: true,
      handler: async ({ row, refresh }) => { await discardDrafts(row.id); await refresh(); } },
    { id: "toggle-state", key: "s", label: () => `State: ${stateFilter}`,
      handler: async ({ refresh }) => { stateFilter = nextState(stateFilter); await refresh(); } },
    { id: "refresh", key: "r", label: "Refresh",
      handler: ({ refresh }) => refresh() },
    { id: "open-in-browser", key: "Enter", primary: true, label: "Open PR",
      handler: ({ row }) => openUrl(row.url) },
  ],
});
```

### 2.1.1 Types

```ts
type Tone = "success" | "warning" | "error" | "info" | "muted";

interface Row {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  group?: string;        // grouped rendering; rows with same group cluster under a header
}

interface DetailItem {
  id: string;
  title?: string;        // absent => item fills pane with no cursor / no selection chrome
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  render: (ctx: DetailCtx) => string | Promise<string>;
}

interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[];      // run against the focused detail item
}

interface DetailCtx { width: number; height: number; signal: AbortSignal; row: Row }
interface PreviewCtx extends DetailCtx {}     // alias for actions that don't care about row

interface Action<R> {
  id: string;
  label: string | (() => string);            // function form re-evaluated when state changes
  key?: string | string[];
  predicate?: (ctx: ActionContext<R>) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean;                          // bound to Enter
  showInFooter?: boolean;                     // default true
}

interface ActionContext<R> {
  row: Row;                    // currently highlighted left-pane row
  rows: Row[];                 // multi-select; falls back to [row] if no selection
  item?: DetailItem;           // populated for actions declared under detail.actions
  filter: string;
  refresh: () => Promise<void>;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
  exit: (after?: () => void | Promise<void>) => void;
}

interface BrowserConfig<R> {
  title: string;
  rows: () => Promise<Row[]>;
  detail: Detail<R>;
  actions: Action<R>[];
  reorder?: { onReorder: (orderedIds: string[]) => void | Promise<void> };
  multiSelect?: boolean;
  keybindOverrides?: Record<string, string | string[]>;
  emptyHint?: string;
  initialFilter?: string;
}

function runBrowser<R = void>(config: BrowserConfig<R>): Promise<R | null>;

// Ergonomic helper for the common single-blob case.
function singleDetail<R>(
  render: (row: Row, ctx: DetailCtx) => string | Promise<string>
): Detail<R>;
```

### 2.1.2 Detail rendering rule

The library renders `detail.items` uniformly:

- **Zero items** — pane shows `emptyHint` or a default `No detail`.
- **One item, no `title`** — full-pane render, no cursor, no sub-actions footer.
- **Any item with a `title`** — list mode: header bars per item, cursor + Tab-focus, `detail.actions` enabled.

This is the single rule that collapses static and list shapes into one.

### 2.2 Default keybindings

| Action               | Default key(s)            | Notes                                              |
| -------------------- | ------------------------- | -------------------------------------------------- |
| Move cursor          | `↑`/`↓`, `k`/`j`          | Within focused pane                                |
| Page                 | `Ctrl+u`/`Ctrl+d`         |                                                    |
| Top / Bottom         | `gg` / `G`                | vim style                                          |
| Filter (focus input) | `/`                       | Type to filter; `Esc` clears                       |
| Command palette      | `Ctrl+P`, `Ctrl+K`        | Fuzzy over all actions                             |
| Toggle help          | `?`                       | Modal listing every binding                        |
| Toggle preview       | `Ctrl+/`                  | Hide / show preview pane                           |
| Cycle panes          | `Tab`                     | List → Preview → List                              |
| Scroll preview       | `Shift+↑`/`↓`, `Ctrl+f/b` | Independent of list cursor                         |
| Multi-select toggle  | `Space`                   | Only if `multiSelect: true`                        |
| Select all visible   | `Ctrl+a`                  |                                                    |
| Clear selection      | `Esc` (when selection)    |                                                    |
| **Reorder up/down**  | `Ctrl+↑` / `Ctrl+↓`       | Disabled while filter active; vim alias `K` / `J`  |
| Refresh              | `r` — bound by consumer   | Library exposes the action; not bound by default   |
| Primary action       | `Enter`                   | Maps to the action flagged `primary: true`         |
| Quit                 | `q`, `Ctrl+c`             | Not rebindable                                     |

Per-action overrides via `keybindOverrides`:

```ts
runBrowser({
  ...,
  keybindOverrides: {
    archive: "x",          // single override
    "command-palette": ["Ctrl+P", "Ctrl+K", ":"],
  },
});
```

### 2.3 ASCII mockup — wide (≥120 cols)

```text
┌─ Plans ────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ plans> auth                                                                                       3/47   ⠋  (2 selected) │
├──────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ ● 28 Browser TUI library                         │ # 28 Browser TUI library                                            │
│   2d · kjopek · design-system                    │                                                                     │
│                                                  │ A reusable list + preview + actions browser component in            │
│ ● 27 ACP telemetry converters                    │ @poe-code/design-system, modeled on fzf's interaction loop and      │
│   3d · kjopek · acp                              │ Textual's widget/action architecture.                               │
│                                                  │                                                                     │
│ ◌ 26 Maestro                            ┃        │ ## 1. What we're building                                           │
│   5d · kjopek · pipeline                ┃        │                                                                     │
│                                                  │ A library unit in packages/design-system/src/ that provides a       │
│ ◌ 25 Tasks board sync                   ┃ ▌      │ generic three-region browser TUI — left sidebar list, main          │
│   1w · kjopek · superintendent          ┃        │ preview pane, action footer — driven by fuzzy filter input...      │
│                                                  │                                                                     │
│ ▣ 16 Spawn independent skills                    │ ## 2. User-facing shape                                             │
│   2w · kjopek · agent-spawn                      │                                                                     │
└──────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┤
  [e] edit  [a] archive 2  [d] delete 2  [Ctrl+↑/↓] reorder  [Esc] clear  [?] help  [Ctrl+P] palette  [q] quit
```

Legend: `●` active, `◌` draft, `▣` archived. `┃` left of row = multi-selected. `▌` = list-pane focus highlight.

### 2.4 ASCII mockup — medium (~100 cols)

```text
┌─ Plans ───────────────────────────────────────────────────────────────────────────────────────────┐
│ plans>                                                                          47/47             │
├──────────────────────────────────────┬────────────────────────────────────────────────────────────┤
│ ● 28 Browser TUI library         ▌  │ # 28 Browser TUI library                                   │
│   2d · kjopek · design-system        │                                                            │
│ ● 27 ACP telemetry converters        │ A reusable list + preview + actions browser component in   │
│   3d · kjopek · acp                  │ @poe-code/design-system...                                 │
│ ◌ 26 Maestro                         │                                                            │
│   5d · kjopek · pipeline             │ ## 1. What we're building                                  │
│ ◌ 25 Tasks board sync                │                                                            │
└──────────────────────────────────────┴────────────────────────────────────────────────────────────┤
  [e] edit  [a] archive  [d] delete  [r] run  [?] help  [Ctrl+P] palette  [q] quit
```

### 2.4.1 ASCII mockup — detail-as-list (PR review queue)

```text
┌─ Pending reviews ─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ pr> auth                                                                                  3/12   State: draft  ⠋        │
├──────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ poe-platform/poe-code                            │ #4821 fix(auth): refresh token race           ▌                     │
│ ● #4821 fix(auth): refresh token race      ▌    │  poe-platform/poe-code · kjopek · 2 drafts                          │
│   2 drafts · kjopek                              │                                                                     │
│ ◌ #4815 chore: bump deps                         │ ▌ packages/auth/src/refresh.ts:42                                   │
│   1 draft · kjopek                               │   The lock is released before the await — same bug as #4501.       │
│                                                  │                                                                     │
│ poe-platform/poe-tools                           │   packages/auth/src/refresh.ts:88                                   │
│ ● #312 feat: webhook signer                      │   Nit: rename `t` to `token` for readability.                       │
│   3 drafts · kjopek                              │                                                                     │
└──────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┤
  [c] commit  [d] discard  [s] state  [r] refresh  [Enter] open PR    Sub: [e] edit  [x] delete  [Tab] focus  [?] help
```

The right pane is its own scrollable list. `Tab` moves focus into it; the footer's "Sub:" cluster becomes active and the primary `Enter` re-binds to the sub-item's primary action (or the parent's, if sub has none).

### 2.5 ASCII mockup — narrow (<100 cols, vertical split; <80 cols, preview hidden)

```text
┌─ Plans ─────────────────────────────────────────────┐
│ plans>                                  47/47       │
├─────────────────────────────────────────────────────┤
│ ● 28 Browser TUI library                    ▌      │
│ ● 27 ACP telemetry converters                       │
│ ◌ 26 Maestro                                        │
│ ◌ 25 Tasks board sync                               │
├─ Preview ───────────────────────────────────────────┤
│ # 28 Browser TUI library                            │
│                                                     │
│ A reusable list + preview + actions browser...      │
└─────────────────────────────────────────────────────┤
  [e] edit  [a] archive  [d] delete  [?] help  [q] quit
```

### 2.6 Modals and state overlays

**Help (`?`):**

```text
╭─ Keybindings ─────────────────────────────────────────╮
│ Navigation                                            │
│   ↑ ↓ k j         move cursor                         │
│   Ctrl+u/d        page                                │
│   gg / G          top / bottom                        │
│                                                       │
│ Filter & search                                       │
│   /               focus filter                        │
│   Ctrl+P Ctrl+K   command palette                     │
│                                                       │
│ Actions                                               │
│   e               edit                                │
│   a               archive                             │
│   d               delete                              │
│   r               run                                 │
│                                                       │
│ Reorder                                               │
│   Ctrl+↑ Ctrl+↓   move row (disabled while filtered)  │
│                                                       │
│ [Esc] close                                           │
╰───────────────────────────────────────────────────────╯
```

**Confirm (destructive action):**

```text
╭─ Delete 2 plans? ────────────────────────╮
│ • 26 Maestro                             │
│ • 25 Tasks board sync                    │
│                                          │
│ This cannot be undone.                   │
│                                          │
│   [y] yes      [n] no    [Esc] cancel    │
╰──────────────────────────────────────────╯
```

**Command palette (`Ctrl+P` / `Ctrl+K`):**

```text
╭─ Run command ────────────────────────────╮
│ > arch                                   │
├──────────────────────────────────────────┤
│ ▌ archive               a                │
│   archive all draft     —                │
╰──────────────────────────────────────────╯
```

**Empty state:**

```text
│                                                     │
│           No plans yet. Press [n] to create.        │
│                                                     │
```

**Filter matches nothing:**

```text
│ plans> xyzzy                                  0/47 │
│                                                     │
│           No matches for "xyzzy"                   │
│           [Esc] clear filter                       │
```

**Async preview loading (after 150 ms):**

```text
│ # 28 Browser TUI library                            │
│                                                     │
│ ⠋ rendering markdown…                              │
```

### 2.7 Behavioural rules

- **Always-on filter input** at the top; typing anywhere in the list focuses it. `Esc` clears it.
- **Highlight vs Select** (Textual's `ListView` contract): moving the cursor *highlights* (drives preview re-render). `Enter` triggers the primary action; `Space` toggles multi-select.
- **Focus indicator** is the border color (`accent` token when focused, `muted` when not) — lazygit pattern.
- **Footer is context-sensitive**: when multi-select is non-empty, the footer swaps to bulk-action hints with counts (`[a] archive 2`).
- **Reorder is disabled while filter is non-empty** — predicate evaluates `filter === ""`. The footer hint hides itself in that state.
- **Destructive actions** (`destructive: true`) auto-route through a confirm modal that lists the affected rows.
- **`suspendAnd(fn)`** restores the terminal, runs `fn` (e.g. `$EDITOR`), then re-enters the alt-screen and refreshes — handles SIGTSTP/SIGCONT cleanly.
- **`exit(fn?)`** tears down the TUI and resolves the `runBrowser` promise; if `fn` is supplied, it runs *after* teardown (so commands like "run plan" stream to stdout cleanly).

## 3. Implementation details and technical decisions

*To be drafted in the next pass.*

## 4. Interfaces and test plan

*To be drafted in the next pass.*

## 5. Code plan

*To be drafted in the next pass.*
