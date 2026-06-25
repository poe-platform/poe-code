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

await removeWorktree({
  cwd: "/repo",
  deps,
  registryFile: "/repo/.poe-code/worktrees.yaml",
  name: worktree.name,
  deleteBranch: true
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

## Config Options

The package has no global config file. Options are passed per operation:

| Option                          | Description                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `cwd`                           | Source checkout used for git commands.                                       |
| `deps`                          | Injected filesystem and `exec` implementations.                              |
| `registryFile`                  | YAML registry file path.                                                     |
| `worktreeDir`                   | Parent directory for created worktrees.                                      |
| `name`                          | Worktree name; must be a safe single path segment.                           |
| `baseBranch`                    | Branch or revision used as the worktree base.                                |
| `source`                        | Creation source recorded in the registry, such as `sdk` or `superintendent`. |
| `agent`                         | Agent recorded in the registry and used by higher-level reconciliation.      |
| `sourceCwd`                     | Original source checkout path recorded on the worktree. Defaults to `cwd`.   |
| `storyId`, `planPath`, `prompt` | Optional metadata stored on the worktree record.                             |
| `reconciliationAgent`           | Function used by `reconcileWorktree` to apply, merge, and clean up changes.  |
| `signal`                        | Optional abort signal for reconciliation.                                    |
| `deleteBranch`                  | Whether `removeWorktree` also deletes the managed branch.                    |

## Validation and recovery

- Worktree names must be safe single path segments and are validated before Git commands run.
- `createWorktree` requires the destination checkout to be inside a git work tree with no uncommitted changes.
- Registry paths may resolve through the normal macOS `/var` system alias, but user-controlled symlink escapes are rejected.
- Failed worktree creation restores any replaced registry entry to `failed` and removes partially created worktrees/branches when possible.
- Reconciliation records committed and uncommitted merge status, cleanup status, conflict files, and the reconciliation agent thread id when available.
- `reconcileWorktree` always asks the agent to remove the managed worktree and branch after applying successful output.
- If `git worktree remove` fails after the registry was marked as removing, the previous registry status is restored.

## Environment Variables

This package does not read or expose environment variables.
