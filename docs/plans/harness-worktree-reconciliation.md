---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Generic worktree execution

Run agents and higher-level workflows in disposable git worktrees, then use an agent to reconcile committed plus uncommitted changes back into the source checkout and clean up the worktree.

## 1. What we're building

Add a generic worktree execution mode so any repo-mutating poe-code operation can run in an automatically-created git worktree instead of the caller's source checkout.

This should support:

- `spawn(...)` with worktree mode
- arbitrary SDK callbacks through a generic `runInWorktree(...)` helper
- agent harnesses, including SafeJS `agent-harness`, pipeline, gaslight, ralph, superintendent, and any additional repo-mutating agent harness discovered during implementation
- CLI flags that all map to the same SDK behavior

The important behavior is the finish path:

- If the worktree has commits, the reconciliation agent merges those commits back into the source checkout.
- The reconciliation agent performs that merge work; poe-code may prepare context and verify the result, but it must not be the component that silently decides or completes the reconciliation.
- If that merge creates conflicts, the same reconciliation agent resolves the conflicts.
- If the worktree has uncommitted file changes, the reconciliation agent transfers those file changes back into the source checkout too.
- The reconciliation agent performs that uncommitted-change transfer too.
- If transferring uncommitted changes creates conflicts, the reconciliation agent resolves the conflicts.
- The reconciliation agent removes the managed worktree and branch after successful reconciliation. If the worktree still exists after the agent exits, poe-code resumes the same agent thread with a cleanup nudge and verifies removal again.

In this plan, "agent harnesses" means the SafeJS `agent-harness` runner plus the plan/loop runners that dispatch agents over repo work: pipeline, gaslight, ralph, and superintendent. The implementation should also include any other command discovered during the code audit that has the same shape: it selects an agent, runs one or more agent tasks against the repository, and needs to reconcile the resulting workspace changes.

The first implementation target can still be `poe-code harness run --worktree`, but the architecture must be generic enough that `spawn(..., { worktree })` and `runInWorktree(...)` are first-class SDK surfaces. The harness commands should consume those SDK surfaces rather than owning a parallel worktree path.

Explicit non-goals:

- Do not add provider-specific branching.
- Do not make providers responsible for worktree creation, merge, cleanup, logging, dry run, or conflict policy.
- Do not transfer source-checkout dirty changes into the worktree. `--worktree` starts from a clean git base and reconciles only the agent worktree's output back.
- Do not overwrite a dirty destination checkout. Reconciliation into the source checkout requires the destination checkout to be clean.
- Do not use regexes to parse config files. This work should not need config file parsing beyond the existing package docs update.
- Do not add GitHub workflow unit tests.
- Do not build a harness-only solution that cannot be reused by `spawn(...)` or arbitrary SDK callbacks.

## 2. User-facing shape

### SDK spawn

Callers can run a single agent spawn inside a managed worktree:

```ts
import { spawn } from "poe-code";

const { result } = spawn("codex", {
  cwd: process.cwd(),
  prompt: "Fix the failing tests.",
  mode: "auto",
  worktree: true
});

const final = await result;
```

Behavior:

1. `spawn(...)` treats `cwd` as the source checkout.
2. poe-code creates a managed worktree from the source checkout.
3. The spawned provider runs with its `cwd` set to the worktree path.
4. After a successful spawn result, poe-code launches the reconciliation agent.
5. The reconciliation agent applies committed and uncommitted worktree output back into the source checkout and removes the worktree.
6. If cleanup verification finds the worktree still exists, poe-code resumes the reconciliation agent thread with a cleanup nudge.

The reconciliation agent for `spawn("codex", { worktree: true })` is the spawned agent, `codex`, using the same selected model when the run has one.

The final `SpawnResult` should include optional worktree metadata:

```ts
type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  threadId?: string;
  worktree?: WorktreeExecutionResult;
};
```

### Generic SDK callback

Callers can run arbitrary code inside a worktree without going through `spawn(...)`:

```ts
import { runInWorktree } from "poe-code";

const result = await runInWorktree({
  cwd: process.cwd(),
  selectedAgent: "codex",
  worktree: true,
  run: async ({ cwd }) => {
    await runTestsAndGenerateFiles(cwd);
    return { ok: true };
  }
});
```

This is the generic primitive for "run stuff" in a worktree. The callback receives the worktree cwd. The SDK performs reconciliation after the callback succeeds.

### SDK runners

Existing SDK runners should accept the same worktree option where they mutate a repository:

