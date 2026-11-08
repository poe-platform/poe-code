# Poe Code At A Glance

Poe Code configures coding agents to use Poe-compatible providers, then gives the repo a shared SDK for running agents, workflows, tools, memory, and review loops.

## User Commands

Core setup:

```sh
poe-code login
poe-code configure [agent]
poe-code unconfigure <agent>
poe-code test <agent>
poe-code install <agent>
```

Agent execution:

```sh
poe-code spawn <agent> "Fix the failing tests"
poe-code spawn <agent> --cwd github://owner/repo#main:packages/app
poe-code gaslight docs/plans/feature.md --agent codex
poe-code pipeline run docs/plans/feature.md --agent codex
```

Project tools:

```sh
poe-code models
poe-code usage
poe-code traces
```

Advanced groups are routable but hidden from root help:

```sh
poe-code provider --help
poe-code memory --help
poe-code code-review --help
```

## Main Packages

- `poe-code`: public CLI and SDK surface.
- `@poe-code/providers`: declarative auth-provider manifests and credential resolution.
- `@poe-code/agent-defs`: agent metadata, aliases, branding, and config paths.
- `@poe-code/agent-spawn`: low-level agent launch, streaming, ACP adapters, MCP-at-spawn, and resume plumbing.
- `@poe-code/poe-agent`: plugin-based in-process agent runtime.
- `toolcraft`: command, rendering, MCP, and human-in-loop runtime used by several packages.
- `@poe-code/worktree`: managed git worktree execution and reconciliation.

## Design Rules

- Adding a provider should mean adding one provider file. Registries and exports are generated from provider config.
- Core packages wire public APIs; feature logic belongs in focused packages.
- CLI and SDK options should stay in parity.
- Config mutations parse and merge structured files. Do not use regexes for config edits.
- Package READMEs must list exposed environment variables and config options, including "none" when none are exposed.
