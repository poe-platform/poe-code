# safe-bash-command-sha512sum

Compute and verify FIPS 180-4 512-bit SHA-512 cryptographic digests.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Generate or check SHA-512 checksums in standard GNU or BSD `--tag` format with `--check`, `--strict`, `--status`, and `--ignore-missing` support.

## Features

- `sha512sum [FILE]...` — Compute 128-hex-character SHA-512 digests
- `-c` / `--check` — Verify SHA-512 sums from a manifest file
- `--tag`, `-b` / `--binary`, `-t` / `--text`, `-z` / `--zero` — Output format controls
- `--quiet`, `--status`, `--strict`, `--warn`, `--ignore-missing` — Verification reporting options

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("printf 'abc' | sha512sum");
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.