```ts
await runPipeline({
  cwd: process.cwd(),
  homeDir: os.homedir(),
  plan: "docs/plans/build-feature.md",
  agent: "codex",
  worktree: true
});

await runRalph({
  cwd: process.cwd(),
  homeDir: os.homedir(),
  docPath: "docs/plans/ralph.md",
  agent: "codex",
  worktree: true
});

await runGaslight({
  cwd: process.cwd(),
  planPaths: ["docs/plans/build-feature.md"],
  agent: "codex",
  worktree: true
});
```

The root SDK wrappers should wrap the whole runner invocation in one worktree, not create a separate worktree per internal agent spawn.

### Explicit harness run

```bash
poe-code harness run .poe-code/harnesses/refactor/refactor.md --worktree --agent codex
```

Behavior:

1. poe-code creates a worktree under `.poe-code/worktrees/<generated-name>` from the current branch `HEAD`.
2. The harness runs with `cwd` set to the new worktree. Harness-relative paths still resolve from the harness document directory inside the worktree.
3. At the end of the harness run, poe-code launches the reconciliation agent with the source checkout path, worktree path, worktree branch, base commit, and current git status.
4. The reconciliation agent merges committed changes, transfers uncommitted changes, resolves conflicts, and removes the managed worktree and branch.
5. poe-code verifies that the source checkout has no unmerged paths and that the managed worktree no longer exists.
6. If verification shows the worktree still exists, poe-code resumes the same reconciliation agent thread with a cleanup nudge and verifies again.

### Worktree flag

- `--worktree`: create an isolated worktree for the run and reconcile it afterward.

`--worktree` requires a resolvable agent before the run starts. If a command normally prompts for an agent, it keeps doing that. If running non-interactively, the existing `--agent` or `--yes` behavior must resolve the run agent before worktree creation.

### Other agent harnesses

The same user-facing flag should be available on the other agent harness commands:

```bash
poe-code pipeline run --plan docs/plans/build-feature.md --worktree --agent codex
poe-code gaslight docs/plans/build-feature.md --worktree --agent codex
poe-code ralph run docs/plans/ralph.md --worktree --agent codex
poe-code superintendent run docs/plans/superintendent.md --worktree --agent codex
```

For multi-step or iterative runs, one worktree wraps the whole command invocation. The command does not create a separate worktree per agent spawn.

### Status output

Successful run with committed and uncommitted changes:

```text
harness run
Running .poe-code/harnesses/fix-tests/fix-tests.md
Worktree: .poe-code/worktrees/fix-tests-3f2a9c
Result: completed
Worktree reconciliation:
  agent: codex
  committed changes: merged by agent
  uncommitted changes: applied by agent
  cleanup: removed by agent
Removed worktree .poe-code/worktrees/fix-tests-3f2a9c
```

Run where git detects conflicts:

```text
Worktree reconciliation:
  agent: codex
  committed changes: resolved by agent
  uncommitted changes: applied by agent
  cleanup: removed by agent
```

Run where the agent reconciles but forgets to delete the worktree:

```text
Worktree reconciliation:
  agent: codex
  cleanup: worktree still exists
  cleanup: resuming codex to remove .poe-code/worktrees/fix-tests-3f2a9c
  cleanup: removed by agent
```

Run rejected because the destination checkout is dirty:

```text
Cannot run with --worktree because the destination checkout has uncommitted changes.
Commit, stash, or discard those changes before starting a worktree run.
```

### Failure behavior

If the harness itself fails, poe-code still inspects the worktree. Reconciliation policy:

- If the worktree has no changes, mark the registry entry `failed` and ask the selected agent to remove the worktree.
- If the worktree has changes, leave the worktree in place by default and print the path. Do not reconcile failed runs automatically.
- A follow-up `poe-code worktree reconcile <name>` command can reconcile an existing failed worktree after the user or another agent decides the output should be accepted.

This avoids silently applying partial or failing agent output into the source checkout.

For successful harness runs, lingering worktrees are not acceptable. The verification step must detect a still-registered or still-present worktree, resume the reconciliation agent with `resumeThreadId`, and tell it to remove the worktree and branch. If the resumed agent still leaves the worktree behind, the command fails with the registry entry marked `cleanup_failed`.

## 3. Implementation details and technical decisions

### Autonomy audit

- Env vars: no new environment variables.
- Credentials: reconciliation needs whatever credentials the selected agent already needs. No new credential source is introduced.
- Network: only the selected agent may need network access. Unit tests must mock the agent spawn boundary.
- Running services: none.
- Sample data: unit tests use `memfs` for file-level behavior and injected `exec` calls for git behavior.
- Real git proof: use temporary directories created by test runner or shell QA. The existing unit test rule forbids tests from writing files, so real filesystem git proof should be integration or manual QA only.
- README permission: [packages/worktree/README.md](/Users/kjopek/Workspace/poe-code/packages/worktree/README.md) must be updated when this is implemented because the package exposes new APIs and config options. Repo instructions require explicit user permission before README edits, so the implementation step must confirm that permission or leave the README update as a separate follow-up.

