# safe-bash-command-uname

Platform and kernel metadata reporting for virtualized shell environments.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Expose deterministic `Sandbox` kernel and `VFS-ish/GNU` operating system identifiers across all standard `uname` flags.

## Features

- `-a` / `--all` — Print complete system identification line
- `-s`, `-n`, `-r`, `-v`, `-m`, `-p`, `-i`, `-o` — Query kernel name (`Sandbox`), nodename, release, machine architecture, and OS (`VFS-ish/GNU`)

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("uname -a");
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.
