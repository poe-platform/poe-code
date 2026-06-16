# @poe-code/worktree

Git worktree lifecycle helpers with a YAML registry.

This package creates, lists, removes, and tracks poe-code managed worktrees.
Callers provide filesystem and command-execution dependencies so the package can
be tested without touching the real filesystem.

## Usage

```ts
import { createWorktree, listWorktrees, removeWorktree } from "@poe-code/worktree";

const created = await createWorktree({
  deps,
  registryPath: "/repo/.poe-code/worktrees.yaml",
  worktreeDir: "/repo/.poe-code/worktrees",
  name: "fix-tests",
  baseBranch: "main",
  source: "manual",
  agent: "codex"
});

const entries = await listWorktrees({ deps, registryPath: created.registryPath });
await removeWorktree({ deps, registryPath: created.registryPath, name: created.worktree.name });
```

## Public API

- `createWorktree(options)`: creates a git worktree and records it in the registry.
- `removeWorktree(options)`: removes a worktree and updates registry state.
- `listWorktrees(options)`: reads registry entries.
- `readRegistry(deps, registryPath)`: reads the raw registry.
- `updateWorktreeStatus(options)`: updates one registry entry status.
- Types: `Worktree`, `WorktreeStatus`, `WorktreeRegistry`, `WorktreeDeps`, `WorktreeFileSystem`, and `ExecFn`.

## Config Options

The package has no global config file. Options are passed per operation:

| Option | Description |
| ------ | ----------- |
| `deps` | Injected filesystem and `exec` implementations. |
| `registryPath` | YAML registry file path. |
| `worktreeDir` | Parent directory for created worktrees. |
| `name` | Worktree name. |
| `baseBranch` | Branch used as the worktree base. |
| `source` | Creation source recorded in the registry. |
| `agent` | Agent recorded in the registry. |
| `storyId`, `planPath`, `prompt` | Optional metadata stored on the worktree record. |

## Environment Variables

This package does not read or expose environment variables.
