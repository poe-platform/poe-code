# safe-bash-command-envsubst

Substitute environment variable placeholders in templates and configuration files.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Expand `$VAR` and `${VAR}` references from the shell environment with optional `SHELL-FORMAT` allowlisting and `-v` variable discovery. When `POSIXLY_CORRECT` is set, even to an empty value, option parsing stops at `SHELL-FORMAT`; otherwise options may follow it.

## Features

- `envsubst [SHELL-FORMAT]` — Replace all or only allowlisted `$VAR` / `${VAR}` placeholders
- `-v` / `--variables` — List every environment variable referenced in `SHELL-FORMAT`; short options can be grouped, such as `-vv` or `-vh`; long options accept unique prefixes such as `--var`, `--ver`, and `--he` (`--v` is ambiguous)

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("PORT=8080 envsubst <<< 'listen $PORT'");
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.
