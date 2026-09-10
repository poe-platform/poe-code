# @poe-code/worktree

Git worktree lifecycle helpers with a YAML registry.

This package creates, lists, reconciles, removes, and tracks poe-code managed worktrees. Callers provide filesystem and command-execution dependencies so the package can be tested without touching the real filesystem.

## Usage

```ts
import {
  createWorktree,
  listWorktrees,
  reconcileWorktree,
  removeWorktree
} from "@poe-code/worktree";

const worktree = await createWorktree({
  cwd: "/repo",
  deps,
  registryFile: "/repo/.poe-code/worktrees.yaml",
  worktreeDir: "/repo/.poe-code/worktrees",
  name: "fix-tests",
  baseBranch: "HEAD",
  source: "manual",
  agent: "codex",
  sourceCwd: "/repo"
});

const entries = await listWorktrees("/repo", "/repo/.poe-code/worktrees.yaml", deps);

await reconcileWorktree({
  cwd: "/repo",
  name: worktree.name,
  registryFile: "/repo/.poe-code/worktrees.yaml",
  deps,
  reconciliationAgent: async ({ sourceCwd, prompt }) => {
    return runAgent({ cwd: sourceCwd, prompt });
  }
});

```

## Public API

- `createWorktree(options)`: creates a clean git worktree from `baseBranch` and records it in the registry.
- `reconcileWorktree(options)`: asks a reconciliation agent to merge a managed worktree's output back into the source checkout, records the reconciliation summary, and asks the agent to remove the managed worktree and branch.
- `removeWorktree(options)`: removes a worktree and updates registry state.
- `listWorktrees(cwd, registryFile, deps)`: reads registry entries and reports whether each git worktree still exists.
- `readRegistry(registryFile, fs)`: reads the raw registry.
- `updateWorktreeEntry(registryFile, name, update, options)`: updates one registry entry.
- `updateWorktreeStatus(registryFile, name, status, options)`: updates one registry entry status.
- Types: `Worktree`, `WorktreeStatus`, `WorktreeReconciliationSummary`, `WorktreeRegistry`, `WorktreeDeps`, `WorktreeFileSystem`, `ExecFn`, and `ExecResult`.

## CLI

The root CLI exposes worktree maintenance commands:

| Command                              | Purpose                                       |
| ------------------------------------ | --------------------------------------------- |
| `poe-code worktree list`             | List managed worktrees.                       |
| `poe-code worktree reconcile <name>` | Reconcile a failed managed worktree.          |
| `poe-code worktree remove <name>`    | Remove a managed worktree and registry entry. |

## Config Options

The package has no global config file. Options are passed per operation:

| Option | Description |
| --- | --- |
| `cwd` | Source checkout used for Git commands. |
| `deps` | Injected filesystem and command executor. |
| `registryFile` | YAML registry path. |
| `worktreeDir`, `name`, `baseBranch` | Worktree parent, safe name, and starting revision. |
| `source`, `agent`, `sourceCwd` | Creation metadata and original checkout. |
| `storyId`, `planPath`, `prompt` | Optional task metadata. |
| `reconciliationAgent`, `signal` | Reconciliation callback and optional cancellation signal. |
| `deleteBranch` | Whether explicit removal also deletes the managed branch. |

## Validation and recovery

Creation requires a clean Git checkout and a safe worktree name. If creation fails while replacing an existing entry, its registry status is restored to `failed`; this is not a guarantee that partially created Git resources were removed.

Successful reconciliation checks the source changes and worktree cleanup, then records `done`. Failures can retain `conflicted` or `cleanup_failed` state for a later reconciliation attempt. Cancellation is propagated to the reconciliation callback. Explicit `removeWorktree({ cwd, deps, registryFile, name, deleteBranch })` is an alternative cleanup operation; do not call it automatically after reconciliation has already removed the Git worktree. Failed Git removal restores the previous registry status.

## Environment Variables

This package does not read or expose environment variables.
