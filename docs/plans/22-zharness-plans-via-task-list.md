---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: task-list-options
    title: Add singleList + frontmatterMode options to task-list types and open
    prompt: |
      Extend `@poe-code/task-list` so the `markdown-dir` backend can be opened in a
      single-list, passthrough-frontmatter mode. This task is type plumbing only —
      no behavior change yet.

      In `packages/task-list/src/types.ts`:

      1. Add two optional fields to `OpenTaskListOptions`:

         ```ts
         singleList?: string;
         frontmatterMode?: "strict" | "passthrough";
         ```

      2. Add the same fields to `BackendDeps`. In `BackendDeps`, `frontmatterMode`
         is required (no `?`) — the default is filled by `open.ts`. `singleList`
         stays optional.

      In `packages/task-list/src/open.ts`:

      - Pass `options.singleList` straight through to `BackendDeps`.
      - Pass `options.frontmatterMode ?? "strict"` to `BackendDeps`.

      Tests in `packages/task-list/src/open-task-list.test.ts`:

      - Existing tests must still pass with no changes (defaults preserve behavior).
      - Add one new test: opening with `singleList: "plans"` and
        `frontmatterMode: "passthrough"` does not throw and returns a `TaskList`.

      Constraints:
      - No new files.
      - `markdown-dir.ts` itself is not modified yet — it ignores the new fields
        in this task. (If TypeScript flags unused fields, suppress via underscore
        prefix or a small no-op read; the next task uses them.)
      - Do not modify `gh-issues` types or any other backend.
    status:
      implement: done
      test: done
      commit: done

  - id: markdown-dir-single-list
    title: markdown-dir singleList layout — root is the list
    prompt: |
      In `packages/task-list/src/backends/markdown-dir.ts`, implement the
      `singleList` layout. When `deps.singleList` is set, the backend treats
      the root `path` itself as the (only) list — no list subdirectory.

      Add an internal helper:

      ```ts
      type ListLayout = { kind: "multi" } | { kind: "single"; name: string };
      function resolveListLayout(deps: BackendDeps): ListLayout {
        return deps.singleList
          ? { kind: "single", name: deps.singleList }
          : { kind: "multi" };
      }
      ```

      Refactor the path helpers to take a layout:

      - `listPath(rootPath, layout, list)`: in single mode returns `rootPath`; in
        multi mode returns `path.join(rootPath, list)`.
      - `archiveDirectoryPath(rootPath, layout, list)`: in single mode returns
        `path.join(rootPath, "archive")`; in multi mode returns
        `path.join(rootPath, list, "archive")`.
      - `archivedTaskPath(rootPath, layout, list, id)`: same shape as above plus
        `${id}.md`.

      Wire the layout into:

      - `lists()`: in single mode returns `[layout.name]`. In multi mode
        unchanged.
      - `list(name)`: in single mode requires `name === layout.name`, otherwise
        throws `Error("Task list \"<name>\" not found.")` matching the existing
        error style. In multi mode unchanged.
      - `moveBetweenLists(qualifiedId, targetList)`: in single mode always
        throws `Error("moveBetweenLists is unsupported in single-list mode.")`.

      Subdirectories of the root other than `archive/` are ignored when scanning
      active tasks in single mode (mirror what multi mode does for non-list
      directories).

      Tests in `packages/task-list/src/backends/markdown-dir.test.ts` (use memfs):

      - Open with `singleList: "plans"`, write `<root>/foo.md` and
        `<root>/01-bar.md`. `lists()` returns `["plans"]`.
        `list("plans").all()` returns both tasks.
      - `list("other")` throws.
      - `moveBetweenLists("plans/foo", "plans")` throws.
      - A subdirectory `<root>/poe-agent/` containing markdown is ignored.
      - In multi mode (no `singleList`), all existing behavior is unchanged —
        the existing test suite confirms this; do not modify those tests.

      Constraints:
      - `frontmatterMode` is not yet wired; assume `"strict"` for reading in
        this task (existing `assertValidTaskRecord` runs unchanged).
      - Do not change `move`/`reorder`/`fire` semantics yet beyond what the
        layout helpers require.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: markdown-dir-passthrough
    title: markdown-dir frontmatterMode passthrough — read and write loose frontmatter
    prompt: |
      In `packages/task-list/src/backends/markdown-dir.ts`, implement the
      `frontmatterMode: "passthrough"` mode so the backend can manage markdown
      files whose frontmatter is not task-shaped (e.g. plan files with
      `kind: pipeline`).

      Read path:

      - When `deps.frontmatterMode === "passthrough"`, skip
        `assertValidTaskRecord`. Instead synthesize defaults:
        - `name` defaults to the filename stem with any `NN-` prefix stripped
          if `frontmatter.name` is missing or non-string.
        - `state` defaults to `stateMachine.initial` if `frontmatter.state` is
          missing or not in `validStates`.
        - `description` continues to come from the markdown body.
      - `metadataFromFrontmatter` uses a smaller reserved set in passthrough
        mode: only `name`, `state`, `description`. Other keys (including
        `$schema`, `kind`, `version`) flow into `Task.metadata`.

      Write path (used by `create`, `update`, `fire`):

      - In passthrough mode, do NOT inject `$schema: <task schema id>`,
        `kind: "task"`, or `version: 1` when serializing. Round-trip every
        frontmatter key the file already had, mutating only the recognized
        fields (`name`, `state`, `description`) plus any explicit metadata
        patches the caller passed.
      - In strict mode, current behavior is unchanged.

      Tests in `packages/task-list/src/backends/markdown-dir.test.ts` (memfs):

      - With `singleList: "plans"`, `frontmatterMode: "passthrough"`: write a
        file `<root>/foo.md` whose frontmatter is
        ```yaml
        $schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
        kind: pipeline
        version: 1
        ```
        and an empty body. `list("plans").get("foo")` returns a Task whose
        `state` equals the state machine's initial state, `name` equals
        `"foo"`, and `metadata.kind === "pipeline"`,
        `metadata.$schema === "...pipeline.schema.json"`, `metadata.version === 1`.
      - `fire("foo", "<event>")` (any non-archive event) writes the file with
        the new `state` set on frontmatter, and the original `kind`,
        `$schema`, `version` keys are preserved verbatim. Read the file back
        and confirm the YAML keys.
      - In strict mode (no `frontmatterMode`), an unrecognized
        `kind: pipeline` still throws `MalformedTaskError` — confirm this is
        the existing test, no regression.

      Constraints:
      - Do not change strict mode behavior.
      - Do not modify gh-issues or yaml-file backends.
      - Filename → id translation (strip `NN-`) is already handled by
        `parseActiveFilename`; reuse it for the synthesized name default.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: markdown-dir-archive-repack
    title: markdown-dir fire(archive) repacks remaining prefixes
    prompt: |
      In `packages/task-list/src/backends/markdown-dir.ts`, fix the `fire`
      flow so archiving a task also re-packs the order prefixes of the
      remaining active tasks. Currently the active file is moved into
      `archive/` but its prefix slot is left as a gap.

      Locate the `event.to === "archived"` branch in `fire` (around line 703).
      Refactor so the archive flow:

      1. Acquires `withListLock` (the same lock used by `move`/`reorder`).
         The current code uses only `withTaskLock`; the archive branch needs
         both — task lock for the file being archived, list lock for the
         repack. Take list lock outside, task lock inside, to keep the
         existing acquisition order consistent across the file.
      2. Performs the existing serialize + mkdir + rename of the active file
         into `<archive>/<id>.md`.
      3. Reads the remaining active filenames in the list (use the existing
         `readActiveTasks`-style scan) and computes their ids in current
         prefix order.
      4. Calls `rewriteListPrefixes(remainingIds)` so prefixes are gap-free.

      Apply this in both single-list and multi-list layouts (the helper
      `archiveDirectoryPath` from the singleList task already returns the
      right path for either).

      Tests in `packages/task-list/src/backends/markdown-dir.test.ts`:

      - Multi-list: list with three tasks `01-foo`, `02-bar`, `03-baz`.
        `fire("bar", "archive")`. Assert the active dir now contains
        `01-foo.md` and `02-baz.md` (renumbered) and the archive contains
        `bar.md`. Snapshot the directory listing.
      - Single-list (`singleList: "plans"`, passthrough): same scenario at
        the root path. Same assertions adapted to root-level paths.
      - Archive the only task: active list becomes empty, archive contains
        one file, no `.md` left at root (multi: list dir is empty except
        `archive/`).
      - Concurrency: two `fire(_, "archive")` calls on different ids run
        sequentially under the list lock and produce a consistent gap-free
        prefix sequence (use the same memfs lock harness as existing
        reorder tests).

      Constraints:
      - Default-on for every consumer of `markdown-dir`. No flag.
      - Strict-mode tests with the default state machine continue to pass.
      - Do not change behavior for non-archive `fire` calls.
    status:
      implement: done
      test: done
      commit: done

  - id: agent-harness-tools-plans
    title: agent-harness-tools — discoverPlans / archivePlan / openPlanList
    prompt: |
      Add a shared plan-management API to `@poe-code/agent-harness-tools`
      that wraps `@poe-code/task-list` for harness use.

      In `packages/agent-harness-tools/package.json`, add to `dependencies`:

      ```json
      "@poe-code/task-list": "workspace:*"
      ```

      Create `packages/agent-harness-tools/src/plans.ts` exporting:

      ```ts
      import type { TaskList, TaskListFs } from "@poe-code/task-list";

      export interface PlanRef {
        id: string;
        absolutePath: string;
        displayPath: string;
        kind: string;
        name: string;
      }

      export interface DiscoverPlansOptions {
        cwd: string;
        homeDir: string;
        planDirectory: string;
        kinds?: readonly string[];
        fs?: TaskListFs;
      }

      export interface ArchivePlanOptions {
        cwd: string;
        homeDir: string;
        planDirectory: string;
        id: string;
        fs?: TaskListFs;
      }

      export interface OpenPlanListOptions {
        cwd: string;
        homeDir: string;
        planDirectory: string;
        fs?: TaskListFs;
      }

      export function discoverPlans(options: DiscoverPlansOptions): Promise<PlanRef[]>;
      export function archivePlan(options: ArchivePlanOptions): Promise<void>;
      export function openPlanList(options: OpenPlanListOptions): Promise<TaskList>;
      ```

      Implementation:

      - Internally resolve the plan directory with `resolveWorkflowPath` from
        `./paths.js`.
      - All three functions open a markdown-dir task list with:
        ```ts
        openTaskList({
          type: "markdown-dir",
          path: <resolved>,
          singleList: "plans",
          frontmatterMode: "passthrough",
          fs: options.fs,
        });
        ```
      - `discoverPlans` calls `taskList.list("plans").all()`, then maps each
        Task to a `PlanRef`:
        - `id` = `task.id`
        - `name` = `task.name`
        - `kind` = `String(task.metadata.kind ?? "plan")`
        - `absolutePath` = the resolved file path (compute from
          `<resolved>/[NN-]<id>.md` — the backend does not surface this, so
          stat the directory once per call to find the actual filename, or
          read it from the entry list returned by an internal helper. If the
          backend lacks a way to surface the filename, add one — keep it
          minimal).
        - `displayPath` = path relative to `cwd` if the resolved path is
          under `cwd`, else `~/`-prefixed if under `homeDir`, else absolute
          (mirror `discoverWorkflowDocs` display logic in `paths.ts`).
        - If `options.kinds` is provided, filter `metadata.kind` against it.
      - `archivePlan` opens the list and calls
        `taskList.list("plans").fire(id, "archive")`. Return void.
        The state machine for plans is the default `defaultStateMachine`,
        which has an `archive` event from any state to `archived`. Verify
        this event exists in the state machine; if not, supply a custom
        `stateMachine` to `openTaskList` with one event named `archive`
        whose `from: "*"` and `to: "archived"`.
      - `openPlanList` returns the underlying `TaskList`.

      If the resolved directory does not exist, `discoverPlans` returns
      `[]` (do not throw — match current per-harness discovery behavior).

      Tests in `packages/agent-harness-tools/src/plans.test.ts` (memfs):

      - `discoverPlans` returns plans with kind from frontmatter; sets
        `metadata.kind` correctly.
      - `discoverPlans({ kinds: ["pipeline"] })` filters out non-pipeline
        kinds.
      - `discoverPlans` returns `[]` when the directory does not exist.
      - `discoverPlans` ignores `archive/` and non-plan subdirectories.
      - `archivePlan({ id })` moves the file to `archive/` and the next
        `discoverPlans` call shows renumbered prefixes (gap-free).
      - `archivePlan({ id })` throws `TaskNotFoundError` for an unknown id.

      Constraints:
      - Use `memfs` for filesystem in tests; pass the in-memory fs via
        `options.fs`.
      - No `@modelcontextprotocol/sdk`, no `child_process`.
      - No new env vars or CLI flags.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: agent-harness-tools-export
    title: Re-export plans API from agent-harness-tools index
    prompt: |
      In `packages/agent-harness-tools/src/index.ts` add:

      ```ts
      export {
        discoverPlans,
        archivePlan,
        openPlanList,
      } from "./plans.js";
      export type {
        PlanRef,
        DiscoverPlansOptions,
        ArchivePlanOptions,
        OpenPlanListOptions,
      } from "./plans.js";
      ```

      Update `packages/agent-harness-tools/README.md` only if it already
      enumerates exports — add the new entries to the existing list. Do not
      add new sections or expand documentation beyond what is already there.

      Constraints:
      - Re-export only. No logic changes.
      - Verify with `npm run build --workspace @poe-code/agent-harness-tools`.
    status:
      implement: done
      commit: done

  - id: pipeline-migrate
    title: Migrate pipeline harness to shared plan API
    prompt: |
      Switch the pipeline harness off its bespoke `archivePlan` helper and
      onto the shared `archivePlan` from `@poe-code/agent-harness-tools`.
      Keep pipeline-specific discovery (done/total counts, prompt UX) but
      build it on top of `discoverPlans`.

      In `packages/pipeline/src/run/pipeline.ts`:

      - Delete the local `archivePlan` function (around line 150).
      - At the existing call site (around line 394), replace
        `await archivePlan(fs, absolutePlanPath)` with:
        ```ts
        import { archivePlan as archivePlanShared } from "@poe-code/agent-harness-tools";
        // ...
        const id = path.basename(absolutePlanPath, ".md").replace(/^\d+-/, "");
        await archivePlanShared({
          cwd,
          homeDir,
          planDirectory: configuredPlanDirectory ?? "docs/plans",
          id,
          fs: <existing fs adapter or undefined>,
        });
        ```
        Pull `cwd`, `homeDir`, and `configuredPlanDirectory` from whatever
        is already in scope at the call site.

      In `packages/pipeline/src/plan/discovery.ts`:

      - Keep the public functions `resolvePlanPath` and `resolvePlanPaths`
        and their option shapes — they are consumed by the pipeline CLI.
      - Replace the internals: instead of scanning markdown files directly,
        call `discoverPlans({ cwd, homeDir, planDirectory, kinds: ["pipeline"], fs })`
        from `@poe-code/agent-harness-tools` to get the candidate list.
      - Continue to compute `done/total` per candidate by reading and
        parsing the plan body via the existing `parsePlan` (this stays
        pipeline-specific).
      - The `displayPath` returned by `discoverPlans` is the same shape the
        prompt UX needs.

      Add `@poe-code/agent-harness-tools` already exists as a dep, so no
      package.json change is required. Confirm.

      Tests:

      - Existing pipeline discovery tests must pass after the swap.
        Where the test asserted directory state after archive, update the
        assertion to expect the renumbered remaining files.
      - Where the test asserted on the local `archivePlan`'s exact rename,
        switch to checking that the file moved to `archive/<id>.md` and the
        active list is gap-free.
      - Run `npm test --workspace @poe-code/pipeline`.

      Constraints:
      - No CLI surface changes.
      - Plan filenames are still flat (no NN- prefix yet) — the rename
        happens in a later task. The shared API tolerates files without
        prefixes.
    status:
      implement: done
      test: done
      commit: done

  - id: ralph-migrate
    title: Migrate ralph harness to shared plan API
    prompt: |
      Switch the ralph harness off its bespoke `archivePlan` helper and
      `discovery/discovery.ts` onto the shared API.

      In `packages/ralph/src/run/ralph.ts`:

      - Delete the local `archivePlan` function (around line 496).
      - Replace both call sites (around line 201 and line 236):
        ```ts
        import { archivePlan as archivePlanShared } from "@poe-code/agent-harness-tools";
        // ...
        const id = path.basename(absoluteDocPath, ".md").replace(/^\d+-/, "");
        await archivePlanShared({
          cwd,
          homeDir,
          planDirectory: planDirectory ?? ".poe-code/ralph/plans",
          id,
        });
        ```

      In `packages/ralph/src/discovery/discovery.ts`:

      - Replace the body of `discoverDocs` (the public function) with a
        thin call into `discoverPlans({ cwd, homeDir, planDirectory, kinds: ["ralph"], fs })`
        and adapt the return shape (the existing
        `Array<{ path; displayPath }>`) from the resulting `PlanRef[]`.
      - Keep the function's signature and exports unchanged so callers do
        not need to be touched in this task.

      Confirm `@poe-code/agent-harness-tools` is already in the ralph
      package's dependencies (it is — ralph already imports
      `discoverWorkflowDocs` from it). No `package.json` change.

      Tests:

      - Run `npm test --workspace @poe-code/ralph`.
      - Update tests that asserted on the local `archivePlan` to assert on
        the directory state after archive (file moved to `archive/`,
        remaining files renumbered gap-free).
      - Existing ralph plan discovery tests should pass with no changes
        beyond fixture filename adjustments if any test fixture relied on
        flat names — keep flat names; rename happens later.

      Constraints:
      - No CLI surface changes.
      - The state machine the ralph plans see is the shared-API default.
        If any existing ralph test asserted on a specific state machine,
        confirm the default has the `archive` event (it does).
    status:
      implement: done
      test: done
      commit: done

  - id: experiment-loop-migrate
    title: Migrate experiment-loop harness to shared plan API
    prompt: |
      Switch experiment-loop off its bespoke
      `discovery/discovery.ts` onto the shared API.

      In `packages/experiment-loop/src/discovery/discovery.ts`:

      - Replace the body of `discoverExperimentDocs` (the public
        function) with a thin call into
        `discoverPlans({ cwd, homeDir, planDirectory, kinds: ["experiment"], fs })`
        from `@poe-code/agent-harness-tools`. Adapt the return shape (the
        existing `Array<{ path; displayPath }>`) from `PlanRef[]`.
      - Keep the function signature and exports unchanged so callers are
        not touched.

      Confirm `@poe-code/agent-harness-tools` is already a dependency (it
      is — experiment-loop imports `discoverWorkflowDocs` from it). No
      `package.json` change.

      experiment-loop has no `archivePlan` flow today — leave that alone.

      Tests:

      - Run `npm test --workspace @poe-code/experiment-loop`.
      - Existing discovery tests should pass with no changes; if any
        relied on a non-`experiment` kind in fixtures, fix the fixture
        rather than the test.

      Constraints:
      - No CLI surface changes.
      - No new dependencies.
    status:
      implement: done
      test: done
      commit: done

  - id: superintendent-migrate
    title: Migrate superintendent harness to shared plan discovery
    prompt: |
      Switch the superintendent harness off its local
      `discoverSuperintendentDocs` helper onto the shared API.

      In `packages/superintendent/src/commands/run.ts`:

      - Locate `discoverSuperintendentDocs` (around line 830) and the
        call site (around line 798).
      - Replace the call site's invocation with:
        ```ts
        import { discoverPlans } from "@poe-code/agent-harness-tools";
        // ...
        const docs = await discoverPlans({
          cwd,
          homeDir,
          planDirectory: planDirectory ?? "docs/plans",
          kinds: ["superintendent"],
          fs,
        });
        ```
        Adapt the consumer code to the `PlanRef[]` shape (the consumer
        currently expects `Array<{ path; displayPath }>` — map
        `{ path: ref.displayPath, displayPath: ref.displayPath }` if
        needed for minimal-touch).
      - Delete the local `discoverSuperintendentDocs` function (around
        line 830) once the call site is migrated.

      Add `@poe-code/agent-harness-tools` to
      `packages/superintendent/package.json` `dependencies` if it is not
      already present.

      Superintendent has no `archivePlan` flow — leave the runtime alone.

      Tests:

      - Run `npm test --workspace @poe-code/superintendent`.
      - Run `npm run dev -- superintendent --help` to confirm CLI still
        boots (no behavior change to output).

      Constraints:
      - No CLI flag changes.
      - No prompt UX regressions.
    status:
      implement: done
      test: done
      commit: done

  - id: rename-plan-files
    title: Rename existing plan files with NN- prefixes
    prompt: |
      One-time migration: rename every active plan file in the three
      harness plan directories so each starts with a two-digit order
      prefix matching `task-list`'s `markdown-dir` convention.

      Directories to migrate (only if they exist on disk):

      - `docs/plans/` — top-level `*.md` only. Skip subdirectories
        `archive/`, `poe-agent/`, `qa/`, `research/` and their contents.
        Also skip files with names ending in `.lock`.
      - `.poe-code/ralph/plans/` — top-level `*.md` only. Skip `archive/`.
      - `.poe-code/experiments/` — top-level `*.md` only. Skip `archive/`.

      Algorithm per directory:

      1. List top-level markdown files.
      2. Sort alphabetically by the existing filename.
      3. Compute width = max(2, length of decimal count). For ≤99 files
         this is `2`.
      4. Rename in order: `01-<original>.md`, `02-<original>.md`, ...
         Use `git mv` so history is preserved.
      5. Files already starting with `^\d+-` are skipped (do not double-
         prefix). Re-derive their numeric order from the current prefix
         and re-pack only if there are gaps; otherwise leave them.

      Do this with a Node script (no bash); commit only the renames, not
      the script. Run the script from the repo root.

      Verification:

      - `ls docs/plans/*.md` shows every active plan starts with `NN-`.
      - `git status` shows only `R` (rename) entries, no content
        modifications.
      - Run `npm test --workspaces --if-present` to confirm no test
        suite breaks on the renames.

      Constraints:
      - No content edits inside any plan file.
      - Do not touch the `archive/` directories.
      - Do not rename files in `qa/`, `research/`, or `poe-agent/`.
    status:
      implement: open
      commit: open

  - id: cleanup-and-verify
    title: Final cleanup — delete dead code and run full test suite
    prompt: |
      With all four harnesses migrated and plan files renamed, audit the
      tree for dead code and verify everything is green.

      Delete or simplify:

      - In `packages/pipeline/src/run/pipeline.ts`, confirm the local
        `archivePlan` function is gone. No-op if already deleted.
      - In `packages/ralph/src/run/ralph.ts`, confirm the local
        `archivePlan` function is gone.
      - In `packages/superintendent/src/commands/run.ts`, confirm the
        local `discoverSuperintendentDocs` function is gone.
      - In `packages/ralph/src/discovery/discovery.ts` and
        `packages/experiment-loop/src/discovery/discovery.ts`: if the
        files now contain only thin wrappers around `discoverPlans` and
        no caller would lose coverage by collapsing them, inline the
        single call into the consumer and delete the discovery file.
        Otherwise leave the wrapper.

      Run a global grep for orphaned helpers:

      ```bash
      git grep -nE "function archivePlan|function discoverSuperintendentDocs|function discoverPipelineDocs|function discoverRalphDocs|function discoverExperimentDocs"
      ```

      The only matches should be type-level imports of the shared
      `archivePlan` from `@poe-code/agent-harness-tools`.

      Run the full suite:

      - `npm test`
      - `npm run lint:workflows`
      - `npm run dev -- pipeline run --plan docs/plans/01-<some-pipeline-plan>.md --dry-run`
        to smoke-test the discovery + archive path on real renamed files.
        Pick any pipeline plan that exists post-rename.

      Constraints:
      - No content changes to plan files.
      - No new dependencies.
      - No README additions beyond what was added in the export task.
    status:
      implement: open
      test: open
      commit: open
