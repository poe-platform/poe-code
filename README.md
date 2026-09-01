<div align="center">
  <h1>Poe Code ⚡</h1>

<a href="https://poe.com"><img src="https://img.shields.io/badge/Poe-Sign up-purple?logo=poe&logoColor=white&color=5D5CDE&style=for-the-badge" alt="Discord"></a>
<a href="https://www.npmjs.com/package/poe-code"><img alt="NPM version" src="https://img.shields.io/npm/v/poe-code.svg?&style=for-the-badge&color=09B16B"></a>
<a href="https://discord.gg/joinpoe"><img src="https://img.shields.io/badge/Discord-Join-purple?logo=discord&logoColor=white&color=FF44D3&style=for-the-badge" alt="Discord"></a>

</div>

Power your favorite coding agents (Claude Code, Codex, OpenCode, and more) with your Poe subscription—**no need to handle multiple providers/accounts.** Poe Code routes everything through the [Poe API](https://poe.com/api) .

Configure an agent once and use its normal CLI or desktop app, or spawn one-off prompts through Poe.

## Quickstart

### Set it as your default (works with CLIs and desktop apps)

This updates the provider’s config files and continue using your tools normally.

```bash
# Start the interactive setup
npx poe-code@latest configure

# Setup a specific agent
npx poe-code@latest configure codex # (or claude, opencode, kimi, goose)
```

### Unconfigure (remove overrides)

```bash
npx poe-code@latest unconfigure claude
```

## Authentication

Poe Code uses your [Poe API key](https://poe.com/api) for authentication. On first run, you'll be prompted to log in via your browser (OAuth). You can also provide your key directly:

```bash
# Interactive login (opens browser)
npx poe-code@latest login

# Or pass your API key directly
npx poe-code@latest login --api-key <your-key>

# Or set it as an environment variable
export POE_API_KEY=<your-key>
```

Credentials are stored locally in `~/.poe-code/`. Use `poe-code auth status` to check your login state.

```bash
# Remove all configuration and credentials
npx poe-code@latest logout
```

## Quick links

- [Utilities](#utilities)
- [Usage and Billing](#usage--billing)
- [Models](#models)
- [SDK](#sdk)
- [Research Preview](#research-preview)
- [Poe API](https://poe.com/api)

## Utilities

Utilities are especially useful for scripting and CI/CD.

#### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello" --mode read
```

`--mode` is the permission mode: `yolo | auto | edit | read`. It is prompted for in an
interactive terminal, but **required in CI**: without a TTY, `spawn` fails unless you pass
`--mode` (or `--yes`, which uses the shared `auto` default). The same choices apply to
`gaslight` and `harness run`, and values are case-insensitive (`--mode READ` works).
Only `--mode yolo` skips the agent's permission prompts, so keep it out of untrusted CI jobs.

#### Spawn against a GitHub repository

```bash
npx poe-code@latest spawn codex "Fix the failing tests" --cwd github://owner/repo --mode edit
npx poe-code@latest spawn codex "Review the auth module" --cwd github://owner/repo#main:packages/auth --mode read
```

#### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex --mode read
```

Stdin is piped here, so there is no TTY to prompt on — `--mode` is required.

#### Review a GitHub pull request

```bash
npx poe-code@latest code-review install
npx poe-code@latest code-review run "https://github.com/owner/repo/pull/123"
npx poe-code@latest code-review commit "https://github.com/owner/repo/pull/123" --dry-run
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

# Goose
npx poe-code@latest install goose
```

### Optional flags

- `--dry-run` – show every mutation without touching disk.
- `--yes` – accept defaults for prompts.

## Usage & Billing

Check your compute points balance and review usage history.

```bash
# Show current balance
poe-code usage

# Show usage history (20 entries, then prompts to load more)
poe-code usage list

# Show a specific number of entries without prompting
poe-code usage list --limit 100

# Filter by model name
poe-code usage list --filter claude
```

## Models

List available Poe API models and filter them by provider, capabilities, modalities, and supported API endpoint.

```bash
# List all models
poe-code models

# Show only models that support the Responses API
poe-code models --endpoint /v1/responses

# Show only models that support Chat Completions
poe-code models --endpoint /v1/chat/completions

# Search by provider or model id
poe-code models --search claude
```

## SDK

The isolated `poe-code/safe-bash` entrypoint and its public subpaths require Node.js 22 or newer. They expose the private workspace package `virtual-bash` through `poe-code`; the existing root entrypoints retain their current Node.js requirement and do not load this feature.

Use `poe-code` programmatically in your own code:

```typescript
import { spawn, getPoeApiKey, getPoeAuthIdentity } from "poe-code";

// Get stored API key
const apiKey = await getPoeApiKey();

// Fetch the authenticated Poe account identity
const identity = await getPoeAuthIdentity();

// Run a prompt through a provider
const result = await spawn("claude-code", {
  prompt: "Fix the bug in auth.ts",
  cwd: "/path/to/project",
  model: "claude-sonnet-4-6"
});

// Spawn against a GitHub repository
const { events, result: ghResult } = spawn("codex", {
  prompt: "Review the auth module",
  cwd: "github://owner/repo#main:packages/auth"
});

console.log(result.stdout);
```

For plugin-first agent composition, import the public agent builder from the
`poe-code/agent` subpath:

```typescript
import { agent, openaiResponsesPlugin, systemPromptPlugin } from "poe-code/agent";

const run = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });

console.log(run.output);
```

### `spawn(service, options)`

Runs a single prompt through a configured service CLI.

- `service` – Service identifier (`claude-code`, `codex`, `opencode`, `kimi`, `goose`)
- `options.prompt` – The prompt to send
- `options.cwd` – Working directory or workspace locator (optional). Supports local paths and `github://owner/repo[#ref[:subdir]]` locators. See [@poe-code/workspace-resolver](packages/workspace-resolver/) for the full locator syntax.
- `options.model` – Model identifier override (optional)
- `options.mode` – Permission mode: `yolo`, `auto`, `edit`, or `read` (optional; defaults to `auto`. Agents without an auto mode fail clearly)
- `options.args` – Additional arguments forwarded to the CLI (optional)

Returns `{ stdout, stderr, exitCode }`.

### `spawn.pretty(service, options)`

Same as `spawn()`, but renders the ACP event stream to stdout with colored, formatted output — matching the CLI's visual style.

```typescript
import { spawn } from "poe-code"

const result = await spawn.pretty("codex", "Fix the bug in auth.ts")
console.log(result.exitCode)
```

Returns `Promise<{ stdout, stderr, exitCode }>`.

### `getPoeApiKey()`

Reads the Poe API key with the following priority:

1. `POE_API_KEY` environment variable
2. Credentials file (`~/.poe-code/credentials.enc`)

Throws if no credentials found.

### `getPoeAuthIdentity()`

Fetches the Poe account identity for the resolved API key.

```typescript
import { getPoeAuthIdentity } from "poe-code";

const identity = await getPoeAuthIdentity();
console.log(identity.name, identity.handle);
```

Uses `POE_API_KEY` or the stored credential and honors `POE_BASE_URL`. Throws an API error when Poe rejects the credential.

## Testing

Builds and tests do not install or require GNU/native oracle utilities. Existing
captured responses remain plain regression fixtures; live tool qualification
and provisioning have been removed. SafeJS's Git module and SafeBash's Git
commands are no longer supported. Repository Git, worktrees and release tooling
remain unchanged.

Run `npm test` for workspace/unit tests followed by the required lint stress
tests. A failing unit stage fails the command before stress testing begins.
`npm run test:workspaces -- --concurrency=4` runs only the workspace/unit stage;
it is not the complete test gate.

`npm run test:stress:lint` runs the two full-scale lint-input guard cases
sequentially, with a 180-second budget per case. These are explicit stress-test
budgets, not evidence that the former 30/20-second unit deadlines passed. Release
CI requires this exclusive stress step, bounded to seven minutes, after workspace
tests and before smoke testing or publication. See the
[stress separation plan](docs/plans/lint-stress-separation.md).

## Research Preview

These features are available but subject to breaking changes.

- **[Pipeline](packages/pipeline/)** — Run YAML task plans through agents with configurable steps
- **[Ralph](packages/ralph/)** — Agentic build loop that iterates on a markdown doc
- **[Experiment loop](packages/experiment-loop/)** — Karpathy-style optimize loop: agent changes code, eval script scores it, keep or discard via git, repeat.
- **[Poe Agent](packages/poe-agent/)** — Composable agent runtime
