---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: auto-init-on-missing-frontmatter
    title: Auto-init in run when frontmatter is absent
    prompt: |
      Modify `pipeline run` so that if the target file has no YAML frontmatter (or frontmatter
      with no `tasks` key), it runs `init` on the file first, then proceeds to run.

      Key files:
      - SDK run entry: `src/sdk/pipeline.ts` — `runPipeline()` function
      - SDK init entry: `src/sdk/pipeline.ts` — `runPipelineInit()` function
      - Frontmatter parser: `packages/pipeline/src/plan/parser.ts` — `parsePlan()` / `getYamlContent()`
      - CLI commands: `src/cli/commands/pipeline.ts`

      Implementation approach:
      - In `runPipeline()`, parse the file and check whether the result has a `tasks` array.
        Use `parsePlan()` — do not use regex for frontmatter detection.
      - If `tasks` is missing or empty, call `runPipelineInit()` on the same file path, then re-read
        and continue with `runPipeline()` as normal.
      - `runPipelineInit()` must operate on the file the user passed — it edits that file in place
        (prepends YAML frontmatter). It must NOT create a new file.
      - Note: `buildPipelineInitPrompt` in `src/cli/commands/pipeline-init.ts` passes
        `Plan directory:` in the prompt — remove or suppress this since we are now always editing
        the source file in place, not writing to a separate plan directory.
      - No new CLI flag or command needed. Both `run` code paths (with and without frontmatter)
        remain under the single `run` command.
      - Maintain CLI/SDK parity.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: update-tests
    title: Unit tests for auto-init branch
    prompt: |
      Add unit tests for the modified `runPipeline()` in `src/sdk/pipeline.ts` covering:
      1. File with valid frontmatter and `tasks` → `runPipelineInit` is NOT called, runs directly.
      2. File with no frontmatter → `runPipelineInit` IS called, then run proceeds.
      3. File with frontmatter but `tasks` missing/empty → `runPipelineInit` IS called.

      Use memfs for all file system interactions — no real files.
      Mock LLM/agent calls; tests must be fast.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: fix-tasks-completed-metric
    title: Fix tasksCompleted counting steps instead of tasks
    prompt: |
      Fix the `tasksCompleted` metric in `packages/pipeline/src/run/pipeline.ts` (around line 378).
      Currently it increments on every step success, so a task with 3 steps adds 3 to the count.
      It should only increment once when ALL steps of a task are done (i.e. task status reaches done).
      Update the dashboard display and any downstream consumers of this metric to match.
      Add unit tests covering multi-step task completion count.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: cli-sdk-timeout-parity
    title: Unify activity timeout retry between CLI and SDK
    prompt: |
      Currently `src/cli/commands/pipeline.ts` catches `isActivityTimeoutError` and retries up to
      3 times silently, while `src/sdk/pipeline.ts` has no retry and throws immediately.
      Move the retry logic into the SDK (`runPipeline()`) so both CLI and SDK get the same behaviour.
      The CLI should no longer duplicate this logic.
      Keep the retry count (3) as a constant. Do not expose it as a config option.
      Update tests to cover retry exhaustion throwing the error.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: lock-acquisition-feedback
    title: Show feedback while waiting for plan lock
    prompt: |
      Lock acquisition in `packages/pipeline/src/run/pipeline.ts` (`lockWorkflow()`) blocks
      indefinitely with no user feedback. If the lock isn't acquired within ~2s, emit a message
      via the pipeline's event/output channel (not console.log) telling the user a lock is held and
      they are waiting. The message should resolve (disappear or update) once the lock is acquired.
      Do not add a hard timeout — just feedback.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: vars-throw-on-missing
    title: Throw on unresolved vars instead of silently treating as empty
    prompt: |
      In `packages/pipeline/src/vars/` (and wherever variable interpolation happens), if a
      `{{varName}}` placeholder has no corresponding value in the resolved vars map, throw an error
      immediately rather than substituting an empty string. The error should name the missing
      variable and the task/step it appeared in.
      Also throw at `pipeline validate` time so the problem is caught before any agent is spawned.
      Add unit tests for the throw path.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: per-plan-steps-with-named-extends
    title: Per-plan steps with named extends
    prompt: |
      Replace the implicit path-based steps.yaml lookup (project-level then global) with an
      explicit named-extends system so each plan declares which step config it builds on.

      Design:
      - Named step configs live in `.poe-code/pipeline/steps/` as individual YAML files
        (e.g. `default.yaml`, `fast.yaml`). The existing `steps.yaml` becomes `steps/default.yaml`.
      - A plan's frontmatter can declare `extends: default` (or any named config). If omitted,
        `default` is assumed.
      - The plan frontmatter may then include a `steps:` block that overrides individual steps
        from the extended config. Overrides are deep-merged per step — unset fields are inherited
        from the base, not cleared.
      - Remove the implicit two-level (global → project) path lookup. Named configs are resolved
        from the project `.poe-code/pipeline/steps/` directory only; a global fallback is fine
        only if no project-level directory exists (same resolution as today for the directory,
        but the file is now selected by name, not assumed to be `steps.yaml`).

      Key files to change:
      - `packages/pipeline/src/config/` — step config loader
      - `packages/pipeline/src/plan/parser.ts` — parse `extends` and inline `steps:` from frontmatter
      - `packages/pipeline/src/run/pipeline.ts` — pass resolved steps to execution
      - `src/cli/commands/pipeline-init.ts` — skill prompt no longer needs to mention plan directory
        for step resolution
      - Migration: `pipeline install` should rename `steps.yaml` → `steps/default.yaml` if the old
        file is present, and update any existing plans that don't declare `extends` (they already
        get the default implicitly, so no change needed there).

      Add unit tests covering:
      1. Plan with no `extends` uses `default` config.
      2. Plan with `extends: fast` loads `steps/fast.yaml`.
      3. Inline `steps:` override deep-merges (unset fields preserved from base).
      4. Unknown `extends` name throws a clear error.

      Also update the skill template at `~/.claude/skills/poe-code-pipeline-plan/SKILL.md`:
      - Step 2 of "Before writing" should look for named configs in
        `.poe-code/pipeline/steps/` (project then global) instead of `steps.yaml`.
      - The generated frontmatter should include `extends: default` (or the discovered name)
        instead of inferring steps from a single file.
      - The output format example should show `extends:` and an optional inline `steps:` override.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Pipeline improvements

