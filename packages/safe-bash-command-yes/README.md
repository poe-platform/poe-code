# safe-bash-command-yes

Continuously emit affirmative or custom strings into downstream pipelines.

Stream repeated lines until downstream consumers close the pipe or the configured byte budget is reached.

## Features

- `yes [STRING]...` — Repeat `y` or custom space-joined arguments
- **Pipe-Aware Termination** — Cleanly stops as soon as `head` or interactive prompts close stdin

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("yes accept | head -n 3");
```
