# safe-bash-command-cal

Render ASCII monthly and annual calendars with Julian/Gregorian reformation support.

Display formatted single-month, three-month (`-3`), or full-year (`-y`) calendars with Sunday/Monday week starts and day-of-year (`-j`) modes.

## Features

- `cal [[MONTH] YEAR]` — Render a specific month or 12-month year grid
- `-3` / `--three`, `-1` / `--one`, `-y` / `--year` — Surrounding month and full-year layouts
- `-M` / `--monday` and `-j` / `--julian` — Monday-first weeks and Julian day-of-year numbers
- **1752 Reformation** — Accurate 11-day September 1752 transition

## Quick Start

```ts
import { createMemoryFileSystem, Shell, agentCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
const res = await shell.exec("cal 9 1752");
```
