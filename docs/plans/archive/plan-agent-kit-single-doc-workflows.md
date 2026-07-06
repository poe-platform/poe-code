---
kind: archived-pipeline-plan
version: 1
source: plan-agent-kit-single-doc-workflows.yaml
task_count: 11
---

# Agent Kit Single Doc Workflows

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  design_doc: "{{file 'docs/plans/agent-kit-single-doc-workflows.md'}}"

tasks:
  # ── Phase 1: Autonomous spawn extraction ──

  - id: spawn-autonomous
    title: Add spawn.autonomous() SDK entry point
    prompt: |
      Extract the duplicated autonomous retry logic into a shared `spawn.autonomous()` entry point.

      Design: {{design_doc}}

      ## Context

      Today `src/sdk/pipeline.ts`, `src/sdk/ralph.ts`, and `src/sdk/experiment.ts` each contain an identical
      try-catch retry loop with `AUTONOMOUS_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000` and `MAX_TIMEOUT_RETRIES = 3`.
      This duplication must be consolidated into a single shared function.

      ## Changes

      ### 1. Create `src/sdk/autonomous.ts`

      Export a function:

      ```typescript
      export async function spawnAutonomous(
        sdkSpawn: SdkSpawnFn,
        options: AutonomousSpawnOptions
      ): Promise<SpawnResult>
      ```

      Where `AutonomousSpawnOptions` extends the existing spawn options with:
      - `activityTimeoutMs?: number` (default: 10 minutes)
      - `maxTimeoutRetries?: number` (default: 3)

      Move the retry loop logic from any of the three SDK files into this function:
      - Try spawning with `activityTimeoutMs`
      - On `isActivityTimeoutError`, retry up to `maxTimeoutRetries` times
      - On final attempt or non-timeout error, throw

      ### 2. Export from `src/sdk/spawn.ts`

      Add `spawn.autonomous` as a method on the spawn namespace, or export `spawnAutonomous` alongside spawn.
      Follow whichever pattern the existing SDK uses for namespaced methods.

      ### 3. Update `src/sdk/pipeline.ts`

      Replace the inline retry loop with a call to `spawnAutonomous`.
      Remove the local `AUTONOMOUS_ACTIVITY_TIMEOUT_MS` and `MAX_TIMEOUT_RETRIES` constants.

      ### 4. Update `src/sdk/ralph.ts`

      Same replacement as pipeline.

      ### 5. Update `src/sdk/experiment.ts`

      Same replacement as pipeline.

      ### 6. Tests

      Add tests in `src/sdk/autonomous.test.ts`:
      - Successful spawn on first attempt returns result
      - Timeout error retries up to max and succeeds on retry
      - Timeout error exhausts retries and throws
      - Non-timeout error throws immediately without retry
      - Custom `activityTimeoutMs` is passed through to spawn
      - Custom `maxTimeoutRetries` controls retry count

      Use TDD. Mock the spawn function. Import `isActivityTimeoutError` from `@poe-code/agent-spawn`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  # ── Phase 2: Agent-kit package scaffolding ──

  - id: agent-kit-scaffold
    title: Create @poe-code/agent-kit package skeleton
    prompt: |
      Create the new `@poe-code/agent-kit` package as a runtime package for reusable autonomous workflow components.

      Design: {{design_doc}}

      ## Steps

      ### 1. Create package structure

      Create `packages/agent-kit/` with:
      - `package.json` — name `@poe-code/agent-kit`, follow the same structure as `packages/pipeline/package.json`
        (same build scripts, same tsconfig extends, same vitest config pattern)
      - `tsconfig.json` — extend shared base like other packages
      - `src/index.ts` — empty initially, will export modules as they are added
      - `README.md` — describe the package purpose: reusable runtime components for autonomous single-document workflows

      ### 2. Add to workspace

      Ensure `packages/agent-kit` is picked up by the pnpm workspace (check `pnpm-workspace.yaml` — if it uses
      a `packages/*` glob it should be automatic, otherwise add it).

      ### 3. Verify

      Run `pnpm install` to link the new package.
      Run `pnpm --filter @poe-code/agent-kit build` to verify it compiles.
    status:
      implement: done
      test: done
      commit: done

  # ── Phase 2b: Shared normalization and path helpers ──

  - id: path-helpers
    title: Add path and document resolution helpers to agent-kit
    prompt: |
      Add shared path resolution and document discovery helpers to `@poe-code/agent-kit`.

      Design: {{design_doc}}

      ## Context

      Pipeline, ralph, and experiment each have their own path resolution logic. Extract the common patterns.

      ## Changes

      ### 1. Create `packages/agent-kit/src/paths.ts`

      Export:

      ```typescript
      export function resolveWorkflowPath(path: string, cwd: string, homeDir: string): string
      ```

      Resolves a user-provided path to an absolute path. If already absolute, return as-is.
      If relative, resolve against `cwd`. Expand `~` to `homeDir`.

      ```typescript
      export interface DiscoverDocsOptions {
        cwd: string;
        homeDir: string;
        subDirectory: string; // e.g. "experiments", "ralph", "pipeline/plans"
        glob?: string; // default "*.md" or "*.yaml" depending on workflow
        fs: { readdir: (path: string) => Promise<string[]> };
      }

      export function discoverWorkflowDocs(options: DiscoverDocsOptions): Promise<string[]>
      ```

      Search order: `<cwd>/.poe-code/<subDirectory>/`, then `<homeDir>/.poe-code/<subDirectory>/`.
      Return absolute paths sorted alphabetically. Deduplicate by filename (project wins over global).

      ### 2. Export from `packages/agent-kit/src/index.ts`

      Export both functions.

      ### 3. Tests in `packages/agent-kit/src/paths.test.ts`

      Use memfs. TDD.

      For `resolveWorkflowPath`:
      - Absolute path returned as-is
      - Relative path resolved against cwd
      - Tilde expanded to homeDir

      For `discoverWorkflowDocs`:
      - Finds docs in project dir
      - Finds docs in home dir
      - Project dir docs shadow home dir docs with same filename
      - Returns sorted results
      - Empty dirs return empty array
      - Missing dirs return empty array (no throw)
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: participant-helpers
    title: Add participant normalization helpers to agent-kit
    prompt: |
      Add participant config normalization helpers to `@poe-code/agent-kit`.

      Design: {{design_doc}}

      ## Changes

      ### 1. Create `packages/agent-kit/src/participant.ts`

      Export types and helpers:

      ```typescript
      export interface WorkflowParticipant {
        id: string;
        agent: string | string[];
        mode?: "read" | "edit" | "yolo";
        model?: string;
        prompt?: string;
      }

      export function normalizeParticipantConfig(
        id: string,
        value: unknown
      ): WorkflowParticipant
      ```

      Normalization rules:
      - If `value` is a string, treat it as `{ agent: value }`
      - If `value` is an object, validate it has `agent` as string or string[]
      - Reject empty string agent, empty array agent
      - Use `normalizeAgentId` from `@poe-code/agent-defs` for each agent string
      - Preserve inline model syntax (e.g. `claude-code:anthropic/claude-opus-4.6`)

      ```typescript
      export function selectParticipantAgent(
        participant: WorkflowParticipant,
        iteration: number
      ): string
      ```

      Selection:
      - If `agent` is a string, return it
      - If `agent` is an array, return `agent[iteration % agent.length]` (round-robin)

      ### 2. Add `@poe-code/agent-defs` as a dependency of `@poe-code/agent-kit`

      ### 3. Export from index

      ### 4. Tests in `packages/agent-kit/src/participant.test.ts`

      TDD with:
      - String agent normalized correctly
      - Object with single agent works
      - Object with agent array works
      - Round-robin selection across iterations
      - Empty string throws
      - Empty array throws
      - Inline model syntax preserved
      - Missing agent field throws
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  # ── Phase 3: Locking and setup/teardown ──

  - id: lock-helpers
    title: Extract shared workflow lock helpers into agent-kit
    prompt: |
      Extract the lock mechanism from pipeline into a shared helper in agent-kit.

      Design: {{design_doc}}

      ## Context

      Pipeline has a production-ready directory-based lock at `packages/pipeline/src/lock/lock.ts`.
      This should be available to all workflow packages.

      ## Changes

      ### 1. Create `packages/agent-kit/src/lock.ts`

      Move or reimplement the core locking logic from pipeline's lock module:

      ```typescript
      export interface LockOptions {
        retries?: number;
        minTimeout?: number;
        maxTimeout?: number;
        staleMs?: number;
        fs?: { mkdir: ...; rmdir: ...; stat: ... };
      }

      export async function lockWorkflow(
        docPath: string,
        options?: LockOptions
      ): Promise<() => Promise<void>>
      ```

      - Lock path derived from `docPath` (append `.lock` directory)
      - Returns an unlock function
      - Uses exponential backoff for contention
      - Detects and cleans stale locks

      ### 2. Update `packages/pipeline` to use `@poe-code/agent-kit` lock

      Replace pipeline's local lock import with the shared one from agent-kit.
      Remove or deprecate `packages/pipeline/src/lock/lock.ts` if it becomes a pure re-export.

      ### 3. Export from agent-kit index

      ### 4. Tests in `packages/agent-kit/src/lock.test.ts`

      Use memfs. TDD.
      - Lock creates directory
      - Unlock removes directory
      - Concurrent lock attempt retries and succeeds after unlock
      - Stale lock is cleaned up
      - Lock path is derived from doc path
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: setup-teardown
    title: Add shared setup/teardown execution helpers to agent-kit
    prompt: |
      Add shared setup and teardown execution helpers to agent-kit.

      Design: {{design_doc}}

      ## Changes

      ### 1. Create `packages/agent-kit/src/hooks.ts`

      Export types and helpers:

      ```typescript
      export interface WorkflowHook {
        participant?: string;
        mode?: "read" | "edit" | "yolo";
        prompt: string;
      }

      export interface HookContext {
        cwd: string;
        participants: Record<string, WorkflowParticipant>;
        runAgent: RunAgentFn;
        signal?: AbortSignal;
      }

      export async function runWorkflowHook(
        hook: WorkflowHook,
        context: HookContext
      ): Promise<void>
      ```

      Behavior:
      - Resolve participant from `hook.participant` (or use a default if omitted)
      - Select agent via `selectParticipantAgent`
      - Call `context.runAgent` with the hook's prompt, resolved agent, and mode
      - If hook fails, throw (caller decides policy)

      ### 2. Export from index

      ### 3. Tests in `packages/agent-kit/src/hooks.test.ts`

      TDD.
      - Hook with explicit participant calls runAgent with correct agent
      - Hook without participant uses default
      - Hook mode is passed through
      - Hook failure propagates error
      - Abort signal is forwarded to runAgent
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  # ── Phase 4: Pipeline simplification ──

  - id: pipeline-remove-blocked
    title: Remove blocked/retry state semantics from pipeline
    prompt: |
      Simplify pipeline's failure model by removing blocked semantics.

      Design: {{design_doc}}

      ## Context

      Pipeline currently has blocked/retry state semantics where a failed task can be "unblocked" by resetting
      its status. This is unnecessarily complex. The new model: a step fails → pipeline stops → user reruns explicitly.
      Autonomous retry is limited to spawn-level transient failures (handled by `spawn.autonomous()`), not
      workflow-level blocked state.

      ## Changes

      ### 1. Audit `packages/pipeline/src/` for blocked-related code

      Search for "blocked", "retry", "reset" in the pipeline package. Identify all locations where:
      - Task status is set to "blocked"
      - Blocked tasks are detected and retried
      - Status is reset to enable retry

      ### 2. Remove blocked state

      - Remove "blocked" from task status types (keep "open", "done", "in_progress", "failed" or similar)
      - Remove any code that transitions tasks to "blocked" state
      - Remove any code that detects blocked tasks and retries them
      - Remove any interactive retry flow that resets failed state

      ### 3. Simplify failure handling

      When a step or task fails:
      - Mark it as failed
      - Stop the pipeline
      - Do not attempt automatic retry at the workflow level

      ### 4. Update tests

      - Remove tests for blocked state transitions
      - Add/update tests for the simplified failure model:
        - Failed task stops pipeline
        - Rerun starts from the failed task
        - No automatic retry at workflow level

      ### 5. Verify

      Run the full pipeline test suite. All tests must pass.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  # ── Phase 5: Document workflow foundation ──

  - id: stage-helpers
    title: Add stage execution types and helpers to agent-kit
    prompt: |
      Add generic stage execution types and helpers to agent-kit.

      Design: {{design_doc}}

      ## Changes

      ### 1. Create `packages/agent-kit/src/stage.ts`

      Export types and helpers:

      ```typescript
      export interface WorkflowStage {
        id: string;
        participant: string;
        prompt?: string;
        mode?: "read" | "edit" | "yolo";
        onFailure?: "stop" | "continue";
      }

      export interface StageContext {
        cwd: string;
        participants: Record<string, WorkflowParticipant>;
        runAgent: RunAgentFn;
        signal?: AbortSignal;
        iteration: number;
      }

      export async function runWorkflowStage(
        stage: WorkflowStage,
        context: StageContext
      ): Promise<{ success: boolean; error?: Error }>
      ```

      Behavior:
      - Resolve participant from `stage.participant` using context.participants
      - Select agent via `selectParticipantAgent` using context.iteration
      - Call `context.runAgent` with stage prompt, resolved agent, and mode
      - On failure: if `onFailure === "continue"`, return `{ success: false, error }`. Otherwise throw.

      ### 2. Export from index

      ### 3. Tests in `packages/agent-kit/src/stage.test.ts`

      TDD.
      - Stage resolves correct participant and agent
      - Round-robin agent selection works across iterations
      - Stage mode overrides participant mode
      - onFailure "stop" throws on error
      - onFailure "continue" returns success: false on error
      - Abort signal forwarded
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: document-runner
    title: Add shared document workflow runner to agent-kit
    prompt: |
      Add a generic document workflow runner that orchestrates reading a single-document workflow,
      running setup, iterating stages, and running teardown.

      Design: {{design_doc}}

      ## Changes

      ### 1. Create `packages/agent-kit/src/runner.ts`

      Export:

      ```typescript
      export interface DocumentWorkflowOptions {
        cwd: string;
        homeDir: string;
        docPath: string;
        fs: WorkflowFileSystem;
        runAgent: RunAgentFn;
        readConfig: (content: string) => { frontmatter: any; body: string };
        signal?: AbortSignal;
        onIterationStart?: (iteration: number) => void;
        onIterationEnd?: (iteration: number, result: IterationResult) => void;
      }

      export type IterationResult = "completed" | "nothing_to_run" | "failed";

      export async function runDocumentWorkflow(
        options: DocumentWorkflowOptions
      ): Promise<void>
      ```

      Orchestration loop:
      1. Read and parse the document via `readConfig`
      2. Acquire lock via `lockWorkflow`
      3. If setup hook defined in frontmatter, run via `runWorkflowHook`
      4. Loop up to `max_iterations`:
         a. For each stage in order, run via `runWorkflowStage`
         b. Call `onIterationEnd` with result
         c. If any stage fails with `onFailure: "stop"`, break
      5. If teardown hook defined, run via `runWorkflowHook`
      6. Release lock in `finally`

      The runner should NOT own domain-specific state transitions — each workflow package
      provides its own `readConfig` and handles its own persistence.

      ### 2. Create `packages/agent-kit/src/sequence.ts`

      Export a sequential multi-document runner:

      ```typescript
      export interface DocumentWorkflowSequenceOptions {
        docPaths: string[];
        stopOnFailure?: boolean; // default true
        onSequenceProgress?: (index: number, total: number, docPath: string) => void;
        // ...same options as single runner minus docPath
      }

      export async function runDocumentWorkflowSequence(
        options: DocumentWorkflowSequenceOptions
      ): Promise<void>
      ```

      Behavior:
      - Iterate `docPaths` in order
      - Call `runDocumentWorkflow` for each
      - On failure: if `stopOnFailure`, stop sequence. Otherwise continue.
      - On `nothing_to_run`: continue to next doc
      - Call `onSequenceProgress` before each doc

      ### 3. Export from index

      ### 4. Tests in `packages/agent-kit/src/runner.test.ts` and `packages/agent-kit/src/sequence.test.ts`

      TDD.

      Runner tests:
      - Runs setup, stages, teardown in correct order
      - Respects max_iterations
      - Lock acquired before execution and released after
      - Lock released even on error (finally)
      - Stage failure with onFailure "stop" breaks loop
      - Abort signal stops execution
      - Calls onIterationStart/onIterationEnd callbacks

      Sequence tests:
      - Runs docs in order
      - stopOnFailure stops sequence on first failure
      - stopOnFailure false continues past failures
      - nothing_to_run continues to next doc
      - Calls onSequenceProgress for each doc
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: ralph-migration
    title: Migrate ralph to use agent-kit shared helpers
    prompt: |
      Migrate `@poe-code/ralph` to use agent-kit shared helpers where possible.

      Design: {{design_doc}}

      ## Context

      Ralph should become a thin single-document loop on top of agent-kit. Ralph-specific logic
      (frontmatter shape, iteration status, archive-on-completion) stays local. Path resolution,
      participant handling, locking, and the document workflow loop should use agent-kit.

      ## Changes

      ### 1. Add `@poe-code/agent-kit` as a dependency of `@poe-code/ralph`

      ### 2. Replace path resolution

      If ralph has its own path resolution, replace with `resolveWorkflowPath` and
      `discoverWorkflowDocs` from agent-kit.

      ### 3. Replace lock mechanism

      If ralph has its own locking, replace with `lockWorkflow` from agent-kit.
      If ralph has no locking, add it using agent-kit's lock.

      ### 4. Consider using document workflow runner

      Evaluate whether ralph's main loop can use `runDocumentWorkflow` from agent-kit.
      Ralph provides its own `readConfig` (parsing ralph-specific frontmatter) and handles
      its own status persistence. The runner handles the orchestration loop.

      If the runner fits, wire it up. If the runner doesn't fit ralph's exact needs yet,
      document what's missing rather than forcing the fit.

      ### 5. Update tests

      Ensure all existing ralph tests still pass.
      Add tests verifying agent-kit integration points work correctly.

      ### 6. Verify

      Run `pnpm --filter @poe-code/ralph test`.
      Run `npm run dev -- ralph --help` to verify CLI still works.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: experiment-migration
    title: Migrate experiment-loop to use agent-kit shared helpers
    prompt: |
      Migrate `@poe-code/experiment-loop` to use agent-kit shared helpers where possible.

      Design: {{design_doc}}

      ## Context

      Experiment-loop should become a thin single-document loop on top of agent-kit plus its own
      experiment-specific logic. Experiment-specific logic stays local: metric evaluation, journal
      management, git reset/keep/discard, baseline derivation.

      ## Changes

      ### 1. Add `@poe-code/agent-kit` as a dependency of `@poe-code/experiment-loop`

      ### 2. Replace path resolution

      Move experiment doc discovery from CLI-local code into the package using
      `discoverWorkflowDocs` from agent-kit.

      ### 3. Add locking

      Use `lockWorkflow` from agent-kit to prevent concurrent experiment runs on the same doc.

      ### 4. Consider using document workflow runner

      Evaluate whether experiment-loop's main loop can use `runDocumentWorkflow`.
      Experiment provides its own `readConfig` and handles journal/git state.

      If the runner fits, wire it up. If not, document what's missing.

      ### 5. Update tests

      Ensure all existing experiment-loop tests still pass.
      Add tests for agent-kit integration points.

      ### 6. Verify

      Run `pnpm --filter @poe-code/experiment-loop test`.
      Run `npm run dev -- experiment --help` to verify CLI still works.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
````
