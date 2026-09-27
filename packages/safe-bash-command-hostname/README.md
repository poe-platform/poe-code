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
