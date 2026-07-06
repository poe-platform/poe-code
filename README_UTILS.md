# poe-code utils

Utility commands for inspecting and managing poe-code configuration.

## Commands

### `poe-code utils config`

Show config file paths and whether they exist.

```sh
poe-code utils config
```

### `poe-code utils config show`

Display all config inputs (global, project, environment variable overrides) and the final resolved result.

```sh
poe-code utils config show
```

### `poe-code utils config init`

Create an empty project config file at `<cwd>/.poe-code/config.json`.

```sh
poe-code utils config init
```

Supports `--dry-run` to preview without writing.

### `poe-code utils config edit`

Open a config file in `$EDITOR`.

```sh
poe-code utils config edit            # opens project config (or global if no project config exists)
poe-code utils config edit --global   # opens global config
poe-code utils config edit --project  # opens project config
```

Requires `$EDITOR` or `$VISUAL` to be set.

### `poe-code utils symlink agents`

Use `AGENTS.md` as the canonical agent instruction file and keep `CLAUDE.md` as a symlink to it.

```sh
poe-code utils symlink agents --dry-run
poe-code utils symlink agents
```

Behavior:

- If only `CLAUDE.md` exists, it is renamed to `AGENTS.md`, then `CLAUDE.md` is linked back.
- If only `AGENTS.md` exists, `CLAUDE.md` is linked to it.
- If both files exist as regular files, the command stops so you can merge them manually.

Options:

- `--dry-run` prints the filesystem operations without changing files.
- `--cwd <dir>` runs against another project directory.

### `poe-code utils symlink skills`

Move Claude skill directories to `.agents/skills` and link `.claude/skills` back to that shared location.

```sh
poe-code utils symlink skills --global --dry-run
poe-code utils symlink skills --local
```

Scope:

- `--global` uses `~/.agents/skills` and `~/.claude/skills`.
- `--local` uses `<cwd>/.agents/skills` and `<cwd>/.claude/skills`.
- `--yes` skips the prompt and chooses global scope.

Use `--dry-run` before running against an existing skill directory.

## Config file locations

| Scope   | Path                          |
| ------- | ----------------------------- |
| Global  | `~/.poe-code/config.json`     |
| Project | `<cwd>/.poe-code/config.json` |

See the [@poe-code/poe-code-config](packages/poe-code-config/README.md) package README for details on resolution order and merge semantics.

## Configuring models

Models are configured under the `"models"` scope in config files. Use the `"default"` key for a fallback model, or an agent ID key to set a model for a specific agent.

```json
{
  "models": {
    "default": "<model-id>",
    "claude-code": "<model-id>",
    "codex": "<model-id>"
  }
}
```

### Resolution order

1. `--model` CLI flag
2. Merged config: `models.<agent-id>`
3. Merged config: `models.default`
4. Provider's built-in default

### Examples

Set a default model for all agents globally:

```json
// ~/.poe-code/config.json
{
  "models": {
    "default": "<model-id>"
  }
}
```

Override the model for a specific agent in a project:

```json
// <cwd>/.poe-code/config.json
{
  "models": {
    "claude-code": "<model-id>"
  }
}
```

The CLI flag always takes precedence:

```sh
poe-code spawn claude-code "Say hello" --model <model-id>
```
