# poe-code

> Configure coding agents to use the Poe API.

## Try it in 1 minute

```bash
# Install Poe wrapper binaries.
npm install -g poe-code

# Run your existing agent CLI through Poe (you’ll be prompted for api key on first run).
poe-claude --help
```

Also available: `poe-codex`, `poe-opencode`.

## Make it default

This updates the provider’s config files so you can use the provider CLI directly.

```bash
# Claude Code
npx poe-code@latest configure claude-code

# Codex
npx poe-code@latest configure codex

# OpenCode
npx poe-code@latest configure opencode

# Kimi
npx poe-code@latest configure kimi
```

### Unconfigure (remove overrides)

```bash
npx poe-code@latest unconfigure claude-code
```

## Utilities

Utilities are especially useful for scripting and CI/CD.

### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello"
```

### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex
```

### Test a configured service

```bash
npx poe-code@latest test codex
```

### Install agent CLIs

```bash
# Claude Code
npx poe-code@latest install claude-code

# Codex
npx poe-code@latest install codex

# OpenCode
npx poe-code@latest install opencode

# Kimi
npx poe-code@latest install kimi
```

### Optional flags

- `--dry-run` – show every mutation without touching disk.
- `--yes` – accept defaults for prompts.

## Poe MCP Server

Give any agent access to all Poe models including latest image, video, and audio models.

```bash
# Show configuration JSON and available tools
npx poe-code@latest mcp --help

# Configure an MCP client to use poe-code
npx poe-code@latest mcp configure claude-code

# Remove poe-code from an MCP client
npx poe-code@latest mcp unconfigure claude-code
```

### Available tools

- `generate_text` – Query any bot on Poe.
- `generate_image` – Generate images
- `generate_video` – Generate videos
- `generate_audio` – Convert text to audio

## SDK

Use `poe-code` programmatically in your own code:

```typescript
import { spawn, getPoeApiKey } from "poe-code"

// Get stored API key
const apiKey = await getPoeApiKey()

// Run a prompt through a provider
const result = await spawn("claude-code", {
  prompt: "Fix the bug in auth.ts",
  cwd: "/path/to/project",
  model: "claude-sonnet-4"
})

console.log(result.stdout)
```

### `spawn(service, options)`

Runs a single prompt through a configured service CLI.

- `service` – Service identifier (`claude-code`, `codex`, `opencode`)
- `options.prompt` – The prompt to send
- `options.cwd` – Working directory for the service CLI (optional)
- `options.model` – Model identifier override (optional)
- `options.args` – Additional arguments forwarded to the CLI (optional)

Returns `{ stdout, stderr, exitCode }`.

### `getPoeApiKey()`

Reads the Poe API key with the following priority:

1. `POE_API_KEY` environment variable
2. Credentials file (`~/.poe-code/credentials.json`)

Throws if no credentials found.
