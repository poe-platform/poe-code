# @poe-code/agent-hook-config

This package provides hook configuration registry, read, transform, write, and same-format symlink support for agent hook bridging.

## Symlink Hooks

`symlinkHooks(sourceAgentId, targetAgentId, cwd, homeDir, scope)` links a target agent's hook file to a source agent's hook file only when both registry entries use the exact same hook format. It preserves an existing correct link, replaces stale links, and replaces only JSON hook files whose handlers are all generated artifacts.

Symlink bridging currently targets POSIX-style symlink behavior. Bidirectional links, hardlinks, and Windows-specific symlink compatibility are out of scope for v1.
