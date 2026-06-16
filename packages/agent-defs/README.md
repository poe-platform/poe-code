# @poe-code/agent-defs

Shared catalog of supported coding-agent definitions.

This package owns the declarative agent metadata used by CLI, SDK, spawn,
configuration, and UI surfaces: stable ids, labels, aliases, config paths,
binary names, API-shape support, OTEL capture wiring, and brand colors.

## Usage

```ts
import { allAgents, normalizeAgentId, parseAgentSpecifier } from "@poe-code/agent-defs";

const specifier = parseAgentSpecifier("claude:sonnet");
const normalized = normalizeAgentId(specifier.agent);
const codex = allAgents.find((agent) => agent.id === "codex");
```

## Public API

- `allAgents`: frozen list of built-in `AgentDefinition` records.
- `resolveAgentId(input)`: resolves ids, names, and aliases to a stable agent id.
- `parseAgentSpecifier(input)`: parses `agent` or `agent:model` input.
- `formatAgentSpecifier(specifier)`: formats an agent specifier.
- `normalizeAgentId(input)`: normalizes the agent part through the registry.
- Agent definition exports such as `codexAgent`, `claudeCodeAgent`, and `geminiCliAgent`.

## Config Options

This package does not load external config. Agent definitions are declared in
source and exposed as immutable data.

## Environment Variables

This package does not read or expose environment variables.
