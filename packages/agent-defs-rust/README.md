# @poe-code/agent-defs-rust

Use one coding-agent catalog for aliases, configuration paths, branding and
command capabilities. This private additive Rust rewrite provides the same Node
API as `@poe-code/agent-defs`, with zero npm runtime dependencies.

```ts
import {
  allAgents,normalizeAgentId,agentSupportsCapability,codexAgent
} from '@poe-code/agent-defs-rust';

console.log(normalizeAgentId('CLAUDE:Provider/Model')); // claude-code:Provider/Model
console.log(agentSupportsCapability('pi-agent','spawn')); // true
console.log(codexAgent.configPath); // ~/.codex/config.toml
const agentsWithMcp=allAgents.filter(agent=>agent.capabilities?.includes('mcp'));
```

| API | Use |
| --- | --- |
| `allAgents`, individual agent exports | Read labels, paths, binary names, colors and API shapes |
| `resolveAgentId` | Resolve aliases and names case-insensitively |
| `parseAgentSpecifier`, `formatAgentSpecifier`, `normalizeAgentId` | Preserve inline model identifiers while normalizing agents |
| `listAgentsWithCapability`, `agentSupportsCapability` | Apply a shared command capability matrix |
| `formatAgentCapabilityError` | Explain unknown names, suggest typos and identify unsupported commands |
| `otelCapture` | Obtain declarative telemetry environment or argument overlays |

Definitions and capability data come from the Rust catalog. Node caches the
derived lookup and lists, so routine alias and capability checks do not cross the
native boundary. Node's built-in string operations apply the shared Rust specifier
policy without copying model identifiers through native memory. Registry records,
aliases, capabilities, API shapes, branding
and telemetry overlays preserve the original freeze behavior. Each list call
returns an independent array.

The standard-library Rust core also exposes `Registry`, UTF-16 `Specifier`
parsing/formatting and reusable `Registry::from_json` catalogs.
Each Rust definition can also carry optional `mcp_config` settings, including
platform paths, configuration format and server shape, alongside its capabilities.
These settings stay separate from the existing Node agent metadata.
Telemetry argument templates escape endpoints as JSON and preserve Unicode, including lone
surrogates. This package does not load application configuration or read
environment variables.

Existing applications continue using the original package. Platform artifact
coverage and full agent integration remain in progress.
