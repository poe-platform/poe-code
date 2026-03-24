# Plan: `poe-code config` CLI Commands

## Overview

Add a `config` command group to poe-code CLI that provides introspection and management of config files.

### Commands

| Command | Description |
|---------|-------------|
| `poe-code config` | Show config file paths and a hint on how to use subcommands |
| `poe-code config show` | Show all config inputs (global, project, env) and the merged result |
| `poe-code config init` | Create an empty `.poe-code/config.json` in the current project directory |
| `poe-code config edit` | Open a config file in `$EDITOR` |

---

## Command Details

### `poe-code config` (default action)

Displays:
- Global config path: `~/.poe-code/config.json` (with exists/missing indicator)
- Project config path: `<cwd>/.poe-code/config.json` (with exists/missing indicator)
- Hint: `Run "poe-code config show" to see resolved configuration`

Uses `container.env.configPath` and `container.env.projectConfigPath` for paths. Checks file existence via `container.fs`.

### `poe-code config show`

Shows all three config layers and the merged result in a single output:

```
── Global config (~/.poe-code/config.json) ──
{
  "core": { "apiKey": "sk-..." }
}

── Project config (<cwd>/.poe-code/config.json) ──
{
  "core": { "apiKey": "sk-project-..." }
}

── Environment variable overrides ──
  POE_API_KEY = sk-env-...

── Resolved (merged) ──
{
  "core": { "apiKey": "sk-env-..." }
}
```

Implementation:
- Read global document via `readDocument(fs, globalPath)`
- Read project document via `readDocument(fs, projectPath)`
- Collect env var overrides by scanning registered scope schemas for fields with `env` defined, checking which are set in `process.env`
- Compute merged document via `readMergedDocument(fs, globalPath, projectPath)`
- Print each section with a design-system heading, pretty-printed JSON
- If a layer is empty/missing → show `(empty)` under its heading

### `poe-code config init`

- Checks if `<cwd>/.poe-code/config.json` already exists
  - If exists → log message "Project config already exists at ..." and exit (no error)
- If not exists:
  - Respects `--dry-run` → logs what would be created
  - Creates `<cwd>/.poe-code/` directory
  - Writes empty JSON document `{}` to `<cwd>/.poe-code/config.json`
  - Logs success with path

### `poe-code config edit`

- Options: `--global` / `--project` (default: project if it exists, otherwise global)
- Resolves `$EDITOR` (fall back to `$VISUAL`, then error with message "Set $EDITOR to use this command")
- If the target file doesn't exist → create it with `{}` first (so the editor opens a valid file)
- Spawns `$EDITOR <path>` via `child_process.execSync` with `stdio: 'inherit'`
- Respects `--dry-run` → logs which file would be opened

---

## Implementation

### New file: `src/cli/commands/config.ts`

```
registerConfigCommand(program, container)
```

Pattern follows `auth.ts`:
- Register `config` command group on `program`
- Default action → `executeConfigInfo()`
- `config show` subcommand → `executeConfigShow()`
- `config init` subcommand → `executeConfigInit()`
- `config edit` subcommand → `executeConfigEdit()`

### Wire up in `program.ts`

- Import and call `registerConfigCommand(program, container)`
- Add `config`, `config show`, `config init`, `config edit` to the help text `commandRows`

### Dependencies

- `readDocument`, `readMergedDocument` from `@poe-code/poe-code-config` (already exported)
- `container.fs` for file existence checks and writing
- `container.env.configPath` / `container.env.projectConfigPath` for paths
- Design system logger for output
- `resolveCommandFlags` / `createExecutionResources` from `shared.ts`
- `child_process.execSync` for `config edit` (spawns editor)

### Tests: `src/cli/commands/config.test.ts`

Using the existing test patterns (createTestProgram, mock fs via memfs):

1. **config (default)** — shows both paths with exists/missing status
2. **config show** — displays global, project, env layers and merged result
3. **config show** — shows `(empty)` for missing config files
4. **config show** — displays env var overrides when set
5. **config init** — creates empty config file at project path
6. **config init** — no-op when file already exists
7. **config init --dry-run** — does not write, logs intent
8. **config edit** — spawns editor with correct file path
9. **config edit --global** — opens global config
10. **config edit** — errors when no $EDITOR set

### Env var scanning for `config show`

To show which env vars override config values, we need access to scope schemas. Options:
- Import known scope definitions (e.g. `coreScope` from `src/services/config.ts`) and iterate their `env` fields
- Or: export a registry of all registered scopes from the config package

The simpler approach: import the known scope definitions directly. This keeps the config package unchanged and the command just needs to know which scopes exist — same knowledge the rest of the CLI already has.

### No changes needed to `poe-code-config` package

All required functions (`readDocument`, `readMergedDocument`, `resolveConfigPath`, `resolveProjectConfigPath`) are already exported.

---

## Out of scope

- Setting/deleting individual config values via CLI (e.g. `poe-code config set`) — future work
- Deleting project config — future work
- Diffing global vs project config — future work