### Package boundary

Put the core behavior in the existing `@poe-code/worktree` package. This package is the source of truth for worktree lifecycle, registry state, reconciliation prompts, and verification.

Expose the capability through the public poe-code SDK as well. The CLI and harness commands should call the SDK surface, and the SDK surface should call `@poe-code/worktree`. CLI commands should not import `@poe-code/worktree` directly except for types if unavoidable.

New responsibilities for `@poe-code/worktree`:

- create a managed worktree
- inspect committed and uncommitted output
- build a precise reconciliation brief for the agent
- run an injected reconciliation agent callback that performs merge, uncommitted transfer, conflict resolution, and worktree deletion
- verify reconciliation outcomes without provider-specific knowledge
- resume the same agent thread with a cleanup nudge when the worktree still exists after a successful reconciliation attempt
- update registry status from host-side verification

The package stays testable by keeping filesystem, git command execution, and agent spawning injectable. It should not import CLI containers or provider registries. It should not make content-level merge decisions; those belong to the reconciliation agent.

### SDK boundary

Add a root SDK module at `src/sdk/worktree.ts` that adapts `@poe-code/worktree` to poe-code callers.

The SDK module owns:

- default Node filesystem and command runner wiring for SDK consumers
- registry and worktree directory defaults for a poe-code workspace
- resolving the reconciliation agent through the existing `spawn(...)` SDK API
- preserving `threadId` and passing `resumeThreadId` for cleanup nudges
- a callback wrapper that lets higher-level runners execute arbitrary work inside the created worktree

The root package entrypoint [src/index.ts](/Users/kjopek/Workspace/poe-code/src/index.ts) should export the SDK functions and types so external callers can use worktree mode without shelling out to the CLI.

### Generic execution abstraction

The SDK should expose one generic worktree execution primitive and have specialized APIs delegate to it:

```ts
export type WorktreeExecutionOptions = boolean;

export type WorktreeExecutionContext = {
  sourceCwd: string;
  worktreeCwd: string;
  worktree: Worktree;
  signal?: AbortSignal;
};

export type WorktreeExecutionResult = {
  worktree: Worktree;
  reconciliation?: WorktreeReconciliationSummary;
};

export async function runInWorktree<T>(input: {
  cwd: string;
  selectedAgent: string;
  worktree: WorktreeExecutionOptions;
  run: (context: WorktreeExecutionContext) => Promise<T>;
  signal?: AbortSignal;
}): Promise<{ value: T; worktree: WorktreeExecutionResult }>;
```

Then adapt:

- `spawn(...)`: if `options.worktree` is enabled, call `runInWorktree(...)` and invoke the existing spawn implementation with `cwd` rewritten to the worktree cwd.
- `runPipeline(...)`, `runRalph(...)`, `runGaslight(...)`, `runExperiment(...)` if included by the audit: wrap the whole SDK runner body in `runInWorktree(...)`.
- CLI commands: parse `--worktree` flags into `WorktreeExecutionOptions` and call the SDK, not package internals.

This may require a larger refactor to avoid recursion: `runInWorktree(...)` needs to use the existing spawn implementation for the reconciliation agent without recursively entering worktree mode. Model that with an internal `spawnWithoutWorktree(...)` or an internal option such as `worktree: false` on the reconciliation spawn call.

### Refactor roadmap

This is worth a larger refactor if needed. Do not force the generic behavior through harness-specific code.

Refactor phases:

1. Stabilize the low-level `@poe-code/worktree` package contract.
2. Add `src/sdk/worktree.ts` as the single high-level worktree execution abstraction.
3. Refactor `spawn(...)` so its core implementation can be called with an already-resolved cwd; this avoids recursion when reconciliation itself uses `spawn(...)`.
4. Add `SpawnOptions.worktree`.
5. Refactor root SDK runners to accept `worktree` and wrap their top-level execution through `runInWorktree(...)`.
6. Convert CLI commands to thin flag parsers over the SDK.
7. Audit remaining agent-running commands and migrate them to the same SDK path.

If this turns into a multi-month refactor, keep the invariant: every repo-mutating execution path should have one way to opt into worktree isolation, and that way should be the SDK worktree execution abstraction.

### Registry model

Extend `WorktreeStatus`:

```ts
export type WorktreeStatus =
  | "active"
  | "reconciling"
  | "conflicted"
  | "cleanup_failed"
  | "done"
  | "failed"
  | "removing";
```

