# safe-bash-command-locale

Inspect active locale categories, available locales (`-a`), charmaps (`-m`), and keywords.

Resource limits default to `Infinity`; configure finite quotas through command options when needed.

Report POSIX and UTF-8 locale environment settings (`LANG`, `LC_ALL`, `LC_CTYPE`, `charmap`) for internationalization-aware shell scripts.

## Features

- `locale` — Print effective values for all `LC_*` categories
- `-a` / `--all-locales` and `-m` / `--charmaps` — List available locales (`C`, `C.UTF-8`, `POSIX`, `en_US.UTF-8`) and character maps (`UTF-8`, `ANSI_X3.4-1968`, `ISO-8859-1`)
- `-k` / `--keyword-name` and `-c` / `--category-name` — Query specific locale keywords such as `charmap`, `codeset`, `decimal_point`, `day`, and `mon`

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("locale charmap"); // "UTF-8\n"
```
