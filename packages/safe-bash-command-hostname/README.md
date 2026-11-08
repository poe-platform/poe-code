# safe-bash-command-hostname

Inspect or configure the virtual sandbox host identity.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Query short, FQDN, domain, or loopback IP address metadata for scripts expecting standard `hostname` flags.

## Features

- `-s` / `--short`, `-f` / `--fqdn`, `-d` / `--domain` — Format short host, fully-qualified domain, or DNS domain
- `-i` / `--ip-address` and `-I` / `--all-ip-addresses` — Return sandbox loopback addresses

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("hostname -f");
```

Resource limits are disabled (`Infinity`) by default. Pass `limits` to the command factory or plugin to enforce bounds; omitted limits remain disabled.

Hostname changes are scoped to the filesystem, including when it is read-only, and take precedence over an inherited `HOSTNAME` or an older hostname file. Oversized hostname files fail with a diagnostic; cancellation and shell output budget errors propagate.
