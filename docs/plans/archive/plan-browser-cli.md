---
status:
  state: completed
  iteration: 10
---
# Plan Browser CLI

A unified CLI command for browsing, viewing, and managing plans across all three plan systems (pipeline, experiment, ralph).

## Context

Plans are currently scattered across three systems with separate discovery:

| System     | Directory                        | Format             | Discovery module                              |
|------------|----------------------------------|--------------------|-----------------------------------------------|
| Pipeline   | `.poe-code/pipeline/plans/`      | YAML (`plan*.yaml`)| `@poe-code/pipeline` `plan/discovery.ts`      |
| Experiment | `.poe-code/experiments/`         | Markdown + YAML FM | `experiment.ts` `discoverExperimentDocs()`     |
| Ralph      | `.poe-code/ralph/plans/`         | Markdown + YAML FM | `@poe-code/ralph` `discovery/discovery.ts`     |

Each respects `plan_directory` config overrides and `~/` global dirs. There is no unified view.

## Goal

`poe-code plan` — a single interactive command that merges all plans into one browsable list with preview, and supports archive/delete/edit via key presses.

## Design

### Command structure

```
poe-code plan                    # interactive browser (default)
poe-code plan list               # non-interactive list (table output)
poe-code plan view <path>        # render a single plan to terminal
poe-code plan edit <path>        # open plan in $EDITOR
poe-code plan archive <path>     # move plan to archive/
poe-code plan delete <path>      # delete plan (with confirmation)
```

All subcommands also work non-interactively with `--yes` and `--output json/md`.

`--source <pipeline|experiment|ralph>` filters the list to a single plan system.

### Package placement

New package: `packages/plan-browser/`

Rationale: keeps core lightweight (per CLAUDE.md), plan browsing is a cross-cutting concern that doesn't belong in pipeline/ralph/experiment packages. The CLI command in `src/cli/commands/plan.ts` wires it.

### Unified discovery

`packages/plan-browser/src/discovery.ts`

```ts
type PlanEntry = {
  path: string;           // relative display path
  absolutePath: string;   // resolved absolute path
  source: "pipeline" | "experiment" | "ralph";
  format: "yaml" | "markdown";
  title: string;          // derived from filename or frontmatter
  status: string;         // e.g. "3/5 done", "open", "in_progress iteration 2"
  updatedAt: number;      // mtimeMs for sorting
};

function discoverAllPlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
}): Promise<PlanEntry[]>;
```

Reuses existing discovery functions from each package:
- Calls `@poe-code/pipeline`'s `listPlanCandidates` (or equivalent scan)
- Calls `@poe-code/ralph`'s `discoverDocs`
- Calls experiment's `discoverExperimentDocs` pattern (extracted to shared fn)

Merges results, deduplicates by absolute path, sorts by `updatedAt` desc (most recent first).

### Interactive browser — UX flow

`packages/plan-browser/src/browser.ts`

The browser is a loop with three states: **list → preview → action**.

#### State 1: Plan list

Uses design-system `select`. The `hint` field shows the source type. The label uses `text.selectLabel(filename, detail)` with per-source stats.

```
◆  Select a plan
│  ○ plan-feature-x.yaml — 3/5 done                      (pipeline)
│  ● spawn-hooks.md — claude-code · ×3 · in_progress 2   (ralph)
│  ○ speed-up-tests.md — claude-code · minimize · open    (experiment)
└
```

The detail string is built per source by a `formatDetail` function in `format.ts`:
- Pipeline: `${done}/${total} done` (reuses `countCompletedTasks` from `@poe-code/pipeline`)
- Ralph: same logic as `formatDocHint` in `ralph.ts` — joins agent, `×iterations`, state+iteration
- Experiment: joins agent, metric direction(s), state

**Controls:**
- `↑` / `↓` — navigate list
- `Enter` — open plan preview (→ State 2)
- `Esc` / `Ctrl+C` — exit browser

#### State 2: Plan preview

Renders the plan content using `renderMarkdown()` from `@poe-code/design-system/terminal-markdown`. For YAML pipeline plans: convert task list to markdown first (checkmarks for done tasks).

After the rendered content, show an action prompt:

