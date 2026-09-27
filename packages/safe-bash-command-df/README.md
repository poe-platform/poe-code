# safe-bash-command-df

GNU-compatible disk and inode usage reporting for virtual filesystems.

Inspect filesystem capacity, used space, available blocks, and inode counts across mounted virtual filesystems with human-readable and custom column formatting.

## Features

- `-h` / `--human-readable` and `-H` / `--si` — Format sizes in binary (1024) or SI (1000) units
- `-i` / `--inodes` — Report inode allocation and free inode percentages
- `-T` / `--print-type`, `-t TYPE`, `-x TYPE` — Display or filter mounts by filesystem type
- `-P` / `--portability`, `--total`, `--output=FIELD_LIST` — POSIX single-line layout, grand totals, and custom field selection

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("df -h -T --total /");
```