---

# Context

Replace the per-harness plan discovery + archive code with a single shared
`@poe-code/task-list` `markdown-dir` task list, used by experiment-loop, ralph,
pipeline, and superintendent. Archive becomes the `archive` event on the task
lifecycle: the abstraction moves the file under `archive/`, drops its order
prefix, and re-packs the prefixes of the remaining active plans so there are
no gaps.

## Settled design

**Mapping.** One mixed list per directory; harnesses filter by
`Task.metadata.kind` (read from each plan's existing YAML frontmatter). The
markdown-dir backend gains a `singleList` mode (root IS the list) and a
`frontmatterMode: "passthrough"` mode (no schema validation; non-recognized
keys flow through to `metadata`).

**Repack.** `fire(id, "archive")` now calls `rewriteListPrefixes(remainingIds)`
under the list lock after the active file is renamed into `archive/`. Default
on for every consumer of `markdown-dir`.

**Shared API.** `@poe-code/agent-harness-tools` exports `discoverPlans`,
`archivePlan`, and `openPlanList`. Each harness drops its bespoke discovery
file and local `archivePlan`.

**Plan-directory defaults per harness:**

| Harness         | Default `planDirectory` | `kinds` filter       |
| --------------- | ----------------------- | -------------------- |
| pipeline        | `docs/plans`            | `["pipeline"]`       |
| ralph           | `.poe-code/ralph/plans` | `["ralph"]`          |
| experiment-loop | `.poe-code/experiments` | `["experiment"]`     |
| superintendent  | `docs/plans`            | `["superintendent"]` |

**Out of scope.** Replacing the harness-specific plan body parsers (pipeline's
`parsePlan`, superintendent's `parseSuperintendentDoc`); changing default plan
locations; adding `gh-issues` or `yaml-file` to harness discovery; superintendent
archive flow (does not exist today). The `task-list-ordering-and-gh-issues.md`
work runs independently.

## Order of execution

Tasks above are listed in dependency order. Run them sequentially. The cleanup
task at the end deletes anything that became dead code and runs the full test
suite plus a smoke run.
