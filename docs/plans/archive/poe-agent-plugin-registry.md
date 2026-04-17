---
status:
  state: completed
  iteration: 5
---
# poe-agent plugin registry (config-driven)

Make the poe-agent plugin set selectable and configurable from `poe-code-config` via a closed, first-party plugin registry.

## 1. Problem

**What hurts today, for whom:**

- Plugin composition is hardcoded. The default plugin bundle lives in [agent-session.ts:72-77](../../packages/poe-agent/src/agent-session.ts#L72-L77) as a fixed array of four factories. Callers who want a different mix (e.g. enable `memory` + `compaction`, disable `shell`, tighten `policy`) must build their own session in TypeScript and bypass the CLI entirely.
- The CLI does not expose plugins. [src/cli/poe-agent-main.ts](../../src/cli/poe-agent-main.ts) only forwards `model`, `cwd`, and `mcpServers`; everything else is fixed at the default bundle. There is no surface by which a non-code user can turn on the new plugins we just landed (compaction, memory, policy, mcp).
- Plugin options are hidden. `allowedPaths`, `policy.mode`, `memory` paths, compaction thresholds, etc. are all constructor-time arguments that users today cannot set without a TypeScript entry point.
- Ordering matters but is implicit. system-prompt must run before tool plugins; policy tends to run last. Today this is encoded by the order of elements in the hardcoded array; a config-driven world needs to preserve explicit ordering.

**Evidence it is worth solving now:**

- We just landed eight plugins (commits `ff79b974`, `2005ab93`, plus the three expansion commits). Nothing in that set is reachable from the CLI today — they exist only for programmatic callers.
- The CLAUDE.md rule *"When adding a new provider, the author should be creating 1 provider file, everything else is automatic, derived from the provider config"* applies to plugins too: adding a plugin should not require touching a central switch-case or the CLI.

**Explicitly out of scope for this iteration:**

- Third-party / user-defined plugins. Registry is closed to first-party plugins shipped in `packages/poe-agent/src/plugins/*`. No `extraPlugins` arg, no plugin-by-module-path loading.
- Runtime toggling. Plugins are resolved once at session construction; no hot-reload.
- Per-tool enable/disable inside a plugin. Configuration acts at plugin granularity — if you enable `files`, you get every tool `files` provides.
- A UI / interactive picker. CLI + config file only. (Interactive selection can come later on top of the registry.)
- Migration of `mcpServers` config into the new plugin array. The existing `agent.mcpServers` field stays as-is; the `mcp` plugin keeps being wired through the existing path.

**Decisions:**

- `systemPromptPlugin` is **explicit** in the array — matches the user's "explicit over implicit" preference.
- If `agent.plugins` is unset, fall back to today's default bundle (backwards compat for existing CLI users). A later change can flip this to "required".

## 2. User-facing shape

Config file (`~/.poe-code/config.json` or project-local `.poe-code/config.json`):

```jsonc
{
  "agent": {
    "plugins": [
      { "name": "system-prompt" },
      { "name": "files",  "options": { "allowedPaths": ["src/"] } },
      { "name": "shell",  "options": { "cwd": "." } },
      { "name": "web" },
      { "name": "memory" },
      { "name": "compaction", "options": { "threshold": 20 } },
      { "name": "policy", "options": { "mode": "read-only" } }
    ]
  }
}
```

- Array, ordering preserved (policy last, system-prompt first by convention — not enforced).
- `options` is optional; omitted means plugin defaults.
- If `agent.plugins` is absent → today's default bundle applies unchanged.

**Errors (typed, surfaced at session construction):**

```
agent.plugins[2]: unknown plugin "shel" — did you mean "shell"?
agent.plugins[4].options: expected { threshold: number }, got { threshold: "20" }
```

CLI stays the same — no new flags. `poe-code` reads config, builds session, plugin selection is transparent.

## 3. Implementation details and technical decisions

**Architecture:**

- Each plugin file adds an exported `spec` alongside its default factory:
  - `name: string`, `optionsSchema: ZodSchema`, `factory: (opts) => AgentPlugin`.
- New [packages/poe-agent/src/plugins/registry.ts](../../packages/poe-agent/src/plugins/registry.ts) imports every first-party spec, exposes `builtinPluginRegistry: Map<string, PluginSpec>`.
- New [packages/poe-agent/src/plugins/resolve-plugins.ts](../../packages/poe-agent/src/plugins/resolve-plugins.ts) takes `Array<{name, options?}>` → `AgentPlugin[]`, validating options per spec. Unknown-name error includes top-3 Levenshtein suggestions.
- `createAgentSession` gains an optional `pluginsConfig?: PluginConfigEntry[]` input. If present → resolved via registry. If absent → existing default bundle (unchanged). `plugins?: AgentPlugin[]` stays for programmatic callers; the two are mutually exclusive (typed error if both set).
- CLI layer ([src/providers/poe-agent.ts](../../src/providers/poe-agent.ts)) reads `agent.plugins` from `poe-code-config` and forwards it as `pluginsConfig`.

**poe-code-config change:**

Add a `"json"` field type — a string-serialized JSON blob validated by a caller-supplied Zod schema at read time. Minimal change: extends the existing primitive types with one new variant; no restructure of the config system. `agent.plugins` uses this with a schema of `z.array(z.object({ name: z.string(), options: z.unknown().optional() }))`.

**Edge cases:**

- Duplicate plugin names in array → error (clearer than "last wins").
- Unknown plugin → typed error with suggestions.
- Invalid options → Zod error path surfaced with the array index.
- Empty array → no plugins registered (valid; user sees bare agent).
- Plugin options reference a path that doesn't exist → plugin's own runtime concern, not the loader's.

**Flags / env vars:** none added.

## 4. Interfaces and test plan

**Types:**

```ts
// packages/poe-agent/src/plugins/registry.ts
export type PluginSpec<Options = unknown> = {
  name: string;
  optionsSchema: ZodSchema<Options>;
  factory: (options: Options) => AgentPlugin;
};
export const builtinPluginRegistry: ReadonlyMap<string, PluginSpec>;

// packages/poe-agent/src/plugins/resolve-plugins.ts
export type PluginConfigEntry = { name: string; options?: unknown };
export function resolvePluginsFromConfig(entries: PluginConfigEntry[]): AgentPlugin[];
```

**Tests:**

- `resolve-plugins.test.ts`: unknown name → typed error with suggestions; invalid options → typed error with index; duplicates → typed error; empty array → `[]`; valid config → `AgentPlugin[]` in order.
- Per-plugin `*.test.ts`: add a case that validates `spec.optionsSchema` accepts/rejects representative inputs.
- `agent-session.test.ts`: new case — `pluginsConfig` supplied takes precedence and bypasses the default bundle; `plugins` + `pluginsConfig` together → error.
- CLI-level integration (one test): given a fake `poe-code-config` with `agent.plugins`, the session ends up using exactly those plugins.

**Rollout:** additive. Existing programmatic callers using `plugins: AgentPlugin[]` keep working. Existing CLI callers with no `agent.plugins` keep getting the default bundle.

## 5. Code plan

**Build order (keeps branch green at every step):**

1. `packages/poe-code-config`: add `"json"` field type + tests.
2. `packages/poe-agent/src/plugins/<each>.ts`: export `spec` next to default factory. No behavior change.
3. `packages/poe-agent/src/plugins/registry.ts`: new file, collects specs.
4. `packages/poe-agent/src/plugins/resolve-plugins.ts`: new file + tests (errors first, happy path second).
5. `packages/poe-agent/src/agent-session.ts`: accept `pluginsConfig`; validate mutual exclusivity with `plugins`; wire resolver.
6. `packages/poe-agent/src/index.ts`: export `PluginSpec`, `PluginConfigEntry`, `builtinPluginRegistry`, `resolvePluginsFromConfig`.
7. `src/providers/poe-agent.ts`: read `agent.plugins` from config, forward as `pluginsConfig`.
8. Docs: update `packages/poe-agent/README.md` with the new config shape and the list of built-in plugin names.

**Files changed:** ~14 (8 plugin files + 3 new poe-agent files + 1 poe-code-config field type + agent-session + providers + README). Each plugin change is mechanical (add `spec` export). New code is registry + resolver + config field type.

