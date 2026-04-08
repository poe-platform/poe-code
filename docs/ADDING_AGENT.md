# Adding a New Agent

Keep changes minimal and provider-driven.

## Feature matrix

Before writing code, determine which features the agent supports. This drives which files you need to touch.

| Feature | Description | Example agents |
| --- | --- | --- |
| **Configure** | Write config files so the agent talks to the Poe API | all agents |
| **Unconfigure** | Reverse the configure step | claude-code, codex, kimi, opencode |
| **Models** | Agent supports model selection at configure time | claude-code, codex, kimi |
| **Install** | Automated binary install via `ServiceInstallDefinition` | claude-code, codex, kimi, opencode |
| **Test** | Health-check command (`poe-code test`) | claude-code, codex, kimi, opencode |
| **Spawn (CLI)** | Run the agent's CLI binary with a prompt | claude-code, codex, kimi, opencode |
| **Spawn (ACP)** | Run the agent via Agent Control Protocol | kimi, opencode |
| **Adapter** | Custom stream parser for the agent's JSON output | claude-code, codex, kimi, opencode |
| **Stdin prompt** | Accept prompt via stdin instead of CLI arg | claude-code, kimi |
| **Interactive mode** | Launch the agent in interactive (REPL) mode | kimi, opencode |
| **Resume** | Resume an existing thread/session | claude-code, kimi, opencode |
| **MCP (config)** | Write MCP server entries into the agent's config file | claude-code, claude-desktop, codex, kimi, opencode |
| **MCP (spawn)** | Pass MCP servers as CLI args at spawn time | claude-code, codex, kimi, opencode |
| **Skills** | Support global/local skill directories | claude-code, codex, opencode |
| **Isolated env** | Run inside an isolated home directory for testing | claude-code, codex, kimi, opencode |
| **Templates** | Handlebars templates for config file generation | codex |

## Files to touch

### Always required

| # | File | What to do |
| --- | --- | --- |
| 1 | `packages/agent-defs/src/agents/<agent>.ts` | Create agent definition |
| 2 | `packages/agent-defs/src/agents/index.ts` | Re-export the new definition |
| 3 | `packages/agent-defs/src/registry.ts` | Add to `allAgents` array |
| 4 | `src/providers/<agent>.ts` | Create provider (auto-discovered, must export `provider`) |
| 5 | `src/cli/constants.ts` | Add model list + default model constant |

### Conditional (based on features)

| # | File | When |
| --- | --- | --- |
| 6 | `packages/agent-spawn/src/configs/<agent>.ts` | Spawn (CLI or ACP) |
| 7 | `packages/agent-spawn/src/configs/index.ts` | Spawn -- add to `allSpawnConfigs` and/or `acpLookup` |
| 8 | `packages/agent-spawn/src/adapters/<agent>.ts` | Custom stream adapter |
| 9 | `packages/agent-spawn/src/adapters/index.ts` | Custom stream adapter -- add to `AdapterType` union + exports |
| 10 | `packages/agent-spawn/src/configs/mcp.ts` | MCP at spawn -- add serializer if needed |
| 11 | `packages/agent-mcp-config/src/configs.ts` | MCP config -- add to `agentMcpConfigs` |
| 12 | `packages/agent-skill-config/src/configs.ts` | Skills -- add to `agentSkillConfigs` |
| 13 | `src/templates/<agent>/` | Templates -- create Handlebars files |

### Tests

| # | File | What to do |
| --- | --- | --- |
| 14 | `packages/agent-defs/src/agent-defs.test.ts` | Add agent id to `expectedAgents` |
| 15 | `src/providers/providers.test.ts` | Add provider test cases |
| 16 | `packages/agent-spawn/src/configs/configs.test.ts` | Add spawn/MCP-at-spawn test cases |
| 17 | `packages/agent-spawn/src/adapters/adapters.test.ts` | Add adapter tests |
| 18 | `packages/agent-mcp-config/src/agent-mcp-config.test.ts` | Add MCP config tests |
| 19 | `packages/agent-skill-config/src/agent-skill-config.test.ts` | Add skill config tests |

## Expected exports

### Agent definition (`packages/agent-defs/src/agents/<agent>.ts`)

```ts
export const <agent>Agent: AgentDefinition = {
  id: string;            // kebab-case identifier
  name: string;          // same as id
  label: string;         // display name (Title Case)
  summary: string;       // one-liner
  aliases?: string[];    // alternative names
  binaryName?: string;   // CLI binary name (omit for GUI-only)
  configPath: string;    // must start with ~/
  branding: {
    colors: {
      dark: string;      // hex
      light: string;     // hex
    }
  }
};
```

### Provider (`src/providers/<agent>.ts`)

Must export `provider`. File is auto-discovered -- no manual registration needed.

```ts
export const provider = createProvider<ConfigureCtx, UnconfigureCtx, SpawnCtx>({
  ...agentDef,                       // spread the agent definition
  supportsStdinPrompt?: boolean,
  disabled?: boolean,                // hide from UI
  configurePrompts?: { model },      // interactive model picker
  postConfigureMessages?: string[],
  isolatedEnv?: ProviderIsolatedEnv,
  install?: ServiceInstallDefinition,
  test?: (context) => Promise<void>,
  spawn?: (context, options) => Promise<unknown>,
  manifest: {
    configure: Mutation[],           // config-mutations to apply
    unconfigure?: Mutation[],        // undo mutations
  }
});
```

### Spawn config (`packages/agent-spawn/src/configs/<agent>.ts`)

```ts
// CLI spawn
export const <agent>SpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: string,
  adapter: AdapterType,              // "claude" | "codex" | "kimi" | "opencode" | "native"
  promptFlag: string,                // e.g. "-p"
  modelFlag?: string,
  modelStripProviderPrefix: boolean,
  defaultArgs: string[],
  modes: { yolo, edit, read },
  stdinMode?: { omitPrompt, extraArgs },
  mcpArgs?: (servers) => string[],
  mcpEnv?: (servers) => Record<string, string>,
  interactive?: { defaultArgs, promptFlag? },
  resumeCommand?: (threadId, cwd) => string[],
};

// ACP spawn (optional)
export const <agent>AcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: string,
  acpArgs: string[],
};
```

### MCP config (`packages/agent-mcp-config/src/configs.ts`)

Add entry to `agentMcpConfigs`:

```ts
"<agent>": {
  configFile: string | ((platform: Platform) => string),
  configKey: string,       // JSON/TOML key for MCP servers
  format: "json" | "toml",
  shape: "standard" | "opencode",
  mcpOutputFormat?: string,
}
```

### Skill config (`packages/agent-skill-config/src/configs.ts`)

Add entry to `agentSkillConfigs`:

```ts
"<agent>": {
  globalSkillDir: string,  // e.g. "~/.agent/skills"
  localSkillDir: string,   // e.g. ".agent/skills"
}
```
