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

## Config file locations

| Scope   | Path                          |
|---------|-------------------------------|
| Global  | `~/.poe-code/config.json`     |
| Project | `<cwd>/.poe-code/config.json` |

See the [@poe-code/poe-code-config](packages/poe-code-config/README.md) package README for details on resolution order and merge semantics.

## Configuring models

Models are configured under the `"models"` scope in config files. Use the `"default"` key for a global default model, or an agent ID key to set a model for a specific agent.

```json
{
  "models": {
    "default": "anthropic/claude-sonnet-4.6",
    "claude-code": "anthropic/claude-opus-4.6",
    "codex": "openai/gpt-5.4",
    "generate-text": "anthropic/claude-sonnet-4.6",
    "generate-image": "google/nano-banana-pro",
    "generate-video": "google/veo-3.1",
    "generate-audio": "elevenlabs/elevenlabs-v3"
  }
}
```

### Resolution order — spawn

1. `--model` CLI flag
2. Project config → `models.<agent-id>`
3. Global config → `models.default`
4. Provider's built-in default

### Resolution order — generate

1. `--model` CLI flag
2. Environment variable (`POE_TEXT_MODEL`, `POE_IMAGE_MODEL`, `POE_VIDEO_MODEL`, `POE_AUDIO_MODEL`)
3. Config file → `models.generate-<type>`
4. Built-in default

### Examples

Set a default model for all agents globally:

```json
// ~/.poe-code/config.json
{
  "models": {
    "default": "anthropic/claude-sonnet-4.6"
  }
}
```

Override the model for a specific agent in a project:

```json
// <cwd>/.poe-code/config.json
{
  "models": {
    "claude-code": "anthropic/claude-opus-4.6"
  }
}
```

Override the default model for `generate image`:

```json
// ~/.poe-code/config.json
{
  "models": {
    "generate-image": "openai/dall-e-3"
  }
}
```

The CLI flag always takes precedence:

```sh
poe-code spawn claude-code --model anthropic/claude-opus-4.6
poe-code generate image --model openai/dall-e-3 "A sunset"
```
