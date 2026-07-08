# Poe Code Reference

Use this as the concise map of Poe Code's public surfaces. For setup-first guidance, start with the [root README](../README.md).

## Requirements

- Node.js `>=18.18`
- npm `>=10`
- A Poe-compatible API key or provider credential for the agent you configure
- The target agent CLI installed when you use `spawn` or `test`

## CLI

Core setup:

```sh
poe-code login
poe-code auth status
poe-code logout
poe-code configure [agent]
poe-code unconfigure <agent>
poe-code install <agent>
poe-code update
poe-code test <agent>
```

Execution:

```sh
poe-code agent "Prompt"
poe-code spawn <agent> "Prompt"
poe-code spawn <agent> --cwd github://owner/repo#ref:path "Prompt"
```

Discovery and account tools shown in root help:

```sh
poe-code models
poe-code usage
poe-code traces
```

Workflow tools shown in root help:

```sh
poe-code gaslight
poe-code pipeline
poe-code ralph
poe-code experiment
poe-code plan
poe-code harness
```

Additional command groups are routable but omitted from root help to keep the
top-level list short:

```sh
poe-code utils --help
poe-code skill --help
poe-code provider --help
poe-code memory --help
poe-code memory-mcp --help
poe-code maestro --help
poe-code runtime --help
poe-code worktree --help
poe-code code-review --help
poe-code github-workflows --help
poe-code gh --help
poe-code eval --help
poe-code superintendent --help
poe-code braintrust --help
poe-code tasks --help
poe-code launch --help
poe-code approvals --help
```

Every command supports `--help`. Use `npm run dev -- <command>` inside this repository to run the development CLI.

## Common Flags

- `--yes`: accept defaults for non-interactive flows.
- `--dry-run`: show planned mutations without writing files.
- `--model <model-id>`: override the configured model for run-capable commands.
- `--provider <id>`: choose an auth provider for configure/login flows.
- `--cwd <path-or-locator>`: run against a local path or `github://owner/repo[#ref[:subdir]]`.

## Authentication

Poe Code stores credentials locally and exposes explicit login/status/logout flows.

```sh
poe-code login
poe-code login --api-key <key>
POE_API_KEY=<key> poe-code auth status
poe-code logout
```

Provider credentials are declared through `@poe-code/providers`; provider env vars and config options are documented in [packages/providers](../packages/providers/README.md).

## Configuration

Project config lives at `<cwd>/.poe-code/config.json`. Global config lives at `~/.poe-code/config.json`. Project config overrides global config by scope.

Useful commands:

```sh
poe-code utils config
poe-code utils config show
poe-code utils config init
poe-code utils config edit
```

See [README_UTILS.md](../README_UTILS.md) and [@poe-code/poe-code-config](../packages/poe-code-config/README.md).

## SDK

Root package:

```ts
import { spawn } from "poe-code";

const { events, result } = spawn("codex", {
  prompt: "Review this package",
  cwd: process.cwd(),
  model: "<model-id>"
});

for await (const event of events) {
  // stream ACP-like events
}

console.log(await result);
```

Pretty terminal rendering:

```ts
import { spawn } from "poe-code";

const result = await spawn.pretty("codex", {
  prompt: "Fix the failing tests",
  cwd: process.cwd()
});
```

Plugin-first agent runtime:

```ts
import { agent, openaiResponsesPlugin, systemPromptPlugin } from "poe-code/agent";

const result = await agent()
  .model("<model-id>")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize this repository", { cwd: process.cwd() });
```

Memory subpath:

```ts
import { openMemory, searchMemory } from "poe-code/memory";
```

Skills subpath:

```ts
import { installSkill } from "poe-code/skills";
```

## Package Map

- [@poe-code/agent-defs](../packages/agent-defs/README.md): agent metadata and aliases.
- [@poe-code/providers](../packages/providers/README.md): provider manifests and credential resolution.
- [@poe-code/agent-spawn](../packages/agent-spawn/README.md): low-level spawn adapters, streaming, resume, MCP-at-spawn.
- [@poe-code/poe-agent](../packages/poe-agent/README.md): plugin-based in-process agent runtime.
- [@poe-code/memory](../packages/memory/README.md): repo memory, memory CLI, and memory MCP server.
- [@poe-code/pipeline](../packages/pipeline/README.md): step-based plan execution.
- [@poe-code/agent-gaslight](../packages/agent-gaslight/README.md): scripted follow-up rounds in one agent thread.
- [@poe-code/ralph](../packages/ralph/README.md): iterative markdown improvement loop.
- [@poe-code/experiment-loop](../packages/experiment-loop/README.md): metric-driven experiment loop.
- [@poe-code/worktree](../packages/worktree/README.md): managed git worktree execution and reconciliation.
- [toolcraft](../packages/toolcraft/README.md): command runtime, rendering, MCP, and human-in-loop support.

Each package README documents its public environment variables and configuration options.

## Plans and Research

- Active plans: [docs/plans](plans/README.md)
- Archived plans: [docs/plans/archive](plans/archive/README.md)
- Research notes: [docs/research](research/README.md)

Plans are working documents. Package READMEs and this reference are the user-facing docs for shipped behavior.