```
◆  Action
│  ○ Back to list
│  ○ Edit in $EDITOR
│  ○ Archive
│  ○ Delete
└
```

**Controls:**
- `↑` / `↓` — navigate actions
- `Enter` — execute selected action (→ State 3 or back to State 1)
- `Esc` / `Ctrl+C` — back to plan list (State 1), not exit

#### State 3: Action execution

- **Back to list** — returns to State 1, re-discovers plans (list may have changed)
- **Edit** — spawns `$EDITOR`, browser resumes at State 1 after editor exits
- **Archive** — shows `confirmOrCancel("Archive spawn-hooks.md?")`, on confirm moves file, returns to State 1
- **Delete** — shows `confirmOrCancel("Permanently delete spawn-hooks.md?")`, on confirm deletes file, returns to State 1

After archive/delete, the list refreshes automatically (re-runs discovery).

#### Full flow diagram

```
┌─────────────────────────────────────┐
│         State 1: Plan list          │
│  ↑/↓ navigate, Enter select, Esc exit│
└──────────────┬──────────────────────┘
               │ Enter
               ▼
┌─────────────────────────────────────┐
│       State 2: Plan preview         │
│  rendered markdown + action menu    │
│  ↑/↓ navigate, Enter act, Esc back │
└──────────────┬──────────────────────┘
               │ Enter
               ▼
┌─────────────────────────────────────┐
│      State 3: Action execution      │
│  edit / archive+confirm / delete+confirm │
│  → returns to State 1 (refreshed)   │
└─────────────────────────────────────┘
```

### Edit

Resolve editor: `process.env.EDITOR || process.env.VISUAL || "vi"`

```ts
import { spawnSync } from "node:child_process";

function editPlan(absolutePath: string): void {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  spawnSync(editor, [absolutePath], { stdio: "inherit" });
}
```

### Archive

Each plan system already has an `archive/` convention (see `docs/plans/archive/`).

Archive = move file to `<plan-directory>/archive/<filename>`.

- Create `archive/` subdirectory if it doesn't exist
- Show confirmation via `confirmOrCancel({ message: "Archive <plan-name>?" })`
- Move file (rename)
- Log success

For pipeline plans in `.poe-code/pipeline/plans/` → `.poe-code/pipeline/plans/archive/`
For ralph plans in configured dir → `<dir>/archive/`
For experiment docs → `.poe-code/experiments/archive/`

### Delete

- Show confirmation via `confirmOrCancel({ message: "Permanently delete <plan-name>?" })`
- `fs.unlink(absolutePath)`
- Log success

### Non-interactive list (`plan list`)

Table output using `renderTable`. The "Detail" column uses the same `formatDetail` string from each source:

| Source     | Name                    | Detail                                  | Updated    |
|------------|------------------------|-----------------------------------------|------------|
| pipeline   | plan-feature-x.yaml    | 3/5 done                                | 2026-04-06 |
| ralph      | spawn-hooks.md         | claude-code · ×3 · in_progress 2        | 2026-04-05 |
| experiment | speed-up-tests.md      | claude-code · minimize · open            | 2026-04-04 |

Supports `--output json` and `--output md`.

### Non-interactive view (`plan view`)

Renders plan content through `renderMarkdown`. For pipeline YAML plans, converts task list to markdown first.

## File structure

```
packages/plan-browser/
├── package.json
├── README.md
├── src/
│   ├── index.ts              # public API exports
│   ├── discovery.ts          # unified plan discovery
│   ├── browser.ts            # interactive browser loop
│   ├── actions.ts            # edit, archive, delete implementations
│   ├── format.ts             # plan content formatting (YAML→MD, status extraction)
│   ├── types.ts              # PlanEntry, DiscoveryFs types
│   └── __tests__/
│       ├── discovery.test.ts
│       ├── actions.test.ts
│       └── format.test.ts
src/cli/commands/
├── plan.ts                   # CLI command registration (wires package)
```

## Testing

### Unit tests (memfs)

Standard unit tests for pure logic — discovery, format, actions. Use `memfs` for filesystem.

- `discovery.test.ts` — aggregation from 3 sources, dedup, sorting, `--source` filtering
- `format.test.ts` — `formatDetail` for each source type, YAML→markdown conversion
- `actions.test.ts` — archive (mkdir + rename), delete (unlink), edit (assert spawnSync called with correct args)

