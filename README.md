![poe-code banner](docs/banners/claude-opus-4-6.jpg)

<div align="center">
  <h1>Poe Code ⚡</h1>

<a href="https://poe.com"><img src="https://img.shields.io/badge/Poe-Sign up-purple?logo=poe&logoColor=white&color=5D5CDE&style=for-the-badge" alt="Discord"></a>
<a href="https://www.npmjs.com/package/poe-code"><img alt="NPM version" src="https://img.shields.io/npm/v/next.svg?&style=for-the-badge&color=09B16B"></a>
<a href="https://discord.gg/joinpoe"><img src="https://img.shields.io/badge/Discord-Join-purple?logo=discord&logoColor=white&color=FF44D3&style=for-the-badge" alt="Discord"></a>

</div>

Power your favorite coding agents (Claude Code, Codex, OpenCode, and more) with your Poe subscription—**no need to handle multiple providers/accounts.** Poe Code routes everything through the [Poe API](https://poe.com/api) . 

Use it of a single session (`poe-code wrap claude`) or configure it as your default and use your tools normally. 


## Quickstart
Start a coding session routing all your `claude` calls to Poe
```bash
npx poe-code wrap claude
# Also available: codex, opencode, kimi
```

or 

## Set it as your default (works with CLIs and desktop apps)
This updates the provider’s config files so you can use the provider CLI directly.

```bash
# Start the interactive setup
npx poe-code configure

# Setup a specific agent
npx poe-code@latest configure codex # (or claude, opencode, kimi)
```


### Unconfigure (remove overrides)

```bash
npx poe-code unconfigure claude
```


## Quick links 
-  [Utilities](#utilities)
-  [Usage and Billing](#usage--billing)
-  [MCP Server](#poe-mcp-server)
-  [SDK](#sdk)
-  [Poe API](https://poe.com/api)



## Utilities

Utilities are especially useful for scripting and CI/CD.

#### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello"
```

#### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex
```

#### Test a configured service

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

## Usage & Billing

Check your compute points balance and review usage history.

```bash
# Show current balance
poe-code usage

# Show usage history (paginated, 20 entries per page)
poe-code usage list

# Auto-load multiple pages
poe-code usage list --pages 5

# Filter by model name
poe-code usage list --filter claude
```

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