Extend `Worktree`:

```ts
export type Worktree = {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
  source: string;
  agent: string;
  status: WorktreeStatus;
  storyId?: string;
  planPath?: string;
  prompt?: string;
  sourceCwd?: string;
  baseHead?: string;
  reconciledAt?: string;
  reconciliation?: WorktreeReconciliationSummary;
};
```

`sourceCwd` records the destination checkout. `baseHead` records the source checkout commit used to create the worktree. `reconciliation` stores a short, machine-readable summary of the last reconciliation attempt.

### Git strategy

Use git commands with explicit arguments and parse stable porcelain output where needed. Prefer NUL-delimited porcelain for file lists.

Creation:

1. Verify the destination checkout is inside a git repository.
2. Verify destination `git status --porcelain=v1 -z` is empty.
3. Resolve `baseHead` with `git rev-parse HEAD`.
4. Call `createWorktree(...)` with `baseBranch` set to `HEAD`.

Reconciliation:

1. In the worktree, resolve `worktreeHead` with `git rev-parse HEAD`.
2. In the worktree, inspect tracked, staged, unstaged, and untracked output with porcelain commands.
3. Build a reconciliation brief containing the source checkout, worktree path, worktree branch, base commit, worktree head, committed-change status, dirty-file status, and cleanup requirement.
4. Spawn the reconciliation agent in the source checkout. The agent performs the actual work:
   - merge committed worktree changes into the source checkout when `worktreeHead !== baseHead`
   - transfer tracked, staged, unstaged, and untracked worktree file changes into the source checkout
   - resolve merge conflicts and file collisions
   - leave the source checkout without unmerged paths
   - remove the managed git worktree and branch
5. After the agent exits, verify:
   - `git diff --name-only --diff-filter=U -z` in the source checkout is empty
   - the expected committed and uncommitted changes are present in the source checkout
   - `git worktree list --porcelain` no longer contains the managed worktree path
   - the worktree directory does not exist
6. If verification finds unmerged paths or missing transferred changes, mark the registry entry `conflicted` and fail.
7. If verification only finds that the worktree still exists, resume the same agent thread with a cleanup nudge and the original `threadId`.
8. After the cleanup nudge, verify worktree removal again. If it still exists, mark the registry entry `cleanup_failed` and fail.

Host code can inspect git state and verify invariants. The reconciliation agent performs the merge, file transfer, conflict resolution, and deletion.

### Agent reconciliation prompt

The injected agent receives a concrete prompt with no provider-specific branching:

```text
Reconcile and clean up this poe-code managed worktree.

Source checkout: <sourceCwd>
Worktree path: <worktreePath>
Worktree branch: <branch>
Base commit: <baseHead>
Worktree head: <worktreeHead>
Committed changes: <none|present>
Uncommitted changes:
<porcelain summary>

Rules:
- Merge committed worktree changes into the source checkout when present.
- Transfer tracked, staged, unstaged, and untracked worktree file changes into the source checkout.
- Resolve all git conflict markers and file collisions you encounter.
- Preserve the requested worktree changes unless they are invalid or superseded by a clear source-checkout requirement.
- Keep the repository buildable.
- Do not commit unless completing an in-progress git merge requires a commit.
- Remove the managed worktree and branch when done.
- When done, leave `git status --porcelain=v1 -z` with no unmerged paths.
```

The command-level integration supplies this as `sdkSpawn(reconciliationAgent, { cwd: sourceCwd, prompt, model, mode: "auto" })`.

If cleanup verification fails only because the worktree still exists, poe-code resumes the same thread:

```text
The source checkout reconciliation appears complete, but the managed worktree still exists:

Worktree path: <worktreePath>
Worktree branch: <branch>

Remove that git worktree and branch now. Then verify `git worktree list --porcelain`
does not contain the path.
```

The command-level integration supplies the nudge as `sdkSpawn(reconciliationAgent, { cwd: sourceCwd, prompt, model, mode: "auto", resumeThreadId: previousThreadId })`.

### SDK integration helper

Add the shared helper in `src/sdk/worktree.ts`:

```ts
export async function runInWorktree<T>(
  input: RunInWorktreeInput<T>
): Promise<RunInWorktreeResult<T>>;

export async function runWithOptionalWorktree<T>(
  input: RunWithOptionalWorktreeInput<T>
): Promise<RunWithOptionalWorktreeResult<T>>;
```

The helper:

- resolves defaults and registry paths
- creates the worktree when enabled
- runs the command callback with the worktree cwd
- calls `reconcileWorktree(...)` only after a successful command result, passing an injected reconciliation agent callback
- captures the reconciliation agent's `threadId`
- resumes the same reconciliation agent thread when verification shows the worktree still exists
- leaves changed failed worktrees in place
- verifies successful worktrees were removed by the agent

