# Agent Capabilities

Current snapshot of first-party agent support.

Authoritative sources:

- Spawn and spawn-time MCP: `packages/agent-spawn/src/configs/`
- Configure/test/isolation/wrap: `src/providers/`
- Persistent MCP config: `packages/agent-mcp-config/src/configs.ts`
- Skills: `packages/agent-skill-config/src/configs.ts`

| Agent          | Spawn | Spawn-time MCP | Configure | Isolated test/run | Wrap | Persistent MCP config | Skills |
| -------------- | ----- | -------------- | --------- | ----------------- | ---- | --------------------- | ------ |
| Claude Code    | Yes   | Yes            | Yes       | Yes               | Yes  | Yes                   | Yes    |
| Codex          | Yes   | Yes            | Yes       | Yes               | Yes  | Yes                   | Yes    |
| OpenCode       | Yes   | Yes            | Yes       | Yes               | Yes  | Yes                   | Yes    |
| Kimi           | Yes   | Yes            | Yes       | Yes               | No   | Yes                   | No     |
| Goose          | Yes   | Yes            | Yes       | Yes               | No   | Yes                   | Yes    |
| Cursor         | Yes   | Yes            | Yes       | No                | No   | Yes                   | Yes    |
| Gemini CLI     | Yes   | Yes            | Yes       | Yes               | No   | No                    | Yes    |
| Claude Desktop | No    | No             | File-only | No                | No   | Yes                   | No     |
| Poe Agent      | Yes   | No             | Yes       | No                | No   | No                    | No     |

## Definitions

- **Spawn**: Poe Code can start the agent for a prompt and stream ACP-style events.
- **Spawn-time MCP**: `poe-code spawn --mcp-servers` can inject MCP servers for that run.
- **Configure**: `poe-code configure <agent>` can write the agent's Poe/provider config.
- **Isolated test/run**: the provider declares an isolated environment for `poe-code test --isolated` or equivalent isolated execution.
- **Isolated config / spawn**: agents with `isolatedEnv` run through configure + spawn using isolated Poe configuration.
- **Persistent MCP config**: `poe-code mcp` can write the agent's normal MCP config file.
- **Skills**: `poe-code skill` can install or bridge skills for the agent.

Research-only agents and unsupported clients belong in [MCP agent config locations](mcp-agents.md) or their dedicated research notes.
