# safe-bash-command-pathchk

Validate file path validity and POSIX portability across systems.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Check paths for non-portable characters, leading hyphens, empty names, component length limits (`NAME_MAX`), and path length limits (`PATH_MAX`).

## Features

- `-p` — Check against the POSIX portable filename character set and 14-byte / 256-byte limits
- `-P` — Reject empty path arguments and path components starting with `-`
- `--portability` — Combine `-p` and `-P` checks in a single flag

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("pathchk --portability src/index.ts");
```
