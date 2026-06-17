# @poe-code/agent-harness-tools

Reusable runtime components for autonomous single-document workflows.

This package is intended to hold shared runtime building blocks for agent-driven workflows that operate on a single source document or plan.

## Status

Shared helpers are exported from `src/index.ts` as they are added.

## ExecutionEnv Contract

`ExecutionEnvFactory` is the runtime backend boundary used by Poe Code command runners.

- `type`: runtime backend id, currently `host`, `docker`, or `e2b`.
- `supportsDetach`: true when the backend can leave an addressable environment running.
- `open(spec)`: creates a fresh `OpenedEnv`.
- `attach(envId, context)`: reconnects to an existing runtime environment.

`OpenedEnv` owns one command environment lifecycle:

- `id`: backend environment id, such as a Docker container id or E2B sandbox id.
- `job`: attached job handle when reconnecting to an existing job, otherwise `null`.
- `uploadWorkspace()`: transfers the caller workspace into the environment.
- `downloadWorkspace({ conflictPolicy })`: syncs the environment workspace back to the caller.
- `exec(spec)`: runs a command in the environment and returns a process `RunHandle`.
- `detach()`: leaves the environment running and returns a `JobHandle`.
- `shell()`: opens an interactive shell in the environment.
- `close()`: closes and cleans up the environment.

Factories are registered with `registerExecutionEnvFactory(...)` and selected by `selectExecutionEnv(runtime)`.

## `runPoeCommand`

`runPoeCommand(...)` is the shared entry point for running a Poe Code tool through an `ExecutionEnvFactory`.

The flow is:

1. Create a pending job entry in the state manager.
2. Open the selected execution environment.
3. Upload the workspace.
4. Execute the wrapped Poe command.
5. Either detach and return `{ kind: "detached", jobId, envId }`, or wait for exit.
6. In sync mode, download the workspace with `runner.download_conflict` and return `{ kind: "sync", exitCode, download }`.

Callers pass `OpenSpec.jobLabel` so detached jobs can be listed and reattached with meaningful command metadata.

## Loop agent selection

`resolveLoopAgent` is the shared selector used by loop-style runners to choose a single agent specifier.

Precedence:

- CLI flag via `providedAgent`
- frontmatter string via `frontmatterAgent`
- `configuredDefaultAgent` from `core.defaultAgent`
- `fallbackAgent` when `assumeYes` / `--yes` is enabled
- interactive `select(...)` prompt

Notes:

- Only a single frontmatter string is handled here. If frontmatter contains an array, the caller must resolve that case before calling `resolveLoopAgent`.
- Validation and alias resolution happen inside the helper. Supported `agent:model` specifiers keep their model suffix.
- Cancellation is only possible in the interactive prompt path. If `select(...)` returns a value that `isCancel(...)` recognizes, the function returns `{ cancelled: true }` and does not throw. Callers are responsible for showing the cancellation message and stopping the command cleanly.
- `pipeline`, `experiment`, `ralph`, and `superintendent` all route their single-agent loop selection through this function so the precedence stays aligned across commands.

## Plan document helpers

`openPlanList`, `discoverPlans`, and `archivePlan` expose numbered Markdown plan folders through `@poe-code/task-list`. They resolve the configured plan directory with the same cwd/home rules as workflow docs, open it as a `markdown-dir` single-list named `plans`, and use `frontmatterMode: "passthrough"` so plan-specific metadata survives task updates.

- `discoverPlans({ cwd, homeDir, planDirectory, kinds? })` returns plan ids, names, kinds, absolute paths, and display paths. Numeric filename prefixes such as `04-api-shape-providers.md` are stripped from ids.
- `archivePlan({ cwd, homeDir, planDirectory, id })` fires the task-list `archive` event, moves the document under `archive/`, and repacks active plan prefixes.
- `openPlanList(...)` returns the underlying `TaskList` for commands that need direct task operations.

## Safety and determinism

- Workflow document discovery skips symlinked documents so a plan directory cannot point the runner at files outside the configured workflow tree.
- Workspace transfer follows the same gitignore semantics as `@poe-code/process-runner`: gitignored directories stay excluded unless the parent directory is explicitly unignored.
- Run log directories include enough path context to keep plans with the same basename from colliding.
- Reloaded workflow config is re-applied between iterations, including higher iteration limits.

## Configuration

This package does not read config files directly, but Poe Code callers commonly pass `configuredDefaultAgent` from merged `core.defaultAgent`.

- User config: `~/.poe-code/config.json` → `core.defaultAgent`
- Project config: `./.poe-code/config.json` → `core.defaultAgent`

## Environment Variables

This package does not read environment variables directly, but Poe Code callers commonly source `configuredDefaultAgent` from:

- `POE_DEFAULT_AGENT` → overrides file-backed `core.defaultAgent` values and then feeds `configuredDefaultAgent`
