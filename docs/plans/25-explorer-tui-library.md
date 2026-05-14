---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: scaffold-explorer-package
    title: Scaffold explorer package and public types
    prompt: |
      Create the directory tree `packages/design-system/src/explorer/`
      with empty stub files: index.ts, runtime.ts, reducer.ts, state.ts,
      events.ts, actions.ts, keymap.ts, filter.ts, layout.ts, jobs.ts,
      theme.ts, and render/{index,list,detail,footer,header,modal}.ts.

      In explorer/state.ts (or a new types.ts if preferable) export the
      full public type surface: Tone, Row, DetailItem, Detail<R>,
      DetailCtx, Action<R>, ActionContext<R>, ExplorerConfig<R>. Match
      the type definitions from the plan body verbatim.

      In explorer/index.ts re-export: runExplorer (stub that throws
      "not implemented"), singleDetail (working: returns
      `{ items: async (row, ctx) => [{ id: row.id, render: ctx => fn(row, ctx) }] }`),
      and every public type listed above.

      In packages/design-system/src/index.ts add the namespace and named
      exports as in §1 of the plan body. Do not touch other exports.

      The package must build (`npm run build` in
      packages/design-system) and the existing test suite must still
      pass after this task.
    status:
      implement: done
      test: done
      commit: done

  - id: fuzzy-filter-and-layout
    title: Fuzzy filter and layout engine (pure)
    prompt: |
      Implement `packages/design-system/src/explorer/filter.ts` and
      `packages/design-system/src/explorer/layout.ts`. Both are pure
      modules with no I/O.

      filter.ts: a subsequence fuzzy matcher that takes a query and a
      list of rows, returns matching indices with score and matched
      character positions. Case-insensitive by default. Consecutive-run
      bonus, start-of-word bonus. Group headers (Row.group) do not
      participate in matching. Strip ANSI from row.title / row.subtitle
      before comparing. Empty query returns all rows in original order
      with no match positions. ~100 lines, no external dep.

      layout.ts: export computeExplorerLayout(opts: { cols, rows,
      detailHidden? }) returning { mode: "wide" | "medium" |
      "narrow-vertical" | "narrow-list-only" | "too-narrow", header,
      list, detail, footer } where each rect is { x, y, width, height }.
      Breakpoints: <40 too-narrow, 40-79 narrow-list-only, 80-99
      narrow-vertical, 100-119 medium, >=120 wide. Rect math must sum
      to the viewport.

      Add filter.test.ts and layout.test.ts under vitest covering every
      branch in the plan's §4.3 unit-test bullet list. No terminal-pilot
      — pure logic.
    status:
      implement: done
      test: done
      commit: done

  - id: state-events-keymap
    title: State, events, and keymap layering
    prompt: |
      In `packages/design-system/src/explorer/`:

      state.ts: export ExplorerState (shape from §3.3 of the plan body)
      and createInitialState(config, size) -> ExplorerState.

      events.ts: export the ExplorerEvent discriminated union (§3.4 of
      the plan body) and an Effect union (§3.2).

      keymap.ts: export resolveBindings(config, defaults) ->
      ResolvedBindings; resolves the three-layer precedence (built-ins,
      action keys, user overrides) into a flat map. Reuse parseKeypress
      and createKeymap from
      packages/design-system/src/dashboard/. quit is not rebindable.
      Reorder bindings only added when config.reorder is set. Conflicts
      emit a single one-time warning on stderr (test that it fires
      exactly once per conflict).

      Add keymap.test.ts covering layering, conflicts, and the
      reorder-when-configured rule. No terminal-pilot — pure logic.
    status:
      implement: done
      test: done
      commit: done

  - id: reducer
    title: Pure reducer step function
    prompt: |
      Implement `packages/design-system/src/explorer/reducer.ts` with a
      single export: step(state: ExplorerState, event: ExplorerEvent) ->
      { state: ExplorerState; effects: Effect[] }. Total, synchronous,
      no I/O.

      Handle every event in the ExplorerEvent union from
      explorer/events.ts. Implement all branches described in §3 of the
      plan body: cursor moves, filter, multi-select, Tab focus cycling,
      Esc semantics (clear filter → clear selection → close modal →
      quit), destructive-action confirm-modal flow, reorder predicate
      gate (filter empty AND list focused AND no modal), modal
      resolution forwarding, resize updating state.layout via
      computeExplorerLayout, toast lifecycle, action-state memoization.

      Set state.dirty to the minimal region bitmask for every transition.

      Add reducer.test.ts with the cases enumerated in §4.3. No
      terminal-pilot — pure logic.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: actions-and-jobs
    title: Action dispatcher and versioned async jobs
    prompt: |
      In `packages/design-system/src/explorer/`:

      actions.ts: buildActionContext(state, action, source: "row" |
      "detail", runtimeHandles) -> ActionContext<R>. resolveAction(state,
      keyEvent) -> Action<R> | null — looks up by resolved bindings,
      then checks predicate (read from memoized state.actionState).
      Async handlers are locked via state.actionState until completion
      (use a "running" flag that the reducer flips on actionResolved).

      jobs.ts: export createDetailJobs(emit: (e: Event) => void) with
      methods schedule(rowId, items, ctx) and abort(). Each schedule
      assigns a monotonically increasing token, creates an AbortController,
      aborts the prior one, awaits the items() callback, emits
      detailLoaded with the token (dropped in reducer if stale).
      Set a setTimeout for LOADING_INDICATOR_MS=150 that emits a
      detailLoading event if the work hasn't finished by then.
      Errors emit detailError.

      Add actions.test.ts and jobs.test.ts. jobs.test.ts uses
      vi.useFakeTimers and verifies token staleness, AbortSignal firing
      on next schedule, and the 150ms loading-flag flip. No
      terminal-pilot — pure logic with fake timers.
    status:
      implement: done
      test: done
      commit: done

  - id: theme-and-render
    title: Theme resolver and region renderers
    prompt: |
      Implement `packages/design-system/src/explorer/theme.ts` exporting
      getExplorerTheme() composed from
      packages/design-system/src/tokens/colors.ts (accent, muted,
      success, warning, error, info). Map: border → divider,
      borderFocused → accent, matchHighlight → accent + underline. Do
      not invent new token values.

      Implement render/index.ts plus render/{header,list,detail,footer,modal}.ts.

      render/index.ts exports renderExplorer(state, screen: ScreenBuffer)
      which iterates state.dirty regions and dispatches to the
      sub-renderers. Use ScreenBuffer + cellToAnsi from
      packages/design-system/src/dashboard/buffer.ts.

      Region renderers (§3.11 of plan body): granular dirty regions,
      prevLines cache on the list region keyed by row id + selection +
      cursor + match-position. Modal composites over regions beneath
      after they are written.

      Detail rendering follows §2.1.2 rule: zero items → emptyHint;
      one item, no title → fills pane; any item with title → list mode.

      Add snapshot tests render/{list,detail,footer,header,modal,integration}.test.ts.
      Snapshots are on-disk ANSI strings produced by dumping the
      ScreenBuffer via cellToAnsi. Fixtures cover every state listed in
      §4.3 render-test bullets and the four width breakpoints.

      No terminal-pilot yet — runtime isn't wired. Visual review of
      snapshot diffs is the feedback loop.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: runtime
    title: Runtime wiring, FakeTerminalDriver, and integration tests
    prompt: |
      Implement `packages/design-system/src/explorer/runtime.ts`
      exporting runExplorer<R>(config: ExplorerConfig<R>): Promise<R | null>.

      Wire: createTerminalDriver from dashboard, subscribe to onKeypress
      and onResize, load initial rows via config.rows(), run the
      reducer on each event, apply effects (schedule detail jobs,
      handle suspend/resume, persist reorder, exit), call renderExplorer
      and write the diff via driver.write.

      Provide ActionContext.refresh / suspendAnd / toast / confirm /
      exit. suspendAnd: driver.leaveAltScreen() → await fn → enterAltScreen() →
      emit full-redraw event.

      Reject if process.stdout.isTTY is false with the documented error.

      Replace the index.ts stub of runExplorer with the real
      implementation.

      Add a test helper `runtime.test-helpers.ts` exporting
      FakeTerminalDriver (implements TerminalDriver, in-memory key queue
      and capture buffer). Not exported from the package barrel.

      Add runtime.test.ts covering the seven flows in §4.3
      integration-tests bullet list: runs and quits on q, selects row
      and exits via primary action, multi-select bulk action, async
      detail cancellation, reorder + persist with rollback, suspendAnd
      round-trip, non-TTY rejection.

      Use terminal-pilot for spot-checking against a real terminal once
      runtime tests pass: open a session via the terminal-pilot MCP,
      run `npm run dev -- explorer-demo` (demo lands in a later task,
      so this step is optional here and required in the demo task).
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: imports-boundary-test
    title: Internal module boundary enforcement
    prompt: |
      Add `packages/design-system/src/explorer/imports.test.ts` that
      reads the `import` lines from every .ts file under explorer/
      (excluding test files) and asserts the §4.2 boundary rules:

      - runtime.ts may import any other module.
      - render/*.ts may import state.ts, theme.ts, layout.ts, plus
        dashboard helpers (buffer.ts, ansi.ts). Not reducer.ts or
        runtime.ts.
      - reducer.ts may import state.ts, events.ts, actions.ts,
        keymap.ts, filter.ts. Not any render/*.
      - Leaf modules (actions, keymap, filter, jobs, layout, theme):
        only state.ts / events.ts type imports allowed.

      Use a simple regex over `import ... from "..."` lines per file;
      no AST parser dep. Fail the test with a clear message listing the
      offending edge.
    status:
      implement: open
      test: open
      commit: open

  - id: smoke-and-build-test
    title: Smoke tests for SDK exports and built bundle
    prompt: |
      Extend `packages/design-system/src/index.test.ts` to import and
      assert the explorer namespace + runExplorer + singleDetail + the
      full public type list from §4.1 of the plan body. Use
      expectTypeOf for the types. Mirror the style of the existing
      dashboard assertions in the same file.

      Add a post-build smoke test (follow whatever pattern the package
      already uses for built-asset checks; if none exists, add a
      script-runner test that requires the built dist/index.js and
      asserts runExplorer and singleDetail are functions and `explorer`
      is an object with the same).

      Verify `npm run build` in packages/design-system succeeds and the
      built bundle contains `runExplorer` (grep the dist).
    status:
      implement: open
      test: open
      commit: open

  - id: demo-and-manual-qa
    title: Explorer demo entry and manual QA doc
    prompt: |
      Create `packages/design-system/src/explorer/demo.ts` mirroring
      packages/design-system/src/dashboard/demo.ts. Calls runExplorer
      with two hand-rolled datasets (toggleable via env or arg):
      single-detail-mode (markdown blobs) and list-detail-mode (PR
      review style with titled comments). Include a `--slow-detail`
      flag that delays the detail render by 500ms to verify the
      150ms loading spinner.

      Wire a script entry so the demo can be invoked the way other
      design-system demos are invoked (check existing dashboard
      invocation in package scripts).

      Write `docs/qa/explorer-tui-library.md` as a markdown checklist
      covering the manual QA steps in §4.3 of the plan body. No
      script — markdown only.

      Drive the demo end-to-end using the terminal-pilot MCP: create a
      session, run the demo, exercise every keybinding from §2.2 (move,
      filter, Tab, Space multi-select, destructive confirm, command
      palette via Ctrl+P, help via ?, reorder via Ctrl+↑/↓, quit),
      verify the visual state via read_screen at each step. Test both
      detail modes and the --slow-detail loading spinner. Resize the
      terminal during interaction and confirm no flicker.
    status:
      implement: open
      test: open
      commit: open
---

**Explorer TUI library** — a reusable `list + detail + actions` explorer component in `@poe-code/design-system`, modeled on fzf's interaction loop and Textual's widget/action architecture, providing the substrate for screens like `plan browse` and the GitHub PR review queue.

## 1. What we're building

A library unit in [packages/design-system/src/](packages/design-system/src/) that provides a generic three-region explorer TUI — left sidebar list, main detail pane, action footer — driven by fuzzy filter input and keybind-dispatched actions, built on top of the existing [dashboard](packages/design-system/src/dashboard/) primitives (raw ANSI renderer, `ScreenBuffer`, `createTerminalDriver`, `computeDashboardLayout`).

Consumers of the library (first: [packages/plan-browser/src/browser.ts](packages/plan-browser/src/browser.ts)) declare what is being explored, not how it is drawn:

- a **list provider** — async iterable of rows + metadata
- a **row formatter** — title, optional second-line metadata, status badge
- a **detail renderer** — given the highlighted row, return ANSI text (markdown plans use the existing [terminal-markdown](packages/design-system/src/terminal-markdown/) renderer)
- an **actions registry** — `{ key, label, predicate, handler }` entries; the footer hint bar, command palette, and dispatch loop all derive from this one source
- a **theme** — reuses the existing [tokens/colors.ts](packages/design-system/src/tokens/colors.ts) palette (accent/muted/success/warning/error/info)

The library handles: layout, focus, fuzzy filtering, async loading + cancellation of detail renders, ANSI passthrough, multi-select, keybind dispatch, `?`-help modal, command palette, confirm modals, narrow-terminal vertical fallback, and the redraw loop (granular dirty regions, not full repaints).

**Distribution — exposed via the design-system SDK.** Ships from the existing `@poe-code/design-system` package, following the same export pattern as `dashboard` / `prompts` / `acp` in [packages/design-system/src/index.ts](packages/design-system/src/index.ts):

```ts
// Explorer
export * as explorer from "./explorer/index.js";
export { runExplorer, singleDetail } from "./explorer/index.js";
export type {
  Row,
  DetailItem,
  Detail,
  Action,
  ActionContext,
  ExplorerConfig,
  Tone
} from "./explorer/index.js";
```

Smoke tests in [packages/design-system/src/index.test.ts](packages/design-system/src/index.test.ts) (existing file) assert that `runExplorer`, `singleDetail`, and the `explorer` namespace are present as exports — and a follow-up smoke test runs against the built `dist/index.js` to catch entry-barrel regressions before publish.

### Scope

**This plan covers the library only.** The two consumer sketches below — plan browser and PR review queue — are _API illustrations_, not work items. Wiring real consumers (migrating [packages/plan-browser/src/browser.ts](packages/plan-browser/src/browser.ts), or building the GitHub draft review TUI in [packages/agent-github-review-tools/](packages/agent-github-review-tools/)) is downstream work, handled in separate plans once the library lands.

What this plan delivers:

- The `runExplorer<R>(config)` entrypoint, its types, and the `singleDetail` helper, exported from `@poe-code/design-system`.
- The reducer, render functions, runtime, action dispatcher, keymap layering, async detail cancellation, and modal/help/palette internals — all under `packages/design-system/src/explorer/`.
- Unit tests against the reducer, render functions, and a fake terminal driver. Smoke test asserting the public symbols are present in `dist/index.js` after build.

### Non-goals

- Not a generic Textual port. No CSS parser, no DOM, no widget tree — one composite screen with fixed regions.
- Not a replacement for the dashboard. The dashboard remains the streaming-output primitive; the explorer is a peer screen built from the same `ScreenBuffer` + driver.
- Not a parallel theme system. Reuses `tokens/colors.ts` as-is; if a gap appears it gets added to the existing token file, not a new one.
- Not multi-screen / no screen stack — one explorer screen at a time, plus modal overlays.
- No regex filter mode in v1. Fuzzy only.
- No mouse support in v1.
- No async streaming list updates in v1 — list provider resolves once before render. (Cancellation applies only to detail renders.)
- No consumer migrations in this plan — plan-browser stays as-is until a follow-up plan.
- Existing dashboard consumers ([pipeline.ts](src/cli/commands/pipeline.ts), [experiment.ts](src/cli/commands/experiment.ts)) are not touched.

### Second consumer: GitHub PR review queue

The library must also support a lazygit-style two-pane PR review queue (a separate tool by the same author, [packages/agent-github-review-tools/](packages/agent-github-review-tools/)) — left pane = PRs grouped with pending drafts, right pane = drill-down into the selected review's summary + inline comments, with per-comment actions. This means the detail pane is _itself_ a list (comments), with its own cursor, its own actions, and Tab-focus.

Capabilities the library needs to cover both consumers:

- **Unified `Detail` shape** — `detail.items` returns `DetailItem[]`; one titleless item fills the pane, multiple titled items become a cursor-driven sub-list. Single rule, no discriminated union.
- **Detail-scoped actions** — actions declared under `detail.actions` run against the focused detail item; actions at the top level run against the highlighted row (or multi-selection).
- **Grouped rows** — `Row.group` triggers dim group headers when the group key changes.
- **State filter via plain action** — no special API; consumer owns the filter, mutates it in an action handler, calls `refresh()`. Action `label` may be a function to reflect current state.
- **Refresh action** — `refresh()` exposed on `ActionContext`; consumers bind a key for it.

## 2. User-facing shape

### 2.1 Consumer API

One entrypoint, `runExplorer<R>(config)`, returns a promise that resolves with whatever the actions chose to exit with (or `null` if the user quit).

The two examples below illustrate how a consumer would call the library — they are **not** work in this plan. They exist to validate that the API can express both shapes (single-blob detail and list-of-items detail) without forks.

**Example A — single detail item (would be the plan browser's call site):**

```ts
import { runExplorer, singleDetail, type Row } from "@poe-code/design-system";

await runExplorer<void>({
  title: "Plans",
  rows: async () => (await listPlans()).map(planToRow),
  detail: singleDetail(async (row, { width }) =>
    renderMarkdown(await readPlanFile(row.id), { width })
  ),
  actions: [
    {
      id: "edit",
      key: "e",
      label: "Edit",
      handler: ({ row, suspendAnd }) => suspendAnd(() => openInEditor(row.id))
    },
    {
      id: "archive",
      key: "a",
      label: "Archive",
      predicate: ({ row }) => row.badge?.text !== "archived",
      handler: async ({ rows, refresh, toast }) => {
        for (const r of rows) await archivePlan(r.id);
        await refresh();
        toast(`archived ${rows.length}`, "success");
      }
    },
    {
      id: "delete",
      key: "d",
      label: "Delete",
      destructive: true,
      handler: async ({ rows, refresh }) => {
        for (const r of rows) await deletePlan(r.id);
        await refresh();
      }
    },
    { id: "run", key: "r", label: "Run", handler: ({ row, exit }) => exit(() => runPlan(row.id)) }
  ],
  reorder: { onReorder: async (orderedIds) => writePlanOrder(orderedIds) },
  multiSelect: true
});
```

**Example B — detail items with titles (would be the PR review queue's call site):**

```ts
let stateFilter: "draft" | "publishing" | "published" = "draft";

await runExplorer<void>({
  title: "Pending reviews",
  rows: async () =>
    (await listDraftState({ filter: stateFilter })).map((pr) => ({
      id: pr.id,
      group: pr.repo,
      title: `#${pr.number} ${pr.title}`,
      subtitle: `${pr.draftCount} drafts · ${pr.author}`,
      badge: badgeFor(pr.state)
    })),
  detail: {
    items: async (row) =>
      (await loadReview(row.id)).comments.map((c) => ({
        id: c.id,
        title: c.path,
        subtitle: c.bodyPreview,
        render: () => renderComment(c)
      })),
    actions: [
      {
        id: "edit-comment",
        key: "e",
        label: "Edit",
        handler: ({ item, suspendAnd, refresh }) =>
          suspendAnd(() => editInlineCommentCommand(item.id)).then(refresh)
      },
      {
        id: "delete-comment",
        key: "x",
        label: "Delete",
        destructive: true,
        handler: async ({ item, refresh }) => {
          await deleteInlineCommentCommand(item.id);
          await refresh();
        }
      }
    ]
  },
  actions: [
    // Per-review actions: small curated set
    {
      id: "commit",
      key: "c",
      label: "Commit",
      handler: async ({ rows, refresh }) => {
        for (const r of rows) await commitReviewsCommand(r.id);
        await refresh();
      }
    },
    {
      id: "redo",
      key: "R",
      label: "Redo",
      handler: async ({ row, suspendAnd, refresh }) => {
        await suspendAnd(() => regenerateReview(row.id));
        await refresh();
      }
    },
    {
      id: "delete",
      key: "d",
      label: "Delete",
      destructive: true,
      handler: async ({ rows, refresh }) => {
        for (const r of rows) await discardDrafts(r.id);
        await refresh();
      }
    },
    // Utility actions
    {
      id: "toggle-state",
      key: "s",
      label: () => `State: ${stateFilter}`,
      handler: async ({ refresh }) => {
        stateFilter = nextState(stateFilter);
        await refresh();
      }
    },
    { id: "refresh", key: "r", label: "Refresh", handler: ({ refresh }) => refresh() },
    {
      id: "open-in-browser",
      key: "Enter",
      primary: true,
      label: "Open PR",
      handler: ({ row }) => openUrl(row.url)
    }
  ]
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
  group?: string; // grouped rendering; rows with same group cluster under a header
}

interface DetailItem {
  id: string;
  title?: string; // absent => item fills pane with no cursor / no selection chrome
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  render: (ctx: DetailCtx) => string | Promise<string>;
}

interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[]; // run against the focused detail item
}

interface DetailCtx {
  width: number;
  height: number;
  signal: AbortSignal;
  row: Row;
}

interface Action<R> {
  id: string;
  label: string | (() => string); // function form re-evaluated when state changes
  key?: string | string[];
  predicate?: (ctx: ActionContext<R>) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean; // bound to Enter
  showInFooter?: boolean; // default true
}

interface ActionContext<R> {
  row: Row; // currently highlighted left-pane row
  rows: Row[]; // multi-select; falls back to [row] if no selection
  item?: DetailItem; // populated for actions declared under detail.actions
  filter: string;
  refresh: () => Promise<void>;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
  exit: (after?: () => void | Promise<void>) => void;
}

interface ExplorerConfig<R> {
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

function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null>;

// Ergonomic helper for the common single-blob case.
function singleDetail<R>(render: (row: Row, ctx: DetailCtx) => string | Promise<string>): Detail<R>;
```

### 2.1.2 Detail rendering rule

The library renders `detail.items` uniformly:

- **Zero items** — pane shows `emptyHint` or a default `No detail`.
- **One item, no `title`** — full-pane render, no cursor, no sub-actions footer.
- **Any item with a `title`** — list mode: header bars per item, cursor + Tab-focus, `detail.actions` enabled.

This is the single rule that collapses static and list shapes into one.

### 2.2 Default keybindings

| Action               | Default key(s)            | Notes                                             |
| -------------------- | ------------------------- | ------------------------------------------------- |
| Move cursor          | `↑`/`↓`, `k`/`j`          | Within focused pane                               |
| Page                 | `Ctrl+u`/`Ctrl+d`         |                                                   |
| Top / Bottom         | `gg` / `G`                | vim style                                         |
| Filter (focus input) | `/`                       | Type to filter; `Esc` clears                      |
| Command palette      | `Ctrl+P`, `Ctrl+K`        | Fuzzy over all actions                            |
| Toggle help          | `?`                       | Modal listing every binding                       |
| Toggle detail        | `Ctrl+/`                  | Hide / show detail pane                           |
| Cycle panes          | `Tab`                     | List → Detail → List                              |
| Scroll detail        | `Shift+↑`/`↓`, `Ctrl+f/b` | Independent of list cursor                        |
| Multi-select toggle  | `Space`                   | Only if `multiSelect: true`                       |
| Select all visible   | `Ctrl+a`                  |                                                   |
| Clear selection      | `Esc` (when selection)    |                                                   |
| **Reorder up/down**  | `Ctrl+↑` / `Ctrl+↓`       | Disabled while filter active; vim alias `K` / `J` |
| Refresh              | `r` — bound by consumer   | Library exposes the action; not bound by default  |
| Primary action       | `Enter`                   | Maps to the action flagged `primary: true`        |
| Quit                 | `q`, `Ctrl+c`             | Not rebindable                                    |

Per-action overrides via `keybindOverrides`:

```ts
runExplorer({
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
│ ● 27 Explorer TUI library                        │ # 27 Explorer TUI library                                           │
│   2d · kjopek · design-system                    │                                                                     │
│                                                  │ A reusable list + detail + actions explorer component in            │
│ ● 26 ACP telemetry converters                    │ @poe-code/design-system, modeled on fzf's interaction loop and      │
│   3d · kjopek · acp                              │ Textual's widget/action architecture.                               │
│                                                  │                                                                     │
│ ◌ 25 Maestro                            ┃        │ ## 1. What we're building                                           │
│   5d · kjopek · pipeline                ┃        │                                                                     │
│                                                  │ A library unit in packages/design-system/src/ that provides a       │
│ ◌ 24 Tasks board sync                   ┃ ▌      │ generic three-region explorer TUI — left sidebar list, main         │
│   1w · kjopek · superintendent          ┃        │ detail pane, action footer — driven by fuzzy filter input...        │
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
│ ● 27 Explorer TUI library        ▌  │ # 27 Explorer TUI library                                  │
│   2d · kjopek · design-system        │                                                            │
│ ● 26 ACP telemetry converters        │ A reusable list + detail + actions explorer component in   │
│   3d · kjopek · acp                  │ @poe-code/design-system...                                 │
│ ◌ 25 Maestro                         │                                                            │
│   5d · kjopek · pipeline             │ ## 1. What we're building                                  │
│ ◌ 24 Tasks board sync                │                                                            │
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

### 2.5 ASCII mockup — narrow (<100 cols, vertical split; <80 cols, detail hidden)

```text
┌─ Plans ─────────────────────────────────────────────┐
│ plans>                                  47/47       │
├─────────────────────────────────────────────────────┤
│ ● 27 Explorer TUI library                   ▌      │
│ ● 26 ACP telemetry converters                       │
│ ◌ 25 Maestro                                        │
│ ◌ 24 Tasks board sync                               │
├─ Detail ────────────────────────────────────────────┤
│ # 27 Explorer TUI library                           │
│                                                     │
│ A reusable list + detail + actions explorer...      │
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

**Async detail loading (after 150 ms):**

```text
│ # 27 Explorer TUI library                           │
│                                                     │
│ ⠋ rendering markdown…                              │
```

### 2.7 Behavioural rules

- **Always-on filter input** at the top; typing anywhere in the list focuses it. `Esc` clears it.
- **Highlight vs Select** (Textual's `ListView` contract): moving the cursor _highlights_ (drives detail re-render). `Enter` triggers the primary action; `Space` toggles multi-select.
- **Focus indicator** is the border color (`accent` token when focused, `muted` when not) — lazygit pattern.
- **Footer is context-sensitive**: when multi-select is non-empty, the footer swaps to bulk-action hints with counts (`[a] archive 2`).
- **Reorder is disabled while filter is non-empty** — predicate evaluates `filter === ""`. The footer hint hides itself in that state.
- **Destructive actions** (`destructive: true`) auto-route through a confirm modal that lists the affected rows.
- **`suspendAnd(fn)`** restores the terminal, runs `fn` (e.g. `$EDITOR`), then re-enters the alt-screen and refreshes — handles SIGTSTP/SIGCONT cleanly.
- **`exit(fn?)`** tears down the TUI and resolves the `runExplorer` promise; if `fn` is supplied, it runs _after_ teardown (so commands like "run plan" stream to stdout cleanly).

> **Naming note**: what fzf calls the "preview window" is called the **detail pane** here. The term "preview" is not used in the API.

## 3. Implementation details and technical decisions

### 3.1 Package layout

All new code lives under [packages/design-system/src/explorer/](packages/design-system/src/explorer/). Nothing else in the design-system package moves.

```text
packages/design-system/src/explorer/
├── index.ts            # barrel — runExplorer, singleDetail, types
├── runtime.ts          # runExplorer(): wiring of driver, reducer, renderer, async jobs
├── reducer.ts          # pure (state, event) => state
├── state.ts            # ExplorerState type + initial state factory
├── events.ts           # ExplorerEvent discriminated union
├── actions.ts          # action context construction, dispatcher, predicate eval
├── keymap.ts           # default bindings + override resolution
├── filter.ts           # fuzzy matcher + score
├── layout.ts           # computeExplorerLayout — wide / medium / narrow / detail-hidden
├── render/
│   ├── index.ts        # renderExplorer(state, screen) — top-level orchestrator
│   ├── list.ts         # renderListPane
│   ├── detail.ts       # renderDetailPane (single vs list mode)
│   ├── footer.ts       # renderFooter (context-sensitive)
│   ├── header.ts       # renderHeader (title + filter input + info)
│   └── modal.ts        # renderModal (confirm / help / palette)
├── jobs.ts             # versioned async tokens for detail render + list load
├── theme.ts            # token-to-chalk resolver, reuses tokens/colors.ts
└── *.test.ts           # collocated unit tests
```

### 3.2 Reducer / render / runtime split

Three layers, pure boundary between them:

- **Reducer** (`reducer.ts`) — `(state, event) => state`. Total, sync, pure. Produces zero or more `Effect` records describing async work to schedule, but does not perform it.
- **Renderer** (`render/`) — `(state, screen: ScreenBuffer) => void`. Pure projection of state onto a `ScreenBuffer`. Decides which regions are dirty based on `state.dirty` flags.
- **Runtime** (`runtime.ts`) — owns the impure shell: subscribes the driver's key stream, runs the reducer, applies the resulting effects (schedules async jobs, posts results back as new events), then re-renders.

```ts
type Effect =
  | { type: "renderDetail"; rowId: string; token: number }
  | { type: "exit"; result: unknown; after?: () => Promise<void> }
  | { type: "suspend"; fn: () => Promise<unknown>; resumeWith: (v: unknown) => Event }
  | { type: "persistOrder"; orderedIds: string[] };

function step(state: ExplorerState, event: Event): { state: ExplorerState; effects: Effect[] };
```

The runtime is the only place that touches the terminal driver, `process.stdout`, signals, or user-supplied async callbacks. Everything else is testable with no I/O.

### 3.3 State shape

```ts
interface ExplorerState {
  title: string;
  rows: Row[]; // immutable after load (until refresh)
  filtered: number[]; // indices into rows that match filter
  cursor: number; // index into filtered
  filter: string;
  focused: "list" | "detail";
  detail: {
    rowId: string | null; // which row's items we currently have
    items: DetailItem[] | null; // null = loading
    cursor: number; // index into items when in list mode
    scroll: number; // line offset within rendered content
    token: number; // versioning for async work
  };
  selected: Set<string>; // row ids in multi-select
  modal:
    | null
    | { kind: "help" }
    | { kind: "confirm"; action: Action<unknown>; rows: Row[]; resolver: (ok: boolean) => void }
    | { kind: "palette"; query: string; cursor: number };
  toast: { message: string; tone: Tone; expiresAt: number } | null;
  dirty: Dirty; // bitmask of regions to repaint
  size: { cols: number; rows: number };
  layout: "wide" | "medium" | "narrow-vertical" | "narrow-list-only";
  bindings: ResolvedBindings; // computed once from defaults + overrides
  actionState: Map<string, { available: boolean; label: string }>; // memoized predicate/label eval
}

type Dirty = number; // bitwise OR of REGION_HEADER | REGION_LIST | REGION_DETAIL | REGION_FOOTER | REGION_MODAL | REGION_TOAST | REGION_ALL
```

### 3.4 Event taxonomy

```ts
type Event =
  | { type: "key"; key: KeypressEvent }
  | { type: "resize"; cols: number; rows: number }
  | { type: "rowsLoaded"; rows: Row[] }
  | { type: "detailLoaded"; rowId: string; token: number; items: DetailItem[] }
  | { type: "detailError"; rowId: string; token: number; error: Error }
  | { type: "actionResolved"; actionId: string } // bumps actionState after async handler returns
  | { type: "toastExpired" }
  | { type: "suspendResumed"; value: unknown; emit: Event }
  | { type: "modalDismissed"; result: unknown };
```

Resize and toast-expiry are pushed by the runtime on timers; everything else either comes from the driver or from completed effects.

### 3.5 Action dispatcher

Single entry: `dispatch(state, action, ctx) => Effect[]`.

- **Scope resolution.** Top-level actions get a row-scoped context; actions declared under `detail.actions` get the focused `DetailItem` plus the parent row. The dispatcher does not branch on `scope` flags — it looks up the action's source array (`config.actions` vs `config.detail.actions`).
- **Predicate evaluation.** Memoized in `state.actionState` and recomputed on row-cursor change, filter change, selection change, or focus change. Footer rendering reads `actionState`, never calls predicates inline.
- **Destructive flow.** A `destructive: true` action whose handler is about to run pushes a `confirm` modal first; the modal's resolver re-enters the dispatcher with the same action context if the user confirms.
- **Async handlers.** The runtime awaits the handler's promise. Until it resolves the action is locked (visible in footer with dim style); a second press during the wait is ignored.

### 3.6 Keymap layering

Three layers, resolved once into a flat `ResolvedBindings` map at startup and re-resolved on `keybindOverrides` change (rare):

1. **Built-ins** — quit (`q`, `Ctrl+c`), filter (`/`), help (`?`), command palette (`Ctrl+P`, `Ctrl+K`), nav (`↑`/`↓`/`k`/`j`/`gg`/`G`/`Ctrl+u`/`Ctrl+d`), Tab, Esc, Enter, Space, `Ctrl+a`, `Ctrl+/`, `Shift+↑`/`↓`, `Ctrl+f`/`Ctrl+b`. Reorder bindings (`Ctrl+↑`/`Ctrl+↓`, `K`/`J`) registered only if `reorder` is configured.
2. **Action keys** — each `Action.key` (single or array). Conflicts with built-ins lose silently and emit a one-time `process.stderr` warning in non-production.
3. **User overrides** — `keybindOverrides[actionId]` replaces the action's keys entirely. The `quit` action is the only one that cannot be re-bound or removed (always `q` and `Ctrl+c`).

Reuses `parseKeypress` and `createKeymap` from [packages/design-system/src/dashboard/](packages/design-system/src/dashboard/) — no parallel implementation.

### 3.7 Async detail render cancellation

fzf's versioned-tokens pattern. Each detail request gets a monotonic `token`:

1. Cursor moves to a new row → reducer increments `state.detail.token`, sets `state.detail.items = null`, emits `Effect.renderDetail` with the new token.
2. Runtime calls `config.detail.items(row, { signal, ... })` with an `AbortSignal` derived from the new token.
3. If a render completes whose token is no longer current, the `detailLoaded` event is dropped in the reducer (the rowId/token check fails).
4. If a render takes longer than `LOADING_INDICATOR_MS` (default 150 ms), the reducer flips a `loading` flag and the detail pane renders the spinner.

Consumers are responsible for honoring `signal` in their `items` / `render` callbacks; the library does not force-kill anything.

### 3.8 Terminal driver reuse

The explorer uses the dashboard's `createTerminalDriver` unchanged. Specifically:

- `driver.enterAltScreen()` / `leaveAltScreen()` on lifecycle.
- `driver.onKeypress(handler)` for the input stream.
- `driver.onResize(handler)` for SIGWINCH.
- `driver.write(ansi)` for batched paints (wrapped in `\x1b[?7l\x1b[?25l` … `\x1b[?7h\x1b[?25h` so partial paints don't tear — same trick fzf uses in `tui/light.go`).

`suspendAnd(fn)` calls `driver.leaveAltScreen()`, awaits `fn`, then `enterAltScreen()` and emits a full-redraw event. Stdin raw mode is restored automatically by the driver.

When `process.stdout.isTTY` is false, `runExplorer` rejects with a clear error: the explorer is a TTY-only API; callers needing non-TTY output should render their list/detail data via another mechanism.

### 3.9 Modal stack

Modals are stored as a single `state.modal` field, not a stack. This is sufficient because all three modal kinds (help, confirm, palette) are mutually exclusive in practice: opening one dismisses any other. The runtime ensures the modal's resolver promise is fulfilled with `null` if the modal is dismissed by a sibling open. `confirm` is the only modal that returns a value (`boolean`).

### 3.10 Fuzzy filter

Custom in-tree implementation, ~100 lines. Subsequence match with positional scoring (consecutive bonus, start-of-word bonus, case sensitivity off by default). No external dep — the existing codebase already has fuzzy helpers in `prompts/` style; we don't pull in `fzf.js` or similar. Filters against `Row.title` + `Row.subtitle`; group headers do not participate in filtering. Matched character indices are returned alongside score so the renderer can highlight matches in the list pane (chalk-styled via the `accent` token).

### 3.11 Render granularity

Six dirty regions: `HEADER | LIST | DETAIL | FOOTER | MODAL | TOAST`, plus `ALL` for full repaints (resize, suspend-resume).

The render orchestrator iterates regions and only repaints those flagged in `state.dirty`, writing to a single `ScreenBuffer`. After every reducer step the runtime calls `diff(prev, next)` (existing dashboard helper) and writes only the resulting ANSI delta. Modal overlay is composited over the regions beneath it after they're written, so the buffer underneath stays consistent for the next frame.

`prevLines` cache (fzf-style) on the list region: a per-line hash including row id + selection + cursor flag. When a frame computes the same hash for a line, that line is skipped in the diff output — keeps large lists snappy.

### 3.12 Reorder mechanics

When the reorder bindings fire (`Ctrl+↑`/`Ctrl+↓` or `K`/`J`):

1. Reducer's predicate gate: `state.filter === ""` AND `state.focused === "list"` AND `state.detail.modal === null` AND `reorder` was configured. Else no-op.
2. Swap `state.rows[i]` with `state.rows[i±1]`, move `state.cursor` to follow, set `LIST` dirty.
3. Emit `Effect.persistOrder` with the new id array.
4. Runtime calls `config.reorder.onReorder(orderedIds)`. On rejection, the runtime reverts the swap and shows an error toast.

No optimistic-with-revert UI complexity beyond that single rollback path.

### 3.13 Theme integration

`theme.ts` exports a thin resolver:

```ts
function getExplorerTheme(): {
  accent: (s: string) => string;
  muted: (s: string) => string;
  border: (s: string) => string;
  borderFocused: (s: string) => string;
  badge: (text: string, tone: Tone) => string;
  matchHighlight: (s: string) => string;
};
```

Implemented by composing the existing `dark` / `light` palettes from [packages/design-system/src/tokens/colors.ts](packages/design-system/src/tokens/colors.ts). `border` = `divider`, `borderFocused` = `accent`, `matchHighlight` = `accent` underline. No new token values added in this plan; if a real gap appears (e.g. a dedicated `borderFocused` shade) it gets added to `tokens/colors.ts`, not invented here.

### 3.14 Edge cases

- **Empty rows array** — render `emptyHint` centred in the list pane; detail pane collapses to title bar only; footer shows quit.
- **Single row** — multi-select still works (`Space` toggles).
- **Filter clears mid-select** — selection is preserved by row id, not by filtered index, so a row that scrolls out of view while selected still acts on bulk operations.
- **Row title with embedded ANSI** — stripped for filter matching and for `prevLines` hashing; preserved for render. We don't try to highlight match positions inside pre-styled titles (no-op falls back to render-as-is).
- **Multi-byte / wide chars** — width measurement via the same helper the dashboard uses (`ansi.ts` from dashboard). Wide chars consume two cells in `ScreenBuffer`.
- **Resize to <40 cols** — render a "terminal too narrow" message; key handling still works (so `q` exits). No layout attempt.
- **SIGTSTP** — the driver pauses; on SIGCONT we re-enter the alt screen and emit `REGION_ALL`.
- **Non-TTY (CI, piped stdout)** — `runExplorer` rejects with `Error("explorer requires a TTY")`. No fallback rendering in this plan.
- **Modal open during refresh** — refresh proceeds; if the user is confirming an action against a row that no longer exists post-refresh, the confirm modal closes and a toast says "row gone, refreshed".
- **Reorder while filter active** — predicate gate; reorder bindings silently no-op and the footer hint dims.
- **Same key bound to multiple actions** — runtime warns once at start; first-registered wins.
- **Detail render throws** — render the error inline in the detail pane in the `error` tone. No modal.

### 3.15 Config and env vars

Library-level config is all on the `ExplorerConfig` object. No env vars are introduced by this plan. The library does honor two pre-existing env vars the design-system already respects:

- `NO_COLOR` — drops all chalk styling (existing behaviour from `tokens/colors.ts` via chalk).
- `POE_THEME` — `dark` / `light` selection via `internal/theme-detect.ts` (existing).

Internal constants (not exported):

- `LOADING_INDICATOR_MS = 150` — delay before the detail-loading spinner shows.
- `TOAST_TTL_MS = 3000`.
- `NARROW_BREAKPOINT_COLS = 100` / `LIST_ONLY_BREAKPOINT_COLS = 80`.
- `FILTER_DEBOUNCE_MS = 0` — filter runs synchronously; the data is in memory, no point debouncing. Documented so a future change knows the rationale.

None of these are configurable in v1; they become config keys when there's a concrete reason.

## 4. Interfaces and test plan

### 4.1 Public surface

Re-exported from `@poe-code/design-system` (see level 1's distribution block). The full public surface is:

```ts
// Functions
export function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null>;
export function singleDetail<R>(
  render: (row: Row, ctx: DetailCtx) => string | Promise<string>
): Detail<R>;

// Types
export type Tone = "success" | "warning" | "error" | "info" | "muted";
export interface Row {
  id: string;
  title: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  group?: string;
}
export interface DetailItem {
  id: string;
  title?: string;
  subtitle?: string;
  badge?: { text: string; tone?: Tone };
  render: (ctx: DetailCtx) => string | Promise<string>;
}
export interface Detail<R> {
  items: (row: Row, ctx: DetailCtx) => Promise<DetailItem[]>;
  actions?: Action<R>[];
}
export interface DetailCtx {
  width: number;
  height: number;
  signal: AbortSignal;
  row: Row;
}
export interface Action<R> {
  id: string;
  label: string | (() => string);
  key?: string | string[];
  predicate?: (ctx: ActionContext<R>) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
  destructive?: boolean;
  primary?: boolean;
  showInFooter?: boolean;
}
export interface ActionContext<R> {
  row: Row;
  rows: Row[];
  item?: DetailItem;
  filter: string;
  refresh: () => Promise<void>;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  toast: (msg: string, tone?: Tone) => void;
  confirm: (prompt: string) => Promise<boolean>;
  exit: (after?: () => void | Promise<void>) => void;
}
export interface ExplorerConfig<R> {
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
```

Anything not in this list is internal to `packages/design-system/src/explorer/` and may change without notice.

### 4.2 Internal module boundaries

Within `explorer/` the only modules that are allowed to import each other are:

- `runtime.ts` → all others (it's the wiring layer).
- `render/*.ts` → `state.ts`, `theme.ts`, `layout.ts`, plus dashboard helpers (`buffer.ts`, `ansi.ts`).
- `reducer.ts` → `state.ts`, `events.ts`, `actions.ts`, `keymap.ts`, `filter.ts`. **No `render/*` imports** (would taint purity).
- `actions.ts`, `keymap.ts`, `filter.ts`, `jobs.ts`, `layout.ts`, `theme.ts` → leaf modules. Import only `state.ts` / `events.ts` for types.

This boundary is enforced by a small import-graph test in `explorer/imports.test.ts` (regex over the `import` lines of each file; fails if a forbidden edge appears).

### 4.3 Test plan

All tests live alongside their source as `*.test.ts` and run under `vitest`. Speed budget: the whole `explorer/` suite must finish in <2 s on a cold cache.

#### Unit tests — pure layers

- **`reducer.test.ts`** — reducer is total and sync. Cases: cursor up/down clamps; filter typed/cleared; multi-select toggle; Tab cycles focus; Esc semantics by context (clear-filter → clear-selection → close-modal → quit); destructive action enqueues confirm modal; modal resolution forwards to dispatcher; resize updates `state.layout`.
- **`filter.test.ts`** — fuzzy matcher: empty query returns all in original order; subsequence match; case-insensitive by default; consecutive-bonus ranking; match positions reported; group headers exempt; ANSI-stripped before matching.
- **`keymap.test.ts`** — layering: defaults → action keys → overrides; conflict detection emits exactly one warning per conflict; `quit` cannot be remapped or removed; reorder bindings present only when `reorder` configured.
- **`actions.test.ts`** — predicate evaluation is memoized; `actionState` recomputes on cursor/filter/selection change; row-scoped vs detail-scoped resolution; async handler lock prevents re-entrancy.
- **`jobs.test.ts`** — versioned tokens: stale `detailLoaded` events are dropped; `AbortSignal` aborts when a new request is made; `LOADING_INDICATOR_MS` flips the loading flag only when the work outruns the threshold (fake timers).
- **`layout.test.ts`** — width breakpoints: ≥120 wide, 100–119 medium, 80–99 narrow-vertical, <80 list-only, <40 too-narrow message; rect math sums to viewport.
- **`imports.test.ts`** — internal module boundary rules (regex over `import` lines).

#### Render snapshot tests

`render/__snapshots__/` holds ANSI snapshots produced by feeding canonical `ExplorerState` fixtures through the renderer and dumping the resulting `ScreenBuffer`. Snapshots use the existing `cellToAnsi` from `dashboard/buffer.ts` and live on disk (per CLAUDE.md: file-creating tests are forbidden _except_ for snapshots).

- **`render/list.test.ts`** — wide list, multi-select active, filter active with highlights, grouped rows, empty list.
- **`render/detail.test.ts`** — single-detail mode (markdown blob), list-detail mode (titled items), loading spinner, error.
- **`render/footer.test.ts`** — default footer, multi-select-bulk footer with counts, detail-focused "Sub:" footer, locked-during-async action.
- **`render/header.test.ts`** — title + filter empty, filter typed, match-count and spinner indicators.
- **`render/modal.test.ts`** — help, confirm (destructive), command palette with query.
- **`render/integration.test.ts`** — full-frame snapshots at wide / medium / narrow-vertical / list-only widths.

Snapshots are reviewable diffs — the visual feedback loop on the library itself.

#### Integration tests — fake terminal driver

`runtime.test.ts` wires a `FakeTerminalDriver` (implements the same `TerminalDriver` type, in-memory key queue and capture buffer) into `runExplorer`. Tests prove end-to-end flows without spawning a process or touching a real TTY:

- **`runs and quits on q`** — lifecycle: alt-screen enter, key dispatch, alt-screen exit, promise resolves with `null`.
- **`selects row, runs action, exits`** — cursor move → Enter → `primary` action's `exit(result)` resolves the promise with `result`.
- **`multi-select bulk action`** — Space-select two rows, press `d`, confirm modal `y` → handler receives both rows.
- **`async detail cancellation`** — cursor moves twice; first detail render's signal fires `abort`; only second result is rendered.
- **`reorder then persist`** — `Ctrl+↓` moves a row; `onReorder` called with new order; rejection toasts and rolls back.
- **`suspendAnd round-trip`** — `e` action calls `suspendAnd`; driver leaves alt-screen, fn runs, re-enters, full repaint.
- **`non-TTY rejects`** — `isTTY = false` → `runExplorer` rejects with the documented error.

The `FakeTerminalDriver` lives in `runtime.test-helpers.ts` and is not exported from the package.

#### Smoke / bundling tests

Extend [packages/design-system/src/index.test.ts](packages/design-system/src/index.test.ts):

- Assert the top-level imports `runExplorer`, `singleDetail`, and the `explorer` namespace resolve and have the expected types via `expectTypeOf`.
- Assert types `Row`, `DetailItem`, `Detail`, `Action`, `ActionContext`, `ExplorerConfig`, `Tone` are exported (TypeScript compile-time check; importing fails the build if missing).

A separate post-build smoke (`packages/design-system/scripts/smoke-built.test.ts` or similar — pattern decided during implementation, follows whatever the package already does for built assertions) imports from `../dist/index.js` and re-asserts the same. This catches `tsup`/`tsc` config regressions that drop symbols.

#### LLM and database tests

None. The library makes no LLM calls and touches no database. No `memfs` either (no file I/O in the library).

#### Demo and manual QA

A `packages/design-system/src/explorer/demo.ts` mirrors the existing [packages/design-system/src/dashboard/demo.ts](packages/design-system/src/dashboard/demo.ts) — invokable from a small script entry that calls `runExplorer` with hand-rolled synthetic data covering both single-detail and list-detail shapes.

Manual QA lives at `docs/qa/explorer-tui-library.md` (markdown, not a script — per CLAUDE.md). It instructs a tester to:

1. Run the demo at wide/medium/narrow widths and screenshot each via `npm run screenshot-poe-code -- explorer-demo`.
2. Exercise every keybinding from §2.2.
3. Toggle multi-select and bulk-action.
4. Trigger destructive-action confirm and cancel.
5. Toggle the command palette; type a partial action name; press Enter.
6. Force a slow detail render (demo flag) and verify the loading spinner appears after 150 ms.
7. Resize the terminal during interaction; verify no flicker and correct re-layout.

Screenshot evidence stays in the QA doc / commit body; nothing is automated for screenshots (per CLAUDE.md).

### 4.4 Rollout / migration

Nothing migrates in this plan. `packages/plan-browser/` and `packages/agent-github-review-tools/` are untouched; their adoption of `runExplorer` is downstream work covered by separate plans.

The new exports are purely additive in `@poe-code/design-system`. No existing import paths change. The package version bump is a **minor** (new public API, no breakage).

### 4.5 Autonomy checklist

An agent can build and merge this plan without coming back as long as:

- [ ] All files in §3.1's tree exist with the responsibilities described in §3.2–§3.13.
- [ ] Public exports from `@poe-code/design-system` match §4.1 exactly (names, types).
- [ ] The internal module boundary test (`imports.test.ts`) passes.
- [ ] All unit tests (§4.3) pass; suite under 2 s.
- [ ] Render snapshots exist for every fixture listed in §4.3 and look visually correct on first review.
- [ ] Integration tests against `FakeTerminalDriver` cover the seven flows listed.
- [ ] Smoke tests in `index.test.ts` import and exercise the new exports; the post-build smoke runs against `dist/index.js`.
- [ ] `npm run build` succeeds in the design-system package; the explorer barrel is present in `dist/index.js` (verifiable via `grep runExplorer dist/index.js`).
- [ ] `npm run lint:workflows` is unaffected (no workflow changes).
- [ ] Demo runs (`node packages/design-system/src/explorer/demo.ts` or the package's existing demo entry) and exits cleanly on `q`.
- [ ] Manual QA doc at `docs/qa/explorer-tui-library.md` exists and lists the steps from §4.3.
- [ ] No edits under `packages/plan-browser/`, `packages/agent-github-review-tools/`, `src/cli/commands/`, or `.github/workflows/`.
- [ ] Conventional Commits used (`feat(design-system): explorer TUI library` for the primary commit; supporting commits as `test(...)` / `chore(...)` as appropriate).

Anything outside this list (consumer migrations, real-data demos, dashboard refactors) is **not** in scope and must not happen as part of this work.

## 5. Code plan

_To be drafted in the next pass._
