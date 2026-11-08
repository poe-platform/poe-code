# @poe-code/agent-defs

Shared catalog of supported coding-agent definitions.

This package owns the declarative agent metadata used by CLI, SDK, spawn,
configuration, and UI surfaces: stable ids, labels, aliases, config paths,
binary names, API-shape support, OTEL capture wiring, brand colors, and the
capability matrix that says which commands accept each agent.

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
- Agent definition exports such as `codexAgent`, `claudeCodeAgent`, `geminiCliAgent`, and `piAgent`.
- `listAgentsWithCapability(capability, options?)`: ids supporting a capability, optionally including aliases.
- `agentSupportsCapability(input, capability)`: resolves aliases, then checks the matrix.
- `formatAgentCapabilityError({ agent, capability })`: the shared message for a rejected agent argument.

## Capability Matrix

Each `AgentDefinition` declares its `capabilities` (`spawn`, `configure`,
`install`, `test`, `skill`, `mcp`). This is the single published source for every
command's allow-list, so `spawn`/`configure`/`install`/`test`/`skill` cannot
drift apart. `src/cli/commands/agent-capability-matrix.test.ts` pins each
capability to the registry that implements it, and fails if a registry gains or
loses an agent without the matrix being updated.

## Config Options

This package does not load external config. Agent definitions are declared in
source and exposed as immutable data.

## Environment Variables

This package does not read or expose environment variables.
