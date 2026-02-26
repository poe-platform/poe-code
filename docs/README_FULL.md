# Poe Code - Complete Reference

> **Audience**: AI agents and developers who need to understand and use every feature of the `poe-code` library — CLI, SDK, MCP server, providers, and internals.

`poe-code` is a CLI tool and Node.js SDK that configures coding agents (Claude Code, Codex, OpenCode, Kimi) to route their API calls through the [Poe API](https://poe.com/api). Instead of managing multiple provider accounts, a single Poe subscription powers all your coding agents.

**Repository**: https://github.com/poe-platform/poe-code

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
  - [Global Options](#global-options)
  - [configure](#configure)
  - [unconfigure](#unconfigure)
  - [login](#login)
  - [logout](#logout)
  - [spawn](#spawn)
  - [research](#research)
  - [wrap](#wrap)
  - [test](#test)
  - [install](#install)
  - [generate](#generate)
  - [usage](#usage)
  - [models](#models)
  - [mcp](#mcp)
  - [skill](#skill)
  - [ralph](#ralph)
- [SDK Reference](#sdk-reference)
  - [spawn()](#spawn-sdk)
  - [spawn.pretty()](#spawnpretty)
  - [generate()](#generate-sdk)
  - [generateImage()](#generateimage)
  - [generateVideo()](#generatevideo)
  - [generateAudio()](#generateaudio)
  - [getPoeApiKey()](#getpoeapikey)
  - [Types](#sdk-types)
- [Providers](#providers)
  - [Claude Code](#claude-code-provider)
  - [Codex](#codex-provider)
  - [OpenCode](#opencode-provider)
  - [Kimi](#kimi-provider)
  - [Provider Architecture](#provider-architecture)
- [MCP Server](#mcp-server)
  - [Available Tools](#mcp-tools)
  - [Output Formats](#mcp-output-formats)
  - [Agent MCP Configuration](#agent-mcp-configuration)
- [Spawn System](#spawn-system)
  - [Spawn Modes](#spawn-modes)
  - [Streaming (ACP Events)](#streaming-acp-events)
  - [MCP at Spawn Time](#mcp-at-spawn-time)
  - [Interactive Mode](#interactive-mode)
  - [Stdin Prompt](#stdin-prompt)
  - [Resume Sessions](#resume-sessions)
  - [Spawn Configurations per Agent](#spawn-configurations-per-agent)
- [Configuration System](#configuration-system)
  - [Credentials Storage](#credentials-storage)
  - [Provider Config Files](#provider-config-files)
  - [Isolated Environments](#isolated-environments)
  - [Mutation System](#mutation-system)
  - [Dry Run](#dry-run)
- [Models and Constants](#models-and-constants)
- [Environment Variables](#environment-variables)
- [Research Command](#research-command-details)
- [Ralph Build System](#ralph-build-system)
- [Skill System](#skill-system)
- [Binary Wrappers](#binary-wrappers)
- [LLM Client Internals](#llm-client-internals)
- [Error Handling](#error-handling)
- [Project Structure](#project-structure)

---

## Installation

```bash
# Global install
npm install -g poe-code

# Or use directly with npx
npx poe-code@latest <command>
```

**Requirements**: Node.js >= 22.14.0, npm >= 11.5.1

---

## Quick Start

### One-off session (no config changes)

```bash
# Wrap any agent to route through Poe for a single session
npx poe-code@latest wrap claude
npx poe-code@latest wrap codex
npx poe-code@latest wrap opencode
npx poe-code@latest wrap kimi
```

### Persistent configuration

```bash
# Interactive setup (prompts for agent and model)
npx poe-code@latest configure

# Configure a specific agent
npx poe-code@latest configure claude --model sonnet

# Non-interactive (CI/CD)
npx poe-code@latest configure claude --model sonnet --api-key pb-xxx --yes
```

### Remove configuration

```bash
# Remove config for one agent
npx poe-code@latest unconfigure claude

# Remove everything (all configs + stored credentials)
npx poe-code@latest logout
```

---

## CLI Reference

### Global Options

Every command supports these flags:

| Flag | Description |
|------|-------------|
| `-y, --yes` | Accept all defaults without prompting. Mainly for CI/CD. |
| `--dry-run` | Simulate the command. Shows every file mutation without writing to disk. Redacts sensitive values (API keys). |
| `--verbose` | Show detailed log output. |
| `-h, --help` | Display help for the command. |
| `-V, --version` | Show current version and check for updates. |

---

### configure

Configure a coding agent to route API calls through the Poe API.

```bash
poe-code configure [agent]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | No | Agent to configure: `claude`, `claude-code`, `codex`, `opencode`, `kimi`. Prompts if omitted. |

**Options:**

| Option | Description |
|--------|-------------|
| `--api-key <key>` | Poe API key. Also reads from `POE_API_KEY` env var. Prompts if not provided. |
| `--model <model>` | Model identifier (e.g., `sonnet`, `opus`, `openai/gpt-5.2`). Prompts from agent-specific choices if omitted. |
| `--reasoning-effort <level>` | Reasoning effort level for agents that support it (Codex). Values: `low`, `medium`, `high`. Default: `medium`. |

**Behavior:**

1. Resolves the agent (prompts if not specified and `--yes` not set)
2. Resolves the API key from flag, env, stored credentials, or prompts
3. Collects agent-specific options (model, reasoning effort) via prompts or flags
4. Applies file mutations to the agent's config files (merge, not overwrite)
5. Sets up isolated environment if the agent supports it
6. Saves service metadata to `~/.poe-code/credentials.json`
7. Displays post-configure messages (e.g., VSCode settings for Claude Code)

**Examples:**

```bash
# Interactive - prompts for everything
poe-code configure

# Specify agent, prompt for model
poe-code configure claude

# Fully non-interactive
poe-code configure codex --model openai/gpt-5.2-codex --api-key pb-xxx --yes

# With reasoning effort (Codex only)
poe-code configure codex --reasoning-effort high

# Dry run - see what would change
poe-code configure claude --model opus --dry-run
```

---

### unconfigure

Remove Poe API configuration from an agent, restoring its original state.

```bash
poe-code unconfigure <agent>
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | Yes | Agent to unconfigure. |

**Behavior:**

1. Resolves the agent by name or alias
2. Runs the provider's unconfigure mutations (prune keys from config files)
3. Removes isolated environment configuration if applicable
4. Removes the service from `~/.poe-code/credentials.json`

**Examples:**

```bash
poe-code unconfigure claude
poe-code unconfigure codex
poe-code unconfigure opencode --dry-run
```

---

### login

Store a Poe API key for reuse across all commands.

```bash
poe-code login
```

**Options:**

| Option | Description |
|--------|-------------|
| `--api-key <key>` | Poe API key. Prompts if not provided. |

**Behavior:**

1. Resolves API key from `--api-key`, `POE_API_KEY` env, or interactive prompt
2. Saves to `~/.poe-code/credentials.json`
3. Reconfigures all currently configured services with the new key
4. Re-applies isolated configuration for each service

**Examples:**

```bash
poe-code login
poe-code login --api-key pb-xxx
POE_API_KEY=pb-xxx poe-code login --yes
```

---

### logout

Remove all Poe API configuration and stored credentials.

```bash
poe-code logout
```

**Behavior:**

1. Loads all configured services from credentials file
2. Calls unconfigure for each service
3. Deletes the entire credentials file (`~/.poe-code/credentials.json`)

---

### spawn

Launch a single agent session with a prompt. Returns structured output.

```bash
poe-code spawn <agent> [prompt] [agentArgs...]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | Yes | Agent to spawn: `claude-code`, `codex`, `opencode`, `kimi` |
| `prompt` | No | Prompt text. Use `-` to read from stdin. |
| `agentArgs` | No | Additional arguments forwarded directly to the agent CLI. |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--model <model>` | Agent default | Model identifier override. |
| `-C, --cwd <path>` | Current dir | Working directory for the agent. |
| `--stdin` | `false` | Read the prompt from stdin. |
| `-i, --interactive` | `false` | Launch in interactive TUI mode (inherits stdio). |
| `--mode <mode>` | `yolo` | Permission mode: `yolo` (full access), `edit` (file edits only), `read` (read-only). |
| `--mcp-config <json>` | None | MCP servers to inject at spawn time. JSON format: `{"name": {"command": "...", "args": [...], "env": {...}}}` |

**Behavior:**

1. Resolves working directory (supports relative and absolute paths)
2. Detects stdin input from `--stdin` flag, `-` argument, or piped input
3. Parses and validates MCP server config if provided
4. If `--interactive`: spawns with inherited stdio (TUI mode)
5. If standard mode: streams ACP events to stdout with formatted rendering
6. Returns exit code from the agent process
7. If the agent returns a thread ID, builds and displays a resume command

**Examples:**

```bash
# Basic spawn
poe-code spawn claude-code "Fix the bug in auth.ts"

# With model override
poe-code spawn codex "Add unit tests" --model openai/gpt-5.2-pro

# Read-only mode for code review
poe-code spawn claude-code "Review this code for issues" --mode read

# Pipe prompt from file
cat prompt.txt | poe-code spawn codex --stdin

# Use '-' as stdin shorthand
echo "Hello" | poe-code spawn claude-code -

# Interactive TUI mode
poe-code spawn claude-code -i

# With MCP servers injected at spawn time
poe-code spawn claude-code "Use the filesystem tool" \
  --mcp-config '{"fs": {"command": "/usr/local/bin/fs-server"}}'

# Specify working directory
poe-code spawn codex "Fix tests" -C /path/to/project

# Forward extra args to agent CLI
poe-code spawn claude-code "Hello" -- --max-tokens 1000

# In CI with full automation
poe-code spawn codex "Run lint and fix issues" --mode yolo --yes
```

---

### research

Research a codebase using a coding agent in read-only mode.

```bash
poe-code research [prompt] [agentArgs...]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--agent <agent>` | Prompts | Agent to use for research. |
| `--model <model>` | Agent default | Model override. |
| `--mode <mode>` | `read` | Permission mode (defaults to `read`, more restrictive than `spawn`). |
| `-C, --cwd <path>` | Current dir | Working directory. |
| `--path <path>` | None | Local directory to research. |
| `--github <repo>` | None | Clone and research a GitHub repo. |
| `--stdin` | `false` | Read prompt from stdin. |
| `--keep` | `false` | Keep the cloned repo when using `--github`. |

**Examples:**

```bash
# Research local codebase
poe-code research "How does the authentication system work?" --agent claude-code

# Research a GitHub repo
poe-code research "Explain the architecture" --github poe-platform/poe-code

# Keep the cloned repo for further work
poe-code research "Find security issues" --github owner/repo --keep

# Research a specific local path
poe-code research "What does this module do?" --path ./src/auth
```

---

### wrap

Run an agent CLI with Poe isolated configuration for a single session, without modifying global config files.

```bash
poe-code wrap <agent> [agentArgs...]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | Yes | Agent to wrap. |
| `agentArgs` | No | Arguments forwarded to the agent CLI. |

**Behavior:**

1. Sets up an isolated environment in `~/.poe-code/<agent>/`
2. Applies necessary environment variables (API keys, base URLs, config paths)
3. Runs any configured repairs (e.g., file permissions)
4. Spawns the agent binary with the isolated configuration
5. All arguments after the agent name are forwarded directly

**Examples:**

```bash
# Start a wrapped Claude Code session
poe-code wrap claude

# Wrap Codex with specific arguments
poe-code wrap codex -- exec "Fix the bug"

# Wrap OpenCode
poe-code wrap opencode
```

---

### test

Run health checks on a configured agent to verify the Poe API integration works.

```bash
poe-code test [agent]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | No | Agent to test. Prompts if omitted. |

**Options:**

| Option | Description |
|--------|-------------|
| `--isolated` | Run the health check using isolated configuration instead of global config. |
| `--model <model>` | Model override for the health check. |

**Behavior:**

Each agent has a health check that spawns the agent with a known prompt and validates the expected output:

| Agent | Expected Output |
|-------|----------------|
| Claude Code | `CLAUDE_CODE_OK` |
| Codex | `CODEX_OK` |
| OpenCode | `OPEN_CODE_OK` |
| Kimi | `KIMI_OK` |

**Examples:**

```bash
poe-code test claude-code
poe-code test codex --isolated
poe-code test opencode --model anthropic/claude-sonnet-4.6
```

---

### install

Install the CLI binary for a coding agent.

```bash
poe-code install [agent]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | No | Agent to install. Prompts if omitted. |

**Installation methods per agent:**

| Agent | Method |
|-------|--------|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` (Unix) or PowerShell (Windows) |
| Codex | `npm install -g @openai/codex` |
| OpenCode | `npm install -g opencode-ai` |
| Kimi | `uv tool install --python 3.13 kimi-cli` |

**Examples:**

```bash
poe-code install claude-code
poe-code install codex
poe-code install opencode
poe-code install kimi
```

---

### generate

Generate content (text, images, video, audio) via the Poe API directly from the command line.

```bash
poe-code generate [prompt]
poe-code generate text [prompt]
poe-code generate image [prompt]
poe-code generate video [prompt]
poe-code generate audio [prompt]
```

**Options (all subcommands):**

| Option | Description |
|--------|-------------|
| `--model <model>` | Model identifier. Uses type-specific defaults if omitted. |
| `--param <key=value>` | Additional parameters (repeatable). Passed as `extra_body` to the API. |
| `-o, --output <path>` | Output file path (media subcommands only). Auto-generates filename if omitted. |

**Default models:**

| Type | Default Model | Environment Override |
|------|---------------|---------------------|
| Text | `anthropic/claude-sonnet-4.6` | `POE_TEXT_MODEL` |
| Image | `google/nano-banana-pro` | `POE_IMAGE_MODEL` |
| Video | `google/veo-3.1` | `POE_VIDEO_MODEL` |
| Audio | `elevenlabs/elevenlabs-v3` | `POE_AUDIO_MODEL` |

**Examples:**

```bash
# Text generation (default subcommand)
poe-code generate "Explain monads in simple terms"
poe-code generate text "Write a haiku about coding" --model anthropic/claude-opus-4.6

# Image generation
poe-code generate image "A futuristic city at sunset"
poe-code generate image "Logo for a coffee shop" -o logo.png

# Video generation
poe-code generate video "A cat playing piano" --model google/veo-3.1
poe-code generate video "Ocean waves" -o waves.mp4

# Audio generation
poe-code generate audio "Hello, welcome to our podcast" --model elevenlabs/elevenlabs-v3
poe-code generate audio "Breaking news" -o news.mp3

# With extra parameters
poe-code generate "Write a poem" --param temperature=0.9 --param max_tokens=500
```

---

### usage

Check Poe API compute points balance and review usage history.

```bash
poe-code usage
poe-code usage balance
poe-code usage list
```

#### `usage` / `usage balance`

Display current compute points balance.

```bash
poe-code usage
# Output: Current balance: 1,234,567 points ($12.35)
```

#### `usage list`

Display usage history with filtering and pagination.

**Options:**

| Option | Description |
|--------|-------------|
| `--filter <model>` | Filter results by model name (substring match). |
| `--pages <count>` | Number of pages to auto-load. Prompts for "Load more?" if not specified. |

**Output columns:** Date, Model, Cost (USD), Cost (Points), Input Tokens, Output Tokens, Cache Discount Tokens

**Examples:**

```bash
# Interactive pagination
poe-code usage list

# Auto-load 5 pages
poe-code usage list --pages 5

# Filter by model
poe-code usage list --filter claude

# Non-interactive
poe-code usage list --pages 3 --yes
```

---

### models

List available Poe API models with filtering and multiple view modes.

```bash
poe-code models
```

**Options:**

| Option | Description |
|--------|-------------|
| `--provider <name>` | Filter by provider (substring match). |
| `--model <name>` | Filter by model ID (substring match). |
| `--feature <name>` | Filter by feature: `tools`, `web_search`, `reasoning` (exact match). |
| `--input <modalities>` | Filter by input modalities: `text`, `image` (comma-separated). |
| `--output <modalities>` | Filter by output modalities: `text`, `image`, `video`, `audio` (comma-separated). |
| `--tools` | Shorthand for `--feature tools`. |
| `--since <duration>` | Show models added within duration: `7d`, `2w`, `3mo`, `1y`. |
| `--view <name>` | Table view mode. See below. |

**View modes:**

| View | Description |
|------|-------------|
| `capabilities` (default) | Model name, date, modalities, context window, reasoning, features. |
| `pricing` | Per-model pricing: input/output $/MTok, cache read/write, per-request cost. |
| `parameters` | Model parameters with types, defaults, and value ranges. |
| `raw` | Full model data in YAML format. |

**Examples:**

```bash
# List all models
poe-code models

# Filter by provider
poe-code models --provider anthropic

# Models with tool support added in last 2 weeks
poe-code models --tools --since 2w

# Image generation models with pricing
poe-code models --output image --view pricing

# Reasoning models
poe-code models --feature reasoning

# Models that accept image input
poe-code models --input image

# Parameters for Claude models
poe-code models --model claude --view parameters

# Raw YAML output for scripting
poe-code models --provider openai --view raw
```

---

### mcp

MCP (Model Context Protocol) server commands. Give any agent access to all Poe models via MCP.

#### `mcp serve`

Run the Poe MCP server on stdin/stdout (for agent integration).

```bash
poe-code mcp serve
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--output-format <format>` | `url` | Preferred media output format(s). Values: `url`, `base64`, `markdown`, `markdown_instructions`. Comma-separated for fallback chain. |

**Output format details:**

| Format | Description |
|--------|-------------|
| `url` | Returns media URL directly. |
| `base64` | Returns base64-encoded content as an MCP Image/Audio content block. Not supported for video. |
| `markdown` | Returns markdown-formatted link: `![Image](url)` for images, `[filename](url)` for video/audio. |
| `markdown_instructions` | Returns instructions for the agent to render the media in chat. |

**Examples:**

```bash
# Standard MCP server
poe-code mcp serve

# With base64 output (for agents that support inline images)
poe-code mcp serve --output-format base64

# Fallback chain: try base64, then URL
poe-code mcp serve --output-format base64,url

# Markdown format
poe-code mcp serve --output-format markdown
```

#### `mcp configure`

Configure an agent to use poe-code as an MCP server.

```bash
poe-code mcp configure [agent]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip prompt, default to claude-code. |

**Supported agents and their MCP config locations:**

| Agent | Config File | Config Key |
|-------|------------|------------|
| Claude Code | `~/.claude.json` | `mcpServers` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` |
| Claude Desktop (Windows) | `~/AppData/Roaming/Claude/claude_desktop_config.json` | `mcpServers` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` | `mcpServers` |
| Codex | `~/.codex/config.toml` | `mcp_servers` |
| OpenCode | `~/.config/opencode/opencode.json` | `mcp` |
| Kimi | `~/.kimi/mcp.json` | `mcpServers` |

**Examples:**

```bash
poe-code mcp configure claude-code
poe-code mcp configure codex
poe-code mcp configure --yes  # defaults to claude-code
```

#### `mcp unconfigure`

Remove poe-code from an agent's MCP configuration.

```bash
poe-code mcp unconfigure <agent>
```

---

### skill

Manage skill directories for agents. Skills are prompt templates that agents can use.

#### `skill configure`

Install skill directories for an agent.

```bash
poe-code skill configure [agent]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agent <name>` | Agent to configure (alias for the argument). |
| `--local` | Use local scope (project directory). |
| `--global` | Use global scope (home directory). |

#### `skill unconfigure`

Remove skill directories from an agent.

```bash
poe-code skill unconfigure [agent]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agent <name>` | Agent to unconfigure. |
| `--local` | Local scope. |
| `--global` | Global scope. |
| `--force` | Remove directory even if it contains files. |

**Examples:**

```bash
# Install skills globally for Claude Code
poe-code skill configure claude-code --global

# Install skills locally (project scope)
poe-code skill configure claude-code --local

# Remove skills
poe-code skill unconfigure claude-code --global
poe-code skill unconfigure claude-code --local --force
```

---

### ralph

Ralph is a build loop system that iterates on a plan file using an AI agent. It reads a YAML plan, picks stories to work on, spawns an agent for each, and tracks progress.

#### `ralph build`

Run the Ralph build loop.

```bash
poe-code ralph build [iterations]
```

**Arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `iterations` | Auto-calculated | Max iterations. Auto: `max(open*2, open+10)` where `open` = number of open stories. |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--plan <path>` | Prompts | Path to the YAML plan file. |
| `--agent <name>` | `codex` | Agent to use for building. |
| `--model <model>` | Agent default | Model override for the entire run. |
| `--[no-]commit` | `true` | Whether the agent should commit changes. |
| `--max-failures <n>` | `3` | Warn after n consecutive failures. |
| `--pause-on-overbake` | `false` | Pause and prompt when overbaking is detected. |
| `--worktree` | `false` | Run in an isolated git worktree. |
| `--worktree-name <name>` | Derived from plan | Name for the worktree. |

**Examples:**

```bash
# Run with defaults
poe-code ralph build --plan .agents/poe-code-ralph/plans/my-plan.yaml

# Specify agent and iterations
poe-code ralph build 10 --plan plan.yaml --agent claude-code

# With worktree isolation
poe-code ralph build --plan plan.yaml --worktree

# No commits (agent won't commit)
poe-code ralph build --plan plan.yaml --no-commit

# Pause on overbaking (too many iterations on one story)
poe-code ralph build --plan plan.yaml --pause-on-overbake
```

#### `ralph install`

Install Ralph templates and the `/plan` skill.

```bash
poe-code ralph install
```

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing files. |
| `--agent <name>` | Agent to install skills for. |
| `--local` | Local scope. |
| `--global` | Global scope. |

#### `ralph agent log`

Append a message to the Ralph activity log.

```bash
poe-code ralph agent log <message>
```

**Options:**

| Option | Description |
|--------|-------------|
| `--activity-log <path>` | Custom activity log path. |

#### `ralph agent validate-plan`

Validate the structure of a Ralph plan YAML file.

```bash
poe-code ralph agent validate-plan --plan <path>
```

#### `ralph worktree merge`

Merge a Ralph worktree back into the main branch.

```bash
poe-code ralph worktree merge <name>
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agent <name>` | Agent for the merge operation. |

---

## SDK Reference

```bash
npm install poe-code
```

All SDK functions automatically resolve the Poe API key from `POE_API_KEY` environment variable or `~/.poe-code/credentials.json`.

### spawn() {#spawn-sdk}

Spawn an agent with optional streaming. Returns both an async event stream and a result promise synchronously.

```typescript
import { spawn } from "poe-code";
```

**Overloads:**

```typescript
// Overload 1: service + prompt string + optional options
function spawn(
  service: string,
  prompt: string,
  options?: Omit<SpawnOptions, "prompt">
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> };

// Overload 2: service + options object
function spawn(
  service: string,
  options: SpawnOptions
): { events: AsyncIterable<AcpEvent>; result: Promise<SpawnResult> };
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `service` | `string` | Agent identifier: `"claude-code"`, `"codex"`, `"opencode"`, `"kimi"` |
| `prompt` | `string` | The prompt to send to the agent |
| `options` | `SpawnOptions` | See [SpawnOptions](#spawnoptions) |

**Return value:**

```typescript
{
  events: AsyncIterable<AcpEvent>;  // Stream of ACP events (empty for non-streaming agents)
  result: Promise<SpawnResult>;      // Final result with stdout, stderr, exitCode
}
```

**Deferred event stream pattern:**

The `events` and `result` are returned synchronously. The actual event source is resolved asynchronously inside the `result` promise. This means you can start iterating `events` immediately — iteration will block until the event source is ready. No race conditions.

**Examples:**

```typescript
import { spawn } from "poe-code";

// Basic usage with streaming events
const { events, result } = spawn("claude-code", "Fix the bug in auth.ts");

for await (const event of events) {
  console.log(event); // ACP events: progress, tokens, tool use, etc.
}

const final = await result;
console.log(final.stdout);
console.log(final.exitCode);
console.log(final.threadId); // Available for streaming agents

// Options object overload
const { result: r2 } = spawn("codex", {
  prompt: "Add tests for the User model",
  cwd: "/path/to/project",
  model: "openai/gpt-5.2-codex",
  mode: "edit",
  args: ["--skip-git-repo-check"]
});

// With MCP servers
const { result: r3 } = spawn("claude-code", {
  prompt: "Use the filesystem tool to list files",
  mcpServers: {
    "filesystem": {
      command: "/usr/local/bin/fs-mcp-server",
      args: ["--root", "/tmp"],
      env: { "DEBUG": "true" }
    }
  }
});

// Interactive mode (inherits stdio for TUI)
const { result: r4 } = spawn("claude-code", {
  prompt: "Let's debug this together",
  interactive: true
});
```

### spawn.pretty()

Spawn an agent and render ACP events to stdout with formatted, colored output matching the CLI's visual style.

```typescript
spawn.pretty(service: string, prompt: string, options?: Omit<SpawnOptions, "prompt">): Promise<SpawnResult>
spawn.pretty(service: string, options: SpawnOptions): Promise<SpawnResult>
```

**Examples:**

```typescript
import { spawn } from "poe-code";

// Renders streaming output to terminal
const result = await spawn.pretty("codex", "Fix the bug in auth.ts");
console.log(result.exitCode);

// With options
const result2 = await spawn.pretty("claude-code", {
  prompt: "Review this PR",
  mode: "read",
  cwd: "/path/to/project"
});
```

### generate() {#generate-sdk}

Generate text using the Poe API.

```typescript
import { generate } from "poe-code";

const result = await generate("Explain quantum computing", {
  model: "anthropic/claude-opus-4.6",
  params: { temperature: "0.7", max_tokens: "1000" }
});

console.log(result.content); // Generated text
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | The generation prompt. |
| `options.model` | `string` | No | Model override. Default: `anthropic/claude-sonnet-4.6` or `POE_TEXT_MODEL` env. |
| `options.params` | `Record<string, string>` | No | Extra parameters passed as `extra_body` to the API. |

**Returns:** `Promise<GenerateResult>` with `{ content: string }`

### generateImage()

Generate an image using the Poe API.

```typescript
import { generateImage } from "poe-code";

const result = await generateImage("A futuristic city at sunset", {
  model: "google/nano-banana-pro"
});

console.log(result.url);      // URL to the generated image
console.log(result.mimeType); // e.g., "image/png"
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Image generation prompt. |
| `options.model` | `string` | No | Default: `google/nano-banana-pro` or `POE_IMAGE_MODEL` env. |
| `options.params` | `Record<string, string>` | No | Extra parameters. |

**Returns:** `Promise<MediaGenerateResult>` with `{ url: string, mimeType?: string }`

### generateVideo()

Generate a video using the Poe API.

```typescript
import { generateVideo } from "poe-code";

const result = await generateVideo("A cat playing piano");
console.log(result.url);
```

**Default model:** `google/veo-3.1` or `POE_VIDEO_MODEL` env.

### generateAudio()

Generate audio (text-to-speech) using the Poe API.

```typescript
import { generateAudio } from "poe-code";

const result = await generateAudio("Hello, welcome to our podcast");
console.log(result.url);
```

**Default model:** `elevenlabs/elevenlabs-v3` or `POE_AUDIO_MODEL` env.

### getPoeApiKey()

Read the stored Poe API key.

```typescript
import { getPoeApiKey } from "poe-code";

const apiKey = await getPoeApiKey();
```

**Resolution order:**

1. `POE_API_KEY` environment variable
2. `~/.poe-code/credentials.json` file

**Throws** `Error` if no credentials found. Error message: `"No API key found. Set POE_API_KEY or run 'poe-code login'."`

### SDK Types

```typescript
import type {
  SpawnOptions,
  SpawnResult,
  GenerateOptions,
  GenerateResult,
  MediaGenerateOptions,
  MediaGenerateResult
} from "poe-code";
```

#### SpawnOptions

```typescript
interface SpawnOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Permission mode: "yolo" | "edit" | "read" (default: "yolo") */
  mode?: SpawnMode;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
  /** MCP servers passed at spawn time */
  mcpServers?: McpSpawnConfig;
  /** Launch the agent in interactive (TUI) mode with inherited stdio */
  interactive?: boolean;
}
```

#### SpawnResult

```typescript
interface SpawnResult {
  /** Standard output from the CLI */
  stdout: string;
  /** Standard error from the CLI */
  stderr: string;
  /** Exit code from the CLI process */
  exitCode: number;
  /** Thread identifier from streaming agents (if available) */
  threadId?: string;
  /** Backward-compatible alias for threadId */
  sessionId?: string;
}
```

#### GenerateOptions / MediaGenerateOptions

```typescript
interface GenerateOptions {
  /** Model identifier override */
  model?: string;
  /** Additional parameters passed to the API */
  params?: Record<string, string>;
}

type MediaGenerateOptions = GenerateOptions;
```

#### GenerateResult / MediaGenerateResult

```typescript
interface GenerateResult {
  content: string;
}

interface MediaGenerateResult {
  url: string;
  mimeType?: string;
}
```

#### McpSpawnConfig

```typescript
type McpSpawnConfig = Record<string, McpSpawnServer>;

interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```

---

## Providers

### Claude Code Provider

| Property | Value |
|----------|-------|
| ID | `claude-code` |
| Aliases | `claude` |
| Binary | `claude` |
| Config File | `~/.claude/settings.json` |
| Config Format | JSON |
| Branding | `#C15F3C` |

**Models:**

| Choice Label | Model ID |
|-------------|----------|
| haiku | `anthropic/claude-haiku-4.5` |
| sonnet (default) | `anthropic/claude-sonnet-4.6` |
| opus | `anthropic/claude-opus-4.6` |

**Configuration mutations (configure):**

1. Ensure `~/.claude/` directory exists
2. Deep merge into `~/.claude/settings.json`:
   ```json
   {
     "apiKeyHelper": "echo <apiKey>",
     "env": {
       "ANTHROPIC_BASE_URL": "<poeBaseUrl>"
     },
     "model": "<model-without-namespace>"
   }
   ```

**Unconfigure mutations:**

Prune these keys from `~/.claude/settings.json`:
- `apiKeyHelper`
- `env.ANTHROPIC_BASE_URL`
- `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `env.ANTHROPIC_DEFAULT_SONNET_MODEL`
- `env.ANTHROPIC_DEFAULT_OPUS_MODEL`
- `model`

**Isolated environment:**

| Variable | Type | Description |
|----------|------|-------------|
| `POE_API_KEY` | `poeApiKey` | API key from credentials |
| `ANTHROPIC_BASE_URL` (via cliSettings) | `poeBaseUrl` | Poe API base URL |

CLI settings: `apiKeyHelper: "echo $POE_API_KEY"`

Config not required for isolation (`requiresConfig: false`).

**Post-configure message:**
> If using VSCode - Open the Disable Login Prompt setting and check the box. vscode://settings/claudeCode.disableLoginPrompt

**Spawn configuration:**

| Property | Value |
|----------|-------|
| Prompt flag | `-p` |
| Model flag | `--model` |
| Strip provider prefix | Yes |
| Model transform | Replace `.` with `-` (e.g., `claude-sonnet-4.6` → `claude-sonnet-4-6`) |
| Default args | `--output-format stream-json --verbose` |
| Stdin mode | Omit prompt, add `--input-format text` |
| Interactive args | (empty — defaults only) |
| Resume command | `--resume <threadId>` |

**Permission mode args:**

| Mode | Args |
|------|------|
| `yolo` | `--dangerously-skip-permissions` |
| `edit` | `--permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,Glob,Grep,NotebookEdit` |
| `read` | `--permission-mode plan` |

**MCP args:** JSON format via `--mcp-config`

---

### Codex Provider

| Property | Value |
|----------|-------|
| ID | `codex` |
| Binary | `codex` |
| Config File | `~/.codex/config.toml` |
| Config Format | TOML |
| Branding | Dark: `#D5D9DF`, Light: `#7A7F86` |

**Models:**

| Model ID | Default |
|----------|---------|
| `openai/gpt-5.2-codex` | Yes |
| `openai/gpt-5.2` | |
| `openai/gpt-5.2-chat` | |
| `openai/gpt-5.2-pro` | |
| `openai/gpt-5.1` | |
| `openai/gpt-5.1-codex-mini` | |

**Additional prompts:** Reasoning effort (`low`, `medium`, `high`). Default: `medium`.

**Configuration mutations (configure):**

1. Ensure `~/.codex/` directory exists
2. Backup `~/.codex/config.toml`
3. Merge TOML using Handlebars template with:
   - `apiKey`, `baseUrl`, `model` (stripped namespace), `reasoningEffort`

**Unconfigure mutations:**

Transform `~/.codex/config.toml`:
- Remove `model_provider` if it equals `"poe"`
- Remove `model`, `model_reasoning_effort`, and provider config
- Delete entire file if empty after pruning

**Isolated environment:**

| Variable | Type |
|----------|------|
| `CODEX_HOME` | `isolatedDir` |
| `XDG_CONFIG_HOME` | `isolatedDir` |

Config probe: `config.toml` (isolated file).

**Spawn configuration:**

| Property | Value |
|----------|-------|
| Prompt flag | `exec` (positional subcommand) |
| Model flag | `--model` |
| Strip provider prefix | Yes |
| Default args | `--skip-git-repo-check --json` |
| Stdin mode | Omit prompt, add `-` |
| Interactive args | `-a never` |
| Resume command | `resume -C <cwd> <threadId>` |

**Permission mode args:**

| Mode | Args |
|------|------|
| `yolo` | `-s danger-full-access` |
| `edit` | `-s workspace-write` |
| `read` | `-s read-only` |

**MCP args:** TOML format via `-c` flags with inline table syntax

---

### OpenCode Provider

| Property | Value |
|----------|-------|
| ID | `opencode` |
| Binary | `opencode` |
| Config Files | `~/.config/opencode/config.json`, `~/.local/share/opencode/auth.json` |
| Config Format | JSON |
| Branding | Dark: `#4A4F55`, Light: `#2F3338` |

**Models:**

| Model ID |
|----------|
| `anthropic/claude-opus-4.6` |
| `anthropic/claude-sonnet-4.6` |
| `openai/gpt-5.2` |
| `google/gemini-3-pro` |

Default: `anthropic/claude-sonnet-4.6`

**Configuration mutations (configure):**

1. Ensure `~/.config/opencode/` directory exists
2. Merge into `~/.config/opencode/config.json`:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "model": "poe/<model>",
     "enabled_providers": ["poe"]
   }
   ```
3. Ensure `~/.local/share/opencode/` directory exists
4. Merge into `~/.local/share/opencode/auth.json`:
   ```json
   {
     "poe": {
       "type": "api",
       "key": "<apiKey>"
     }
   }
   ```

**Unconfigure mutations:**

1. Prune `enabled_providers` from config.json
2. Prune `poe` from auth.json

**Isolated environment:**

| Variable | Type | Relative Path |
|----------|------|---------------|
| `XDG_CONFIG_HOME` | `isolatedDir` | `.config` |
| `XDG_DATA_HOME` | `isolatedDir` | `.local/share` |

Config probe: `.config/opencode/config.json`

**Custom spawn:** Uses `poe-code wrap opencode` with `--model poe/<model>` and `run` subcommand.

**Spawn configuration:**

| Property | Value |
|----------|-------|
| Prompt flag | `run` (positional subcommand) |
| Model flag | `--model` |
| Strip provider prefix | No |
| Model transform | Adds `poe/` prefix if not present |
| Default args | `--format json` |
| Interactive prompt flag | `--prompt` |
| Resume command | `<cwd> --session <threadId>` |

**Permission mode args:**

| Mode | Args |
|------|------|
| `yolo` | (empty) |
| `edit` | (empty) |
| `read` | `--agent plan` |

---

### Kimi Provider

| Property | Value |
|----------|-------|
| ID | `kimi` |
| Aliases | `kimi-cli` |
| Binary | `kimi` |
| Config File | `~/.kimi/config.toml` |
| Config Format | TOML |
| Branding | Dark: `#7B68EE`, Light: `#6A5ACD` |

**Models:**

| Model ID | Default |
|----------|---------|
| `novitaai/kimi-k2.5` | Yes |
| `novitaai/kimi-k2-thinking` | |

**Configuration mutations (configure):**

1. Ensure `~/.kimi/` directory exists
2. Merge into TOML `~/.kimi/config.toml`:
   - Prune existing models with `poe/` prefix
   - Set `default_model`, `default_thinking: true`
   - Add model entries with provider, model name, `max_context_size: 256000`
   - Add `providers.poe` with `type: "openai_legacy"`, `base_url`, `api_key`

**Unconfigure mutations:**

Transform `~/.kimi/config.toml`:
- Remove `providers.poe` entry
- Delete `providers` object if empty

**Isolated environment:**

| Variable | Type |
|----------|------|
| `HOME` | `isolatedDir` |

Agent binary: `kimi-cli` (special name to avoid home directory stripping issues)

Config probe: `.kimi/config.toml`

**Custom spawn:** Runs `kimi --quiet -p <prompt> <extraArgs>`.

**Spawn configuration:**

| Property | Value |
|----------|-------|
| Prompt flag | `-p` |
| Strip provider prefix | Yes |
| Default args | `--print --output-format stream-json` |
| Stdin mode | Omit prompt, add `--input-format stream-json` |
| Interactive prompt flag | `-p` |
| Resume command | `--session <threadId> --work-dir <cwd>` |

**Permission mode args:**

| Mode | Args |
|------|------|
| `yolo` | `--yolo` |
| `edit` | (empty) |
| `read` | (empty) |

**MCP args:** JSON format via `--mcp-config`

---

### Provider Architecture

Providers are created declaratively using `createProvider()`. The core principle: **no provider-specific branching in the main codebase**. Each provider is a self-contained file that declares its configuration, mutations, and behavior.

#### Provider Factory

```typescript
import { createProvider } from "./create-provider";

export const provider = createProvider<ConfigureOptions, UnconfigureOptions, SpawnOptions>({
  // Required metadata
  id: "my-agent",
  name: "my-agent",
  label: "My Agent",
  summary: "Description of the agent.",

  // Optional metadata
  aliases: ["alias1", "alias2"],
  disabled: false,
  supportsStdinPrompt: true,
  branding: {
    colors: { dark: "#FFFFFF", light: "#000000" }
  },

  // Interactive prompts for configure command
  configurePrompts: {
    model: {
      label: "Which model?",
      defaultValue: "default-model-id",
      choices: [
        { title: "Model A", value: "provider/model-a" },
        { title: "Model B", value: "provider/model-b" }
      ]
    }
  },

  // Messages shown after successful configure
  postConfigureMessages: ["Remember to restart your editor."],

  // Isolated environment configuration
  isolatedEnv: {
    agentBinary: "my-cli",
    configProbe: { kind: "isolatedFile", relativePath: ".my-agent/config.json" },
    env: {
      MY_HOME: { kind: "isolatedDir" },
      MY_API_KEY: { kind: "poeApiKey" },
      MY_BASE_URL: { kind: "poeBaseUrl" }
    },
    requiresConfig: true,
    cliSettings: {
      values: { apiKeyHelper: "echo $MY_API_KEY" },
      env: { MY_BASE_URL: { kind: "poeBaseUrl" } }
    },
    repairs: []
  },

  // Declarative file mutations
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: "~/.my-agent" }),
      configMutation.merge({
        target: "~/.my-agent/config.json",
        value: (ctx) => ({ apiKey: ctx.apiKey, model: ctx.model })
      })
    ],
    unconfigure: [
      configMutation.prune({
        target: "~/.my-agent/config.json",
        shape: { apiKey: true, model: true }
      })
    ]
  },

  // Optional: Installation steps
  install: {
    id: "my-agent-install",
    summary: "My Agent CLI",
    check: createBinaryExistsCheck("my-cli", "my-agent-binary", "..."),
    steps: [
      { id: "install-step", command: "npm", args: ["install", "-g", "my-agent-cli"] }
    ],
    successMessage: "Installed My Agent CLI."
  },

  // Optional: Health check
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("my-agent", {
        model: context.model,
        expectedOutput: "MY_AGENT_OK"
      })
    );
  },

  // Optional: Custom spawn logic
  spawn(context, options) {
    return context.command.runCommand("my-cli", [
      "--model", options.model,
      options.prompt,
      ...(options.args ?? [])
    ]);
  }
});
```

#### Isolated Environment Variable Types

| Kind | Description |
|------|-------------|
| `isolatedDir` | Maps to a directory under `~/.poe-code/<provider>/` |
| `poeApiKey` | Resolved from stored credentials |
| `poeBaseUrl` | Resolved from environment/defaults |
| String literal | Used as-is |

---

## MCP Server

The `poe-code` MCP server exposes Poe API generation capabilities as MCP tools that any compatible agent can use.

### MCP Tools

#### generate_text

Generate text using any Poe bot.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bot_name` | `string` | Yes | Name of the Poe bot/model to query. |
| `message` | `string` | Yes | Message to send to the bot. |
| `params` | `object` | No | Additional parameters. |

#### generate_image

Generate an image.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Text prompt for image generation. |
| `bot_name` | `string` | No | Bot to use. Default: `google/nano-banana-pro`. |
| `params` | `object` | No | Additional parameters. |

#### generate_video

Generate a video.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Text prompt for video generation. |
| `bot_name` | `string` | No | Bot to use. Default: `google/veo-3.1`. |
| `params` | `object` | No | Additional parameters. |

#### generate_audio

Convert text to audio.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Text to convert to audio. |
| `bot_name` | `string` | No | Bot to use. Default: `elevenlabs/elevenlabs-v3`. |
| `params` | `object` | No | Additional parameters. |

### MCP Output Formats

When serving media (images, video, audio), the MCP server supports multiple output formats:

| Format | Description | Supports |
|--------|-------------|----------|
| `url` | Returns the media URL as text. | All media types |
| `base64` | Returns base64-encoded content as an MCP Image/Audio content block. | Images, Audio (not video) |
| `markdown` | Returns markdown: `![Image](url)` for images, `[filename](url)` for video/audio. | All media types |
| `markdown_instructions` | Returns instructions for the agent to render the media in chat with specific action text. | All media types |

Formats can be combined as a comma-separated fallback chain: `--output-format base64,url` tries base64 first, falls back to URL.

### Agent MCP Configuration

The MCP configuration format varies by agent:

**Standard shape** (Claude Code, Claude Desktop, Kimi):
```json
{
  "poe-code": {
    "command": "poe-code",
    "args": ["mcp", "serve", "--output-format", "url"],
    "env": { "POE_API_KEY": "..." }
  }
}
```

**OpenCode shape:**
```json
{
  "poe-code": {
    "type": "local",
    "command": ["poe-code", "mcp", "serve", "--output-format", "url"],
    "env": { "POE_API_KEY": "..." },
    "enabled": true
  }
}
```

**Codex shape** (TOML):
```toml
[mcp_servers.poe-code]
command = "poe-code"
args = ["mcp", "serve", "--output-format", "url"]
```

---

## Spawn System

### Spawn Modes

| Mode | Description | Claude Code Args | Codex Args | OpenCode Args | Kimi Args |
|------|-------------|-----------------|------------|---------------|-----------|
| `yolo` | Full access, no permission prompts | `--dangerously-skip-permissions` | `-s danger-full-access` | (none) | `--yolo` |
| `edit` | Can edit files, restricted commands | `--permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,Glob,Grep,NotebookEdit` | `-s workspace-write` | (none) | (none) |
| `read` | Read-only, no modifications | `--permission-mode plan` | `-s read-only` | `--agent plan` | (none) |

### Streaming (ACP Events)

Agents that support streaming return ACP (Agent Communication Protocol) events. These events provide real-time progress information:

```typescript
const { events, result } = spawn("claude-code", "Fix the bug");

for await (const event of events) {
  // Events include: progress updates, token generation,
  // tool use notifications, file modifications, etc.
  console.log(event);
}

const final = await result;
```

**Streaming support by agent:**

| Agent | Streaming | Output Format |
|-------|-----------|---------------|
| Claude Code | Yes | `stream-json` |
| Codex | Yes | `json` |
| OpenCode | Yes | `json` |
| Kimi | Yes | `stream-json` |

Use `renderAcpStream()` from `@poe-code/agent-spawn` for pretty-printed terminal output, or `spawn.pretty()` from the SDK.

### MCP at Spawn Time

Inject MCP servers into an agent session at spawn time. This allows agents to use additional tools during a session.

**CLI:**
```bash
poe-code spawn claude-code "Use the database tool" \
  --mcp-config '{"db": {"command": "/usr/local/bin/db-server", "args": ["--port", "5432"]}}'
```

**SDK:**
```typescript
const { result } = spawn("claude-code", {
  prompt: "Query the database for user stats",
  mcpServers: {
    "db": {
      command: "/usr/local/bin/db-server",
      args: ["--port", "5432"],
      env: { "DB_HOST": "localhost" }
    }
  }
});
```

**MCP serialization per agent:**

| Agent | Format | Flag |
|-------|--------|------|
| Claude Code | JSON: `--mcp-config '{"mcpServers": {...}}'` | `--mcp-config` |
| Codex | TOML inline tables via `-c` flags | `-c mcp_servers.name.command="..."` |
| Kimi | JSON: `--mcp-config '{"mcpServers": {...}}'` | `--mcp-config` |
| OpenCode | Not supported at spawn time | N/A |

### Interactive Mode

Launch the agent in TUI (Text User Interface) mode with inherited stdio:

```bash
poe-code spawn claude-code -i
poe-code spawn claude-code --interactive
```

```typescript
const { result } = spawn("claude-code", {
  prompt: "Let's work on this together",
  interactive: true
});
```

In interactive mode:
- stdio is inherited (agent gets direct terminal access)
- No ACP event stream (events iterable is empty)
- Agent runs its own UI

### Stdin Prompt

Read the prompt from stdin instead of a command-line argument:

```bash
# Via --stdin flag
echo "Fix the bug" | poe-code spawn codex --stdin

# Via '-' argument
echo "Fix the bug" | poe-code spawn codex -

# Via pipe detection (automatic)
cat prompt.txt | poe-code spawn claude-code
```

**Stdin mode differences per agent:**

| Agent | Stdin Behavior |
|-------|---------------|
| Claude Code | Omits `-p` flag, adds `--input-format text` |
| Codex | Omits `exec` subcommand, adds `-` |
| Kimi | Omits `-p` flag, adds `--input-format stream-json` |

### Resume Sessions

After a spawn completes, if the agent returns a thread ID, a resume command is displayed:

```
To resume this session:
  poe-code spawn claude-code -- --resume abc123
```

**Resume command format per agent:**

| Agent | Resume Args |
|-------|-------------|
| Claude Code | `--resume <threadId>` |
| Codex | `resume -C <cwd> <threadId>` |
| OpenCode | `<cwd> --session <threadId>` |
| Kimi | `--session <threadId> --work-dir <cwd>` |

### Spawn Configurations per Agent

Complete spawn configuration for each agent:

#### Claude Code Spawn Config

```
Binary: claude
Prompt: -p <prompt>
Model: --model <model> (provider prefix stripped, dots replaced with dashes)
Default args: --output-format stream-json --verbose
Modes:
  yolo: --dangerously-skip-permissions
  edit: --permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,Glob,Grep,NotebookEdit
  read: --permission-mode plan
MCP: --mcp-config <JSON>
Stdin: omit prompt flag, add --input-format text
Interactive: (no extra args)
Resume: --resume <threadId>
```

#### Codex Spawn Config

```
Binary: codex
Prompt: exec <prompt>
Model: --model <model> (provider prefix stripped)
Default args: --skip-git-repo-check --json
Modes:
  yolo: -s danger-full-access
  edit: -s workspace-write
  read: -s read-only
MCP: -c mcp_servers.<name>.command="..." -c mcp_servers.<name>.args=[...]
Stdin: omit prompt, add -
Interactive: -a never
Resume: resume -C <cwd> <threadId>
```

#### OpenCode Spawn Config

```
Binary: opencode
Prompt: run <prompt>
Model: --model <model> (poe/ prefix added if not present, no stripping)
Default args: --format json
Modes:
  yolo: (none)
  edit: (none)
  read: --agent plan
MCP: not supported at spawn time
Stdin: not supported
Interactive prompt flag: --prompt
Resume: <cwd> --session <threadId>
```

#### Kimi Spawn Config

```
Binary: kimi
Prompt: -p <prompt>
Model: (provider prefix stripped)
Default args: --print --output-format stream-json
Modes:
  yolo: --yolo
  edit: (none)
  read: (none)
MCP: --mcp-config <JSON>
Stdin: omit prompt flag, add --input-format stream-json
Interactive prompt flag: -p
Resume: --session <threadId> --work-dir <cwd>
```

---

## Configuration System

### Credentials Storage

**Location:** `~/.poe-code/credentials.json`

**Format:**
```json
{
  "apiKey": "pb-xxx",
  "services": {
    "claude-code": {
      "files": ["~/.claude/settings.json"]
    },
    "codex": {
      "files": ["~/.codex/config.toml"]
    }
  }
}
```

**Resolution priority:**
1. `POE_API_KEY` environment variable
2. `~/.poe-code/credentials.json` file

### Provider Config Files

| Provider | File(s) | Format |
|----------|---------|--------|
| Claude Code | `~/.claude/settings.json` | JSON |
| Codex | `~/.codex/config.toml` | TOML |
| OpenCode | `~/.config/opencode/config.json` + `~/.local/share/opencode/auth.json` | JSON |
| Kimi | `~/.kimi/config.toml` | TOML |

### Isolated Environments

Isolated environments sandbox agent configuration to `~/.poe-code/<agent>/` to avoid conflicts with global configuration.

**Base directory:** `~/.poe-code/<agent-name>/`

**How it works:**
1. Home directory paths are remapped to isolated directories
2. Environment variables override the agent's config/data paths
3. The agent binary runs with these overridden environment variables
4. Configuration probe files are checked to verify setup

**Variable kinds:**

| Kind | Description | Example |
|------|-------------|---------|
| `isolatedDir` | Directory under isolated base, optionally with relative path | `CODEX_HOME` → `~/.poe-code/codex/` |
| `poeApiKey` | API key from credentials | `POE_API_KEY` → `pb-xxx` |
| `poeBaseUrl` | Poe API base URL | `ANTHROPIC_BASE_URL` → `https://api.poe.com/v1` |

**CLI settings injection:** Some agents support a `--settings` flag or equivalent for runtime configuration. The isolated env system can inject settings like `apiKeyHelper` and environment variables.

### Mutation System

Providers use a declarative mutation system from `@poe-code/config-mutations` for safe file modifications:

#### File Mutations

```typescript
// Create a directory
fileMutation.ensureDirectory({ path: "~/.config/app" })

// Backup a file before modifying
fileMutation.backup({ target: "~/.config/app/config.json" })
```

#### Config Mutations

```typescript
// Deep merge into a JSON/TOML file
configMutation.merge({
  target: "~/.config/app/config.json",
  value: (ctx) => ({
    apiKey: ctx.apiKey,
    model: ctx.model
  })
})

// Custom transformation
configMutation.transform({
  target: "~/.config/app/config.json",
  transform: (doc) => ({
    changed: true,
    content: { ...doc, modified: true }
  })
})

// Remove specific keys
configMutation.prune({
  target: "~/.config/app/config.json",
  shape: { apiKey: true, password: true }
})
```

#### Template Mutations

```typescript
// Merge using Handlebars template
templateMutation.mergeToml({
  target: "~/.codex/config.toml",
  templateId: "codex/config.toml.hbs",
  context: (ctx) => ({
    apiKey: ctx.apiKey,
    baseUrl: ctx.baseUrl,
    model: ctx.model
  })
})
```

### Dry Run

The `--dry-run` flag records all mutations without applying them and displays unified diffs:

```bash
poe-code configure claude --model opus --dry-run
```

Output shows:
- Files that would be created/modified
- Unified diff of changes
- Sensitive values are redacted (API keys, tokens)

**Redacted keys:**
- JSON: `apiKey`, `api_key`, `apiKeyHelper`
- Auth files: `key`
- TOML: `experimental_bearer_token`

---

## Models and Constants

### Default Models

| Constant | Value | Used By |
|----------|-------|---------|
| `DEFAULT_TEXT_MODEL` | `anthropic/claude-sonnet-4.6` | `generate text` |
| `DEFAULT_IMAGE_BOT` | `google/nano-banana-pro` | `generate image` |
| `DEFAULT_VIDEO_BOT` | `google/veo-3.1` | `generate video` |
| `DEFAULT_AUDIO_BOT` | `elevenlabs/elevenlabs-v3` | `generate audio` |
| `DEFAULT_FRONTIER_MODEL` | `anthropic/claude-sonnet-4.6` | OpenCode default |
| `DEFAULT_CLAUDE_CODE_MODEL` | `anthropic/claude-sonnet-4.6` | Claude Code default |
| `DEFAULT_CODEX_MODEL` | `openai/gpt-5.2-codex` | Codex default |
| `DEFAULT_KIMI_MODEL` | `novitaai/kimi-k2.5` | Kimi default |
| `DEFAULT_REASONING` | `medium` | Codex reasoning effort |
| `PROVIDER_NAME` | `poe` | Provider identifier in configs |

### Frontier Models

```typescript
const FRONTIER_MODELS = [
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.2",
  "google/gemini-3-pro"
];
```

### Claude Code Variants

```typescript
const CLAUDE_CODE_VARIANTS = {
  haiku: "anthropic/claude-haiku-4.5",
  sonnet: "anthropic/claude-sonnet-4.6",
  opus: "anthropic/claude-opus-4.6"
};
```

### Codex Models

```typescript
const CODEX_MODELS = [
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2-pro",
  "openai/gpt-5.1",
  "openai/gpt-5.1-codex-mini"
];
```

### Kimi Models

```typescript
const KIMI_MODELS = [
  "novitaai/kimi-k2.5",
  "novitaai/kimi-k2-thinking"
];
```

### Model Namespace Stripping

Model IDs are namespaced (e.g., `anthropic/claude-sonnet-4.6`). The `stripModelNamespace()` function removes the provider prefix:

```typescript
stripModelNamespace("anthropic/claude-sonnet-4.6") // → "claude-sonnet-4.6"
stripModelNamespace("openai/gpt-5.2")              // → "gpt-5.2"
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POE_API_KEY` | — | Poe API key. Highest priority credential source. |
| `POE_BASE_URL` | `https://api.poe.com/v1` | Poe API base URL. Used for provider configuration. |
| `POE_API_BASE_URL` | `https://api.poe.com/v1` | Poe API base URL. Used by SDK generate functions. |
| `POE_TEXT_MODEL` | `anthropic/claude-sonnet-4.6` | Override default text generation model. |
| `POE_IMAGE_MODEL` | `google/nano-banana-pro` | Override default image generation model. |
| `POE_VIDEO_MODEL` | `google/veo-3.1` | Override default video generation model. |
| `POE_AUDIO_MODEL` | `elevenlabs/elevenlabs-v3` | Override default audio generation model. |
| `POE_CODE_STDERR_LOGS` | — | Set to `1` or `true` to enable stderr logging for bootstrap errors. |
| `POE_SNAPSHOT_MODE` | `playback` | Testing: `record` to record LLM responses, `playback` to replay. |
| `POE_SNAPSHOT_MISS` | `error` | Testing: behavior on missing snapshot: `error`, `warn`, `passthrough`. |

---

## Research Command Details

The `research` command is a specialized spawn that defaults to `read` mode. Key differences from `spawn`:

1. **Default mode is `read`** (spawn defaults to `yolo`)
2. **Supports `--github <repo>`** for cloning and researching remote repos
3. **Supports `--path <path>`** for specifying a local directory
4. **`--keep` flag** to retain cloned repos
5. **Agent is specified via `--agent`** option (not positional argument)

**Workflow for GitHub research:**
1. Clones the repository to a temporary directory
2. Spawns the agent with the cloned repo as working directory
3. Unless `--keep` is set, removes the cloned repo after completion

---

## Ralph Build System

Ralph is a build loop that automates iterative development using AI agents and a YAML plan file.

### Plan File Format

Plan files are YAML files in `.agents/poe-code-ralph/plans/`:

```yaml
name: Feature Name
stories:
  - id: story-1
    title: Implement user login
    status: open        # open | in_progress | done
    description: |
      Detailed description of what needs to be done.
    acceptance_criteria:
      - Users can log in with email/password
      - Invalid credentials show error message
  - id: story-2
    title: Add unit tests
    status: open
    depends_on: [story-1]
```

### Build Loop

The `ralph build` command:

1. Reads the plan YAML
2. Counts open/in-progress stories
3. Auto-calculates iterations: `max(open*2, open+10)` if not specified
4. For each iteration:
   - Picks the next story to work on
   - Spawns the agent with the story as the prompt
   - Tracks progress and failures
5. Reports summary: iterations completed, stories done, duration

### Worktree Support

Run Ralph in an isolated git worktree to avoid interfering with your main branch:

```bash
poe-code ralph build --plan plan.yaml --worktree --worktree-name feature-x
```

### Ralph Templates

Installed via `ralph install`:
- Prompt templates in `.agents/poe-code-ralph/`
- State files in `.poe-code-ralph/`
- `/plan` skill for agents

---

## Skill System

Skills are agent-specific prompt templates/directories that extend agent capabilities.

### Scope

| Scope | Location | Flag |
|-------|----------|------|
| Global | `~/.poe-code/<agent>/skills/` (varies by agent) | `--global` |
| Local | `./<agent-skill-dir>/` (project directory) | `--local` |

### Workflow

```bash
# Install skills for Claude Code globally
poe-code skill configure claude-code --global

# Install skills locally for the current project
poe-code skill configure claude-code --local

# Remove skills
poe-code skill unconfigure claude-code --global --force
```

---

## Binary Wrappers

`poe-code` provides convenience binaries for common agent patterns:

| Binary | Purpose |
|--------|---------|
| `poe-code` | Main CLI |
| `poe-code-configure` | Alias for `poe-code configure` |
| `poe-claude` | Convenience wrapper for Claude Code |
| `poe-codex` | Convenience wrapper for Codex |
| `poe-opencode` | Convenience wrapper for OpenCode |

---

## LLM Client Internals

The Poe API client uses the OpenAI-compatible chat completions format:

### Request Format

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "anthropic/claude-sonnet-4.6",
  "messages": [
    { "role": "user", "content": "Your prompt here" }
  ],
  "extra_body": {
    "temperature": "0.7"
  }
}
```

### Response Parsing

**Text responses:** Extracts `choices[0].message.content`

**Media responses:** Tries multiple extraction strategies in order:
1. Parse content as JSON with `{ url, mimeType, data }` fields
2. Treat content as a raw URL
3. Extract URL from markdown format `![alt](url)`

### Error Handling

API errors throw `ApiError` with:
- `httpStatus`: HTTP status code
- `endpoint`: The API endpoint that failed
- `context.responseBody`: Error response body (if available)

---

## Error Handling

### Error Types

| Error | Description |
|-------|-------------|
| `ApiError` | HTTP error from the Poe API. Contains `httpStatus`, `endpoint`, and optional `context`. |
| Credential errors | Thrown when no API key is found. Message: `"No API key found. Set POE_API_KEY or run 'poe-code login'."` |
| Spawn errors | Non-zero exit codes from agent processes. |
| Validation errors | Invalid MCP config, missing required arguments, etc. |

### Exit Codes

The CLI forwards the agent's exit code. A non-zero exit code from a spawned agent results in a non-zero exit from `poe-code`.

---

## Project Structure

```
poe-setup-scripts/
├── src/
│   ├── index.ts                    # Entry point: SDK exports + CLI bootstrap
│   ├── cli/
│   │   ├── program.ts              # Command registration, help formatting
│   │   ├── bootstrap.ts            # CLI initialization, error handling
│   │   ├── container.ts            # Dependency injection container
│   │   ├── environment.ts          # Environment configuration
│   │   ├── constants.ts            # Model IDs, defaults, provider name
│   │   ├── service-registry.ts     # Provider resolution and management
│   │   ├── context.ts              # Command execution context
│   │   ├── logger.ts               # Logging infrastructure
│   │   ├── mcp-server.ts           # MCP server tools implementation
│   │   ├── mcp-output-format.ts    # MCP output format types
│   │   ├── isolated-env.ts         # Isolated environment management
│   │   ├── errors.ts               # Error types (ApiError, etc.)
│   │   ├── http.ts                 # HTTP client types
│   │   └── commands/               # CLI command implementations
│   │       ├── configure.ts
│   │       ├── unconfigure.ts
│   │       ├── spawn.ts
│   │       ├── research.ts
│   │       ├── wrap.ts
│   │       ├── test.ts
│   │       ├── install.ts
│   │       ├── generate.ts
│   │       ├── login.ts
│   │       ├── logout.ts
│   │       ├── mcp.ts
│   │       ├── skill.ts
│   │       ├── ralph.ts
│   │       ├── usage.ts
│   │       ├── models.ts
│   │       ├── version.ts
│   │       └── shared.ts           # Shared command utilities
│   ├── providers/
│   │   ├── create-provider.ts      # Provider factory
│   │   ├── spawn-options.ts        # Spawn option types
│   │   ├── claude-code.ts          # Claude Code provider
│   │   ├── codex.ts                # Codex provider
│   │   ├── opencode.ts             # OpenCode provider
│   │   └── kimi.ts                 # Kimi provider
│   ├── sdk/
│   │   ├── spawn.ts                # SDK spawn (streaming + pretty)
│   │   ├── spawn-core.ts           # Core spawn logic
│   │   ├── generate.ts             # Text/image/video/audio generation
│   │   ├── credentials.ts          # API key resolution
│   │   ├── container.ts            # SDK dependency container
│   │   └── types.ts                # Public SDK types
│   ├── services/
│   │   ├── llm-client.ts           # Poe API client
│   │   ├── client-instance.ts      # Global client singleton
│   │   ├── credentials.ts          # Credential file management
│   │   ├── service-install.ts      # Binary installation
│   │   └── model-strategy.ts       # Model resolution strategy
│   ├── utils/
│   │   ├── dry-run.ts              # Dry-run recording and display
│   │   ├── command-checks.ts       # Health check infrastructure
│   │   ├── cli-settings-merge.ts   # Agent CLI settings injection
│   │   └── execution-context.ts    # Execution context utilities
│   └── templates/                  # Handlebars templates for configs
├── packages/
│   ├── agent-defs/                 # Agent definitions and metadata
│   ├── agent-spawn/                # Agent spawning and streaming
│   ├── agent-mcp-config/           # MCP configuration per agent
│   ├── agent-skill-config/         # Skill configuration
│   ├── config-mutations/           # Declarative file mutation DSL
│   ├── design-system/              # CLI UI components and themes
│   ├── ralph/                      # Ralph build loop implementation
│   ├── worktree/                   # Git worktree utilities
│   ├── tiny-stdio-mcp-server/      # MCP server framework
│   ├── tiny-stdio-mcp-test-server/ # MCP test server
│   ├── tokenfill/                  # Token filling utilities
│   ├── cached-resource/            # Resource caching
│   ├── e2e-docker-test-runner/     # Docker-based E2E test framework
│   └── freeze-cli/                 # CLI packaging
├── e2e/                            # End-to-end tests
├── tests/                          # Unit/integration tests
├── docs/                           # Documentation
├── scripts/                        # Build and utility scripts
└── .github/workflows/              # CI/CD workflows
```

---

## Appendix: Complete API Surface

### CLI Commands Summary

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `configure [agent]` | — | Configure agent for Poe API |
| `unconfigure <agent>` | — | Remove Poe configuration |
| `login` | — | Store API key |
| `logout` | — | Remove all config + credentials |
| `spawn <agent> [prompt]` | — | Run agent with prompt |
| `research [prompt]` | — | Research codebase (read mode) |
| `wrap <agent>` | — | One-off isolated session |
| `test [agent]` | — | Health check |
| `install [agent]` | — | Install agent binary |
| `generate` | `text`, `image`, `video`, `audio` | Generate content |
| `usage` | `balance`, `list` | Check usage/billing |
| `models` | — | List available models |
| `mcp` | `serve`, `configure`, `unconfigure` | MCP server management |
| `skill` | `configure`, `unconfigure` | Agent skill management |
| `ralph` | `build`, `install`, `agent log`, `agent validate-plan`, `worktree merge` | Build loop system |

### SDK Exports Summary

```typescript
// Functions
export { spawn } from "poe-code";          // spawn() and spawn.pretty()
export { generate } from "poe-code";        // Text generation
export { generateImage } from "poe-code";   // Image generation
export { generateVideo } from "poe-code";   // Video generation
export { generateAudio } from "poe-code";   // Audio generation
export { getPoeApiKey } from "poe-code";    // API key resolution

// Types
export type { SpawnOptions } from "poe-code";
export type { SpawnResult } from "poe-code";
export type { GenerateOptions } from "poe-code";
export type { GenerateResult } from "poe-code";
export type { MediaGenerateOptions } from "poe-code";
export type { MediaGenerateResult } from "poe-code";

// CLI (for programmatic CLI invocation)
export { main, isCliInvocation } from "poe-code";
```

### Supported Agents Summary

| Agent | ID | Aliases | Binary | Config Format | Stdin | MCP Spawn | Interactive | Resume |
|-------|-----|---------|--------|--------------|-------|-----------|-------------|--------|
| Claude Code | `claude-code` | `claude` | `claude` | JSON | Yes | Yes | Yes | Yes |
| Codex | `codex` | — | `codex` | TOML | Yes | Yes | Yes | Yes |
| OpenCode | `opencode` | — | `opencode` | JSON | No | No | Yes | Yes |
| Kimi | `kimi` | `kimi-cli` | `kimi` | TOML | Yes | Yes | Yes | Yes |
