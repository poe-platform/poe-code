# safe-bash-command-id

Deterministic user and group identity reporting for sandboxed shell scripts.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Provide GNU coreutils-compatible `id` output (`uid`, `gid`, supplementary `groups`, and `Sandbox` security context) so build and setup scripts run unmodified.

## Features

- `-u` / `--user`, `-g` / `--group`, `-G` / `--groups` — Query effective or real numeric IDs
- `-n` / `--name` — Resolve symbolic user and group names (`sandbox`)
- `-Z` / `--context` — Report the `Sandbox` VFS-ish/GNU security context
- `-z` / `--zero` — Delimit entries with NUL bytes for pipeline safety

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("id -un"); // "sandbox\n"
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.

The `maxPasswdBytes` quota applies to both `/etc/passwd` and `/etc/group`. Oversized files fail with a diagnostic; missing files use fallback accounts and cancellation propagates.
