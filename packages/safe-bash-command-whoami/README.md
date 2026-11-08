# safe-bash-command-whoami

Print the effective sandbox user name.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Return the active user name (`sandbox` or `USER`/`LOGNAME`) for scripts that branch on user identity.

## Features

- `whoami` — Print effective username
- `--version` — Report Sandbox VFS-ish/GNU coreutils compatibility metadata

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("whoami");
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.

The `maxPasswdBytes` quota applies when resolving an effective user ID from `/etc/passwd`. Oversized files fail with a diagnostic; missing files use fallback names and cancellation propagates.