`runInWorktree(...)` is the canonical API. `runWithOptionalWorktree(...)` can exist as a convenience wrapper for callers that pass `false` without branching. The explicit harness command uses this SDK helper around `runHarnessPair(...)`. Pipeline, gaslight, ralph, superintendent, `spawn(...)`, and any additional discovered agent harness should wire the same SDK helper around their top-level run command instead of passing `--worktree` down to every individual spawn.

### Worktree CLI

Add a small management surface so failed worktrees are recoverable:

```bash
poe-code worktree list
poe-code worktree reconcile <name> --agent codex
poe-code worktree remove <name> --delete-branch
```

`list` and `remove` can wrap the existing package functions. `reconcile` calls the new reconciliation API. This is needed because failed harness runs intentionally leave changed worktrees in place rather than applying partial output.

## 4. Interfaces and test plan

### Public package interfaces

Add to [packages/worktree/src/index.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/index.ts):

```ts
export type WorktreeReconcilePhase =
  | "reconcile"
  | "cleanup-nudge";

export type WorktreeReconciliationAgent = (input: {
  phase: WorktreeReconcilePhase;
  sourceCwd: string;
  worktree: Worktree;
  prompt: string;
  resumeThreadId?: string;
  summary: WorktreeReconciliationSummary;
  signal?: AbortSignal;
}) => Promise<{ exitCode: number; stdout: string; stderr: string; threadId?: string }>;

export type ReconcileWorktreeOptions = {
  cwd: string;
  name: string;
  registryFile: string;
  reconciliationAgent: WorktreeReconciliationAgent;
  deps: WorktreeDeps;
  signal?: AbortSignal;
};

export type WorktreeReconciliationSummary = {
  committed: "none" | "present" | "merged_by_agent" | "failed";
  uncommitted: "none" | "present" | "applied_by_agent" | "failed";
  removed: boolean;
  cleanup: "not_needed" | "removed_by_agent" | "nudged" | "failed";
  conflictFiles: string[];
  threadId?: string;
};

export function reconcileWorktree(
  options: ReconcileWorktreeOptions
): Promise<WorktreeReconciliationSummary>;
```

Add creation metadata:

```ts
export type CreateWorktreeOptions = {
  cwd: string;
  name: string;
  baseBranch: string;
  source: string;
  agent: string;
  registryFile: string;
  worktreeDir: string;
  storyId?: string;
  planPath?: string;
  prompt?: string;
  sourceCwd?: string;
  deps: WorktreeDeps;
};
```

### Spawn interface

Add to [src/sdk/types.ts](/Users/kjopek/Workspace/poe-code/src/sdk/types.ts):

```ts
export type WorktreeExecutionOptions = boolean;

export interface SpawnOptions {
  // existing fields...
  worktree?: WorktreeExecutionOptions;
}

export interface SpawnResult {
  // existing fields...
  worktree?: WorktreeExecutionResult;
}
```

`spawn(...)` must run the provider inside the created worktree when `worktree` is enabled, then reconcile through the agent before resolving `result`.

### CLI flag contracts

Shared parser helper:

```ts
export function addWorktreeOptions(command: Command): Command;
export function pickWorktreeOptions(options: Record<string, unknown>): WorktreeExecutionOptions;
```

Commands to wire:

- [src/cli/commands/harness.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/harness.ts)
- [src/cli/commands/pipeline.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/pipeline.ts)
- [src/cli/commands/gaslight.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/gaslight.ts)
- [src/cli/commands/ralph.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/ralph.ts)
- [packages/superintendent/src/commands/run.ts](/Users/kjopek/Workspace/poe-code/packages/superintendent/src/commands/run.ts)
- Any additional agent harness command found by auditing `sdkSpawn`, `sdkSpawn.pretty`, `spawn(...)`, or autonomous agent runner call sites.

### Root SDK exports

Add to [src/sdk/worktree.ts](/Users/kjopek/Workspace/poe-code/src/sdk/worktree.ts):

```ts
export {
  runInWorktree,
  runWithOptionalWorktree,
  createManagedWorktree,
  reconcileManagedWorktree,
  listManagedWorktrees,
  removeManagedWorktree
};

export type {
  RunInWorktreeInput,
  RunInWorktreeResult,
  RunWithOptionalWorktreeInput,
  RunWithOptionalWorktreeResult,
  WorktreeExecutionOptions,
  WorktreeExecutionContext,
  WorktreeExecutionResult,
  ManagedWorktreeCreateOptions,
  ManagedWorktreeReconcileOptions,
  ManagedWorktreeListOptions,
  ManagedWorktreeRemoveOptions
};
```