A collection of related pipeline improvements.

## 1. Auto-init on missing frontmatter

`pipeline run` requires the user to have already run `pipeline init`. Repurpose `run` to detect
missing frontmatter and auto-init first. Init edits the existing file in place — never creates
a new one.

Key files: `src/sdk/pipeline.ts` (`runPipeline`, `runPipelineInit`), `packages/pipeline/src/plan/parser.ts`.

## 2. Fix tasksCompleted metric

Currently increments per step, not per task. A 3-step task adds 3 to the count instead of 1.

## 3. CLI/SDK timeout retry parity

CLI retries on `isActivityTimeoutError` (3 attempts); SDK throws immediately. Retry logic should
live in the SDK so both paths behave the same.

## 4. Lock acquisition feedback

`lockWorkflow()` blocks indefinitely with no output. Emit a waiting message after ~2s.

## 5. Vars throw on missing

Unresolved `{{varName}}` placeholders silently become empty strings. They should throw at
validate time and at run time, naming the missing var and the task it appeared in.

## 6. Per-plan steps with named extends

Replace implicit path-based `steps.yaml` lookup with an explicit named-extends system:

- Named step configs in `.poe-code/pipeline/steps/<name>.yaml`
- Plan frontmatter declares `extends: <name>` (default: `default`)
- Plan can inline `steps:` overrides that deep-merge onto the base — unset fields are inherited
- `pipeline install` migrates existing `steps.yaml` → `steps/default.yaml`
