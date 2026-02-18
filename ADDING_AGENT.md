# Adding a New Agent

Keep changes minimal and provider-driven.

## Files to touch (short list)

1. `packages/agent-defs/src/agents/<agent>.ts`
2. `packages/agent-defs/src/agents/index.ts`
3. `packages/agent-defs/src/index.ts`
4. `packages/agent-defs/src/registry.ts`
5. `src/providers/<agent>.ts`
6. `packages/agent-spawn/src/configs/<agent>.ts` (if spawn supported)
7. `packages/agent-spawn/src/configs/index.ts` (if spawn supported)
8. `packages/agent-mcp-config/src/configs.ts` (if MCP supported)
9. `packages/agent-skill-config/src/configs.ts` (if skills supported)
10. Tests for the provider + agent defs

## Expected exports

1. Agent definition must be exported from `packages/agent-defs/src/index.ts`.
2. Provider module must export `provider`.