Add to [src/index.ts](/Users/kjopek/Workspace/poe-code/src/index.ts):

```ts
export {
  runInWorktree,
  runWithOptionalWorktree,
  createManagedWorktree,
  reconcileManagedWorktree,
  listManagedWorktrees,
  removeManagedWorktree
} from "./sdk/worktree.js";

export type {
  RunInWorktreeInput,
  RunInWorktreeResult,
  RunWithOptionalWorktreeInput,
  RunWithOptionalWorktreeResult,
  WorktreeExecutionOptions,
  WorktreeExecutionContext,
  WorktreeExecutionResult,
  ManagedWorktreeCreateOptions,
  ManagedWorktreeReconcileOptions,
  ManagedWorktreeListOptions,
  ManagedWorktreeRemoveOptions
} from "./sdk/worktree.js";

export type {
  Worktree,
  WorktreeStatus,
  WorktreeReconciliationSummary
} from "@poe-code/worktree";
```

CLI commands must use these SDK functions so CLI behavior and SDK behavior remain aligned.

### Unit tests

Use TDD. Add failing tests first.

Package tests in [packages/worktree/src/worktree.test.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/worktree.test.ts):

- creates registry entries with `sourceCwd` and `baseHead`
- rejects reconciliation when destination `git status --porcelain=v1 -z` is non-empty
- builds an agent reconciliation prompt that includes committed and uncommitted worktree state
- invokes `reconciliationAgent` for successful harness output even when there are no conflicts
- passes source checkout cwd to the reconciliation agent
- records the reconciliation agent `threadId`
- fails reconciliation when the reconciliation agent exits non-zero
- verifies no unmerged paths after the reconciliation agent exits
- verifies the managed worktree is absent after the reconciliation agent exits
- resumes the same reconciliation agent thread with a cleanup nudge when the worktree still exists
- marks registry status `cleanup_failed` when the resumed agent still leaves the worktree behind
- marks registry status `done` on success
- marks registry status `conflicted` when post-agent verification finds unresolved conflicts
- leaves changed failed worktrees in place and removes successful worktrees

SDK tests in [src/sdk/worktree.test.ts](/Users/kjopek/Workspace/poe-code/src/sdk/worktree.test.ts):

- `runInWorktree(...)` creates a worktree through `@poe-code/worktree`
- `runInWorktree(...)` passes the worktree cwd to the caller callback
- successful callback results trigger `reconcileManagedWorktree(...)`
- reconciliation uses the SDK `spawn(...)` API for the reconciliation agent
- cleanup nudges reuse the reconciliation `threadId` as `resumeThreadId`
- exported SDK functions are re-exported from [src/index.ts](/Users/kjopek/Workspace/poe-code/src/index.ts)

Spawn tests in [src/sdk/spawn.test.ts](/Users/kjopek/Workspace/poe-code/src/sdk/spawn.test.ts):

- `spawn("codex", { worktree: true })` creates a worktree from `cwd`
- provider spawn receives the worktree cwd, not the source cwd
- successful provider spawn triggers reconciliation
- failed provider spawn does not reconcile automatically
- `SpawnResult.worktree` includes the worktree entry and reconciliation summary
- reconciliation spawn explicitly disables worktree mode to avoid recursion
- lingering worktree cleanup nudge uses the reconciliation thread id as `resumeThreadId`

SDK runner tests:

- `runPipeline({ worktree })` wraps the whole pipeline run in one worktree
- `runRalph({ worktree })` wraps the whole ralph run in one worktree
- `runGaslight({ worktree })` wraps the whole gaslight run in one worktree
- internal agent spawns inside those runners receive the worktree cwd
- reconciliation runs once after the top-level runner succeeds
- failed top-level runner output is not reconciled automatically

CLI tests:

- `poe-code harness run --worktree --agent codex` creates a worktree and runs the harness callback in that cwd
- `poe-code harness run --worktree` rejects non-interactive runs when no agent can be resolved
- reconciliation uses the selected run agent
- failed harness run with worktree changes leaves the worktree in place and does not call reconcile
- successful harness run calls the reconciliation agent and verifies worktree removal
- lingering worktree after reconciliation resumes the same agent thread with `resumeThreadId`
- pipeline, gaslight, ralph, and superintendent parse the shared flags and pass the top-level cwd through the SDK helper
- any additional discovered agent harness either wires the shared flags or is documented as out of scope with a concrete reason

Do not write unit tests for GitHub workflows.

### Real-world test

Run these commands when a valid agent credential is available:

```bash
npm test -- packages/worktree/src/worktree.test.ts
npm test -- src/cli/commands/harness-command.test.ts
npm run dev -- harness run .poe-code/harnesses/worktree-smoke/worktree-smoke.md --worktree --agent codex
git status --porcelain=v1
```

Expected observation:

- The harness command creates a generated worktree under `.poe-code/worktrees`.
- A committed change made by the harness appears in the source checkout after reconciliation.
- An uncommitted file made by the harness appears in the source checkout after reconciliation.
- `git status --porcelain=v1` shows the reconciled file changes in the source checkout.
- The reconciliation agent removes the managed worktree.

Conflict proof:

```bash
npm run dev -- harness run .poe-code/harnesses/worktree-conflict/worktree-conflict.md --worktree --agent codex
git diff --name-only --diff-filter=U
```

Expected observation:

- poe-code logs that reconciliation is running through the selected agent.
- The command exits successfully only after there are no unmerged paths.
- `git diff --name-only --diff-filter=U` prints nothing.
- `git worktree list --porcelain` does not include the managed worktree after success.

Visual CLI proof:

```bash
npm run screenshot-poe-code -- harness run --help
npm run screenshot-poe-code -- gaslight --help
npm run screenshot-poe-code -- worktree --help
```

Expected observation:

- Help output includes the new flags.
- The output fits the existing CLI visual language and has no overlapping text.

### Must-work checklist

- [ ] `poe-code harness run --worktree --agent codex` runs the harness in a managed worktree; proof: log line shows the worktree path and harness cwd is under `.poe-code/worktrees`.
- [ ] Committed worktree changes merge into the source checkout through the reconciliation agent; proof: a commit made in the worktree appears in source checkout history or diff after reconciliation.
- [ ] Uncommitted tracked worktree changes transfer into the source checkout through the reconciliation agent; proof: source checkout `git diff` contains the change.
- [ ] Untracked worktree files transfer into the source checkout through the reconciliation agent; proof: source checkout `git status --porcelain=v1` lists the new file.
- [ ] Merge conflicts invoke the selected reconciliation agent; proof: test spy sees the reconciliation agent call and manual run logs `reconciliation: running <agent>`.
- [ ] Failed reconciliation leaves the registry entry `conflicted`; proof: registry YAML contains `status: conflicted`.
- [ ] Dirty destination checkout is rejected before worktree creation; proof: no `git worktree add` call occurs in the unit test.
- [ ] Failed harness output is not reconciled automatically; proof: failed run keeps the changed worktree and source checkout stays unchanged.
- [ ] Successful reconciliation removes worktrees through the agent; proof: `git worktree list --porcelain` does not include the managed path after success.
- [ ] Lingering worktree cleanup resumes the same agent thread; proof: test spy sees `resumeThreadId` on the cleanup nudge call.
- [ ] CLI screenshots for affected help text render correctly; proof: `npm run screenshot-poe-code -- harness run --help`, `npm run screenshot-poe-code -- gaslight --help`, and `npm run screenshot-poe-code -- worktree --help`.

## 5. Code plan

### Files added

- `packages/worktree/src/reconcile.ts`: reconciliation state machine, git state inspection, reconciliation agent prompt construction, verification, and resume cleanup nudges.
- `src/sdk/worktree.ts`: public poe-code SDK wrapper around `@poe-code/worktree` with default deps, registry path defaults, and reconciliation-agent spawn wiring.
- `src/sdk/worktree.test.ts`: SDK tests proving the wrapper calls `@poe-code/worktree`, uses `spawn(...)`, preserves `threadId`, and resumes cleanup nudges.
- `src/cli/commands/worktree-options.ts`: Commander flag registration and option normalization.
- `src/cli/commands/worktree.ts`: user-facing `poe-code worktree list|reconcile|remove` commands.
- `src/cli/commands/worktree-command.test.ts`: CLI coverage for management commands and shared flag behavior.

### Files changed

