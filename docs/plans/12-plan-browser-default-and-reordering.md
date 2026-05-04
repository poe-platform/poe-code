---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Plan browser as default and priority reordering

Make `poe-code` (no args) launch the plan browser, and let users reorder plans by priority with shift+arrow.

## 1. What we're building

- The root command should run the manager (the plan browser, `poe-code plan browse`).
- Add priority ordering with shift+arrow keys in the browser.

## 2. User-facing shape

### Root command

`poe-code` with no arguments launches the plan browser. Equivalent to `poe-code plan browse`.

```text
$ poe-code
┌  plan browser
│
◆  Select a plan
│  ❯ 01-agent-human-in-loop                       Plan
│    02-ai-sdk-provider-poe-integration            Plan
│    03-consolidate-planning-docs                  Plan
│    04-http-mcp-production-readiness              Plan
│    05-human-in-loop-approval-windows             Plan
│    ...
│
│  ↑↓ navigate · ⇧↑ ⇧↓ reorder · enter open · q quit
└
```

`poe-code --help` still prints help. On non-TTY stdin (`poe-code | cat`, CI without a tty), the browser cannot run and the command prints help instead. `--yes` has no effect on the browser — the browser is interactive only.

### Plan list ordering

The list shows plans in the order returned by the underlying task-list (priority order). For the markdown-dir backend that's the prefix order on disk (`01-…` first, `21-…` last). Replaces the current mtime-based sort.

### Reorder with shift+arrow

While a plan is highlighted in the list:

- `Shift+↑` — move the highlighted plan up by one position.
- `Shift+↓` — move the highlighted plan down by one position.

The move is committed immediately via the task-list's `move()` operation. For the markdown-dir backend that means the file is renamed (prefixes are repacked) before the list re-renders. The highlight follows the moved plan so the user can keep nudging.

If a move would be a no-op (already at top / bottom), the keypress is ignored.

### Browser actions remain