### Interactive testing with terminal-pilot

The interactive browser flow (list → preview → action → loop) must be tested end-to-end via `terminal-pilot`. These tests spawn a real PTY and drive the UI with keypresses.

Test file: `packages/plan-browser/src/__tests__/browser.e2e.test.ts`

#### Test scenarios

**1. Browse and preview a plan**
```
session.waitFor("Select a plan")
session.press("Enter")              // select first plan
session.waitFor("Action")           // preview rendered, action menu visible
session.press("Escape")             // back to list
session.waitFor("Select a plan")    // list shown again
```

**2. Esc from list exits browser**
```
session.waitFor("Select a plan")
session.press("Escape")
session.waitForExit()
// exit code 0
```

**3. Navigate, preview, then archive**
```
session.waitFor("Select a plan")
session.press("ArrowDown")          // move to second plan
session.press("Enter")              // preview
session.waitFor("Action")
session.press("ArrowDown")          // skip "Back to list"
session.press("ArrowDown")          // skip "Edit"
session.press("Enter")              // select "Archive"
session.waitFor("Archive")          // confirmation prompt
session.press("Enter")              // confirm (yes is default)
session.waitFor("Select a plan")    // back to list, plan removed
```

**4. Delete with confirmation**
```
session.waitFor("Select a plan")
session.press("Enter")
session.waitFor("Action")
session.press("ArrowDown")          // skip to Delete
session.press("ArrowDown")
session.press("ArrowDown")
session.press("Enter")
session.waitFor("Permanently delete")
session.press("Enter")              // confirm
session.waitFor("Select a plan")    // back to list
```

**5. Edit opens $EDITOR and returns**
```
// set EDITOR=cat (non-interactive, exits immediately)
session.waitFor("Select a plan")
session.press("Enter")
session.waitFor("Action")
session.press("ArrowDown")          // "Edit in $EDITOR"
session.press("Enter")
session.waitFor("Select a plan")    // back to list after editor exits
```

**6. Source filter shows only matching plans**
```
// launched with --source pipeline
session.waitFor("Select a plan")
screen = session.screen()
// assert screen contains "(pipeline)" hints only
// assert no "(ralph)" or "(experiment)" hints
```

#### Test setup

Each test creates a temp directory with fixture plans for all three sources, spawns `poe-code plan` via terminal-pilot, and cleans up after.

### Visual validation

Screenshot all key states via `npm run screenshot-poe-code -- plan` for adhoc review during development. Not automated.

## Implementation order

1. **Types & format** — `types.ts`, `format.ts` with tests. Status extraction from pipeline YAML, ralph frontmatter, experiment frontmatter. YAML-to-markdown converter for pipeline plans.
2. **Discovery** — `discovery.ts` with tests (memfs). Aggregates from all three sources, deduplication, sorting.
3. **Actions** — `actions.ts` with tests (memfs). Edit (spawn), archive (mkdir + rename), delete (unlink). Confirmation wired at CLI layer, not in actions themselves.
4. **Browser** — `browser.ts`. Interactive loop: list → select → render → action → loop. Uses design-system prompts.
5. **CLI command** — `plan.ts`. Register `plan`, `plan list`, `plan view`, `plan edit`, `plan archive`, `plan delete`. Wire to browser/actions.
6. **Interactive tests** — terminal-pilot e2e tests for the 6 scenarios above.
7. **Screenshot validation** — Visual spot-check via `npm run screenshot-poe-code`.

## Constraints

- No if/case branching on provider — discovery functions per source are called uniformly via array iteration
- Tests use `memfs`, no real filesystem
- No `@clack/prompts` or `chalk` directly — use `@poe-code/design-system`
- Archive/delete confirmations required in interactive mode, skipped with `--yes`
- `--yes` selects first plan and accepts defaults
- Plan browser is a skill secondary concern — focus on CLI first, skill integration later

## Decisions

- `--source <pipeline|experiment|ralph>` — yes, included
- `--archived` — no, archived plans are not surfaced
- `plan edit` — no watch/re-render after editor exits; standard fire-and-forget $EDITOR behavior