- [packages/worktree/src/types.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/types.ts): extend registry types, statuses, and dependency types if signal support is needed.
- [packages/worktree/src/create.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/create.ts): record `sourceCwd` and `baseHead`; keep safe name validation.
- [packages/worktree/src/registry.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/registry.ts): validate new optional registry fields and statuses.
- [packages/worktree/src/index.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/index.ts): export new reconcile API and types.
- [packages/worktree/src/worktree.test.ts](/Users/kjopek/Workspace/poe-code/packages/worktree/src/worktree.test.ts): add TDD coverage for reconciliation.
- [src/sdk/types.ts](/Users/kjopek/Workspace/poe-code/src/sdk/types.ts): add `WorktreeExecutionOptions`, `WorktreeExecutionResult`, `SpawnOptions.worktree`, and `SpawnResult.worktree`.
- [src/sdk/spawn.ts](/Users/kjopek/Workspace/poe-code/src/sdk/spawn.ts): route worktree-enabled spawns through `runInWorktree(...)` while preventing reconciliation spawns from recursively entering worktree mode.
- [src/sdk/spawn.test.ts](/Users/kjopek/Workspace/poe-code/src/sdk/spawn.test.ts): test `spawn(..., { worktree })`, cwd rewriting, reconciliation, cleanup nudges, and result metadata.
- [src/sdk/pipeline.ts](/Users/kjopek/Workspace/poe-code/src/sdk/pipeline.ts): accept `worktree` in the root SDK wrapper and wrap the whole pipeline run.
- [src/sdk/ralph.ts](/Users/kjopek/Workspace/poe-code/src/sdk/ralph.ts): accept `worktree` in the root SDK wrapper and wrap the whole ralph run.
- [src/sdk/gaslight.ts](/Users/kjopek/Workspace/poe-code/src/sdk/gaslight.ts): replace the current direct re-export with a wrapper that accepts `worktree` and wraps the whole gaslight run.
- [src/index.ts](/Users/kjopek/Workspace/poe-code/src/index.ts): export the worktree SDK functions and public `@poe-code/worktree` types.
- [src/cli/program.ts](/Users/kjopek/Workspace/poe-code/src/cli/program.ts): register the worktree command.
- [src/cli/commands/harness.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/harness.ts): add worktree flags and wrap `runHarnessPair(...)` through the SDK `runWithOptionalWorktree(...)`.
- [src/cli/commands/pipeline.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/pipeline.ts): add worktree flags around top-level pipeline run via the SDK.
- [src/cli/commands/gaslight.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/gaslight.ts): add worktree flags around top-level gaslight run via the SDK.
- [src/cli/commands/ralph.ts](/Users/kjopek/Workspace/poe-code/src/cli/commands/ralph.ts): add worktree flags around top-level ralph run via the SDK.
- [packages/superintendent/src/commands/run.ts](/Users/kjopek/Workspace/poe-code/packages/superintendent/src/commands/run.ts): add worktree params and wrap the top-level run cwd via the SDK.
- Any additional agent harness command files discovered during the audit: add the shared flags or record why the command is not repo-mutating and should not opt into worktree mode.

README updates are intentionally deferred until explicit README edit permission is given.

### Build order

1. Add failing `@poe-code/worktree` tests for registry metadata, clean destination checks, reconciliation agent invocation, post-agent verification, `threadId` capture, resume cleanup nudges, and cleanup failure status.
2. Implement `reconcileWorktree(...)` inside `@poe-code/worktree` until package tests pass.
3. Add `poe-code worktree list|reconcile|remove` tests and CLI command wiring.
4. Add failing `src/sdk/worktree.test.ts` coverage for the generic `runInWorktree(...)` SDK wrapper.
5. Implement `src/sdk/worktree.ts` and export it from `src/index.ts`.
6. Add failing `spawn(..., { worktree })` tests in [src/sdk/spawn.test.ts](/Users/kjopek/Workspace/poe-code/src/sdk/spawn.test.ts).
7. Implement `SpawnOptions.worktree` and `SpawnResult.worktree`.
8. Add worktree support to root SDK runners: pipeline, gaslight, ralph, and any additional repo-mutating SDK runner found by the audit.
9. Add shared worktree option parsing for CLI flags.
10. Add failing `harness run --worktree` CLI tests.
11. Wire `harness run` through the SDK helper.
12. Add flag parsing and top-level SDK helper wrapping for pipeline, gaslight, ralph, and superintendent.
13. Audit remaining agent-spawning harness commands and wire any additional repo-mutating harnesses through the same SDK helper.
14. Defer package README updates until explicit permission.
15. Run targeted tests.
16. Run visual CLI screenshots for changed help output.
17. Run the disposable real-world git proof.

### Suggested targeted commands

```bash
npm test -- packages/worktree/src/worktree.test.ts
npm test -- src/sdk/worktree.test.ts
npm test -- src/sdk/spawn.test.ts
npm test -- src/cli/commands/harness-command.test.ts
npm test -- src/cli/commands/worktree-command.test.ts
npm test -- src/cli/commands/pipeline-command.test.ts src/cli/commands/gaslight.test.ts src/cli/commands/experiment-ralph.test.ts
npm test -- packages/superintendent/src/commands/run.test.ts
npm run screenshot-poe-code -- harness run --help
npm run screenshot-poe-code -- gaslight --help
npm run screenshot-poe-code -- worktree --help
```
