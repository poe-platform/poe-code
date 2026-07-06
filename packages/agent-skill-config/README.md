# @poe-code/agent-skill-config

`@poe-code/agent-skill-config` resolves skill references for CLI, SDK, pipeline, and ralph configs, installs declarative skill folders into native agent skill directories, and bridges active skills into the spawning agent at runtime.

## Skill References

Skill refs use one of two forms:

```text
"<name>"              # bare: poe-code-native skill
"<agentId>/<name>"    # agent-prefixed: agent-native skill
```

Examples:

| Ref                       | Source                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `"my-helper"`             | `~/.poe-code/skills/my-helper` or `<cwd>/.poe-code/skills/my-helper` |
| `"claude/my-helper"`      | `~/.claude/skills/my-helper` alias for `claude-code`                 |
| `"claude-code/my-helper"` | `~/.claude/skills/my-helper` canonical id                            |
| `"codex/my-helper"`       | `~/.codex/skills/my-helper`                                          |

The agent token accepts canonical ids, aliases, and any casing. It is normalized with `resolveAgentId` from `@poe-code/agent-defs`. The token is not the source agent's native directory name; the source path always comes from `agentSkillConfigs[canonicalId]`, so aliases map to the directory owned by that canonical agent.

## Resolution

Resolution is per ref. Project scope beats user scope; first hit wins.

Bare `<name>`:

1. `<cwd>/.poe-code/skills/<name>`
2. `~/.poe-code/skills/<name>`

Prefixed `<agentId>/<name>`:

1. `<cwd>/<agentId-local-skill-dir>/<name>`, for example `<cwd>/.claude/skills/<name>`
2. `~/<agentId-global-skill-dir>/<name>`, for example `~/.claude/skills/<name>`

Per-agent skill directories come from `agentSkillConfigs` in `configs.ts`; resolvers do not hard-code native agent paths.

## Bridge Contract

At spawn time, `bridgeActiveSkills(spawnAgentId, cwd, refs, homeDir, runId)` resolves every ref, then copies each resolved source folder into the spawning agent's native local skill directory under `cwd`, keyed by source basename:

```text
<cwd>/<spawn-agent-local-skill-dir>/<source-basename>
```

The source ref's agent prefix never appears in the target path. For a Claude Code spawn, both `"codex/my-helper"` and `"my-helper"` target `.claude/skills/my-helper`.

Resolution failures abort the whole bridge before any copy. Error messages distinguish:

| Kind            | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| `malformed`     | Bad syntax; expected `"<name>"` or `"<agentId>/<name>"`.                             |
| `unknown-agent` | Agent token does not resolve to a supported agent; the error lists supported agents. |
| `not-found`     | No skill folder exists at any tier; the error lists searched paths in order.         |

Collisions never abort. The bridge emits one `BridgeWarning` per skipped ref, leaves no state for that ref, and continues the batch.

| Warning kind            | Skip condition                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `local-collision`       | Target folder already exists in the spawning agent's local skill dir.  |
| `global-collision`      | Target folder already exists in the spawning agent's global skill dir. |
| `self-reference`        | The spawning agent references its own native skill.                    |
| `intra-batch-collision` | Two refs produce the same target basename; first input ref wins.       |

Native skills are never overwritten. Callers, including the spawn runner, surface `manifest.warnings` through the design-system warning channel before launching the agent.

`cleanupBridgedSkills(manifest)` removes only bridge-created targets and empty parent directories recorded in the manifest. It is idempotent.

When bridge creates entries inside a git repository, `.git/info/exclude` gets a per-run marked block containing only successfully bridged target entries. Cleanup removes only that run's marked block.

## Public API

```ts
import {
  bridgeActiveSkills,
  cleanupBridgedSkills,
  resolveSkillReference,
  configure,
  unconfigure,
  installSkill,
  resolveAgentSupport,
  getAgentConfig,
  resolveSkillDir,
  supportedAgents
} from "@poe-code/agent-skill-config";
```

Exported types include `AgentSkillConfig`, `AgentSupportResult`, `SkillScope`, `SkillResolution`, `SkillResolutionFailure`, `SkillSource`, `BridgeEntry`, `BridgeManifest`, `BridgeWarning`, `BridgeWarningKind`, `ApplyOptions`, `SkillFile`, `InstallSkillOptions`, and `InstallSkillResult`.

`agentSkillConfigs` is internal and is not exported.

## CLI Commands

| Command                      | Purpose                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `poe-code skill install`     | Install one `SKILL.md` for an agent. Use `--name`, `--file`, `--local`, `--global`, or `--yes`.     |
| `poe-code skill configure`   | Create the native skill directory layout for an agent. Supports `--local`, `--global`, and `--yes`. |
| `poe-code skill unconfigure` | Remove native skill directories. Use `--force` to remove a non-empty directory.                     |

## Config Options

This package exposes no user-facing config options.

Internal agent skill config has two fields: `localSkillDir` and `globalSkillDir`. Callers can read supported resolved config through `resolveAgentSupport()` or `getAgentConfig()`, and can turn a resolved config into an absolute path with `resolveSkillDir()`.

## Environment Variables

This package exposes no public environment variables.
