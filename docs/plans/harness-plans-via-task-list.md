---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Harness plans via task-list

Replace the per-harness plan discovery + archive code with a single `@poe-code/task-list` `markdown-dir` task list, shared by experiment, ralph, pipeline, and superintendent.

## 1. What we're building

Switch every harness — experiment-loop, ralph, pipeline, superintendent — off its bespoke plan discovery and archive logic, onto one shared `@poe-code/task-list` `markdown-dir` task list. Plan files in the configured plan directory (e.g. `docs/plans/`, `.poe-code/ralph/plans/`) are tasks. The harness opens the task list and asks it for the active set, the plan to run, and the archive operation. Archive is the `archive` event on the task lifecycle: the abstraction moves the file under `archive/`, drops its order prefix, and re-packs the prefixes of the remaining active plans so there are no gaps. No harness owns archive logic anymore.

Non-goals:

- Changing plan markdown content or per-harness frontmatter (`kind: pipeline | ralph | superintendent | experiment`).
- Replacing the harness-specific plan parsers (`parsePlan` in pipeline, `parseSuperintendentDoc`, etc.) — those still operate on the file body.
- Changing the storage location for plans (each harness keeps its current default plan directory).
- Adding the `gh-issues` backend or yaml-file backend to harness plan discovery — `markdown-dir` only.
- Migrating the `task-list-ordering-and-gh-issues.md` work; that pipeline runs independently.

## 2. User-facing shape

### Shared discovery API in `@poe-code/agent-harness-tools`

A single new export that every harness consumes. It opens a `task-list` `markdown-dir` over the plan directory, lists active tasks, and (optionally) filters by `kind`.

```ts
import { discoverPlans, archivePlan, openPlanList } from "@poe-code/agent-harness-tools";

// Discovery — replaces three near-identical discovery files.
const plans = await discoverPlans({
  cwd,
  homeDir,
  planDirectory: "docs/plans", // optional; default per harness
  kinds: ["pipeline"],         // optional; filters Task.metadata.kind
});

// plans: Array<{ id: string; absolutePath: string; displayPath: string; kind: string }>

// Archive after a successful run — replaces per-harness archivePlan() helpers.
await archivePlan({ cwd, homeDir, planDirectory: "docs/plans", id: "agent-harness" });
// → moves NN-agent-harness.md to archive/agent-harness.md
// → renumbers every remaining NN-*.md so prefixes are gap-free

// Lower-level handle if a harness needs more (rare).
const list = await openPlanList({ cwd, homeDir, planDirectory: "docs/plans" });
```

`kinds` is matched against `Task.metadata.kind`, which the backend reads from each plan's existing YAML frontmatter (`kind: pipeline | ralph | superintendent | experiment | plan`). No frontmatter changes; the backend already round-trips unknown frontmatter into `metadata`.

### Harness call sites — before / after

Pipeline today (`packages/pipeline/src/run/pipeline.ts`):

```ts
// before
async function archivePlan(fs: PipelineFileSystem, absolutePlanPath: string): Promise<void> {
  const dir = path.dirname(absolutePlanPath);
  const archiveDir = path.join(dir, "archive");
  const archivePath = path.join(archiveDir, path.basename(absolutePlanPath));
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(absolutePlanPath, archivePath);
}
// after
import { archivePlan } from "@poe-code/agent-harness-tools";
await archivePlan({ cwd, homeDir, planDirectory, id: planId });
```

Ralph + experiment-loop drop their entire `discovery/discovery.ts` and replace internal calls to their local `archivePlan` with the same shared call.

Superintendent uses `discoverPlans({ kinds: ["superintendent"] })` in place of its own scan; archive is unchanged for now (superintendent does not currently archive on completion — it stays out of scope until that flow exists).

### Plan filenames

Existing plans get a one-time renumber on this branch:

```text
docs/plans/
  01-agent-harness.md
  02-agent-human-in-loop.md
  03-braintrust-integration.md
  ...
  archive/
    cmdkit-openapi.md
    ...
```

Order is alphabetical-by-id at migration time; subsequent reorders go through `Tasks.move`/`reorder`. The id is the filename stem with the `NN-` stripped — same as the backend already enforces.

### Archive behavior change

`fire(id, "archive")` (and the `task-list-driven archivePlan` wrapper) now repacks the remaining active tasks' prefixes after moving the archived file:

```text
before:                       after fire("02-bar", "archive"):
  01-foo.md                     01-foo.md
  02-bar.md                     02-baz.md       ← was 03
  03-baz.md                     archive/bar.md
```

Default-on for every consumer of `markdown-dir`. The current behavior left dangling prefixes; that's a bug rather than a feature.

### `markdown-dir` flat-root mode

Plans live directly in the directory (`docs/plans/foo.md`), not under a list subdir (`docs/plans/<list>/foo.md`). The backend gains a single new option:

```ts
openTaskList({
  type: "markdown-dir",
  path: "docs/plans",
  singleList: "plans"   // ← new; root IS the list
});
```

Behavior with `singleList`:

- `lists()` returns `[singleList]`.
- `list(name)` requires `name === singleList` (any other throws).
- Active tasks live at `<path>/*.md` / `<path>/NN-*.md`.
- Archived tasks live at `<path>/archive/*.md`.
- `moveBetweenLists` throws — single list.

Without `singleList` the backend behaves exactly as today.

### Plan-directory defaults

Each harness keeps its own default plan directory:

| Harness | Default `planDirectory` | `kinds` filter |
| --- | --- | --- |
| pipeline | `docs/plans` | `["pipeline"]` |
| ralph | `.poe-code/ralph/plans` | `["ralph"]` |
| experiment-loop | `.poe-code/experiments` | `["experiment"]` |
| superintendent | `docs/plans` | `["superintendent"]` |
