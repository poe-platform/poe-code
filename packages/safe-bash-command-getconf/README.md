# safe-bash-command-getconf

Query POSIX and system configuration limits (`PAGESIZE`, `ARG_MAX`, `PATH_MAX`).

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Inspect system-wide and path-specific configuration variables expected by build systems and shell scripts.

## Features

- `getconf SYSTEM_VAR` — Query `PAGESIZE`, `PAGE_SIZE`, `LONG_BIT`, `WORD_BIT`, `ARG_MAX`, `_NPROCESSORS_ONLN`, `GNU_LIBC_VERSION`, and more
- `getconf PATH_VAR PATH` — Query `NAME_MAX`, `PATH_MAX`, `PIPE_BUF`, and `FILESIZEBITS`
- `-a` — Dump all known configuration variables and values

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("getconf PAGESIZE"); // "4096\n"
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.