After picking a plan with `Enter`, the existing flow is unchanged: render preview → choose Edit / Archive / Delete / Back ([packages/plan-browser/src/browser.ts:79-130](packages/plan-browser/src/browser.ts#L79-L130)). Archive continues to call the task-list's `archive` event, which already repacks remaining prefixes ([commit 5caa5f1d](docs/plans/archive/zharness-plans-via-task-list.md)).

### README addition

Add a short section under the top-level "Quick start" of the project README:

```md
### Plan browser

Run `poe-code` with no arguments to open the plan browser. From there you can:

- Browse plans across kinds (plan, pipeline, experiment, ralph, superintendent).
- Reorder plans by priority with `Shift+↑` / `Shift+↓`.
- Edit, archive, or delete the selected plan.

The browser is also available as `poe-code plan browse`.
```

## 3. Implementation details and technical decisions

### Root command launches the browser

Replace the catch-all `.action` in [src/cli/program.ts:536-548](src/cli/program.ts#L536-L548). Branch:

- positional args present → existing `throwCommandNotFound(...)`.
- `process.stdin.isTTY && process.stdout.isTTY` → call the same code path as `plan browse` (see below). `--yes` propagates and the existing browser short-circuit at [packages/plan-browser/src/browser.ts:51-55](packages/plan-browser/src/browser.ts#L51-L55) renders the first plan.
- non-TTY → `this.outputHelp()` (current behavior).

The `plan browse` action body already builds the right options object; lift it into `runPlanBrowserFromCli(program, container)` exported from [src/cli/commands/plan.ts](src/cli/commands/plan.ts) and invoke it from both call sites. No duplication.

### Plan ordering through task-list

Replace the fs-readdir + mtime sort in `discoverAllPlans` ([packages/plan-browser/src/discovery.ts:191-209](packages/plan-browser/src/discovery.ts#L191-L209)) with the same pattern already used by [packages/agent-harness-tools/src/plans.ts:146-155](packages/agent-harness-tools/src/plans.ts#L146-L155):

```ts
openTaskList({
  type: "markdown-dir",
  path: absoluteDir,
  singleList: "plans",
  frontmatterMode: "passthrough",
  ignoreMalformed: true,
  fs
});
```

Iterate `taskList.list("plans").all()` (default order is priority, which for `markdown-dir` is on-disk prefix order). For each `Task`, read the file at `path.join(absoluteDir, ${entry-with-prefix}.md)` and reuse `readPlanMetadata` / `classifyPlanKind` to fill in `kind`, `format`, `title`, `detail`. The task-list backend strips the prefix from the id, so to recover the on-disk filename, list the directory once and build an `id → filename` map (mirrors `activePlanFilePaths` in agent-harness-tools).

`PlanEntry` gains:

- `id: string` — the task-list id (filename without `NN-` prefix and without `.md`).
- `displayIndex: number` — 1-based slot in the priority list, used for footer text and tests.

`updatedAt` stays in the type for the `plan list` table's "Updated" column but is no longer the sort key. The trailing sort in `discoverAllPlans` is removed.

### Move via shift+arrow

In the browser loop, after rendering the list, when the prompt resolves with a `reorder` action (see "Reorderable select prompt" below):

- `Shift+↑` at `i === 0` → ignore (no-op already filtered by the prompt before invoking the callback).
- `Shift+↓` at `i === plans.length - 1` → ignore.
- `Shift+↑` otherwise → `tasks.move(plans[i].id, { before: plans[i - 1].id })`.
- `Shift+↓` otherwise → `tasks.move(plans[i].id, { after: plans[i + 1].id })`.

`move` rewrites prefixes via `rewriteListPrefixes` ([packages/task-list/src/backends/markdown-dir.ts:995](packages/task-list/src/backends/markdown-dir.ts#L995)). After the call resolves, re-run `discoverAllPlans`, locate the moved plan by `id`, and re-render the prompt with the cursor pinned to that index. The prompt is re-entered (closed and reopened) rather than mutating in-place — avoids state-machine complexity in the prompt and keeps each render a function of fresh discovery output.

### Reorderable select prompt

`@clack/prompts` `select` does not expose key bindings, and `@clack/core` is not yet a direct dep. Instead of subclassing clack, build a small standalone prompt in [packages/design-system/src/prompts/primitives/](packages/design-system/src/prompts/primitives/) named `selectReorderable.ts`, modelled on the keypress plumbing already in [packages/design-system/src/dashboard/terminal.ts:70-220](packages/design-system/src/dashboard/terminal.ts#L70-L220):

- `readline.emitKeypressEvents(stdin)` + `stdin.setRawMode(true)`.
- Render the list using the existing styled output helpers from `text` and `chalk` so the prompt visually matches `select`.
- Key map:
  - `up` / `k` → cursor up
  - `down` / `j` → cursor down
  - `return` → resolve with the highlighted value
  - `escape` / `q` / `ctrl+c` → resolve with the cancellation symbol (reuse `isCancel` plumbing from [packages/design-system/src/prompts/primitives/cancel.ts](packages/design-system/src/prompts/primitives/cancel.ts))
  - `up` with `shift === true` → `await onReorder("up", index)`, then re-render with the returned `{ options, cursor }`
  - `down` with `shift === true` → `await onReorder("down", index)`, same

Footer line: `text.muted("↑↓ navigate · ⇧↑ ⇧↓ reorder · enter open · q quit")`, rendered below the list. Hidden when the prompt is non-interactive.

**Terminal compatibility for shift+arrow.** The prompt uses what Node's `readline` keypress parser already produces. iTerm2, kitty, Alacritty, WezTerm, Ghostty, VS Code's integrated terminal, and Linux gnome-terminal all emit `CSI 1;2A` / `CSI 1;2B` for shift+up/shift+down, which `readline` decodes as `{ name: "up", shift: true }` / `{ name: "down", shift: true }`. macOS Terminal.app does not — there shift+arrow is silently equivalent to plain arrow. We accept that limitation and document it in the package README; users on Terminal.app see the same footer hint, but the keys are no-ops.

Public API:

```ts
export type ReorderDirection = "up" | "down";

export interface SelectReorderableOption<Value> {
  value: Value;
  label: string;
  hint?: string;
}

export interface SelectReorderableOptions<Value> {
  message: string;
  options: SelectReorderableOption<Value>[];
  initialValue?: Value;
  footer?: string;
  onReorder?: (
    direction: ReorderDirection,
    currentIndex: number
  ) => Promise<{ options: SelectReorderableOption<Value>[]; cursor: number }>;
}

export async function selectReorderable<Value>(
  opts: SelectReorderableOptions<Value>
): Promise<Value | symbol>;
```

Re-export from [packages/design-system/src/prompts/index.ts](packages/design-system/src/prompts/index.ts) and the package's public index.

### Archive / delete migrate to task-list

`archiveBrowserPlan` and `deletePlan` in [packages/plan-browser/src/actions.ts](packages/plan-browser/src/actions.ts) become wrappers that take a `Tasks` handle and call `tasks.fire(id, "archive")` and `tasks.delete(id)` respectively. The task-list `archive` event already repacks via `rewriteListPrefixes` ([packages/task-list/src/backends/markdown-dir.ts:927](packages/task-list/src/backends/markdown-dir.ts#L927)). The CLI subcommands `plan archive` / `plan delete` switch to the same flow. `editPlan` is unchanged (no fs mutation).

### Out of scope

- gh-issues / yaml-file backends (the task-list move/archive contract is the same, but those backends are not used for plans today).
- A general-purpose multi-key sortable prompt — `selectReorderable` is plan-browser's only consumer at the moment; lift to a generic helper only if a second consumer appears.
- Search / filter inside the browser.

## 4. Interfaces and test plan

### Public interfaces touched

| Surface | Change |
| --- | --- |
| `@poe-code/design-system` | Adds `selectReorderable` (and its types) to public exports. |
| `@poe-code/plan-browser` | `PlanEntry` gains `id: string`, `displayIndex: number`. `runPlanBrowser` signature unchanged. `discoverAllPlans` no longer accepts `updatedAt` as a sort key (no caller passes it; type stays). |
| `poe-code` CLI | New behavior: `poe-code` with no args opens browser when TTY. No new flag. |

### Test plan (TDD)

New tests written first.

1. **`packages/design-system/src/prompts/select-reorderable.test.ts`** (memfs not needed; uses streams):
   - drives the prompt via a mocked stdin that emits keypress sequences (mirrors [packages/design-system/src/dashboard/terminal.test.ts](packages/design-system/src/dashboard/terminal.test.ts))
   - asserts: arrow navigation moves cursor; `enter` resolves selected value; `escape` cancels; `q` cancels; `shift+up` calls `onReorder("up", i)` and re-renders with returned cursor; `shift+up` at index 0 does *not* invoke `onReorder`; same for `shift+down` at last index; footer is rendered.

2. **`packages/plan-browser/src/discovery.test.ts`** (rewrite, uses memfs + task-list with `fs` injected):
   - assert prefix-order traversal: `01-…`, `02-…`, `21-…` returned in that order regardless of mtime.
   - assert plans missing frontmatter still load (`ignoreMalformed: true`).
   - assert each `PlanEntry.id` matches the filename's id-after-prefix.

3. **`packages/plan-browser/src/browser.move.test.ts`** (new):
   - drives the browser with a fake `selectReorderable` that scripts a `shift+down` then `enter`.
   - asserts the underlying `tasks.move` was called with `{ after: <next-id> }` and the file on disk is renamed (memfs + injected `fs`).
   - asserts cursor follows the moved plan into its new slot on the second render.

4. **`packages/plan-browser/src/actions.test.ts`** (update):
   - archive now goes through `tasks.fire(id, "archive")`; assert remaining plans' prefixes are repacked (read directory after archive).
   - delete goes through `tasks.delete(id)`; assert remaining plans' prefixes are repacked.

5. **`src/cli/program.test.ts`** — extend `bootstrap`/program tests with:
   - no-args + TTY → invokes the lifted `runPlanBrowserFromCli` (mock the function, assert called).
   - no-args + non-TTY → prints help (assert the lifted function was *not* called).
   - args present (`poe-code totally-not-a-command`) → still hits `throwCommandNotFound`.

6. **`packages/plan-browser/src/browser.e2e.test.ts`** (extend):
   - end-to-end with real `markdown-dir` (memfs): create three plans, run a `shift+down` + `q` script, exit, then read directory and assert prefixes were renamed (`01-a.md`, `02-b.md`, `03-c.md` → `01-b.md`, `02-a.md`, `03-c.md`).

7. **Visual validation** (manual, not a test): run `npm run screenshot-poe-code --` with no further args on a TTY-emulating wrapper or capture iTerm output; verify list, footer, and that shift+arrow renames a file. Also `npm run screenshot-poe-code -- --help` to confirm help is unchanged on non-TTY.

### Integration / regression coverage

- Existing `plan-root-command.test.ts` keeps passing — `plan browse` still works, `--kind`, `--yes` still pass through.
- `agent-harness-tools` plans tests (which already use the same task-list pattern) catch any cross-package regression in the markdown-dir backend.

## 5. Code plan

Numbered to match the order of TDD red→green slices.

1. **Add `selectReorderable` (design-system).**
   - Files: new [packages/design-system/src/prompts/primitives/select-reorderable.ts](packages/design-system/src/prompts/primitives/select-reorderable.ts), new test `select-reorderable.test.ts` next to it. Re-export from [packages/design-system/src/prompts/index.ts](packages/design-system/src/prompts/index.ts) and [packages/design-system/src/index.ts](packages/design-system/src/index.ts).
   - Steps: write tests (mock-stdin keypresses, assert behavior), implement using `readline.emitKeypressEvents` + raw mode + ANSI cursor save/restore for redraw.

2. **Switch `discoverAllPlans` to task-list.**
   - Files: [packages/plan-browser/src/discovery.ts](packages/plan-browser/src/discovery.ts), [packages/plan-browser/src/types.ts](packages/plan-browser/src/types.ts), [packages/plan-browser/src/discovery.test.ts](packages/plan-browser/src/discovery.test.ts).
   - Add `id` and `displayIndex` to `PlanEntry`. Replace `discoverSharedPlans` with a task-list-backed implementation that mirrors [packages/agent-harness-tools/src/plans.ts:174-200](packages/agent-harness-tools/src/plans.ts#L174-L200). Drop the `updatedAt` sort.

3. **Migrate archive / delete to task-list.**
   - Files: [packages/plan-browser/src/actions.ts](packages/plan-browser/src/actions.ts), [packages/plan-browser/src/actions.test.ts](packages/plan-browser/src/actions.test.ts), and the CLI sites in [src/cli/commands/plan.ts](src/cli/commands/plan.ts) (`executePlanAction` cases for archive / delete).
   - Open the task-list once per CLI call; re-use the same opener helper as discovery (factor `openPlansTaskList` into a small internal helper in plan-browser).

4. **Wire reorder into the browser.**
   - Files: [packages/plan-browser/src/browser.ts](packages/plan-browser/src/browser.ts), new `browser.move.test.ts`, extend `browser.e2e.test.ts`.
   - Replace the `select` call with `selectReorderable`, supplying `onReorder` that calls `tasks.move(...)`, re-runs `discoverAllPlans`, and returns `{ options, cursor }` keyed on the moved plan's `id`. Pass through the footer string as a single line.

5. **Make `poe-code` (no args) launch the browser.**
   - Files: [src/cli/program.ts](src/cli/program.ts), [src/cli/commands/plan.ts](src/cli/commands/plan.ts) (export `runPlanBrowserFromCli`), [src/cli/program.test.ts](src/cli/program.test.ts).
   - Extract the `plan browse` action body into `runPlanBrowserFromCli(program, container)` and invoke from both. In `program.action`, check `process.stdin.isTTY && process.stdout.isTTY` before invoking; otherwise `outputHelp()`.

6. **README addition.**
   - File: top-level project README. Add the section in §2 of this plan under "Quick start". Per CLAUDE.md, get explicit user sign-off before editing the README.

7. **Build, lint, type-check, run all package tests, then run the e2e plan-browser test.** Capture screenshots for the new browser footer and the no-args launch path before declaring done.
