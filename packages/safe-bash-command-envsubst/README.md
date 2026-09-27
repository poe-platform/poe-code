# safe-bash-command-envsubst

Substitute environment variable placeholders in templates and configuration files.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Expand `$VAR` and `${VAR}` references from the shell environment with optional `SHELL-FORMAT` allowlisting and `-v` variable discovery.

## Features

- `envsubst [SHELL-FORMAT]` — Replace all or only allowlisted `$VAR` / `${VAR}` placeholders
- `-v` / `--variables` — List every environment variable referenced in `SHELL-FORMAT`

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("PORT=8080 envsubst <<< 'listen $PORT'");
```
