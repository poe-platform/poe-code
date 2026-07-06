# Adding a New Agent

Keep changes minimal and provider-driven.

## Feature matrix

Before writing code, determine which features the agent supports. This drives which files you need to touch.

| Feature              | Description                                             | Example agents                                     |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| **Configure**        | Write config files so the agent talks to the Poe API    | all agents                                         |
| **Unconfigure**      | Reverse the configure step                              | claude-code, codex, kimi, opencode                 |
| **Models**           | Agent supports model selection at configure time        | claude-code, codex, kimi                           |
| **Install**          | Automated binary install via `ServiceInstallDefinition` | claude-code, codex, kimi, opencode                 |
| **Test**             | Health-check command (`poe-code test`)                  | claude-code, codex, kimi, opencode                 |
| **Spawn (CLI)**      | Run the agent's CLI binary with a prompt                | claude-code, codex, kimi, opencode                 |
| **Spawn (ACP)**      | Run the agent via Agent Control Protocol                | kimi, opencode                                     |
| **Adapter**          | Custom stream parser for the agent's JSON output        | claude-code, codex, kimi, opencode                 |
| **Stdin prompt**     | Accept prompt via stdin instead of CLI arg              | claude-code, kimi                                  |
| **Interactive mode** | Launch the agent in interactive (REPL) mode             | kimi, opencode                                     |
| **Resume**           | Resume an existing thread/session                       | claude-code, kimi, opencode                        |
| **MCP (config)**     | Write MCP server entries into the agent's config file   | claude-code, claude-desktop, codex, kimi, opencode |
| **MCP (spawn)**      | Pass MCP servers as CLI args at spawn time              | claude-code, codex, kimi, opencode                 |
| **Skills**           | Support global/local skill directories                  | claude-code, codex, opencode                       |
| **Isolated env**     | Run inside an isolated home directory for testing       | claude-code, codex, kimi, opencode                 |
| **Templates**        | Mustache templates for config file generation           | codex                                              |

## Files to touch

### Always required

| #   | File                                        | What to do                                                |
| --- | ------------------------------------------- | --------------------------------------------------------- |
| 1   | `packages/agent-defs/src/agents/<agent>.ts` | Create agent definition                                   |
| 2   | `src/providers/<agent>.ts`                  | Create provider (auto-discovered, must export `provider`) |

Generated registries and barrels are updated by the repo scripts. Do not add provider-specific `if`/`switch` branches in shared code. Keep the provider file declarative; use a custom `spawn(context, options)` hook only when the declarative spawn config cannot express the agent.

### Conditional (based on features)

| #   | File                                           | When                                                                  |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 3   | `packages/agent-spawn/src/configs/<agent>.ts`  | Spawn (CLI or ACP)                                                    |
| 4   | `packages/agent-spawn/src/adapters/<agent>.ts` | Custom stream adapter                                                 |
| 5   | `packages/agent-spawn/src/configs/mcp.ts`      | MCP at spawn, only when existing serializers cannot express the agent |
| 6   | `packages/agent-mcp-config/src/configs.ts`     | MCP config                                                            |
| 7   | `packages/agent-skill-config/src/configs.ts`   | Skills                                                                |
| 8   | `src/templates/<agent>/`                       | Templates, when the provider manifest needs rendered config files     |

Only touch registry files when the package has no generator for that registry. If a generator exists, update source data and run the generator.

### Tests

| #   | File                                                         | What to do                                        |
| --- | ------------------------------------------------------------ | ------------------------------------------------- |
| 9   | `packages/agent-defs/src/agent-defs.test.ts`                 | Assert definition and aliases                     |
| 10  | `src/providers/providers.test.ts`                            | Add provider configure/unconfigure/spawn behavior |
| 11  | `packages/agent-spawn/src/configs/configs.test.ts`           | Add spawn/MCP-at-spawn test cases                 |
| 12  | `packages/agent-spawn/src/adapters/adapters.test.ts`         | Add adapter tests                                 |
| 13  | `packages/agent-mcp-config/src/agent-mcp-config.test.ts`     | Add MCP config tests                              |
| 14  | `packages/agent-skill-config/src/agent-skill-config.test.ts` | Add skill config tests                            |

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

Must export `provider`. The file is auto-discovered; no manual registration should be needed.

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
  spawn?: (context, options) => Promise<unknown>, // only when declarative spawn config is insufficient
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
