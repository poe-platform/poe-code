# Poe Code - Complete Reference

> **Audience**: AI agents and developers who need to understand and use every feature of the `poe-code` library — CLI, SDK, providers, and internals.

`poe-code` is a CLI tool and Node.js SDK that configures coding agents (Claude Code, Codex, OpenCode, Kimi, Goose) to route their API calls through the [Poe API](https://poe.com/api). Instead of managing multiple provider accounts, a single Poe subscription powers all your coding agents.

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
  - [auth](#auth)
  - [provider](#provider)
  - [approvals](#approvals)
  - [spawn](#spawn)
  - [code-review](#code-review)
  - [research](#research)
  - [wrap](#wrap)
  - [test](#test)
  - [install](#install)
  - [usage](#usage)
  - [models](#models)
  - [skill](#skill)
  - [pipeline](#pipeline)
  - [memory](#memory)
- [SDK Reference](#sdk-reference)
  - [spawn()](#spawn-sdk)
  - [spawn.pretty()](#spawnpretty)
  - [Composable agent runtime](#composable-agent-runtime)
  - [getPoeApiKey()](#getpoeapikey)
  - [getPoeAuthIdentity()](#getpoeauthidentity)
  - [Types](#sdk-types)
- [Providers](#providers)
  - [Claude Code](#claude-code-provider)
  - [Codex](#codex-provider)
  - [OpenCode](#opencode-provider)
  - [Kimi](#kimi-provider)
  - [Goose](#goose-provider)
  - [Provider Architecture](#provider-architecture)
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

**Requirements**: Node.js >= 20, npm >= 10

---

## Quick Start

### One-off session (no config changes)

```bash
# Wrap any agent to route through Poe for a single session
npx poe-code@latest wrap claude
npx poe-code@latest wrap codex
npx poe-code@latest wrap opencode
npx poe-code@latest wrap kimi
npx poe-code@latest wrap goose
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

Boolean flags also accept explicit values (`--flag true` / `--flag false`) in addition to `--flag` / `--no-flag`.

---

### configure

Configure a coding agent to route API calls through the selected provider.

```bash
poe-code configure [agent]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | No | Agent to configure: `claude`, `claude-code`, `codex`, `opencode`, `kimi`, `goose`. Prompts if omitted, unless `core.defaultAgent` / `POE_DEFAULT_AGENT` is set. |

**Options:**

| Option | Description |
|--------|-------------|
| `--api-key <key>` | API key for the selected provider. Also reads `POE_API_KEY` for Poe provider flows. |
| `--model <model>` | Model identifier (e.g., `sonnet`, `opus`, `openai/gpt-5.2`). Prompts from agent-specific choices if omitted. |
| `--reasoning-effort <level>` | Reasoning effort level for agents that support it (Codex). Values: `low`, `medium`, `high`. Default: `medium`. |
| `--provider <id>` | Provider ID to use for this agent (e.g., `poe`, `anthropic`). Overrides `POE_CODE_PROVIDER`. |

**Behavior:**

1. Resolves the agent (explicit arg > `core.defaultAgent` / `POE_DEFAULT_AGENT` > `--yes` fallback > prompt)
2. Resolves the provider (`--provider` → `POE_CODE_PROVIDER` → logged-in provider selection/prompt)
3. Ensures the selected provider is logged in; if not, runs that provider's login flow using `--api-key`, the provider env var, or an interactive secret prompt
4. Collects agent-specific options (model, reasoning effort) via prompts or flags
5. Applies file mutations to the agent's config files (merge, not overwrite)
6. Sets up isolated environment if the agent supports it
7. Saves service metadata to `~/.poe-code/credentials.json`
8. Displays post-configure messages (e.g., VSCode settings for Claude Code)

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

### auth

Inspect and manage Poe account authentication.

```bash
poe-code auth [subcommand]
```

Running `poe-code auth` with no subcommand is the same as `poe-code auth status`.

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `status` | Show whether a stored Poe credential is valid and print the account name/handle. Honors `--dry-run` by skipping the `/whoami` request. |
| `api-key` | Print the stored Poe API key only. Exits with code `1` when no key is stored. |
| `whoami` | Call Poe `/whoami` and print the raw identity JSON to stdout. Resolves `POE_API_KEY` first, then the stored credential. Exits with code `1` when no key is available. |
| `login` | Store a Poe API key for reuse across commands. Same behavior as top-level `poe-code login`. |
| `logout` | Remove all configuration and credentials. Same behavior as top-level `poe-code logout`. |

**Examples:**

```bash
poe-code auth status
poe-code auth whoami | jq .handle
POE_API_KEY=pb-xxx poe-code auth whoami
poe-code auth api-key
```

---

### provider

Manage auth providers for coding agents.

```bash
poe-code provider <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `list` | Show available providers, login status, and supported agents. A non-empty provider env var, such as `POE_API_KEY` for the Poe provider, counts as logged in. |
| `login <id>` | Store provider credentials. Uses `--api-key`, then that provider's env var, then an interactive secret prompt. |
| `logout <id>` | Remove stored credentials for that provider. An exported provider env var can still make the provider appear logged in. |

**Examples:**

```bash
poe-code provider list
poe-code provider login poe
POE_API_KEY=pb-xxx poe-code provider login poe --yes
poe-code provider login anthropic --api-key sk-ant-xxx
poe-code provider logout anthropic
```

---

### approvals

Inspect and execute Toolcraft human-in-loop approval tasks queued by CLI, SDK, or MCP runs.

```bash
poe-code approvals <subcommand>
```

`poe-code approvals` is a forwarded Toolcraft command. Poe Code wires it to a repo-local YAML task list at `.poe-code/approvals.yaml`, so asynchronous approvals can be reviewed and executed from the project where they were created.

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `list [--state <state>]` | List queued approval tasks, optionally filtered by state. |
| `show --approval-id <id>` | Show one queued approval task. |
| `run --approval-id <id>` | Ask the configured approval provider, then execute one pending queued task when approved. |

**Examples:**

```bash
poe-code approvals list
poe-code approvals show --approval-id task_123
poe-code approvals run --approval-id task_123
```

---

### spawn

Launch a single agent session with a prompt. Returns structured output.

```bash
poe-code spawn <agent> [prompt] [agentArgs...]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `agent` | Yes | Agent to spawn: `claude-code`, `codex`, `opencode`, `kimi`, `goose` |
| `prompt` | No | Prompt text. Use `-` to read from stdin, or `@path/to/file` to load prompt text from a file. |
| `agentArgs` | No | Additional arguments forwarded directly to the agent CLI. |

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--model <model>` | Agent default | Model identifier override. |
| `-C, --cwd <path>` | Current dir | Working directory for the agent. |
| `--stdin` | `false` | Read the prompt from stdin. |
| `-i, --interactive` | `false` | Launch in interactive TUI mode (inherits stdio). |
| `--mode <mode>` | `yolo` | Permission mode: `yolo` (full access), `edit` (file edits only), `read` (read-only). |
| `--mcp-servers <json\|@file>` | None | MCP servers to inject at spawn time. Accepts inline JSON or `@path/to/file.json`. Supports `command`, optional `args`, `env`, and `timeout` (seconds). Deprecated alias: `--mcp-config`. |

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

# Load prompt from a file
poe-code spawn codex @./prompt.txt

# Interactive TUI mode
poe-code spawn claude-code -i

# With MCP servers injected at spawn time (inline JSON)
poe-code spawn claude-code "Use the filesystem tool" \
  --mcp-servers '{"fs": {"command": "/usr/local/bin/fs-server"}}'

# With MCP servers loaded from a JSON file
poe-code spawn claude-code "Use the filesystem tool" --mcp-servers @./mcp.json

# Specify working directory
poe-code spawn codex "Fix tests" -C /path/to/project

# Forward extra args to agent CLI
poe-code spawn claude-code "Hello" -- --max-tokens 1000

# In CI with full automation
poe-code spawn codex "Run lint and fix issues" --mode yolo --yes
```

---

### code-review

Run agent-assisted GitHub pull request reviews.

```bash
poe-code code-review <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `install` | Install repo-local reviewer profiles and prompts. |
| `profiles` | List repo-local reviewer profiles. |
| `ingest <github-username>` | Build a runtime reviewer profile from GitHub review history. |
| `run <github-pr-url>` | Fetch a PR, run reviewer agents, and create a YAML draft. |
| `drafts <github-pr-url>` | Read the active YAML draft for a PR. |
| `commit <github-pr-url>` | Validate and publish the merged draft to GitHub; use `--dry-run` to preview. |
| `agent-mcp` | Run the stdio MCP server used by spawned review agents. |

**Examples:**

```bash
poe-code code-review install
poe-code code-review run "https://github.com/owner/repo/pull/123"
poe-code code-review commit "https://github.com/owner/repo/pull/123" --dry-run
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
| Goose | `GOOSE_OK` |

**Examples:**

```bash
poe-code test claude-code
poe-code test codex --isolated
poe-code test opencode --model anthropic/claude-sonnet-4.6
poe-code test goose
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
| Goose | `brew install block-goose-cli` (macOS) or `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \| CONFIGURE=false bash` |

**Examples:**

```bash
poe-code install claude-code
poe-code install codex
poe-code install opencode
poe-code install kimi
poe-code install goose
```

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
| `--model <name>` | Filter by model ID (exact match, case-insensitive). |
| `--search <term>` | Search model ID and provider name (substring match). |
| `--feature <name>` | Filter by feature: `tools`, `web_search`, `reasoning` (exact match). |
| `--endpoint <path>` | Filter by supported endpoint, for example `/v1/responses` or `/v1/chat/completions`. |
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

# Search by provider or model id
poe-code models --search claude

# Models that support the Responses API
poe-code models --endpoint /v1/responses

# Models that support Chat Completions
poe-code models --endpoint /v1/chat/completions

# Models with tool support added in last 2 weeks
poe-code models --tools --since 2w

# Image generation models with pricing
poe-code models --output image --view pricing

# Reasoning models
poe-code models --feature reasoning

# Models that accept image input
poe-code models --input image

# Parameters for one exact model
poe-code models --model claude-opus-4.7 --view parameters

# Raw YAML output for scripting
poe-code models --provider openai --view raw
```

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

### pipeline

Run and manage fixed-step pipeline plans.

#### `pipeline run`

Run one or more pipeline plans until completion, failure, cancellation, or max runs.

```bash
poe-code pipeline run [--plan <path> | --plans <paths...>]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agent <name>` | Agent for pipeline steps. Resolution order: explicit flag → `core.defaultAgent` / `POE_DEFAULT_AGENT` → `--yes` fallback (`claude-code`) → prompt. |
| `--model <model>` | Model override passed to the selected agent. |
| `--tui` / `--no-tui` | Enable or disable the live pipeline dashboard for this run. |
| `--task <id>` | Run only a single task ID from the plan. |
| `--plan <path>` | Run one pipeline plan file. |
| `--plans <paths...>` | Run multiple plan files sequentially. |
| `--max-runs <n>` | Stop after `n` agent executions. |

#### `pipeline init`

Add or update pipeline frontmatter in source markdown documents.

```bash
poe-code pipeline init [question] [--source <path> | --sources <paths...>]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--agent <name>` | Agent used to generate plans. |
| `--model <model>` | Model override passed to that agent. |
| `--source <path>` | Convert one source markdown file. |
| `--sources <paths...>` | Convert multiple source markdown files. |

**Behavior notes:**

- `pipeline init` edits the selected source markdown file in place (it does not create a separate plan file).
- If `question` is omitted, the source document content is treated as the user request.
- Without `--source` / `--sources`, interactive mode discovers markdown sources and prompts for selection.
- Sources that already contain `kind: pipeline` frontmatter are skipped during discovery.

#### `pipeline validate`

Validate plan markdown without executing it.

```bash
poe-code pipeline validate <file> [--preview]
```

#### `pipeline plan-path`

Print the resolved directory where pipeline plans should be placed.

```bash
poe-code pipeline plan-path
```

#### `pipeline install`

Install the `/plan` pipeline skill and scaffold pipeline files.

```bash
poe-code pipeline install [--agent <name>] [--local | --global] [--force]
```

**Additional behavior notes (`pipeline run`):**

- Plan directory resolution is `plan.plan_directory` by default, and `.poe-code/pipeline/config.yaml` `plan_directory` overrides it when set.
- Unresolved prompt variables fail the run before step execution.

---

### memory

Manage repo-scoped persistent memory under `.poe-code/memory/`.

```bash
poe-code memory <subcommand>
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `init` | Create `.poe-code/memory/` with `INDEX.md`, `LOG.md`, and `pages/`. |
| `ls` | List memory pages with one-line descriptions. |
| `show <path>` | Print a memory page (path relative to `pages/`). |
| `search <query>` | Search memory files for a substring. |
| `status [--no-tokens]` | Show counts/size and optional token stats. |
| `clear` | Delete all memory content and reinitialize `INDEX.md`/`LOG.md`. |

**Behavior notes:**

- Most subcommands require `memory init` first.
- `memory clear` prompts for confirmation unless `--yes` is set.

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

### Composable agent runtime

The `poe-code/agent` subpath exposes the plugin-first agent builder and focused
runtime types for SDK users that want to compose providers, tools, MCP servers,
and hooks directly instead of spawning an external agent CLI.

```typescript
import { agent, openaiResponsesPlugin, systemPromptPlugin } from "poe-code/agent";

const result = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });

console.log(result.output);
```

The builder supports `.model(...)`, `.use(...)`, `.tools(...)`, `.mcp(...)`,
`.acp(...)`, `.run(...)`, and `.stream(...)`. The subpath also exports
`openaiChatCompletionsPlugin`, `openaiResponsesPlugin`, and
`systemPromptPlugin`.

### getPoeApiKey()

Read the stored Poe API key.

```typescript
import { getPoeApiKey } from "poe-code";

const apiKey = await getPoeApiKey();
```

**Resolution order:**

1. `POE_API_KEY` environment variable
2. `~/.poe-code/credentials.enc` file

**Throws** `Error` if no credentials found. Error message: `"No API key found. Set POE_API_KEY or run 'poe-code login'."`

### getPoeAuthIdentity()

Fetch the authenticated Poe account identity using the resolved API key.

```typescript
import { getPoeAuthIdentity } from "poe-code";

const identity = await getPoeAuthIdentity();
console.log(identity.name, identity.handle);
```

Uses `POE_API_KEY` or the stored credential, honors `POE_BASE_URL`, and throws an API error when Poe rejects the credential.

### SDK Types

```typescript
import type {
  SpawnOptions,
  SpawnResult
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
  /** Path to the JSONL spawn log file (if logging was active) */
  logFile?: string;
}
```

#### McpSpawnConfig

```typescript
type McpSpawnConfig = Record<string, McpSpawnServer>;

interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number; // seconds
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
| opus | `anthropic/claude-opus-4.7` |

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

**MCP args:** JSON format via `--mcp-servers` (also accepts `@path/to/file.json`; `--mcp-config` is deprecated alias)

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
3. Merge TOML using Mustache template with:
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
| `anthropic/claude-opus-4.7` |
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

**MCP args:** JSON format via `--mcp-servers` (also accepts `@path/to/file.json`; `--mcp-config` is deprecated alias)

---

### Goose Provider

| Property | Value |
|----------|-------|
| ID | `goose` |
| Binary | `goose` |
| Config File | `~/.config/goose/config.yaml` |
| Config Format | YAML |
| Branding | Dark: `#FF6B35`, Light: `#E85D26` |

**Models:**

Uses `FRONTIER_MODELS` with default `anthropic/claude-opus-4.7`.

**Configuration mutations (configure):**

1. Ensure `~/.config/goose/custom_providers/` exists
2. Write custom provider JSON to `~/.config/goose/custom_providers/custom_poe.json`
3. Merge `GOOSE_PROVIDER`, `GOOSE_MODEL`, and `GOOSE_DISABLE_KEYRING` into `~/.config/goose/config.yaml`
4. Store `CUSTOM_POE_API_KEY` in `~/.config/goose/secrets.yaml`

**Unconfigure mutations:**

- Remove `custom_poe.json`
- Prune Goose-specific keys from `config.yaml`
- Remove `CUSTOM_POE_API_KEY` from `secrets.yaml`

**Isolated environment:**

| Variable | Type | Relative Path |
|----------|------|---------------|
| `HOME` | `isolatedDir` | `` |
| `XDG_CONFIG_HOME` | `isolatedDir` | `.config` |

Config probe: `.config/goose/config.yaml`

**Custom spawn:** Runs `goose run --output-format stream-json --text <prompt>`.

**Spawn configuration:**

| Property | Value |
|----------|-------|
| Prompt flag | `--text` |
| Model flag | `--model` |
| Strip provider prefix | No |
| Default args | `run --output-format stream-json` |
| Stdin mode | Omit prompt, add `--instructions -` |
| Interactive args | `session` |
| Resume command | `run --resume --text continue` |

**Permission mode env:**

| Mode | Value |
|------|-------|
| `yolo` | `GOOSE_MODE=auto` |
| `edit` | `GOOSE_MODE=smart_approve` |
| `read` | `GOOSE_MODE=chat` |

**MCP args:** repeated `--with-extension "<command> <args...>"`

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

## Spawn System

### Spawn Modes

| Mode | Description | Claude Code Args | Codex Args | OpenCode Args | Kimi Args | Goose |
|------|-------------|-----------------|------------|---------------|-----------|-------|
| `yolo` | Full access, no permission prompts | `--dangerously-skip-permissions` | `-s danger-full-access` | (none) | `--yolo` | `GOOSE_MODE=auto` |
| `edit` | Can edit files, restricted commands | `--permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,Glob,Grep,NotebookEdit` | `-s workspace-write` | (none) | (none) | `GOOSE_MODE=smart_approve` |
| `read` | Read-only, no modifications | `--permission-mode plan` | `-s read-only` | `--agent plan` | (none) | `GOOSE_MODE=chat` |

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
| Goose | Yes | `stream-json` |

Use `renderAcpStream()` from `@poe-code/agent-spawn` for pretty-printed terminal output, or `spawn.pretty()` from the SDK.

### MCP at Spawn Time

Inject MCP servers into an agent session at spawn time. This allows agents to use additional tools during a session.

**CLI:**
```bash
poe-code spawn claude-code "Use the database tool" \
  --mcp-servers '{"db": {"command": "/usr/local/bin/db-server", "args": ["--port", "5432"]}}'

# Or load the same structure from disk
poe-code spawn claude-code "Use the database tool" --mcp-servers @./mcp.json
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
| Claude Code | JSON or `@file` via `--mcp-servers` | `--mcp-servers` |
| Codex | TOML inline tables via `-c` flags | `-c mcp_servers.name.command="..."` |
| Kimi | JSON or `@file` via `--mcp-servers` | `--mcp-servers` |
| Goose | Repeated extension flags | `--with-extension "<command> <args...>"` |
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
| Goose | Omits `--text`, adds `--instructions -` |

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
| Goose | `run --resume --text continue` |

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
MCP: --mcp-servers <JSON\|@file> (deprecated alias: --mcp-config)
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
MCP: --mcp-servers <JSON\|@file> (deprecated alias: --mcp-config)
Stdin: omit prompt flag, add --input-format stream-json
Interactive prompt flag: -p
Resume: --session <threadId> --work-dir <cwd>
```

#### Goose Spawn Config

```
Binary: goose
Prompt: --text <prompt>
Model: --model <model> (provider prefix preserved)
Default args: run --output-format stream-json
Modes:
  yolo: GOOSE_MODE=auto
  edit: GOOSE_MODE=smart_approve
  read: GOOSE_MODE=chat
MCP: --with-extension "<command> <args...>" (repeatable)
Stdin: omit --text, add --instructions -
Interactive: session
Resume: run --resume --text continue
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
| Goose | `~/.config/goose/config.yaml` + `~/.config/goose/secrets.yaml` + `~/.config/goose/custom_providers/custom_poe.json` | YAML + JSON |

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
// Merge using Mustache template
templateMutation.mergeToml({
  target: "~/.codex/config.toml",
  templateId: "codex/config.toml.mustache",
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
| `DEFAULT_FRONTIER_MODEL` | `anthropic/claude-opus-4.7` | OpenCode and Goose defaults |
| `DEFAULT_CLAUDE_CODE_MODEL` | `anthropic/claude-sonnet-4.6` | Claude Code default |
| `DEFAULT_CODEX_MODEL` | `openai/gpt-5.5` | Codex default |
| `DEFAULT_KIMI_MODEL` | `novitaai/kimi-k2.5` | Kimi default |
| `DEFAULT_GOOSE_MODEL` | `anthropic/claude-opus-4.7` | Goose default |
| `DEFAULT_REASONING` | `medium` | Codex reasoning effort |
| `PROVIDER_NAME` | `poe` | Provider identifier in configs |

### Frontier Models

```typescript
const FRONTIER_MODELS = [
  "anthropic/claude-opus-4.7",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.5",
  "google/gemini-3.1-pro"
];
```

### Claude Code Variants

```typescript
const CLAUDE_CODE_VARIANTS = {
  haiku: "anthropic/claude-haiku-4.5",
  sonnet: "anthropic/claude-sonnet-4.6",
  opus: "anthropic/claude-opus-4.7"
};
```

### Codex Models

```typescript
const CODEX_MODELS = [
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2-pro",
  "openai/gpt-5.1",
  "openai/gpt-5.1-codex-mini",
  "anthropic/claude-opus-4.7"
];
```

### Kimi Models

```typescript
const KIMI_MODELS = [
  "novitaai/kimi-k2.5",
  "novitaai/kimi-k2-thinking",
  "novitaai/kimi-k2.5-fw"
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
| `POE_DEFAULT_AGENT` | — | Default agent (or `agent:model`) used when commands omit agent selection. |
| `POE_BASE_URL` | `https://api.poe.com/v1` | Poe API base URL. Used for provider configuration. |
| `POE_API_BASE_URL` | `https://api.poe.com/v1` | Poe API base URL. |
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
poe-code/
├── .claude/                         # Committed Claude Code project skills + sync hook
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
│   │       ├── login.ts
│   │       ├── logout.ts
│   │       ├── auth.ts
│   │       ├── skill.ts
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
│   └── templates/                  # Mustache templates for configs
├── packages/
│   ├── agent-defs/                 # Agent definitions and metadata
│   ├── agent-harness-tools/        # Shared loop runner and agent selection helpers
│   ├── agent-human-in-loop/        # Approval prompt providers for human-in-loop workflows
│   ├── agent-spawn/                # Agent spawning and streaming
│   ├── agent-mcp-config/           # MCP configuration per agent
│   ├── agent-skill-config/         # Skill configuration
│   ├── auth-store/                 # Shared credential/session storage
│   ├── cached-resource/            # Resource caching
│   ├── config-mutations/           # Declarative file mutation DSL
│   ├── design-system/              # CLI UI components and themes
│   ├── github-workflows/           # GitHub automation prompt/workflow helpers
│   ├── mcp-oauth/                  # OAuth client/server primitives for MCP HTTP transports
│   ├── memory/                     # Repo-scoped memory files and MCP helpers
│   ├── pipeline/                   # Fixed-step pipeline plan execution
│   ├── poe-oauth/                  # Poe OAuth client and auth checks
│   ├── providers/                  # Auth-provider registry and strategies
│   ├── task-list/                  # Markdown/YAML task-list backends and state machines
│   ├── tiny-http-mcp-server/       # HTTP MCP fixture/server
│   ├── tiny-http-mcp-oauth-test-server/ # OAuth-protected HTTP MCP fixture
│   ├── tiny-mcp-client/            # Minimal MCP client with HTTP OAuth discovery
│   ├── tiny-oauth-test-server/     # OAuth test authorization server
│   ├── worktree/                   # Git worktree utilities
│   ├── tiny-stdio-mcp-server/      # MCP server framework
│   ├── tiny-stdio-mcp-test-server/ # MCP test server
│   ├── tokenfill/                  # Token filling utilities
│   └── e2e-test-runner/            # Docker-based E2E test framework
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
| `configure [agent]` | — | Configure agent for the selected provider API |
| `unconfigure <agent>` | — | Remove Poe configuration |
| `login` | — | Store API key |
| `logout` | — | Remove all config + credentials |
| `auth` | `status`, `api-key`, `whoami`, `login`, `logout` | Poe account authentication commands |
| `provider` | `list`, `login`, `logout` | Provider authentication management |
| `approvals` | `list`, `show`, `run` | Toolcraft human-in-loop approval queue |
| `spawn <agent> [prompt]` | — | Run agent with prompt |
| `code-review` | `install`, `profiles`, `ingest`, `run`, `drafts`, `commit`, `agent-mcp` | Agent-assisted GitHub pull request reviews |
| `research [prompt]` | — | Research codebase (read mode) |
| `wrap <agent>` | — | One-off isolated session |
| `test [agent]` | — | Health check |
| `install [agent]` | — | Install agent binary |
| `usage` | `balance`, `list` | Check usage/billing |
| `models` | — | List available models |
| `skill` | `configure`, `unconfigure` | Agent skill management |
| `pipeline` | `run`, `init`, `validate`, `plan-path`, `install` | Pipeline plan generation, validation, and execution |
| `memory` | `init`, `ls`, `show`, `search`, `status`, `clear` | Repo-scoped persistent memory operations |


### SDK Exports Summary

```typescript
// Functions
export { spawn } from "poe-code";          // spawn() and spawn.pretty()
export { getPoeApiKey } from "poe-code";    // API key resolution
export { getPoeAuthIdentity } from "poe-code"; // Poe account identity
export {
  agent,
  openaiChatCompletionsPlugin,
  openaiResponsesPlugin,
  systemPromptPlugin
} from "poe-code/agent";                     // Composable agent runtime

// Types
export type { SpawnOptions } from "poe-code";
export type { SpawnResult } from "poe-code";
export type {
  AgentBuilder,
  AgentPlugin,
  AgentRunOptions,
  Provider,
  RunResult,
  Tool
} from "poe-code/agent";

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
